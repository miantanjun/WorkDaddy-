# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-09-30 20:43:42
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （19160 行 / 630 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 56 | `resolveDaemonPrivilege` | fn |  |
| 268 | `readAutomationsTolerant` | fn |  |
| 690 | `persistScheduleLedger` | fn |  |
| 700 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 720 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 740 | `scheduleVerifyNotify` | fn |  |
| 750 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 757 | `nameOf` | const |  |
| 800 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 801 | `valid` | const |  |
| 826 | `diagnosticsEnabled` | fn |  |
| 834 | `redactDiagnosticText` | fn |  |
| 847 | `shouldPersistBreadcrumb` | fn |  |
| 853 | `validCdpPort` | fn |  |
| 857 | `readCdpPortFile` | fn |  |
| 866 | `writeCdpPortFile` | fn |  |
| 881 | `readUiPortFile` | fn |  |
| 885 | `writeUiPortFile` | fn |  |
| 900 | `cdpPortCandidates` | fn |  |
| 902 | `add` | const |  |
| 910 | `isLocalPortAvailable` | fn |  |
| 914 | `finish` | const |  |
| 929 | `findAvailableCdpPort` | fn |  |
| 936 | `selectCdpPort` | fn |  |
| 1012 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 1017 | `updateDebug` | fn |  |
| 1018 | `scrub` | const |  |
| 1048 | `writeUpdateAttempt` | fn |  |
| 1059 | `macWorkDaddyAppPath` | fn |  |
| 1082 | `resolveApplyUpdateVbs` | fn |  |
| 1101 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1114 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1126 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1155 | `githubAuthHeaders` | fn |  |
| 1165 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1189 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1191 | `fileName` | const |  |
| 1196 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1210 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1219 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1233 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1243 | `normalizeAssetSha256` | fn |  |
| 1248 | `expectedUpdateSha256` | fn |  |
| 1253 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1290 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1334 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1393 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1426 | `readUpstreamCache` | const |  |
| 1474 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1482 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1508 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1517 | `downloadUpdateInternal` | fn |  |
| 1575 | `cleanupTemp` | const |  |
| 1577 | `failDownload` | const |  |
| 1663 | `sha256File` | fn | 计算文件 SHA-256 |
| 1667 | `inspectPackagedApp` | fn |  |
| 1684 | `packagedAppVersionError` | fn |  |
| 1698 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 1752 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 1760 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 1800 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 1867 | `scheduleOAuthStateCleanup` | fn |  |
| 1873 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 1894 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 1923 | `accData` | const |  |
| 1935 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 1983 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 2008 | `markAttemptFailure` | const |  |
| 2017 | `markSpawnFailure` | const |  |
| 2139 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2154 | `log` | fn |  |
| 2165 | `isLockPermissionError` | fn |  |
| 2169 | `reportDaemonLockFallback` | fn |  |
| 2179 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2214 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2271 | `releaseDaemonLock` | fn |  |
| 2284 | `scheduleBackup` | fn |  |
| 2355 | `settlePendingReloadInjection` | fn |  |
| 2367 | `armPendingReloadInjection` | fn |  |
| 2389 | `runPendingReloadInjection` | fn |  |
| 2416 | `findCdpEndpoint` | fn |  |
| 2425 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2460 | `targetsBelongToProfile` | fn |  |
| 2480 | `isWorkBuddyCdpTarget` | fn |  |
| 2486 | `getPageTarget` | fn |  |
| 2492 | `cleanupForeignInjectedTargets` | fn |  |
| 2500 | `cleanupForeignInjectedTarget` | fn |  |
| 2509 | `finish` | const |  |
| 2552 | `cdpFocusDiagnostics` | fn |  |
| 2566 | `cdpMouseClick` | fn |  |
| 2589 | `cdpSend` | fn |  |
| 2607 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2608 | `raw` | const |  |
| 2620 | `connectCdp` | fn |  |
| 2697 | `waitForPageReadyThenDispatch` | fn |  |
| 2699 | `retry` | const |  |
| 2712 | `dispatchAutomationEvent` | fn |  |
| 2748 | `onCdpEvent` | fn |  |
| 2751 | `url` | const |  |
| 2832 | `cdpLoop` | fn |  |
| 2845 | `reloadWorkBuddyPage` | fn |  |
| 2847 | `withTimeout` | const |  |
| 2889 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 3012 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 3026 | `resolveWorkBuddyBinary` | fn |  |
| 3029 | `tryFile` | const |  |
| 3041 | `psCmd` | const |  |
| 3070 | `addCandidate` | const |  |
| 3114 | `psQuote` | const |  |
| 3131 | `runCommand` | fn |  |
| 3138 | `finish` | const |  |
| 3162 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3191 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3207 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3224 | `linuxWorkBuddyPids` | fn |  |
| 3248 | `workBuddyRunning` | fn |  |
| 3265 | `waitForWorkBuddyExit` | fn |  |
| 3280 | `waitForWorkBuddyExitTolerant` | fn |  |
| 3292 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 3338 | `detail` | const |  |
| 3370 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 3396 | `resolveLauncherHome` | fn |  |
| 3406 | `resolveLinuxLaunchTarget` | fn |  |
| 3421 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 3500 | `clickByText` | fn |  |
| 3546 | `findByText` | fn |  |
| 3575 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 3581 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 3584 | `claimLog` | fn |  |
| 3592 | `sleep` | fn |  |
| 3597 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 3644 | `automationStateFile` | const |  |
| 3645 | `readAutomationState` | fn |  |
| 3648 | `writeAutomationState` | fn |  |
| 3654 | `automationAccountStatus` | fn |  |
| 3688 | `automationDeepLocatorExpression` | fn |  |
| 3703 | `first` | fn |  |
| 3708 | `choose` | fn |  |
| 3709 | `firstByAttribute` | fn |  |
| 3719 | `automationDomAction` | fn |  |
| 3720 | `assertActive` | const |  |
| 3728 | `read` | const |  |
| 3784 | `automationHttpRequest` | fn |  |
| 3807 | `automationPublicRun` | fn |  |
| 3815 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 3826 | `automationPanelSetOpen` | fn |  |
| 3834 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 3843 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 3856 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 3871 | `automationNotifyToast` | fn |  |
| 3901 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 3902 | `assertAutoCopySucceeded` | fn |  |
| 3908 | `recordAccountSyncResult` | fn |  |
| 3920 | `assertAccountSwitchIdle` | fn |  |
| 3926 | `automationSwitchProgress` | fn |  |
| 3934 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 3951 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 3957 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 4004 | `limitFailoverManualPublic` | fn |  |
| 4023 | `readLimitFailoverState` | fn |  |
| 4032 | `writeLimitFailoverState` | fn |  |
| 4043 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 4057 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 4073 | `runCdpExpression` | fn |  |
| 4084 | `readLimitBanner` | fn |  |
| 4097 | `readStructuredError` | fn |  |
| 4101 | `readLiveModel` | fn |  |
| 4105 | `setLiveModel` | fn |  |
| 4109 | `readLastUserTaskText` | fn |  |
| 4117 | `readFailoverSnapshot` | fn |  |
| 4133 | `pickWorkbuddyDaemonClient` | fn |  |
| 4135 | `walk` | fn |  |
| 4172 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4187 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4204 | `edgeSyncMappingDbPath` | fn |  |
| 4219 | `getEdgeSyncDb` | fn |  |
| 4232 | `readEdgeSyncRows` | fn |  |
| 4245 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4271 | `probeCloudConversations` | fn |  |
| 4298 | `collectCloudGhosts` | fn |  |
| 4336 | `purgeCloudConversations` | fn |  |
| 4370 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 4387 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 4405 | `purgeCloudGhostsSwitching` | fn |  |
| 4414 | `switchBack` | const |  |
| 4455 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 4465 | `limitReplyStarted` | fn |  |
| 4470 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 4477 | `findLimitFailoverTask` | fn |  |
| 4481 | `runningLimitFailoverRun` | fn |  |
| 4485 | `waitLimitVerdict` | fn |  |
| 4510 | `runLimitFailoverCore` | fn |  |
| 4541 | `hits` | const |  |
| 4830 | `buildLimitFailoverPorts` | fn |  |
| 4915 | `limitFailoverDesktopLogDir` | fn |  |
| 4924 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 4938 | `limitFailoverNotify` | fn |  |
| 4946 | `readLimitReplyIdle` | fn |  |
| 4950 | `limitFailoverAccountByUid` | fn |  |
| 4956 | `limitFailoverPrimaryUid` | fn |  |
| 4964 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 4970 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 4979 | `cancelLimitFailoverSwitchBack` | fn |  |
| 4992 | `limitFailoverPlanCancelled` | fn |  |
| 4996 | `finishLimitFailoverSwitchBack` | fn |  |
| 5019 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 5034 | `runLimitFailoverSwitchBack` | fn |  |
| 5035 | `isCancelled` | const |  |
| 5036 | `elapsedMs` | const |  |
| 5037 | `stopIfUnsafe` | const |  |
| 5157 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5192 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5254 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5264 | `readSessionActivity` | fn |  |
| 5269 | `idleSwitchbackPublicState` | fn |  |
| 5302 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 5362 | `idleSwitchbackTick` | fn |  |
| 5421 | `startIdleSwitchbackTicker` | fn |  |
| 5433 | `automationSwitchAccount` | fn |  |
| 5492 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 5499 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 5517 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 5530 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 5553 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 5565 | `automationAccountSwitchGuarded` | fn |  |
| 5587 | `startAutomationRun` | fn |  |
| 5603 | `isCancelled` | const |  |
| 5606 | `appendRunLog` | const |  |
| 5617 | `panelPrepare` | const |  |
| 5629 | `withInput` | const |  |
| 5646 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 5656 | `readSession` | const | 必须保持原语义，否则会波及后面的「发送是否被受理」判定）。 |
| 5664 | `sessionAction` | const |  |
| 5672 | `openedUid` | const |  |
| 5703 | `accountUid` | const |  |
| 5799 | `completionReport` | const |  |
| 5826 | `publicAccounts` | const |  |
| 5827 | `publicCurrent` | const |  |
| 5830 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 5898 | `resumeAutomationAfterNavigation` | fn |  |
| 5909 | `todayStr` | fn |  |
| 5911 | `z` | const |  |
| 5915 | `loadCheckinCache` | fn |  |
| 5922 | `saveCheckinCache` | fn |  |
| 5934 | `refreshAccountBackupToken` | fn | 刷新备份账号凭证：临期惰性刷新，或距上次刷新超过一天时执行保活。 |
| 5988 | `dailyCheckin` | fn |  |
| 6037 | `claimDailyForUid` | fn |  |
| 6046 | `performAccountCheckin` | fn |  |
| 6092 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 6156 | `desc` | const |  |
| 6201 | `buildInjectScript` | fn |  |
| 6238 | `injectWidgetManual` | fn |  |
| 6246 | `readCdpTargets` | fn |  |
| 6257 | `readLogTail` | fn |  |
| 6268 | `collectDiagnostics` | fn |  |
| 6293 | `writeDiagnosticsSnapshot` | fn |  |
| 6314 | `sqliteRun` | fn |  |
| 6320 | `codeBuddySessionRows` | fn |  |
| 6335 | `sqlParamAt` | fn |  |
| 6338 | `sqliteQuery` | fn |  |
| 6380 | `officialSlotOf` | fn | 本地时区槽位 `YYYY-MM-DDTHH:MM`（与 scheduled-send 的 localSlot 同格式）。 |
| 6381 | `pad` | const |  |
| 6398 | `readOfficialAutomations` | fn |  |
| 6409 | `items` | const |  |
| 6443 | `findOfficialSlotConflicts` | fn |  |
| 6472 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 6491 | `createDirectoryNoFollow` | fn |  |
| 6510 | `repairMissingSessionWorkspaces` | fn |  |
| 6536 | `sessionRangeMs` | fn |  |
| 6553 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 6557 | `copyOne` | const |  |
| 6583 | `onlyCopyable` | const | 要拦的只有 socket / FIFO / 字符设备 / 块设备这类**根本无法复制**的特殊文件。 |
| 6691 | `sessionBodyMtime` | fn |  |
| 6708 | `sessionContentMtime` | fn |  |
| 6712 | `visit` | const |  |
| 6746 | `directoryStats` | fn |  |
| 6775 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 6786 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 6812 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 6827 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 6838 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 6858 | `sortAutoCopyPlanBySize` | fn |  |
| 6877 | `readCopyManifestCache` | fn |  |
| 6888 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 6897 | `deriveCopyManifestFromCache` | fn |  |
| 6924 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 6935 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 6957 | `emptyWorkspaceCounters` | fn |  |
| 6965 | `transferWorkspaceTree` | fn |  |
| 6973 | `copyFileAt` | const |  |
| 7066 | `copySessionWorkspacePayload` | fn |  |
| 7088 | `outcome` | const |  |
| 7100 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 7121 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 7242 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 7264 | `forcedSource` | const | 真分叉下「最新」并不等于「用户想要的那份」，按时间选会静默丢另一边的内容。 |
| 7276 | `trackPayload` | const |  |
| 7334 | `sleepMs` | const |  |
| 7445 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 7491 | `listAutoCopyConflicts` | fn |  |
| 7504 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 7518 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 7544 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 7644 | `readNativeDeleteSweep` | fn |  |
| 7651 | `saveNativeDeleteSweep` | fn |  |
| 7664 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 7671 | `sweepNativeSessionDeletes` | fn |  |
| 7743 | `readArchiveIsolation` | fn |  |
| 7750 | `saveArchiveIsolation` | fn |  |
| 7764 | `archiveIsolationEnabled` | fn |  |
| 7769 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 7785 | `members` | const |  |
| 7853 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 7902 | `purgeLocalSessionCopyCore` | fn |  |
| 7934 | `purgeArchivedCrossAccountCopies` | fn |  |
| 7985 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 8062 | `summarizeSessionImportErrors` | fn |  |
| 8072 | `archiveRelativePath` | fn |  |
| 8076 | `collectSessionArchiveFiles` | fn |  |
| 8079 | `collect` | const |  |
| 8119 | `ensureArchiveParentNoFollow` | fn |  |
| 8138 | `restoreSessionArchiveFiles` | fn |  |
| 8161 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 8192 | `getSessionSyncCache` | fn |  |
| 8215 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 8231 | `isTaskSessionRecord` | fn |  |
| 8236 | `sqlPlaceholders` | fn |  |
| 8240 | `insertCopiedSession` | fn |  |
| 8270 | `createForkSession` | fn |  |
| 8303 | `prepareSessionExport` | fn |  |
| 8320 | `exportSessions` | fn |  |
| 8334 | `validImportedSessionUid` | fn |  |
| 8340 | `importSessions` | fn |  |
| 8344 | `importSessionArchives` | fn |  |
| 8392 | `adoptExistingCopyTarget` | fn |  |
| 8436 | `copySessionRecord` | fn |  |
| 8453 | `perform` | const |  |
| 8574 | `getSessionDirtyIndex` | fn |  |
| 8582 | `scheduleSessionDirtySave` | fn |  |
| 8599 | `markSessionDirty` | fn | 记一条脏标记；**只有真变化才置脏**（同一时刻的重复通知不写盘）。 |
| 8610 | `markSessionDirtyBaseline` | fn | renderer 建立基线（`body.ready`）。未建基线的账号一律 fail-open = 全当脏。 |
| 8615 | `clearSessionDirty` | fn | 清一条脏标记；`expectedAt` 不匹配就不清（**并发到来的新事件不许被旧的在飞清理抹掉**）。 |
| 8624 | `autoCopyDirtyFastpathEnabled` | fn | 批次 3 的开关：**默认关**（文件缺失 / 内容不是 {enabled:true} 都算关）。每次规划读一次。 |
| 8640 | `isAutoCopyRowCleanByDirty` | fn |  |
| 8645 | `lineageId` | const |  |
| 8654 | `buildAutoCopyPlan` | fn |  |
| 8737 | `isAutoCopyPausedError` | fn |  |
| 8744 | `beginRendererReloadPriority` | fn |  |
| 8759 | `hasPendingAutoCopyTo` | fn |  |
| 8768 | `pruneAutoCopyJobs` | fn |  |
| 8778 | `runAutoCopyQueue` | fn |  |
| 8808 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 8875 | `enterSwitchFlowRunner` | fn | 进入一个切号流程；返回**幂等**的退出函数（重复调用不会把计数减成负）。 |
| 8904 | `setSwitchFlowPhase` | fn |  |
| 8910 | `terminal` | const |  |
| 8945 | `readSwitchFlowState` | fn | 读状态（惰性过期：终态留 TTL 供渲染层读到，过期即清）。 |
| 8957 | `requestSwitchFlowCancel` | fn | 「关闭弹窗」：置取消位 + 立刻请求中止复制（worker 在下个检查点收尾，不是硬停）。 |
| 9011 | `waitPreSyncSettled` | fn |  |
| 9065 | `preSyncBeforeSwitch` | fn |  |
| 9167 | `resolveSyncNowSources` | fn |  |
| 9168 | `all` | const |  |
| 9204 | `limitFailoverSyncWaitMs` | fn |  |
| 9239 | `openConversationById` | fn |  |
| 9263 | `fastExpr` | const |  |
| 9348 | `sidebarProbe` | const |  |
| 9518 | `prepareFailoverContinuation` | fn |  |
| 9524 | `degrade` | const |  |
| 9626 | `startAutoCopyJob` | fn |  |
| 9699 | `run` | const |  |
| 9707 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 9991 | `activeAutoCopyJob` | fn |  |
| 10004 | `publicAutoCopyJob` | fn |  |
| 10086 | `publicSpaceScanJob` | fn |  |
| 10110 | `buildSpaceScanResolvers` | fn |  |
| 10156 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 10168 | `startSpaceScanJob` | fn |  |
| 10258 | `isValidSessionId` | fn |  |
| 10267 | `matchedSessionIds` | fn |  |
| 10272 | `resolveManagedSessionTarget` | fn |  |
| 10285 | `isManagedDirectoryNoFollow` | fn |  |
| 10309 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 10343 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 10349 | `delOne` | const |  |
| 10393 | `json` | fn |  |
| 10422 | `isAllowedApiOrigin` | fn |  |
| 10442 | `hasApiToken` | fn |  |
| 10449 | `isApiRequestAuthorized` | fn |  |
| 10458 | `isAllowedDevtoolsOrigin` | fn |  |
| 10498 | `readBody` | fn |  |
| 10503 | `ignoreLateError` | const |  |
| 10504 | `cleanup` | const |  |
| 10514 | `finish` | const |  |
| 10520 | `fail` | fn |  |
| 10526 | `onData` | fn |  |
| 10539 | `onEnd` | fn |  |
| 10550 | `onError` | fn |  |
| 10553 | `onIncomplete` | fn |  |
| 10585 | `workbuddySettingsPath` | fn |  |
| 10589 | `readWorkbuddySettings` | fn |  |
| 10597 | `writeWorkbuddySettings` | fn |  |
| 10603 | `buildAskRuleBlock` | fn |  |
| 10608 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 10618 | `getAskModeState` | fn |  |
| 10620 | `customPrompt` | const |  |
| 10633 | `setAskMode` | fn |  |
| 10648 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 10690 | `buildZhReasoningBlock` | fn |  |
| 10695 | `stripZhReasoning` | fn | 从 customPrompt 中移除中文思考段（保留用户其它内容与决策弹窗段） |
| 10705 | `getZhReasoningState` | fn |  |
| 10707 | `customPrompt` | const |  |
| 10723 | `setZhReasoning` | fn |  |
| 10743 | `refreshZhReasoningIfEnabled` | fn | 启动时调用：如已启用中文思考，把旧的规则段替换为最新版本（用标记精确识别） |
| 10779 | `buildAgentHintRule` | fn |  |
| 10807 | `buildAgentHintBlock` | fn |  |
| 10814 | `stripAgentHint` | fn | 从 customPrompt 中移除子 Agent 提示段（保留用户其它内容，**且不改动用户原文一个字节**）。 |
| 10829 | `getAgentHintState` | fn |  |
| 10831 | `customPrompt` | const |  |
| 10848 | `setAgentHint` | fn |  |
| 10875 | `refreshAgentHintIfEnabled` | fn | 启动时调用：如已开启，把旧的提示规则替换为最新版本（用标记精确识别）。 |
| 10904 | `collectAgentUsage` | fn |  |
| 10960 | `readNoDisturbState` | fn |  |
| 10963 | `state` | const |  |
| 10985 | `readNoDisturbApplied` | fn |  |
| 10989 | `hasAll` | const |  |
| 11004 | `removeListItems` | fn |  |
| 11010 | `ensureSandboxObj` | fn |  |
| 11019 | `applyNoDisturbSwitch` | fn |  |
| 11023 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 11029 | `rollback` | const |  |
| 11077 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 11092 | `noDisturbAudit` | fn |  |
| 11127 | `acAppConfigPath` | fn |  |
| 11130 | `readAppConfig` | fn |  |
| 11138 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 11143 | `acBlock` | fn |  |
| 11150 | `stripACBlocks` | fn |  |
| 11156 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 11162 | `acCustomPromptPresent` | fn |  |
| 11167 | `readAutoContinueState` | fn |  |
| 11182 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 11199 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 11213 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 11230 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 11250 | `sessBuild` | fn |  |
| 11258 | `readSessionState` | fn |  |
| 11260 | `ns` | const |  |
| 11261 | `st` | const |  |
| 11293 | `writeSessionState` | fn |  |
| 11295 | `prior` | const |  |
| 11304 | `setSessionSwitch` | fn |  |
| 11312 | `addQuickPhrase` | fn |  |
| 11324 | `updateQuickPhrase` | fn |  |
| 11334 | `deleteQuickPhrases` | fn |  |
| 11341 | `normalizeQuickPhraseIds` | fn |  |
| 11353 | `exportQuickPhrases` | fn |  |
| 11369 | `importQuickPhrases` | fn |  |
| 11394 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 11403 | `selectAutomationModelById` | fn |  |
| 11416 | `confirmAutomationModel` | fn |  |
| 11424 | `restoreAutomationNewTaskPreference` | fn |  |
| 11432 | `automationAgentSurfaceExpression` | fn |  |
| 11434 | `visible` | fn |  |
| 11435 | `isNewTask` | fn |  |
| 11436 | `composerText` | fn |  |
| 11463 | `readAutomationAgentSurface` | fn |  |
| 11471 | `ensureAutomationNewTask` | fn |  |
| 11531 | `openNewAutomationAgentTask` | fn |  |
| 11550 | `currentAccount` | fn |  |
| 11556 | `a` | const |  |
| 11585 | `readAccountHealth` | fn |  |
| 11593 | `writeAccountHealth` | fn |  |
| 11609 | `recordAccountHealth` | fn |  |
| 11625 | `mergeLiveHealth` | fn |  |
| 11645 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 11653 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 11670 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 11689 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 11705 | `sweepAccountHealth` | fn |  |
| 11724 | `buildFailoverHealthFilter` | fn |  |
| 11752 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 11762 | `accountHealthEcho` | fn |  |
| 11775 | `accountBackupFile` | fn |  |
| 11796 | `gatewayStatus` | fn |  |
| 11816 | `gatewayCollectAccounts` | fn | 读本仓已登录的账号并解密（**复用 lib.js 的 [wd-compat] 解密器**，不另写一份帧格式）。 |
| 11825 | `auth` | const |  |
| 11826 | `account` | const |  |
| 11845 | `gatewayProbeHealth` | fn | 探活（/healthz 免鉴权）。null = 不可达。 |
| 11861 | `gatewayInstall` | fn | 下载 → SHA-256 校验 → 解压 → 凭证桥 → 生成 config。任一环节失败都不留半成品可用状态。 |
| 11863 | `task` | const |  |
| 11923 | `gatewayReadEnabled` | fn | 「用户是否启用」是 WorkDaddy 侧意图，与「装没装」分开记（沿用免打扰开关的记法）。 |
| 11930 | `gatewaySetEnabled` | fn |  |
| 11943 | `gatewayStart` | fn | 启动网关子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 11967 | `gatewayStop` | fn |  |
| 11975 | `refreshGatewayIfEnabled` | fn | 启动时：用户启用过就自动拉起（与 autoContinue 的「启动补写」同模式；未安装则静默跳过）。 |
| 11988 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 11993 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 11998 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 12025 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 12031 | `stashRecordByKey` | fn |  |
| 12038 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 12066 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 12089 | `buildBusyExpr` | fn |  |
| 12100 | `visibleIn` | fn | 误判空闲会在回复中输入，正文/图片回填容易失败，这是原设计刻意保守的原因。 |
| 12127 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 12138 | `busy` | const |  |
| 12169 | `resolveUsageBoardPython` | fn | 解析可用的 python：环境变量 → 托管 venv → 托管 base（版本目录）→ PATH 兜底。 |
| 12191 | `latestUsageBoardHtml` | fn | usage-board 目录里最新一份看板 HTML 文件名；没有则返回 null。 |
| 12202 | `latestUsageUnifiedHtml` | fn | 统一用量看板的产物：unified-board-<stamp>.html。 |
| 12216 | `creditUsageQuery` | fn |  |
| 12224 | `readUsageStatusJson` | fn |  |
| 12229 | `runUsageStatusExtractor` | fn | 跑一次第三方抽取器（只为补充指标）。失败/超时都只返回 ok:false，绝不抛。 |
| 12235 | `done` | const |  |
| 12257 | `builtinAssetsDir` | fn |  |
| 12273 | `builtinWallpaperSource` | fn |  |
| 12282 | `initBuiltinAssets` | fn |  |
| 12517 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 12544 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 12574 | `accountSwitchThemeExpression` | fn | 会被启动时的旧云端选择覆盖。这里不安装 hook，也不改其他账号或皮肤 CSS。 |
| 12619 | `preserveAccountSwitchTheme` | fn |  |
| 12636 | `nativeAppearanceSyncExpression` | fn | 的 CSS 资源；浅色/深色仍由 WorkBuddy 原生状态负责。 |
| 12639 | `removeNativeSheet` | fn |  |
| 12647 | `setAttr` | fn |  |
| 12652 | `setMode` | fn |  |
| 12663 | `sync` | fn |  |
| 12708 | `startNativeAppearanceSyncByCdp` | fn |  |
| 12713 | `releaseThemeByCdp` | fn |  |
| 12727 | `restoreNativeAppearanceByCdp` | fn |  |
| 12731 | `uid` | const |  |
| 12804 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 12848 | `loadThemePatches` | fn |  |
| 12864 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 12876 | `loadThemeVars` | fn |  |
| 12892 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 12896 | `declOf` | const |  |
| 12907 | `lead` | const |  |
| 12915 | `readBackgroundBlur` | fn |  |
| 12926 | `applyThemeByCdp` | fn |  |
| 12960 | `uid` | const |  |
| 12962 | `colors` | const |  |
| 13085 | `wbsBuiltinAppearance` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 13097 | `wbsSnapshotNativeAppearance` | fn |  |
| 13121 | `wbsClearNativeCustomCss` | fn |  |
| 13160 | `wbsWriteAppearanceState` | fn |  |
| 13168 | `wbsSyncAppearanceKeys` | fn |  |
| 13195 | `wbsPrepareNativeAppearance` | fn |  |
| 13203 | `wbsSyncNativeTheme` | fn |  |
| 13217 | `wbsSyncNativeThemeQuiet` | fn | wbsSyncNativeThemeIdempotent：250ms 守护/keeper 的周期调用路径，属性同值时不写。 |
| 13272 | `keepSelectedTheme` | fn |  |
| 13310 | `wbsHasSpecialNativeAppearance` | fn |  |
| 13335 | `wbsHoldNativeAppearance` | fn |  |
| 13407 | `clearComposerByCdp` | fn |  |
| 13460 | `fnv1a32` | fn |  |
| 13477 | `composerDraftHash` | fn |  |
| 13494 | `composerDraftExpr` | fn |  |
| 13534 | `composerDraftConsumed` | fn |  |
| 13565 | `composerSendExpr` | const |  |
| 13569 | `fiberOf` | fn |  |
| 13577 | `isStore` | fn |  |
| 13634 | `sendStashToComposer` | fn |  |
| 13640 | `guardedSend` | const |  |
| 13643 | `allItems` | const |  |
| 13652 | `s` | const |  |
| 13805 | `countBlocks` | const |  |
| 13815 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 13861 | `name` | const |  |
| 13877 | `disp` | const |  |
| 13888 | `visible` | fn |  |
| 13960 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 13974 | `readDraft` | const |  |
| 13982 | `draftConsumed` | const |  |
| 13985 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 14082 | `fetchResource` | fn |  |
| 14116 | `data` | const |  |
| 14119 | `accounts` | const |  |
| 14151 | `fetchEnterpriseResource` | fn |  |
| 14197 | `robustFetchEnterpriseResource` | fn |  |
| 14220 | `resolveEnterpriseId` | fn |  |
| 14248 | `retryDelay` | const |  |
| 14252 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 14284 | `fetchCredits` | fn |  |
| 14342 | `refreshCreditRotationAccounts` | fn |  |
| 14366 | `rememberCreditRotation` | fn |  |
| 14378 | `cachedCreditRotationAccounts` | fn |  |
| 14390 | `listDailyUsage` | fn |  |
| 14396 | `syncCurrentCreditUsage` | fn |  |
| 14399 | `task` | const |  |
| 14440 | `exportSecretKey` | fn |  |
| 14444 | `decryptLegacyExport` | fn |  |
| 14455 | `handleApiRoute` | fn |  |
| 14774 | `currentHealth` | const |  |
| 15174 | `code` | const | ⚠️「没有可委派的模型」是**用户可修正**的状态 ⇒ 400，不是 500 |
| 15528 | `uid` | const |  |
| 15591 | `d` | const |  |
| 15665 | `html` | const |  |
| 15891 | `uid` | const |  |
| 16028 | `dayOf` | const | 积分窗口与 token 窗口取同一个区间：分子分母同区间，否则 credit/1k 会被拉偏。 |
| 16085 | `finish` | const |  |
| 16162 | `pad` | const |  |
| 16170 | `prune` | const |  |
| 16363 | `worker` | const |  |
| 16400 | `uid` | const |  |
| 16995 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 17342 | `run` | const |  |
| 17592 | `targetUid` | const |  |
| 17621 | `targetUid` | const |  |
| 17972 | `id` | const |  |
| 18259 | `uid` | const |  |
| 18260 | `conv` | const |  |
| 18261 | `safe` | const |  |
| 18267 | `items` | const |  |
| 18330 | `key` | const |  |
| 18343 | `key` | const |  |
| 18358 | `key` | const |  |
| 18415 | `uid` | const |  |
| 18632 | `handleApi` | fn |  |
| 18633 | `failure` | const |  |
| 18664 | `stopCaffeinate` | fn |  |
| 18684 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 18692 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 18695 | `tick` | const |  |
| 18707 | `startCaffeinate` | fn |  |
| 18738 | `applySleepMode` | fn |  |
| 18767 | `sleepNow` | fn |  |
| 18788 | `restoreSleepMode` | fn |  |
| 18799 | `startServer` | fn |  |
| 18962 | `cleanup` | const |  |
| 18979 | `tryListen` | const |  |
| 19046 | `migrateAgentHintModel` | fn |  |
| 19049 | `cp` | const |  |
| 19112 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （21813 行 / 901 个函数）

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
| 1872 | `wbsSystemLanguage` | fn |  |
| 1876 | `wbsNormalizeLanguage` | fn |  |
| 1881 | `escapeRegExp` | fn |  |
| 1882 | `wbsI18nBuildMatchers` | fn |  |
| 1919 | `wbsTranslateString` | fn |  |
| 1969 | `wbsIsBuiltinAutomation` | fn |  |
| 1978 | `wbsBuiltinAutomationText` | fn |  |
| 2030 | `wbsAutomationText` | fn |  |
| 2035 | `wbsAutomationEditedText` | fn |  |
| 2046 | `wbsReportErr` | fn |  |
| 2086 | `wbsClientVersion` | fn |  |
| 2208 | `isIdentityExpired` | fn | 今日签到状态展示：账号卡片底部与积分余额并列显示 |
| 2225 | `accountHealthLocked` | fn | 那个看 tokenExpiresAt / 签到 401，这个看 daemon 下发的账号健康视图）。 |
| 2230 | `esc` | fn |  |
| 2231 | `escAttr` | fn |  |
| 2234 | `summarizeCreditDays` | fn | 每个积分段只归入一个剩余天数桶；缺失有效期的余额不展示，不猜测到期日。 |
| 2236 | `add` | fn |  |
| 2262 | `creditOpacity` | fn |  |
| 2267 | `createAvatarLibrary` | fn |  |
| 2269 | `validImage` | fn |  |
| 2285 | `snapshot` | fn |  |
| 2286 | `commit` | fn |  |
| 2293 | `select` | method |  |
| 2297 | `add` | method |  |
| 2304 | `remove` | method |  |
| 2312 | `resolveAvatarChoice` | fn |  |
| 2318 | `checkinHtml` | fn |  |
| 2325 | `activityStreakHtml` | fn |  |
| 2336 | `isKnownActivityStreak` | fn |  |
| 2340 | `el` | fn |  |
| 2347 | `maskPhone` | fn |  |
| 2353 | `fmtTime` | fn |  |
| 2363 | `initial` | fn |  |
| 2369 | `api` | fn |  |
| 2396 | `collectAll` | fn | 调试：递归收集所有元素（含 shadowRoot 与同域 iframe），用于抓取输入框内容 |
| 2410 | `allElements` | fn |  |
| 2423 | `captureComposer` | fn | 调试：抓取 WorkBuddy 输入框当前内容（文字/图片/附件/连接器/skill） |
| 2482 | `findComposer` | fn |  |
| 2492 | `findComposerRaw` | fn |  |
| 2539 | `composerHasContent` | fn | composerTextFromTree 跳过这两类装饰子树。 |
| 2547 | `getComposerContent` | fn | 干净地抓取输入框内容：只取 Slate 节点（不受页面装饰干扰） |
| 2563 | `getConversationId` | fn | 尽量拿到当前会话 id（URL / 当前布局选中会话 / 标题兜底） |
| 2578 | `build` | fn |  |
| 2583 | `send` | method |  |
| 2604 | `removeTimer` | fn |  |
| 2608 | `setBuildTimeout` | fn |  |
| 2616 | `setBuildInterval` | fn |  |
| 2623 | `requestBuildFrame` | fn |  |
| 2632 | `listen` | fn |  |
| 2639 | `toast` | fn |  |
| 2643 | `receiveToast` | fn |  |
| 2677 | `switchFlowAccountLabel` | fn |  |
| 2684 | `switchFlowMaskEl` | fn |  |
| 2686 | `buildSwitchFlowMask` | fn |  |
| 2717 | `renderSwitchFlow` | fn |  |
| 2792 | `cancelSwitchFlow` | fn |  |
| 2818 | `scheduleSwitchFlowPoll` | fn |  |
| 2823 | `pollSwitchFlow` | fn |  |
| 2858 | `isVisibleHealthNode` | fn |  |
| 2866 | `findBlockingPrompt` | fn |  |
| 2895 | `findSessionError` | fn |  |
| 2915 | `readAssistantHealth` | fn |  |
| 2946 | `setSessionHealthResult` | fn |  |
| 2969 | `scanSessionHealth` | fn |  |
| 3046 | `summary` | method |  |
| 3047 | `active` | method |  |
| 3048 | `generation` | method |  |
| 3049 | `root` | method |  |
| 3053 | `summary` | method |  |
| 3054 | `active` | method |  |
| 3055 | `generation` | method |  |
| 3056 | `root` | method |  |
| 3061 | `isUsableThemeAuditRoot` | fn |  |
| 3070 | `findThemeAuditRoot` | fn |  |
| 3081 | `syncThemeAuditRoot` | fn |  |
| 3103 | `applyI18n` | fn |  |
| 3148 | `setLanguage` | fn |  |
| 3167 | `applyInjectedI18n` | fn |  |
| 3421 | `qpDiag` | fn | 面板关闭/重开：点击选项（发送/编辑/任意项）后关闭面板；重新进入按钮区恢复 hover 可展示 |
| 3434 | `mountExplorePopover` | fn | keeps it above the usage summary even when the composer creates its own layer. |
| 3438 | `listen` | fn |  |
| 3442 | `cancelClose` | fn |  |
| 3443 | `close` | fn |  |
| 3444 | `open` | fn |  |
| 3454 | `delayedClose` | fn |  |
| 3477 | `acMenuClose` | fn |  |
| 3491 | `readMessageNavigationEnabled` | fn |  |
| 3494 | `writeMessageNavigationEnabled` | fn |  |
| 3497 | `readSelectionQuoteEnabled` | fn |  |
| 3500 | `writeSelectionQuoteEnabled` | fn |  |
| 3503 | `readForkEnabled` | fn |  |
| 3506 | `writeForkEnabled` | fn |  |
| 3522 | `applySessionModule` | fn |  |
| 3551 | `syncSessionModule` | fn |  |
| 3557 | `setSessionSwitchWire` | fn | 开关切换：写 daemon 并回应用户界（设置失败回滚 UI 状态） |
| 3581 | `selectionQuoteElement` | fn | WorkBuddy 的 selection-quote renderer 会通过 InputContextTag 自己渲染消息图标。 |
| 3596 | `selectionQuoteBlock` | fn |  |
| 3613 | `hideSelectionQuoteButton` | fn |  |
| 3618 | `updateSelectionQuoteButton` | fn |  |
| 3641 | `scheduleSelectionQuoteButton` | fn |  |
| 3647 | `insertSelectionQuote` | fn |  |
| 3667 | `setupSelectionQuote` | fn |  |
| 3705 | `renderQpList` | fn | 增强页快捷短语列表渲染（含批量模式） |
| 3772 | `renderExploreOptions` | fn | 发送按钮面板选项 = 快捷短语列表；点击项经 CDP 发送该短语（替换式，发完默认关面板） |
| 3843 | `openQpEdit` | fn | 新增/编辑快捷短语弹窗（参考账号导出弹窗；textarea 最多 5 行 / 500 字） |
| 3866 | `closeQpEdit` | fn |  |
| 3887 | `confirmQpDelete` | fn | 删除二次确认弹窗（支持单选/批量） |
| 3901 | `closeQpDel` | fn |  |
| 3919 | `findActionRow` | fn | 定位输入框操作栏（含 voice-mic-wrap 的父容器） |
| 3949 | `findSendButton` | fn | 操作栏最右侧的「圆形可点击」元素才是发送按钮（左侧还可能有增强提示词/停止等圆形按钮） |
| 3977 | `isSendDisabled` | fn | 发送按钮是否处于「禁用」态（输入框为空时官方会禁用它） |
| 3988 | `insertStash` | fn | 新版或旧版内联工具栏存在时放进工具栏；带 voice-mic-wrap 的旧布局保持固定定位。 |
| 4017 | `isComposerAnchorVisible` | fn |  |
| 4026 | `positionExplore` | fn | 探索菜单按钮：位于暂存提示词按钮右侧（与暂存同款圆钮、发送图标，hover 悬浮菜单弹窗） |
| 4033 | `applyThemeButtonColors` | fn | 使用实时主题变量，颜色变化由 CSS 继承处理，无需监听深浅色属性。 |
| 4039 | `positionStash` | fn |  |
| 4106 | `removeStash` | fn |  |
| 4111 | `isWelcomePage` | fn | 用户要求欢迎页不展示暂存提示词按钮（欢迎页输入框只是快速提问入口，不需要暂存）。 |
| 4120 | `shouldShowStash` | fn | 欢迎页一律不显示。 |
| 4126 | `syncStash` | fn |  |
| 4154 | `watchSend` | fn |  |
| 4168 | `watchRow` | fn |  |
| 4187 | `guardSessionChange` | fn | 标签同步只对当前会话生效（syncQueueTags 内按 sessionId 过滤），旧会话的标签由面板重渲染自然清除。 |
| 4196 | `createMessageNavigation` | fn | 会话消息导航：完整索引来自 controller.messageStore，DOM 仅用于判断当前可见位置。 |
| 4226 | `messageText` | fn |  |
| 4247 | `ensureRoot` | fn |  |
| 4291 | `position` | fn |  |
| 4312 | `setActive` | fn |  |
| 4323 | `hideTooltip` | fn |  |
| 4334 | `showTooltip` | fn |  |
| 4359 | `render` | fn |  |
| 4377 | `updateActive` | fn |  |
| 4412 | `scheduleActive` | fn |  |
| 4429 | `refreshFromStore` | fn |  |
| 4454 | `unbindStore` | fn |  |
| 4467 | `bindAdapter` | fn |  |
| 4484 | `sync` | fn |  |
| 4534 | `setEnabled` | fn |  |
| 4549 | `turnForButton` | fn |  |
| 4554 | `navigateToTurn` | fn |  |
| 4565 | `dragIndexAt` | fn |  |
| 4576 | `onNavPointerDown` | fn |  |
| 4588 | `onNavPointerMove` | fn |  |
| 4596 | `finishNavDrag` | fn |  |
| 4618 | `onNavPointerUp` | fn |  |
| 4619 | `onNavPointerCancel` | fn |  |
| 4620 | `onPointerOver` | fn |  |
| 4625 | `onPointerOut` | fn |  |
| 4631 | `onFocusIn` | fn |  |
| 4635 | `onFocusOut` | fn |  |
| 4639 | `onClick` | fn |  |
| 4651 | `onKeyDown` | fn |  |
| 4660 | `onWindowChange` | fn |  |
| 4694 | `hideForkTooltip` | fn |  |
| 4695 | `showForkTooltip` | fn |  |
| 4713 | `syncForkButtons` | fn |  |
| 4735 | `scheduleForkButtons` | fn |  |
| 4821 | `wbsPanelShown` | fn | 因此：① 只在可见时做面板内的工作；② 只对「与注入功能相关」的 mutation 反应。 |
| 4827 | `wbsTabActive` | fn |  |
| 4833 | `wbsMutationsRelevant` | fn |  |
| 4847 | `onDomChange` | fn |  |
| 4861 | `onInputSync` | fn |  |
| 4889 | `scheduleDomChange` | fn |  |
| 4920 | `acLimitBannerPresent` | fn |  |
| 4932 | `acLimitWatchTick` | fn |  |
| 4968 | `readFabBottom` | fn |  |
| 4975 | `clampFabBottom` | fn |  |
| 4980 | `clampFabRight` | fn |  |
| 4985 | `applyFabPosition` | fn |  |
| 4998 | `scheduleFabPos` | fn |  |
| 5006 | `positionFab` | fn |  |
| 5024 | `fixWidgetIframeBg` | fn |  |
| 5057 | `syncModernQueueSnapshot` | fn |  |
| 5163 | `dropModernOptimisticItem` | fn |  |
| 5177 | `getModernQueueSnapshot` | fn |  |
| 5192 | `findWbsAdapter` | fn |  |
| 5235 | `get` | method |  |
| 5246 | `bootstrapModernQueueBridge` | fn |  |
| 5259 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 5263 | `probe` | fn |  |
| 5286 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 5298 | `handleModernQueueActionClick` | fn |  |
| 5329 | `stashSigs` | fn |  |
| 5335 | `stashIds` | fn |  |
| 5341 | `recordStashQueueItem` | fn |  |
| 5370 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 5383 | `syncQueueDomIds` | fn |  |
| 5410 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 5441 | `watchQueueOrder` | fn |  |
| 5457 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 5468 | `guardStashedPause` | fn |  |
| 5617 | `enforceStashOrder` | fn |  |
| 5659 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 5664 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 5695 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 5782 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 5800 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 5815 | `enqueueToWorkBuddyQueue` | fn |  |
| 5879 | `crumb` | fn |  |
| 5967 | `maxW` | fn |  |
| 5968 | `maxH` | fn |  |
| 5969 | `apply` | fn |  |
| 6002 | `endDrag` | fn |  |
| 6036 | `preloadAutomationDiscovery` | fn |  |
| 6042 | `findCreditSegment` | fn |  |
| 6051 | `ensureStatusPopover` | fn |  |
| 6062 | `hideStatusPopover` | fn |  |
| 6068 | `positionStatusPopover` | fn |  |
| 6093 | `showStatusPopover` | fn |  |
| 6104 | `creditPopoverHtml` | fn |  |
| 6111 | `hideCreditTooltip` | fn |  |
| 6117 | `showCreditTooltip` | fn |  |
| 6144 | `rotationReminderEnabled` | fn |  |
| 6175 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 6181 | `sync` | fn |  |
| 6220 | `syncOpsDot` | fn |  |
| 6226 | `setOpsFlag` | fn | 供 renderFailoverCard / renderContextAuditCard 回填（函数声明会提升，可以先用后定义） |
| 6233 | `placeOpsPopover` | fn | 不用 fixed —— .wbs-panel 的 backdrop-filter 会把它降格成「相对面板」的绝对定位。 |
| 6247 | `setOpsPopover` | fn |  |
| 6289 | `idleMinutesText` | fn |  |
| 6300 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 6303 | `label` | fn |  |
| 6308 | `data` | fn |  |
| 6314 | `sep` | fn |  |
| 6315 | `gap` | fn |  |
| 6325 | `renderIdleCard` | fn |  |
| 6371 | `refreshIdleCard` | fn |  |
| 6379 | `saveIdleCard` | fn |  |
| 6439 | `failoverClock` | fn |  |
| 6444 | `failoverAccountLabel` | fn |  |
| 6453 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 6466 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 6480 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 6496 | `renderFailoverCard` | fn |  |
| 6542 | `refreshFailoverCard` | fn |  |
| 6591 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 6649 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 6672 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 6675 | `done` | fn |  |
| 6680 | `fallback` | fn |  |
| 6703 | `renderContextAuditCard` | fn |  |
| 6749 | `loadContextAuditCard` | fn |  |
| 6813 | `openAccountOrderModal` | fn |  |
| 6840 | `close` | fn |  |
| 6845 | `drawRows` | fn |  |
| 6854 | `move` | fn |  |
| 6860 | `syncMode` | fn |  |
| 6939 | `setupCreditSummary` | fn |  |
| 6948 | `hide` | fn |  |
| 6949 | `deferHide` | fn |  |
| 6950 | `show` | fn |  |
| 6984 | `openOfficialGrowthCenter` | fn |  |
| 6990 | `confirmCurrentGrowthAccount` | fn |  |
| 7001 | `setupAccountNotePopover` | fn |  |
| 7018 | `trigger` | fn |  |
| 7019 | `dirty` | fn |  |
| 7020 | `update` | fn |  |
| 7027 | `hide` | fn |  |
| 7042 | `position` | fn |  |
| 7054 | `show` | fn |  |
| 7075 | `deferHide` | fn |  |
| 7083 | `submit` | fn |  |
| 7155 | `setupDailyProgressPopover` | fn |  |
| 7162 | `findRing` | fn |  |
| 7170 | `hide` | fn |  |
| 7180 | `deferHide` | fn |  |
| 7190 | `show` | fn |  |
| 7208 | `updateDailyTravelCountdowns` | fn |  |
| 7317 | `setupModelRateLimitPopover` | fn |  |
| 7324 | `findBadge` | fn |  |
| 7332 | `hide` | fn |  |
| 7342 | `deferHide` | fn |  |
| 7352 | `show` | fn |  |
| 7364 | `showSummary` | fn |  |
| 7435 | `closeSecureTransferModal` | fn |  |
| 7439 | `openSecureTransferModal` | fn |  |
| 7478 | `selectedIds` | fn |  |
| 7479 | `syncSelection` | fn |  |
| 7599 | `downloadTransfer` | fn |  |
| 7616 | `readTransferFile` | fn |  |
| 7625 | `copyPlainText` | fn |  |
| 7645 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 7661 | `onConfirm` | method |  |
| 7674 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 7698 | `openAccountImportChoice` | fn |  |
| 7718 | `sync` | fn |  |
| 7740 | `formatTokenCount` | fn |  |
| 7749 | `usageTrendChartHtml` | fn |  |
| 7757 | `usageTrendColors` | fn |  |
| 7764 | `resolveUsageColor` | fn |  |
| 7777 | `usagePieData` | fn |  |
| 7792 | `usagePieHtml` | fn |  |
| 7797 | `percent` | fn |  |
| 7798 | `description` | fn |  |
| 7799 | `legendRow` | fn |  |
| 7826 | `wireUsagePies` | fn |  |
| 7830 | `clear` | fn |  |
| 7835 | `preview` | fn |  |
| 7864 | `usageTrendGroups` | fn |  |
| 7886 | `renderUsageBreakdown` | fn |  |
| 7936 | `renderUsageTrendChart` | fn |  |
| 8008 | `hideTooltip` | fn |  |
| 8009 | `showTooltip` | fn |  |
| 8050 | `usageTimeSegmentHtml` | fn |  |
| 8058 | `onTokenStats` | fn |  |
| 8080 | `closeStats` | fn |  |
| 8109 | `usageDays` | fn |  |
| 8126 | `renderCredits` | fn |  |
| 8160 | `setCreditBusy` | fn |  |
| 8167 | `creditQueryFailed` | fn |  |
| 8174 | `showCreditJob` | fn |  |
| 8194 | `pollCreditJob` | fn |  |
| 8207 | `loadCredits` | fn |  |
| 8257 | `load` | fn | 就失去了入口 ⇒ 死代码里的副本永远看不到，只会与真实现漂移，故摘掉。 |
| 8324 | `perfTableHtml` | fn |  |
| 8361 | `onThinkingPerf` | fn |  |
| 8383 | `closePerf` | fn |  |
| 8397 | `load` | fn | 首屏慢（要扫 traces，首次 3–8 秒）⇒ 先渲染骨架再异步填表，绝不阻塞面板。 |
| 8431 | `wbsIsDarkTheme` | fn | 三维筛选（日期 × 账号 × 模型）与全部图表都在 HTML 内完成（数据内嵌 ⇒ 切筛选零延迟、断网可用）。 |
| 8443 | `onUsageBoard` | fn |  |
| 8476 | `boardUrl` | fn |  |
| 8480 | `closeBoard` | fn |  |
| 8494 | `showOverlay` | fn |  |
| 8495 | `hideOverlay` | fn |  |
| 8496 | `syncSrcBtn` | fn |  |
| 8497 | `loadBoard` | fn |  |
| 8510 | `fmtBoardTime` | fn |  |
| 8513 | `p2` | fn |  |
| 8516 | `generateBoard` | fn |  |
| 8551 | `switchTab` | fn | ===== Tab 切换 ===== |
| 8589 | `buildAutomationPane` | fn |  |
| 8593 | `defaultTask` | fn |  |
| 8596 | `triggerBadgesHtml` | fn |  |
| 8616 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 8624 | `autoProtocolLabel` | fn |  |
| 8628 | `taskStatusLabel` | fn |  |
| 8640 | `lastRunLabel` | fn |  |
| 8646 | `runFor` | fn |  |
| 8647 | `selectedIds` | fn |  |
| 8648 | `allSelected` | fn |  |
| 8649 | `syncBatchControls` | fn |  |
| 8657 | `render` | fn |  |
| 8702 | `load` | fn |  |
| 8705 | `renderExamples` | fn |  |
| 8719 | `loadAgentInfo` | fn |  |
| 8725 | `fuzzyTaskName` | fn |  |
| 8736 | `discoverySourceLabel` | fn |  |
| 8739 | `renderAutomationDiscovery` | fn |  |
| 8784 | `showAutomationDiscoveryGuide` | fn |  |
| 8794 | `showAutomationDiscovery` | fn |  |
| 8832 | `loadAutomationDiscovery` | fn |  |
| 8846 | `exampleById` | fn |  |
| 8849 | `generateAgentTask` | fn |  |
| 8867 | `finishSafetyReview` | fn |  |
| 8876 | `pollSafetyReview` | fn |  |
| 8891 | `startSafetyReview` | fn |  |
| 8902 | `closePanelModal` | fn |  |
| 8908 | `showAutomationConfirm` | fn |  |
| 8916 | `close` | fn |  |
| 8925 | `showAutomationLogs` | fn |  |
| 8952 | `close` | fn |  |
| 8968 | `showEditor` | fn |  |
| 8994 | `syncScheduleFields` | fn |  |
| 9010 | `hideEditor` | fn |  |
| 9011 | `saveEditor` | fn |  |
| 9055 | `isScheduledSendTaskUI` | fn |  |
| 9058 | `schedPad2` | fn |  |
| 9059 | `schedLocalSlot` | fn |  |
| 9062 | `schedDefaultOnceAt` | fn |  |
| 9068 | `schedWhenLabel` | fn |  |
| 9079 | `schedConversationLabel` | fn |  |
| 9090 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 9100 | `hideScheduledSend` | fn |  |
| 9102 | `showScheduledSend` | fn |  |
| 9160 | `whenValue` | fn |  |
| 9168 | `currentRequest` | fn |  |
| 9183 | `syncSummary` | fn |  |
| 9189 | `syncWhen` | fn |  |
| 9196 | `setTarget` | fn |  |
| 9209 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 9224 | `renderConversations` | fn |  |
| 9238 | `loadConversations` | fn |  |
| 9259 | `saveScheduledSend` | fn |  |
| 9335 | `mountAutomationModal` | fn |  |
| 9357 | `showCapabilities` | fn |  |
| 9367 | `showExamples` | fn |  |
| 9376 | `syncDraft` | fn |  |
| 9388 | `exportAutomationTasks` | fn |  |
| 9397 | `importIssueLabel` | fn |  |
| 9407 | `showTaskImport` | fn |  |
| 9423 | `selected` | fn |  |
| 9424 | `syncSelection` | fn |  |
| 9441 | `readAutomationImport` | fn |  |
| 9456 | `startPicker` | fn |  |
| 9468 | `wbsOfficialEsc` | fn |  |
| 9474 | `wbsOfficialCardHTML` | fn |  |
| 9489 | `wbsOfficialEmpty` | fn |  |
| 9493 | `wbsLoadOfficial` | fn |  |
| 9536 | `wbsAgentCardHTML` | fn |  |
| 9548 | `wbsLoadAgent` | fn |  |
| 9700 | `isTaskSessionRecordUI` | fn |  |
| 9705 | `canonicalWorkspaceUI` | fn |  |
| 9722 | `sessionCopyAccountLabel` | fn |  |
| 9728 | `renderSessionCopyProgress` | fn |  |
| 9759 | `scheduleSessionCopyProgressPoll` | fn |  |
| 9763 | `pollActiveSessionCopyJob` | fn |  |
| 9782 | `fmtCostInt` | fn |  |
| 9784 | `renderSessionCostCard` | fn |  |
| 9834 | `copyCurrentConversation` | fn | 取会话控制器复用本地既有 acFindConversationController（与成本卡同一个「当前会话」口径）。 |
| 9860 | `refreshSessionCost` | fn |  |
| 9890 | `startSessionCostPolling` | fn |  |
| 9899 | `stopSessionCostPolling` | fn |  |
| 9906 | `buildSessionsPane` | fn |  |
| 10017 | `renderSessionExport` | fn |  |
| 10036 | `pollSessionExport` | fn |  |
| 10058 | `cloudEls` | fn |  |
| 10070 | `cloudAccountName` | fn |  |
| 10078 | `renderCloudCard` | fn |  |
| 10129 | `checkCloudGhosts` | fn |  |
| 10151 | `runCloudPurge` | fn |  |
| 10180 | `wireCloudCard` | fn |  |
| 10204 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 10235 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 10243 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 10249 | `loadSessions` | fn |  |
| 10285 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 10295 | `canEditAutoCopy` | fn |  |
| 10296 | `autoCopyButton` | fn |  |
| 10378 | `activeAutoCopyCount` | fn |  |
| 10384 | `updateSessionSummary` | fn |  |
| 10394 | `updateAutoCopyAllButton` | fn |  |
| 10402 | `toggleAutoCopyAll` | fn |  |
| 10425 | `shortWs` | fn |  |
| 10430 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 10477 | `toggleAutoCopyRule` | fn |  |
| 10508 | `updateAutoCopyButtons` | fn |  |
| 10536 | `updateSessCount` | fn |  |
| 10555 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 10564 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 10584 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 10599 | `wireSessionsPane` | fn |  |
| 10834 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 10888 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 10987 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 11029 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 11076 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 11094 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11118 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 11217 | `selectedSessIds` | fn |  |
| 11220 | `showSessModal` | fn |  |
| 11236 | `buildModelsPane` | fn |  |
| 11267 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 11274 | `modelDetailsHtml` | fn |  |
| 11283 | `modelRowHtml` | fn |  |
| 11321 | `kindLabelOf` | fn |  |
| 11328 | `agentBlockHtml` | fn | 每行底部的「子 Agent」区块。⚠️ 只在「当前模型」tab 显示（备选模型没生效 ⇒ 统计无意义）。 |
| 11373 | `renderAgentSummary` | fn | 顶部汇总条（**只在「当前模型」tab 显示**）。 |
| 11404 | `loadAgentStats` | fn | 拉使用统计（**独立降级**：失败只影响统计区，不影响模型列表）。 |
| 11417 | `saveAgentEntry` | fn | 保存单个模型的子 Agent 声明（改动即存；失败回滚控件）。 |
| 11433 | `loadModels` | fn |  |
| 11457 | `updateModelCounts` | fn |  |
| 11467 | `renderModels` | fn |  |
| 11514 | `updateModelBatchState` | fn |  |
| 11529 | `showModelConfirm` | fn |  |
| 11543 | `closeThirdPartyMenu` | fn |  |
| 11549 | `openThirdPartyModels` | fn |  |
| 11674 | `wireModelsPane` | fn |  |
| 11836 | `findModelBackup` | fn |  |
| 11843 | `openModelEdit` | fn |  |
| 11877 | `buildThemePane` | fn | ===== 主题 pane（构建：头像 + 悬浮机器人 + 主题选择 + WorkDaddy 壁纸）===== |
| 11942 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 12070 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 12089 | `wirePcPane` | fn |  |
| 12122 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 12227 | `syncLangSeg` | fn |  |
| 12254 | `wireTelemetrySettings` | fn |  |
| 12258 | `renderTelemetryState` | fn |  |
| 12296 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 12412 | `updateLogTimestamp` | fn |  |
| 12417 | `appendUpdateLog` | fn |  |
| 12430 | `formatDownloadRate` | fn |  |
| 12436 | `formatDownloadEta` | fn |  |
| 12444 | `formatDownloadTransfer` | fn |  |
| 12457 | `formatUpdateFailure` | fn |  |
| 12471 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 12490 | `openWindowsInstaller` | fn |  |
| 12512 | `showWindowsInstallerReady` | fn |  |
| 12526 | `openWindowsInstallerAfterDownload` | fn |  |
| 12560 | `pollUpdateProgress` | fn |  |
| 12569 | `renderRebootUi` | fn |  |
| 12675 | `syncWallpaperCardVisibility` | fn |  |
| 12688 | `syncThemeTakeoverVisibility` | fn | 关闭接管后只隐藏主题外观选项；头像和悬浮机器人独立于主题接管。 |
| 12698 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 12887 | `gwCardEl` | fn | 面板只负责展示与触发 —— 判据与实现全在 scripts/api-gateway.js。 |
| 12888 | `gwBtn` | fn |  |
| 12893 | `gwRender` | fn |  |
| 12909 | `gwRefresh` | fn |  |
| 12914 | `gwAction` | fn |  |
| 12928 | `buildGatewayCard` | fn |  |
| 12984 | `wireEnhancePane` | fn |  |
| 13017 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 13025 | `loadWallpapers` | fn |  |
| 13133 | `setOpen` | fn |  |
| 13169 | `setupFabDrag` | fn |  |
| 13203 | `finishFabDrag` | fn |  |
| 13233 | `isDragging` | method |  |
| 13266 | `closeLoginModal` | fn |  |
| 13275 | `openLoginChoice` | fn |  |
| 13379 | `startSeamlessLogin` | fn |  |
| 13474 | `loadThemes` | fn |  |
| 13481 | `applyTheme` | fn |  |
| 13489 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 13507 | `openWebsite` | method |  |
| 13512 | `unlockDebug` | method |  |
| 13535 | `getItem` | method |  |
| 13536 | `setItem` | method |  |
| 13537 | `removeItem` | method |  |
| 13549 | `rememberAvatarWrapper` | fn |  |
| 13555 | `rememberAvatarImage` | fn |  |
| 13561 | `restoreAvatarDom` | fn |  |
| 13575 | `svgToPng` | fn | SVG → PNG dataURL |
| 13596 | `applyAvatar` | fn |  |
| 13665 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 13706 | `hexOf` | fn |  |
| 13709 | `mixArr` | fn |  |
| 13710 | `extractPalette` | fn |  |
| 13744 | `imageToTheme` | fn |  |
| 13833 | `syncAskSwitch` | fn |  |
| 13885 | `ndEl` | fn |  |
| 13888 | `ndRefreshCount` | fn |  |
| 13898 | `ndSwitchEl` | fn |  |
| 13903 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 13943 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 13977 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 13993 | `ndTitle` | fn |  |
| 14000 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 14019 | `cleanup` | fn |  |
| 14023 | `onClick` | fn |  |
| 14036 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 14043 | `applyNoDisturbState` | fn |  |
| 14135 | `acLogLine` | fn |  |
| 14140 | `acLog` | fn |  |
| 14150 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 14159 | `acSessionTitle` | fn |  |
| 14167 | `acMonitorLog` | fn |  |
| 14174 | `acScheduleMonitorLogRender` | fn |  |
| 14184 | `acResetState` | fn |  |
| 14216 | `acShowStatus` | fn |  |
| 14222 | `acHideStatus` | fn |  |
| 14227 | `acStartStatusAnim` | fn |  |
| 14228 | `acStopStatusAnim` | fn |  |
| 14231 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 14244 | `acNotifyLimit` | fn |  |
| 14265 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 14282 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 14292 | `acHasCompletionActions` | fn |  |
| 14311 | `acSwitchConversationId` | fn | 读不到就返回空串 —— 不能为了「带上一个 id」把切换本身拖挂。 |
| 14319 | `acHasErrorSignal` | fn |  |
| 14333 | `acLooksTruncated` | fn |  |
| 14341 | `acReplyDecision` | fn |  |
| 14353 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 14369 | `acIsBusy` | fn |  |
| 14374 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 14382 | `acComposerText` | fn |  |
| 14395 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 14411 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 14432 | `acPressEnter` | fn |  |
| 14441 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 14451 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 14468 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 14490 | `acControllerComposerEmpty` | fn |  |
| 14498 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 14545 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 14582 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 14620 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 14668 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 14674 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 14723 | `acCaptureControllerError` | fn |  |
| 14737 | `acRecordModelRateLimit` | fn |  |
| 14764 | `acControllerSnapshot` | fn |  |
| 14822 | `acControllerCheck` | fn |  |
| 14896 | `acBindController` | fn |  |
| 14929 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 15024 | `acScheduleSettle` | fn |  |
| 15037 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 15060 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 15068 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 15081 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 15180 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 15236 | `acStopLegacyMonitor` | fn |  |
| 15257 | `acMultiUpdateStatus` | fn |  |
| 15271 | `acMultiCreateSession` | fn |  |
| 15303 | `acMultiStatusFromResource` | fn |  |
| 15308 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 15336 | `acMultiReconcileSidebar` | fn |  |
| 15369 | `sessionDirtyResourceRecords` | fn |  |
| 15380 | `bindSessionDirtyMonitor` | fn |  |
| 15412 | `acMultiBindSessionResource` | fn |  |
| 15425 | `acMultiUnbindSessionResource` | fn |  |
| 15434 | `acMultiSchedule` | fn |  |
| 15443 | `acMultiSend` | fn |  |
| 15486 | `acMultiCheckSession` | fn |  |
| 15585 | `acMultiBindController` | fn |  |
| 15636 | `acMultiFinishSession` | fn |  |
| 15645 | `acMultiDetachController` | fn |  |
| 15654 | `acMultiProbeSidebarApproval` | fn |  |
| 15711 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 15734 | `acCdpClick` | fn |  |
| 15742 | `acAutoApproveClickItem` | fn |  |
| 15761 | `acAutoApproveItemByTitle` | fn |  |
| 15773 | `acAutoApprovePendingOnce` | fn |  |
| 15911 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 15956 | `acAutoApproveFastStart` | fn |  |
| 15966 | `acAutoApproveFastStop` | fn |  |
| 15970 | `acMultiDiscover` | fn |  |
| 16006 | `acStartMultiMonitor` | fn |  |
| 16025 | `acStopMultiMonitor` | fn |  |
| 16043 | `acStartMonitor` | fn |  |
| 16048 | `acStopMonitor` | fn |  |
| 16054 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 16065 | `acMonitorStatusLabel` | fn |  |
| 16074 | `acMonitorSafeDetail` | fn |  |
| 16086 | `acRenderMonitorLogModal` | fn |  |
| 16138 | `wireAutoContinuePane` | fn |  |
| 16168 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 16314 | `syncAutoContinue` | fn |  |
| 16319 | `applyAutoContinueState` | fn |  |
| 16332 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 16342 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 16348 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 16382 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 16400 | `stopNoDisturbAutoApprove` | fn |  |
| 16405 | `scheduleNdScan` | fn |  |
| 16409 | `ndQueueScanRoot` | fn |  |
| 16429 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 16451 | `ndNormalizeLabel` | fn |  |
| 16455 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 16463 | `ndClassifyApprovalCandidate` | fn |  |
| 16474 | `ndSessionIdForNode` | fn |  |
| 16480 | `ndApprovalContext` | fn |  |
| 16516 | `scanNoDisturbApproval` | fn |  |
| 16546 | `toNdAudit` | fn |  |
| 16554 | `getSleepMode` | fn |  |
| 16559 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 16577 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 16609 | `discoverSleepSessionBusy` | fn |  |
| 16640 | `isAnySessionBusy` | fn |  |
| 16654 | `startUntilDoneCheck` | fn |  |
| 16674 | `stopUntilDoneCheck` | fn |  |
| 16680 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 16720 | `fmtDateTime` | fn | 渲染账号列表 |
| 16727 | `fmtDateTimeSeconds` | fn |  |
| 16734 | `fmtCredits` | fn |  |
| 16741 | `fmtCreditExpiry` | fn |  |
| 16754 | `creditTip` | fn |  |
| 16766 | `creditBarHtml` | fn |  |
| 16783 | `todayUsageHtml` | fn |  |
| 16791 | `accountStatusTagsHtml` | fn |  |
| 16796 | `checkinBadgeHtml` | fn |  |
| 16805 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 16821 | `modelRateLimitTip` | fn |  |
| 16830 | `modelRateLimitBadgeHtml` | fn |  |
| 16842 | `modelRateLimitPopoverHtml` | fn |  |
| 16859 | `modelRateLimitSummaryPopoverHtml` | fn |  |
| 16881 | `creditBlockHtml` | fn |  |
| 16902 | `nearestCreditExpiry` | fn |  |
| 16914 | `sortAccountsByCreditExpiry` | fn |  |
| 16934 | `reorderAccountCards` | fn |  |
| 16947 | `mergeAccountSnapshot` | fn |  |
| 16967 | `clampDailyRatio` | fn |  |
| 16974 | `dailyProgressLabel` | fn |  |
| 16992 | `dailyRingsSvg` | fn |  |
| 17001 | `dailyRingsHtml` | fn |  |
| 17010 | `formatDailyTravelCountdown` | fn |  |
| 17021 | `dailyTravelCountdownText` | fn |  |
| 17027 | `dailyCatDetail` | fn |  |
| 17046 | `formatGrowthTaskDeadline` | fn |  |
| 17054 | `sortGrowthTasks` | fn |  |
| 17072 | `growthTaskActions` | fn |  |
| 17077 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 17089 | `growthAutoOf` | fn |  |
| 17093 | `growthAutoActionFor` | fn |  |
| 17102 | `startGrowthAuto` | fn |  |
| 17130 | `pollGrowthAuto` | fn |  |
| 17170 | `stopGrowthAutoPoll` | fn |  |
| 17178 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 17192 | `growthTaskRewardHtml` | fn |  |
| 17204 | `dailyProgressPopoverHtml` | fn |  |
| 17348 | `updateDailyProgressCells` | fn |  |
| 17371 | `refreshDailyProgressAccount` | fn |  |
| 17399 | `fetchDailyProgressForAccounts` | fn |  |
| 17426 | `accountCardLayoutKey` | fn |  |
| 17446 | `fmtBytes` | fn |  |
| 17456 | `fmtDuration` | fn |  |
| 17465 | `autoCopyTotalFailed` | fn |  |
| 17476 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 17482 | `autoCopyConflictTitle` | fn |  |
| 17488 | `autoCopyConflictDetail` | fn |  |
| 17498 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 17520 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 17526 | `autoCopyProgressEls` | fn |  |
| 17539 | `hideAutoCopyProgress` | fn |  |
| 17546 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 17651 | `scheduleAutoCopyHide` | fn |  |
| 17673 | `spaceNum` | fn |  |
| 17678 | `spaceShare` | fn |  |
| 17684 | `spaceTimeText` | fn |  |
| 17688 | `pad` | fn |  |
| 17692 | `spaceBaseName` | fn |  |
| 17697 | `spaceScanEls` | fn |  |
| 17714 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 17736 | `hideSpaceScanBox` | fn |  |
| 17742 | `stopSpacePolling` | fn |  |
| 17747 | `spaceJobSub` | fn |  |
| 17754 | `renderSpaceJob` | fn |  |
| 17771 | `spaceRowHtml` | fn |  |
| 17782 | `spaceRestRow` | fn |  |
| 17790 | `renderSpaceEmpty` | fn |  |
| 17807 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 17815 | `spaceSubText` | fn |  |
| 17834 | `spaceSortOf` | fn |  |
| 17842 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 17850 | `spaceSortName` | fn |  |
| 17857 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 17878 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 17896 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 17903 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 17914 | `renderSpaceResult` | fn |  |
| 18031 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 18049 | `scheduleSpacePoll` | fn |  |
| 18057 | `pollSpaceScan` | fn |  |
| 18080 | `startSpaceScan` | fn |  |
| 18101 | `cancelSpaceScan` | fn |  |
| 18113 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 18135 | `buildSpacesPane` | fn |  |
| 18168 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 18234 | `pollAutoCopyJob` | fn |  |
| 18241 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 18251 | `render` | fn |  |
| 18413 | `maskAccountName` | fn |  |
| 18421 | `maskAccountId` | fn |  |
| 18432 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 18458 | `toggleAccountMask` | fn |  |
| 18464 | `refresh` | fn |  |
| 18496 | `updateAccountSummary` | fn |  |
| 18521 | `rotationToday` | fn |  |
| 18526 | `closeRotationNotice` | fn |  |
| 18536 | `showRotationNotice` | fn |  |
| 18562 | `place` | fn |  |
| 18617 | `formatRotationEta` | fn |  |
| 18626 | `formatRotationDuration` | fn |  |
| 18637 | `checkCreditRotationAfterSession` | fn |  |
| 18639 | `run` | fn |  |
| 18661 | `updateCheckinCells` | fn |  |
| 18733 | `fetchActivityForAccounts` | fn |  |
| 18742 | `worker` | fn |  |
| 18781 | `requestCredit` | fn |  |
| 18807 | `updateCreditSummaryFromAccounts` | fn |  |
| 18816 | `refreshCreditForAccount` | fn |  |
| 18848 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 18853 | `settleBatch` | fn |  |
| 18863 | `queryAccount` | fn |  |
| 18914 | `updateCreditCell` | fn |  |
| 18958 | `updateDebugPanel` | fn |  |
| 18978 | `onDebugKey` | fn |  |
| 18987 | `markHealthGeneration` | fn |  |
| 18996 | `isHealthStopControl` | fn |  |
| 19001 | `isHealthSendControl` | fn |  |
| 19092 | `readTokenRateEnabled` | fn | 常开会让用户把估算当精确值；需要时在 面板 → 会话 → token 速度读数 手动打开，一旦手动开过就记住。 |
| 19096 | `writeTokenRateEnabled` | fn |  |
| 19101 | `applyTokenRateEnabled` | fn | 开关变化时立即生效：关 ⇒ 立刻隐藏并停算；开 ⇒ 恢复上一次读数、并重算。 |
| 19117 | `readTokenRatePos` | fn | 读用户拖动后保存的视口坐标；无有效值返回 null。 |
| 19128 | `saveTokenRatePos` | fn |  |
| 19136 | `tokenRateDefaultPos` | fn | 默认位 = 输入框下方空置带左侧、垂直居中。量不到返回 null（下次再试）。 |
| 19148 | `clampTokenRatePos` | fn | 夹进视口（留 4px 边距）。仅在交互 / 定位路径调用。 |
| 19157 | `applyTokenRatePos` | fn |  |
| 19163 | `reuseOrBuildTokenRateEl` | fn | 复用页面上已有的读数节点，否则新建；两者都补挂拖动。 |
| 19192 | `showTokenRateDragShield` | fn |  |
| 19204 | `hideTokenRateDragShield` | fn |  |
| 19214 | `setupTokenRateDrag` | fn | 小框就再也收不到 pointermove。而拖动本来就必须跟手到框外，所以直接吃 window 事件最稳。 |
| 19234 | `onWinMove` | fn |  |
| 19246 | `finishTokenRateDrag` | fn |  |
| 19300 | `readRateEstTokens` | fn | 仍是估算（真实用量只能从 usage 记录拿），但比一刀切贴近。只用 querySelectorAll + textContent，不触发 reflow。 |
| 19325 | `ensureTokenRateEl` | fn | 取（必要时新建）读数节点。常驻 body 直下 + position:fixed；无用户位置时贴输入框下方默认位。 |
| 19336 | `setTokenRateBadge` | fn |  |
| 19362 | `updateTokenRateBadge` | fn |  |
| 19524 | `mdqvT` | fn | 去重不用数组：直接在 tab 元素上打 __wbsAdoptSkip（随元素移除自动回收） |
| 19526 | `mdqvReadEnabled` | fn |  |
| 19529 | `mdqvWriteEnabled` | fn |  |
| 19532 | `mdqvReadAdopt` | fn |  |
| 19535 | `mdqvWriteAdopt` | fn |  |
| 19540 | `mdqvFindPathByName` | fn | 用产物文件名在页面里反查绝对路径（正文产物卡 / 产物面板条目都带 data-dir）。 |
| 19561 | `mdqvAdoptTick` | fn | 成本：一次 querySelector 实测 0.02 ms 级，600 ms 一次 ⇒ 可忽略。 |
| 19581 | `mdqvAdoptStart` | fn |  |
| 19595 | `mdqvFileUrl` | fn | 不编码会因空格/中文导致 fetch 失败；整体 encodeURI 又会把已有的 % 二次编码。 |
| 19607 | `mdqvNormPath` | fn | 「未编码绝对路径」，否则会拼出 file:///file:///… 或中文二次编码。 |
| 19619 | `mdqvShortPath` | fn | 完整路径仍放在 title 里可悬停查看。 |
| 19630 | `mdqvRootRect` | fn | 面板要贴住的区域：整个应用的可见区（#root），拿不到就退回 window。 |
| 19638 | `mdqvDefaultWidth` | fn | 默认宽度：对齐官方文档视图的观感（约内容区 1/3），并夹到可用范围。 |
| 19646 | `mdqvReadWidth` | fn |  |
| 19653 | `mdqvWriteWidth` | fn |  |
| 19666 | `mdqvPlace` | fn |  |
| 19677 | `mdqvDetachShellGuard` | fn |  |
| 19683 | `mdqvReapply` | fn | 重算并写回让位量。观察者与窗口 resize 都走这里。 |
| 19706 | `mdqvAttachShellGuard` | fn | 1936 ⇄ 2296 之间跳（连带把对话区右边缘推过我的面板左边缘）。两个节点都守。 |
| 19722 | `mdqvApplyShift` | fn | 对话区会滑到面板底下。用父容器当前宽度反推，两种状态都自洽。 |
| 19751 | `mdqvRestoreShift` | fn |  |
| 19783 | `wbsHlClass` | fn |  |
| 19792 | `wbsHighlight` | fn | 高亮入口：返回**已转义**的 HTML 片段。 |
| 19825 | `wbsSafeImg` | fn | 其余属性一律丢弃 —— 防止 md 里塞 onerror 之类的注入面。 |
| 19836 | `mdqvInline` | fn | &amp; 当 URL 二次转义」这类双重转义（URL 进属性位一律走 escAttr）。 |
| 19877 | `mdqvRender` | fn | 分隔线 / 行内语法。**刻意不做**数学与 mermaid —— 遇到就给一行提示，不静默丢内容。 |
| 19881 | `flushPara` | fn |  |
| 19886 | `flushQuote` | fn |  |
| 19891 | `flushList` | fn |  |
| 19896 | `flushAll` | fn |  |
| 19897 | `warn` | fn |  |
| 19898 | `closeFence` | fn |  |
| 19912 | `cellsOf` | fn |  |
| 19918 | `alignsOf` | fn |  |
| 20016 | `mdqvCopyText` | fn | 复制文本（面板内代码块的「复制」用；不依赖 mdqvOpen 内的 flash）。 |
| 20044 | `mdqvBindCodeCopy` | fn | 给代码块顶栏的「复制」按钮接线（面板内走真实监听器；导出的离线页走内联脚本）。 |
| 20059 | `mdqvClose` | fn |  |
| 20074 | `mdqvOpen` | fn |  |
| 20282 | `mdqvStandalone` | fn | 跟随系统深色偏好。样式刻意不复用注入页那份（那份依赖 --wb-* 变量，外部没有）。 |
| 20341 | `mdqvInstall` | fn |  |
| 20376 | `registerBuild` | fn |  |
| 20385 | `start` | fn |  |
| 20398 | `destroyWidget` | fn |  |
| 21806 | `refresh` | method |  |
| 21808 | `getLanguage` | method |  |
| 21809 | `setLanguage` | method |  |

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

## scripts/lib.js  （2270 行 / 119 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 63 | `isWbEncryptedEnvelope` | fn |  |
| 67 | `wdCompatContainsEncryptedFields` | fn |  |
| 75 | `wdCompatText` | fn | 信封字段的展示兜底：取钥不可用时显示占位而非整段密文/[object Object]。 |
| 81 | `wdCompatAuthToken` | fn | 只返回可直接用于 HTTP 的明文 token；信封不可用时返回空字符串。 |
| 87 | `wdCompatHasAuthCredential` | fn |  |
| 93 | `wdCompatLog` | fn |  |
| 100 | `wdCompatConfiguredExe` | fn | 校验的主程序路径；只在 Node/daemon 侧读取，注入到 renderer 的 compat 脚本不会触发。 |
| 115 | `wdCompatExeCandidates` | fn |  |
| 139 | `wdCompatStaticKey` | fn |  |
| 166 | `wdCompatOpenEnvelope` | fn |  |
| 168 | `lp` | const |  |
| 169 | `u32` | const |  |
| 181 | `wdCompatDecryptAuthJson` | fn | 原地解密 JSON 中的全部 $wbEncrypted 信封字段；失败字段保留原值，不抛错。 |
| 183 | `walk` | const |  |
| 205 | `samePath` | fn | ===================== [wd-compat] 适配层结束 ===================== |
| 209 | `isLegacyDataDir` | fn |  |
| 228 | `authDir` | fn |  |
| 232 | `safeAuthFileName` | fn |  |
| 238 | `normalizeAuthDomain` | fn |  |
| 249 | `tokenIssuerOrigin` | fn |  |
| 261 | `allowedAuthOrigins` | fn |  |
| 277 | `authRecordFromJson` | fn |  |
| 311 | `parseAuthFile` | fn |  |
| 322 | `parseAuthJson` | fn |  |
| 331 | `normalizeAccountImportJson` | fn |  |
| 354 | `listAuthRecords` | fn |  |
| 369 | `resolveCurrentAuth` | fn |  |
| 383 | `currentAuthFile` | fn |  |
| 387 | `resolveLogoutAuth` | fn |  |
| 400 | `defaultDataDir` | fn |  |
| 407 | `accountsDir` | fn |  |
| 410 | `metaFile` | fn |  |
| 414 | `workbuddyModelsFile` | fn |  |
| 418 | `isManagedProfileDataDir` | fn |  |
| 424 | `migrateLegacyModelBackups` | fn |  |
| 451 | `modelBackupsDir` | fn |  |
| 459 | `maskApiKey` | fn |  |
| 470 | `sanitizeModel` | fn | 模型列表摘要。默认脱敏 apiKey；UI 需要明文展示（模型页 cell / 编辑弹窗）时传 { revealKey: true }。 |
| 485 | `checkinDisplayValue` | fn |  |
| 490 | `readModelsFile` | fn |  |
| 507 | `writeModelsFile` | fn |  |
| 520 | `modelBackupPath` | fn |  |
| 526 | `readModelBackup` | fn |  |
| 537 | `listModelBackups` | fn |  |
| 565 | `listOfficialModels` | fn |  |
| 570 | `readOfficialModel` | fn |  |
| 579 | `deleteOfficialModels` | fn |  |
| 591 | `backupOfficialModel` | fn |  |
| 605 | `writeModelBackup` | fn |  |
| 614 | `copyModelBackup` | fn |  |
| 625 | `editModelBackup` | fn |  |
| 644 | `deleteModelBackups` | fn |  |
| 667 | `enableModelBackup` | fn |  |
| 687 | `modelImportName` | fn |  |
| 691 | `importModels` | fn |  |
| 710 | `readMeta` | fn |  |
| 722 | `writeMeta` | fn |  |
| 732 | `canonicalWorkspace` | fn | 使用稳定路径键，不要求路径当前存在（空间可能已被移动或卸载）。 |
| 744 | `ensureAutoCopyMeta` | fn |  |
| 811 | `readAutoCopyConfig` | fn |  |
| 833 | `autoCopyRuleKey` | fn |  |
| 837 | `getAutoCopyRules` | fn |  |
| 865 | `dedupeAutoCopySessionRows` | fn | row (the SQL callers order newest activity first) for plans and UI counts. |
| 880 | `setAutoCopyAllSessions` | fn |  |
| 888 | `isAutoCopySessionSelected` | fn |  |
| 898 | `setAutoCopyRule` | fn |  |
| 941 | `addLineageMember` | fn |  |
| 948 | `getAutoCopySession` | fn |  |
| 958 | `getAutoCopySessionMembers` | fn | the copier repair stale mappings without creating another row. |
| 979 | `getAutoCopySessionMemberRecords` | fn | not only the account that happened to be active during the switch. |
| 1000 | `selectLatestAutoCopyMember` | fn | files.  Ties are resolved by member order so repeated switches stay stable. |
| 1015 | `ensureAutoCopySessions` | fn |  |
| 1039 | `ensureAutoCopySession` | fn |  |
| 1062 | `collectAutoCopyDuplicates` | fn |  |
| 1079 | `normalizeAutoCopyLineages` | fn |  |
| 1108 | `mergeAutoCopyLineages` | fn |  |
| 1163 | `addAutoCopySessionMember` | fn |  |
| 1185 | `removeAutoCopySessionMember` | fn | intentionally leaves the lineage and other account members intact. |
| 1220 | `pickArchivedCrossAccountTargets` | fn | 「同 lineage 且主账号那份确为 archived」的前置筛选在 daemon 侧 collectArchivedCopyState 完成。 |
| 1291 | `moveAutoCopySession` | fn |  |
| 1310 | `removeAutoCopySession` | fn |  |
| 1351 | `collectLineageMembersForDelete` | fn | 返回 [{ uid, id, lineageId }]；uid 可能为空（脏索引），id 必有值。 |
| 1366 | `addLink` | const |  |
| 1437 | `isAutoCopySuppressed` | fn |  |
| 1448 | `getSuppressedLineagesForTarget` | fn | 避免逐行读 meta。 |
| 1463 | `isAutoCopySuppressedForTarget` | fn | 便捷写法：自己读一次 meta。调用方已经有 config 时用 isAutoCopySuppressed(config, ...) 更省。 |
| 1470 | `setAutoCopySuppression` | fn |  |
| 1487 | `clearAutoCopySuppression` | fn |  |
| 1500 | `clearLineageSuppressions` | fn |  |
| 1536 | `resolveSessionDeletePlan` | fn |  |
| 1549 | `buildLocal` | const |  |
| 1565 | `buildCascade` | const |  |
| 1593 | `removeAutoCopyAccount` | fn |  |
| 1617 | `resolveMappingLineage` | fn |  |
| 1628 | `getAutoCopyMapping` | fn | while all persisted keys use lineageId + targetUid. |
| 1634 | `setAutoCopyMapping` | fn |  |
| 1646 | `deleteAutoCopyMapping` | fn |  |
| 1664 | `getAutoCopyLineageSyncedAt` | fn |  |
| 1683 | `setAutoCopyLineageSyncedAt` | fn |  |
| 1700 | `getAutoCopyJudge` | fn |  |
| 1704 | `setAutoCopyJudge` | fn |  |
| 1715 | `logFile` | fn |  |
| 1718 | `backupPath` | fn |  |
| 1723 | `retireLogoutMarker` | fn | WorkBuddy ignores auth files while this marker exists; retire it after a switch. |
| 1764 | `migrateLegacyDataDir` | fn |  |
| 1809 | `ensureDirs` | fn |  |
| 1820 | `readAuthFile` | fn | 读取登录信息文件并抽取账号关键字段（不返回令牌内容） |
| 1833 | `updateMeta` | fn | 残留 lastLogin 标记，也不得覆盖切换路径建立的绑定关系。 |
| 1858 | `backupAuthFile` | fn |  |
| 1878 | `backupCurrent` | fn | （真实事故：s 账号备份曾被 2026-08-21 存档覆盖成 8-19 的 token）。 |
| 1897 | `resolveAuthTarget` | fn |  |
| 1903 | `sameChannel` | const |  |
| 1938 | `getAccountOrder` | fn | 账号展示顺序保存在 profile 元数据中，不改写登录备份格式。0 表示未排序，排在末尾。 |
| 1942 | `setAccountOrder` | fn |  |
| 1962 | `setAccountNote` | fn | 备注仅写入当前 profile 的元数据，保留认证备份和其他账号设置。 |
| 1974 | `listAccounts` | fn | 列出所有已备份账号（直接读备份文件提取展示字段，按最近刷新时间倒序） |
| 2033 | `deleteAuthFilesForUid` | fn | 的根因：删除只清了 backups 目录，auth 目录里残留的存档会在下一次扫描时复活账号。 |
| 2065 | `deleteAccount` | fn | 永久删除某个账号的备份文件（不影响当前登录） |
| 2107 | `switchTo` | fn | 切换登录账号：把备份文件复制回登录信息文件（先校验 uid 匹配） |

## scripts/win-launcher.js  （1820 行 / 99 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 102 | `log` | fn |  |
| 109 | `sleep` | fn | ---------- 小工具 ---------- |
| 111 | `readApiToken` | fn |  |
| 118 | `localApiHeaders` | fn |  |
| 123 | `readUiPortFile` | fn |  |
| 127 | `writeUiPortFile` | fn |  |
| 136 | `useUiPort` | fn |  |
| 143 | `configureUiPort` | fn |  |
| 168 | `relaunchWithDesktopShell` | fn |  |
| 185 | `runHiddenPowerShell` | fn |  |
| 204 | `showWindowsMessageBox` | fn |  |
| 210 | `showWindowsNotification` | fn |  |
| 219 | `powershellQuote` | fn |  |
| 223 | `reportAndExit` | fn |  |
| 228 | `validCdpPort` | fn |  |
| 232 | `readCdpPortFile` | fn |  |
| 239 | `writeCdpPortFile` | fn |  |
| 248 | `cdpPortCandidates` | fn |  |
| 251 | `add` | const |  |
| 259 | `portOpen` | fn |  |
| 268 | `isLocalPortAvailable` | fn |  |
| 272 | `finish` | const |  |
| 287 | `reserveEphemeralCdpPort` | fn |  |
| 291 | `finish` | const |  |
| 304 | `httpGet` | fn |  |
| 316 | `httpPost` | fn |  |
| 330 | `isWorkBuddyCdp` | fn |  |
| 334 | `isWorkBuddyCdpAt` | fn |  |
| 353 | `configureCdpPort` | fn |  |
| 385 | `strictPowerShellLines` | fn |  |
| 395 | `bestEffortPowerShellLines` | fn |  |
| 404 | `powershellLiteral` | fn |  |
| 409 | `getWorkBuddyProcesses` | fn | 通过 CIM 查询当前 profile 主程序的路径、父 PID 和命令行；命令行正文绝不写入日志/Sentry。 |
| 428 | `daemonRunning` | fn | 仅保留为本地端口诊断；daemon 启动成功必须走 exactDaemonStatus 完整身份校验。 |
| 432 | `isPrewarmProcess` | fn |  |
| 436 | `workBuddyProcesses` | fn |  |
| 451 | `tasklistProcessIds` | fn | 只读诊断：tasklist 结果仅写入失败快照，绝不进入任何 taskkill 参数或退出判定。 |
| 467 | `processCdpPort` | fn |  |
| 473 | `processHasCdpArg` | fn |  |
| 477 | `processDiagnostics` | fn |  |
| 498 | `logProcessDiagnostics` | fn |  |
| 506 | `requireWorkBuddyClosedBeforeLaunch` | fn | 通过 quitWorkBuddy() 对当前 profile 的已验证进程做精确重启。 |
| 522 | `readDaemonVersion` | fn |  |
| 530 | `readDaemonIdentity` | fn |  |
| 543 | `findNode` | fn | ---------- 定位 node（安装包内置优先，WorkBuddy 托管运行时次之，最后 PATH） ---------- |
| 583 | `findWorkBuddy` | fn |  |
| 585 | `tryFile` | const |  |
| 610 | `addCandidate` | const |  |
| 667 | `psLiteral` | const |  |
| 689 | `listenerPids` | fn |  |
| 705 | `queryNodeProcesses` | fn |  |
| 732 | `uniqueNodeProcess` | fn |  |
| 742 | `readWatchdogPid` | fn |  |
| 754 | `watchdogState` | fn |  |
| 812 | `validateDaemonProcess` | fn |  |
| 824 | `exactDaemonStatus` | fn |  |
| 841 | `readStatus` | fn |  |
| 848 | `authenticatedElevatedDaemonStatus` | fn |  |
| 860 | `waitForExactDaemon` | fn |  |
| 874 | `killVerifiedNodeProcess` | fn |  |
| 894 | `authorizeDaemonTermination` | fn |  |
| 907 | `removeWatchdogPidIf` | fn |  |
| 914 | `stopDaemonByPort` | fn |  |
| 958 | `ensureDaemon` | fn |  |
| 1027 | `workBuddyRunning` | fn | ---------- 2/3. WorkBuddy CDP 处理 ---------- |
| 1031 | `runTaskkill` | fn |  |
| 1035 | `finish` | const |  |
| 1048 | `waitForWorkBuddyExit` | fn |  |
| 1057 | `exitSnapshot` | fn |  |
| 1065 | `killForExit` | fn |  |
| 1082 | `killVerifiedWorkBuddyProcess` | fn |  |
| 1100 | `quitWorkBuddy` | fn |  |
| 1139 | `launchWorkBuddy` | fn |  |
| 1164 | `waitForWorkBuddyCdp` | fn |  |
| 1171 | `start` | const |  |
| 1232 | `findNextAvailableCdpPort` | fn |  |
| 1241 | `injectNow` | fn |  |
| 1270 | `injectNowOrPending` | fn |  |
| 1281 | `hasElevatedSessionConsent` | fn |  |
| 1289 | `nativeHelperPath` | fn |  |
| 1293 | `runNativeHelper` | fn |  |
| 1309 | `nativeWorkBuddyProcessSummary` | fn |  |
| 1332 | `nativeWorkBuddyDiscoverySummary` | fn |  |
| 1336 | `nativeWorkBuddyRunning` | fn |  |
| 1343 | `stopNativeWorkBuddy` | fn |  |
| 1351 | `findWorkBuddyNative` | fn |  |
| 1363 | `add` | const |  |
| 1447 | `stopVerifiedLegacyManagedLifecycle` | fn |  |
| 1455 | `nativeDaemonDiagnostics` | fn |  |
| 1494 | `nativeCdpDiagnostics` | fn |  |
| 1519 | `nativeDaemonStatusMatches` | fn |  |
| 1532 | `waitForNativeDaemon` | fn |  |
| 1541 | `stopNativeLifecycle` | fn |  |
| 1551 | `ensureDaemonNative` | fn |  |
| 1568 | `startWatchdog` | const |  |
| 1600 | `waitForWorkBuddyCdpNative` | fn |  |
| 1603 | `start` | const |  |
| 1653 | `nativeLaunchFailed` | fn |  |
| 1660 | `nativeStartupMain` | fn |  |

## scripts/growth-tasks.js  （1770 行 / 65 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 105 | `isMpTaskCode` | fn |  |
| 113 | `boundedText` | fn | --------------------------------------------------------------------------- |
| 117 | `nonNegativeInt` | fn |  |
| 123 | `randomHex32` | fn | 32 位 hex 随机串（替代上游 crypto/rand 的 NewMessageID 形态）。 |
| 143 | `deriveId` | fn |  |
| 161 | `desktopFingerprint` | fn |  |
| 192 | `webFingerprint` | fn | Web 端指纹（浏览器形状，仅 web 域页面行为类任务用）。 |
| 209 | `mpFingerprint` | fn | 小程序端指纹（appservice 形状）。 |
| 234 | `assertFingerprintComplete` | fn |  |
| 244 | `desktopEvent` | fn | --------------------------------------------------------------------------- |
| 257 | `desktopChatSequence` | fn |  |
| 321 | `desktopBuddyAppSequence` | fn |  |
| 324 | `mk` | const |  |
| 337 | `automationCreateEvent` | fn | 「定时任务创建成功」单事件。 |
| 347 | `desktopTemplateUseSequence` | fn | 「使用模板创建任务」事件组（template_5 计数）。 |
| 360 | `desktopPlaybookPromptSequence` | fn | 「灵感案例做同款」事件组（playbook_prompt 计数）。 |
| 380 | `desktopDesignCanvasSequence` | fn | 「设计创意画布」事件组（create_canvas 计数，+300 分）。 |
| 398 | `normalizeExpert` | fn | 专家市场条目的最小形状。 |
| 415 | `desktopExpertSummonSequence` | fn | 「召唤平台专家」三连事件。 |
| 439 | `desktopExpertActualUseEvent` | fn |  |
| 453 | `desktopSkillInfoEvent` | fn | skill_1 判据事件（skill_info，需 JOIN 真实会话的服务端 requestId）。 |
| 472 | `chatRequestSendEvent` | fn |  |
| 516 | `mpChatRequestSendEvent` | fn | 小程序口径 chat_request_send（school 域 chat_3_times / Sequential_Tasks_1 判据）。 |
| 539 | `mpSchoolSeasonChatEvent` | fn | school_season 判据事件：mp chat_request_send + activityId。 |
| 560 | `buildTaskActions` | fn |  |
| 775 | `inNightWindow` | fn | 夜猫子计数窗口判定（本地时区 23:00–08:00）。 |
| 786 | `taskActionIndex` | fn | 任务在动作表中的下标（依赖序；未知返回大值）。 |
| 801 | `planAutoRun` | fn |  |
| 869 | `resolveFetch` | fn | --------------------------------------------------------------------------- |
| 880 | `resolveApiHost` | fn |  |
| 889 | `unwrapEnvelope` | fn | 归一化上游信封：{code,msg,data} ⇒ data；非 0 code 抛错。 |
| 898 | `postJson` | fn |  |
| 931 | `getJson` | fn |  |
| 958 | `bearerHeaders` | fn |  |
| 970 | `reportDesktopEvent` | fn |  |
| 990 | `reportWebEvent` | fn | Web 指纹事件上报 → {webBase}/v2/report（页面行为类任务，如 Library_read）。 |
| 1014 | `reportMpEvent` | fn | 小程序指纹事件上报 → {codebuddyBase}/v2/report。 |
| 1036 | `reportChatActivity` | fn | 成长域活跃上报（chat_request_send）→ {billingBase}/v2/report。 |
| 1063 | `realChat` | fn |  |
| 1140 | `extractRealRequestId` | fn | 从 SSE 文本里抽第一个服务端 requestId（纯函数，便于回归）。 |
| 1157 | `fetchMarketExperts` | fn | 拉取专家市场真实列表（expert_actual_use 的 id 必须真实存在，编造不计数）。 |
| 1171 | `setAppearanceTheme` | fn | 设置官方外观主题（Hp_Appearance 前半段）。 |
| 1192 | `readTaskState` | fn |  |
| 1195 | `pick` | const |  |
| 1211 | `normalizeTaskRow` | fn |  |
| 1225 | `listTasks` | fn | 拉取任务列表（默认口径；mp 口径请用 listTasksMp）。 |
| 1233 | `listTasksMp` | fn | 拉取小程序口径任务列表（默认列表不含 mp 专属码）。 |
| 1246 | `acceptTasks` | fn | 批量接受任务（accept 是「报名」，不产生进度，可幂等重放）。 |
| 1247 | `list` | const |  |
| 1257 | `acceptTasksMp` | fn | mp 口径批量接受。 |
| 1258 | `list` | const |  |
| 1280 | `claimReward` | fn |  |
| 1289 | `parse` | const |  |
| 1322 | `claimRewardMp` | fn | 领奖（mp 口径）。 |
| 1342 | `buddyAgreement` | fn | Buddy 协议同意 / 领养（first_buddy 链路）。 |
| 1347 | `buddyFirst` | fn |  |
| 1363 | `acceptWithVerify` | fn |  |
| 1386 | `findTaskWaiting` | fn |  |
| 1402 | `createRunner` | fn |  |
| 1419 | `mkConvId` | const |  |
| 1425 | `findTask` | const |  |
| 1549 | `runTaskAction` | fn |  |
| 1609 | `progressText` | fn |  |
| 1622 | `runAutoRun` | fn |  |
| 1629 | `emit` | const | 刻意吞掉回调自身的异常 —— 进度汇报失败不该把整轮任务带崩。 |

## scripts/automation.js  （1228 行 / 48 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 99 | `storePath` | fn |  |
| 101 | `clone` | fn |  |
| 103 | `safeId` | fn |  |
| 122 | `readAutomations` | fn |  |
| 144 | `countAutomationsOnDisk` | fn | 只读探测磁盘上的条目数；读不到时返回 `null`（表示「未知」，**不是** 0）。 |
| 148 | `writeAutomations` | fn |  |
| 168 | `configureAutomationRuntime` | fn |  |
| 169 | `isTaskCompatible` | fn |  |
| 173 | `isSupportedTaskSchema` | fn |  |
| 175 | `normalizeTask` | fn |  |
| 198 | `normalizeTrigger` | fn |  |
| 213 | `canManuallyRunTask` | fn | Legacy single triggers remain valid; a types array explicitly selects multiple events. |
| 220 | `taskMatchesEvent` | fn |  |
| 227 | `validateSchedule` | fn |  |
| 241 | `localScheduleSlot` | fn |  |
| 254 | `createScheduleTicker` | fn |  |
| 312 | `taskIsPassiveCleanup` | fn | monopolizing the renderer for their entire observation window. |
| 327 | `stepsContainCheckin` | fn |  |
| 333 | `taskNeedsPanelClosed` | fn |  |
| 334 | `walk` | const |  |
| 343 | `builtinContentHash` | fn |  |
| 358 | `installBuiltinTask` | fn |  |
| 377 | `writeMarker` | const |  |
| 378 | `managedMarker` | const |  |
| 432 | `adoptBuiltinTask` | fn |  |
| 460 | `validateLocator` | fn |  |
| 471 | `validateSteps` | fn |  |
| 531 | `validateTask` | fn |  |
| 556 | `createSafetyReviewTask` | fn |  |
| 591 | `interpolate` | fn |  |
| 601 | `resolveValue` | fn |  |
| 613 | `getPath` | fn |  |
| 615 | `compare` | fn |  |
| 629 | `safeLogParam` | fn |  |
| 640 | `capabilityText` | fn |  |
| 719 | `agentBridgePaths` | fn |  |
| 731 | `atomicWriteText` | fn |  |
| 746 | `agentGuideText` | fn |  |
| 765 | `ensureAgentBridge` | fn |  |
| 775 | `safeRequestId` | fn |  |
| 780 | `createAgentRequest` | fn |  |
| 821 | `importAgentInbox` | fn |  |
| 866 | `locatorExpression` | fn |  |
| 880 | `executeTask` | fn |  |
| 886 | `pad` | const |  |
| 901 | `assertActive` | const |  |
| 907 | `runSteps` | const |  |
| 926 | `runStep` | const |  |

## scripts/session-sync.js  （1053 行 / 49 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 31 | `canonicalTranscriptRecord` | fn | fields so an account round-trip does not become a false content conflict. |
| 43 | `canonical` | fn |  |
| 53 | `safePath` | fn |  |
| 65 | `safePathAsync` | fn |  |
| 81 | `readSessionSizes` | fn | concurrent scans, never the size/file count of a session itself. |
| 89 | `stat` | fn |  |
| 96 | `base` | fn |  |
| 105 | `visit` | fn |  |
| 144 | `aliasesEqual` | fn |  |
| 156 | `readSnapshot` | fn | only when computed for the same aliases. |
| 171 | `safePathFast` | fn |  |
| 183 | `attachBytes` | fn |  |
| 199 | `cached` | fn |  |
| 207 | `visit` | fn |  |
| 312 | `validSessionId` | fn |  |
| 316 | `sameFileStat` | fn |  |
| 321 | `hashFileAsync` | fn |  |
| 333 | `readStableBytesAsync` | fn |  |
| 340 | `readTranscriptAsync` | fn |  |
| 387 | `readSnapshotAsync` | fn |  |
| 398 | `safePathFastAsync` | fn |  |
| 414 | `cached` | fn |  |
| 423 | `visit` | fn |  |
| 524 | `readSessionFingerprintAsync` | fn | workspace backup directories are excluded because they are local-only data. |
| 530 | `addStat` | const |  |
| 541 | `addDirectoryChildren` | const |  |
| 575 | `readSessionQuickFingerprintAsync` | fn | catches file creation/removal without enumerating every project/session file. |
| 579 | `add` | const |  |
| 613 | `compareSnapshots` | fn |  |
| 639 | `selectTargetSnapshot` | fn | only hashes while scanning, so duplicate workspaces do not accumulate in RAM. |
| 681 | `longestFirst` | const |  |
| 698 | `unchanged` | fn |  |
| 703 | `removeSyncBackup` | fn |  |
| 707 | `removeSyncBackupAsync` | fn |  |
| 714 | `pruneSyncBackups` | fn | when the daemon starts so old versions cannot grow the data directory forever. |
| 744 | `inspectSyncBackups` | fn | contents never leave the machine and are never included in the response. |
| 749 | `sizeOf` | const |  |
| 782 | `targetRelative` | fn |  |
| 786 | `changedTargetFiles` | fn |  |
| 800 | `targetBytes` | fn |  |
| 811 | `applySnapshot` | fn |  |
| 840 | `save` | const |  |
| 848 | `verifyPublished` | const |  |
| 913 | `unchangedAsync` | fn |  |
| 919 | `targetBytesAsync` | fn |  |
| 931 | `existingHashAsync` | fn |  |
| 936 | `applySnapshotAsync` | fn |  |
| 973 | `save` | const |  |
| 981 | `verifyPublished` | const |  |

## scripts/api-gateway.js  （415 行 / 18 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 53 | `gatewayPaths` | fn |  |
| 69 | `assertSafeRelativePath` | fn |  |
| 80 | `parseChecksums` | fn | 从 checksums.txt（`<sha256>  <文件名>` 每行一条）里取指定资产的期望摘要（小写；取不到返回 ''）。 |
| 93 | `sha256` | fn | 文件/缓冲区的 sha256（十六进制小写）。 |
| 105 | `listZipEntries` | fn |  |
| 146 | `readZipEntry` | fn | 解压单个条目为 Buffer（数据偏移以**本地头**为准：本地头的 extra 长度可能与中央目录不同）。 |
| 168 | `extractZipToDir` | fn |  |
| 202 | `buildAuthDocument` | fn |  |
| 229 | `writeAuthDocuments` | fn | 写出 auths/<prefix>-<uid>.json（文件名必须匹配官方 `workbuddy*.json` 的扫描规则）。 |
| 257 | `buildGatewayConfig` | fn |  |
| 289 | `readGatewayState` | fn | 读 WorkDaddy 侧状态（缺失/损坏一律给出「未安装」的默认值，不抛错）。 |
| 299 | `writeGatewayState` | fn | 原子写状态（tmp + rename）。**不写 api_key 明文**，只写指纹与长度。 |
| 323 | `toWorkbuddyModelEntry` | fn |  |
| 352 | `mergeGatewayModels` | fn |  |
| 356 | `incoming` | const |  |
| 372 | `unmergeGatewayModels` | fn | 撤销：按名单把本插件写入的条目摘掉（**纯函数**；名单来自 gateway 状态文件）。 |
| 380 | `apiKeyHint` | fn | api_key 的展示用指纹（只回前 6 位 + 长度，够确认是不是同一把，又不泄漏）。 |
| 387 | `generateApiKey` | fn | 生成本地 api_key（32 字节 base64url，约 43 字符）。 |

合计 **1953** 个函数。
