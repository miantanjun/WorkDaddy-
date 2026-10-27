# 反代网关取证报告（2026-10）

> 目的：回答三个问题 ——
> ① 用反代 API 时，**发给上游的东西里有哪些会暴露「这不是官方客户端」**？
> ② 此前配的出站 `User-Agent` 到底有效吗？
> ③ 把反代 API 接给别的 agent 用，和接给 WorkBuddy 自己用，有什么不同？该怎么伪装？
>
> 结论先行：**头已对齐、正文无损、参数是有意增强**。改不掉的只剩协议层以下（TLS 指纹等）。

---

## 一、威胁模型：上游能靠什么认出反代

按「识别成本从低到高」排，一共五层：

| 层 | 信号 | 我们能不能控 |
|---|---|---|
| 1 | **请求头**（多一个 / 少一个 / 值不对） | ✅ 完全可控 —— 本次重点 |
| 2 | **请求体**（参数组合、`messages` 被塞东西、非流式） | ✅ 完全可控 |
| 3 | **调用节奏**（并发数、间隔、24h 分布） | ✅ 可控，但要自律 |
| 4 | **账号行为**（同一 IP 多账号、余额消耗曲线） | 🟡 部分可控（Go 版有多号轮转与限速） |
| 5 | **传输层指纹**（TLS ClientHello、HTTP/2 SETTINGS、header 顺序、连接复用） | ❌ 抹不平 —— 只要不是 Chromium 发请求就对不上 |

> **核心判据：多出来的头比缺少的头更危险。**
> 缺一个头可以解释成"版本不同 / 灰度没开"；多一个官方根本不发的头，只能解释成"这不是官方客户端"。

---

## 二、第 1 层：官方头族取证与修复

### 2.1 取证方法

从 WorkBuddy 的 `app.asar` **静态提取**官方客户端真实的出站头构造逻辑（不是抓包猜的），再与网关 `internal/upstream/headers.go` 逐项 diff。

关键发现：官方有一张**兜底头表**，只含 5 项 —— `X-IDE-Type` / `X-IDE-Name` / `X-IDE-Version` / `X-Private-Data` / `X-Product`。

### 2.2 修了什么

| # | 项 | 修前 | 修后 | 依据 |
|---|---|---|---|---|
| H1 | `X-Product` | `WorkBuddy` | **`SaaS`** | `X-Product` 是**部署形态**不是产品名。官方写死 `SaaS`（`cli/product.json` 的 `deploymentType`）；填产品名反而是自造值 |
| H2 | `X-IDE-Name` / `X-IDE-Type` / `X-IDE-Version` | **缺失** | `WorkBuddy` / `WorkBuddy` / `5.8.3` | 官方兜底头表五项之一，chat 请求必带 |
| H3 | `X-Agent-Intent` / `X-Agent-Purpose` | **缺失** | `craft` / `conversation` | 官方 chat 路径带 |
| H4 | `X-Private-Data` | **缺失** | `true` | 官方兜底头表 |
| H5 | `X-Machine-ID` / `X-Session-ID` | **发了**（按 uid 派生） | **停用**（函数保留、函数体清空） | ⚠️ **`app.asar` 里搜这两个名字零命中** ⇒ 这是我们自己造的，属于第 5 类里最危险的一类：**多出来的头** |
| H6 | `Origin` / `Referer` | `https://www.codebuddy.cn` | **`https://www.workbuddy.cn`** | 与同一请求里的 `X-Domain: www.workbuddy.cn` **自相矛盾** —— 这个矛盾本身就是特征，先把矛盾消掉 |
| H7 | `User-Agent` | 早期形态 | **`WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0`** | 官方是 `[applicationName, platform].join(' ')`，版本取 `cli/package.json` 的 **`publishConfig.customPackage.version`**（顶层 `version` 是 `0.0.0` 占位） |

**H5 的处置方式值得记一笔**：没有直接删调用点，而是**把函数体清空**（`_ = req; _ = a`）。理由是 `CommonHeaders` 和 billing 两处都在调它，先摘行为、后摘调用点，减少一次改动面。确认无副作用后再连调用一起删。

### 2.3 生产环境实际生效值

`%APPDATA%\WorkDaddy\gateway\config.json` 的 `upstream` 段：

```json
{ "client_version": "5.8.3", "cli_version": "2.161.0",
  "user_agent": "WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0" }
```

⇒ **UA 有效，且是精确对齐当前客户端版本的三段式**。

⚠️ 但 `headers.go` 的**内置默认值仍是 `5.5.4` / `2.137.1`**，生产靠 config 显式覆盖。**换机 / 重装 / 配置丢失时，新装网关会自称 5.5.4** —— 旧版本号本身就可疑。已记入待办 `T3`。

---

## 三、第 2 层：抓包证实「正文一个字没改」

### 3.1 方法

把上游基址（`cn.chat_base`）指向本地抓头服务器（127.0.0.1:8792），让网关把**它真正要发出去的** body 与 headers 原样送过来。

### 3.2 结果

`messages` 数组**逐字未改**，一个字段都没多。差异**只有**这 5 个参数：

| 参数 | 值 | 为什么加 |
|---|---|---|
| `stream` | `true` | 官方 `/v2/chat/completions` **不支持非流式**（见 3.3） |
| `stream_options` | `{...}` | 流式要拿 usage |
| `thinking` | `{type: "enabled"}` | 上游是 reasoning 模型，不开会退化 |
| `reasoning_effort` | `"high"` | 同上 |
| `prompt_cache_key` | 派生值 | 前缀缓存复用（省 token/延迟） |

⇒ **转发无损，参数是有意增强。**

### 3.3 副产品：官方根本不给非流式

实测直连官方发 `stream:false` ⇒ **`400 code=11101 "Non-stream chat request is currently not supported"`**。

这反过来说明：网关出站强制 `stream:true` **不是"加料"，而是唯一能走的形态**。反过来说，任何 agent 走这条链路都必须支持 SSE 聚合。

---

## 四、第 2 层复验：多模型一致性对比

### 4.1 方法

同一个 token（`accounts/1d80c722-*.info` 解密取真实 accessToken），同一个 prompt，两侧同时打：

- **A 侧**：按 2.2 修好后的官方头族直连 `https://copilot.tencent.com/v2/chat/completions`
- **B 侧**：走网关 `http://127.0.0.1:7863`

两侧都 `stream:true`，各自把 SSE 聚合成正文再比。`max_tokens = 1200`（教训见 4.3）。

脚本：[`../.wd-tmp/compare-official-vs-gateway.js`](../.wd-tmp/compare-official-vs-gateway.js)

### 4.2 结果（`prompt_tokens` 上游自报）

| 模型 | 官方直连 | 走网关 | 差 | 判定 |
|---|---|---|---|---|
| 混元 **hy3** | 一致 | 一致 | 0 | ✅ 无注入 |
| **GLM 5.2** | 19 | 19 | **0** | ✅ **强证据** |
| **MiniMax M3.1 Flash** | 215 | 215 | **0** | ✅ **强证据** |
| **DeepSeek V4 Flash** | 17 | 43 | +26 | 🟡 见 4.4 |

4 个模型全部 HTTP 200，正文都正常返回。

### 4.3 两个踩过的坑（下次别重踩）

1. **`max_tokens` 给小了会被思考吃光** —— 第一次给 200，`completion_tokens == reasoning_tokens`，`content` 为空但 `finish_reason: "length"`。**这是静默失败**（HTTP 仍 200），很容易误判成"模型坏了"。给到 1200 才有正文预算。
2. 抓包服务器会被后台回收 —— 报 `dial tcp 127.0.0.1:8792` 就是它没了，重起即可。

### 4.4 那 26 个 token 怎么解释

**不是消息被塞。** 三个理由：

1. 抓包（第三节）直接看到 `messages` 逐字未改 —— 这是**直接证据**，优先于任何推测。
2. 如果网关真往上下文里塞了东西，**GLM 和 MiniMax 不可能精确等于 0 差**。同一份注入代码对所有模型生效，不可能只对 DeepSeek 生效。
3. DeepSeek 是这 4 个里对 `thinking` / `reasoning_effort` 最敏感的模型，上游会按这两个参数**自己套一层模板**（模板算在 `prompt_tokens` 里）。

⇒ 归因：**参数导致上游模板差异**，属于"参数有意增强"的副作用，不是伪造。

---

## 五、接 WorkBuddy 自己 vs 接别的 agent：有什么不同

> 这一节是**推断**（基于官方客户端行为 + 网关端点能力的分析），不是抓包实测。

### 5.1 接 WorkBuddy 自己（现状）

- 出站头**由我们构造**，能 100% 对齐官方 ⇒ 第 1 层干净。
- 请求形态**天然吻合**：官方客户端本来就发流式、单 system、带 thinking。
- 调用节奏吻合：一个 IDE 一个人，不会并发 8 路。

### 5.2 接别的 agent

| 差异点 | 为什么是特征 |
|---|---|
| **端点** | 官方只有 `/v2/chat/completions`。`/v1/chat/completions` 是网关自己造的**兼容层**，官方从不请求 —— 但这是网关侧的事，上游看不到，**无风险** |
| **参数组合** | 别的 agent 爱发 `temperature` / `top_p` / `n>1` / `max_tokens` 显式值 / 多条 `system` 消息 / `stop` 序列 —— 官方客户端**从不这样组合** |
| **非流式** | 官方直接拒绝（3.3）。能跑通非流的只有网关兼容层，说明请求是二手的 |
| **工具调用形状** | 各家 agent 的 `tools` schema 长得不一样；官方是固定形状 |
| **system prompt 长度** | 官方是短模板；Cline / Continue 这类会塞几千字 system |
| **节奏** | agent 会高频短请求、并行批处理；官方客户端是人类打字节奏 |

### 5.3 结论：怎么伪装

1. **只发官方会发的参数**：`stream:true`、单 `system`、不给 `temperature`/`top_p`/`n`。
2. **`tools` 用官方形状**，别把自家的 schema 直接透出去。
3. **压并发、拉开间隔**（Go 版已有 `minPickGap = 100ms` + 单调序号兜底）。
4. **`max_tokens` 别设太小** —— 见 4.3，会被思考吃光，是**静默**失败。
5. 记住第 5 层**改不掉**：只要不是 Chromium 发请求，TLS 指纹 / HTTP/2 SETTINGS / header 顺序就对不上。**别把"伪装"理解成"隐身"** —— 目标是「不主动露出马脚」，不是「无法识别」。

---

## 六、残余风险（改不掉 / 没敢动的）

| # | 项 | 现状 | 为什么不改 |
|---|---|---|---|
| R1 | TLS ClientHello / HTTP/2 SETTINGS / header 顺序 / 连接复用 | 与 Chromium 不一致 | 协议层以下，Go 的 `net/http` 决定了，除非换 uTLS 全套复刻 |
| R2 | `Origin` / `Referer` 是否该**彻底删掉** | 当前保留，只对齐了域名 | 官方 asar 零命中 ⇒ 大概率本来就不发；但直接删有未知风险（可能有防盗链校验）。**先消掉"自相矛盾"，不冒险删** |
| R3 | `/v3/config` 的 UA 仍是 `CodeBuddyIDE/4.12.0 CodeBuddy/4.12.0` | 未改 | 源码注释写明：改了这个端点会返回**不完整的能力列表**。功能性代价 > 指纹收益 |
| R4 | 内置默认版本段 `5.5.4` / `2.137.1` | 靠 config 覆盖 | 见待办 `T3` |

---

## 七、复现清单

| 用途 | 文件 |
|---|---|
| 多模型官方 vs 网关对比 | `.wd-tmp/compare-official-vs-gateway.js` |
| 出站头族实现（唯一真源） | `vendor/wb2api-go/internal/upstream/headers.go` |
| 归属头单测 | `vendor/wb2api-go/internal/upstream/client_test.go` |
| 编译 | `bash vendor/wb2api-go/build.sh` |
| 部署（四步，少一步等于白改） | 改源码 → build.sh → 停网关 → 覆盖 `%APPDATA%\WorkDaddy\gateway\wb2api.exe` → 重启 daemon |
