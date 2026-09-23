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

## v1.7.0 —— 2026-09-23

**本版主题**：**用量看得清 + 报告读得快** —— 统一用量看板（账号/模型/日期三维筛选、积分走权威源、会话排行显示**真实会话名**）、单会话成本卡、md 快速查看器、模型效率面板、token 速度读数；并修掉看板三处口径错误（「总 token 虚增 ≈+98%」「总积分虚增 ≈49 倍」「账号 × 模型归属全错」）。

**质量门**：回归 **45 套件 / 3210 断言全绿**；护栏 `tools/updater-guard.js` **18 PASS**；mac 打包白名单**传递闭包**自查 **60 可达 / 0 缺失**；daemon `1.7.0`（buildId `release-1.7.0-20260923-session-titles-r1`）已按 **pid** 重启并活体验证；上游基线 `1.2.5`。

**发布**：待 CI 完成后回填（tag `v1.7.0`）。

### 新增功能

| 项 | 内容 | 落地位置 |
|---|---|---|
| **token 速度读数（可拖动）** | 处理任务时实时显示 `≈ N tok/s`。**默认位**贴输入框下方空置带左侧；**按住可直接拖到屏幕任意位置**，**双击复位**；位置按账号存 `localStorage`，重开会话仍记得。数据源＝当前助手消息（`[class*="cr-frame--left"]` 末元素）内 `[class*="cr-text-block"]` 的 `textContent` 长度之和，1 s tick + 5 帧滑窗折算。**非真值**，故带 `≈` 前缀；**无输出 / 读不到时保留上一次读数**（加 `.is-stale` 降至 42% 透明度提示「这是旧值」），**不再消失**；面板内可一键关闭（开关 `#wbs-sess-token-rate`，偏好存 `localStorage['workdaddy.tokenRateReadoutEnabled']`）。 | `scripts/inject.js`（逻辑块注释头 `// ---- token 速度读数`；可拖动块注释头 `// ---- 读数可拖动`） |

| **用量看板（第三方离线 HTML）** | 账号行「用量统计」旁新增按钮，点开弹窗内嵌第三方 skill `workbuddy-usage-status` 生成的离线 HTML 看板（daemon 静态服务 `/usage-board/`，无鉴权，仿 `/wallpapers` 先例）。**原「用量统计」一字未动**，两者并行以便 A/B 对比两套口径。首次打开自动生成（无产物时不必先点刷新）；标题旁显示「生成于 MM-DD HH:mm」；右上角「重新生成」重跑抽取器并重载 iframe。产物落 `%APPDATA%\WorkDaddy\usage-board\`，**只保留最近 3 份**看板 HTML 与 CSV，防无限堆积。 | `scripts/daemon.js`（`USAGE_BOARD_DIR` / `resolveUsageBoardPython` / `latestUsageBoardHtml` + 3 条路由）、`scripts/inject.js`（`onUsageBoard`） |

| **统一用量看板（自绘，三维筛选）** | **把上面那套第三方看板与自绘「用量统计」融合成一个面板**（两个入口图标合一，与旧「用量统计」按钮并排的重复入口已删）。筛选支持**账号 / 模型 / 日期**三维组合，**全在客户端内存里算** ⇒ 切换零延迟；数据内嵌进单文件 HTML ⇒ iframe 不需要（也没法）带请求头。含 8 张 KPI、5 张可选口径的图、4 个视图的可排序明细表、一键导出「当前筛选」CSV、以及写在页面上的口径提示。数据源三分工：token 走 `token-stats.js`、**积分走 `credit-usage.db`（逐请求，权威）**、思维链走 jsonl `rawUsage`；第三方抽取器只补错误率 / 思考时长 / 缓存命中 / 会话排行（**不混进三维数值**）。 | `scripts/usage-unified.js`（数据层，新建）、`scripts/usage-board-html.js`（渲染层，新建）、`scripts/daemon.js`（`usage-unified` 3 条路由 + `creditUsageQuery()`）、`scripts/inject.js`（`onUsageBoard`） |

| **单会话成本卡（面板「会话」页）** | 会话页顶部一张实时成本卡，四个数：**累计积分（主）｜边际成本·最近 10 轮均值 → 「再聊 10 轮约」｜上下文占用（官方 `used/size`）｜缓存命中率（单独一行）**。三条设计取舍照抄 wb-credits：① 边际成本用**最近 N 轮已结算均值**而非全程均值（全程会被早期冷缓存轮拉高，让人误判"以后都这么贵"）；② 无已结算轮次显示「**待首轮结算**」而非 `0`（`0` 会被读成"免费"）；③ 命中率单独一行并写明因果 —— 钱花在**每轮重复的上下文**上，压成本应缩上下文而不是让模型少说话。**关键口径（踩过的坑）**：`session_usage.credit_json` 的键是 `providerData.conversationRequestId`（＝`traceId`），**同一次请求的每条记录都带它**（实测一个键在一份 jsonl 里出现 **204 次**）⇒ 必须按它去重，否则就是历史上那个 ≈50× 的重复计；`input_tokens` **已含** `cache_read_input_tokens`，不再相加。性能：jsonl **自适应尾读**（4 MB 起翻倍、封顶 64 MB，直到窗口内已结算轮 ≥ N）+ daemon 侧 5 s 结果缓存（二次调用实测 **1 ms**，首读 395 ms）。异常态全部有文案（未识别会话 / 待首轮结算 / 找不到 jsonl）。 | `scripts/session-cost.js`（新建）、`scripts/daemon.js`（`GET /api/session-cost` + require）、`scripts/inject.js`（成本卡 UI + CSS 共 6 处） |

| **md 快速查看器（插件内置，待办 T30）** | 点产物卡片里的 `.md` **不再走官方文档查看器**（首开约 14 s），改由插件自己的弹层秒开。**做法**：`window` **捕获阶段** `click` 拦 `.artifact-slot-panel__card[data-ext="md"]` ⇒ `preventDefault` + `stopPropagation`，取 `data-dir`，`fetch('file:///…')` 直读（实测 3 ms/62 KB，**不开新 daemon 路由**）⇒ 零依赖自研渲染器（标题/段落/粗斜/行内码/围栏码/有序无序+任务列表/引用/**表格成真 `<table>`**/链接/图片/分隔线；**刻意不做数学与 mermaid**，命中给降级提示 + 原文）⇒ 弹层。头部四按钮：**复制正文 / 导出 HTML / 用官方查看器打开 / 关闭**（`Esc` 亦可关）。**导出**落同目录同名独立 HTML（自带精简样式 + `prefers-color-scheme`，可直接外发）；daemon 侧新增 `POST /api/md-export-html` 落盘（已存在的非我方文件会退到 `<名>-md.html`，不覆盖别人）。**5 处安全约束**：渲染器**全量 `esc()` 转义后拼接**（绝不把原始 md 塞 `innerHTML`）、行内 URL 走 `escAttr`、**4 MB 上限**（超限只提示不硬塞）、逃生口用 `window.__wbsMdBypass` 标记（合成 click 会被自己的捕获拦截器再拦一次）、面板开关默认开（关掉完全走官方，零副作用）。**性能**：105 KB / 1327 行实测 **1.38 s**（官方 14 s）。**顺手修掉一个真缺陷**：热更副本监听器堆叠（见「缺陷修复」）。 | `scripts/inject.js`（8 处：i18n / CSS / 主逻辑块 / `build()` 接线 / 面板开关 / 开关接线 / 代际标记 / 清理增补）、`scripts/daemon.js`（`POST /api/md-export-html`） |

| **md 快速查看器改「右侧停靠」+ 产物面板入口补拦（待办 T31）** | 用户实测两点反馈：① **右上角产物面板**里的 md 条目**没被拦**，仍走官方 14 s 冷启动；② 希望打开后**跟官方 md 一样把对话左移、右侧腾出空间放文档**。四处改动：**① 入口补拦** —— 拦截器 `closest()` 由单一候选扩为三个（正文产物卡 `.artifact-slot-panel__card[data-ext]` / 产物面板条目 `.cb-overview-artifact-item[data-ext]` / 兜底 `[data-ext][data-dir]`）；两入口 `data-dir` **形态不同**（A 是未编码绝对路径、B 是 `file:///` + %XX 编码 URL）⇒ 新增 `mdqvNormPath()` 归一化（剥 `file:///` 前缀 + `decodeURIComponent` + `/C:/`→`C:/`）。**② 弹层改右侧停靠** —— `.wbs-mdp-dock`（`position:fixed; right:0; top/height 取 #root`）替代居中 `.wbs-mdp-modal`，视觉与官方 md 详情面板一致。**③ 对话左移（让位量）** —— 给 `.conversation-shell` 加 `margin-right`；让位量按 `shift = holder.right - dock.left`（`holder = shell.parentElement`）**反推**，而**不是**「我的宽度 − 官方面板宽度」—— 后者在官方面板中途收起时会算少，导致对话滑到我的面板下面；MutationObserver 同时监听 shell **与其父容器**的 style ⇒ 官方面板开/关时让位量**自愈**。**④ 拖动调宽 + header 收敛** —— 左缘 8px `grip` 拖动改宽（**双击复位默认宽**，宽度存 `localStorage['workdaddy.mdQuickViewWidth']`）；拖动 move/up 挂 `window` **捕获阶段**（`setPointerCapture` 在本环境不生效）、加 `buttons & 1 === 0` 防按下态泄漏 + `blur` 兜底；长路径经 `mdqvShortPath` 中段省略 + `nowrap/ellipsis`（实测 header 117px → 65px）。**实测（CDP 真实鼠标）**：点产物面板里的真实 md 条目 **207–323 ms** 打开、官方查看器**完全未冷启动**（`officialViewerPresent:false`）；shell 右边缘 1902 **紧贴** dock 左边缘 1902（让位误差 `flush=0`）；拖宽 658→798、双击复位 658；关闭还原 `shellMR→0px`；Esc 关闭、逃生口（用官方查看器打开）正常。 | `scripts/inject.js`（i18n / `.wbs-mdp-*` CSS / 主逻辑块 / 拦截器 / 守卫 / 清理增补） |

| **md 快速查看器：接管「自动打开的 md」+ 观感补齐（待办 T32）** | 用户两点反馈：① 任务跑完后 WorkBuddy **自己打开**的 md 走不走插件？② 停靠面板「寡淡」—— 颜色/图标丢了。**① 自动打开只能事后接管**：官方那条路是**程序化**调用、**不派发 DOM click** ⇒ 捕获阶段拦不到（实测确认）。改为 **600 ms 轮询** `.artifact-tab--active[title$=".md"]`，一旦出现就换成我方停靠面板并点掉官方 tab（省掉它 ~30 s 的 chunk 解析）。三条边界防「自己弹面板」：**基线豁免**（注入那一刻已开着的 md tab 标 `__wbsAdoptSkip`，永不接管）、**每 tab 只处理一次**（标记打在元素上，随元素移除自动回收）、**逃生口冷却**（点过「用官方查看器打开」后 10 s 内出现的 tab 一律豁免）。开关 `#wbs-md-auto-adopt`（默认开）。**② 观感补齐**：新增零依赖语法高亮 `wbsHighlight()`（web / py / sh / sql 四组关键词 + 字符串/注释/数字/内置对象/函数名/类名八类 token，**逐 token 过 `esc()`、绝不把源码原文拼进 innerHTML**，未知语言退化为只认字符串/注释/数字）；代码块加**顶栏（语言标签 + 复制按钮，真监听器，`navigator.clipboard` → `execCommand` 回落，点完闪「已复制」）**；行内白名单扩到 `<br>` / `<kbd>` / `<mark>` / `<sub>` / `<sup>` / `<small>` / `<u>` / `<img http(s)>`（`<img>` 只放行 http(s) 的 `src`，其余属性一律丢弃）；字体栈补 `"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji"`（**在此之前 emoji 被雅黑替换成单色字形** —— 同一段文本宽度实测 334.97 px → 331.45 px 佐证）、`::marker` 上色、引用块加底与圆角。**实测**：1337 行 / 105 KB 报告 **491 ms** 打开、4 个代码块全带复制按钮、33 处高亮 `span`、58 张表、`<td><br>` 白名单生效、字体栈含 emoji 字体、`Esc` 关闭后 `margin-right` 清零且主线程全程可响应。 | `scripts/inject.js`（i18n / `.wbs-mdp-*` 与 `.wbs-hl-*` CSS / `wbsHighlight` / `wbsSafeImg` / `wbsHlClass` / `mdqvInline` / `mdqvRender` / `mdqvCopyText` / `mdqvBindCodeCopy` / `mdqvAdoptTick` / 面板开关） |

**用量看板实测口径（2026-09-23）**

- 三条路由：`GET /usage-board/<file>`（**静态、无鉴权**；目录路径回落到最新一份 dashboard，供 iframe 直接加载 `chart.umd.min.js` 等同目录文件）、`GET /api/usage-board/status`（带 token）、`POST /api/usage-board/generate`（带 token，spawn Python 抽取器，120 s 超时）。
- **为什么静态路由不能带 token**：iframe 无法附加自定义请求头；而 daemon 的鉴权只挂在 `/api/` 前缀上（`startServer` 里 `if (req.url.startsWith('/api/'))` 才进 `handleApi`）⇒ 非 `/api/` 路径天然是公共面。实测：无 token 取 `/usage-board/` = 200，取 `/api/usage-board/status` = 401。
- **「iframe 到底加载成功没有」的判据（可复用）**：跨域加载成功 ⇒ `iframe.contentDocument === null`，且读 `contentWindow.location.href` 抛 `SecurityError`；**若被 CSP 挡住** ⇒ 停在 same-origin 的 `about:blank`，`contentDocument` 非 null。本次实测 `null` + `SecurityError` ⇒ **未被 CSP 拦，真加载了**。
- 生成耗时：首次 11.3 s（遍历 2617 个 trace），稳态 7.3–7.5 s。抽取器只读 `~/.workbuddy`（`workbuddy.db` 以 `file:...?mode=ro` 打开），**默认零外网**（仅 `--billing-token-file` 才联网；本接口不传该参数）。
- 页面：弹窗 `min(1560px,100vw-48px) × min(92vh,1120px)`（实测 2560×1392 窗口 ⇒ 1560×1120，iframe 1238×838）。
- 口径差异（与自绘「用量统计」并存，属预期）：看板读 **traces（30 天窗口）**，实测 331 请求 / 45 会话 / 549.05M token / 思考 10.77 h / credit 2080.74 / 错误 67 / 缓存命中 96.2%；自绘统计读 **projects 下 jsonl**，7 天口径 17.57 亿 input。**两者不是同一数据源，别直接对数。**
- ⚠️ 首次运行即暴露：本机已有 **24 个历史会话的逐笔明细被 30 天清理**（credit 合计 3346.42 只存在于 `session_usage.credit_json`）⇒ 印证「看板类工具必须定期运行/归档」这一条（对应待办 T24）。

**实测口径（2026-09-23，CDP 活体验证）**

- 数据源判别：`cr-frame--left` = 助手、`cr-frame--right` = 用户；帧内 `cr-text-block` 之和**已排除** `cr-reasoning`（实测 3090 字）与工具区（`cr-tool-call__slot` / `cr-tool-exec__command`）。
- **不能用帧总长做差分**：帧总长会因工具块折叠而回退（实测 14421 → 12499 → 13824）⇒ 出现负增量；`cr-text-block` 之和在流式期间单调（实测 6404 → 6466 → 7315），且「正在输出的那一段」也计入。
- 开销：**0.062 ms/次**（DOM 1759 节点、300 次均值），1 Hz ⇒ **≈0.006% CPU**。热路径只用 `querySelectorAll` + `textContent`，无 `innerText` / `getBoundingClientRect`，不触发同步布局。
- **定位方式（2026-09-23 晚改版）**：读数节点**常驻 `<body>` 直下 + `position:fixed`**，用 `left/top` 定位 —— 必须挂 body 直下，因为祖先若有 `transform`/`filter`，`fixed` 会被「就近吸附」导致坐标全错。**默认位**由宿主 `.conversation-input-area__disclaimer` 的矩形算一次（左 +6px、垂直居中；先 `hidden=false` 再量，否则 `offsetHeight=0` 算不准）；此后的 `getBoundingClientRect` / `offsetWidth` 只在「按住拖动」「窗口 resize」这类一次性/交互路径里读，**1 s tick 里一行都不读**。
- 节点标 `data-wbs-i18n-skip`（否则每次变值都会触发全局 i18n 扫描）。
- **已废弃的旧落点**：曾挂在右下角 `.wbs-fab`（图标本身仅 41×32），13 px 字号在 2K 屏实测看不清 ⇒ 迁走。
- **可拖动（2026-09-23 追加）**：拖动只改 `left/top`，**手势中绝不搬动节点**。两条实测硬教训 —— ① 把节点在手势中改挂父节点，Chrome 会**立刻释放指针捕获**（`lostpointercapture` 立即触发）⇒ 拖动失效；② `setPointerCapture` 在本环境（WorkBuddy / CDP 注入的鼠标事件）**本就不生效**（`gotpointercapture` 从不触发、press 后 `pointermove` 一条都收不到）⇒ move/up 一律挂 `window` 的**捕获阶段**（第三参 `true`），指针拖出小框也照样跟手；`pointercancel` 与 `blur` 兜底收尾（拖到一半切窗口不会卡在 `is-dragging`）。位置存 `localStorage['wbs-token-rate-pos-<profile>']`（按账号隔离，切号不串位）；窗口 `resize` 时若用户**没**手动定过位则重新贴回输入框。`pointerdown` 里的 `preventDefault()` **不会**掐掉 `click`/`dblclick`（实测双击照常触发）⇒ 双击复位安全。
- **可拖动验证（CDP 真实鼠标事件，12/12 PASS）**：位置跟手（落点与目标点一致，容差 ≤4 px）／`localStorage` 已落盘／等 2 s 不被 tick 弹回／双击复位回默认位且存储清空／热更（≈重开会话）后仍记得原位置。驱动方式：伪造 `cr-frame--left` + `cr-text-block` 假帧喂真实 tick，让读数自己出现 —— 测的是生产路径，不是手搓元素。⚠️ 验证时 `mouseReleased` **必须落在视口内**，否则残留按下态会污染后续所有用例。
- **保留上次读数 + 面板开关（2026-09-23 追加）**：`setTokenRateBadge('')` 不再 `hidden=true`，改为加 `.is-stale`（`opacity:.42`）—— **只在「从未读到过」时才保持隐藏**，避免刚加载就闪一个空框。开关 `#wbs-sess-token-rate` 在面板 `data-pane="enhance"` 的 `#wbs-ac-card` 内（与「会话消息索引」同区），`change` → `applyTokenRateEnabled()`：关 ⇒ 立即 `hidden=true` 并停算；开 ⇒ 恢复上次读数并重算。偏好跨会话持久（`localStorage` 全局键，不按账号隔离）。
- **开关实测（CDP 活体，全绿）**：初始 `checked=true` / key `null`（默认开）；点一下 ⇒ badge `hidden=true` + key `0`；再点 ⇒ badge 恢复可见 + key `1`。静置 10 s：badge **仍在**、文本保留上次 `≈ 60.7 tok/s`、`is-stale` 命中、`opacity=0.42`（**不消失**，符合预期）。
- **同批修掉两处补丁锚点错误（本可通过实测发现，故记一笔）**：① 模板插入点落在「会话消息索引」行的 `</div>` **之前** ⇒ token 行被**嵌进**前一行的 `<div class="wbs-nd-row">` 内部（DOM 层级错误）；② `swT` 接线被插进 `swN.addEventListener('change', …)` 回调**内部** ⇒ 开关的 `change` 监听**只有先切换「会话消息索引」才会挂上**，独自点击无效。修法：把 `</div>` 提前让两行成为兄弟；把 `swT` 接线移出 `swN` 回调到同级。**教训：新增面板控件时，「模板锚点」与「接线锚点」都可能落在前一个控件的闭包/元素内部 —— 改完必须用 CDP 读一次真实 DOM 层级与 `change` 是否独立生效，不能只看 `--check` 通过。**

| **模型效率（待办 T20：思考效率与模型性价比）** | 账号页工具栏新增**速度表图标**入口，弹窗一张「模型 × 输出 × tok/s × credit/1k × 每次」表，只回答一个问题：**哪个模型快、哪个划算**。三个数据源合成 —— **思考秒数**取 traces 里 `type=generation` span 的 `duration` 之和（端到端 wall-clock，**含排队/网络**，非模型算力时间）、**token** 取 `token-stats.js`、**积分**取 `credit-usage.db` 按模型 `SUM`（**权威表，绝不用 token 占比摊派**）。**模型归属**是本轮最硬的问题：本机 2732 个 trace 里只有 **363 个（13%）** 自带 `trace.modelInfo.models`，其余全缺模型；解法是**时间窗对齐** —— generation span 的 `[startedAt, endedAt]` 就是一次 LLM 调用，与 jsonl 里每条带 `(timestamp, model)` 的调用点对齐，**多候选一律判歧义、不猜**（宽容量 前 1.5 s / 后 2 s）。实测 7 天：唯一命中 92.0%、歧义 0.3%、无候选 7.7%，**按时长可归属 91%**（归属率如实印在脚注）。性能：冷扫 2732 文件 3–8 s、**热（增量缓存）98 ms**；窗口外 trace 只读 64 KB 头（1756/2732 命中），窗口内才全文 parse。**口径留白而非填 0**：缺时长 ⇒ tok/s 为 `null`；积分表没有该模型 ⇒ credit 列留空并在脚注说明「不用 token 占比摊派替代」。 | `scripts/thinking-stats.js`（新建）、`scripts/daemon.js`（`GET /api/thinking-stats`）、`scripts/credit-usage-store.js`（`listModelUsageRange`）、`scripts/inject.js`（`onThinkingPerf` + `perfTableHtml` + `.wbs-perf-*` CSS + 工具栏入口） |

### 缺陷修复

| 项 | 内容 | 落地位置 |
|---|---|---|
| **渲染进程卡死（本仓自伤，已整块回滚）** | 做「官方面板展开时，用它的宽度把插件面板放大到**完全覆盖**它」时，在**官方面板同时打开**的场景下把渲染进程打满 CPU：此后主线程**不再响应任何 CDP** —— `Runtime.evaluate`、`Page.reload`、`Runtime.terminateExecution`、`Debugger.pause` **全部超时**，窗口永久无响应（daemon.log 里同时刻那次自动化任务的 CDP 调用也没返回，`finish` 行缺失），只能杀渲染进程让 Chromium 重建（副作用：界面退回首页，会话本身无损）。根因是**几何量互为输入的自激环**：面板宽度取自 `.detail-panel-container` 的 rect，而同一段代码又写 `.conversation-shell` 的 `margin-right`，两者互相追着变；且这个重排被放进 `MutationObserver` 回调 ⇒ 以**微任务**速度无限重算、主线程永不 yield。**前置证据**：加覆盖之前的版本在同一场景（面板 1148 + 我方面板 666 并存）实测过、并未卡死 ⇒ 可以锁定是覆盖引入。处置：① **整块回滚**（面板恒 `right:0` + 用户宽度；与官方面板并存时允许重叠，该场景罕见且接管路径本就会关掉官方 md tab）；② 给观察者回调加**自激环自救闸** —— 连续 30 次调用间隔 ≤3 ms 即摘掉观察者，宁可布局停止跟随也绝不卡死进程。 | `scripts/inject.js`（`mdqvPlace` / `mdqvReapply` / 布局状态变量） |
| **看板积分虚增 ≈49 倍（269 956 → 2 924）** | 看板报「总积分 269 956.75」，而权威源 `credit-usage.db` 只有 2 919。**根因不是算错字段，是重复计数**：`session_usage.credit_json` 的键是请求 id，要靠 jsonl 反查日期/模型，而**同一个 id 会出现在多条 jsonl 记录里**（父子引用等），旧实现逐行累加 ⇒ 同一请求被反复计入，且虚增几乎全堆在「今天」（09-23 一天 191 179 积分 = 71%），趋势图完全失真。修法两层：① 积分改走**权威源** `credit-usage.db.credit_usage_records`（逐请求，自带 `uid + usage_date + model`，不需要猜归属）；② 兜底路径 `splitSessionCredit` 加 `counted` 全局集合（每个 id 只计一次），拆不动的如实计入 orphan，**不静默丢弃**。逐日核对与 DB 直读完全一致（09-23：191 179 → **168.39**）。 | `scripts/usage-unified.js`（`readCreditRecords` / `CREDIT_RECORDS_SQL` / `splitSessionCredit`）、`scripts/daemon.js`（`creditUsageQuery()` → 生成路由传 `queryCredit` + `profileId`） |
| **任务完成后打开 md 报告严重卡顿 / 界面几乎不空闲** | V8 CPU profile 实测打开后**空闲 ≈ 0%**（采样 1.64/ms ≈ 满负荷）。三层根因**全部来自本仓注入脚本**：① `findComposer()` 每轮 4–5 次 `querySelectorAll('[contenteditable]')` + 逐候选 `getBoundingClientRect()`/`getComputedStyle()` ⇒ **强制同步布局**；② `automationState.pollTimer = setInterval(load, 2500)` **在 build 时无条件启动**，面板全关照跑、实际 ~1.4 s 周期整块重绘（独占 **42%** 主线程）；③ `updateDebugPanel` 即使 `display:none` 也每 500 ms 全量测量。修法 7 处：可见性/相关性助手 + observer 过滤 + `findComposer` 缓存 + debugPanel 早退 + automation 轮询按「面板展开 + tab 命中」门控 + `render` 门控 + `switchTab` 主动重载一次。**修复后空闲 94.5%，`render` 2 811 ms → 0，`(program)` 3 888 ms → 3 ms。** 残留 `getBoundingClientRect` 350 ms 属**官方**消息导航适配器 rAF 重绑，非本仓。 | `scripts/inject.js`（7 处） |
| **统一看板「总 token」把缓存算了两遍（虚增 ≈+98%）** | 旧公式 `tokTotal = i + o + cr + cw`。但本机 usage 记录的 `total_tokens = input_tokens + output_tokens`，而 `cache_read_input_tokens` 与 `completion_thinking_tokens` **已经包含**在 input / output 内（**4017 条 co-occur 实测**，`cache_read` 占 input 约 98%）⇒ 缓存被重复计入。修法：`tokTotal(r) = num(r.i) + num(r.o)`，并把「缓存读取 / 思维链」降级为**子集口径**（图上标注「含于输入」「含于输出」，明细表列名同样改写）。同时删掉「全部 Token」这个**本身就是重复计**的指标按钮。 | `scripts/usage-board-html.js`（P4 / P2 / P5 / P6 / P7） |
| **看板滚动期本仓自耗（实测归因）** | 5 s 滚动窗口 CPU profile 归因：本仓注入脚本自耗 **166 ms = 3.1%**，其中 `updateActive` 独占 **137 ms** —— 它每次 `querySelectorAll('.cr-document__virtual-item[data-index]')` 遍历整棵会话子树，并对**每个**虚拟项 `getBoundingClientRect()`（强制同步布局），而它被 `scrollElement.addEventListener('scroll', scheduleActive)` 以滚动频率驱动。修法：**12.5 Hz 尾沿节流**（滚动停下必补最后一次，高亮不会落错）+ **虚拟项列表缓存 1 s**（消息变化即作废）+ 索引条不可见直接早退 + `position()` 与高亮共用同一闸门。**修复后自耗 166 ms → 58.6 ms（3.1% → 1.1%），`updateActive` 137 → 27.5 ms。** | `scripts/inject.js`（7 处） |

| **看板副产物无限堆积（每天 ≈580 KB，永不回收）** | 旧 `/api/usage-board/generate` 会裁剪 `-dashboard-*.html` 与 `usage-full-*.csv`，但现行 `/api/usage-unified/generate` **只裁剪自有产物** `unified-board-*` / `unified-usage-*` ⇒ 第三方抽取器每次落下的 `workbuddy-usage-status-dashboard-<stamp>.html`（≈507 KB）与 `usage-full-<stamp>.csv`（≈72 KB）**从不回收**。实测已堆到 **13 + 13 份 ≈ 9.4 MB**；一旦挂上每日 automation 就是每天 +580 KB、无上限。修法：统一生成路径补两条 `prune(..., 3)`，与旧路径策略一致。修复后实测 **13 → 3 / 13 → 3**。 | `scripts/daemon.js`（`/api/usage-unified/generate` 的 prune 块） |

| **热更副本全局监听器堆叠 ⇒ 插件按钮「点了没反应」** | **症状**：md 快速查看器弹层里的四个按钮全部失效（连「关闭」都不响应），且无任何异常抛出。**根因不在新代码，在 `inject.js` 头部的兜底清理 IIFE**：它只移除历史版本的 **DOM 节点**（`#wbs-style` / `.wbs-root` / 各按钮 / `.wbs-message-nav-root` / 诊断徽章）与 `window.__wbsBuilds` 里的旧 build，**从不移除旧副本挂在 `document` / `window` 上的事件监听器**。每 `POST /api/inject` 一次就多留一份 document 捕获监听 —— 实测堆到 **document 上 8 个 click（其中 7 个 capture）、window 上 3 个**，多份互相 `stopPropagation` 抢事件，谁先注册谁把后续全掐掉。**修法 = 代际守卫**：每次注入生成唯一 `WBS_GENERATION`（写在清理之后、守卫之前）并挂 `window.__wbsGeneration`；每个全局监听器首行 `if (window.__wbsGeneration !== WBS_GENERATION) return;` ⇒ 旧副本自动让位，无需反注册（也没法可靠反注册闭包）。清理 IIFE 同时补清 `#wbs-mdp-modal`。**顺带收益**：这个缺陷此前一直在悄悄影响**所有**热更后的按钮类功能，只是没被触发到「同一元素被多份监听争抢」的程度。**排查路径（下次复用）**：合成 click 无效 → `DOMDebugger.getEventListeners` 确认按钮确有监听 → 加临时探针确认处理器**根本没执行** → 事件矩阵测试发现冒泡被截断 → dump 各层监听器数量定位到 document 堆叠。 | `scripts/inject.js`（顶部代际标记 + `mdqvInstall` 守卫 + 清理 IIFE 增补） |

| **右上角产物面板的 md 条目没走快速查看器（T31 补拦）** | 用户实测反馈：正文产物卡里的 md 已能秒开，但**从右上角「查看所有产物」面板里点开 md 仍是官方 14 s 冷启动**。根因＝拦截器只认 `.artifact-slot-panel__card[data-ext="md"]`，**漏掉**产物面板条目 `.cb-overview-artifact-item[data-ext="md"]`（两者是**两套独立 DOM**）。且两者 `data-dir` **形态不同**：正文卡是未编码绝对路径，面板条目是 `file:///` + %XX 编码 URL ⇒ 直接 `fetch` 会拿编码串当路径而失败。修法：`closest()` 扩为三候选 + 新增 `mdqvNormPath()` 归一化（剥 `file:///` 前缀 / `decodeURIComponent` / `/C:/`→`C:/`）。实测 33 KB / 389 行 md 正确渲染，真实鼠标点面板条目 207–323 ms 打开。 | `scripts/inject.js`（`mdqvInstall` 拦截器 + `mdqvNormPath`） |
| **md 停靠面板 header 被长路径撑高** | 面板宽度收到 658px 时，头部文件路径折成 3 行、head 高 117px，挤掉正文可视区。修法：`mdqvShortPath()` 路径中段省略（完整路径走 `title` 悬停）+ header `flex-wrap:wrap` + 文件名/元信息 `nowrap` + `overflow:hidden` + `text-overflow:ellipsis` ⇒ head 收到 65px、标题与元信息各 1 行。 | `scripts/inject.js`（`mdqvShortPath` + `.wbs-mdp-*` CSS） |
| **md 停靠面板拖动改宽会「按下态泄漏」** | 实测踩到：若某次 `pointerup` 丢失，后续 `pointermove` 会**持续改宽**（表现像「松手了还在变宽」）。修法：`onGripMove` 首行判 `if ((ev.buttons & 1) === 0) { onGripUp(); return; }`，并加 `window` `blur` 兜底收尾（拖到一半切窗口不会卡住）。 | `scripts/inject.js`（`mdqvOpen` 的 grip 拖动块） |

| **新模块漏登记 mac DMG 白名单（mac 上 daemon 启动即崩）** | 新增 `stats-discipline.js` / `thinking-stats.js` 并 require 进 daemon 后**只影响 Windows 侧**（`cp -R` 整目录，无感），而 mac 走的是 `build-mac-dmg.sh` 里的**显式白名单**，漏一个就启动即崩 —— CI 绿灯**证明不了**新模块进包。被两条既有守卫当场抓住（`test-auto-copy-leader.js` H2 / `test-account-health.js` E24）。更深一层：这两条守卫**只扫 `daemon.js` 的直接 require** ⇒ 二级依赖（`daemon → token-stats → stats-discipline`）**根本看不见**，而 `stats-discipline.js` 正是被这样漏掉的那一个。 | `scripts/build-mac-dmg.sh`（`for f in` 循环 + `chmod` 清单各加两行；顺带补回上一轮漏加的 `usage-unified.js` / `usage-board-html.js` / `session-cost.js`） |
| **无时间戳台账只在缓存路径暴露（非缓存路径静默丢）** | 纪律 1 要求「拿不到时间戳就**留空并留痕**」：`scanTokenStatsCached` 带了 `undated` + `warnings`，而 `scanTokenStats`（CLI 与测试走的非缓存路径）**静默丢掉**这两个字段 —— 「留空但不说」等于用户永远不知道总量少了一块。由本轮新增套件的 A13–A17 断言抓出。 | `scripts/token-stats.js`（`aggregateRecords` 补 `undated` + `warnings`，与 `aggregateCachedBuckets` 对齐） |
| **T20 面板曾挂在「已失去入口的死代码」上（功能等于没做）** | `onTokenStats`（自绘「用量统计」）的入口在 2026-09-23 融合进「用量看板」时被**刻意摘掉**（见 `.wd-tmp/patch-inject-unified.js`），此后它是死代码。我最初把 T20 表挂在它的 `load()` 里 —— 接口全绿、代码全对、回归全过，**但用户永远点不到**。直到 CDP 活体验证才暴露：面板能开、`.wbs-perf-table` 恒为 0。改为独立入口 `onThinkingPerf`，并**摘掉死代码里的渲染副本**（两份实现必然漂移，已加反向守卫断言）。 | `scripts/inject.js`（新增 `onThinkingPerf` / `perfTableHtml` / 工具栏按钮 + 接线；删除 `loadThinkingPerf` 及其调用） |
| **`DAEMON_BUILD_ID` 的守卫写死了上一轮的特性名** | `test-usage-unified-credit.js` E4 断言 buildId 必须匹配 `-usage-unified-r(\d+)$` 且 `n ≥ 2` —— 那是**上一轮**的特性名，本轮一 bump 就**假红**（当场红）。改为形状判据 `release-<版本>-<yyyymmdd>-<特性>-r<n>`；「到底有没有真的递增」交给 `test-archive-isolation.js` D0（运行中 daemon 的 buildId 必须等于源码里的），分工写入注释。 | `.wd-analysis/test-usage-unified-credit.js` |
| **`scripts/session-cost.js` 行尾被污染成 LF（收尾自查发现）** | 本仓铁律：`scripts/*.js` **一律 CRLF**（`verify-win.cmd` / 打包脚本按行切分都依赖它）。收尾逐个量 `bareLF` 时发现该文件 **275 处裸 LF**、与同目录其余脚本（`token-stats` / `credit-usage-store` / `daemon` / `inject` 全为 0）不一致。**取证走过的弯路（记一笔）**：该文件是 T21 新建、**从未提交**（`git status` 显示 `??`），所以 `git show HEAD:scripts/session-cost.js` 返回**空内容**，我那个「原始版本 bareLF=0」的对照是**拿空串算出来的假读数** —— 判据必须是「同目录同类文件横向比」而不是「与 HEAD 比」。已归一化为 CRLF（275 CRLF / 0 bareLF）并过 `node --check`。 | `scripts/session-cost.js` |

| **积分效率图「条长拉满」时两段文字叠字（`hy4-preview` 数值看不清）** | **症状**：积分效率图里效率最高的那个模型（`hy4-preview`，13.36 积分/百万，约是第二名的 9 倍）右侧数值与别的文字糊成一团。**根因是坐标撞车，不是溢出**：该模型 `len == barW == 736`（条正好画满），而「条内小字」（该模型合计积分）被画在 `x = padL + len + 6 = 910`，右侧刻度值固定在 `x = padL + barW + 8 = 912` —— **两段文字左边界只差 2px、同一基线**，必然重叠。图注写的就是「条内小字」，即**原意是画在条内**，实现却画在了条尾之后。**修法**：按图注画进条内（`text-anchor="end"` 右对齐到条尾，`x = padL + len - 6`）；条太短塞不下时（`len < 文本宽 + 10`）才退回条尾之后 —— 此时 x 离右侧刻度还差几百 px，不会撞。条内文字用白字 + `paint-order:stroke` 描一圈半透明深色，任何条色下都可读。**实测**：最长条上小字落 `x=898`（旧为 910），渲染后逐行求包围盒，**同行重叠对数 = 0**。 | `scripts/usage-board-html.js`（`renderEfficiency`） |

| **账号 × 模型数值严重错误（一个账号吃掉 79% token，账单说它只占 27% 请求）** | **症状**：`18688296454` 的 token/次数占了将近八成，另两个账号近乎为零，「未归属账号」还独占 272M；同一模型跨账号的 **tok/credit 相差 800 倍**（2.9M vs 3.8K）。**根因（本地文件根本判不出账号）**：AutoCopy 把**同一个会话复制成「每个账号一份」**（`copy-manifest.json` 87 条 / 36 组 / **19 组是多副本**），而三份副本在磁盘上是**字节级一致**的 —— 19 个镜像组 27 788 条 usage 行去重后仅 10 649 条，**digest 并集 ÷ 单文件最大值 = 1.00**，组内行数逐组完全相等。于是 `distinctRecords()` 的「内嵌源会话是否也持有同一行」判据（§24）会把**每一行**都判成「原产于内嵌会话 id」，也就是**整个会话的用量全压到会话创建者一个账号上**。换成 `copy-manifest` 的 id→uid 归属结果几乎不变 ⇒ 不是映射源选错，是判据本身失效。逐日铁证：09-14 账单 16/31/30 请求（近均分），token 侧却 **0/0/2139**；记录里也没有可用的逐账号信号（61 941 条 usage 行带账号字段的 = **0**）。**修法**：账号维度只认权威源 —— 账单 `credit_usage_records` 的 `(uid, usage_date, model)` 请求数。新增 `apportionTokensByBill()`，把 token 侧按 **(日 × 模型)** 合出总量后按账单同日同模型的逐账号**请求数占比**分摊；某「日×模型」无账单时退回「当天整体占比」，当天也没有则保持原归属并计入 `fallback` 由界面「数据口径提示」如实暴露。**两条硬约束**：① 必须在「credit 合并进桶」**之前**分摊（否则会出现 token 记 A、积分记 B 的重影桶）；② 总量必须**逐位守恒**（单进程内 `buildUsageUnified` vs `scanTokenStatsCached` 差 = 0；跨进程比会假红，因为今天的数据正被当前会话写入）。**效果**：该账号份额 79% → **26%**（账单请求份额 27%）、未归属大块归零、桶数 149 → **132**、逐账号积分与账单**逐分相等**、与账单请求份额最大偏差 **52pp → 4.5pp**。**已知边界**：账单只覆盖 `credit-usage.db` 同步到的天数（本机 09-14 起），更早的天数无账单可依，仍为旧口径（本机 5 241 次调用 / 635M token），已在界面写明。 | `scripts/usage-unified.js`（新增 `apportionTokensByBill` / `bucketKey` / `dayModelKey`；`meta.accountAttribution`；2 条 `warnings`） |

| **会话排行标题显示成「乱码」（其实是裸 UUID，不是编码坏了）** | **症状**：会话排行 15 行里 12 行的标题看起来是乱码。**先排除编码**：三方来源全量扫描（第三方抽取器 / `copy-manifest` / `sessions` 表）**真乱码 = 0 条**（无 `U+FFFD`、无典型 mojibake）。真实原因是**标题缺失 + 前端回落太粗暴**：渲染层写的是 `esc(r2.title \|\| r2.sessionId \|\| '-')`，标题为空就回落成 36 位 UUID —— 在表里看着就是乱码。缺失原因是这些会话已被官方清理：前 15 名里 **12 个会话 id 在三个索引里都查不到标题**，jsonl 也只剩 `.meta.json`（里面**只有** `codebuddy.ai/hostKind` 与 `acpConnectionId`，没有标题）⇒ **无从还原**。**修法**：① 渲染层不再回落裸 UUID，缺失时给可读占位 `(未命名会话 · <短id>)` 并把完整会话 id 放进 `title` 悬停，既不编造假标题也不丢线索；② 数据层从 `sessions` 表补标题（`readSessionOwners` 顺手修掉「SELECT 里没有 `custom_title` 却在读它」的字段漏选）。**不采用** `by_session[].q`（首条用户消息）当标题 —— 实测其中含 `SecretId:AKID…` 之类的凭据。**实测**：裸 UUID 标题 **0** 条，占位 12 / 真实 3。 | `scripts/usage-board-html.js`（`renderEnrich` 会话排行）、`scripts/usage-unified.js`（`readSessionOwners` 补 `custom_title`） |

| **会话排行从「未命名会话」占位 → 真实会话名（把两套 id 用 jsonl 桥接回来）** | **症状**：上一轮把裸 UUID 换成了占位符，前 15 名里 **12 行仍是「未命名会话」** —— 可读性变好了，**根因一动没动**（只是把"看不懂"变成"看得出没名字"）。**根因是两套 id 对不上**：排行的 id 取自官方 trace 的 `sessionId`（＝会话**原始 id**），而「插件会话页」读的 `workbuddy.db[sessions]` 存的是 AutoCopy 切号时**逐账号复制出来的副本 id**；直接拿原始 id 查库 **12/12 全落空**。所以「照抄插件会话页的取名方法」最多只能救 3 条 —— 它的**取值口径**（`custom_title \|\| title`）值得抄，**取值键**必须换。**方案**：新增多源解析器 `session-titles.js`，按可信度依次回补 —— ① `sessions` 表（口径同上）→ ② 副本血缘（`meta.json` 的 `autoCopy.sessions[].members` **＋** `sessionIndex[uid][原始id] = lineage`，**缺了后者原始 id 就接不回来**）→ ③ 自持标题快照 → ④ **jsonl 桥**（副本 jsonl「文件名＝副本 id、内容 `sessionId`＝原始 id」互为别名，**正反双向**都可解析；并读正文 `aiTitle` 取**最后一条**＝最新标题）→ ⑤ 客户端 HTTP 缓存快照（`app/session/Cache`，WorkDaddy 自己的旧响应）→ ⑥ SDK 日志 `method:requests:result` 的首条提问（末位兜底）。**脱敏**：标题是最容易被截图外传的字段，**六个来源一律**过 `sanitizeTitle()`（AKID/ASIA/SecretId/手机号/`sk-`/长 hex）—— 且**必须包含第三方抽取器已经给出的标题**，因为官方自动标题本身就是「首条提问截断」：实测确有一条库标题里写着「账号是 1**…**」（11 位手机号），只给派生标题脱敏等于白做（这条是本轮自查抓出来的漏网）。**不编造**：全落空就留空 + 界面占位，并把 unresolved 数写进 `warnings`；**快照只增不减**（`usage-board/session-title-snapshot.json`，已有条目 / 空值一律不覆盖），官方日后清理会话行也不丢名字。**实测**：前 15 名 **15/15 有真实名**（官方库 3 / 副本血缘 7 / 标题快照 3 / 首条提问 2），占位 **0**；内嵌 payload 与无头浏览器真实渲染**双向核对一致**；解析器新增耗时 75–85 ms（构建总时 ≈9 s，大头在第三方抽取器）。 | `scripts/session-titles.js`（新建，多源解析 + `sanitizeTitle` + `mergeTitleSnapshot`）、`scripts/usage-unified.js`（`fillSessionTitles` 接线 + `readSessionOwners` 补 `custom_title` + 空白标题归一化）、`scripts/usage-board-html.js`（`TITLE_SOURCE_LABEL` 悬停来源 + 口径副标题）、`scripts/daemon.js`（`buildUsageUnified` 传 `dataDir`）、`scripts/build-mac-dmg.sh`（mac 打包白名单两处补 `session-titles.js`） |

| **`usage-unified.js` / `usage-board-html.js` 行尾也是 LF（与 `session-cost.js` 同源问题）** | 本仓铁律：`scripts/*.js` **一律 CRLF**。收尾横向比对时发现这两个文件是**纯 LF**（bareLF **663 / 998**，CRLF 0），而同目录 `daemon` / `inject` / `token-stats` / `stats-discipline` 全为 0 裸 LF。**两道打包守卫不查行尾、回归也全绿** ⇒ 只有字节级自查能发现。判据同 `session-cost.js` 那条：**与同目录同类文件横向比，别与 HEAD 比**。已归一化为 CRLF（663 / 998 CRLF、0 bareLF）并过 `node --check` + 全量回归。 | `scripts/usage-unified.js`、`scripts/usage-board-html.js` |

### 优化调整

- **明细表口径三处收口（同页两个数不再打架）**：① 合计行「积分/百万 token」原本拿**整 37 天**的 token 去除**10 天**的积分（得 0.45），改为只在**积分覆盖区间内**算（0.56，与 KPI 卡一致）；② 覆盖区间外的「积分」「积分/百万token」原本显示 `0`（会被读成"免费 / 效率极高"），改为 `—`，因为那是"**没有明细**"不是"零消费"；③ 总积分 KPI 的「日均」分母原本用整窗口 37 天（得 78.89），改为只用**有积分明细的 10 天**（292.45）。三条同一个原则：**分子分母必须同区间，缺失必须显示为缺失。**
- **积分覆盖区间只认「真正进了看板」的那些天**：`meta.credit.coveredFrom/coveredTo` 原本取全表 `MIN/MAX`，若库里还留着 90 天窗外的老记录，界面那句「明细自 X 起」就是假的 ⇒ 改为在窗口内累计时同步取边界。
- **新增回归套件 `test-usage-unified-credit.js`（42 项断言）**：覆盖① 同 id 只计一次（**含旧实现 3× 的对照实验**，证明探针真能发现该缺陷）② 权威源三维聚合（`SUM(credit)` 返回字符串也要算对）③ 兜底路径去重 ④ 窗口外记录过滤 ⑤ 看板模板占位符唯一 / payload `</script>` 转义 / **内联脚本可被 `node --check` 解析** ⑥ daemon `queryCredit` 接线与「分子分母同区间」静态守卫。已登记进 `run-regression-all.js` ⇒ **43 套件全绿**。
- **运维纪律（记一笔）**：daemon **启动时 `require` 的模块不会热更**。改 `inject.js` 只需 `POST /api/inject`；改任何被 `require` 的脚本（`usage-unified.js` / `usage-board-html.js`）**必须重启 daemon**，且**不能靠 `buildId` 判断**（没动 daemon.js 时 buildId 不变，`restart-daemon.py` 会误判"已是新构建"而跳过）⇒ 只能按 **pid 变化**确认。
- **看板可用性 14 处补丁（2026-09-23 追加）**：① 日期段新增「**今天**」「**昨天**」（`data-days=1/2`），原「近 90 天」退居其后；② 默认区间 **90 天 → 7 天**（reset 与 boot 两处）；③ 指标段删「全部 Token」，改为 输入+输出 / 缓存读取 / 思维链 / 积分 / 次数 / 单次共 6 个；④ Token 构成卡**重画**为 4 根**同比例横条**（输入含缓存读取 / 其中缓存读取 / 输出含思维链 / 其中思维链）+ 5 项指标卡（合计、输出÷输入、缓存读取÷输入、思维链÷输出、缓存写入），替换旧版「四项堆成一条 100% 条」的画法（那种画法天然把缓存算两遍）；⑤ 明细表重排列序并新增**合计(输入+输出)**列、去掉独立的思维链列、表头带**口径小字**；⑥ KPI 卡加「**今日**」副标题。
- **token 速度读数：改判「默认关闭」+ 口径改内容感知 + 拖动加事件盾（2026-09-23 追加）**。三条根因：① 口径是「正文文字数 ÷ `1.8`」的一刀切经验系数 ⇒ 纯英文低估近半、纯中文偏高，**本质是估算不是真值**；② 模型只思考不输出文字时长度不变 ⇒ 3 tick 后进 `.is-stale`，体感像卡死；③ 拖动要经过预览 iframe，**指针一进 iframe 父文档 window 就收不到 `pointermove`**（跨文档无法捕获）⇒ 拖一半卡住 / 拖不动。修法：`readTokenRateEnabled()` 改为 `localStorage === '1'` 才算开（**默认关**，开关仍在面板 → 会话 → token 速度读数）；新增 `readRateEstTokens()` 按 **ASCII ÷ 3.6 / 其余 ÷ 1.3** 分类折算，替换 1.8 一刀切；拖动期间铺一层**全屏透明事件盾**（z-index 拉满，`pointerup/cancel/blur` 立即摘除），并把该类名加进 `WBS_IRRELEVANT_SEL`。面板提示语同步写明「按正文字符分类估算，非真实用量」。
- **`.workbuddy` 膨胀体检脚本**：`C:\Users\Lyon\.workbuddy` 已 **9.7 GB / 135 908 文件**（`logs` 2 917 MB、`workspace\sessions` **76 064 个文件 / 2 359 MB**）。脚本 `WorkBuddy-磁盘体检清理.js` **默认只体检不删**，预览实测可回收 **2 452 MB / 17 179 文件**（`--keep-days=N` 可调保留期，`--apply` 才真删）；**只碰 `logs/` 与 `workspace/sessions` 里过期的会话文件**，不碰 `projects/`、`app/`、配置与技能。
- **看板「每日自动刷新」已挂 automation（待办 T26 + T22 后半 + T24 断档，一箭三雕）**：新增可复用脚本 `.wd-analysis/refresh-usage-board.js`（读 `.api-token` → POST `/api/usage-unified/generate`；`--status` 只查、`--json` 给 automation 解析；退出码 0/1），并挂上**每天 09:00** 的 automation（失败时先 `restart-daemon-anyway.py` 拉起 daemon 再重试一次）。**为什么必须每天跑**：官方只保留 **30 天**逐笔明细（已证），而 `credit-usage.db` 是**我们自己的持久库**（`ON CONFLICT ... DO UPDATE` 累加）⇒ 只有每天跑一次，才能把官方还没清掉的明细先落进本机库；否则历史永久断档（本机已有 **24 个会话**只剩汇总，credit 3 447.85）。实测：一次刷新 **8.1 s**，产物 `unified-board-<stamp>.html` 83 KB / 146 buckets / 积分合计 2 973.94。
- **磁盘体检脚本升级为「默认走回收站」**：原 `--apply` 直接 `fs.unlinkSync`（不可恢复）；现改为 **PowerShell + `Microsoft.VisualBasic.FileIO.FileSystem` 送回收站**（可还原），永久删除必须显式 `--apply --hard`；另加两处可核对性 —— 删后**清空 `logs/`、`sessions/` 下的空目录**，以及把「将删清单」落盘 `workbuddy-cleanup-targets.txt`。预览实测可回收 **17 172 个文件 / 2 451.6 MB**（保留最近 14 天）。**执行仍需用户点头**（删文件属不可逆动作）。
- **统计工程纪律落地为可执行模块（待办 T23；来源：wb-credits 的五条纪律）**：新增 `scripts/stats-discipline.js`，把五条**口径纪律**做成「一处定义、各处 require」的零件（`token-stats` / `session-cost` / `thinking-stats` 都改走它），避免历史上那种「命中率到底是 `cached/input` 还是 `cached/(input+cached)`」在两处各给一个答案的局面。五条与本轮的具体收口：
  - **① 数字错比报错糟糕** —— `parseTimestamp` 取消 `now` 回落（旧行为：导入的历史用量在时间轴上**跳到今天**，而总量仍然对得上 ⇒ 用户不会去核对，他会直接信）；无时间戳的记录进 `undated` 台账并被**显式暴露**；结构不匹配抛结构化 `StatsError`，由 daemon 路由映射成 400 而不是 500。
  - **② 只读打开** —— sqlite 一律 `{ readOnly: true, fileMustExist: true }`（路径写错时**报错**，而不是新建一个空库、再读出「0 条记录」一本正经地展示出来 —— 本轮实测踩到过）；统计模块里**不许出现写模式打开**，已加反向守卫断言。
  - **③ 只读头部/尾部** —— 见下一条踩坑。
  - **④ 参数组合做不到就报错** —— `dateBounds` 拒绝 `from` + `days` 同给（旧行为：静默用 `from`）、拒绝只给 `until`（旧行为：静默忽略 `until`）；越界 / 非整数 `days` 一律 `bad-param`，**不夹紧后继续**。
  - **⑤ 命中率分母守卫** —— 口径 `cached ÷ input`（本仓 `input_tokens` **已含** `cache_read_input_tokens`）；实测 `cached > input` 时切 `cached ÷ (input + cached)` 并把 `guarded` 置真（**绝不给出 > 100% 的命中率**）；分母 ≤ 0 返回 `null` **而不是 0**（0 会被读成「缓存完全没命中」）。
- **`readHead` 对单行 JSON 会静默失效（纪律 3 的坑，记一笔）**：JSON 文件**没有换行**，而尾部读取必须「丢掉被截断的首行」（靠 `lastIndexOf('\n')`）；头部读取若沿用同一逻辑，`lastIndexOf('\n') === -1` ⇒ **整段被切成空串**，表现为「头部探测永远失败、悄悄退化成全文读」—— 不报错、结果也对，只是把纪律 3 的收益全丢了。实测头探成功 **235/2732** → 修好后 **1756 只读头 / 976 全文**。修法：`readHead` / `readTail` 按用途分 `lineMode`（尾部默认 `true`、头部默认 `false`）。
- **打包白名单守卫从「直接 require」升级为传递闭包**：共用 helper `.wd-analysis/packaging-whitelist.js`，新增 `test-auto-copy-leader.js` H3 与 `test-account-health.js` E25（当前可达 **59 个**自建模块，缺任一即红）。原判据的盲区成因见「缺陷修复」第一条。该 helper 同时提供 **CLI**：`node .wd-analysis/packaging-whitelist.js`（漏则打印缺失清单并 **exit 1**），供手册/CI 直接自查。**已做负向验证**：造一个「daemon → a → c（二级依赖）」的临时沙箱、白名单只登记 `daemon/a/b`，helper 准确报出 `["c.js"]`；补齐后返回 `[]` —— 证明它**真会响**，不是又一个永远绿灯的假守卫。

### 工程与文档

| 项 | 内容 |
|---|---|
| **回归规模** | 43 套件 / 3041 断言 → **44 套件 / 3182 断言**。新增 `test-stats-t20-discipline.js`（**139 项**）；`test-auto-copy-leader.js` 67 → 68、`test-account-health.js` 138 → 139（各补一条传递闭包白名单守卫）。 |
| **新增回归套件 `test-stats-t20-discipline.js`** | 七组：[A] 纪律 1（时间戳不回落 / 派生指标 null 不是 0 / undated 台账真实走一遍 token-stats 验总量不含它）· [B] 纪律 2（只读选项 + 写模式反向守卫，含「守卫自身有效」的对照）· [C] 纪律 3（**单行 JSON 头部探测回归**、窗口外只读头、缓存命中不补读全文）· [D] 纪律 4（9 种非法参数组合逐一必须抛 `bad-param`）· [E] 纪律 5（分母 ≤ 0 → null；`cached > input` 自动换分母且 `guarded`）· [F] T20 归属（路径 A/B、歧义、无候选、多模型不摊派、缺 `startedAt` 拒绝归属、宽松量边界 1.9 s/2.1 s）· [G] 三源合成派生口径精确 + **credit 只来自权威表**（含「不许按 output 占比摊派」的反向守卫）+ 缓存增量与版本号重建 · [H] 接线静态守卫（daemon 路由 / inject 入口 / i18n 整句入典）。全部在 `os.tmpdir()` 沙箱里跑，fixture 全是自造的合成 trace / jsonl。 |
| **回归规模（会话排行标题轮）** | 44 套件 / 3182 断言 → **45 套件 / 3210 断言**。新增 `test-session-titles.js`（**18 项**）；`test-usage-unified-credit.js` 42 → 52（补 [F] 组「会话排行标题装配」10 条）。 |
| **新增回归套件 `test-session-titles.js`** | 四组：[A] 解析优先级**不许乱序**（db → 血缘 → 快照 → 正文 aiTitle → 客户端缓存 → 首条提问；顺带钉死两个易错点 ——「快照优先于正文 aiTitle」与「aiTitle 取**最后一条**」，外加空 id / undefined 不抛）· [B] **两套 id 的 jsonl 桥**（副本文件名 ↔ 内容 `sessionId` 互为别名，**正反双向**都断言）· [C] 脱敏（派生标题与**库里官方标题**都要过，且不误伤普通中文标题；`isUsablePrompt` 拒绝 `<task-notification>` / `#` / JSON / system-reminder 类首条）· [D] 纪律与容错（快照**只增不减**、无 dataDir / 目录不存在不抛、**root 缺失只砍正文桥接**而库 / 血缘 / 快照照常可用）。全部在 `os.tmpdir()` 沙箱里用自造 fixture 跑。 |
| **共用 helper（`packaging-whitelist.js`）再次兜住漏登记** | 本轮新增的 `session-titles.js` 被 `usage-unified.js` require ⇒ mac 白名单漏登记，`test-auto-copy-leader.js` H3 与 `test-account-health.js` E25 **当场红**（`["session-titles.js"]`）。这正是**传递闭包**判据的价值：Windows 走 `cp -R` 整目录毫无症状，mac 显式白名单会**daemon 启动即崩**。已在 `build-mac-dmg.sh` 两处补齐（for 列表 + 校验清单），`packaging-whitelist.js` 自查 60 个可达模块 **0 缺失**。 |
| **`test-limit-switchback.js` 午夜假红（断言取错了文件）** | 该套件用**假时钟**做 9 分钟级等待 ⇒ 真实墙钟跨越本地午夜时，**同一次运行**会产出 `账号切换日志-<今日>.txt` 与 `-<次日>.txt` 两个文件；而 `logText()` 只取 `readdirSync` 的**最后一个**（给的是**字典序**不是 mtime，日期大的排最后）⇒ 读到的是**前一个场景**的内容 ⇒ 「W4c 日志告诉用户怎么设主账号」假红。⚠️ **产品行为本身正确**，是这条断言取错了文件 —— 2026-09-23 23:57 实测撞上（23:48 前全绿、之后连续两次红），与本次代码改动无关。改为**合并所有匹配文件**读取；连跑 3 次稳定 **138/138**。 |
| **`test-limit-switchback.js` 的「跨午夜假红」** | 该套件用假时钟做 9 分钟级等待，而桌面日志文件名带日期（`WorkDaddy-账号切换日志-YYYY-MM-DD.txt`）；`logText()` 原本只取 `readdirSync` 的**最后一个**（给的是**字典序**、不是 mtime）⇒ 真实墙钟跨过本地午夜时，同一次运行会同时产出 `-09-23` 与 `-09-24` 两个文件，而「最后一个」恰好**不含前半场**写下的断言依据 ⇒ **W4c 假红**（产品行为本身正确，是断言取错了文件）。**2026-09-23 23:57 发版前三道闸实测撞上**：同一天前三轮全绿、第四轮红，靠读「全部通过／有 N 个套件未通过」真值行才抓到（**exit code 恒为 0，只看它必漏**）。修法：改为**合并该次运行写出的全部日志文件**（`.sort()` 后逐个读、`join('')`）。⚠️ 通用教训：**「取最后一个文件」这类判据在跨日 / 跨时区场景必然脆**。 |
| **新增共用 helper** | `.wd-analysis/packaging-whitelist.js`：从入口模块出发做 require **传递闭包**，返回「可达但不在 mac 白名单里」的模块名。供两个套件共用，避免同一段判据抄两遍（原先就是抄的，也因此一起瞎）。 |
| **daemon 重启脚本归位 + 泛化** | 手册 §B.2.2 引用的 `restart-daemon.py` 在本机**缺失**（手册指令实际不可执行）⇒ 按手册流程重建并**归位到 `D:\WorkDaddy\.wd-analysis\restart-daemon.py`**（pid 与 `.daemon.lock` 互校 → taskkill → 等 watchdog respawn → 比对 buildId/pid → 热更 inject.js）。同时**去掉两处 feature 硬编码**（buildId 前缀改成形状匹配；新接口探测改为 `--probe=/api/xxx` 显式传入，默认不探）—— 否则下一轮改动会留下假报错。已实际用于本轮 T20 上线（pid 28500 → 13592，WorkBuddy 进程数 15 → 15 未变）。 |
| **活体验证证据** | `/api/thinking-stats?days=7` 实测冷/热耗时、`credit` 合计与权威表 `SUM` **逐分核对（差额 0）**、模型集合双向比对（无缺失/无多余）、四桶时长合计 = `totalMs`（算术闭合）；CDP 真实点击「模型效率」入口读回表格（中文/英文各一轮，英文用 `localStorage` 切语言后**已还原为默认**）；截图 `T20-模型效率面板-2026-09-23.png`、`T20-账号工具栏-模型效率入口-2026-09-23.png` 落会话工作区。 |

### 判定不做（有判据，留档避免重复评估）

| 项 | 判据 | 来源 |
|---|---|---|
| **`MikkoParkkola/mcp-gateway`** | 仅 **75★**、许可非 OSI（商用收费）；仓库内同时写着 89% 与 95% 两套互相矛盾的数字 ⇒ 不可信 | 插件吸纳调研 2026-09-23 |
| **`zilliztech/claude-context`** | 停更约 2 个月 + 需 embedding + Milvus 向量库，过重 | 同上 |
| **`microsoft/playwright-mcp`** | 与本机既有 `agent-browser` / `playwright-cli` 能力**重叠** | 同上 |
| **市场内 `ctx` / `workbuddy-token-usage` / `token-dashboard`** | 与自研 `context-audit.js` / `token-stats.js` **口径重叠** —— 装了两套数字必然对不上 | 同上 |
| **`token-compressor`** | 仅 11★、停更约半年 | 同上 |
| **外部记忆类三件**（含 `basicmachines-co/basic-memory`） | 与 `MEMORY.md` + `memory-governance.js` + `/api/handoff` 职责重叠；社区反复验证「每轮重读整个记忆库比省下的还贵」。且 `basic-memory` 是 **AGPL-3.0**，禁入分发物 | 同上 |
| **F8 本地 AI 网关**（`litellm` / `claude-code-router`） | **条款风险未评估**前不立项；且「路由省钱 = 换便宜模型」是质量取舍，非净赚 | 同上 |
| **token 速度显示 v3（逐块真值）** | 2026-09-23 探针实测：渲染层 `provider.api.onSessionEvent` 通道**注册成功但平静期零事件**（正常对话流式期间不触发）⇒ 该通道是「异常 / 状态」通道，**不含逐块 token 增量**。⇒ v1（字符速率估算）+ v2（轮末真值）即为终点 | 2026-09-23 探针 |
| **`colbymchenry/codegraph`（MCP 索引）** | 官方内置**不可配置**的跳过规则：**单文件 > 1 MiB 不入索引**。开库实测：`scripts/inject.js` 1,306,412 B 已登记却**解析出 0 个符号**（`code=size_exceeded`），而 `inject.js` 恰是本仓改动最勤的文件 ⇒ 两个靶心（`daemon.js` + `inject.js`）**只覆盖到一半**。再叠加：① 一次 `codegraph_explore` 实测返回 ≈4,500 token（不比 grep 便宜）；② MCP 工具描述**每轮常驻**的 token 税。⇒ CLI / 索引 / `mcp.json` 条目保留（未点信任=零成本），**判定不启用**；将来若官方放开 1 MiB 上限可直接复用 | 2026-09-23 用户决策 + 开库实测 |
| **`token-efficient-task-router`（技能库）** | **净增 token，卸载**。实测：58 文件 / 588 KB，`SKILL.md` 单项 **43.8 KB ≈ 1.1 万 token**；在本工程 jsonl 里出现 **868 次**（**124 次是"技能索引"条目**、116 次文档路径、21 次 `skill-call-near`），索引条目单次描述约 **100 token 直接进每轮 payload** —— 而它设计的"路由"逻辑在会话里**几乎没被真正触发执行** ⇒ 花了索引的 token、没拿到路由收益。技能库**没有逐技能启用开关**，停用只能移出目录 ⇒ 已 `Move-Item` 到 `C:\Users\Lyon\.workbuddy\skills-disabled\`（**可逆**） | 2026-09-23 用户要求评估 + jsonl 实测 |
| **token 速度读数「常开」** | **改判默认关**。理由：口径本质是**字符估算、非真实用量**（见上文三条根因），常开会让用户把估算当精确值；且它每秒 tick + 拖动路径在跨 iframe 场景易丢事件。⇒ 默认不创建读数节点、不算数，**保留面板手动开关**作为进阶选项。要彻底删代码也可（后续单独提交） | 2026-09-23 用户反馈 + 代码实测 |

### 评估通过（已探针验证，未落地）

| 项 | 结论 | 依据 |
|---|---|---|
| **零依赖 stdio MCP 握手** | ✅ **通过**：本机托管 node 22 跑纯内建 server，`initialize` / `notifications/initialized` / `tools/list` / `tools/call` / 未知方法错误码 **8/8 全过**；WorkBuddy 本体（`app.asar`）含 MCP 客户端实现（`mcpServers`×500、`@modelcontextprotocol`×123、`McpServer`×689） | 2026-09-23 探针（`.wd-tmp/mcp-min-server.js` + `t1_probe.js`） |
| **D4 同步判据灰度** | ✅ **已开**：`POST /api/sessions/auto-copy/judge {"judge":"content"}` 执行成功（`changed:true`），回读确认已是 `content`。**回退**：同接口传 `'mtime'` | 2026-09-23 实机 |
| **md 改走插件内置查看器（待办 T30 · 方案①）** | ⬅️ **已落地，条目见上文「新增功能」**。下列为当初的探针依据：✅ **通过**，且比预估更轻。**入口唯一且可拦**：全站 `a[href]` 命中 `.md` = **0** ⇒ md 只能从产物卡片打开；卡片为 `<div class="artifact-slot-panel__card" data-dir="<绝对路径>" data-ext="md">`，内部 `.card-main` 才是接点击的 `<button>`。**委托位置可绕**：React key 只在 `#root`（`__reactContainer$…`）、`document` 上**没有** ⇒ `window` **捕获阶段** `stopPropagation()` 即可拦住官方 handler。**取数不需要新路由**：渲染进程 `fetch('file:///…md')` 实测 **ok/200/3 ms**（62 KB）。**自研渲染够快**：零依赖极简渲染器 62 KB md → 96 KB HTML 实测 **10.7 ms**（对比官方首开 **14 000 ms ≈ 1300×**）。**逃生口可行**：合成 `MouseEvent` 能被 React 收到（不校验 `isTrusted`），配 `window.__wbsMdBypass` 放行标记即可唤回官方链路。⇒ 与既有 T29（KaTeX CDN 降级，属官方口径修法）**不冲突**：T30 绕过官方渲染器，T30 落地后 T29 降级为「反馈官方」 | 2026-09-23 CDP 探针（`.wd-tmp/probe-mdcontract.py` / `probe-mdfetch.py`） |

### 边界（不变）

不做主进程 `--inspect`、**不代理请求**、**不改写官方请求**、**不裁剪任何会话文件**。

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
