# 更新日志

本分支（[miantanjun/WorkDaddy-](https://github.com/miantanjun/WorkDaddy-)）是上游 [babygoton/WorkDaddy](https://github.com/babygoton/WorkDaddy) 的个人维护分支。
本文件按**版本倒序**记录本分支**自有**的全部改动；上游原版历史不在此列。

**读法**

- 版本号与 `scripts/package.json` 的 `version`、面板「关于」页显示的值一致。
- 每条改动都标注**落地提交**（短哈希）—— `git show <hash>` 可直接看到完整 diff。
- 分类口径：
  - **新增功能** —— 用户可见的新能力（新面板入口 / 新 API / 新自动化行为）
  - **缺陷修复** —— 修掉「本该工作却没工作」或「表现与事实不符」的问题
  - **优化调整** —— 行为不变但更快、更省、更不易误判（含刻意做到「零行为变化」的改造）
  - **工程与文档** —— 回归套件、探针、索引、构建与版本口径
  - **判定不做** —— 评估过、有明确判据、**故意不做**的项（留档，避免以后重复评估）

---

## v1.6.0 —— 2026-09-22

**本版提交**：`5fe02b6`（省 token 专项 / 面板改造 / 上游基线对齐）· `de91b7f`（探针）· `8ebf8b3`（F2 二期 / A3 / D4）· `de238f7`（本文档 + README）

**质量门**：回归 **42 套件 / 2999 断言全绿**；daemon `1.6.0`（buildId `release-1.6.0-20260922-structured-error`）已重启并活体验证；上游基线 `1.2.5`。

**发布**：GitHub Release [`v1.6.0`](https://github.com/miantanjun/WorkDaddy-/releases/tag/v1.6.0)（tag 指向 `de238f7`），CI run [`35748319036`](https://github.com/miantanjun/WorkDaddy-/actions/runs/35748319036) **16 步全绿**，4 资产齐备：

| 资产 | 大小 | SHA-256 |
|---|---|---|
| `WorkDaddy-Setup-1.6.0.exe` | 29.0 MB | `a4cc57c67f96cb897d67daa433c2a637c17b716d10937368752c076bd2086cee` |
| `WorkDaddy-AI-Setup-1.6.0.exe` | 29.0 MB | `75d5489642729ff72025e7aded319e0d278524828fc639df432e1b24cbc9492a` |
| `WorkDaddy-Portable-1.6.0.zip` | 38.9 MB | `a0ab248807e80d86e4de7d8caa961972800f3dcfbbeae4c010aefbdd6c056cbf` |
| `WorkDaddy-AI-Portable-1.6.0.zip` | 38.9 MB | `20bf952d2443937f7f994a025961ac11063817617139092afc04ecf3a9c0bf4c` |

发版后**实下载便携版复验**（不只看 CI 绿）：新模块 `structured-error.js` / `context-audit.js` / `context-fix.js` / `memory-governance.js` 均在包内；包内无安装入口、无 `.bak`、无 `win/probe`。

### 新增功能

| 项 | 说明 | 提交 |
|---|---|---|
| **手动「换号并续跑」** | 面板账号页一键换号续跑。与自动侦测入口有**两个前置刻意不要求**：不要求存在启用中的 `account.failoverContinue` 任务（自动入口没任务直接 404 ⇒ 「没配自动化」的用户在限流时完全无路可走），也不要求页面此刻真挂着限流横幅（这是人按的，不是侦测到的）。选号 / 切号 / 同步副本 / 续跑复用 `runLimitFailoverCore`，判据不复制。接口 `POST /api/limit-failover/manual` **立即返回 202**（切号会 `Page.reload`，面板里的 fetch 一定被掐断），结果由 `GET /api/limit-failover/status` 轮询读出；响应**不带会话正文**。手动换号未必因为限流 ⇒ 只有已被判定限流的账号才写进限流窗口（否则等于把一个健康的号自断后路），判定取自 `account-health` 的落盘状态，不重写那套规则 | `5fe02b6` |
| **上下文体检** | `GET /api/context-audit` 量出常驻上下文里**最贵**的部分，回答「花在哪、怎么省」（与 `/api/token-stats` 的「花了多少」分工）。findings 带结构化处理路径：`auto` 走 fix 接口、`paste` 给出可复制的指令文本 | `5fe02b6` |
| **上下文修复** | `POST /api/context-audit/fix` 走**白名单 fixId**，**只移动不删除** | `5fe02b6` |
| **记忆治理巡检** | `GET /api/memory-audit`：对三层记忆（用户级 / 工作区 / 日档）按分层判据打分，指出「该放哪、该多大」。**刻意不配 `/fix` 路由** —— 记忆是语义资产，自动改写会把结论改坏，所以只提醒不动手 | `5fe02b6` |
| **交接摘要** | `GET /api/handoff`（只读）：纯函数 `buildHandoff` 拼 markdown，面板负责复制，用于把当前进度交接到下一个会话 | `5fe02b6` |
| **结构化错误信号**（F2 第二期） | 健康状态机此前只有「DOM 横幅文案正则」一条低精度信号源。新增 `scripts/structured-error.js`，走渲染层**正规事件通道** `provider.api.onSessionEvent` → `client.on('session:event')`（频道名出自 asar `/preload/index.js` 的 `SESSION_RPC_CHANNELS.EVENT`），**形状无关**地采集官方已归类好的 `bizCode` / `httpStatus` / `stopReason`，与 DOM 横幅在**同一处**合并成一条观测（两条任一命中即判） | `8ebf8b3` |
| **模型级冷却**（A3） | `6004`（该模型已达今日上限）此前只落盘到 `entry.models[]` 却没人消费。`account-health.isUsableForFailover` 增加可选第 4 参 `modelId` —— 该模型冷却中就把**这一个模型**从换号候选里去掉，**不切整号**（这个号跑别的模型仍然可用） | `8ebf8b3` |
| **同步判据灰度入口**（D4） | `GET/POST /api/sessions/auto-copy/judge`：在 `mtime`（默认）与 `content`（上游内容快照判据）之间切换。`setAutoCopyJudge` 从「全仓写好了但无人调用」变成有**唯一显式入口**，并由反向守卫断言锁死调用点数量 | `8ebf8b3` |

### 缺陷修复

| 项 | 说明 | 提交 |
|---|---|---|
| **上游基线显示错版** | `UPSTREAM_VERSION` 停在 `1.2.3`，而真实基线早在 2026-09-21「上游 1.2.5 吸纳」时就已到位（`scripts/session-sync.js` 即 1.2.5 原文 + 本地 delta），只是这个常量漏更。后果：「检查更新」把上游基线显示成 `1.2.3`，并把上游 `1.2.4` / `1.2.5` **误报成「有新版」** | `5fe02b6` |
| **云端残留清理口径** | 实测云端 delete 已改为**幂等**：删不存在的 id 不抛异常、返回 `undefined`（detail 接口仍抛 not found）。⇒ `summarizePurgeRun().deleted` 的口径是「**云端接受的删除请求数**」，不是「确实删掉的条数」。文案与断言随之改口径，改用与云端语义无关的守恒式 | `5fe02b6` |

### 优化调整

| 项 | 说明 | 提交 |
|---|---|---|
| **常驻记忆瘦身** | 两份常驻 `MEMORY.md` 一次性瘦身：用户级 **5415 → 3943** 字符、工作区 **8476 → 2956** 字符。常驻上下文每个会话都注入、且之后每轮随历史重发 ⇒ 直接决定每轮 token 成本 | `5fe02b6` |
| **运维弹出层 + 面板可缩放** | 账号页三张常驻卡（自动切换 / 换号续跑 / 上下文体检）搬进「运维」弹出层，不再抢列表高度；入口带**告警红点**（由限流窗口 / 体检严重项回填）。面板左上角抓手可拖拽调整尺寸，尺寸存 `localStorage`；弹出层用 `absolute` 定位（面板的 `backdrop-filter` 会让 `fixed` 降格） | `5fe02b6` |
| **零行为变化保证（三处）** | ① 结构化错误两个新端口缺省时，观测与改动前**逐字相同**；② `isUsableForFailover` 不传 `modelId` 与加 A3 之前**逐字等价**；③ judge 默认仍是 `mtime` ⇒ 不调用新端点即零变化、可一键回退 | `8ebf8b3` |
| **影响面先量化再决定** | 切 `content` 判据前先跑**只读**诊断 `.wd-analysis/diag-judge-content.js`：本机 25 条血缘 / 21 条 ≥2 成员 ⇒ 源选择变化 **3** 条、动作变化 **1** 条（约 28.5 MB 的一次增量同步）、**新增分叉 0** 条 ⇒ 结论：**只开入口、暂不灰度** | `8ebf8b3` |

### 工程与文档

| 项 | 说明 | 提交 |
|---|---|---|
| **回归规模** | 41 套件 / 2885 断言 → **42 套件 / 2999 断言**。新增 `test-structured-error.js`（102）、`test-context-audit.js`、`test-context-fix.js`、`test-memory-governance.js`、`test-failover-manual.js`；`test-auto-copy-judge` 27 → 39；`account-health` E16 断言随 `modelId` 入参同步更新 | `5fe02b6` `8ebf8b3` |
| **代码索引** | 新增 `.wd-analysis/CODE-INDEX.md`（1321 行）+ 生成器 `gen-code-index.js`，用于快速定位「某能力落在哪个函数」 | `5fe02b6` |
| **活体探针** | 新增 `probe-about-version.js`（核验「关于」页**真渲染**出的两个版本号，不是只对 API 字段）、`probe-cloud-delete-semantics.js`、`probe-memory-audit.js`、`probe-ops-layout.js`、`probe-panel-resize.js` | `5fe02b6` `de91b7f` |
| `.gitignore` | 补 `.wd-tmp/`（维护临时产物，本机专属；此前会被 `git add -A` 一锅端） | `5fe02b6` |
| 打包白名单 | mac 打包脚本补 `structured-error.js`（源文件列表 + `chmod` 列表**两处**） | `8ebf8b3` |
| README | 「与上游的差异」同步：基线 1.2.3 → 1.2.5，补 v1.5.0 / v1.6.0 条目 | `5fe02b6` `8ebf8b3` |
| 本文件 | 新增 `CHANGELOG.md`，把本批三个提交的全部改动面按维度归档 | 见下方提交 |

### 判定不做（有判据，留档避免重复评估）

| 项 | 判据 | 提交 |
|---|---|---|
| **E2 realm 分池** | 实测本机 3 个账号的 `authDomain` / `authIssuer` 全是 `https://www.workbuddy.cn` ⇒ **无双域混池**，分池的动机不成立 | `8ebf8b3` |
| **F1 墙钟 `resetAt`** | 消费端（`resolveUntil` + `resetAt` 入参）早已落地，但**数据源不可靠**：`/api/credits` 的 `cycleResetTime` 实测返回 `null`，可用的 `segments[].expiresAt` 是**套餐到期日**（不是限流重置时刻）；且把它填进 `resetAt` 会把 `quota_hard` 冷却从 10 分钟顶到 24 小时上限 —— **误判代价倒挂**。留给独立模块 `quota-window.js` | `8ebf8b3` |
| **三条已排除的错误通路** | `daemonClient.$invoke` 装得上但**拦不到**（方法体走闭包引用）；`adapter.errorCallbacks` 注册成功却**不接云 API 错误**（触发后 0 命中）；`showErrorBanner` 在组件闭包里、不挂 `window`。⇒ 下轮别再重试这三条 | `8ebf8b3` |

### 边界（本版明确不做）

不做主进程 `--inspect`、**不代理请求**、**不改写官方请求**、**不裁剪任何会话文件**。

---

## v1.5.0 —— 2026-09-22

**提交**：`4df1d15` · **主题**：账号健康状态机（把「限流等一等」与「该重新登录了」分流）

| 项 | 说明 |
|---|---|
| **四态健康状态机** | 此前只有「被限流」一个概念，于是**凭证已失效**的账号被当成「等 10 分钟就好」，10 分钟后又被选中、又失败，**静默循环**，用户看不到「该重新登录了」。现拆成四态：`正常` / `限流中`（等一会能好）/ `需重新登录` / `已停用`，落盘在数据目录的 `account-health.json` |
| **分级排除与徽标** | 切号按健康**分级排除**（「需重新登录」「已停用」不再被挑中），并在桌面日志里说明原因是「**等到点也没用、要去重新登录**」而不是「都无法接管」；账号卡显示健康徽标（含剩余冷却分钟数与原因），被摘除的账号不再显示切换按钮 |
| **幂等管理操作** | 面板「停用 / 启用 / 解封 / 清除」四个幂等操作；「启用」只解**手动位**、「解封」只解**系统位**，互不干扰 |

**回归**：41 套件 / 2885 断言（含 `test-account-health.js` 138 条）。

---

## 更早版本

| 版本 | 提交 | 主题 |
|---|---|---|
| v1.4.4 | `f9ee851` | 会话分叉不再谎报失败（改琥珀色 + 新增「处理冲突」入口）；「立即同步」支持手动强制覆盖 |
| v1.4.3 | `eee9aca` | 吸纳上游 1.2.5：会话同步重定基（取消 64 MiB / 20000 文件两道上限 + 惰性字节加载 + 文件级指纹缓存）、自动化协议 V3（`prepare` / `condition` / `switch` 等同步成功）、同步体积与速率指标 |
| v1.4.2 | `a447b31` | 成长任务一键完成（**档位即安全闸门**）；方案 D 的 D0–D2 内容定源同步 |
| v1.4.1 | `b006f40` | 代码审查 §9 落地（限流时钟 / ws 供应链收口 / 守卫补测） |
| v1.4.0 | `c52e002` | 融合上游 1.2.3 到自建版 |
| v1.3.x | — | 归档改为「仅主账号」、`session.open` 侧栏收起修复、定时发送改走 composer store、用量归属修复等（逐条见 `git log`） |

完整功能对照见 [README「与上游的差异」](README.md#与上游的差异)；维护者本机另有一份详细排障手册（`workdaddy-maintain`，不入库）。

---

## 如何追溯

```bash
# 看某个提交改了哪些文件、逐行 diff
git show 8ebf8b3
git show 5fe02b6 --stat

# 两个版本之间的全部改动
git log --oneline v1.5.0..v1.6.0
git diff v1.5.0..v1.6.0 --stat

# 某个文件在某个版本被改过什么
git log -p scripts/daemon.js --since=2026-09-22
```

> 维护约定：每批改动完成后 —— 改前 `_backup` → 改后 `node --check` → 全量回归 → `DAEMON_BUILD_ID` 递增 → 重启 daemon → 活体验证 → 更新本文件对应版本节。
