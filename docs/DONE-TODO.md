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
| B6 | **防升级 / 回收 / 加密落盘守卫** | ✅ | `test-workbuddy-launch-env.js`(33) · `test-client-tmp-cleanup.js`(25) · `test-token-persist-encrypted.js`(22) | |
| B7 | **「被动不更新」只挡了装，没挡查+下** | ✅ 2026-10-28 | `scripts/workbuddy-launch-env.js` + `scripts/daemon.js`（`GET /v2/update` → 204）+ `scripts/inject.js`（增强页开关） | 用户反馈「左下角又出现『新版本 5.9.3 / 重启更新』」。日志证实：`WORKBUDDY_UPDATE_URL` 原来钉的是**官方域**，等于让它照常问官方；10-28 02:21 拿到 `5.9.3.42398134` 后 **45 秒自动下完 429MB** 并置 `ready`。**钉 URL ≠ 禁止更新**。修法：① `WORKBUDDY_UPDATE_URL` → 本机 daemon 的 `/v2/update`（永远 204，读不到 `ui-port.json` 退 `127.0.0.1:9`）；② `app-config.json` 写 `startupForceAutoUpdate:false` 掐掉 `early-silent-startup-update`；③ 清掉已下载的包。另确认 win32 无「退出即装」「启动扫描即装」（无 `pending-update.json` / 无 `autoInstallOnAppQuit` / ready 不落盘）⇒ 不点按钮不会自己装。**已做成增强页「客户端更新」开关**（`<dataDir>/client-update-policy.json`，默认静音；关掉即恢复官方更新），守卫 43 条 |
| B8 | **「报错后切模型重发还是同一个错、必须重启才好」** | ✅ 2026-10-29（只提醒） | `scripts/model-switch-guard.js`（新建）+ `daemon.js`（`GET /api/model-switch-check` · `POST /api/model-switch-guard-set`）+ `inject.js`（增强页卡片 + 4 秒轮询） | 真因：**客户端「报错后重新发送」这条路径不带模型参数** —— 日志里正常发送 `requestOptions.model=<值>`（10-21 批量 99/99 全带），报错后重发是 `requestOptions.model=<none>`、只有 `options.model` 有值 ⇒ 回落到**会话默认模型**即报错时那个旧模型，于是原样再失败一次。界面上模型明明换了、请求还打原来那家。重启好使是因为 CLI 用持久化设置重起，第一条请求就带新模型。判据三段式：`unstable_setSessionModel`（想用的）→ `Sending request`（实际发的，模型不一致）→ 紧随 `refusal classified`（真失败）；4 天日志回放 SET=118 / REQ=3567 → 只命中 5 次且全带错误码、276 次正常切换零误报。**刻意只提醒不补救**（自动补发需拦客户端内部 ACP 调用 = 站调度层，与「配置层+指令层+观测层」边界冲突，且内部 id 映射一变就静默失效）。守卫 `test-model-switch-guard.js`（28 条） |

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
| C4 | **自维护修订号** | ✅ | `appVersion = "1.13.1-panel-wd<n>"`（当前 **wd8**），每改网关行为 +1。上游基线也叫 `1.13.x-panel`，同号就分不清面板上报的是哪个包 |
| C5 | **账号健康检查** | ✅ | `POST /panel/api/accounts/{uid}/health`：三步（积分 → 模型目录 → 真实对话），只诊断不改状态，`?chat=0` 只读。**默认模型 ID 为空时会静默跳过第三步** —— 改两轮遍历才修好 |
| C6 | **出站头族对齐官方** | ✅ | `internal/upstream/headers.go`，详见 [`gateway-audit-2026-10.md`](gateway-audit-2026-10.md) |
| C7 | **`/releases/latest` 污染** | ✅ | CI `prerelease: true` + daemon tag 形状校验（同 B4） |
| C9 | **AI 生图接入** | ✅ | `POST /v1/images/generations` + `/edits`（JSON / multipart），上游 `/v2/images/*`。11 字段白名单 · 出站强制 `response_format=url` · 计费取 `usage.credit` · **5xx/传输错误不重试（防重复扣费）** · 出图即 `Pool.Release` · b64 只从 `*.myqcloud.com` 下载（防 SSRF）。**同时修好了「不知道哪些模型能生图」**：`nonChatModel` 原来把生成类模型整个过滤掉，现在保留并按 `type:"image"` + `capabilities:["image_generation"]` 单独列进 `/v1/models` |
| C10 | **容量与调度板块** | ✅ | 新面板视图 `#capacity` + `GET /panel/api/capacity`。每个模型三态（**空闲 / 拥堵 / 不可用**）+ 判定依据（模型锁 / 账号冷却 / 在途打满 / 无号）+ 最早恢复时刻 + 调度参数（策略 / 在途上限 / 积分保底 / 跨域回退）。口径与选号同一个 `healthyForModel + inFlightFull`，面板说可用就真选得到号。守卫 `capacity_test.go`（10 条）+ `capacity_panel_test.go`（4 条） |
| C11 | **⭐ 发布链路收口为单一版本号** | ✅ 2026-11-02 | 起因：老叶发现 Releases 列表全是 `gateway-v1.13.1-panel-wd4`，本体 `v1.9.7` 不显眼。查下去发现更严重的事 —— `api-gateway.js` 的 `GATEWAY_REPO` **一直指着上游** `linguo2625469/workbuddy2api-panel`，面板「更新网关」下载的是上游原版，**wd1–wd7 从没通过这个按钮生效过**。改法：网关不再单独发 Release，CI 在 `build-win.yml` 里顺带编、打成 `wb2api-windows-amd64.zip`（+ `checksums.txt`）挂到主 Release；daemon 按「自家主 Release → 上游兜底」两段式下载，走兜底必须打日志。删掉 4 个孤儿 Release。守卫 `test-api-gateway.js` [I] 组（9 条） |
| C11 | **DSH 项目规则标题脱路径** | ✅ | `upstream/project_rules.go`：客户端注入的 `<system-reminder># Instructions from: C:\Users\…\AGENTS.md` 只把**标题行的本地路径**收敛成文件名，正文逐字保留；只动 system/developer（user 内容是用户输入）。Go 版没有 Python 的「运行时摘要 / 历史截断」，所以正文天然完整，不需要搬运整套提取逻辑。守卫 `project_rules_test.go`（7 条） |
| C12 | **余额刷新失败显式提示（B11）** | ✅ | 探测结论：Go 版**有这个坑**，形态是「静默」而非崩溃 —— `RunBalanceRefreshNow` 失败只打 stdout，`credits` 保持旧值，面板照常显示「余额刷新 X 分钟前」。修法：`Pool.SetCreditsError` 留痕 + `Status.credits_error` 透出 + 面板积分后挂「陈旧」标记（hover 看原因），成功刷新自动清除。守卫 `credits_error_test.go`（3 条） |
| C8 | **面板总览页 + 换肤** | ✅ | 新开 `#overview`（默认落地页），接 `overview` + `usage?hours=24/168/720` 两个**现成**接口 —— 后端零改动。深色改「深海蓝黑 + 靛蓝」、浅色「蓝白」；卡片网格 / 环形缓存命中 / 账号分布条 / 大数字排版。图标全内联 SVG（CSP 禁外链）。守卫 `overview_panel_test.go`（6 条） |
| C13 | **对话里用生图模型（chat 兼容层）** | ✅ | `server/chat_image.go`。客户端**没有生图入口**，选中 `cn:hunyuan-image-alpha` 后走的是 `/v1/chat/completions` + `stream:true`，上游回 `400/11103 Backend [hunyuan-stream] is not supported`，网关又当可重试错误连换 7 个号 → 503（实测 3 条 11103 / 5.5s）。现在 chat 入站识别生图模型（`isImageGenModel`），就地转走 `generateImage`（从 `images()` 抽出来的同一套选号/租约/计费），图片以 `![生成图片](url)` 贴回对话。流式**先发头 + 空 role delta 开流**再出图（实测 TTFB 38~47ms、总耗时 11~18.5s）；失败以正文 `⚠️ 原因` 回给对话（200 已发改不回来），non-stream 回真 4xx/5xx。⚠️ 判定**只读目录快照**、不在请求线程拉上游（早期写法打乱了「一次 chat = 一次上游调用」的计数，被 `cross_domain_fallback` 测试当场抓到），为此加启动预热 `WarmModelCatalog()`。守卫 `chat_image_test.go`（13 条） |

### 3.3 判定不做 / 暂缓

| # | 项 | 判定 | 理由 |
|---|---|---|---|
| D1 | 照搬 Python 1.16「模型接口 401 不登出」 | ⛔ | Go 的 `Classify()` 已是**精细错误链**（11102 → 402 → sessionDead → **11–128 不罚号** → 11140 → 14018 → 6021，外加 `IsWafBlocked`），`isSessionDead` 只在 refresh 失败时成立，本来就比 Python 严谨。**release notes ≠ 待办清单** |
| D2 | 照搬「Go 缺 pacing」 | ⛔（判定证伪） | Go 有 `minPickGap = 100ms` + `usedSeq` 单调序号兜底（治 Windows 时钟精度 0.5ms） |
| D3 | 照搬「Go 独有 17/18 成长任务」 | ⛔（判定证伪） | 两边都有，只是任务子集不同 |
| D4 | DSH 项目规则 | ✅（改判定） | 用户改口说可以做 ⇒ 落地为 C11。原判定「很少用 dsh」不再适用 |
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
| T1 | **AI 生图接入网关** | ✅ 已落地（见 C9/C10） | 用户原话："这个可以搞，因为我现在确实不知道 WorkBuddy 里面有哪些模型是可以生图的"。需要：`Images()` 上游方法 · `/v1/images/generations` + `/v1/images/edits` 端点 · 参数白名单（11 字段）· 计费口径从 `usage.credit` 取实际消耗 · **5xx/传输错误不重试** · 出图后立即 `POOL.release()` |

### P1 —— 已知缺口，成本可控

| # | 项 | 现状 | 说明 |
|---|---|---|---|
| T2 | **面板健康检查按钮** | 🟡 后端 API 可用，前端没接 | `go:embed` 的 `app.js` / `index.html` 没有回归兜底，改前得先补守卫 |
| T3 | **内置默认版本段落后于实际客户端** | ✅ 已修（v1.11.0） | `headers.go` 的内置默认已对齐本机实测的 **5.9.3 / CLI 2.165.0**（`desktop.go` 的 `desktopUA` 与 `growth-tasks.js` 的 `DESKTOP_UA` 同步）；另把生产 config 的硬编码 `user_agent` **清空**，改由 realm 感知的 `defaultWorkBuddyUAFor()` 组装（否则 global 账号拿不到 `WorkBuddy AI` 平台段） |
| T4 | **B11 余额初始化鉴权失败提示** | ✅ 已证实并做完（见 C12） | Go 版的问题不是「启动时崩」，而是**失败静默 + 余额变陈旧值**；已加留痕与前端标记。剩下可选的增强：把 `credits_error` 也接到总览告警条（当前只在账号行显示） |

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
| WorkDaddy 回归 | **83 套件 / 4803 断言全通过**（另 `tools/updater-guard.js` 18 PASS） | 2026-10-29 实跑 |
| Go 网关单测 | **17 个包全通过**（含 `chat_image_test.go` 13 条 / 面板 `overview_panel_test.go` 6 条） | 2026-10-28 |
| WorkBuddy 面板实机 | `/api/inject` → `root=true widget=true`；「客户端更新」开关 CDP 实点：`已静音 → 随官方更新 → 已静音` | 2026-10-28 |
| 模型切换提醒实机 | CDP 实点增强页开关：`开着 → 已关闭 → 开着`，`model-switch-guard.json` 同步落盘；合成日志注入后左下角弹出黄色警告（含模型名 + 域名） | 2026-10-29 |
| 生产网关 | `1.13.1-panel-wd7`，7863 端口，4 账号 / 3 健康；生图模型 chat 实机验证：流式 200 / 11s 出图，非流式 200，空 prompt 400 | 2026-10-28 |

---

## 七、变更这个文档的规矩

1. **每做完一项就改状态**，别攒着 —— 这份文档的价值全在「和代码一致」。
2. 判「不做」的项**必须写理由**，理由不写清楚以后一定会有人（可能就是我）重新评估一遍。
3. 新增自定义网关行为 ⇒ `appVersion` 的 `-wd<n>` **+1**（C4），否则面板上报的版本说不清是哪个包。
