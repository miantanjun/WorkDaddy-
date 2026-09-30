# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-09-30 16:24:32
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （18709 行 / 613 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 56 | `resolveDaemonPrivilege` | fn |  |
| 265 | `readAutomationsTolerant` | fn |  |
| 687 | `persistScheduleLedger` | fn |  |
| 697 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 717 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 737 | `scheduleVerifyNotify` | fn |  |
| 747 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 754 | `nameOf` | const |  |
| 797 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 798 | `valid` | const |  |
| 823 | `diagnosticsEnabled` | fn |  |
| 831 | `redactDiagnosticText` | fn |  |
| 844 | `shouldPersistBreadcrumb` | fn |  |
| 850 | `validCdpPort` | fn |  |
| 854 | `readCdpPortFile` | fn |  |
| 863 | `writeCdpPortFile` | fn |  |
| 878 | `readUiPortFile` | fn |  |
| 882 | `writeUiPortFile` | fn |  |
| 897 | `cdpPortCandidates` | fn |  |
| 899 | `add` | const |  |
| 907 | `isLocalPortAvailable` | fn |  |
| 911 | `finish` | const |  |
| 926 | `findAvailableCdpPort` | fn |  |
| 933 | `selectCdpPort` | fn |  |
| 1009 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 1014 | `updateDebug` | fn |  |
| 1015 | `scrub` | const |  |
| 1045 | `writeUpdateAttempt` | fn |  |
| 1056 | `macWorkDaddyAppPath` | fn |  |
| 1079 | `resolveApplyUpdateVbs` | fn |  |
| 1098 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1111 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1123 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1152 | `githubAuthHeaders` | fn |  |
| 1162 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1186 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1188 | `fileName` | const |  |
| 1193 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1207 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1216 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1230 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1240 | `normalizeAssetSha256` | fn |  |
| 1245 | `expectedUpdateSha256` | fn |  |
| 1250 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1287 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1331 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1390 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1423 | `readUpstreamCache` | const |  |
| 1471 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1479 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1505 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1514 | `downloadUpdateInternal` | fn |  |
| 1572 | `cleanupTemp` | const |  |
| 1574 | `failDownload` | const |  |
| 1660 | `sha256File` | fn | 计算文件 SHA-256 |
| 1664 | `inspectPackagedApp` | fn |  |
| 1681 | `packagedAppVersionError` | fn |  |
| 1695 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 1749 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 1757 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 1797 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 1864 | `scheduleOAuthStateCleanup` | fn |  |
| 1870 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 1891 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 1920 | `accData` | const |  |
| 1932 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 1980 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 2005 | `markAttemptFailure` | const |  |
| 2014 | `markSpawnFailure` | const |  |
| 2136 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2151 | `log` | fn |  |
| 2162 | `isLockPermissionError` | fn |  |
| 2166 | `reportDaemonLockFallback` | fn |  |
| 2176 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2211 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2268 | `releaseDaemonLock` | fn |  |
| 2281 | `scheduleBackup` | fn |  |
| 2352 | `settlePendingReloadInjection` | fn |  |
| 2364 | `armPendingReloadInjection` | fn |  |
| 2386 | `runPendingReloadInjection` | fn |  |
| 2413 | `findCdpEndpoint` | fn |  |
| 2422 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2457 | `targetsBelongToProfile` | fn |  |
| 2477 | `isWorkBuddyCdpTarget` | fn |  |
| 2483 | `getPageTarget` | fn |  |
| 2489 | `cleanupForeignInjectedTargets` | fn |  |
| 2497 | `cleanupForeignInjectedTarget` | fn |  |
| 2506 | `finish` | const |  |
| 2549 | `cdpFocusDiagnostics` | fn |  |
| 2563 | `cdpMouseClick` | fn |  |
| 2586 | `cdpSend` | fn |  |
| 2604 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2605 | `raw` | const |  |
| 2617 | `connectCdp` | fn |  |
| 2694 | `waitForPageReadyThenDispatch` | fn |  |
| 2696 | `retry` | const |  |
| 2709 | `dispatchAutomationEvent` | fn |  |
| 2745 | `onCdpEvent` | fn |  |
| 2748 | `url` | const |  |
| 2829 | `cdpLoop` | fn |  |
| 2842 | `reloadWorkBuddyPage` | fn |  |
| 2844 | `withTimeout` | const |  |
| 2886 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 3009 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 3023 | `resolveWorkBuddyBinary` | fn |  |
| 3026 | `tryFile` | const |  |
| 3038 | `psCmd` | const |  |
| 3067 | `addCandidate` | const |  |
| 3111 | `psQuote` | const |  |
| 3128 | `runCommand` | fn |  |
| 3135 | `finish` | const |  |
| 3159 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3188 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3204 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3221 | `linuxWorkBuddyPids` | fn |  |
| 3245 | `workBuddyRunning` | fn |  |
| 3262 | `waitForWorkBuddyExit` | fn |  |
| 3277 | `waitForWorkBuddyExitTolerant` | fn |  |
| 3289 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 3335 | `detail` | const |  |
| 3367 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 3393 | `resolveLauncherHome` | fn |  |
| 3403 | `resolveLinuxLaunchTarget` | fn |  |
| 3418 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 3497 | `clickByText` | fn |  |
| 3543 | `findByText` | fn |  |
| 3572 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 3578 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 3581 | `claimLog` | fn |  |
| 3589 | `sleep` | fn |  |
| 3594 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 3641 | `automationStateFile` | const |  |
| 3642 | `readAutomationState` | fn |  |
| 3645 | `writeAutomationState` | fn |  |
| 3651 | `automationAccountStatus` | fn |  |
| 3685 | `automationDeepLocatorExpression` | fn |  |
| 3700 | `first` | fn |  |
| 3705 | `choose` | fn |  |
| 3706 | `firstByAttribute` | fn |  |
| 3716 | `automationDomAction` | fn |  |
| 3717 | `assertActive` | const |  |
| 3725 | `read` | const |  |
| 3781 | `automationHttpRequest` | fn |  |
| 3804 | `automationPublicRun` | fn |  |
| 3812 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 3823 | `automationPanelSetOpen` | fn |  |
| 3831 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 3840 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 3853 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 3868 | `automationNotifyToast` | fn |  |
| 3898 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 3899 | `assertAutoCopySucceeded` | fn |  |
| 3905 | `recordAccountSyncResult` | fn |  |
| 3917 | `assertAccountSwitchIdle` | fn |  |
| 3923 | `automationSwitchProgress` | fn |  |
| 3931 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 3948 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 3954 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 4001 | `limitFailoverManualPublic` | fn |  |
| 4020 | `readLimitFailoverState` | fn |  |
| 4029 | `writeLimitFailoverState` | fn |  |
| 4040 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 4054 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 4070 | `runCdpExpression` | fn |  |
| 4081 | `readLimitBanner` | fn |  |
| 4094 | `readStructuredError` | fn |  |
| 4098 | `readLiveModel` | fn |  |
| 4102 | `setLiveModel` | fn |  |
| 4106 | `readLastUserTaskText` | fn |  |
| 4114 | `readFailoverSnapshot` | fn |  |
| 4130 | `pickWorkbuddyDaemonClient` | fn |  |
| 4132 | `walk` | fn |  |
| 4169 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4184 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4201 | `edgeSyncMappingDbPath` | fn |  |
| 4216 | `getEdgeSyncDb` | fn |  |
| 4229 | `readEdgeSyncRows` | fn |  |
| 4242 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4268 | `probeCloudConversations` | fn |  |
| 4295 | `collectCloudGhosts` | fn |  |
| 4333 | `purgeCloudConversations` | fn |  |
| 4367 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 4384 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 4402 | `purgeCloudGhostsSwitching` | fn |  |
| 4411 | `switchBack` | const |  |
| 4452 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 4462 | `limitReplyStarted` | fn |  |
| 4467 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 4474 | `findLimitFailoverTask` | fn |  |
| 4478 | `runningLimitFailoverRun` | fn |  |
| 4482 | `waitLimitVerdict` | fn |  |
| 4507 | `runLimitFailoverCore` | fn |  |
| 4538 | `hits` | const |  |
| 4827 | `buildLimitFailoverPorts` | fn |  |
| 4912 | `limitFailoverDesktopLogDir` | fn |  |
| 4921 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 4935 | `limitFailoverNotify` | fn |  |
| 4943 | `readLimitReplyIdle` | fn |  |
| 4947 | `limitFailoverAccountByUid` | fn |  |
| 4953 | `limitFailoverPrimaryUid` | fn |  |
| 4961 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 4967 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 4976 | `cancelLimitFailoverSwitchBack` | fn |  |
| 4989 | `limitFailoverPlanCancelled` | fn |  |
| 4993 | `finishLimitFailoverSwitchBack` | fn |  |
| 5016 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 5031 | `runLimitFailoverSwitchBack` | fn |  |
| 5032 | `isCancelled` | const |  |
| 5033 | `elapsedMs` | const |  |
| 5034 | `stopIfUnsafe` | const |  |
| 5154 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5189 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5251 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5261 | `readSessionActivity` | fn |  |
| 5266 | `idleSwitchbackPublicState` | fn |  |
| 5299 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 5359 | `idleSwitchbackTick` | fn |  |
| 5418 | `startIdleSwitchbackTicker` | fn |  |
| 5430 | `automationSwitchAccount` | fn |  |
| 5489 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 5496 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 5514 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 5527 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 5550 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 5562 | `automationAccountSwitchGuarded` | fn |  |
| 5584 | `startAutomationRun` | fn |  |
| 5600 | `isCancelled` | const |  |
| 5603 | `appendRunLog` | const |  |
| 5614 | `panelPrepare` | const |  |
| 5626 | `withInput` | const |  |
| 5643 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 5653 | `readSession` | const | 必须保持原语义，否则会波及后面的「发送是否被受理」判定）。 |
| 5661 | `sessionAction` | const |  |
| 5669 | `openedUid` | const |  |
| 5700 | `accountUid` | const |  |
| 5796 | `completionReport` | const |  |
| 5823 | `publicAccounts` | const |  |
| 5824 | `publicCurrent` | const |  |
| 5827 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 5895 | `resumeAutomationAfterNavigation` | fn |  |
| 5906 | `todayStr` | fn |  |
| 5908 | `z` | const |  |
| 5912 | `loadCheckinCache` | fn |  |
| 5919 | `saveCheckinCache` | fn |  |
| 5931 | `refreshAccountBackupToken` | fn | 刷新备份账号凭证：临期惰性刷新，或距上次刷新超过一天时执行保活。 |
| 5985 | `dailyCheckin` | fn |  |
| 6034 | `claimDailyForUid` | fn |  |
| 6043 | `performAccountCheckin` | fn |  |
| 6089 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 6153 | `desc` | const |  |
| 6198 | `buildInjectScript` | fn |  |
| 6235 | `injectWidgetManual` | fn |  |
| 6243 | `readCdpTargets` | fn |  |
| 6254 | `readLogTail` | fn |  |
| 6265 | `collectDiagnostics` | fn |  |
| 6290 | `writeDiagnosticsSnapshot` | fn |  |
| 6311 | `sqliteRun` | fn |  |
| 6317 | `codeBuddySessionRows` | fn |  |
| 6332 | `sqlParamAt` | fn |  |
| 6335 | `sqliteQuery` | fn |  |
| 6380 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 6399 | `createDirectoryNoFollow` | fn |  |
| 6418 | `repairMissingSessionWorkspaces` | fn |  |
| 6444 | `sessionRangeMs` | fn |  |
| 6461 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 6465 | `copyOne` | const |  |
| 6581 | `sessionBodyMtime` | fn |  |
| 6598 | `sessionContentMtime` | fn |  |
| 6602 | `visit` | const |  |
| 6636 | `directoryStats` | fn |  |
| 6665 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 6676 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 6702 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 6717 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 6728 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 6748 | `sortAutoCopyPlanBySize` | fn |  |
| 6767 | `readCopyManifestCache` | fn |  |
| 6778 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 6787 | `deriveCopyManifestFromCache` | fn |  |
| 6814 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 6825 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 6847 | `emptyWorkspaceCounters` | fn |  |
| 6855 | `transferWorkspaceTree` | fn |  |
| 6863 | `copyFileAt` | const |  |
| 6956 | `copySessionWorkspacePayload` | fn |  |
| 6978 | `outcome` | const |  |
| 6990 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 7011 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 7132 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 7154 | `forcedSource` | const | 真分叉下「最新」并不等于「用户想要的那份」，按时间选会静默丢另一边的内容。 |
| 7166 | `trackPayload` | const |  |
| 7224 | `sleepMs` | const |  |
| 7335 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 7381 | `listAutoCopyConflicts` | fn |  |
| 7394 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 7408 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 7434 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 7534 | `readNativeDeleteSweep` | fn |  |
| 7541 | `saveNativeDeleteSweep` | fn |  |
| 7554 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 7561 | `sweepNativeSessionDeletes` | fn |  |
| 7633 | `readArchiveIsolation` | fn |  |
| 7640 | `saveArchiveIsolation` | fn |  |
| 7654 | `archiveIsolationEnabled` | fn |  |
| 7659 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 7675 | `members` | const |  |
| 7743 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 7792 | `purgeLocalSessionCopyCore` | fn |  |
| 7824 | `purgeArchivedCrossAccountCopies` | fn |  |
| 7875 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 7952 | `summarizeSessionImportErrors` | fn |  |
| 7962 | `archiveRelativePath` | fn |  |
| 7966 | `collectSessionArchiveFiles` | fn |  |
| 7969 | `collect` | const |  |
| 8009 | `ensureArchiveParentNoFollow` | fn |  |
| 8028 | `restoreSessionArchiveFiles` | fn |  |
| 8051 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 8082 | `getSessionSyncCache` | fn |  |
| 8105 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 8121 | `isTaskSessionRecord` | fn |  |
| 8126 | `sqlPlaceholders` | fn |  |
| 8130 | `insertCopiedSession` | fn |  |
| 8160 | `createForkSession` | fn |  |
| 8193 | `prepareSessionExport` | fn |  |
| 8210 | `exportSessions` | fn |  |
| 8224 | `validImportedSessionUid` | fn |  |
| 8230 | `importSessions` | fn |  |
| 8234 | `importSessionArchives` | fn |  |
| 8282 | `adoptExistingCopyTarget` | fn |  |
| 8326 | `copySessionRecord` | fn |  |
| 8343 | `perform` | const |  |
| 8464 | `getSessionDirtyIndex` | fn |  |
| 8472 | `scheduleSessionDirtySave` | fn |  |
| 8489 | `markSessionDirty` | fn | 记一条脏标记；**只有真变化才置脏**（同一时刻的重复通知不写盘）。 |
| 8500 | `markSessionDirtyBaseline` | fn | renderer 建立基线（`body.ready`）。未建基线的账号一律 fail-open = 全当脏。 |
| 8505 | `clearSessionDirty` | fn | 清一条脏标记；`expectedAt` 不匹配就不清（**并发到来的新事件不许被旧的在飞清理抹掉**）。 |
| 8514 | `autoCopyDirtyFastpathEnabled` | fn | 批次 3 的开关：**默认关**（文件缺失 / 内容不是 {enabled:true} 都算关）。每次规划读一次。 |
| 8530 | `isAutoCopyRowCleanByDirty` | fn |  |
| 8535 | `lineageId` | const |  |
| 8544 | `buildAutoCopyPlan` | fn |  |
| 8627 | `isAutoCopyPausedError` | fn |  |
| 8634 | `beginRendererReloadPriority` | fn |  |
| 8649 | `hasPendingAutoCopyTo` | fn |  |
| 8658 | `pruneAutoCopyJobs` | fn |  |
| 8668 | `runAutoCopyQueue` | fn |  |
| 8698 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 8765 | `enterSwitchFlowRunner` | fn | 进入一个切号流程；返回**幂等**的退出函数（重复调用不会把计数减成负）。 |
| 8794 | `setSwitchFlowPhase` | fn |  |
| 8800 | `terminal` | const |  |
| 8835 | `readSwitchFlowState` | fn | 读状态（惰性过期：终态留 TTL 供渲染层读到，过期即清）。 |
| 8847 | `requestSwitchFlowCancel` | fn | 「关闭弹窗」：置取消位 + 立刻请求中止复制（worker 在下个检查点收尾，不是硬停）。 |
| 8901 | `waitPreSyncSettled` | fn |  |
| 8955 | `preSyncBeforeSwitch` | fn |  |
| 9057 | `resolveSyncNowSources` | fn |  |
| 9058 | `all` | const |  |
| 9094 | `limitFailoverSyncWaitMs` | fn |  |
| 9129 | `openConversationById` | fn |  |
| 9153 | `fastExpr` | const |  |
| 9238 | `sidebarProbe` | const |  |
| 9408 | `prepareFailoverContinuation` | fn |  |
| 9414 | `degrade` | const |  |
| 9516 | `startAutoCopyJob` | fn |  |
| 9589 | `run` | const |  |
| 9597 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 9881 | `activeAutoCopyJob` | fn |  |
| 9894 | `publicAutoCopyJob` | fn |  |
| 9976 | `publicSpaceScanJob` | fn |  |
| 10000 | `buildSpaceScanResolvers` | fn |  |
| 10046 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 10058 | `startSpaceScanJob` | fn |  |
| 10148 | `isValidSessionId` | fn |  |
| 10157 | `matchedSessionIds` | fn |  |
| 10162 | `resolveManagedSessionTarget` | fn |  |
| 10175 | `isManagedDirectoryNoFollow` | fn |  |
| 10199 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 10233 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 10239 | `delOne` | const |  |
| 10283 | `json` | fn |  |
| 10312 | `isAllowedApiOrigin` | fn |  |
| 10332 | `hasApiToken` | fn |  |
| 10339 | `isApiRequestAuthorized` | fn |  |
| 10348 | `isAllowedDevtoolsOrigin` | fn |  |
| 10388 | `readBody` | fn |  |
| 10393 | `ignoreLateError` | const |  |
| 10394 | `cleanup` | const |  |
| 10404 | `finish` | const |  |
| 10410 | `fail` | fn |  |
| 10416 | `onData` | fn |  |
| 10429 | `onEnd` | fn |  |
| 10440 | `onError` | fn |  |
| 10443 | `onIncomplete` | fn |  |
| 10475 | `workbuddySettingsPath` | fn |  |
| 10479 | `readWorkbuddySettings` | fn |  |
| 10487 | `writeWorkbuddySettings` | fn |  |
| 10493 | `buildAskRuleBlock` | fn |  |
| 10498 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 10508 | `getAskModeState` | fn |  |
| 10510 | `customPrompt` | const |  |
| 10523 | `setAskMode` | fn |  |
| 10538 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 10580 | `buildZhReasoningBlock` | fn |  |
| 10585 | `stripZhReasoning` | fn | 从 customPrompt 中移除中文思考段（保留用户其它内容与决策弹窗段） |
| 10595 | `getZhReasoningState` | fn |  |
| 10597 | `customPrompt` | const |  |
| 10613 | `setZhReasoning` | fn |  |
| 10633 | `refreshZhReasoningIfEnabled` | fn | 启动时调用：如已启用中文思考，把旧的规则段替换为最新版本（用标记精确识别） |
| 10658 | `readNoDisturbState` | fn |  |
| 10661 | `state` | const |  |
| 10683 | `readNoDisturbApplied` | fn |  |
| 10687 | `hasAll` | const |  |
| 10702 | `removeListItems` | fn |  |
| 10708 | `ensureSandboxObj` | fn |  |
| 10717 | `applyNoDisturbSwitch` | fn |  |
| 10721 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 10727 | `rollback` | const |  |
| 10775 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 10790 | `noDisturbAudit` | fn |  |
| 10825 | `acAppConfigPath` | fn |  |
| 10828 | `readAppConfig` | fn |  |
| 10836 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 10841 | `acBlock` | fn |  |
| 10848 | `stripACBlocks` | fn |  |
| 10854 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 10860 | `acCustomPromptPresent` | fn |  |
| 10865 | `readAutoContinueState` | fn |  |
| 10880 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 10897 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 10911 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 10928 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 10948 | `sessBuild` | fn |  |
| 10956 | `readSessionState` | fn |  |
| 10958 | `ns` | const |  |
| 10959 | `st` | const |  |
| 10991 | `writeSessionState` | fn |  |
| 10993 | `prior` | const |  |
| 11002 | `setSessionSwitch` | fn |  |
| 11010 | `addQuickPhrase` | fn |  |
| 11022 | `updateQuickPhrase` | fn |  |
| 11032 | `deleteQuickPhrases` | fn |  |
| 11039 | `normalizeQuickPhraseIds` | fn |  |
| 11051 | `exportQuickPhrases` | fn |  |
| 11067 | `importQuickPhrases` | fn |  |
| 11092 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 11101 | `selectAutomationModelById` | fn |  |
| 11114 | `confirmAutomationModel` | fn |  |
| 11122 | `restoreAutomationNewTaskPreference` | fn |  |
| 11130 | `automationAgentSurfaceExpression` | fn |  |
| 11132 | `visible` | fn |  |
| 11133 | `isNewTask` | fn |  |
| 11134 | `composerText` | fn |  |
| 11161 | `readAutomationAgentSurface` | fn |  |
| 11169 | `ensureAutomationNewTask` | fn |  |
| 11229 | `openNewAutomationAgentTask` | fn |  |
| 11248 | `currentAccount` | fn |  |
| 11254 | `a` | const |  |
| 11283 | `readAccountHealth` | fn |  |
| 11291 | `writeAccountHealth` | fn |  |
| 11307 | `recordAccountHealth` | fn |  |
| 11323 | `mergeLiveHealth` | fn |  |
| 11343 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 11351 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 11368 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 11387 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 11403 | `sweepAccountHealth` | fn |  |
| 11422 | `buildFailoverHealthFilter` | fn |  |
| 11450 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 11460 | `accountHealthEcho` | fn |  |
| 11473 | `accountBackupFile` | fn |  |
| 11494 | `gatewayStatus` | fn |  |
| 11514 | `gatewayCollectAccounts` | fn | 读本仓已登录的账号并解密（**复用 lib.js 的 [wd-compat] 解密器**，不另写一份帧格式）。 |
| 11523 | `auth` | const |  |
| 11524 | `account` | const |  |
| 11543 | `gatewayProbeHealth` | fn | 探活（/healthz 免鉴权）。null = 不可达。 |
| 11559 | `gatewayInstall` | fn | 下载 → SHA-256 校验 → 解压 → 凭证桥 → 生成 config。任一环节失败都不留半成品可用状态。 |
| 11561 | `task` | const |  |
| 11621 | `gatewayReadEnabled` | fn | 「用户是否启用」是 WorkDaddy 侧意图，与「装没装」分开记（沿用免打扰开关的记法）。 |
| 11628 | `gatewaySetEnabled` | fn |  |
| 11641 | `gatewayStart` | fn | 启动网关子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 11665 | `gatewayStop` | fn |  |
| 11673 | `refreshGatewayIfEnabled` | fn | 启动时：用户启用过就自动拉起（与 autoContinue 的「启动补写」同模式；未安装则静默跳过）。 |
| 11686 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 11691 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 11696 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 11723 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 11729 | `stashRecordByKey` | fn |  |
| 11736 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 11764 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 11787 | `buildBusyExpr` | fn |  |
| 11798 | `visibleIn` | fn | 误判空闲会在回复中输入，正文/图片回填容易失败，这是原设计刻意保守的原因。 |
| 11825 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 11836 | `busy` | const |  |
| 11867 | `resolveUsageBoardPython` | fn | 解析可用的 python：环境变量 → 托管 venv → 托管 base（版本目录）→ PATH 兜底。 |
| 11889 | `latestUsageBoardHtml` | fn | usage-board 目录里最新一份看板 HTML 文件名；没有则返回 null。 |
| 11900 | `latestUsageUnifiedHtml` | fn | 统一用量看板的产物：unified-board-<stamp>.html。 |
| 11914 | `creditUsageQuery` | fn |  |
| 11922 | `readUsageStatusJson` | fn |  |
| 11927 | `runUsageStatusExtractor` | fn | 跑一次第三方抽取器（只为补充指标）。失败/超时都只返回 ok:false，绝不抛。 |
| 11933 | `done` | const |  |
| 11955 | `builtinAssetsDir` | fn |  |
| 11971 | `builtinWallpaperSource` | fn |  |
| 11980 | `initBuiltinAssets` | fn |  |
| 12215 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 12242 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 12272 | `accountSwitchThemeExpression` | fn | 会被启动时的旧云端选择覆盖。这里不安装 hook，也不改其他账号或皮肤 CSS。 |
| 12317 | `preserveAccountSwitchTheme` | fn |  |
| 12334 | `nativeAppearanceSyncExpression` | fn | 的 CSS 资源；浅色/深色仍由 WorkBuddy 原生状态负责。 |
| 12337 | `removeNativeSheet` | fn |  |
| 12345 | `setAttr` | fn |  |
| 12350 | `setMode` | fn |  |
| 12361 | `sync` | fn |  |
| 12406 | `startNativeAppearanceSyncByCdp` | fn |  |
| 12411 | `releaseThemeByCdp` | fn |  |
| 12425 | `restoreNativeAppearanceByCdp` | fn |  |
| 12429 | `uid` | const |  |
| 12502 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 12546 | `loadThemePatches` | fn |  |
| 12562 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 12574 | `loadThemeVars` | fn |  |
| 12590 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 12594 | `declOf` | const |  |
| 12605 | `lead` | const |  |
| 12613 | `readBackgroundBlur` | fn |  |
| 12624 | `applyThemeByCdp` | fn |  |
| 12658 | `uid` | const |  |
| 12660 | `colors` | const |  |
| 12783 | `wbsBuiltinAppearance` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 12795 | `wbsSnapshotNativeAppearance` | fn |  |
| 12819 | `wbsClearNativeCustomCss` | fn |  |
| 12858 | `wbsWriteAppearanceState` | fn |  |
| 12866 | `wbsSyncAppearanceKeys` | fn |  |
| 12893 | `wbsPrepareNativeAppearance` | fn |  |
| 12901 | `wbsSyncNativeTheme` | fn |  |
| 12915 | `wbsSyncNativeThemeQuiet` | fn | wbsSyncNativeThemeIdempotent：250ms 守护/keeper 的周期调用路径，属性同值时不写。 |
| 12970 | `keepSelectedTheme` | fn |  |
| 13008 | `wbsHasSpecialNativeAppearance` | fn |  |
| 13033 | `wbsHoldNativeAppearance` | fn |  |
| 13105 | `clearComposerByCdp` | fn |  |
| 13158 | `fnv1a32` | fn |  |
| 13175 | `composerDraftHash` | fn |  |
| 13192 | `composerDraftExpr` | fn |  |
| 13232 | `composerDraftConsumed` | fn |  |
| 13263 | `composerSendExpr` | const |  |
| 13267 | `fiberOf` | fn |  |
| 13275 | `isStore` | fn |  |
| 13332 | `sendStashToComposer` | fn |  |
| 13338 | `guardedSend` | const |  |
| 13341 | `allItems` | const |  |
| 13350 | `s` | const |  |
| 13503 | `countBlocks` | const |  |
| 13513 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 13559 | `name` | const |  |
| 13575 | `disp` | const |  |
| 13586 | `visible` | fn |  |
| 13658 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 13672 | `readDraft` | const |  |
| 13680 | `draftConsumed` | const |  |
| 13683 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 13780 | `fetchResource` | fn |  |
| 13814 | `data` | const |  |
| 13817 | `accounts` | const |  |
| 13849 | `fetchEnterpriseResource` | fn |  |
| 13895 | `robustFetchEnterpriseResource` | fn |  |
| 13918 | `resolveEnterpriseId` | fn |  |
| 13946 | `retryDelay` | const |  |
| 13950 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 13982 | `fetchCredits` | fn |  |
| 14040 | `refreshCreditRotationAccounts` | fn |  |
| 14064 | `rememberCreditRotation` | fn |  |
| 14076 | `cachedCreditRotationAccounts` | fn |  |
| 14088 | `listDailyUsage` | fn |  |
| 14094 | `syncCurrentCreditUsage` | fn |  |
| 14097 | `task` | const |  |
| 14138 | `exportSecretKey` | fn |  |
| 14142 | `decryptLegacyExport` | fn |  |
| 14153 | `handleApiRoute` | fn |  |
| 14456 | `currentHealth` | const |  |
| 15144 | `uid` | const |  |
| 15207 | `d` | const |  |
| 15281 | `html` | const |  |
| 15507 | `uid` | const |  |
| 15644 | `dayOf` | const | 积分窗口与 token 窗口取同一个区间：分子分母同区间，否则 credit/1k 会被拉偏。 |
| 15701 | `finish` | const |  |
| 15778 | `pad` | const |  |
| 15786 | `prune` | const |  |
| 15979 | `worker` | const |  |
| 16016 | `uid` | const |  |
| 16611 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 16942 | `run` | const |  |
| 17192 | `targetUid` | const |  |
| 17221 | `targetUid` | const |  |
| 17561 | `id` | const |  |
| 17848 | `uid` | const |  |
| 17849 | `conv` | const |  |
| 17850 | `safe` | const |  |
| 17856 | `items` | const |  |
| 17919 | `key` | const |  |
| 17932 | `key` | const |  |
| 17947 | `key` | const |  |
| 18004 | `uid` | const |  |
| 18221 | `handleApi` | fn |  |
| 18222 | `failure` | const |  |
| 18253 | `stopCaffeinate` | fn |  |
| 18273 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 18281 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 18284 | `tick` | const |  |
| 18296 | `startCaffeinate` | fn |  |
| 18327 | `applySleepMode` | fn |  |
| 18356 | `sleepNow` | fn |  |
| 18377 | `restoreSleepMode` | fn |  |
| 18388 | `startServer` | fn |  |
| 18551 | `cleanup` | const |  |
| 18568 | `tryListen` | const |  |
| 18661 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （21434 行 / 890 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 17 | `createUsageActivity` | fn | Activity signals contain no key, text, target or pointer coordinates. |
| 20 | `notify` | fn |  |
| 36 | `destroy` | method |  |
| 46 | `createBuildLifecycle` | fn |  |
| 50 | `registerDisposer` | fn |  |
| 60 | `destroy` | fn |  |
| 73 | `alive` | method |  |
| 78 | `createBrandClickAction` | fn | 单击与五连击共享一个等待窗口，避免打开官网打断调试手势。 |
| 81 | `click` | method |  |
| 93 | `destroy` | method |  |
| 102 | `createFabAppearance` | fn |  |
| 109 | `apply` | fn |  |
| 112 | `get` | method |  |
| 113 | `set` | method |  |
| 123 | `createFabQuietMode` | fn | 机器人闲置吸边：只监听指针位置，不拦截 WorkBuddy 事件；由 build lifecycle 清理。 |
| 135 | `geometry` | fn | 用未变换的尺寸计算，避免旋转/过渡中的包围盒让靠近区域来回跳动。 |
| 143 | `cancel` | fn |  |
| 147 | `wake` | fn |  |
| 184 | `isEnabled` | method |  |
| 185 | `setEnabled` | method |  |
| 190 | `destroy` | method |  |
| 197 | `classifySessionHealth` | fn | another prompt automatically when a provider stops without an explicit error. |
| 221 | `classifyAutoContinueReply` | fn | explicit error or visibly truncated reply should cause an automatic follow-up. |
| 247 | `normalizeAutoContinueError` | fn |  |
| 251 | `numberValue` | fn |  |
| 295 | `classifyAutoContinueError` | fn |  |
| 309 | `classifyAutoContinueControllerSnapshot` | fn | 空闲后仍未 complete 的助手消息才是结构化的“回复中断”证据。 |
| 330 | `autoContinueMessageText` | fn |  |
| 337 | `autoContinueControllerCompleted` | fn |  |
| 346 | `controllerAutoContinueDecision` | fn | 挡在门外，功能对这类会话彻底失效。判定与绑定必须共用同一份映射。 |
| 366 | `selectAutoContinueAssistant` | fn |  |
| 389 | `normalizeQueueText` | fn |  |
| 403 | `parseComposerContentBlock` | fn |  |
| 415 | `composerBlocksFromTree` | fn | separately from querySelectorAll loses that order when quotes are interleaved. |
| 418 | `appendText` | fn |  |
| 426 | `collect` | fn |  |
| 459 | `composerTextFromTree` | fn |  |
| 465 | `selectionQuoteMeta` | fn |  |
| 476 | `contentItemToBlock` | fn |  |
| 493 | `contentToBlocks` | fn | quotes keep their serializable metadata so the official editor can restore the tag. |
| 525 | `isStashQueueItem` | fn | forbidden because ordinary prompts commonly contain a stashed prompt. |
| 538 | `stashContentSignature` | fn |  |
| 546 | `stashContentMatches` | fn |  |
| 576 | `classifyNoDisturbApprovalCandidate` | fn | Keep this deliberately narrow: a generic "确认" button must never qualify. |
| 590 | `isSessionMonitorInProgress` | fn |  |
| 602 | `isSessionMonitorInterrupted` | fn | 同样不会绑定。 |
| 624 | `normalizeSessionMonitorStatus` | fn |  |
| 628 | `sessionMonitorLifecycleAction` | fn |  |
| 638 | `normalizeSessionMonitorResourceRecord` | fn | stale working field cannot mask a newer completed protocol status. |
| 682 | `subscribeSessionMonitorResource` | fn |  |
| 685 | `recordsFromPayload` | fn |  |
| 716 | `createSessionDirtyTracker` | fn | ids and event names, never message text or session contents. |
| 722 | `signature` | fn |  |
| 734 | `flush` | fn |  |
| 740 | `queue` | fn |  |
| 747 | `observe` | fn |  |
| 760 | `baseline` | fn |  |
| 768 | `destroy` | fn |  |
| 780 | `createSessionMonitorRegistry` | fn | surface and must not turn conversation activity into a local log file. |
| 786 | `ensure` | fn |  |
| 804 | `update` | fn |  |
| 815 | `append` | fn |  |
| 828 | `remove` | fn |  |
| 836 | `clear` | fn |  |
| 840 | `list` | fn |  |
| 850 | `conversationMessagesToMarkdown` | fn | 不搬上游那 30 个宿主函数（本地没有 wbs-session-usage-* 模块，见 reports/1.2.7 §3.2 R2/R4）。 |
| 852 | `roleOf` | fn |  |
| 858 | `blocksToMarkdown` | fn |  |
| 860 | `visit` | fn |  |
| 1822 | `wbsSystemLanguage` | fn |  |
| 1826 | `wbsNormalizeLanguage` | fn |  |
| 1831 | `escapeRegExp` | fn |  |
| 1832 | `wbsI18nBuildMatchers` | fn |  |
| 1869 | `wbsTranslateString` | fn |  |
| 1919 | `wbsIsBuiltinAutomation` | fn |  |
| 1928 | `wbsBuiltinAutomationText` | fn |  |
| 1980 | `wbsAutomationText` | fn |  |
| 1985 | `wbsAutomationEditedText` | fn |  |
| 1996 | `wbsReportErr` | fn |  |
| 2023 | `wbsClientVersion` | fn |  |
| 2145 | `isIdentityExpired` | fn | 今日签到状态展示：账号卡片底部与积分余额并列显示 |
| 2162 | `accountHealthLocked` | fn | 那个看 tokenExpiresAt / 签到 401，这个看 daemon 下发的账号健康视图）。 |
| 2167 | `esc` | fn |  |
| 2168 | `escAttr` | fn |  |
| 2171 | `summarizeCreditDays` | fn | 每个积分段只归入一个剩余天数桶；缺失有效期的余额不展示，不猜测到期日。 |
| 2173 | `add` | fn |  |
| 2199 | `creditOpacity` | fn |  |
| 2204 | `createAvatarLibrary` | fn |  |
| 2206 | `validImage` | fn |  |
| 2222 | `snapshot` | fn |  |
| 2223 | `commit` | fn |  |
| 2230 | `select` | method |  |
| 2234 | `add` | method |  |
| 2241 | `remove` | method |  |
| 2249 | `resolveAvatarChoice` | fn |  |
| 2255 | `checkinHtml` | fn |  |
| 2262 | `activityStreakHtml` | fn |  |
| 2273 | `isKnownActivityStreak` | fn |  |
| 2277 | `el` | fn |  |
| 2284 | `maskPhone` | fn |  |
| 2290 | `fmtTime` | fn |  |
| 2300 | `initial` | fn |  |
| 2306 | `api` | fn |  |
| 2333 | `collectAll` | fn | 调试：递归收集所有元素（含 shadowRoot 与同域 iframe），用于抓取输入框内容 |
| 2347 | `allElements` | fn |  |
| 2360 | `captureComposer` | fn | 调试：抓取 WorkBuddy 输入框当前内容（文字/图片/附件/连接器/skill） |
| 2419 | `findComposer` | fn |  |
| 2429 | `findComposerRaw` | fn |  |
| 2476 | `composerHasContent` | fn | composerTextFromTree 跳过这两类装饰子树。 |
| 2484 | `getComposerContent` | fn | 干净地抓取输入框内容：只取 Slate 节点（不受页面装饰干扰） |
| 2500 | `getConversationId` | fn | 尽量拿到当前会话 id（URL / 当前布局选中会话 / 标题兜底） |
| 2515 | `build` | fn |  |
| 2520 | `send` | method |  |
| 2541 | `removeTimer` | fn |  |
| 2545 | `setBuildTimeout` | fn |  |
| 2553 | `setBuildInterval` | fn |  |
| 2560 | `requestBuildFrame` | fn |  |
| 2569 | `listen` | fn |  |
| 2576 | `toast` | fn |  |
| 2580 | `receiveToast` | fn |  |
| 2614 | `switchFlowAccountLabel` | fn |  |
| 2621 | `switchFlowMaskEl` | fn |  |
| 2623 | `buildSwitchFlowMask` | fn |  |
| 2654 | `renderSwitchFlow` | fn |  |
| 2729 | `cancelSwitchFlow` | fn |  |
| 2755 | `scheduleSwitchFlowPoll` | fn |  |
| 2760 | `pollSwitchFlow` | fn |  |
| 2795 | `isVisibleHealthNode` | fn |  |
| 2803 | `findBlockingPrompt` | fn |  |
| 2832 | `findSessionError` | fn |  |
| 2852 | `readAssistantHealth` | fn |  |
| 2883 | `setSessionHealthResult` | fn |  |
| 2906 | `scanSessionHealth` | fn |  |
| 2983 | `summary` | method |  |
| 2984 | `active` | method |  |
| 2985 | `generation` | method |  |
| 2986 | `root` | method |  |
| 2990 | `summary` | method |  |
| 2991 | `active` | method |  |
| 2992 | `generation` | method |  |
| 2993 | `root` | method |  |
| 2998 | `isUsableThemeAuditRoot` | fn |  |
| 3007 | `findThemeAuditRoot` | fn |  |
| 3018 | `syncThemeAuditRoot` | fn |  |
| 3040 | `applyI18n` | fn |  |
| 3085 | `setLanguage` | fn |  |
| 3104 | `applyInjectedI18n` | fn |  |
| 3358 | `qpDiag` | fn | 面板关闭/重开：点击选项（发送/编辑/任意项）后关闭面板；重新进入按钮区恢复 hover 可展示 |
| 3371 | `mountExplorePopover` | fn | keeps it above the usage summary even when the composer creates its own layer. |
| 3375 | `listen` | fn |  |
| 3379 | `cancelClose` | fn |  |
| 3380 | `close` | fn |  |
| 3381 | `open` | fn |  |
| 3391 | `delayedClose` | fn |  |
| 3414 | `acMenuClose` | fn |  |
| 3428 | `readMessageNavigationEnabled` | fn |  |
| 3431 | `writeMessageNavigationEnabled` | fn |  |
| 3434 | `readSelectionQuoteEnabled` | fn |  |
| 3437 | `writeSelectionQuoteEnabled` | fn |  |
| 3440 | `readForkEnabled` | fn |  |
| 3443 | `writeForkEnabled` | fn |  |
| 3459 | `applySessionModule` | fn |  |
| 3488 | `syncSessionModule` | fn |  |
| 3494 | `setSessionSwitchWire` | fn | 开关切换：写 daemon 并回应用户界（设置失败回滚 UI 状态） |
| 3518 | `selectionQuoteElement` | fn | WorkBuddy 的 selection-quote renderer 会通过 InputContextTag 自己渲染消息图标。 |
| 3533 | `selectionQuoteBlock` | fn |  |
| 3550 | `hideSelectionQuoteButton` | fn |  |
| 3555 | `updateSelectionQuoteButton` | fn |  |
| 3578 | `scheduleSelectionQuoteButton` | fn |  |
| 3584 | `insertSelectionQuote` | fn |  |
| 3604 | `setupSelectionQuote` | fn |  |
| 3642 | `renderQpList` | fn | 增强页快捷短语列表渲染（含批量模式） |
| 3709 | `renderExploreOptions` | fn | 发送按钮面板选项 = 快捷短语列表；点击项经 CDP 发送该短语（替换式，发完默认关面板） |
| 3780 | `openQpEdit` | fn | 新增/编辑快捷短语弹窗（参考账号导出弹窗；textarea 最多 5 行 / 500 字） |
| 3803 | `closeQpEdit` | fn |  |
| 3824 | `confirmQpDelete` | fn | 删除二次确认弹窗（支持单选/批量） |
| 3838 | `closeQpDel` | fn |  |
| 3856 | `findActionRow` | fn | 定位输入框操作栏（含 voice-mic-wrap 的父容器） |
| 3886 | `findSendButton` | fn | 操作栏最右侧的「圆形可点击」元素才是发送按钮（左侧还可能有增强提示词/停止等圆形按钮） |
| 3914 | `isSendDisabled` | fn | 发送按钮是否处于「禁用」态（输入框为空时官方会禁用它） |
| 3925 | `insertStash` | fn | 新版或旧版内联工具栏存在时放进工具栏；带 voice-mic-wrap 的旧布局保持固定定位。 |
| 3954 | `isComposerAnchorVisible` | fn |  |
| 3963 | `positionExplore` | fn | 探索菜单按钮：位于暂存提示词按钮右侧（与暂存同款圆钮、发送图标，hover 悬浮菜单弹窗） |
| 3970 | `applyThemeButtonColors` | fn | 使用实时主题变量，颜色变化由 CSS 继承处理，无需监听深浅色属性。 |
| 3976 | `positionStash` | fn |  |
| 4043 | `removeStash` | fn |  |
| 4048 | `isWelcomePage` | fn | 用户要求欢迎页不展示暂存提示词按钮（欢迎页输入框只是快速提问入口，不需要暂存）。 |
| 4057 | `shouldShowStash` | fn | 欢迎页一律不显示。 |
| 4063 | `syncStash` | fn |  |
| 4091 | `watchSend` | fn |  |
| 4105 | `watchRow` | fn |  |
| 4124 | `guardSessionChange` | fn | 标签同步只对当前会话生效（syncQueueTags 内按 sessionId 过滤），旧会话的标签由面板重渲染自然清除。 |
| 4133 | `createMessageNavigation` | fn | 会话消息导航：完整索引来自 controller.messageStore，DOM 仅用于判断当前可见位置。 |
| 4163 | `messageText` | fn |  |
| 4184 | `ensureRoot` | fn |  |
| 4228 | `position` | fn |  |
| 4249 | `setActive` | fn |  |
| 4260 | `hideTooltip` | fn |  |
| 4271 | `showTooltip` | fn |  |
| 4296 | `render` | fn |  |
| 4314 | `updateActive` | fn |  |
| 4349 | `scheduleActive` | fn |  |
| 4366 | `refreshFromStore` | fn |  |
| 4391 | `unbindStore` | fn |  |
| 4404 | `bindAdapter` | fn |  |
| 4421 | `sync` | fn |  |
| 4471 | `setEnabled` | fn |  |
| 4486 | `turnForButton` | fn |  |
| 4491 | `navigateToTurn` | fn |  |
| 4502 | `dragIndexAt` | fn |  |
| 4513 | `onNavPointerDown` | fn |  |
| 4525 | `onNavPointerMove` | fn |  |
| 4533 | `finishNavDrag` | fn |  |
| 4555 | `onNavPointerUp` | fn |  |
| 4556 | `onNavPointerCancel` | fn |  |
| 4557 | `onPointerOver` | fn |  |
| 4562 | `onPointerOut` | fn |  |
| 4568 | `onFocusIn` | fn |  |
| 4572 | `onFocusOut` | fn |  |
| 4576 | `onClick` | fn |  |
| 4588 | `onKeyDown` | fn |  |
| 4597 | `onWindowChange` | fn |  |
| 4631 | `hideForkTooltip` | fn |  |
| 4632 | `showForkTooltip` | fn |  |
| 4650 | `syncForkButtons` | fn |  |
| 4672 | `scheduleForkButtons` | fn |  |
| 4758 | `wbsPanelShown` | fn | 因此：① 只在可见时做面板内的工作；② 只对「与注入功能相关」的 mutation 反应。 |
| 4764 | `wbsTabActive` | fn |  |
| 4770 | `wbsMutationsRelevant` | fn |  |
| 4784 | `onDomChange` | fn |  |
| 4798 | `onInputSync` | fn |  |
| 4826 | `scheduleDomChange` | fn |  |
| 4857 | `acLimitBannerPresent` | fn |  |
| 4869 | `acLimitWatchTick` | fn |  |
| 4905 | `readFabBottom` | fn |  |
| 4912 | `clampFabBottom` | fn |  |
| 4917 | `clampFabRight` | fn |  |
| 4922 | `applyFabPosition` | fn |  |
| 4935 | `scheduleFabPos` | fn |  |
| 4943 | `positionFab` | fn |  |
| 4961 | `fixWidgetIframeBg` | fn |  |
| 4994 | `syncModernQueueSnapshot` | fn |  |
| 5100 | `dropModernOptimisticItem` | fn |  |
| 5114 | `getModernQueueSnapshot` | fn |  |
| 5129 | `findWbsAdapter` | fn |  |
| 5172 | `get` | method |  |
| 5183 | `bootstrapModernQueueBridge` | fn |  |
| 5196 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 5200 | `probe` | fn |  |
| 5223 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 5235 | `handleModernQueueActionClick` | fn |  |
| 5266 | `stashSigs` | fn |  |
| 5272 | `stashIds` | fn |  |
| 5278 | `recordStashQueueItem` | fn |  |
| 5307 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 5320 | `syncQueueDomIds` | fn |  |
| 5347 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 5378 | `watchQueueOrder` | fn |  |
| 5394 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 5405 | `guardStashedPause` | fn |  |
| 5554 | `enforceStashOrder` | fn |  |
| 5596 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 5601 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 5632 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 5719 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 5737 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 5752 | `enqueueToWorkBuddyQueue` | fn |  |
| 5816 | `crumb` | fn |  |
| 5904 | `maxW` | fn |  |
| 5905 | `maxH` | fn |  |
| 5906 | `apply` | fn |  |
| 5939 | `endDrag` | fn |  |
| 5973 | `preloadAutomationDiscovery` | fn |  |
| 5979 | `findCreditSegment` | fn |  |
| 5988 | `ensureStatusPopover` | fn |  |
| 5999 | `hideStatusPopover` | fn |  |
| 6005 | `positionStatusPopover` | fn |  |
| 6030 | `showStatusPopover` | fn |  |
| 6041 | `creditPopoverHtml` | fn |  |
| 6048 | `hideCreditTooltip` | fn |  |
| 6054 | `showCreditTooltip` | fn |  |
| 6081 | `rotationReminderEnabled` | fn |  |
| 6112 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 6118 | `sync` | fn |  |
| 6157 | `syncOpsDot` | fn |  |
| 6163 | `setOpsFlag` | fn | 供 renderFailoverCard / renderContextAuditCard 回填（函数声明会提升，可以先用后定义） |
| 6170 | `placeOpsPopover` | fn | 不用 fixed —— .wbs-panel 的 backdrop-filter 会把它降格成「相对面板」的绝对定位。 |
| 6184 | `setOpsPopover` | fn |  |
| 6226 | `idleMinutesText` | fn |  |
| 6237 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 6240 | `label` | fn |  |
| 6245 | `data` | fn |  |
| 6251 | `sep` | fn |  |
| 6252 | `gap` | fn |  |
| 6262 | `renderIdleCard` | fn |  |
| 6308 | `refreshIdleCard` | fn |  |
| 6316 | `saveIdleCard` | fn |  |
| 6376 | `failoverClock` | fn |  |
| 6381 | `failoverAccountLabel` | fn |  |
| 6390 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 6403 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 6417 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 6433 | `renderFailoverCard` | fn |  |
| 6479 | `refreshFailoverCard` | fn |  |
| 6528 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 6586 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 6609 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 6612 | `done` | fn |  |
| 6617 | `fallback` | fn |  |
| 6640 | `renderContextAuditCard` | fn |  |
| 6686 | `loadContextAuditCard` | fn |  |
| 6750 | `openAccountOrderModal` | fn |  |
| 6777 | `close` | fn |  |
| 6782 | `drawRows` | fn |  |
| 6791 | `move` | fn |  |
| 6797 | `syncMode` | fn |  |
| 6876 | `setupCreditSummary` | fn |  |
| 6885 | `hide` | fn |  |
| 6886 | `deferHide` | fn |  |
| 6887 | `show` | fn |  |
| 6921 | `openOfficialGrowthCenter` | fn |  |
| 6927 | `confirmCurrentGrowthAccount` | fn |  |
| 6938 | `setupAccountNotePopover` | fn |  |
| 6955 | `trigger` | fn |  |
| 6956 | `dirty` | fn |  |
| 6957 | `update` | fn |  |
| 6964 | `hide` | fn |  |
| 6979 | `position` | fn |  |
| 6991 | `show` | fn |  |
| 7012 | `deferHide` | fn |  |
| 7020 | `submit` | fn |  |
| 7092 | `setupDailyProgressPopover` | fn |  |
| 7099 | `findRing` | fn |  |
| 7107 | `hide` | fn |  |
| 7117 | `deferHide` | fn |  |
| 7127 | `show` | fn |  |
| 7145 | `updateDailyTravelCountdowns` | fn |  |
| 7254 | `setupModelRateLimitPopover` | fn |  |
| 7261 | `findBadge` | fn |  |
| 7269 | `hide` | fn |  |
| 7279 | `deferHide` | fn |  |
| 7289 | `show` | fn |  |
| 7301 | `showSummary` | fn |  |
| 7372 | `closeSecureTransferModal` | fn |  |
| 7376 | `openSecureTransferModal` | fn |  |
| 7415 | `selectedIds` | fn |  |
| 7416 | `syncSelection` | fn |  |
| 7536 | `downloadTransfer` | fn |  |
| 7553 | `readTransferFile` | fn |  |
| 7562 | `copyPlainText` | fn |  |
| 7582 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 7598 | `onConfirm` | method |  |
| 7611 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 7635 | `openAccountImportChoice` | fn |  |
| 7655 | `sync` | fn |  |
| 7677 | `formatTokenCount` | fn |  |
| 7686 | `usageTrendChartHtml` | fn |  |
| 7694 | `usageTrendColors` | fn |  |
| 7701 | `resolveUsageColor` | fn |  |
| 7714 | `usagePieData` | fn |  |
| 7729 | `usagePieHtml` | fn |  |
| 7734 | `percent` | fn |  |
| 7735 | `description` | fn |  |
| 7736 | `legendRow` | fn |  |
| 7763 | `wireUsagePies` | fn |  |
| 7767 | `clear` | fn |  |
| 7772 | `preview` | fn |  |
| 7801 | `usageTrendGroups` | fn |  |
| 7823 | `renderUsageBreakdown` | fn |  |
| 7873 | `renderUsageTrendChart` | fn |  |
| 7945 | `hideTooltip` | fn |  |
| 7946 | `showTooltip` | fn |  |
| 7987 | `usageTimeSegmentHtml` | fn |  |
| 7995 | `onTokenStats` | fn |  |
| 8017 | `closeStats` | fn |  |
| 8046 | `usageDays` | fn |  |
| 8063 | `renderCredits` | fn |  |
| 8097 | `setCreditBusy` | fn |  |
| 8104 | `creditQueryFailed` | fn |  |
| 8111 | `showCreditJob` | fn |  |
| 8131 | `pollCreditJob` | fn |  |
| 8144 | `loadCredits` | fn |  |
| 8194 | `load` | fn | 就失去了入口 ⇒ 死代码里的副本永远看不到，只会与真实现漂移，故摘掉。 |
| 8261 | `perfTableHtml` | fn |  |
| 8298 | `onThinkingPerf` | fn |  |
| 8320 | `closePerf` | fn |  |
| 8334 | `load` | fn | 首屏慢（要扫 traces，首次 3–8 秒）⇒ 先渲染骨架再异步填表，绝不阻塞面板。 |
| 8368 | `wbsIsDarkTheme` | fn | 三维筛选（日期 × 账号 × 模型）与全部图表都在 HTML 内完成（数据内嵌 ⇒ 切筛选零延迟、断网可用）。 |
| 8380 | `onUsageBoard` | fn |  |
| 8413 | `boardUrl` | fn |  |
| 8417 | `closeBoard` | fn |  |
| 8431 | `showOverlay` | fn |  |
| 8432 | `hideOverlay` | fn |  |
| 8433 | `syncSrcBtn` | fn |  |
| 8434 | `loadBoard` | fn |  |
| 8447 | `fmtBoardTime` | fn |  |
| 8450 | `p2` | fn |  |
| 8453 | `generateBoard` | fn |  |
| 8488 | `switchTab` | fn | ===== Tab 切换 ===== |
| 8526 | `buildAutomationPane` | fn |  |
| 8530 | `defaultTask` | fn |  |
| 8533 | `triggerBadgesHtml` | fn |  |
| 8553 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 8561 | `autoProtocolLabel` | fn |  |
| 8565 | `taskStatusLabel` | fn |  |
| 8577 | `lastRunLabel` | fn |  |
| 8583 | `runFor` | fn |  |
| 8584 | `selectedIds` | fn |  |
| 8585 | `allSelected` | fn |  |
| 8586 | `syncBatchControls` | fn |  |
| 8594 | `render` | fn |  |
| 8639 | `load` | fn |  |
| 8642 | `renderExamples` | fn |  |
| 8656 | `loadAgentInfo` | fn |  |
| 8662 | `fuzzyTaskName` | fn |  |
| 8673 | `discoverySourceLabel` | fn |  |
| 8676 | `renderAutomationDiscovery` | fn |  |
| 8721 | `showAutomationDiscoveryGuide` | fn |  |
| 8731 | `showAutomationDiscovery` | fn |  |
| 8769 | `loadAutomationDiscovery` | fn |  |
| 8783 | `exampleById` | fn |  |
| 8786 | `generateAgentTask` | fn |  |
| 8804 | `finishSafetyReview` | fn |  |
| 8813 | `pollSafetyReview` | fn |  |
| 8828 | `startSafetyReview` | fn |  |
| 8839 | `closePanelModal` | fn |  |
| 8845 | `showAutomationConfirm` | fn |  |
| 8853 | `close` | fn |  |
| 8862 | `showAutomationLogs` | fn |  |
| 8889 | `close` | fn |  |
| 8905 | `showEditor` | fn |  |
| 8931 | `syncScheduleFields` | fn |  |
| 8947 | `hideEditor` | fn |  |
| 8948 | `saveEditor` | fn |  |
| 8992 | `isScheduledSendTaskUI` | fn |  |
| 8995 | `schedPad2` | fn |  |
| 8996 | `schedLocalSlot` | fn |  |
| 8999 | `schedDefaultOnceAt` | fn |  |
| 9005 | `schedWhenLabel` | fn |  |
| 9016 | `schedConversationLabel` | fn |  |
| 9027 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 9037 | `hideScheduledSend` | fn |  |
| 9039 | `showScheduledSend` | fn |  |
| 9097 | `whenValue` | fn |  |
| 9105 | `currentRequest` | fn |  |
| 9120 | `syncSummary` | fn |  |
| 9126 | `syncWhen` | fn |  |
| 9133 | `setTarget` | fn |  |
| 9146 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 9161 | `renderConversations` | fn |  |
| 9175 | `loadConversations` | fn |  |
| 9196 | `saveScheduledSend` | fn |  |
| 9272 | `mountAutomationModal` | fn |  |
| 9294 | `showCapabilities` | fn |  |
| 9304 | `showExamples` | fn |  |
| 9313 | `syncDraft` | fn |  |
| 9325 | `exportAutomationTasks` | fn |  |
| 9334 | `importIssueLabel` | fn |  |
| 9344 | `showTaskImport` | fn |  |
| 9360 | `selected` | fn |  |
| 9361 | `syncSelection` | fn |  |
| 9378 | `readAutomationImport` | fn |  |
| 9393 | `startPicker` | fn |  |
| 9486 | `isTaskSessionRecordUI` | fn |  |
| 9491 | `canonicalWorkspaceUI` | fn |  |
| 9508 | `sessionCopyAccountLabel` | fn |  |
| 9514 | `renderSessionCopyProgress` | fn |  |
| 9545 | `scheduleSessionCopyProgressPoll` | fn |  |
| 9549 | `pollActiveSessionCopyJob` | fn |  |
| 9568 | `fmtCostInt` | fn |  |
| 9570 | `renderSessionCostCard` | fn |  |
| 9620 | `copyCurrentConversation` | fn | 取会话控制器复用本地既有 acFindConversationController（与成本卡同一个「当前会话」口径）。 |
| 9646 | `refreshSessionCost` | fn |  |
| 9676 | `startSessionCostPolling` | fn |  |
| 9685 | `stopSessionCostPolling` | fn |  |
| 9692 | `buildSessionsPane` | fn |  |
| 9803 | `renderSessionExport` | fn |  |
| 9822 | `pollSessionExport` | fn |  |
| 9844 | `cloudEls` | fn |  |
| 9856 | `cloudAccountName` | fn |  |
| 9864 | `renderCloudCard` | fn |  |
| 9915 | `checkCloudGhosts` | fn |  |
| 9937 | `runCloudPurge` | fn |  |
| 9966 | `wireCloudCard` | fn |  |
| 9990 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 10021 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 10029 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 10035 | `loadSessions` | fn |  |
| 10071 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 10081 | `canEditAutoCopy` | fn |  |
| 10082 | `autoCopyButton` | fn |  |
| 10164 | `activeAutoCopyCount` | fn |  |
| 10170 | `updateSessionSummary` | fn |  |
| 10180 | `updateAutoCopyAllButton` | fn |  |
| 10188 | `toggleAutoCopyAll` | fn |  |
| 10211 | `shortWs` | fn |  |
| 10216 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 10263 | `toggleAutoCopyRule` | fn |  |
| 10294 | `updateAutoCopyButtons` | fn |  |
| 10322 | `updateSessCount` | fn |  |
| 10341 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 10350 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 10370 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 10385 | `wireSessionsPane` | fn |  |
| 10620 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 10674 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 10773 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 10815 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 10862 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 10880 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 10904 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 11003 | `selectedSessIds` | fn |  |
| 11006 | `showSessModal` | fn |  |
| 11017 | `buildModelsPane` | fn |  |
| 11047 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 11054 | `modelDetailsHtml` | fn |  |
| 11063 | `modelRowHtml` | fn |  |
| 11092 | `loadModels` | fn |  |
| 11110 | `updateModelCounts` | fn |  |
| 11120 | `renderModels` | fn |  |
| 11166 | `updateModelBatchState` | fn |  |
| 11181 | `showModelConfirm` | fn |  |
| 11195 | `closeThirdPartyMenu` | fn |  |
| 11201 | `openThirdPartyModels` | fn |  |
| 11326 | `wireModelsPane` | fn |  |
| 11474 | `findModelBackup` | fn |  |
| 11481 | `openModelEdit` | fn |  |
| 11515 | `buildThemePane` | fn | ===== 主题 pane（构建：头像 + 悬浮机器人 + 主题选择 + WorkDaddy 壁纸）===== |
| 11580 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 11708 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 11727 | `wirePcPane` | fn |  |
| 11760 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 11865 | `syncLangSeg` | fn |  |
| 11892 | `wireTelemetrySettings` | fn |  |
| 11896 | `renderTelemetryState` | fn |  |
| 11934 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 12050 | `updateLogTimestamp` | fn |  |
| 12055 | `appendUpdateLog` | fn |  |
| 12068 | `formatDownloadRate` | fn |  |
| 12074 | `formatDownloadEta` | fn |  |
| 12082 | `formatDownloadTransfer` | fn |  |
| 12095 | `formatUpdateFailure` | fn |  |
| 12109 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 12128 | `openWindowsInstaller` | fn |  |
| 12150 | `showWindowsInstallerReady` | fn |  |
| 12164 | `openWindowsInstallerAfterDownload` | fn |  |
| 12198 | `pollUpdateProgress` | fn |  |
| 12207 | `renderRebootUi` | fn |  |
| 12313 | `syncWallpaperCardVisibility` | fn |  |
| 12326 | `syncThemeTakeoverVisibility` | fn | 关闭接管后只隐藏主题外观选项；头像和悬浮机器人独立于主题接管。 |
| 12336 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 12525 | `gwCardEl` | fn | 面板只负责展示与触发 —— 判据与实现全在 scripts/api-gateway.js。 |
| 12526 | `gwBtn` | fn |  |
| 12531 | `gwRender` | fn |  |
| 12547 | `gwRefresh` | fn |  |
| 12552 | `gwAction` | fn |  |
| 12566 | `buildGatewayCard` | fn |  |
| 12622 | `wireEnhancePane` | fn |  |
| 12655 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 12663 | `loadWallpapers` | fn |  |
| 12771 | `setOpen` | fn |  |
| 12807 | `setupFabDrag` | fn |  |
| 12841 | `finishFabDrag` | fn |  |
| 12871 | `isDragging` | method |  |
| 12904 | `closeLoginModal` | fn |  |
| 12913 | `openLoginChoice` | fn |  |
| 13017 | `startSeamlessLogin` | fn |  |
| 13112 | `loadThemes` | fn |  |
| 13119 | `applyTheme` | fn |  |
| 13127 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 13145 | `openWebsite` | method |  |
| 13150 | `unlockDebug` | method |  |
| 13173 | `getItem` | method |  |
| 13174 | `setItem` | method |  |
| 13175 | `removeItem` | method |  |
| 13187 | `rememberAvatarWrapper` | fn |  |
| 13193 | `rememberAvatarImage` | fn |  |
| 13199 | `restoreAvatarDom` | fn |  |
| 13213 | `svgToPng` | fn | SVG → PNG dataURL |
| 13234 | `applyAvatar` | fn |  |
| 13303 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 13344 | `hexOf` | fn |  |
| 13347 | `mixArr` | fn |  |
| 13348 | `extractPalette` | fn |  |
| 13382 | `imageToTheme` | fn |  |
| 13471 | `syncAskSwitch` | fn |  |
| 13523 | `ndEl` | fn |  |
| 13526 | `ndRefreshCount` | fn |  |
| 13536 | `ndSwitchEl` | fn |  |
| 13541 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 13581 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 13615 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 13631 | `ndTitle` | fn |  |
| 13638 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 13657 | `cleanup` | fn |  |
| 13661 | `onClick` | fn |  |
| 13674 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 13681 | `applyNoDisturbState` | fn |  |
| 13773 | `acLogLine` | fn |  |
| 13778 | `acLog` | fn |  |
| 13788 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 13797 | `acSessionTitle` | fn |  |
| 13805 | `acMonitorLog` | fn |  |
| 13812 | `acScheduleMonitorLogRender` | fn |  |
| 13822 | `acResetState` | fn |  |
| 13854 | `acShowStatus` | fn |  |
| 13860 | `acHideStatus` | fn |  |
| 13865 | `acStartStatusAnim` | fn |  |
| 13866 | `acStopStatusAnim` | fn |  |
| 13869 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 13882 | `acNotifyLimit` | fn |  |
| 13903 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 13920 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 13930 | `acHasCompletionActions` | fn |  |
| 13949 | `acSwitchConversationId` | fn | 读不到就返回空串 —— 不能为了「带上一个 id」把切换本身拖挂。 |
| 13957 | `acHasErrorSignal` | fn |  |
| 13971 | `acLooksTruncated` | fn |  |
| 13979 | `acReplyDecision` | fn |  |
| 13991 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 14007 | `acIsBusy` | fn |  |
| 14012 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 14020 | `acComposerText` | fn |  |
| 14033 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 14049 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 14070 | `acPressEnter` | fn |  |
| 14079 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 14089 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 14106 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 14128 | `acControllerComposerEmpty` | fn |  |
| 14136 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 14183 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 14220 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 14258 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 14306 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 14312 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 14361 | `acCaptureControllerError` | fn |  |
| 14375 | `acRecordModelRateLimit` | fn |  |
| 14402 | `acControllerSnapshot` | fn |  |
| 14460 | `acControllerCheck` | fn |  |
| 14534 | `acBindController` | fn |  |
| 14567 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 14662 | `acScheduleSettle` | fn |  |
| 14675 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 14698 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 14706 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 14719 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 14818 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 14874 | `acStopLegacyMonitor` | fn |  |
| 14895 | `acMultiUpdateStatus` | fn |  |
| 14909 | `acMultiCreateSession` | fn |  |
| 14941 | `acMultiStatusFromResource` | fn |  |
| 14946 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 14974 | `acMultiReconcileSidebar` | fn |  |
| 15007 | `sessionDirtyResourceRecords` | fn |  |
| 15018 | `bindSessionDirtyMonitor` | fn |  |
| 15050 | `acMultiBindSessionResource` | fn |  |
| 15063 | `acMultiUnbindSessionResource` | fn |  |
| 15072 | `acMultiSchedule` | fn |  |
| 15081 | `acMultiSend` | fn |  |
| 15124 | `acMultiCheckSession` | fn |  |
| 15223 | `acMultiBindController` | fn |  |
| 15274 | `acMultiFinishSession` | fn |  |
| 15283 | `acMultiDetachController` | fn |  |
| 15292 | `acMultiProbeSidebarApproval` | fn |  |
| 15349 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 15372 | `acCdpClick` | fn |  |
| 15380 | `acAutoApproveClickItem` | fn |  |
| 15399 | `acAutoApproveItemByTitle` | fn |  |
| 15411 | `acAutoApprovePendingOnce` | fn |  |
| 15549 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 15594 | `acAutoApproveFastStart` | fn |  |
| 15604 | `acAutoApproveFastStop` | fn |  |
| 15608 | `acMultiDiscover` | fn |  |
| 15644 | `acStartMultiMonitor` | fn |  |
| 15663 | `acStopMultiMonitor` | fn |  |
| 15681 | `acStartMonitor` | fn |  |
| 15686 | `acStopMonitor` | fn |  |
| 15692 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 15703 | `acMonitorStatusLabel` | fn |  |
| 15712 | `acMonitorSafeDetail` | fn |  |
| 15724 | `acRenderMonitorLogModal` | fn |  |
| 15776 | `wireAutoContinuePane` | fn |  |
| 15806 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 15952 | `syncAutoContinue` | fn |  |
| 15957 | `applyAutoContinueState` | fn |  |
| 15970 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 15980 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 15986 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 16020 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 16038 | `stopNoDisturbAutoApprove` | fn |  |
| 16043 | `scheduleNdScan` | fn |  |
| 16047 | `ndQueueScanRoot` | fn |  |
| 16067 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 16089 | `ndNormalizeLabel` | fn |  |
| 16093 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 16101 | `ndClassifyApprovalCandidate` | fn |  |
| 16112 | `ndSessionIdForNode` | fn |  |
| 16118 | `ndApprovalContext` | fn |  |
| 16154 | `scanNoDisturbApproval` | fn |  |
| 16184 | `toNdAudit` | fn |  |
| 16192 | `getSleepMode` | fn |  |
| 16197 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 16215 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 16247 | `discoverSleepSessionBusy` | fn |  |
| 16278 | `isAnySessionBusy` | fn |  |
| 16292 | `startUntilDoneCheck` | fn |  |
| 16312 | `stopUntilDoneCheck` | fn |  |
| 16318 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 16358 | `fmtDateTime` | fn | 渲染账号列表 |
| 16365 | `fmtDateTimeSeconds` | fn |  |
| 16372 | `fmtCredits` | fn |  |
| 16379 | `fmtCreditExpiry` | fn |  |
| 16392 | `creditTip` | fn |  |
| 16404 | `creditBarHtml` | fn |  |
| 16421 | `todayUsageHtml` | fn |  |
| 16429 | `accountStatusTagsHtml` | fn |  |
| 16434 | `checkinBadgeHtml` | fn |  |
| 16443 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 16459 | `modelRateLimitTip` | fn |  |
| 16468 | `modelRateLimitBadgeHtml` | fn |  |
| 16480 | `modelRateLimitPopoverHtml` | fn |  |
| 16497 | `modelRateLimitSummaryPopoverHtml` | fn |  |
| 16519 | `creditBlockHtml` | fn |  |
| 16540 | `nearestCreditExpiry` | fn |  |
| 16552 | `sortAccountsByCreditExpiry` | fn |  |
| 16572 | `reorderAccountCards` | fn |  |
| 16585 | `mergeAccountSnapshot` | fn |  |
| 16605 | `clampDailyRatio` | fn |  |
| 16612 | `dailyProgressLabel` | fn |  |
| 16630 | `dailyRingsSvg` | fn |  |
| 16639 | `dailyRingsHtml` | fn |  |
| 16648 | `formatDailyTravelCountdown` | fn |  |
| 16659 | `dailyTravelCountdownText` | fn |  |
| 16665 | `dailyCatDetail` | fn |  |
| 16684 | `formatGrowthTaskDeadline` | fn |  |
| 16692 | `sortGrowthTasks` | fn |  |
| 16710 | `growthTaskActions` | fn |  |
| 16715 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 16727 | `growthAutoOf` | fn |  |
| 16731 | `growthAutoActionFor` | fn |  |
| 16740 | `startGrowthAuto` | fn |  |
| 16768 | `pollGrowthAuto` | fn |  |
| 16808 | `stopGrowthAutoPoll` | fn |  |
| 16816 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 16830 | `growthTaskRewardHtml` | fn |  |
| 16842 | `dailyProgressPopoverHtml` | fn |  |
| 16986 | `updateDailyProgressCells` | fn |  |
| 17009 | `refreshDailyProgressAccount` | fn |  |
| 17037 | `fetchDailyProgressForAccounts` | fn |  |
| 17064 | `accountCardLayoutKey` | fn |  |
| 17084 | `fmtBytes` | fn |  |
| 17094 | `fmtDuration` | fn |  |
| 17103 | `autoCopyTotalFailed` | fn |  |
| 17114 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 17120 | `autoCopyConflictTitle` | fn |  |
| 17126 | `autoCopyConflictDetail` | fn |  |
| 17136 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 17158 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 17164 | `autoCopyProgressEls` | fn |  |
| 17177 | `hideAutoCopyProgress` | fn |  |
| 17184 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 17289 | `scheduleAutoCopyHide` | fn |  |
| 17311 | `spaceNum` | fn |  |
| 17316 | `spaceShare` | fn |  |
| 17322 | `spaceTimeText` | fn |  |
| 17326 | `pad` | fn |  |
| 17330 | `spaceBaseName` | fn |  |
| 17335 | `spaceScanEls` | fn |  |
| 17352 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 17374 | `hideSpaceScanBox` | fn |  |
| 17380 | `stopSpacePolling` | fn |  |
| 17385 | `spaceJobSub` | fn |  |
| 17392 | `renderSpaceJob` | fn |  |
| 17409 | `spaceRowHtml` | fn |  |
| 17420 | `spaceRestRow` | fn |  |
| 17428 | `renderSpaceEmpty` | fn |  |
| 17445 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 17453 | `spaceSubText` | fn |  |
| 17472 | `spaceSortOf` | fn |  |
| 17480 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 17488 | `spaceSortName` | fn |  |
| 17495 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 17516 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 17534 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 17541 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 17552 | `renderSpaceResult` | fn |  |
| 17669 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 17687 | `scheduleSpacePoll` | fn |  |
| 17695 | `pollSpaceScan` | fn |  |
| 17718 | `startSpaceScan` | fn |  |
| 17739 | `cancelSpaceScan` | fn |  |
| 17751 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 17773 | `buildSpacesPane` | fn |  |
| 17806 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 17872 | `pollAutoCopyJob` | fn |  |
| 17879 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 17889 | `render` | fn |  |
| 18051 | `maskAccountName` | fn |  |
| 18059 | `maskAccountId` | fn |  |
| 18070 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 18096 | `toggleAccountMask` | fn |  |
| 18102 | `refresh` | fn |  |
| 18134 | `updateAccountSummary` | fn |  |
| 18159 | `rotationToday` | fn |  |
| 18164 | `closeRotationNotice` | fn |  |
| 18174 | `showRotationNotice` | fn |  |
| 18200 | `place` | fn |  |
| 18255 | `formatRotationEta` | fn |  |
| 18264 | `formatRotationDuration` | fn |  |
| 18275 | `checkCreditRotationAfterSession` | fn |  |
| 18277 | `run` | fn |  |
| 18299 | `updateCheckinCells` | fn |  |
| 18371 | `fetchActivityForAccounts` | fn |  |
| 18380 | `worker` | fn |  |
| 18419 | `requestCredit` | fn |  |
| 18445 | `updateCreditSummaryFromAccounts` | fn |  |
| 18454 | `refreshCreditForAccount` | fn |  |
| 18486 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 18491 | `settleBatch` | fn |  |
| 18501 | `queryAccount` | fn |  |
| 18552 | `updateCreditCell` | fn |  |
| 18596 | `updateDebugPanel` | fn |  |
| 18616 | `onDebugKey` | fn |  |
| 18625 | `markHealthGeneration` | fn |  |
| 18634 | `isHealthStopControl` | fn |  |
| 18639 | `isHealthSendControl` | fn |  |
| 18730 | `readTokenRateEnabled` | fn | 常开会让用户把估算当精确值；需要时在 面板 → 会话 → token 速度读数 手动打开，一旦手动开过就记住。 |
| 18734 | `writeTokenRateEnabled` | fn |  |
| 18739 | `applyTokenRateEnabled` | fn | 开关变化时立即生效：关 ⇒ 立刻隐藏并停算；开 ⇒ 恢复上一次读数、并重算。 |
| 18755 | `readTokenRatePos` | fn | 读用户拖动后保存的视口坐标；无有效值返回 null。 |
| 18766 | `saveTokenRatePos` | fn |  |
| 18774 | `tokenRateDefaultPos` | fn | 默认位 = 输入框下方空置带左侧、垂直居中。量不到返回 null（下次再试）。 |
| 18786 | `clampTokenRatePos` | fn | 夹进视口（留 4px 边距）。仅在交互 / 定位路径调用。 |
| 18795 | `applyTokenRatePos` | fn |  |
| 18801 | `reuseOrBuildTokenRateEl` | fn | 复用页面上已有的读数节点，否则新建；两者都补挂拖动。 |
| 18830 | `showTokenRateDragShield` | fn |  |
| 18842 | `hideTokenRateDragShield` | fn |  |
| 18852 | `setupTokenRateDrag` | fn | 小框就再也收不到 pointermove。而拖动本来就必须跟手到框外，所以直接吃 window 事件最稳。 |
| 18872 | `onWinMove` | fn |  |
| 18884 | `finishTokenRateDrag` | fn |  |
| 18938 | `readRateEstTokens` | fn | 仍是估算（真实用量只能从 usage 记录拿），但比一刀切贴近。只用 querySelectorAll + textContent，不触发 reflow。 |
| 18963 | `ensureTokenRateEl` | fn | 取（必要时新建）读数节点。常驻 body 直下 + position:fixed；无用户位置时贴输入框下方默认位。 |
| 18974 | `setTokenRateBadge` | fn |  |
| 19000 | `updateTokenRateBadge` | fn |  |
| 19162 | `mdqvT` | fn | 去重不用数组：直接在 tab 元素上打 __wbsAdoptSkip（随元素移除自动回收） |
| 19164 | `mdqvReadEnabled` | fn |  |
| 19167 | `mdqvWriteEnabled` | fn |  |
| 19170 | `mdqvReadAdopt` | fn |  |
| 19173 | `mdqvWriteAdopt` | fn |  |
| 19178 | `mdqvFindPathByName` | fn | 用产物文件名在页面里反查绝对路径（正文产物卡 / 产物面板条目都带 data-dir）。 |
| 19199 | `mdqvAdoptTick` | fn | 成本：一次 querySelector 实测 0.02 ms 级，600 ms 一次 ⇒ 可忽略。 |
| 19219 | `mdqvAdoptStart` | fn |  |
| 19233 | `mdqvFileUrl` | fn | 不编码会因空格/中文导致 fetch 失败；整体 encodeURI 又会把已有的 % 二次编码。 |
| 19245 | `mdqvNormPath` | fn | 「未编码绝对路径」，否则会拼出 file:///file:///… 或中文二次编码。 |
| 19257 | `mdqvShortPath` | fn | 完整路径仍放在 title 里可悬停查看。 |
| 19268 | `mdqvRootRect` | fn | 面板要贴住的区域：整个应用的可见区（#root），拿不到就退回 window。 |
| 19276 | `mdqvDefaultWidth` | fn | 默认宽度：对齐官方文档视图的观感（约内容区 1/3），并夹到可用范围。 |
| 19284 | `mdqvReadWidth` | fn |  |
| 19291 | `mdqvWriteWidth` | fn |  |
| 19304 | `mdqvPlace` | fn |  |
| 19315 | `mdqvDetachShellGuard` | fn |  |
| 19321 | `mdqvReapply` | fn | 重算并写回让位量。观察者与窗口 resize 都走这里。 |
| 19344 | `mdqvAttachShellGuard` | fn | 1936 ⇄ 2296 之间跳（连带把对话区右边缘推过我的面板左边缘）。两个节点都守。 |
| 19360 | `mdqvApplyShift` | fn | 对话区会滑到面板底下。用父容器当前宽度反推，两种状态都自洽。 |
| 19389 | `mdqvRestoreShift` | fn |  |
| 19421 | `wbsHlClass` | fn |  |
| 19430 | `wbsHighlight` | fn | 高亮入口：返回**已转义**的 HTML 片段。 |
| 19463 | `wbsSafeImg` | fn | 其余属性一律丢弃 —— 防止 md 里塞 onerror 之类的注入面。 |
| 19474 | `mdqvInline` | fn | &amp; 当 URL 二次转义」这类双重转义（URL 进属性位一律走 escAttr）。 |
| 19515 | `mdqvRender` | fn | 分隔线 / 行内语法。**刻意不做**数学与 mermaid —— 遇到就给一行提示，不静默丢内容。 |
| 19519 | `flushPara` | fn |  |
| 19524 | `flushQuote` | fn |  |
| 19529 | `flushList` | fn |  |
| 19534 | `flushAll` | fn |  |
| 19535 | `warn` | fn |  |
| 19536 | `closeFence` | fn |  |
| 19550 | `cellsOf` | fn |  |
| 19556 | `alignsOf` | fn |  |
| 19654 | `mdqvCopyText` | fn | 复制文本（面板内代码块的「复制」用；不依赖 mdqvOpen 内的 flash）。 |
| 19682 | `mdqvBindCodeCopy` | fn | 给代码块顶栏的「复制」按钮接线（面板内走真实监听器；导出的离线页走内联脚本）。 |
| 19697 | `mdqvClose` | fn |  |
| 19712 | `mdqvOpen` | fn |  |
| 19920 | `mdqvStandalone` | fn | 跟随系统深色偏好。样式刻意不复用注入页那份（那份依赖 --wb-* 变量，外部没有）。 |
| 19979 | `mdqvInstall` | fn |  |
| 20014 | `registerBuild` | fn |  |
| 20023 | `start` | fn |  |
| 20036 | `destroyWidget` | fn |  |
| 21427 | `refresh` | method |  |
| 21429 | `getLanguage` | method |  |
| 21430 | `setLanguage` | method |  |

## scripts/context-audit.js  （444 行 / 16 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 51 | `levelOf` | fn |  |
| 59 | `numberField` | fn |  |
| 67 | `safeStat` | fn |  |
| 76 | `countLines` | fn |  |
| 89 | `readFrontmatter` | fn | 解析 YAML frontmatter 里的 name / description（支持 `>`、`\|` 块标量）。 |
| 118 | `listSkills` | fn | 遍历若干根目录，收集全部 SKILL.md 的体积信息。 |
| 121 | `walk` | const |  |
| 150 | `auditMemory` | fn | 记忆/身份文件体积（这些是**每个会话都常驻**的）。 |
| 183 | `scanSessions` | fn |  |
| 211 | `occurrence` | const |  |
| 240 | `auditContext` | fn |  |
| 297 | `sessionScan` | const |  |
| 307 | `push` | const |  |
| 322 | `severity` | const |  |
| 351 | `severity` | const |  |
| 404 | `buildHandoff` | fn |  |

## scripts/context-fix.js  （194 行 / 8 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 28 | `dateStamp` | fn |  |
| 30 | `p` | const |  |
| 34 | `dirSize` | fn |  |
| 50 | `readActiveVersions` | fn |  |
| 57 | `plugins` | const |  |
| 75 | `listPruneTargets` | fn |  |
| 134 | `pruneSkillDupes` | fn |  |
| 178 | `applyContextFix` | fn |  |

合计 **1527** 个函数。
