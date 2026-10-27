# 已办 / 待办总清单

> **时间基线**：2026-10-27　**对照版本**：本仓 v1.9.7（`DAEMON_BUILD_ID = release-1.9.7-20261014-upstream-1214-probe-recursion-r1`）
> **覆盖面**：上游 1.2.16 / 1.2.18 吸纳 · 插件自研修复 · 反代网关自维护 · 反代指纹取证。**不含** v1.9.1 及更早的历史（见 `CHANGELOG.md`）。
> **状态口径**：✅ 已落地**且有验证** ／ 🟡 已落地待验证 ／ ⬜ 未开始 ／ ⛔ 判定不做（理由必写）

---

## 一、上游吸纳账（1.2.15 → 1.2.18）

承接规则：**不拿上游文件覆盖本地**，一律 `git merge-file` 三方合并（base = 上游旧版原文），定性靠逐字节 diff。`UPSTREAM_VERSION` 已同步为 `'1.2.18'`。

### 1.1 已吸纳

| # | 功能 | 上游版本 | 状态 | 落点 | 关键点 |
|---|---|---|---|---|---|
| A1 | **启动环境隔离（防自动升级）** | 1.2.16 | ✅ | `scripts/workbuddy-launch-env.js`（新建） | 把客户端子进程的 `TEMP/TMP` 改到 `<dataDir>/client-tmp/<profileId>`，并钉住 `WORKBUDDY_UPDATE_URL`。**只钉 URL 拦不住** —— 官方 Windows updater 会在检查 feed 之前**恢复缓存的 Setup.exe**（上游 #424），所以必须换 TEMP。双路接线：`win-launcher.launchWorkBuddy` + `daemon.relaunchWorkBuddy` |
| A2 | **client-tmp 定时回收** | 自研配套 | ✅ | `scripts/client-tmp-cleanup.js`（新建） | 上游没做。启动跑一次 + 每 24h 一次；只删 >7 天；**不跟符号链接**；`EBUSY` 计入 failed 不抛；路径必须落在 `client-tmp` 之内 |
| A3 | **token 刷新加密落盘** | 1.2.18 | ✅ | `scripts/lib.js` + `daemon.persistRefreshedAccount` | 此前加密态账号刷新后只进内存，**daemon 一重启就退回旧 token**。现在按原备份信封重新加密（`wdCompatEncryptAuthJson`）+ **双 CAS**（签名 + 全文）原子写回 |
| A4 | **刷新前可写性预检** | 1.2.18 | ✅ | `daemon.refreshAccountBackupToken` | refresh token 一旦被上游轮换就**无法回滚** ⇒ 不能等刷完才发现存不下。预检失败直接返回 `encrypt-account-unavailable` |
| A5 | **会话列表静默刷新** | 1.2.18 | ✅ | `scripts/inject.js` | 后台自动复制收尾不再清空勾选 / 退出批量模式；加 `readSerial` 竞态防护 + 快照比对，数据没变就不重渲染 |
| A6 | **session cwd 修复退避** | 1.2.18 | ✅ | `daemon.repairMissingSessionWorkspaces` | 失败退避 30s 起翻倍、封顶 5 分钟；日志**只记错误码**，不再写完整工作区路径与异常原文 |
| A7 | **重启后只剩托盘** | 1.2.18 | ✅ | `daemon.relaunchWorkBuddy` | `windowsHide: true → false` |

### 1.2 明确未吸纳

| # | 项 | 判定 | 理由 |
|---|---|---|---|
| N1 | `wallpaper-rotation`（壁纸轮换） | ⛔ | **用户明确否决**（2026-10-26） |
| N2 | `client-launch-settings` | ⛔ | 硬编码只支持 `workbuddy-ai`，本机是 `workbuddy-cn`，装了也不生效 |
| N3 | `official-automation-sync` + `automation-account-sync` | ⛔ | **用户明确否决**（"官方自动化同步不用做"） |
| N4 | 1.2.17 整体 | ⛔ | 本仓没有「remove 官方导航」那条路径，该版的修改全部落在这条不存在的路径上 |
| N5 | `persona` 系列 | ⛔ | 与本仓「身份文件不做程序化改写」的边界冲突 |
| N6 | **A5 行修订号 / 指纹快路径**（上游遗留项） | ⬜ 挂起 | 压在归档隔离不变量 **I-1** 红线上（全表 `status='archived'` 只允许属主账号）。**接线已就绪、开关关闭**，要开必须先把 I-1 守卫链改造成能表达「同账号内快路径」 |

---

## 二、插件自研修复与加固

| # | 项 | 状态 | 落点 | 解决了什么 |
|---|---|---|---|---|
| B1 | **`gateway.json` 账号快照不同步** | ✅ | `daemon.gatewaySyncAccounts` | 面板/API 读到的账号数是陈旧的（实际 4 个、快照只记 3 个）。三条保护：完整性前置 · 内容比对（无变化不写盘）· 失败不影响主同步流程 |
| B2 | **自动化模型 ID 静默选错** | ✅ | `scripts/automation-model.js` | 官方模型与自定义模型可能同名。改成精确匹配，**只有**调用方漏了 `custom-local:` 前缀时才回退 |
| B3 | **`relaunchWorkBuddy` 看不见窗口** | ✅ | `daemon.js` | `windowsHide` 误设 true，重启后只剩托盘 |
| B4 | **更新检查被网关 Release 污染** | ✅ | `daemon.js` 更新检查 | 自维护网关的 Release（`gateway-v1.13.0-panel-wd1`）会被当成主程序新版本。两层防御：daemon 侧 tag 必须匹配 `^v?\d+\.\d+\.\d+$`；CI 侧该 Release 标 `prerelease: true` |
| B5 | **会话静默刷新配套守卫** | ✅ | `.wd-analysis/test-session-silent-refresh.js`（18 条） | |
| B6 | **防升级 / 回收 / 加密落盘守卫** | ✅ | `test-workbuddy-launch-env.js`(28) · `test-client-tmp-cleanup.js`(25) · `test-token-persist-encrypted.js`(22) | |

---

## 三、反代网关（Go 版，自维护）

### 3.1 背景判定

| 问题 | 结论 |
|---|---|
| 要不要换成 Python 新版 `xiaofan6ya/wb2api`？ | **不换**。1.14.0 起架构断裂（Go sidecar → Python + pywebview + SQLite + Web 管理台），且两版**不是同一门语言** ⇒ 「只吸优势代码」不成立 |
| 那能不能自己升级 Go 版？ | **可以，且已做**。旧仓库 `linguo2625469/workbuddy2api-panel` 有**完整源码**（182 个 `.go` / 54,799 行），`appVersion` 与现装版本一致 |
| 两版关系 | **同源不同分支**（都源自已删的 `Sliverkiss/workbuddy2api`），互有长短，**不是新旧**。Go 独有：积分任务 17/18、限时补偿、工具调用标记还原、联网搜索；Python 独有：生图、DSH 规则、健康检查、IP 控制 |

### 3.2 已落地

| # | 项 | 状态 | 落点 |
|---|---|---|---|
| C1 | **Go 源码入库** | ✅ | `vendor/wb2api-go/`（3MB）；`bash vendor/wb2api-go/build.sh` 32 秒出包 |
| C2 | **一键构建脚本** | ✅ | 便携 Go 在 `%APPDATA%\WorkDaddy\golang\go`，`GOPROXY=goproxy.cn`，unset 代理 |
| C3 | **GitHub CI 出包** | ✅ | `.github/workflows/build-gateway.yml`：推 `gateway-v*` → 编译 + Release（`wb2api.exe` + `.sha256`）；该 tag **不匹配** `build-win.yml` 的 `v*`，不会误触发主程序发版 |
| C4 | **自维护修订号** | ✅ | `appVersion = "1.13.0-panel-wd<n>"`，每改网关行为 +1。上游基线也叫 `1.13.0-panel`，同号就分不清面板上报的是哪个包 |
| C5 | **账号健康检查** | ✅ | `POST /panel/api/accounts/{uid}/health`：三步（积分 → 模型目录 → 真实对话），只诊断不改状态，`?chat=0` 只读。**默认模型 ID 为空时会静默跳过第三步** —— 改两轮遍历才修好 |
| C6 | **出站头族对齐官方** | ✅ | `internal/upstream/headers.go`，详见 [`gateway-audit-2026-10.md`](gateway-audit-2026-10.md) |
| C7 | **`/releases/latest` 污染** | ✅ | CI `prerelease: true` + daemon tag 形状校验（同 B4） |

### 3.3 判定不做 / 暂缓

| # | 项 | 判定 | 理由 |
|---|---|---|---|
| D1 | 照搬 Python 1.16「模型接口 401 不登出」 | ⛔ | Go 的 `Classify()` 已是**精细错误链**（11102 → 402 → sessionDead → **11–128 不罚号** → 11140 → 14018 → 6021，外加 `IsWafBlocked`），`isSessionDead` 只在 refresh 失败时成立，本来就比 Python 严谨。**release notes ≠ 待办清单** |
| D2 | 照搬「Go 缺 pacing」 | ⛔（判定证伪） | Go 有 `minPickGap = 100ms` + `usedSeq` 单调序号兜底（治 Windows 时钟精度 0.5ms） |
| D3 | 照搬「Go 独有 17/18 成长任务」 | ⛔（判定证伪） | 两边都有，只是任务子集不同 |
| D4 | DSH 项目规则 | ⛔ | **用户说很少用 dsh** |
| D5 | 双网关并存（Python 8790） | 🟡 方案已验证、代码未写 | Python 版已 headless 跑通（`python main.py --port 8790`）、4 个账号导入成功、不影响 Go 版（`gatewaypy:` 前缀 + 独立 `gwpy.json` 规避同名 ID 互删）。**用户说「wb2api 新版之后再说」** |

---

## 四、反代 API 探测与伪装（摘要）

完整取证过程见 [`gateway-audit-2026-10.md`](gateway-audit-2026-10.md)，这里只列**做了什么、得到什么**。

| 测试 | 方法 | 结果 |
|---|---|---|
| **官方头族取证** | 从 `app.asar` 静态提取官方客户端真实请求头，逐项与网关出站对比 | 发现 **5 类暴露**（`X-Product` 值错、缺 IDE 五指、多出 `X-Machine-ID`/`X-Session-ID`、`Origin/Referer` 域名错、UA 版本段旧）—— **全部已修** |
| **抓包验证** | 把上游基址（`cn.chat_base`）指到本地抓头服务器，看网关**真实发出**的 body/headers | `messages` **逐字未改**；只多了 4 个参数：`prompt_cache_key` / `reasoning_effort: high` / `stream: true` / `stream_options` / `thinking:{type:enabled}` |
| **多模型一致性对比** | 同一 token，一侧按官方头族直连 `copilot.tencent.com`，一侧走网关 `127.0.0.1:7863`，比 `prompt_tokens` | 4 个模型全 200；**GLM 5.2（in=19）与 MiniMax M3.1 Flash（in=215）两侧完全相同**；混元 hy3 同；只有 DeepSeek V4 Flash 差 26（17→43），定位为 thinking 参数导致上游套模板，**不是消息被塞** |

**结论三句话**：转发无损；参数有意增强（为了让上游按 thinking 模型跑）；头已对齐。**多出来的头比缺少的头更危险** —— 缺头能解释成版本差异，多出来的头只能说明「这不是官方客户端」。

**抹不平的部分**（协议层以下，只要不是 Chromium 发请求就解决不了）：TLS 指纹 · HTTP/2 SETTINGS · header 顺序 · 连接复用模式。

---

## 五、待办清单

### P0 —— 用户已明确要求

| # | 项 | 现状 | 要做的事 |
|---|---|---|---|
| T1 | **AI 生图接入网关** | ⬜ 未开始 | 用户原话："这个可以搞，因为我现在确实不知道 WorkBuddy 里面有哪些模型是可以生图的"。需要：`Images()` 上游方法 · `/v1/images/generations` + `/v1/images/edits` 端点 · 参数白名单（11 字段）· 计费口径从 `usage.credit` 取实际消耗 · **5xx/传输错误不重试** · 出图后立即 `POOL.release()` |

### P1 —— 已知缺口，成本可控

| # | 项 | 现状 | 说明 |
|---|---|---|---|
| T2 | **面板健康检查按钮** | 🟡 后端 API 可用，前端没接 | `go:embed` 的 `app.js` / `index.html` 没有回归兜底，改前得先补守卫 |
| T3 | **内置默认版本段落后于实际客户端** | ⬜ | `headers.go` 的 `defaultClientVersion=5.5.4`、`defaultCliVersion=2.137.1`，而实际客户端是 **5.8.3 / CLI 2.161.0**。生产 `config.json` 已显式覆盖所以现在没事，但**换机 / 重装 / 配置丢失时新装网关会自称 5.5.4** —— 旧版本号本身就是可疑特征 |
| T4 | **B11 余额初始化鉴权失败提示** | ⬜ | 连 Go 版到底有没有这个毛病都还没证实。**先证伪再决定动不动** |

### P2 —— 观察项 / 有前置条件

| # | 项 | 前置条件 |
|---|---|---|
| T5 | wb2api Python 新版灰度试跑 | 用户说"之后再说" |
| T6 | 双网关并存 `api-gateway-py.js` | 方案已验证（D5），等 T5 |
| T7 | A5 行修订号快路径（N6） | 先改造 I-1 守卫链 |
| T8 | `Origin` / `Referer` 是否该彻底删掉 | 官方 asar 零命中，大概率本来就不发；但直接删有未知风险（可能有防盗链校验），先留着 |
| T9 | `/v3/config` 的 UA 仍是 `CodeBuddyIDE/4.12.0 CodeBuddy/4.12.0` | 源码注释说改了对该端点会返回不完整能力，**不敢动** |

---

## 六、验证基线

| 项 | 数值 | 时间 |
|---|---|---|
| WorkDaddy 回归 | **82 套件 / 4760 断言全通过**（另 `tools/updater-guard.js` 18 PASS） | 2026-10-27 07:38 实跑 |
| Go 网关单测 | **17 个包全通过** | 2026-10-27 |
| WorkBuddy 面板实机 | `/api/inject` → `root=true widget=true` | 2026-10-27 |
| 生产网关 | `1.13.0-panel-wd2`，7863 端口，4 账号 / 3 健康 | 2026-10-27 |

---

## 七、变更这个文档的规矩

1. **每做完一项就改状态**，别攒着 —— 这份文档的价值全在「和代码一致」。
2. 判「不做」的项**必须写理由**，理由不写清楚以后一定会有人（可能就是我）重新评估一遍。
3. 新增自定义网关行为 ⇒ `appVersion` 的 `-wd<n>` **+1**（C4），否则面板上报的版本说不清是哪个包。
