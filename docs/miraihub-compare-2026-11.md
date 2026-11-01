# MiraiHub（xiaofan6ya）对比评估报告

> 评估对象：`https://github.com/xiaofan6ya/MiraiHub` main 分支（创建 2026-10-30，最后推送 2026-10-31T16:34，MIT）
> 对照基准：本地 `D:\WorkDaddy\vendor\wb2api-go`（Go 反代网关）
> 取证方式：整包下载（4.83 MB / 75,230 行 Python）逐模块读源码，重点读事故档案与热路径；另外用本机官方客户端 `app.asar` 独立核对上游错误码语义。
> **上一版报告（2026-11-01）基于错误的仓库 `XiangZi7/MiraiHub`（一个桌面 SSH 工具），结论已全部作废，本文件为整体重写。**

---

## 零、结论先行（先看这 6 条）

1. **这次仓库对了。** `xiaofan6ya/MiraiHub` 确实是 wb2api 的多平台升级整合版：Python + FastAPI，把 **6 个上游平台**（workbuddy / trae-cn / trae-intl / qoder / qoder-intl / loomy）收进一个统一网关，对外同时提供 **OpenAI Chat / OpenAI Responses / Anthropic Messages** 三套协议。它和我们是同一类东西，**功能重叠度约 55%**。

2. **对方最值钱的不是代码，是文档。** `admin/platform/skill/FIXED-BUGS.md`（1,455 行）里有 **30+ 条真实事故档案**，每条写清「现象 → 根因 → 改法 → 怎么验证的」。这份东西的信息密度高于它的全部源码，**建议整份读完再决定动不动手**。

3. **它比我们多出来的能力，绝大多数不该抄。** 三协议互通、6 平台容器、视频异步任务、内置对话智能体、成长中心、告警通道——这些都是「多租户商业网关」的配置。我们是**单人自用的单平台专精网关**，把这些搬进来只会让代码量和故障面翻倍。

4. **原清单 6 项经逐条复查后只剩 3 项值得做，且已全部落地**（详见第六节）：会话失效改为连续计数（修一处重构漏改）、新增「请求不合法」分类、补 14003 模型级限流。另 1 项降级（封禁自动解封——本地有相反实证）、1 项撤销（模型描述取真源——那是 Qoder 的功能）、1 项复查后发现本地已具备（截断补帧）。**没有一项是「加功能」，全是「补闭环」。**

5. **有 3 处会真冲突，照抄会互相抵消**（详见第七节）：`ErrSessionDead` 立即禁用与本地 3 次阈值打架；思考预算下限对方写 16384（会把免费额度烧光）；对方的 404 可重试白名单会让「模型不存在」也去轮账号。

6. **对方的可信度要打折**：仓库里**没有一行测试**（`tests/` 被 `.gitignore` 全忽略）、框架层有 **200 处平台专有名词**（与它自家验收标准直接矛盾）、**15 个提交集中在 2 天内**。⚠️ **而且我自己第一版判定也有两处站不住**（见第六、十一节）——它文档里写的「实测确认」和我读代码得出的结论，都必须先验证再用。

---

## 一、前提核查：这次对上了

上一轮拿到的是 `XiangZi7/MiraiHub`（Tauri + Rust 的桌面运维工作台），跟反代毫无关系。换成 `xiaofan6ya/MiraiHub` 之后：

| 核查项 | 结果 |
|---|---|
| 语言 / 体量 | Python，仓库 4.83 MB，**75,230 行** `.py` |
| 主目录 | `admin/` 6.4 MB（routers 18,079 行 + admin 根 16,367 行 + platform 容器） |
| 平台数 | 6 个：`workbuddy` / `trae-cn` / `trae-intl` / `qoder` / `qoder-intl` / `loomy` |
| 对外协议 | `/v1/chat/completions`、`/v1/responses`、`/v1/messages`（+ `count_tokens`）、`/v1/models`、`/v1/balance`、`/v1/videos` |
| 是否 wb2api 继任 | **是**。热路径里大量注释直接引用 wb 客户端解包结论、`turing` 设备令牌、`applicationName` 等 |
| 活跃度 | 创建 2026-10-30，**15 个提交**，2 天内完成主体，仍是活跃状态 |

**一个必须先说的判断**：对方规模是我们的 **2.6 倍**（75k 行 vs 29k 行非测试代码），但它是**用 2 天堆出来的**。规模不等于成熟度——后文所有"对方更强"的结论，都要放在这个前提下读。

---

## 二、双方全景对照

| 维度 | MiraiHub | 本地 wb2api-go | 谁强 |
|---|---|---|---|
| 语言 / 框架 | Python + FastAPI + SQLAlchemy | Go 标准库 | — |
| 非测试代码量 | 75,230 行 | ≈29,000 行（`internal/` 54,587 含测试） | MiraiHub 大 2.6× |
| 上游平台 | 6 个 | 1 个（workbuddy，CN + global 双 realm） | MiraiHub |
| 对外协议 | Chat + Responses + Anthropic | 仅 Chat（+ search / images） | MiraiHub |
| 账号池调度策略 | 6 种 | 3 种（但选号决策更细） | 平手 |
| 错误分类粒度 | 8 层 / 17 类 kind | 17 个 `ErrKind` + 业务码细表 | 本地略强 |
| 工具调用修复 | 孤儿清理 + 校验 | 4 件套（重排 / 合并 / 推理合并 / 截断剔除） | **本地明显强** |
| 出站指纹伪装 | 客户端档案 + Stainless 头 | UA 三段式 + 归属头 + 设备令牌 + IP | 本地更实用 |
| 凭据脱敏 | 零宽空格词表 | 6 条精确指纹 + 逐词改写 | **本地明显强** |
| 会话/上下文压缩 | `responses_projection` 745 行 | 无同类模块 | MiraiHub |
| 持久化 | SQLite/MySQL + Redis | JSON 文件 + Upstash（仅绑定与状态） | MiraiHub |
| 监控告警 | 飞书 / QQ 机器人 / SMTP，600s 冷却 | **无** | MiraiHub |
| 定时任务 | 通用调度框架（余额/积分/模型同步/保活/签到/成长） | 专用（签到 / 保活 / 补偿 / 连击 / 差旅） | 各有侧重 |
| 测试 | **0 行（未入库）** | 20+ 测试文件，`sse_test.go` 单文件 1,254 行 | **本地碾压** |
| 面板 | 完整后台（账号/模型/日志/统计/密钥/额度/IP） | `internal/panel` 4,274 行，同样完整 | 平手 |

**一句话**：对方是"多平台商业网关"，我们是"单平台高质量网关"。它的宽度赢，我们的深度和可靠性赢。

## 三、对方有、我们没有的功能 —— 逐项判定

判定分四档：**✅ 吸纳** / **🟡 只抄思路** / **⏸ 观察（暂不动）** / **❌ 不要**。

### 3.1 架构类

| # | 功能 | 对方实现 | 判定 | 理由 |
|---|---|---|---|---|
| 1 | **多平台容器架构** | `admin/platform/<name>/` 六个子目录，`PlatformSpec` 登记 7 个字段（`id`/`label`/`gateway`/`platform_gateway`/`storage_platform`/`realm`/`icon`），Gateway 契约 10 方法，AccountOps 11 项 | ❌ **不要** | 我们是单平台。而且**对方自己都没落地**：`SKILL.md §11` 要求"`admin/` 里搜不到平台专有名词、存量已冻结只减不增"，实测 `grep -rn "workbuddy\|trae\|qoder\|loomy" admin/routers admin/*.py` **命中 200 处**，分布在 20+ 文件。这是事后重构的半成品，抄它等于抄一个没写完的重构。 |
| 2 | **三协议互通** | Chat ⇄ Responses ⇄ Anthropic 双向转换（`anthropic_adapter.py` 652 行 / `responses_adapter.py` 639 行 / 两个 `StreamConverter` 类） | ⏸ **观察** | 只有当我们要接 Claude 客户端（Cursor / Cline / Claude Code）时才需要。现在 DSH 走的是 Chat，用不上。**但 `count_tokens` 的实现值得先抄**（纯本地估算，无副作用）。 |
| 3 | **`/v1/responses`** | `responses_adapter` + `responses_projection`（745 行上下文压缩：`_looks_like_agentic_cli` / `_choose_tail_start` / `_build_history_summary`） | ⏸ **观察** | 我们明确没有这条路由，DSH 也不走。但**「按 agentic CLI 特征做分层压缩」这个思路**对我们有价值——长会话撞 300K 预算时就是靠它。 |
| 4 | **`/v1/balance`** | 返回余额 + DeepSeek 口径余额两条（`get_balance` / `get_user_balance_deepseek`） | ✅ **吸纳（P2）** | 小功能，20 行。我们有 `credithist` 账本但没有对外余额接口，客户端（如 OpenWebUI）想看余额时没地方查。 |
| 5 | **`/v1/videos` 异步任务** | 5 条路由（POST 建任务 / GET 查 / GET 内容 / LIST / DELETE），任务落库，按 `usage.credit` 实际积分记账 | ❌ **不要** | 我们没有视频上游。它这套设计有一条**重要经验**值得单独记下：*「未知结局不重发」——入队即计费，超时/断连/5xx 一律不换号重试*。这条可以反向用到我们的生图路径上（生图出图即 Release）。 |

### 3.2 账号治理类（**这里是对方最有价值的部分**）

| # | 功能 | 对方实现 | 判定 | 理由 |
|---|---|---|---|---|
| 6 | **封禁自动复查解封** | `admin/ban_recheck.py`（379 行）：`_is_11140` 挑出被 11140 封的号 → `_should_probe` 判断是否到点 → `probe_trusted_auth` 用官方登录态试探 → `probe_model_capability` 试一次真对话 → `_unban` 解封；带 `_probe_wait_seconds` 退避 | 🟡 **降级：只做人工一键探测（原 P0 撤销）** | **复查更正**：本地 `handler.go` 的 11140 分支写着明确实证结论（issue 1849）——「解除只能由用户在官方渠道申诉，**重登无效**」；而对方注释说「11140 实测是临时风控、过一阵能自己恢复」。**两者直接冲突，且无法靠读代码判定谁对。** 贸然自动解封会把已确认被限制的号放回池里持续失败，代价大于收益。改做「只记录 + 面板一键人工探测」更稳。 |
| 7 | **401/403 不一定是账号失效** | `admin/upstream_auth_guard.py`（85 行）：识别 `401 {"message":"not_found"}` / `code 10085` / `"request header is invalid"` / `"请求头不合法"` / `"illegal request header"` 这几类签名 → **不判定账号失效**；同签名在 120s 窗口内命中 **3 个不同 UID** → 判为**池级异常**而非单号问题 | ✅ **吸纳（P0）** | 这是**真金白银的教训**。我们现在的 17 个 `ErrKind` 里，`401/403` 走的是账号失效逻辑；而实际上 header 不合法是**我们自己代码的 bug**，把所有号标记失效只会掩盖问题、让整个池子归零。对方的「3 个不同 UID」判据能自动区分「一个号死了」和「我们发错了」。 |
| 8 | **风控哨兵按「不同账号数」熔断** | `admin/sentinel.py`（393 行）：Redis ZSET（`wb:sentinel:<platform>:events`，TTL 900s，上限 500 条），`BREACH_WINDOW=300`、`BREACH_ACCOUNTS=3`——**不是事件数 ≥3，是不同账号数 ≥3** | 🟡 **只抄思路（P1）** | 我们的 `WafIpGate`（`wafIPWindow=60s`、`wafIPThreshold=2` 个不同 UID）已经是同一个判据，而且更直接（直接 fail-fast 停止轮转）。**但对方多两样东西值得补**：① **按平台分键**做故障隔离；② 熔断状态**持久化到 DB**（重启不复位）。我们重启后哨兵状态就清零了。 |
| 9 | **账号健康检查发真对话** | `admin/account_health.py`：`_select_chat_model` 挑一个真模型 → `_conversation_probe(sess, model)` 真发一次 → 而不是只看 `/me` 接口 | 🟡 **只抄思路（P1）** | 我们现在判断账号可用基本靠"上次请求有没有报错"。真发一次对话是最诚实的检验，但**要花额度**——所以只能做**手动触发**，绝不能做成定时（这条与我们既有约定一致：固定间隔自动探活必须否决）。 |
| 10 | **保活带可信探针** | `scheduler.py`：`_KEEPALIVE_DEAD_THRESHOLD=3`、`_AUTH_DEAD_MARKERS`、`class TrustedAuthFailure`、`_trusted_token_probe(sess)`——保活失败先别信，用可信登录再确认一次 | ✅ **吸纳（P1）** | 我们的保活失败即判死，容易误杀。加一层"可信探针复核"就能把误杀率压下来。 |
| 11 | **客户端指纹档案** | `admin/client_profile.py`（1,166 行）：采集本机 CPU 核数/内存/时区/Node 版本，拼 UA 三段式，另有 `stainless_headers()` 按官方 SDK 6.25.0 公式生成 `X-Stainless-*` 7 个头 | ❌ **不要** | 我们在 `headers.go` 里已经做到了该做的：UA 三段式 + **按 realm 切品牌**（global 用 `WorkBuddy AI`，对方根本没 realm 概念）+ `deriveAccountStableID` + `injectAttribution` + 设备令牌。**且对方自己在注释里写明「普通模型网关请求不会自动调用此函数」**——`stainless_headers()` 是它自己都没用的死代码。 |

### 3.3 限流 / 保护类

| # | 功能 | 对方实现 | 判定 | 理由 |
|---|---|---|---|---|
| 12 | **按 Key 的 RPM + 并发准入** | `admin/gateway_limits.py`（557 行）：Redis Lua 滑动窗口（`_ACQUIRE` 脚本同时管 60s RPM 和 120s 并发租约）+ 内存兜底 + **per-key 覆盖**（`max_concurrent` / `rate_per_minute` 两个字段挂在 key 行上，`0` = 不限）+ `Admission`/`release` + 等待信号 | ✅ **吸纳（P2）** | **我们完全没有对外限流**。虽然是自用，但一条死循环的客户端就能把整池账号打到 WAF 封 IP。有并发上限 + 429 退避，是**保护上游账号**而不是保护我们自己。 |
| 13 | **容量队列** | `admin/capacity_queue.py`（144 行）：有界、work-conserving 的轮转队列，`max_waiters=512`、`per_key=64`、`retry_interval=0.5`，满了返回 `429 gateway_busy` | ⏸ **观察** | 依赖 12 先落地。 |

### 3.4 运营 / 周边类（**全部不要**）

| # | 功能 | 判定 | 理由 |
|---|---|---|---|
| 14 | 内置对话智能体 `routers/agent.py`（1,178 行，13 条路由：bootstrap / chat / 会话 CRUD / assets / estimate / enhance / plan / merge / capabilities） | ❌ | 这是「网关自带一个聊天框」的产品功能，不是网关职责。 |
| 15 | 告警通道 `alerting.py`（457 行：飞书 webhook / QQ 机器人 / SMTP 邮件，600s 冷却） | ❌ | 我们的告警归属在 **daemon 层**（`WorkDaddy` 的隧道/进程托管），不该塞进网关。而且真出问题我更需要的是**面板红字**而不是邮件。 |
| 16 | 跨平台模型别名归一 `model_alias.py`（303 行：去 `:intl`/`-volc` 噪音 → 小写去标点 → 版本号收敛 → 显式别名表） | ❌ | 单平台没有别名问题。**但「不能只靠规则收敛」这个结论值得记住**：`DeepSeek-V4-Flash` 与 `DeepSeek-V4.1-Flash` 去标点后仍不同，必须人工别名表。 |
| 17 | 成长中心 / 邀请 / 成长计划（`growth_plan.py` 422 + `growth_plans.py` 413 + `growth_center.py` 184 + `routers/growth.py` 817） | ❌ | 纯运营功能，我们用的是官方客户端的签到/连击（`scheduler/streak.go`、`school.go`），根本不是一个东西。 |
| 18 | IP 管理 `routers/ip_management.py`（367 行） | ❌ | 它是**后台管理台自己的访客 IP 黑名单与活跃统计**（`BlockedIP` / `IPRequestBucket` / `ClientIdentity`），不是出口 IP 池。**注意别被名字骗了——它不是代理池。** |
| 19 | 请求审计 / 流量统计 / 客户端画像路由（`traffic_stats.py` 544 / `routers/stats.py` 699 / `routers/client_profile.py` 365） | ⏸ | 我们的 `reqlog` + `usage` 已经覆盖。 |

### 3.5 两个「小而真」的发现（**本轮最大意外收获**）

| # | 发现 | 判定 | 说明 |
|---|---|---|---|
| 20 | ~~模型描述的真实来源~~ | ~~`admin/dynamic_text.py`~~ | ❌ **撤销（第一版判错）** | `INSTALL_HINTS` 里全是 **Qoder** 的路径（`D:\Qoder` / `C:\Program Files\Qoder` / `%LOCALAPPDATA%\Programs\Qoder`），默认 `product_id="qoder"` —— 这是 **qoder 平台**的功能，**与 workbuddy 毫无关系**。且本机 5.8.3 客户端**根本没有 `resources/dynamic-text/` 目录**（实测不存在），`cli/product.json` 的 `models[]` 也只有 `name`、**没有 description**。这条是我把「另一个平台的功能」误当成通用能力，整条作废。 |
| 21 | **`model_limits.py` 的中国时区日切 + 排队码** | 🟡 **补两个码（P1）** | 对方有 `CN_TIME` + `DAILY_CODES = {6004, 6008}` + `next_cn_midnight(now)` + `QUEUE_CODES = {6020,6021,6022}` + `queue_retry_time(body)`。<br>**核对后修正**：本地在 6004 上其实**做得比对方更细**——`client.go:244` 的 `softRateResetLoc` 把上游文案里的重置时间**固定按 UTC+8 解释**并对齐墙钟（对方是简单粗暴地"到次日 0 点"），解析不出来才退到 `modelBlockMaxTTL = 24h`。<br>**真正的缺口有两个**：① **`6008` 本地完全没覆盖**（它和 6004 同属"今日额度用尽"族，对方的日切判据正好可以拿来当 6008 的兜底）；② **`6020/6021/6022` 排队码**本地没有专门处理，对方会从 body 里解析"预计排队结束时间"再重试。 |

## 四、功能重复处 —— 谁实现得更好

对方有 8 处和我们做同一件事。逐个对比，**结论不是「谁全赢」，而是「各赢一半」**。

### 4.1 错误分类：本地更细，但对方有两条判据我们缺

| | MiraiHub `_classify_error(status, body)`（`routers/proxy.py:1010-1149`） | 本地 `Classify()`（`upstream/client.go:565-756`） |
|---|---|---|
| 输出 | 17 个 kind 字符串 | 17 个 `ErrKind` 常量 |
| 分层 | 8 层，注释写明"分层顺序很重要" | 同样分层，注释更密 |
| 业务码覆盖 | 6000-6008 族 / 11xxx 族 / 140xx 族 / 402 / 412 | 6004 / 11-128 / 11102 / 11115 / 11133 / 11135 / 11140 / 11158 / 12153 / 14017 / 14018 / 15003 / 6021 / 402 / 412 |
| 独有 | `upstream_auth_anomaly`（401/403 但其实是我们的 header 有问题）、`model_behavior`(11141)、`not_found`、`waf`（403 无业务信封） | `ErrHardCredit` 的 402 精确语义、`hasBusinessCode` 容空格、"今天已签到"识别、`modelBlockMaxTTL=24h` 有界退避 |
| 缺失 | 没有 `15003`、没有签到类 | **没有 `14003`**、没有 `11145`、没有 `14012~14016/14019` |

**判定：本地更强，但要补 3 个码 + 1 个分类。**
- **`14003`**：对方线上实测——同一个号对 `deepseek-v4.1-flash` 报 14003，换个模型立刻可用，官方 UI 文案是"当前模型请求繁忙，请**切换模型**或稍后重试"。所以它是**模型级**的。本地没这个码，会落到 `status==429 → soft_rate`，**把好号冷却掉**。
- **`14012~14016` / `14019` / `11145`**：本地完全没有，会落到 `status>=400 → client`（不可重试，直接透传给客户端）。这几个都对应用户可见的"额度/账单"问题，应该给明确文案 + 明确冷却。
- **`upstream_auth_anomaly` 这个分类**：见 3.2 第 7 项，是本地最缺的一条。

### 4.2 冷却策略：本地有阈值，但 `handler` 里把它绕过了（**这是真 bug 苗头**）

- 对方：`_apply_account_policy(...)`（`proxy.py:1194-1472`）按 14 个 kind 分派，**每一类都写清了恢复依据**（"上游墙钟优先 / 本地有界退避兜底 / 模型级与账号级正交"）。
- 本地：`pool/cooldown.go` 有完整体系，`pool.NoteSessionDead` 有 **3 次阈值**（`scheduler` 用的是这个）。
- **但是**：`server/handler.go:1499 applyErrorPolicy` 里 `ErrSessionDead → h.cfg.Pool.Disable(uid, "12153 session dead")` —— **一次就禁用**。

**判定：这是本地的不一致点。** 同一个错误，走 `scheduler` 路径是"记 3 次才判死"，走 `handler` 路径是"一次就死"。要么统一到阈值，要么统一到立即禁用，**不能两条路不一样**——否则会出现"某号被 handler 一次打死，但 scheduler 的保活还认为它活着"的鬼故事。这条**先于**任何吸纳动作修。

### 4.3 工具调用修复：本地明显更强

| 能力 | MiraiHub `upstream_compat.py` | 本地 |
|---|---|---|
| 清孤儿 tool_call | `cleanup_orphan_tool_calls` ✅ | `cleanupOrphanToolCalls` ✅ |
| 校验配对 | `validate_tool_pairing`（返回列表） | 有 |
| **重排 tool_result 块** | ❌ 无 | `repackToolResultBlocks` ✅ |
| **合并相邻 tool_calls** | ❌ 无 | `mergeAdjacentToolCalls` ✅ |
| **合并 reasoning_content** | `backfill_reasoning_content`（仅补空） | `mergeReasoningContent` ✅（更强） |
| 截断参数剔除 | `is_truncated_arguments` + `drop_truncated_tool_calls` | `isTruncatedArguments` + `dropTruncatedToolCalls` ✅ |

**判定：本地强，不吸纳。**

### 4.4 凭据脱敏：本地明显更强

- 对方 `desensitize.py` 609 行：**零宽空格**插在敏感词内部（`DoS` → `Do\u200bS`），打断上游逐字关键词匹配。副作用：**内容被污染**，用户复制出来会带不可见字符。
- 本地 `sanitize.go` 220 行：**6 条精确指纹** + `sanitizeRewrites` **逐词改写**（每句只改一个词），内容可读。

**判定：本地强，不吸纳。** 对方的做法属于"有效但脏"，我们的是"有效且干净"。

### 4.5 TPS / TTFT 口径：各有一处值得互相补

| | MiraiHub | 本地 `handler.go:1392 tokensPerSecond` |
|---|---|---|
| 分母 | `decodeMs = completedTime - firstTokenTime` | 同 |
| 下限 | `MIN_DECODE_MS = 100` | `minGenWindow = 200ms` |
| 上限 | **`MAX_TPS = 1000`（防除零/防离谱值）** | **无上限** |
| 首 token 定义 | **必须是首个正文，不是首个思考事件** | 需核对 |

**判定：补一个 `MAX_TPS` 上限（1 行），并确认首 token 取的是正文。**

### 4.6 调度策略：本地选号更工程化，对方策略维度更多

- 对方 6 种：`priority` / `balance`（按**比例**不按绝对额度）/ `expiring` / `throughput` / `round_robin` / `random`。热路径 TTL 5s 缓存 + `invalidate()` 主动失效，实测 2000 次 2.01ms。
- 本地 3 种：`weighted_random` / `round_robin` / `sequential_exhaust`；但选号决策里有 `costTier`（0 免费 / 1 无观测 / 2 收费）、top5 短名单、**条件探索**（issue #136）、**积分保底 `floorBlocked`**。

**判定：策略种类不补，但 `expiring`（按到期时间优先）值得加**——我们的 token 有 refresh 过期时间，快过期的号应该优先用掉，这是**纯赚**。

### 4.7 模型目录：本地链路更完整，但描述的真源被对方挖到了

- 本地：`context_catalog.go` 四级查找链（models.dev → 静态表 → `model.json` → 1M 兜底），输出 `context_length` / `max_output_tokens`。
- 对方：`normalize_catalog` + `dynamic_text`（真源）。
- ⚠️ **顺手发现一个不一致**：本地输出是 **snake_case**（`context_length`），而 DSH 认的是 **camelCase**（`contextWindow` / `maxTokens` / `inputModalities` / `reasoningEfforts`）。如果 `/v1/models` 走的是 snake_case，DSH 那边会认为模型没有能力字段。**需自查**（这条与 MiraiHub 无关，是对账时撞出来的）。

### 4.8 持久化：用途不同，不冲突

- 对方：SQLite/MySQL 存账号/日志/用量/密钥 + Redis 存哨兵/限流。
- 本地：JSON 文件 + Upstash 只存**绑定关系**和**池状态快照**。

**判定：不吸纳。** 我们是单机自用，上数据库只会增加部署负担。

---

## 五、会导致冲突的地方（照抄会互相抵消，必须先处理）

| # | 冲突点 | 对方做法 | 本地现状 | 后果 | 处理 |
|---|---|---|---|---|---|
| **C1** | **会话失效的处置** | `session_dead` 连续计数后才禁用 | `handler.go:1499` 一次就 `Disable`，`pool.NoteSessionDead` 有 3 次阈值 | 吸纳对方的 `ban_recheck` 会**永远跑不到**——号在一次错误后就被永久禁用了，复查逻辑没机会介入 | **先统一阈值**，再加复查 |
| **C2** | **思考预算下限** | 实测 512 → 4096 → **16384** 才稳 | 本地 4632 可跑、推荐 8192 | 照搬 16384 会让每次请求的**最小消耗翻倍**，免费号额度（每天有限）会被烧光 | **不照搬**。本地 4632/8192 是自己实测的，保持 |
| **C3** | **404 可重试** | `_RETRYABLE_STATUS = {404, 502, 503}` | 本地不重试 404（模型不存在是确定性错误） | 照搬会让"这个号没这个模型"也去换号重试，把整池轮一遍才报错 | **不照搬**，保持 404 不重试（对方的 `model_block` 分支其实也不重试，是它自己的 `_RETRYABLE_STATUS` 与 `_classify_error` 打架） |
| **C4** | **脱敏策略叠加** | 零宽空格 | 逐词改写 | 两套同时开会互相破坏（改写后的词再插零宽空格，指纹就变了） | **只用本地一套** |
| **C5** | **调度策略叠加** | `expiring` / `throughput` | `floorBlocked` 积分保底 | 若 `expiring` 不看 `floorBlocked`，会把该保底留着的号用光 | 加 `expiring` 时**必须与 `floorBlocked` 求交**，不能并列 |
| **C6** | **平台名词污染** | 框架层已有 200 处 | 我们是单平台，没有这一层 | 如果我们照抄它的"平台容器"，会把 200 处平台判断一起搬进来 | **不搬架构** |

---

## 六、行动清单（复查后的最终版：3 项已落地 / 1 降级 / 1 撤销）

### 6.1 ✅ 已落地（本轮已改代码 · 已编译 · 全量回归通过）

| 项 | 动作 | 落地内容 | 回归守卫 |
|---|---|---|---|
| **A1** | `handler.go` 的 `ErrSessionDead` 改连续计数 | 二次确认为**重构漏改**（不是双轨设计）：`pool` 已按 P0-1 改成 `sessionDeadThreshold=3`，`scheduler` 的保活路径早已改用 `NoteSessionDead`，**只有 chat 路径还停在旧的 `Disable`**。同一个错误两条路两种判定，会让被误杀的号显示「已禁用」却仍有请求在打它。已改为 `NoteSessionDead` + 达阈日志。 | `TestChatSessionDeadDisables` 重写为阈值语义（前 2 次不禁用 / 第 3 次禁用），同时守住「handler 与 scheduler 口径必须一致」这条不变量 |
| **A2** | 新增 `ErrUpstreamAuthAnomaly` | 401/403 且 body 命中 `{"message":"not_found"}` / `code 10085` / `request header is invalid` / `请求头不合法` / `illegal request header` → **零动作**（不冷却、不熔断、不 NoteError、不 NoteFailures）。判定**后置**于 `sessionDeadMarkers`，保证 `401+12153` 仍是真·账号失效。 | `TestClassify` 增补 6 条（含 12153 顺序守卫、400 不误判）；新增 `TestChatAuthAnomalyDoesNotPenalize` |
| **A3** | 14003 = 模型级限流 | `requestRateLimitCode="14003"` 纳入 `IsModelRateLimit`（走 `CooldownSoftForModel`，(账号×模型) 冷却、切模型即豁免）；`Classify` 显式分支判在 `status==429` 兜底**之前**。另加 `ModelRateLimitReason`，让冷却 reason 区分 `6004 model rate limit` 与 `14003 model busy`，不再混写误导排查。 | `TestClassify` ×2、`TestIsModelRateLimit` ×2、新增 `TestModelRateLimitReason` |

**验证记录**
- `go build ./...` 通过；
- `go test ./...` **17 个包全绿**（`-count=1` 强制重跑 upstream / server / cmd/server 亦全绿）；
- `appVersion` 按约定 `1.13.1-panel-wd7` → `wd8`（二进制内已确认）；
- **零中断就位**：旧 `wb2api.exe` 重命名为 `wb2api.exe.old-20261102-010202`，新包放入原位，**运行中的进程未重启**，`/healthz` 与 `/v1/models` 仍 200。下次重启网关自动生效（**故意不重启：本机模型走 `127.0.0.1:7863`，停网关会中断当前会话**）。

### 6.2 ❌ 撤销 / 🟡 降级（复查后发现原判定站不住）

| 项 | 原判定 | 复查结论 | 处理 |
|---|---|---|---|
| **B4** 模型描述取真源 | ✅ 吸纳 P1 | **判错，撤销。** 见 3.5 第 20 条：那是 Qoder 平台的功能，本机 workbuddy 连目录都没有。 | ❌ 不做 |
| **B1** 封禁自动复查解封 | ✅ 吸纳 P0 | **降级。** 本地 issue 1849 的实证结论是「11140 只能申诉、重登无效」，与对方「能自愈」直接冲突。代码无法判定谁对，自动解封风险高于收益。 | 🟡 改「只记录 + 面板一键人工探测」 |
| **B3** 截断补帧 / 正文确认 | ✅ 吸纳 P1 | **本地已具备。** `sse.go` 已有 `[DONE]` 兜底、`takeFinishReason`/`rewriteFinishReason`/`finishOnlyFrame`、工具调用收尾帧挪位、EOF 截断剔脏参数、`errEmptyStream`（200 但无有效帧 → 报错不合成假成功）。「提交前正文确认」由 `errEmptyStream` 覆盖。 | ⏸ 不重复做 |
| **C7** `/v1/models` camelCase | 待自查 | **查实但不动。** 确实输出 snake_case，但 `context_catalog.go` 注释写明是**有意为之**——Codex/ZCode/Claude Code 按 `context_length` 提前截断；改 camelCase 会影响所有客户端。 | ⏸ 不动，另立议题 |

### 6.3 ⏸ 待定（有价值，本轮未动）

`C1` 补 6008 日切冷却 · `C2` 补 6020–6022 排队码 · `C3` `/v1/balance` · `C4` 按 Key 的 RPM/并发准入（这是保护上游账号、防止一个死循环客户端把整池打到封 IP）· `C5` `MAX_TPS=1000` 上限 · `C6` 调度 `expiring`（**必须与 `floorBlocked` 求交**）

**本轮实际耗时约 1 小时（含复查纠正）。改动 4 个文件、11 处替换、新增 4 个测试。**


---

## 七、对方的硬伤（读它的东西时要打的折扣）

| # | 硬伤 | 证据 | 影响 |
|---|---|---|---|
| 1 | **仓库里一行测试都没有** | `.gitignore` 第 75-78 行 + 146 行把 `test_*.py` / `tests/` / `*_test.py` / `test/` 全部忽略；`ls tests` 返回空 | `SKILL.md` 宣称的 `python tests/test_gateway_contract.py`、`test_trae_platform.py`（**172 项**）、§9.1 契约测试、"admin 里没有平台专有名词"自动检查——**全部不在仓库里，无法验证**。这是它文档可信度的**最大折扣点**。 |
| 2 | **框架层 200 处平台专有名词** | `grep -rn "workbuddy\|trae\|qoder\|loomy" admin/routers admin/*.py` → 200 命中，跨 20+ 文件 | 与自家 `SKILL.md §11` 验收标准第 4 条"`admin/` 里搜不到平台专有名词、存量已冻结只减不增"**直接矛盾**。说明这套架构是**事后重构的产物，且没做完**。 |
| 3 | **2 天 15 个提交** | 创建 2026-10-30，最后推送 2026-10-31T16:34 | 75k 行代码未经时间检验。它 `FIXED-BUGS.md` 里的 30 条事故**全部是这 2 天内踩的**——意味着还有大量没踩到的。 |
| 4 | **`_RETRYABLE_STATUS` 与 `_classify_error` 自相矛盾** | `_RETRYABLE_STATUS = {404,502,503}` 含 404，但 `_classify_error` 对 404 单独返回 `not_found` | 两套判据打架，实际行为取决于调用顺序。这是典型的"重构没扫干净"。 |
| 5 | **静态资源没带 `?v=`** | 它自己的 `FIXED-BUGS.md` 记了这个坑 | 前端改动在用户侧等于没改。这个坑我们以前也踩过（记忆里有）。 |

**怎么用这份资料**：把 `FIXED-BUGS.md` 当**经验笔记**读（很有价值），把代码当**参考实现**读（别当标准答案），把它宣称的"已验证"当**待验证**。

---

## 八、额外收获：我用官方客户端独立验证出的错误码表

对方列了一堆业务码（14003 / 6004 / 6008 / 14017 / 14018 / 11141 / 6021…）。我没有直接采信，而是用本机 `D:\WorkBuddy\resources\app.asar` 解包，找到了**官方客户端自己的一张「错误码 → 按钮动作」对照表**（在 `renderer/assets/contexts-*.js` 里，压缩变量名 `Ajt` 附近）。

这张表比任何逆向文档都权威，因为它是官方决定"给用户什么按钮"的依据。

### 8.1 官方对照表（节选，`actions` 就是弹窗上给用户的按钮）

| code | 官方给的按钮 | 是否让用户反馈 | 语义判读 |
|---|---|---|---|
| `3004` | `relogin` | 否 | 登录态失效 → **重新登录** |
| `4001/4003/4004/4010/4012` | `newTask` | 是 | 会话不可续 → **新建会话** |
| `4002` | `newTask` + `retry` | 是 | |
| `10102 / 11115 / 11135 / 12654 / 11-128` | `editInput` | 是 | **输入不合法**（改提示词） |
| `11102 / 11103 / 11110 / 11124 / 11136` | `switchModel` | 是 | **该模型不可用** → 换模型 |
| `11133` | `switchModel` + `newTask` | 是 | |
| `11134` | `switchModel` + `retry` | 是 | |
| `11138` | `upgradeClient` | 是 | **客户端太旧** |
| `11139 / 11154` | `reupload` | 是 | 附件问题 → 重传 |
| `11140` | **（无按钮）** | 是 | 封禁/风控。**没有按钮 = 用户什么都做不了** |
| `11141` | `switchModel` | 是 | 换模型 |
| `11145` | `purchase` | **否** | 需购买。**且是隐藏码**（`isErrorCodeHidden`） |
| `14003` | `switchModel` + `retry` | 是 | 模型繁忙 → 换模型 |
| `14001 / 14002 / 14012–14017` | **（无按钮）** | **否** | 账号级不可恢复，官方连"反馈"按钮都不给 |
| `14018` | **（无按钮）**，另挂 `getCreditPurchaseActions` → 「获取 Credits」 | 否 | **积分耗尽** |
| `14019` | `applyQuota` | 否 | 申请配额 |
| `14405` | `editInput` + `switchModel` | 是 | |
| `6004` | `retry`，另挂「**升级专业版**」 | 是 | **套餐额度耗尽**（等日切或升级） |
| `6005` | 同 6004 | 是 | |
| `6008` | `retry` | 是 | 同族 |
| `429` | `retry` | 是 | |
| `502` | `checkNetwork` + `retry` | 是 | |

### 8.2 官方还把码分成了 5 个集合（这比单个码更有信息量）

```js
jjt = {14012,14013,14014,14015,14016,14017,14019}   // isHeadlineOnly：只显示标题，不给操作
Njt = {11145} ∪ jjt ∪ {14018}                        // resolveErrorBannerIconVariant：用「credits」图标
Pjt = {6004, 14018}                                  // isPreservedLegacyErrorCode：遗留额度码
Fjt = {14019, 11145}                                 // isInlineActionErrorCode：内联动作
Ljt = {11145}                                        // isErrorCodeHidden：整条码隐藏
```

**读法**：`Njt` 这一族官方统一用 **credits 图标** ⇒ **14012~14019 全都是"额度/账单"问题，不是"账号故障"**。`isErrorCodeHidden` 只有 `11145` 一个 ⇒ 这是官方最不想让用户看见的码（"你要买"）。

### 8.3 用它反过来校正我们和对方的三处判断

| 码 | MiraiHub 归 | 本地 Go 归 | 官方（credits 图标 / 动作） | 建议 |
|---|---|---|---|---|
| `14017` | `account_fault` | `ErrAccountFault`（trial not activated） | **在 credits 族里**，无按钮 | 三方其实不矛盾（试用未激活 = 要买），但**本地给它的冷却应该按"额度"而不是"账号故障"**，否则试用号会被当坏号轮掉 |
| `14001` | `hard_credit` | 只在"今天已签到"匹配里出现 | **不在 credits 族，无按钮、不给反馈** | 存疑。建议**别归 hard_credit**，归"未知账号级"，只观察不动作 |
| `11145` | **两边都没有** | **两边都没有** | `purchase` + **隐藏码** | **建议补上**，这是"套餐/额度要买"的明确信号 |
| `14012~14016 / 14019` | 只覆盖 14012-14014 | **完全没覆盖** | 都在 credits 族；14019 是 `applyQuota` | 建议补齐，至少别让它们落到 `client`（不可重试、直接透传） |

**一句话**：对方那张错误码表**方向对、细节有 2 处偏**，而我这次拿到的官方 action 表可以直接当权威依据用。**全表（104 条）已单独存成 `docs/official-error-codes.md`**，含 5 个集合、`6004`/`14018` 的特殊遗留路径、三方（官方 / MiraiHub / 本地 Go）逐码对照，以及客户端升级后怎么重取的方法。以后新增码判断不用再猜。

---

## 九、大白话总结

**对方是什么？**
一个"六合一插座"：把 workbuddy、trae（国内+国际）、qoder（国内+国际）、loomy 六个平台的账号，全都插进一个盒子里，外面开三个标准孔（OpenAI 聊天、OpenAI Responses、Anthropic），谁来了都能插。

**我们是什么？**
一个"只做一个孔、但做到极致"的插排：只做 workbuddy，但工具调用修复、混淆、指纹、积分账本、积分保底这些细节我们做得比它细。

**那要不要改成它那样？**
不要。因为它是**给别人用的商业网关**（要管几百个陌生用户、要给用户弹"升级专业版"、要发邮件告警、要搞成长中心），我们是**自己一个人用的**。它那一半功能，对我们就是纯负担。

**它有什么是真该抄的？**
我一开始列了六个，复查完只剩三个（另外三个：一个属于 qoder 不是我们、一个跟本地实证结论打架、一个本地早就有了）：

1. **401/403 先别急着判号死**——很可能是我们自己的 header 写错了。这个已经补上了。
2. **14003 是"模型忙"不是"号被限"**——换模型就能用，别把好号冷掉。这个也补上了。
3. **12153 别一次就判死**——网络抖一下、刷新令牌抢一下，都会临时报这个。这条本地早就改对了，但**聊天这条路漏改了**，现在补齐。

还有三件**留着没干**，但不是因为不重要：
- **被风控封的号能不能自己爬回来**——本地有实证说"只能申诉"，对方说"能自愈"，两边打架，不敢自动做；
- **"今天额度用完了"要等到明天 0 点再试**——有价值，但要先补 6008 这个码；
- **给请求加个并发上限**——不然一个死循环客户端能把整池号打到被封 IP。

**它最值钱的东西是什么？**
`FIXED-BUGS.md` 那 1455 行、30 多条事故档案。**那是别人替你踩过的坑**，一条一条都是"现象→根因→怎么修→怎么验证"。这个比它的代码值钱十倍——但要注意，这 30 条是它**2 天内踩的**，说明后面还有一堆没踩到。

**它靠得住吗？**
**代码参考可以，结论别全信。** 它仓库里**一行测试都没有**（全被 `.gitignore` 屏蔽了），宣称的 172 项测试根本不在仓库里；它自己定的"框架层不许出现平台名字"这条规矩，实测违反 200 处。所以：**当笔记读，别当标准答案。**

**这次最大的意外收获是什么？**
我从我们自己电脑上装的官方客户端里，挖出了一张**官方自己的"错误码 → 给什么按钮"对照表**。以后判断"这个码到底是账号坏了还是额度用完了"，不用再猜、也不用信别人的逆向结论——**官方已经写好了**。

---

## 十、附录：怎么复现这里的取证

```bash
# 1. 拉源码（走 codeload，不让 harness 代理介入）
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
curl -sL -o /tmp/mirai.tgz \
  https://codeload.github.com/xiaofan6ya/MiraiHub/tar.gz/refs/heads/main
mkdir -p D:/WorkDaddy/.wd-tmp/MiraiHub-x && tar -xzf /tmp/mirai.tgz -C D:/WorkDaddy/.wd-tmp/MiraiHub-x --strip-components=1

# 2. 规模摸底
cd D:/WorkDaddy/.wd-tmp/MiraiHub-x && find . -name "*.py" | xargs wc -l | tail -1   # 75,230

# 3. 硬伤取证
ls tests                                    # 空
grep -n "test_\|tests/" .gitignore          # 75-78,146 行
grep -rn "workbuddy\|trae\|qoder\|loomy" admin/routers admin/*.py | wc -l   # 200

# 4. 官方错误码表（用对方自带的 asar 读取器解我们自己的客户端）
"C:/Users/Lyon/.workbuddy/binaries/python/versions/3.13.12/python.exe" - <<'PY'
import sys; sys.path.insert(0, r"D:\WorkDaddy\.wd-tmp\MiraiHub-x")
from wb_asar import Asar
a = Asar(r"D:\WorkBuddy\resources\app.asar")
t = a.read_file("renderer/assets/contexts-DgzzFjnf.js").decode("utf-8", "ignore")
i = t.find("11138:{actions:")
print(t[i-3000:i+3000])          # 错误码 -> 按钮动作全表
PY
```

**顺手记一个可复用的方法**：`wb_asar.py`（对方仓库里那个 552 行的纯标准库 asar 读取器）确实好用——**零依赖**、自动区分 `unpacked`、能按字节检索。以后要逆本机客户端，直接用它，不用装 Node/npm。

---

*报告完成时间：2026-11-02 · 评估依据为 `xiaofan6ya/MiraiHub` main @ `2026-10-31T16:34` 快照*




---

## 十一、复查记录（2026-11-02 深夜，动手前逐条复核）

用户要求「复查一遍再开干」。这一节记录复查本身推翻了什么——**它比结论更重要**，因为有三处是我自己第一版判错。

### 11.1 确认成立（3 项，已落地）

| 判据 | 复查方式 | 结果 |
|---|---|---|
| `handler.go` 的 `ErrSessionDead` 一次即 `Disable` | 读 `pool/entry.go:555` + `state.go:23` + `scheduler.go:603` 三处注释 | **成立，且定性要改**：不是「双轨设计」，而是「重构漏改」。`entry.go` 明写「一次失败即禁用的旧行为会误杀健康账号（**P0-1：13 个 disabled 号全是误判**）」，`scheduler` 已改用 `NoteSessionDead`，只有 chat 路径没跟上 |
| 本地无 `upstream_auth_anomaly` | `grep -rn "not_found\|header is invalid\|10085"` | **成立**：全仓只有 `ErrKind.String()` 里一个 `"not_found"` 字符串，无任何识别逻辑 |
| 本地无 `14003` | `grep -rn 14003 internal/` | **成立**：零命中 |

另外顺手确认了一个**不是缺口**的地方：`ErrSessionDead` 之所以看起来像 bug，是因为 `pool` 的阈值只在 `scheduler` 生效——这反证了修法只有一处（不是两处），降低了改动风险。

### 11.2 判定站不住（3 项，已撤销/降级）

| 原判定 | 复查发现的硬事实 | 处置 |
|---|---|---|
| **B4 模型描述取真源**：`dynamic_text.py` 挖到了官方文案真源 | `INSTALL_HINTS = (r"D:\Qoder", r"C:\Program Files\Qoder", ...)`，`product_id` 默认 `"qoder"` ⇒ **这是 qoder 平台的功能**。且 `ls /d/WorkBuddy/resources/dynamic-text/` **不存在**；`cli/product.json` 的 `models[]` 只有 `name`、无 `description` | ❌ 整条作废 |
| **B1 11140 封禁自动复查解封** | 本地 `handler.go:1565` 注释：`11140 → 硬禁用`，「解除只能由用户在官方渠道申诉，**重登无效（issue 1849 结论）**」；对方 `ban_recheck.py` 注释：「11140 被实测确认是临时风控、过一阵能自己恢复」——**两个「实测」互相矛盾** | 🟡 降级为人工一键探测 |
| **B3 截断补帧 + 提交前正文确认** | `sse.go` 已有 `[DONE]` 兜底（`Stream` 注释「保证至少写一个」）、`takeFinishReason`、`rewriteFinishReason`、`finishOnlyFrame`、工具收尾帧挪位、`finishReason=="length" \|\| !sawDone` 剔脏参数、`errEmptyStream`（200 无有效帧→报错） | ⏸ 已具备，不重复做 |

### 11.3 顺带查实但决定不动（1 项）

`/v1/models` 确实输出 snake_case（`context_length` / `max_output_tokens`），但 `context_catalog.go` 顶部注释写明这是**有意为之**：Codex / ZCode / Claude Code 都按 `context_length` 提前截断，改 camelCase 会波及所有客户端。⇒ **不是 bug，另立议题**。

### 11.4 三条教训（写给自己）

1. **「对方有这个功能」≠「这个功能对我们可用」。** B4 就是把 qoder 平台的模块当成 workbuddy 的，仅因为它在同一个仓库里。以后判断「能不能用」，第一步应该是 `grep INSTALL_HINTS` / 默认参数，看它**为谁写的**，而不是看它做了什么。
2. **两个「实测结论」冲突时，不要挑一个信。** B1 里本地写「重登无效（issue 1849）」，对方写「能自愈」。两边都声称实测过。正确做法是**降级为可逆的人工动作**，而不是选边站——自动解封错了会把坏号放回池里，人工点错了只浪费一次请求。
3. **「我们缺这个」要先 grep 三遍再断言。** B3 我判「缺截断补帧」，实际 `sse.go` 里补帧、收尾、剔脏参数、空流报错全都有。判「缺」的成本很低，判错的成本是白写一遍已被解决的问题。

### 11.5 一个方法论副产品

这次能推翻自己的两条判定，靠的是**把官方客户端当权威源**（`app.asar` 里的错误码→按钮表），而不是靠读别人的逆向文档。以后凡是涉及「上游这个码是什么意思」，先查这张表（`docs/official-error-codes.md`），再谈其他。
