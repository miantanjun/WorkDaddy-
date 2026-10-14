# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-10-14 06:53:03
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （19714 行 / 649 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 57 | `resolveDaemonPrivilege` | fn |  |
| 269 | `readAutomationsTolerant` | fn |  |
| 709 | `persistScheduleLedger` | fn |  |
| 719 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 739 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 759 | `scheduleVerifyNotify` | fn |  |
| 769 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 776 | `nameOf` | const |  |
| 819 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 820 | `valid` | const |  |
| 845 | `diagnosticsEnabled` | fn |  |
| 853 | `redactDiagnosticText` | fn |  |
| 866 | `shouldPersistBreadcrumb` | fn |  |
| 872 | `validCdpPort` | fn |  |
| 876 | `readCdpPortFile` | fn |  |
| 885 | `writeCdpPortFile` | fn |  |
| 900 | `readUiPortFile` | fn |  |
| 904 | `writeUiPortFile` | fn |  |
| 919 | `cdpPortCandidates` | fn |  |
| 921 | `add` | const |  |
| 929 | `isLocalPortAvailable` | fn |  |
| 933 | `finish` | const |  |
| 948 | `findAvailableCdpPort` | fn |  |
| 955 | `selectCdpPort` | fn |  |
| 1031 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 1036 | `updateDebug` | fn |  |
| 1037 | `scrub` | const |  |
| 1067 | `writeUpdateAttempt` | fn |  |
| 1078 | `macWorkDaddyAppPath` | fn |  |
| 1101 | `resolveApplyUpdateVbs` | fn |  |
| 1120 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1133 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1145 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1174 | `githubAuthHeaders` | fn |  |
| 1184 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1208 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1210 | `fileName` | const |  |
| 1215 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1229 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1238 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1252 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1262 | `normalizeAssetSha256` | fn |  |
| 1267 | `expectedUpdateSha256` | fn |  |
| 1272 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1309 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1353 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1412 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1445 | `readUpstreamCache` | const |  |
| 1493 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1501 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1527 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1536 | `downloadUpdateInternal` | fn |  |
| 1594 | `cleanupTemp` | const |  |
| 1596 | `failDownload` | const |  |
| 1682 | `sha256File` | fn | 计算文件 SHA-256 |
| 1686 | `inspectPackagedApp` | fn |  |
| 1703 | `packagedAppVersionError` | fn |  |
| 1717 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 1771 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 1779 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 1819 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 1886 | `scheduleOAuthStateCleanup` | fn |  |
| 1892 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 1913 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 1942 | `accData` | const |  |
| 1954 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 2002 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 2027 | `markAttemptFailure` | const |  |
| 2036 | `markSpawnFailure` | const |  |
| 2158 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2173 | `log` | fn |  |
| 2184 | `isLockPermissionError` | fn |  |
| 2188 | `reportDaemonLockFallback` | fn |  |
| 2198 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2233 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2290 | `releaseDaemonLock` | fn |  |
| 2303 | `scheduleBackup` | fn |  |
| 2374 | `settlePendingReloadInjection` | fn |  |
| 2386 | `armPendingReloadInjection` | fn |  |
| 2408 | `runPendingReloadInjection` | fn |  |
| 2435 | `findCdpEndpoint` | fn |  |
| 2444 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2479 | `targetsBelongToProfile` | fn |  |
| 2499 | `isWorkBuddyCdpTarget` | fn |  |
| 2505 | `getPageTarget` | fn |  |
| 2511 | `cleanupForeignInjectedTargets` | fn |  |
| 2519 | `cleanupForeignInjectedTarget` | fn |  |
| 2528 | `finish` | const |  |
| 2571 | `cdpFocusDiagnostics` | fn |  |
| 2585 | `cdpMouseClick` | fn |  |
| 2608 | `cdpSend` | fn |  |
| 2626 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2627 | `raw` | const |  |
| 2639 | `connectCdp` | fn |  |
| 2716 | `waitForPageReadyThenDispatch` | fn |  |
| 2718 | `retry` | const |  |
| 2731 | `dispatchAutomationEvent` | fn |  |
| 2767 | `onCdpEvent` | fn |  |
| 2770 | `url` | const |  |
| 2860 | `resetClientDebugState` | fn |  |
| 2870 | `updateClientDebugState` | fn | clientRunning: true=进程在跑 / false=没跑 / null=未知（探测失败时不计数，避免误报） |
| 2885 | `safeClientRunning` | fn | __wbsClientDebugStateBlockEnd |
| 2924 | `refreshClientRunning` | fn |  |
| 2946 | `startClientRunningMonitor` | fn | --probe-client-running 也会加载本文件，提前刷新会递归拉起探测子进程。 |
| 2954 | `cdpLoop` | fn |  |
| 2977 | `reloadWorkBuddyPage` | fn |  |
| 2979 | `withTimeout` | const |  |
| 3021 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 3144 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 3158 | `resolveWorkBuddyBinary` | fn |  |
| 3161 | `tryFile` | const |  |
| 3173 | `psCmd` | const |  |
| 3202 | `addCandidate` | const |  |
| 3246 | `psQuote` | const |  |
| 3263 | `runCommand` | fn |  |
| 3270 | `finish` | const |  |
| 3294 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3323 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3339 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3356 | `linuxWorkBuddyPids` | fn |  |
| 3380 | `workBuddyRunning` | fn |  |
| 3397 | `waitForWorkBuddyExit` | fn |  |
| 3412 | `waitForWorkBuddyExitTolerant` | fn |  |
| 3424 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 3470 | `detail` | const |  |
| 3502 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 3528 | `resolveLauncherHome` | fn |  |
| 3538 | `resolveLinuxLaunchTarget` | fn |  |
| 3553 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 3632 | `clickByText` | fn |  |
| 3678 | `findByText` | fn |  |
| 3707 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 3713 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 3716 | `claimLog` | fn |  |
| 3724 | `sleep` | fn |  |
| 3729 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 3776 | `automationStateFile` | const |  |
| 3777 | `readAutomationState` | fn |  |
| 3780 | `writeAutomationState` | fn |  |
| 3786 | `automationAccountStatus` | fn |  |
| 3820 | `automationDeepLocatorExpression` | fn |  |
| 3835 | `first` | fn |  |
| 3840 | `choose` | fn |  |
| 3841 | `firstByAttribute` | fn |  |
| 3851 | `automationDomAction` | fn |  |
| 3852 | `assertActive` | const |  |
| 3860 | `read` | const |  |
| 3916 | `automationHttpRequest` | fn |  |
| 3939 | `automationPublicRun` | fn |  |
| 3947 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 3958 | `automationPanelSetOpen` | fn |  |
| 3966 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 3975 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 3988 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 4003 | `automationNotifyToast` | fn |  |
| 4033 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 4034 | `assertAutoCopySucceeded` | fn |  |
| 4040 | `recordAccountSyncResult` | fn |  |
| 4052 | `assertAccountSwitchIdle` | fn |  |
| 4058 | `automationSwitchProgress` | fn |  |
| 4066 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 4083 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 4089 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 4136 | `limitFailoverManualPublic` | fn |  |
| 4155 | `readLimitFailoverState` | fn |  |
| 4164 | `writeLimitFailoverState` | fn |  |
| 4175 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 4189 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 4205 | `runCdpExpression` | fn |  |
| 4216 | `readLimitBanner` | fn |  |
| 4229 | `readStructuredError` | fn |  |
| 4233 | `readLiveModel` | fn |  |
| 4237 | `setLiveModel` | fn |  |
| 4241 | `readLastUserTaskText` | fn |  |
| 4249 | `readFailoverSnapshot` | fn |  |
| 4265 | `pickWorkbuddyDaemonClient` | fn |  |
| 4267 | `walk` | fn |  |
| 4304 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4319 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4336 | `edgeSyncMappingDbPath` | fn |  |
| 4351 | `getEdgeSyncDb` | fn |  |
| 4364 | `readEdgeSyncRows` | fn |  |
| 4377 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4403 | `probeCloudConversations` | fn |  |
| 4430 | `collectCloudGhosts` | fn |  |
| 4468 | `purgeCloudConversations` | fn |  |
| 4502 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 4519 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 4537 | `purgeCloudGhostsSwitching` | fn |  |
| 4546 | `switchBack` | const |  |
| 4587 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 4597 | `limitReplyStarted` | fn |  |
| 4602 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 4609 | `findLimitFailoverTask` | fn |  |
| 4613 | `runningLimitFailoverRun` | fn |  |
| 4617 | `waitLimitVerdict` | fn |  |
| 4642 | `runLimitFailoverCore` | fn |  |
| 4673 | `hits` | const |  |
| 4962 | `buildLimitFailoverPorts` | fn |  |
| 5047 | `limitFailoverDesktopLogDir` | fn |  |
| 5056 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 5070 | `limitFailoverNotify` | fn |  |
| 5078 | `readLimitReplyIdle` | fn |  |
| 5082 | `limitFailoverAccountByUid` | fn |  |
| 5088 | `limitFailoverPrimaryUid` | fn |  |
| 5096 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 5102 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 5111 | `cancelLimitFailoverSwitchBack` | fn |  |
| 5124 | `limitFailoverPlanCancelled` | fn |  |
| 5128 | `finishLimitFailoverSwitchBack` | fn |  |
| 5151 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 5166 | `runLimitFailoverSwitchBack` | fn |  |
| 5167 | `isCancelled` | const |  |
| 5168 | `elapsedMs` | const |  |
| 5169 | `stopIfUnsafe` | const |  |
| 5289 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5324 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5386 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5396 | `readSessionActivity` | fn |  |
| 5401 | `idleSwitchbackPublicState` | fn |  |
| 5434 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 5512 | `idleSwitchbackTick` | fn |  |
| 5571 | `startIdleSwitchbackTicker` | fn |  |
| 5583 | `automationSwitchAccount` | fn |  |
| 5642 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 5649 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 5667 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 5680 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 5703 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 5715 | `automationAccountSwitchGuarded` | fn |  |
| 5737 | `automationNotificationNamespace` | fn |  |
| 5743 | `startAutomationRun` | fn |  |
| 5759 | `isCancelled` | const |  |
| 5762 | `appendRunLog` | const |  |
| 5773 | `panelPrepare` | const |  |
| 5785 | `withInput` | const |  |
| 5802 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 5812 | `readSession` | const | 必须保持原语义，否则会波及后面的「发送是否被受理」判定）。 |
| 5820 | `sessionAction` | const |  |
| 5828 | `openedUid` | const |  |
| 5859 | `accountUid` | const |  |
| 5955 | `completionReport` | const |  |
| 5982 | `publicAccounts` | const |  |
| 5983 | `publicCurrent` | const |  |
| 5986 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 6054 | `resumeAutomationAfterNavigation` | fn |  |
| 6065 | `todayStr` | fn |  |
| 6067 | `z` | const |  |
| 6071 | `loadCheckinCache` | fn |  |
| 6078 | `saveCheckinCache` | fn |  |
| 6101 | `accountBackupSignature` | fn | 备份文件的「指纹」（mtime+size）：文件换了，落盘的那份刷新时间就不再可信。 |
| 6110 | `loadTokenRefreshState` | fn |  |
| 6121 | `saveTokenRefreshState` | fn |  |
| 6135 | `persistedTokenRefreshState` | fn | 只有「备份文件未变」时，落盘的那份刷新时间才可信（否则宁可当没刷过）。 |
| 6141 | `rememberTokenRefreshSuccess` | fn |  |
| 6158 | `listAccountsWithRuntimeTokenCache` | fn |  |
| 6179 | `refreshAccountBackupToken` | fn | 刷新备份账号凭证：临期惰性刷新，或当天尚未成功刷新时执行保活。 |
| 6241 | `refreshAllAccountTokensOnPanelOpen` | fn |  |
| 6243 | `task` | const |  |
| 6247 | `worker` | const |  |
| 6279 | `dailyCheckin` | fn |  |
| 6328 | `claimDailyForUid` | fn |  |
| 6337 | `performAccountCheckin` | fn |  |
| 6383 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 6447 | `desc` | const |  |
| 6492 | `buildInjectScript` | fn |  |
| 6537 | `injectWidgetManual` | fn |  |
| 6545 | `readCdpTargets` | fn |  |
| 6556 | `readLogTail` | fn |  |
| 6567 | `collectDiagnostics` | fn |  |
| 6592 | `writeDiagnosticsSnapshot` | fn |  |
| 6613 | `sqliteRun` | fn |  |
| 6619 | `codeBuddySessionRows` | fn |  |
| 6634 | `sqlParamAt` | fn |  |
| 6637 | `sqliteQuery` | fn |  |
| 6679 | `officialSlotOf` | fn | 本地时区槽位 `YYYY-MM-DDTHH:MM`（与 scheduled-send 的 localSlot 同格式）。 |
| 6680 | `pad` | const |  |
| 6697 | `readOfficialAutomations` | fn |  |
| 6708 | `items` | const |  |
| 6742 | `findOfficialSlotConflicts` | fn |  |
| 6771 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 6790 | `createDirectoryNoFollow` | fn |  |
| 6809 | `repairMissingSessionWorkspaces` | fn |  |
| 6835 | `sessionRangeMs` | fn |  |
| 6852 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 6856 | `copyOne` | const |  |
| 6882 | `onlyCopyable` | const | 要拦的只有 socket / FIFO / 字符设备 / 块设备这类**根本无法复制**的特殊文件。 |
| 6990 | `sessionBodyMtime` | fn |  |
| 7007 | `sessionContentMtime` | fn |  |
| 7011 | `visit` | const |  |
| 7045 | `directoryStats` | fn |  |
| 7074 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 7085 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 7111 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 7126 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 7137 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 7157 | `sortAutoCopyPlanBySize` | fn |  |
| 7176 | `readCopyManifestCache` | fn |  |
| 7187 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 7196 | `deriveCopyManifestFromCache` | fn |  |
| 7223 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 7234 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 7256 | `emptyWorkspaceCounters` | fn |  |
| 7264 | `transferWorkspaceTree` | fn |  |
| 7272 | `copyFileAt` | const |  |
| 7365 | `copySessionWorkspacePayload` | fn |  |
| 7387 | `outcome` | const |  |
| 7399 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 7420 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 7554 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 7578 | `forcedSource` | const | content 模式那两道闸门用的是另一个独立布尔 forcePinnedSource（见上）。 |
| 7590 | `trackPayload` | const |  |
| 7648 | `sleepMs` | const |  |
| 7759 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 7805 | `listAutoCopyConflicts` | fn |  |
| 7818 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 7832 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 7858 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 7958 | `readNativeDeleteSweep` | fn |  |
| 7965 | `saveNativeDeleteSweep` | fn |  |
| 7978 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 7985 | `sweepNativeSessionDeletes` | fn |  |
| 8057 | `readArchiveIsolation` | fn |  |
| 8064 | `saveArchiveIsolation` | fn |  |
| 8078 | `archiveIsolationEnabled` | fn |  |
| 8083 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 8099 | `members` | const |  |
| 8167 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 8216 | `purgeLocalSessionCopyCore` | fn |  |
| 8248 | `purgeArchivedCrossAccountCopies` | fn |  |
| 8299 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 8376 | `summarizeSessionImportErrors` | fn |  |
| 8386 | `archiveRelativePath` | fn |  |
| 8390 | `collectSessionArchiveFiles` | fn |  |
| 8393 | `collect` | const |  |
| 8433 | `ensureArchiveParentNoFollow` | fn |  |
| 8452 | `restoreSessionArchiveFiles` | fn |  |
| 8475 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 8506 | `getSessionSyncCache` | fn |  |
| 8529 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 8545 | `isTaskSessionRecord` | fn |  |
| 8550 | `sqlPlaceholders` | fn |  |
| 8554 | `insertCopiedSession` | fn |  |
| 8584 | `createForkSession` | fn |  |
| 8617 | `prepareSessionExport` | fn |  |
| 8634 | `exportSessions` | fn |  |
| 8648 | `validImportedSessionUid` | fn |  |
| 8654 | `importSessions` | fn |  |
| 8658 | `importSessionArchives` | fn |  |
| 8706 | `adoptExistingCopyTarget` | fn |  |
| 8750 | `copySessionRecord` | fn |  |
| 8767 | `perform` | const |  |
| 8778 | `finishAutoDirty` | const |  |
| 8782 | `retain` | const |  |
| 8921 | `getSessionDirtyIndex` | fn |  |
| 8929 | `scheduleSessionDirtySave` | fn |  |
| 8946 | `markSessionDirty` | fn | 记一条脏标记；**只有真变化才置脏**（同一时刻的重复通知不写盘）。 |
| 8959 | `markSessionDirtyBaseline` | fn | renderer 建立基线（`body.ready`）。未建基线的账号一律 fail-open = 全当脏。 |
| 8964 | `clearSessionDirty` | fn | 清一条脏标记；`expectedAt` 不匹配就不清（**并发到来的新事件不许被旧的在飞清理抹掉**）。 |
| 8973 | `autoCopyDirtyFastpathEnabled` | fn | 批次 3 的开关：**默认关**（文件缺失 / 内容不是 {enabled:true} 都算关）。每次规划读一次。 |
| 8989 | `isAutoCopyRowCleanByDirty` | fn |  |
| 8994 | `lineageId` | const |  |
| 9003 | `buildAutoCopyPlan` | fn |  |
| 9086 | `isAutoCopyPausedError` | fn |  |
| 9093 | `beginRendererReloadPriority` | fn |  |
| 9108 | `hasPendingAutoCopyTo` | fn |  |
| 9117 | `pruneAutoCopyJobs` | fn |  |
| 9127 | `runAutoCopyQueue` | fn |  |
| 9157 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 9224 | `enterSwitchFlowRunner` | fn | 进入一个切号流程；返回**幂等**的退出函数（重复调用不会把计数减成负）。 |
| 9253 | `setSwitchFlowPhase` | fn |  |
| 9259 | `terminal` | const |  |
| 9294 | `readSwitchFlowState` | fn | 读状态（惰性过期：终态留 TTL 供渲染层读到，过期即清）。 |
| 9306 | `requestSwitchFlowCancel` | fn | 「关闭弹窗」：置取消位 + 立刻请求中止复制（worker 在下个检查点收尾，不是硬停）。 |
| 9360 | `waitPreSyncSettled` | fn |  |
| 9414 | `preSyncBeforeSwitch` | fn |  |
| 9516 | `resolveSyncNowSources` | fn |  |
| 9517 | `all` | const |  |
| 9553 | `limitFailoverSyncWaitMs` | fn |  |
| 9588 | `openConversationById` | fn |  |
| 9612 | `fastExpr` | const |  |
| 9697 | `sidebarProbe` | const |  |
| 9867 | `prepareFailoverContinuation` | fn |  |
| 9873 | `degrade` | const |  |
| 9975 | `startAutoCopyJob` | fn |  |
| 10048 | `run` | const |  |
| 10056 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 10340 | `activeAutoCopyJob` | fn |  |
| 10353 | `publicAutoCopyJob` | fn |  |
| 10435 | `publicSpaceScanJob` | fn |  |
| 10459 | `buildSpaceScanResolvers` | fn |  |
| 10505 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 10517 | `startSpaceScanJob` | fn |  |
| 10607 | `isValidSessionId` | fn |  |
| 10616 | `matchedSessionIds` | fn |  |
| 10621 | `resolveManagedSessionTarget` | fn |  |
| 10634 | `isManagedDirectoryNoFollow` | fn |  |
| 10658 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 10692 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 10698 | `delOne` | const |  |
| 10742 | `json` | fn |  |
| 10773 | `isAllowedApiOrigin` | fn |  |
| 10793 | `hasApiToken` | fn |  |
| 10800 | `isApiRequestAuthorized` | fn |  |
| 10809 | `isAllowedDevtoolsOrigin` | fn |  |
| 10849 | `readBody` | fn |  |
| 10854 | `ignoreLateError` | const |  |
| 10855 | `cleanup` | const |  |
| 10865 | `finish` | const |  |
| 10871 | `fail` | fn |  |
| 10877 | `onData` | fn |  |
| 10890 | `onEnd` | fn |  |
| 10901 | `onError` | fn |  |
| 10904 | `onIncomplete` | fn |  |
| 10936 | `workbuddySettingsPath` | fn |  |
| 10940 | `readWorkbuddySettings` | fn |  |
| 10948 | `writeWorkbuddySettings` | fn |  |
| 10954 | `buildAskRuleBlock` | fn |  |
| 10959 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 10969 | `getAskModeState` | fn |  |
| 10971 | `customPrompt` | const |  |
| 10984 | `setAskMode` | fn |  |
| 10999 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 11041 | `buildZhReasoningBlock` | fn |  |
| 11046 | `stripZhReasoning` | fn | 从 customPrompt 中移除中文思考段（保留用户其它内容与决策弹窗段） |
| 11056 | `getZhReasoningState` | fn |  |
| 11058 | `customPrompt` | const |  |
| 11074 | `setZhReasoning` | fn |  |
| 11094 | `refreshZhReasoningIfEnabled` | fn | 启动时调用：如已启用中文思考，把旧的规则段替换为最新版本（用标记精确识别） |
| 11145 | `deriveAgentHealth` | fn |  |
| 11183 | `buildAgentHintRule` | fn |  |
| 11265 | `buildAgentHintBlock` | fn |  |
| 11277 | `stripAgentHint` | fn | 从 customPrompt 中移除子 Agent 提示段（保留用户其它内容，**且不改动用户原文一个字节**）。 |
| 11292 | `getAgentHintState` | fn |  |
| 11294 | `customPrompt` | const |  |
| 11311 | `setAgentHint` | fn |  |
| 11349 | `refreshAgentHintAfterCatalogChange` | fn |  |
| 11365 | `refreshAgentHintIfEnabled` | fn | 启动时调用：如已开启，把旧的提示规则替换为最新版本（用标记精确识别）。 |
| 11394 | `collectAgentUsage` | fn |  |
| 11450 | `readNoDisturbState` | fn |  |
| 11453 | `state` | const |  |
| 11475 | `readNoDisturbApplied` | fn |  |
| 11479 | `hasAll` | const |  |
| 11494 | `removeListItems` | fn |  |
| 11500 | `ensureSandboxObj` | fn |  |
| 11509 | `applyNoDisturbSwitch` | fn |  |
| 11513 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 11519 | `rollback` | const |  |
| 11567 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 11582 | `noDisturbAudit` | fn |  |
| 11617 | `acAppConfigPath` | fn |  |
| 11620 | `readAppConfig` | fn |  |
| 11628 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 11633 | `acBlock` | fn |  |
| 11640 | `stripACBlocks` | fn |  |
| 11646 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 11652 | `acCustomPromptPresent` | fn |  |
| 11657 | `readAutoContinueState` | fn |  |
| 11672 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 11689 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 11703 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 11720 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 11740 | `sessBuild` | fn |  |
| 11748 | `readSessionState` | fn |  |
| 11750 | `ns` | const |  |
| 11751 | `st` | const |  |
| 11783 | `writeSessionState` | fn |  |
| 11785 | `prior` | const |  |
| 11794 | `setSessionSwitch` | fn |  |
| 11802 | `addQuickPhrase` | fn |  |
| 11814 | `updateQuickPhrase` | fn |  |
| 11824 | `deleteQuickPhrases` | fn |  |
| 11831 | `normalizeQuickPhraseIds` | fn |  |
| 11843 | `exportQuickPhrases` | fn |  |
| 11859 | `importQuickPhrases` | fn |  |
| 11884 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 11893 | `selectAutomationModelById` | fn |  |
| 11906 | `confirmAutomationModel` | fn |  |
| 11914 | `restoreAutomationNewTaskPreference` | fn |  |
| 11922 | `automationAgentSurfaceExpression` | fn |  |
| 11924 | `visible` | fn |  |
| 11925 | `isNewTask` | fn |  |
| 11926 | `composerText` | fn |  |
| 11953 | `readAutomationAgentSurface` | fn |  |
| 11961 | `ensureAutomationNewTask` | fn |  |
| 12021 | `openNewAutomationAgentTask` | fn |  |
| 12040 | `currentAccount` | fn |  |
| 12046 | `a` | const |  |
| 12075 | `readAccountHealth` | fn |  |
| 12083 | `writeAccountHealth` | fn |  |
| 12099 | `recordAccountHealth` | fn |  |
| 12115 | `mergeLiveHealth` | fn |  |
| 12135 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 12143 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 12160 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 12179 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 12195 | `sweepAccountHealth` | fn |  |
| 12214 | `buildFailoverHealthFilter` | fn |  |
| 12242 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 12252 | `accountHealthEcho` | fn |  |
| 12265 | `accountBackupFile` | fn |  |
| 12286 | `gatewayStatus` | fn |  |
| 12306 | `gatewayCollectAccounts` | fn | 读本仓已登录的账号并解密（**复用 lib.js 的 [wd-compat] 解密器**，不另写一份帧格式）。 |
| 12315 | `auth` | const |  |
| 12316 | `account` | const |  |
| 12335 | `gatewayProbeHealth` | fn | 探活（/healthz 免鉴权）。null = 不可达。 |
| 12351 | `gatewayInstall` | fn | 下载 → SHA-256 校验 → 解压 → 凭证桥 → 生成 config。任一环节失败都不留半成品可用状态。 |
| 12353 | `task` | const |  |
| 12413 | `gatewayReadEnabled` | fn | 「用户是否启用」是 WorkDaddy 侧意图，与「装没装」分开记（沿用免打扰开关的记法）。 |
| 12420 | `gatewaySetEnabled` | fn |  |
| 12433 | `gatewayStart` | fn | 启动网关子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 12457 | `gatewayStop` | fn |  |
| 12465 | `refreshGatewayIfEnabled` | fn | 启动时：用户启用过就自动拉起（与 autoContinue 的「启动补写」同模式；未安装则静默跳过）。 |
| 12478 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 12483 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 12488 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 12515 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 12521 | `stashRecordByKey` | fn |  |
| 12528 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 12556 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 12579 | `buildBusyExpr` | fn |  |
| 12590 | `visibleIn` | fn | 误判空闲会在回复中输入，正文/图片回填容易失败，这是原设计刻意保守的原因。 |
| 12617 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 12628 | `busy` | const |  |
| 12659 | `resolveUsageBoardPython` | fn | 解析可用的 python：环境变量 → 托管 venv → 托管 base（版本目录）→ PATH 兜底。 |
| 12681 | `latestUsageBoardHtml` | fn | usage-board 目录里最新一份看板 HTML 文件名；没有则返回 null。 |
| 12692 | `latestUsageUnifiedHtml` | fn | 统一用量看板的产物：unified-board-<stamp>.html。 |
| 12706 | `creditUsageQuery` | fn |  |
| 12714 | `readUsageStatusJson` | fn |  |
| 12719 | `runUsageStatusExtractor` | fn | 跑一次第三方抽取器（只为补充指标）。失败/超时都只返回 ok:false，绝不抛。 |
| 12725 | `done` | const |  |
| 12747 | `builtinAssetsDir` | fn |  |
| 12763 | `builtinWallpaperSource` | fn |  |
| 12772 | `initBuiltinAssets` | fn |  |
| 13007 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 13034 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 13064 | `accountSwitchThemeExpression` | fn | 会被启动时的旧云端选择覆盖。这里不安装 hook，也不改其他账号或皮肤 CSS。 |
| 13109 | `preserveAccountSwitchTheme` | fn |  |
| 13126 | `nativeAppearanceSyncExpression` | fn | 的 CSS 资源；浅色/深色仍由 WorkBuddy 原生状态负责。 |
| 13129 | `removeNativeSheet` | fn |  |
| 13137 | `setAttr` | fn |  |
| 13142 | `setMode` | fn |  |
| 13153 | `sync` | fn |  |
| 13198 | `startNativeAppearanceSyncByCdp` | fn |  |
| 13203 | `releaseThemeByCdp` | fn |  |
| 13217 | `restoreNativeAppearanceByCdp` | fn |  |
| 13221 | `uid` | const |  |
| 13294 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 13338 | `loadThemePatches` | fn |  |
| 13354 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 13366 | `loadThemeVars` | fn |  |
| 13382 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 13386 | `declOf` | const |  |
| 13397 | `lead` | const |  |
| 13405 | `readBackgroundBlur` | fn |  |
| 13416 | `applyThemeByCdp` | fn |  |
| 13450 | `uid` | const |  |
| 13452 | `colors` | const |  |
| 13575 | `wbsBuiltinAppearance` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 13587 | `wbsSnapshotNativeAppearance` | fn |  |
| 13611 | `wbsClearNativeCustomCss` | fn |  |
| 13650 | `wbsWriteAppearanceState` | fn |  |
| 13658 | `wbsSyncAppearanceKeys` | fn |  |
| 13685 | `wbsPrepareNativeAppearance` | fn |  |
| 13693 | `wbsSyncNativeTheme` | fn |  |
| 13707 | `wbsSyncNativeThemeQuiet` | fn | wbsSyncNativeThemeIdempotent：250ms 守护/keeper 的周期调用路径，属性同值时不写。 |
| 13762 | `keepSelectedTheme` | fn |  |
| 13800 | `wbsHasSpecialNativeAppearance` | fn |  |
| 13825 | `wbsHoldNativeAppearance` | fn |  |
| 13897 | `clearComposerByCdp` | fn |  |
| 13950 | `fnv1a32` | fn |  |
| 13967 | `composerDraftHash` | fn |  |
| 13984 | `composerDraftExpr` | fn |  |
| 14024 | `composerDraftConsumed` | fn |  |
| 14055 | `composerSendExpr` | const |  |
| 14059 | `fiberOf` | fn |  |
| 14067 | `isStore` | fn |  |
| 14124 | `sendStashToComposer` | fn |  |
| 14130 | `guardedSend` | const |  |
| 14133 | `allItems` | const |  |
| 14142 | `s` | const |  |
| 14295 | `countBlocks` | const |  |
| 14305 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 14351 | `name` | const |  |
| 14367 | `disp` | const |  |
| 14378 | `visible` | fn |  |
| 14450 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 14464 | `readDraft` | const |  |
| 14472 | `draftConsumed` | const |  |
| 14475 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 14572 | `fetchResource` | fn |  |
| 14606 | `data` | const |  |
| 14609 | `accounts` | const |  |
| 14641 | `fetchEnterpriseResource` | fn |  |
| 14687 | `robustFetchEnterpriseResource` | fn |  |
| 14710 | `resolveEnterpriseId` | fn |  |
| 14738 | `retryDelay` | const |  |
| 14742 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 14774 | `fetchCredits` | fn |  |
| 14832 | `refreshCreditRotationAccounts` | fn |  |
| 14856 | `rememberCreditRotation` | fn |  |
| 14868 | `cachedCreditRotationAccounts` | fn |  |
| 14880 | `listDailyUsage` | fn |  |
| 14886 | `syncCurrentCreditUsage` | fn |  |
| 14889 | `task` | const |  |
| 14930 | `exportSecretKey` | fn |  |
| 14934 | `decryptLegacyExport` | fn |  |
| 14945 | `handleApiRoute` | fn |  |
| 15264 | `currentHealth` | const |  |
| 15664 | `code` | const | ⚠️「没有可委派的模型」是**用户可修正**的状态 ⇒ 400，不是 500 |
| 16010 | `uid` | const |  |
| 16073 | `d` | const |  |
| 16147 | `html` | const |  |
| 16418 | `uid` | const |  |
| 16555 | `dayOf` | const | 积分窗口与 token 窗口取同一个区间：分子分母同区间，否则 credit/1k 会被拉偏。 |
| 16612 | `finish` | const |  |
| 16689 | `pad` | const |  |
| 16697 | `prune` | const |  |
| 16890 | `worker` | const |  |
| 16927 | `uid` | const |  |
| 17522 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 17869 | `run` | const |  |
| 18119 | `targetUid` | const |  |
| 18148 | `targetUid` | const |  |
| 18499 | `id` | const |  |
| 18786 | `uid` | const |  |
| 18787 | `conv` | const |  |
| 18788 | `safe` | const |  |
| 18794 | `items` | const |  |
| 18857 | `key` | const |  |
| 18870 | `key` | const |  |
| 18885 | `key` | const |  |
| 18942 | `uid` | const |  |
| 19164 | `handleApi` | fn |  |
| 19165 | `failure` | const |  |
| 19196 | `stopCaffeinate` | fn |  |
| 19216 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 19224 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 19227 | `tick` | const |  |
| 19239 | `startCaffeinate` | fn |  |
| 19270 | `applySleepMode` | fn |  |
| 19299 | `sleepNow` | fn |  |
| 19320 | `restoreSleepMode` | fn |  |
| 19331 | `startServer` | fn |  |
| 19508 | `cleanup` | const |  |
| 19525 | `tryListen` | const |  |
| 19600 | `migrateAgentHintModel` | fn |  |
| 19603 | `cp` | const |  |
| 19666 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （22056 行 / 905 个函数）

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
| 1877 | `wbsSystemLanguage` | fn |  |
| 1881 | `wbsNormalizeLanguage` | fn |  |
| 1886 | `escapeRegExp` | fn |  |
| 1887 | `wbsI18nBuildMatchers` | fn |  |
| 1924 | `wbsTranslateString` | fn |  |
| 1974 | `wbsIsBuiltinAutomation` | fn |  |
| 1983 | `wbsBuiltinAutomationText` | fn |  |
| 2035 | `wbsAutomationText` | fn |  |
| 2040 | `wbsAutomationEditedText` | fn |  |
| 2051 | `wbsReportErr` | fn |  |
| 2091 | `wbsClientVersion` | fn |  |
| 2213 | `isIdentityExpired` | fn | 今日签到状态展示：账号卡片底部与积分余额并列显示 |
| 2230 | `accountHealthLocked` | fn | 那个看 tokenExpiresAt / 签到 401，这个看 daemon 下发的账号健康视图）。 |
| 2235 | `esc` | fn |  |
| 2236 | `escAttr` | fn |  |
| 2239 | `summarizeCreditDays` | fn | 每个积分段只归入一个剩余天数桶；缺失有效期的余额不展示，不猜测到期日。 |
| 2241 | `add` | fn |  |
| 2267 | `creditOpacity` | fn |  |
| 2272 | `createAvatarLibrary` | fn |  |
| 2274 | `validImage` | fn |  |
| 2290 | `snapshot` | fn |  |
| 2291 | `commit` | fn |  |
| 2298 | `select` | method |  |
| 2302 | `add` | method |  |
| 2309 | `remove` | method |  |
| 2317 | `resolveAvatarChoice` | fn |  |
| 2323 | `checkinHtml` | fn |  |
| 2343 | `isGrowthActiveToday` | fn |  |
| 2349 | `activityStreakHtml` | fn |  |
| 2360 | `isKnownActivityStreak` | fn |  |
| 2364 | `el` | fn |  |
| 2371 | `maskPhone` | fn |  |
| 2377 | `fmtTime` | fn |  |
| 2387 | `initial` | fn |  |
| 2393 | `api` | fn |  |
| 2420 | `collectAll` | fn | 调试：递归收集所有元素（含 shadowRoot 与同域 iframe），用于抓取输入框内容 |
| 2434 | `allElements` | fn |  |
| 2447 | `captureComposer` | fn | 调试：抓取 WorkBuddy 输入框当前内容（文字/图片/附件/连接器/skill） |
| 2506 | `findComposer` | fn |  |
| 2516 | `findComposerRaw` | fn |  |
| 2563 | `composerHasContent` | fn | composerTextFromTree 跳过这两类装饰子树。 |
| 2571 | `getComposerContent` | fn | 干净地抓取输入框内容：只取 Slate 节点（不受页面装饰干扰） |
| 2587 | `getConversationId` | fn | 尽量拿到当前会话 id（URL / 当前布局选中会话 / 标题兜底） |
| 2602 | `build` | fn |  |
| 2607 | `send` | method |  |
| 2628 | `removeTimer` | fn |  |
| 2632 | `setBuildTimeout` | fn |  |
| 2640 | `setBuildInterval` | fn |  |
| 2647 | `requestBuildFrame` | fn |  |
| 2656 | `listen` | fn |  |
| 2663 | `toast` | fn |  |
| 2667 | `receiveToast` | fn |  |
| 2701 | `switchFlowAccountLabel` | fn |  |
| 2708 | `switchFlowMaskEl` | fn |  |
| 2710 | `buildSwitchFlowMask` | fn |  |
| 2741 | `renderSwitchFlow` | fn |  |
| 2816 | `cancelSwitchFlow` | fn |  |
| 2842 | `scheduleSwitchFlowPoll` | fn |  |
| 2847 | `pollSwitchFlow` | fn |  |
| 2882 | `isVisibleHealthNode` | fn |  |
| 2890 | `findBlockingPrompt` | fn |  |
| 2919 | `findSessionError` | fn |  |
| 2939 | `readAssistantHealth` | fn |  |
| 2970 | `setSessionHealthResult` | fn |  |
| 2993 | `scanSessionHealth` | fn |  |
| 3070 | `summary` | method |  |
| 3071 | `active` | method |  |
| 3072 | `generation` | method |  |
| 3073 | `root` | method |  |
| 3077 | `summary` | method |  |
| 3078 | `active` | method |  |
| 3079 | `generation` | method |  |
| 3080 | `root` | method |  |
| 3085 | `isUsableThemeAuditRoot` | fn |  |
| 3094 | `findThemeAuditRoot` | fn |  |
| 3105 | `syncThemeAuditRoot` | fn |  |
| 3127 | `applyI18n` | fn |  |
| 3172 | `setLanguage` | fn |  |
| 3191 | `applyInjectedI18n` | fn |  |
| 3445 | `qpDiag` | fn | 面板关闭/重开：点击选项（发送/编辑/任意项）后关闭面板；重新进入按钮区恢复 hover 可展示 |
| 3458 | `mountExplorePopover` | fn | keeps it above the usage summary even when the composer creates its own layer. |
| 3462 | `listen` | fn |  |
| 3466 | `cancelClose` | fn |  |
| 3467 | `close` | fn |  |
| 3468 | `open` | fn |  |
| 3478 | `delayedClose` | fn |  |
| 3501 | `acMenuClose` | fn |  |
| 3515 | `readMessageNavigationEnabled` | fn |  |
| 3518 | `writeMessageNavigationEnabled` | fn |  |
| 3521 | `readSelectionQuoteEnabled` | fn |  |
| 3524 | `writeSelectionQuoteEnabled` | fn |  |
| 3527 | `readForkEnabled` | fn |  |
| 3530 | `writeForkEnabled` | fn |  |
| 3546 | `applySessionModule` | fn |  |
| 3575 | `syncSessionModule` | fn |  |
| 3581 | `setSessionSwitchWire` | fn | 开关切换：写 daemon 并回应用户界（设置失败回滚 UI 状态） |
| 3605 | `selectionQuoteElement` | fn | WorkBuddy 的 selection-quote renderer 会通过 InputContextTag 自己渲染消息图标。 |
| 3620 | `selectionQuoteBlock` | fn |  |
| 3637 | `hideSelectionQuoteButton` | fn |  |
| 3642 | `updateSelectionQuoteButton` | fn |  |
| 3665 | `scheduleSelectionQuoteButton` | fn |  |
| 3671 | `insertSelectionQuote` | fn |  |
| 3691 | `setupSelectionQuote` | fn |  |
| 3729 | `renderQpList` | fn | 增强页快捷短语列表渲染（含批量模式） |
| 3796 | `renderExploreOptions` | fn | 发送按钮面板选项 = 快捷短语列表；点击项经 CDP 发送该短语（替换式，发完默认关面板） |
| 3867 | `openQpEdit` | fn | 新增/编辑快捷短语弹窗（参考账号导出弹窗；textarea 最多 5 行 / 500 字） |
| 3890 | `closeQpEdit` | fn |  |
| 3911 | `confirmQpDelete` | fn | 删除二次确认弹窗（支持单选/批量） |
| 3925 | `closeQpDel` | fn |  |
| 3943 | `findActionRow` | fn | 定位输入框操作栏（含 voice-mic-wrap 的父容器） |
| 3973 | `findSendButton` | fn | 操作栏最右侧的「圆形可点击」元素才是发送按钮（左侧还可能有增强提示词/停止等圆形按钮） |
| 4001 | `isSendDisabled` | fn | 发送按钮是否处于「禁用」态（输入框为空时官方会禁用它） |
| 4012 | `insertStash` | fn | 新版或旧版内联工具栏存在时放进工具栏；带 voice-mic-wrap 的旧布局保持固定定位。 |
| 4041 | `isComposerAnchorVisible` | fn |  |
| 4050 | `positionExplore` | fn | 探索菜单按钮：位于暂存提示词按钮右侧（与暂存同款圆钮、发送图标，hover 悬浮菜单弹窗） |
| 4057 | `applyThemeButtonColors` | fn | 使用实时主题变量，颜色变化由 CSS 继承处理，无需监听深浅色属性。 |
| 4063 | `positionStash` | fn |  |
| 4130 | `removeStash` | fn |  |
| 4135 | `isWelcomePage` | fn | 用户要求欢迎页不展示暂存提示词按钮（欢迎页输入框只是快速提问入口，不需要暂存）。 |
| 4144 | `shouldShowStash` | fn | 欢迎页一律不显示。 |
| 4150 | `syncStash` | fn |  |
| 4178 | `watchSend` | fn |  |
| 4192 | `watchRow` | fn |  |
| 4211 | `guardSessionChange` | fn | 标签同步只对当前会话生效（syncQueueTags 内按 sessionId 过滤），旧会话的标签由面板重渲染自然清除。 |
| 4220 | `createMessageNavigation` | fn | 会话消息导航：完整索引来自 controller.messageStore，DOM 仅用于判断当前可见位置。 |
| 4254 | `messageText` | fn | （换行、缩进、列表、代码块全靠空白表达），导致详情浮层里全挤成一坨。 |
| 4275 | `ensureRoot` | fn |  |
| 4319 | `position` | fn |  |
| 4340 | `setActive` | fn |  |
| 4351 | `hideTooltip` | fn |  |
| 4362 | `showTooltip` | fn |  |
| 4400 | `render` | fn |  |
| 4418 | `updateActive` | fn |  |
| 4453 | `scheduleActive` | fn |  |
| 4470 | `refreshFromStore` | fn |  |
| 4495 | `unbindStore` | fn |  |
| 4508 | `bindAdapter` | fn |  |
| 4525 | `sync` | fn |  |
| 4575 | `setEnabled` | fn |  |
| 4590 | `turnForButton` | fn |  |
| 4595 | `navigateToTurn` | fn |  |
| 4606 | `dragIndexAt` | fn |  |
| 4617 | `onNavPointerDown` | fn |  |
| 4629 | `onNavPointerMove` | fn |  |
| 4637 | `finishNavDrag` | fn |  |
| 4659 | `onNavPointerUp` | fn |  |
| 4660 | `onNavPointerCancel` | fn |  |
| 4661 | `onPointerOver` | fn |  |
| 4666 | `onPointerOut` | fn |  |
| 4672 | `onFocusIn` | fn |  |
| 4676 | `onFocusOut` | fn |  |
| 4680 | `onClick` | fn |  |
| 4692 | `onKeyDown` | fn |  |
| 4701 | `onWindowChange` | fn |  |
| 4735 | `hideForkTooltip` | fn |  |
| 4736 | `showForkTooltip` | fn |  |
| 4754 | `syncForkButtons` | fn |  |
| 4776 | `scheduleForkButtons` | fn |  |
| 4862 | `wbsPanelShown` | fn | 因此：① 只在可见时做面板内的工作；② 只对「与注入功能相关」的 mutation 反应。 |
| 4868 | `wbsTabActive` | fn |  |
| 4874 | `wbsMutationsRelevant` | fn |  |
| 4891 | `syncGlassComposerTriggerBackgrounds` | fn | 毛玻璃主题下按实际节点写入内联透明背景，并在节点重建时重新应用。 |
| 4912 | `onDomChange` | fn |  |
| 4927 | `onInputSync` | fn |  |
| 4955 | `scheduleDomChange` | fn |  |
| 4989 | `acLimitBannerPresent` | fn |  |
| 5001 | `acLimitWatchTick` | fn |  |
| 5038 | `readFabBottom` | fn |  |
| 5045 | `clampFabBottom` | fn |  |
| 5050 | `clampFabRight` | fn |  |
| 5055 | `applyFabPosition` | fn |  |
| 5068 | `scheduleFabPos` | fn |  |
| 5076 | `positionFab` | fn |  |
| 5094 | `fixWidgetIframeBg` | fn |  |
| 5127 | `syncModernQueueSnapshot` | fn |  |
| 5233 | `dropModernOptimisticItem` | fn |  |
| 5247 | `getModernQueueSnapshot` | fn |  |
| 5262 | `findWbsAdapter` | fn |  |
| 5305 | `get` | method |  |
| 5316 | `bootstrapModernQueueBridge` | fn |  |
| 5329 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 5333 | `probe` | fn |  |
| 5356 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 5368 | `handleModernQueueActionClick` | fn |  |
| 5399 | `stashSigs` | fn |  |
| 5405 | `stashIds` | fn |  |
| 5411 | `recordStashQueueItem` | fn |  |
| 5440 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 5453 | `syncQueueDomIds` | fn |  |
| 5480 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 5511 | `watchQueueOrder` | fn |  |
| 5527 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 5538 | `guardStashedPause` | fn |  |
| 5687 | `enforceStashOrder` | fn |  |
| 5729 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 5734 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 5765 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 5852 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 5870 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 5885 | `enqueueToWorkBuddyQueue` | fn |  |
| 5949 | `crumb` | fn |  |
| 6037 | `maxW` | fn |  |
| 6038 | `maxH` | fn |  |
| 6039 | `apply` | fn |  |
| 6072 | `endDrag` | fn |  |
| 6106 | `preloadAutomationDiscovery` | fn |  |
| 6112 | `findCreditSegment` | fn |  |
| 6121 | `ensureStatusPopover` | fn |  |
| 6132 | `hideStatusPopover` | fn |  |
| 6138 | `positionStatusPopover` | fn |  |
| 6163 | `showStatusPopover` | fn |  |
| 6174 | `creditPopoverHtml` | fn |  |
| 6181 | `hideCreditTooltip` | fn |  |
| 6187 | `showCreditTooltip` | fn |  |
| 6214 | `rotationReminderEnabled` | fn |  |
| 6245 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 6251 | `sync` | fn |  |
| 6290 | `syncOpsDot` | fn |  |
| 6296 | `setOpsFlag` | fn | 供 renderFailoverCard / renderContextAuditCard 回填（函数声明会提升，可以先用后定义） |
| 6303 | `placeOpsPopover` | fn | 不用 fixed —— .wbs-panel 的 backdrop-filter 会把它降格成「相对面板」的绝对定位。 |
| 6317 | `setOpsPopover` | fn |  |
| 6359 | `idleMinutesText` | fn |  |
| 6370 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 6373 | `label` | fn |  |
| 6378 | `data` | fn |  |
| 6384 | `sep` | fn |  |
| 6385 | `gap` | fn |  |
| 6395 | `renderIdleCard` | fn |  |
| 6441 | `refreshIdleCard` | fn |  |
| 6449 | `saveIdleCard` | fn |  |
| 6509 | `failoverClock` | fn |  |
| 6514 | `failoverAccountLabel` | fn |  |
| 6523 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 6536 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 6550 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 6566 | `renderFailoverCard` | fn |  |
| 6612 | `refreshFailoverCard` | fn |  |
| 6661 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 6719 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 6742 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 6745 | `done` | fn |  |
| 6750 | `fallback` | fn |  |
| 6773 | `renderContextAuditCard` | fn |  |
| 6819 | `loadContextAuditCard` | fn |  |
| 6883 | `openAccountOrderModal` | fn |  |
| 6910 | `close` | fn |  |
| 6915 | `drawRows` | fn |  |
| 6924 | `move` | fn |  |
| 6930 | `syncMode` | fn |  |
| 7009 | `setupCreditSummary` | fn |  |
| 7018 | `hide` | fn |  |
| 7019 | `deferHide` | fn |  |
| 7020 | `show` | fn |  |
| 7054 | `openOfficialGrowthCenter` | fn |  |
| 7060 | `confirmCurrentGrowthAccount` | fn |  |
| 7071 | `setupAccountNotePopover` | fn |  |
| 7088 | `trigger` | fn |  |
| 7089 | `dirty` | fn |  |
| 7090 | `update` | fn |  |
| 7097 | `hide` | fn |  |
| 7112 | `position` | fn |  |
| 7124 | `show` | fn |  |
| 7145 | `deferHide` | fn |  |
| 7153 | `submit` | fn |  |
| 7225 | `setupDailyProgressPopover` | fn |  |
| 7232 | `findRing` | fn |  |
| 7240 | `hide` | fn |  |
| 7250 | `deferHide` | fn |  |
| 7260 | `show` | fn |  |
| 7278 | `updateDailyTravelCountdowns` | fn |  |
| 7387 | `setupModelRateLimitPopover` | fn |  |
| 7394 | `findBadge` | fn |  |
| 7402 | `hide` | fn |  |
| 7412 | `deferHide` | fn |  |
| 7422 | `show` | fn |  |
| 7434 | `showSummary` | fn |  |
| 7505 | `closeSecureTransferModal` | fn |  |
| 7509 | `openSecureTransferModal` | fn |  |
| 7548 | `selectedIds` | fn |  |
| 7549 | `syncSelection` | fn |  |
| 7669 | `downloadTransfer` | fn |  |
| 7686 | `readTransferFile` | fn |  |
| 7695 | `copyPlainText` | fn |  |
| 7715 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 7731 | `onConfirm` | method |  |
| 7744 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 7768 | `openAccountImportChoice` | fn |  |
| 7788 | `sync` | fn |  |
| 7810 | `formatTokenCount` | fn |  |
| 7819 | `usageTrendChartHtml` | fn |  |
| 7827 | `usageTrendColors` | fn |  |
| 7834 | `resolveUsageColor` | fn |  |
| 7847 | `usagePieData` | fn |  |
| 7862 | `usagePieHtml` | fn |  |
| 7867 | `percent` | fn |  |
| 7868 | `description` | fn |  |
| 7869 | `legendRow` | fn |  |
| 7896 | `wireUsagePies` | fn |  |
| 7900 | `clear` | fn |  |
| 7905 | `preview` | fn |  |
| 7934 | `usageTrendGroups` | fn |  |
| 7956 | `renderUsageBreakdown` | fn |  |
| 8006 | `renderUsageTrendChart` | fn |  |
| 8078 | `hideTooltip` | fn |  |
| 8079 | `showTooltip` | fn |  |
| 8120 | `usageTimeSegmentHtml` | fn |  |
| 8128 | `onTokenStats` | fn |  |
| 8150 | `closeStats` | fn |  |
| 8179 | `usageDays` | fn |  |
| 8196 | `renderCredits` | fn |  |
| 8230 | `setCreditBusy` | fn |  |
| 8237 | `creditQueryFailed` | fn |  |
| 8244 | `showCreditJob` | fn |  |
| 8264 | `pollCreditJob` | fn |  |
| 8277 | `loadCredits` | fn |  |
| 8327 | `load` | fn | 就失去了入口 ⇒ 死代码里的副本永远看不到，只会与真实现漂移，故摘掉。 |
| 8394 | `perfTableHtml` | fn |  |
| 8431 | `onThinkingPerf` | fn |  |
| 8453 | `closePerf` | fn |  |
| 8467 | `load` | fn | 首屏慢（要扫 traces，首次 3–8 秒）⇒ 先渲染骨架再异步填表，绝不阻塞面板。 |
| 8501 | `wbsIsDarkTheme` | fn | 三维筛选（日期 × 账号 × 模型）与全部图表都在 HTML 内完成（数据内嵌 ⇒ 切筛选零延迟、断网可用）。 |
| 8513 | `onUsageBoard` | fn |  |
| 8546 | `boardUrl` | fn |  |
| 8550 | `closeBoard` | fn |  |
| 8564 | `showOverlay` | fn |  |
| 8565 | `hideOverlay` | fn |  |
| 8566 | `syncSrcBtn` | fn |  |
| 8567 | `loadBoard` | fn |  |
| 8580 | `fmtBoardTime` | fn |  |
| 8583 | `p2` | fn |  |
| 8586 | `generateBoard` | fn |  |
| 8621 | `switchTab` | fn | ===== Tab 切换 ===== |
| 8659 | `buildAutomationPane` | fn |  |
| 8663 | `defaultTask` | fn |  |
| 8666 | `triggerBadgesHtml` | fn |  |
| 8686 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 8694 | `autoProtocolLabel` | fn |  |
| 8698 | `taskStatusLabel` | fn |  |
| 8710 | `lastRunLabel` | fn |  |
| 8716 | `runFor` | fn |  |
| 8717 | `selectedIds` | fn |  |
| 8718 | `allSelected` | fn |  |
| 8719 | `syncBatchControls` | fn |  |
| 8727 | `render` | fn |  |
| 8772 | `load` | fn |  |
| 8775 | `renderExamples` | fn |  |
| 8789 | `loadAgentInfo` | fn |  |
| 8795 | `fuzzyTaskName` | fn |  |
| 8806 | `discoverySourceLabel` | fn |  |
| 8809 | `renderAutomationDiscovery` | fn |  |
| 8854 | `showAutomationDiscoveryGuide` | fn |  |
| 8864 | `showAutomationDiscovery` | fn |  |
| 8902 | `loadAutomationDiscovery` | fn |  |
| 8916 | `exampleById` | fn |  |
| 8919 | `generateAgentTask` | fn |  |
| 8937 | `finishSafetyReview` | fn |  |
| 8946 | `pollSafetyReview` | fn |  |
| 8961 | `startSafetyReview` | fn |  |
| 8972 | `closePanelModal` | fn |  |
| 8978 | `showAutomationConfirm` | fn |  |
| 8986 | `close` | fn |  |
| 8995 | `showAutomationLogs` | fn |  |
| 9022 | `close` | fn |  |
| 9038 | `showEditor` | fn |  |
| 9064 | `syncScheduleFields` | fn |  |
| 9080 | `hideEditor` | fn |  |
| 9081 | `saveEditor` | fn |  |
| 9125 | `isScheduledSendTaskUI` | fn |  |
| 9128 | `schedPad2` | fn |  |
| 9129 | `schedLocalSlot` | fn |  |
| 9132 | `schedDefaultOnceAt` | fn |  |
| 9138 | `schedWhenLabel` | fn |  |
| 9149 | `schedConversationLabel` | fn |  |
| 9160 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 9170 | `hideScheduledSend` | fn |  |
| 9172 | `showScheduledSend` | fn |  |
| 9230 | `whenValue` | fn |  |
| 9238 | `currentRequest` | fn |  |
| 9253 | `syncSummary` | fn |  |
| 9259 | `syncWhen` | fn |  |
| 9266 | `setTarget` | fn |  |
| 9279 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 9294 | `renderConversations` | fn |  |
| 9308 | `loadConversations` | fn |  |
| 9329 | `saveScheduledSend` | fn |  |
| 9405 | `mountAutomationModal` | fn |  |
| 9427 | `showCapabilities` | fn |  |
| 9437 | `showExamples` | fn |  |
| 9446 | `syncDraft` | fn |  |
| 9458 | `exportAutomationTasks` | fn |  |
| 9467 | `importIssueLabel` | fn |  |
| 9477 | `showTaskImport` | fn |  |
| 9493 | `selected` | fn |  |
| 9494 | `syncSelection` | fn |  |
| 9511 | `readAutomationImport` | fn |  |
| 9526 | `startPicker` | fn |  |
| 9538 | `wbsOfficialEsc` | fn |  |
| 9544 | `wbsOfficialCardHTML` | fn |  |
| 9570 | `wbsOfficialEmpty` | fn |  |
| 9574 | `wbsLoadOfficial` | fn |  |
| 9617 | `wbsAgentCardHTML` | fn |  |
| 9645 | `wbsLoadAgent` | fn |  |
| 9803 | `isTaskSessionRecordUI` | fn |  |
| 9808 | `canonicalWorkspaceUI` | fn |  |
| 9825 | `sessionCopyAccountLabel` | fn |  |
| 9831 | `renderSessionCopyProgress` | fn |  |
| 9862 | `scheduleSessionCopyProgressPoll` | fn |  |
| 9866 | `pollActiveSessionCopyJob` | fn |  |
| 9885 | `fmtCostInt` | fn |  |
| 9887 | `renderSessionCostCard` | fn |  |
| 9937 | `copyCurrentConversation` | fn | 取会话控制器复用本地既有 acFindConversationController（与成本卡同一个「当前会话」口径）。 |
| 9963 | `refreshSessionCost` | fn |  |
| 9993 | `startSessionCostPolling` | fn |  |
| 10002 | `stopSessionCostPolling` | fn |  |
| 10009 | `buildSessionsPane` | fn |  |
| 10120 | `renderSessionExport` | fn |  |
| 10139 | `pollSessionExport` | fn |  |
| 10161 | `cloudEls` | fn |  |
| 10173 | `cloudAccountName` | fn |  |
| 10181 | `renderCloudCard` | fn |  |
| 10232 | `checkCloudGhosts` | fn |  |
| 10254 | `runCloudPurge` | fn |  |
| 10283 | `wireCloudCard` | fn |  |
| 10307 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 10338 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 10346 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 10352 | `loadSessions` | fn |  |
| 10388 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 10398 | `canEditAutoCopy` | fn |  |
| 10402 | `sessSyncButton` | fn | 闭包外的变量在切片里不可见，用外部常量会挂。 |
| 10406 | `autoCopyButton` | fn |  |
| 10488 | `activeAutoCopyCount` | fn |  |
| 10494 | `updateSessionSummary` | fn |  |
| 10504 | `updateAutoCopyAllButton` | fn |  |
| 10512 | `toggleAutoCopyAll` | fn |  |
| 10535 | `shortWs` | fn |  |
| 10540 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 10596 | `toggleAutoCopyRule` | fn |  |
| 10627 | `updateAutoCopyButtons` | fn |  |
| 10655 | `updateSessCount` | fn |  |
| 10674 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 10683 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 10703 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 10718 | `wireSessionsPane` | fn |  |
| 10953 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 11007 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 11106 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 11148 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 11195 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 11213 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11237 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 11336 | `selectedSessIds` | fn |  |
| 11339 | `showSessModal` | fn |  |
| 11355 | `buildModelsPane` | fn |  |
| 11386 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 11393 | `modelDetailsHtml` | fn |  |
| 11402 | `modelRowHtml` | fn |  |
| 11440 | `kindLabelOf` | fn |  |
| 11447 | `agentBlockHtml` | fn | 每行底部的「子 Agent」区块。⚠️ 只在「当前模型」tab 显示（备选模型没生效 ⇒ 统计无意义）。 |
| 11492 | `renderAgentSummary` | fn | 顶部汇总条（**只在「当前模型」tab 显示**）。 |
| 11523 | `loadAgentStats` | fn | 拉使用统计（**独立降级**：失败只影响统计区，不影响模型列表）。 |
| 11536 | `saveAgentEntry` | fn | 保存单个模型的子 Agent 声明（改动即存；失败回滚控件）。 |
| 11552 | `loadModels` | fn |  |
| 11576 | `updateModelCounts` | fn |  |
| 11586 | `renderModels` | fn |  |
| 11633 | `updateModelBatchState` | fn |  |
| 11648 | `showModelConfirm` | fn |  |
| 11662 | `closeThirdPartyMenu` | fn |  |
| 11668 | `openThirdPartyModels` | fn |  |
| 11793 | `wireModelsPane` | fn |  |
| 11955 | `findModelBackup` | fn |  |
| 11962 | `openModelEdit` | fn |  |
| 11996 | `buildThemePane` | fn | ===== 主题 pane（构建：头像 + 悬浮机器人 + 主题选择 + WorkDaddy 壁纸）===== |
| 12061 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 12201 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 12220 | `wirePcPane` | fn |  |
| 12253 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 12358 | `syncLangSeg` | fn |  |
| 12385 | `wireTelemetrySettings` | fn |  |
| 12389 | `renderTelemetryState` | fn |  |
| 12427 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 12543 | `updateLogTimestamp` | fn |  |
| 12548 | `appendUpdateLog` | fn |  |
| 12561 | `formatDownloadRate` | fn |  |
| 12567 | `formatDownloadEta` | fn |  |
| 12575 | `formatDownloadTransfer` | fn |  |
| 12588 | `formatUpdateFailure` | fn |  |
| 12602 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 12621 | `openWindowsInstaller` | fn |  |
| 12643 | `showWindowsInstallerReady` | fn |  |
| 12657 | `openWindowsInstallerAfterDownload` | fn |  |
| 12691 | `pollUpdateProgress` | fn |  |
| 12700 | `renderRebootUi` | fn |  |
| 12806 | `syncWallpaperCardVisibility` | fn |  |
| 12819 | `syncThemeTakeoverVisibility` | fn | 关闭接管后只隐藏主题外观选项；头像和悬浮机器人独立于主题接管。 |
| 12829 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 13018 | `gwCardEl` | fn | 面板只负责展示与触发 —— 判据与实现全在 scripts/api-gateway.js。 |
| 13019 | `gwBtn` | fn |  |
| 13024 | `gwRender` | fn |  |
| 13040 | `gwRefresh` | fn |  |
| 13045 | `gwAction` | fn |  |
| 13059 | `buildGatewayCard` | fn |  |
| 13115 | `wireEnhancePane` | fn |  |
| 13148 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 13156 | `loadWallpapers` | fn |  |
| 13264 | `setOpen` | fn |  |
| 13315 | `setupFabDrag` | fn |  |
| 13349 | `finishFabDrag` | fn |  |
| 13379 | `isDragging` | method |  |
| 13412 | `closeLoginModal` | fn |  |
| 13421 | `openLoginChoice` | fn |  |
| 13525 | `startSeamlessLogin` | fn |  |
| 13620 | `loadThemes` | fn |  |
| 13627 | `applyTheme` | fn |  |
| 13635 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 13653 | `openWebsite` | method |  |
| 13658 | `unlockDebug` | method |  |
| 13681 | `getItem` | method |  |
| 13682 | `setItem` | method |  |
| 13683 | `removeItem` | method |  |
| 13695 | `rememberAvatarWrapper` | fn |  |
| 13701 | `rememberAvatarImage` | fn |  |
| 13707 | `restoreAvatarDom` | fn |  |
| 13721 | `svgToPng` | fn | SVG → PNG dataURL |
| 13742 | `applyAvatar` | fn |  |
| 13811 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 13852 | `hexOf` | fn |  |
| 13855 | `mixArr` | fn |  |
| 13856 | `extractPalette` | fn |  |
| 13890 | `imageToTheme` | fn |  |
| 13979 | `syncAskSwitch` | fn |  |
| 14031 | `ndEl` | fn |  |
| 14034 | `ndRefreshCount` | fn |  |
| 14044 | `ndSwitchEl` | fn |  |
| 14049 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 14089 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 14123 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 14139 | `ndTitle` | fn |  |
| 14146 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 14165 | `cleanup` | fn |  |
| 14169 | `onClick` | fn |  |
| 14182 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 14189 | `applyNoDisturbState` | fn |  |
| 14281 | `acLogLine` | fn |  |
| 14286 | `acLog` | fn |  |
| 14296 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 14305 | `acSessionTitle` | fn |  |
| 14313 | `acMonitorLog` | fn |  |
| 14320 | `acScheduleMonitorLogRender` | fn |  |
| 14330 | `acResetState` | fn |  |
| 14362 | `acShowStatus` | fn |  |
| 14368 | `acHideStatus` | fn |  |
| 14373 | `acStartStatusAnim` | fn |  |
| 14374 | `acStopStatusAnim` | fn |  |
| 14377 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 14390 | `acNotifyLimit` | fn |  |
| 14411 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 14428 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 14438 | `acHasCompletionActions` | fn |  |
| 14457 | `acSwitchConversationId` | fn | 读不到就返回空串 —— 不能为了「带上一个 id」把切换本身拖挂。 |
| 14465 | `acHasErrorSignal` | fn |  |
| 14479 | `acLooksTruncated` | fn |  |
| 14487 | `acReplyDecision` | fn |  |
| 14499 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 14515 | `acIsBusy` | fn |  |
| 14520 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 14528 | `acComposerText` | fn |  |
| 14541 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 14557 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 14578 | `acPressEnter` | fn |  |
| 14587 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 14597 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 14614 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 14636 | `acControllerComposerEmpty` | fn |  |
| 14644 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 14691 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 14728 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 14766 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 14814 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 14820 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 14869 | `acCaptureControllerError` | fn |  |
| 14883 | `acRecordModelRateLimit` | fn |  |
| 14910 | `acControllerSnapshot` | fn |  |
| 14968 | `acControllerCheck` | fn |  |
| 15042 | `acBindController` | fn |  |
| 15075 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 15170 | `acScheduleSettle` | fn |  |
| 15183 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 15206 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 15214 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 15227 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 15326 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 15382 | `acStopLegacyMonitor` | fn |  |
| 15403 | `acMultiUpdateStatus` | fn |  |
| 15417 | `acMultiCreateSession` | fn |  |
| 15449 | `acMultiStatusFromResource` | fn |  |
| 15454 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 15482 | `acMultiReconcileSidebar` | fn |  |
| 15515 | `sessionDirtyResourceRecords` | fn |  |
| 15526 | `bindSessionDirtyMonitor` | fn |  |
| 15558 | `acMultiBindSessionResource` | fn |  |
| 15571 | `acMultiUnbindSessionResource` | fn |  |
| 15580 | `acMultiSchedule` | fn |  |
| 15589 | `acMultiSend` | fn |  |
| 15632 | `acMultiCheckSession` | fn |  |
| 15731 | `acMultiBindController` | fn |  |
| 15782 | `acMultiFinishSession` | fn |  |
| 15791 | `acMultiDetachController` | fn |  |
| 15800 | `acMultiProbeSidebarApproval` | fn |  |
| 15857 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 15880 | `acCdpClick` | fn |  |
| 15888 | `acAutoApproveClickItem` | fn |  |
| 15907 | `acAutoApproveItemByTitle` | fn |  |
| 15919 | `acAutoApprovePendingOnce` | fn |  |
| 16057 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 16102 | `acAutoApproveFastStart` | fn |  |
| 16112 | `acAutoApproveFastStop` | fn |  |
| 16116 | `acMultiDiscover` | fn |  |
| 16152 | `acStartMultiMonitor` | fn |  |
| 16171 | `acStopMultiMonitor` | fn |  |
| 16189 | `acStartMonitor` | fn |  |
| 16194 | `acStopMonitor` | fn |  |
| 16200 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 16211 | `acMonitorStatusLabel` | fn |  |
| 16220 | `acMonitorSafeDetail` | fn |  |
| 16232 | `acRenderMonitorLogModal` | fn |  |
| 16284 | `wireAutoContinuePane` | fn |  |
| 16314 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 16481 | `syncAutoContinue` | fn |  |
| 16486 | `applyAutoContinueState` | fn |  |
| 16499 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 16509 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 16515 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 16549 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 16567 | `stopNoDisturbAutoApprove` | fn |  |
| 16572 | `scheduleNdScan` | fn |  |
| 16576 | `ndQueueScanRoot` | fn |  |
| 16596 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 16618 | `ndNormalizeLabel` | fn |  |
| 16622 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 16630 | `ndClassifyApprovalCandidate` | fn |  |
| 16641 | `ndSessionIdForNode` | fn |  |
| 16647 | `ndApprovalContext` | fn |  |
| 16683 | `scanNoDisturbApproval` | fn |  |
| 16713 | `toNdAudit` | fn |  |
| 16721 | `getSleepMode` | fn |  |
| 16726 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 16744 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 16776 | `discoverSleepSessionBusy` | fn |  |
| 16807 | `isAnySessionBusy` | fn |  |
| 16821 | `startUntilDoneCheck` | fn |  |
| 16841 | `stopUntilDoneCheck` | fn |  |
| 16847 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 16887 | `fmtDateTime` | fn | 渲染账号列表 |
| 16894 | `fmtDateTimeSeconds` | fn |  |
| 16901 | `fmtCredits` | fn |  |
| 16908 | `fmtCreditExpiry` | fn |  |
| 16921 | `creditTip` | fn |  |
| 16933 | `creditBarHtml` | fn |  |
| 16950 | `todayUsageHtml` | fn |  |
| 16958 | `accountStatusTagsHtml` | fn |  |
| 16963 | `checkinBadgeHtml` | fn |  |
| 16972 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 16988 | `modelRateLimitTip` | fn |  |
| 16997 | `modelRateLimitBadgeHtml` | fn |  |
| 17009 | `modelRateLimitPopoverHtml` | fn |  |
| 17026 | `modelRateLimitSummaryPopoverHtml` | fn |  |
| 17048 | `creditBlockHtml` | fn |  |
| 17069 | `nearestCreditExpiry` | fn |  |
| 17081 | `sortAccountsByCreditExpiry` | fn |  |
| 17101 | `reorderAccountCards` | fn |  |
| 17114 | `mergeAccountSnapshot` | fn |  |
| 17140 | `dailyProgressLabel` | fn |  |
| 17166 | `dailyRingsSvg` | fn |  |
| 17173 | `dailyRingsHtml` | fn |  |
| 17182 | `formatDailyTravelCountdown` | fn |  |
| 17193 | `dailyTravelCountdownText` | fn |  |
| 17199 | `dailyCatDetail` | fn |  |
| 17218 | `formatGrowthTaskDeadline` | fn |  |
| 17226 | `sortGrowthTasks` | fn |  |
| 17244 | `growthTaskActions` | fn |  |
| 17249 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 17261 | `growthAutoOf` | fn |  |
| 17265 | `growthAutoActionFor` | fn |  |
| 17274 | `startGrowthAuto` | fn |  |
| 17302 | `pollGrowthAuto` | fn |  |
| 17342 | `stopGrowthAutoPoll` | fn |  |
| 17350 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 17364 | `growthTaskRewardHtml` | fn |  |
| 17376 | `dailyProgressPopoverHtml` | fn |  |
| 17520 | `updateDailyProgressCells` | fn |  |
| 17543 | `refreshDailyProgressAccount` | fn |  |
| 17571 | `fetchDailyProgressForAccounts` | fn |  |
| 17598 | `accountCardLayoutKey` | fn |  |
| 17618 | `fmtBytes` | fn |  |
| 17628 | `fmtDuration` | fn |  |
| 17637 | `autoCopyTotalFailed` | fn |  |
| 17648 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 17654 | `autoCopyConflictTitle` | fn |  |
| 17660 | `autoCopyConflictDetail` | fn |  |
| 17670 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 17692 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 17698 | `autoCopyProgressEls` | fn |  |
| 17711 | `hideAutoCopyProgress` | fn |  |
| 17718 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 17823 | `scheduleAutoCopyHide` | fn |  |
| 17845 | `spaceNum` | fn |  |
| 17850 | `spaceShare` | fn |  |
| 17856 | `spaceTimeText` | fn |  |
| 17860 | `pad` | fn |  |
| 17864 | `spaceBaseName` | fn |  |
| 17869 | `spaceScanEls` | fn |  |
| 17886 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 17908 | `hideSpaceScanBox` | fn |  |
| 17914 | `stopSpacePolling` | fn |  |
| 17919 | `spaceJobSub` | fn |  |
| 17926 | `renderSpaceJob` | fn |  |
| 17943 | `spaceRowHtml` | fn |  |
| 17954 | `spaceRestRow` | fn |  |
| 17962 | `renderSpaceEmpty` | fn |  |
| 17979 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 17987 | `spaceSubText` | fn |  |
| 18006 | `spaceSortOf` | fn |  |
| 18014 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 18022 | `spaceSortName` | fn |  |
| 18029 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 18050 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 18068 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 18075 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 18086 | `renderSpaceResult` | fn |  |
| 18203 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 18221 | `scheduleSpacePoll` | fn |  |
| 18229 | `pollSpaceScan` | fn |  |
| 18252 | `startSpaceScan` | fn |  |
| 18273 | `cancelSpaceScan` | fn |  |
| 18285 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 18307 | `buildSpacesPane` | fn |  |
| 18340 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 18406 | `pollAutoCopyJob` | fn |  |
| 18413 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 18423 | `render` | fn |  |
| 18585 | `maskAccountName` | fn |  |
| 18593 | `maskAccountId` | fn |  |
| 18604 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 18630 | `toggleAccountMask` | fn |  |
| 18636 | `refresh` | fn |  |
| 18668 | `updateAccountSummary` | fn |  |
| 18693 | `rotationToday` | fn |  |
| 18698 | `closeRotationNotice` | fn |  |
| 18708 | `showRotationNotice` | fn |  |
| 18734 | `place` | fn |  |
| 18789 | `formatRotationEta` | fn |  |
| 18798 | `formatRotationDuration` | fn |  |
| 18809 | `checkCreditRotationAfterSession` | fn |  |
| 18811 | `run` | fn |  |
| 18833 | `updateCheckinCells` | fn |  |
| 18905 | `fetchActivityForAccounts` | fn |  |
| 18914 | `worker` | fn |  |
| 18965 | `requestCredit` | fn |  |
| 18991 | `updateCreditSummaryFromAccounts` | fn |  |
| 19000 | `refreshCreditForAccount` | fn |  |
| 19032 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 19037 | `settleBatch` | fn |  |
| 19047 | `queryAccount` | fn |  |
| 19098 | `updateCreditCell` | fn |  |
| 19142 | `updateDebugPanel` | fn |  |
| 19162 | `onDebugKey` | fn |  |
| 19171 | `markHealthGeneration` | fn |  |
| 19180 | `isHealthStopControl` | fn |  |
| 19185 | `isHealthSendControl` | fn |  |
| 19276 | `readTokenRateEnabled` | fn | 常开会让用户把估算当精确值；需要时在 面板 → 会话 → token 速度读数 手动打开，一旦手动开过就记住。 |
| 19280 | `writeTokenRateEnabled` | fn |  |
| 19285 | `applyTokenRateEnabled` | fn | 开关变化时立即生效：关 ⇒ 立刻隐藏并停算；开 ⇒ 恢复上一次读数、并重算。 |
| 19301 | `readTokenRatePos` | fn | 读用户拖动后保存的视口坐标；无有效值返回 null。 |
| 19312 | `saveTokenRatePos` | fn |  |
| 19320 | `tokenRateDefaultPos` | fn | 默认位 = 输入框下方空置带左侧、垂直居中。量不到返回 null（下次再试）。 |
| 19332 | `clampTokenRatePos` | fn | 夹进视口（留 4px 边距）。仅在交互 / 定位路径调用。 |
| 19341 | `applyTokenRatePos` | fn |  |
| 19347 | `reuseOrBuildTokenRateEl` | fn | 复用页面上已有的读数节点，否则新建；两者都补挂拖动。 |
| 19376 | `showTokenRateDragShield` | fn |  |
| 19388 | `hideTokenRateDragShield` | fn |  |
| 19398 | `setupTokenRateDrag` | fn | 小框就再也收不到 pointermove。而拖动本来就必须跟手到框外，所以直接吃 window 事件最稳。 |
| 19418 | `onWinMove` | fn |  |
| 19430 | `finishTokenRateDrag` | fn |  |
| 19484 | `readRateEstTokens` | fn | 仍是估算（真实用量只能从 usage 记录拿），但比一刀切贴近。只用 querySelectorAll + textContent，不触发 reflow。 |
| 19509 | `ensureTokenRateEl` | fn | 取（必要时新建）读数节点。常驻 body 直下 + position:fixed；无用户位置时贴输入框下方默认位。 |
| 19520 | `setTokenRateBadge` | fn |  |
| 19546 | `updateTokenRateBadge` | fn |  |
| 19708 | `mdqvT` | fn | 去重不用数组：直接在 tab 元素上打 __wbsAdoptSkip（随元素移除自动回收） |
| 19710 | `mdqvReadEnabled` | fn |  |
| 19713 | `mdqvWriteEnabled` | fn |  |
| 19716 | `mdqvReadAdopt` | fn |  |
| 19719 | `mdqvWriteAdopt` | fn |  |
| 19724 | `mdqvFindPathByName` | fn | 用产物文件名在页面里反查绝对路径（正文产物卡 / 产物面板条目都带 data-dir）。 |
| 19745 | `mdqvAdoptTick` | fn | 成本：一次 querySelector 实测 0.02 ms 级，600 ms 一次 ⇒ 可忽略。 |
| 19765 | `mdqvAdoptStart` | fn |  |
| 19779 | `mdqvFileUrl` | fn | 不编码会因空格/中文导致 fetch 失败；整体 encodeURI 又会把已有的 % 二次编码。 |
| 19791 | `mdqvNormPath` | fn | 「未编码绝对路径」，否则会拼出 file:///file:///… 或中文二次编码。 |
| 19803 | `mdqvShortPath` | fn | 完整路径仍放在 title 里可悬停查看。 |
| 19814 | `mdqvRootRect` | fn | 面板要贴住的区域：整个应用的可见区（#root），拿不到就退回 window。 |
| 19822 | `mdqvDefaultWidth` | fn | 默认宽度：对齐官方文档视图的观感（约内容区 1/3），并夹到可用范围。 |
| 19830 | `mdqvReadWidth` | fn |  |
| 19837 | `mdqvWriteWidth` | fn |  |
| 19850 | `mdqvPlace` | fn |  |
| 19861 | `mdqvDetachShellGuard` | fn |  |
| 19867 | `mdqvReapply` | fn | 重算并写回让位量。观察者与窗口 resize 都走这里。 |
| 19890 | `mdqvAttachShellGuard` | fn | 1936 ⇄ 2296 之间跳（连带把对话区右边缘推过我的面板左边缘）。两个节点都守。 |
| 19906 | `mdqvApplyShift` | fn | 对话区会滑到面板底下。用父容器当前宽度反推，两种状态都自洽。 |
| 19935 | `mdqvRestoreShift` | fn |  |
| 19967 | `wbsHlClass` | fn |  |
| 19976 | `wbsHighlight` | fn | 高亮入口：返回**已转义**的 HTML 片段。 |
| 20009 | `wbsSafeImg` | fn | 其余属性一律丢弃 —— 防止 md 里塞 onerror 之类的注入面。 |
| 20020 | `mdqvInline` | fn | &amp; 当 URL 二次转义」这类双重转义（URL 进属性位一律走 escAttr）。 |
| 20061 | `mdqvRender` | fn | 分隔线 / 行内语法。**刻意不做**数学与 mermaid —— 遇到就给一行提示，不静默丢内容。 |
| 20065 | `flushPara` | fn |  |
| 20070 | `flushQuote` | fn |  |
| 20075 | `flushList` | fn |  |
| 20080 | `flushAll` | fn |  |
| 20081 | `warn` | fn |  |
| 20082 | `closeFence` | fn |  |
| 20096 | `cellsOf` | fn |  |
| 20102 | `alignsOf` | fn |  |
| 20200 | `mdqvCopyText` | fn | 复制文本（面板内代码块的「复制」用；不依赖 mdqvOpen 内的 flash）。 |
| 20228 | `mdqvBindCodeCopy` | fn | 给代码块顶栏的「复制」按钮接线（面板内走真实监听器；导出的离线页走内联脚本）。 |
| 20243 | `mdqvClose` | fn |  |
| 20258 | `mdqvOpen` | fn |  |
| 20466 | `mdqvStandalone` | fn | 跟随系统深色偏好。样式刻意不复用注入页那份（那份依赖 --wb-* 变量，外部没有）。 |
| 20525 | `mdqvInstall` | fn |  |
| 20560 | `registerBuild` | fn |  |
| 20569 | `start` | fn |  |
| 20582 | `destroyWidget` | fn |  |
| 20608 | `readPerfMode` | fn |  |
| 20611 | `applyPerfMode` | fn |  |
| 22049 | `refresh` | method |  |
| 22051 | `getLanguage` | method |  |
| 22052 | `setLanguage` | method |  |

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

## scripts/lib.js  （2289 行 / 120 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 63 | `isWbEncryptedEnvelope` | fn |  |
| 67 | `wdCompatContainsEncryptedFields` | fn |  |
| 75 | `wdCompatText` | fn | 信封字段的展示兜底：取钥不可用时显示占位而非整段密文/[object Object]。 |
| 81 | `wdCompatAuthToken` | fn | 只返回可直接用于 HTTP 的明文 token；信封不可用时返回空字符串。 |
| 87 | `wdCompatHasAuthCredential` | fn |  |
| 93 | `wdCompatLog` | fn |  |
| 100 | `wdCompatConfiguredExe` | fn | 校验的主程序路径；只在 Node/daemon 侧读取，注入到 renderer 的 compat 脚本不会触发。 |
| 115 | `wdCompatWindowsExeCandidates` | fn |  |
| 134 | `wdCompatExeCandidates` | fn |  |
| 157 | `wdCompatStaticKey` | fn |  |
| 184 | `wdCompatOpenEnvelope` | fn |  |
| 186 | `lp` | const |  |
| 187 | `u32` | const |  |
| 199 | `wdCompatDecryptAuthJson` | fn | 原地解密 JSON 中的全部 $wbEncrypted 信封字段；失败字段保留原值，不抛错。 |
| 201 | `walk` | const |  |
| 223 | `samePath` | fn | ===================== [wd-compat] 适配层结束 ===================== |
| 227 | `isLegacyDataDir` | fn |  |
| 246 | `authDir` | fn |  |
| 250 | `safeAuthFileName` | fn |  |
| 256 | `normalizeAuthDomain` | fn |  |
| 267 | `tokenIssuerOrigin` | fn |  |
| 279 | `allowedAuthOrigins` | fn |  |
| 295 | `authRecordFromJson` | fn |  |
| 329 | `parseAuthFile` | fn |  |
| 340 | `parseAuthJson` | fn |  |
| 349 | `normalizeAccountImportJson` | fn |  |
| 372 | `listAuthRecords` | fn |  |
| 387 | `resolveCurrentAuth` | fn |  |
| 401 | `currentAuthFile` | fn |  |
| 405 | `resolveLogoutAuth` | fn |  |
| 418 | `defaultDataDir` | fn |  |
| 425 | `accountsDir` | fn |  |
| 428 | `metaFile` | fn |  |
| 432 | `workbuddyModelsFile` | fn |  |
| 436 | `isManagedProfileDataDir` | fn |  |
| 442 | `migrateLegacyModelBackups` | fn |  |
| 469 | `modelBackupsDir` | fn |  |
| 477 | `maskApiKey` | fn |  |
| 488 | `sanitizeModel` | fn | 模型列表摘要。默认脱敏 apiKey；UI 需要明文展示（模型页 cell / 编辑弹窗）时传 { revealKey: true }。 |
| 503 | `checkinDisplayValue` | fn |  |
| 508 | `readModelsFile` | fn |  |
| 525 | `writeModelsFile` | fn |  |
| 538 | `modelBackupPath` | fn |  |
| 544 | `readModelBackup` | fn |  |
| 555 | `listModelBackups` | fn |  |
| 583 | `listOfficialModels` | fn |  |
| 588 | `readOfficialModel` | fn |  |
| 597 | `deleteOfficialModels` | fn |  |
| 609 | `backupOfficialModel` | fn |  |
| 623 | `writeModelBackup` | fn |  |
| 632 | `copyModelBackup` | fn |  |
| 643 | `editModelBackup` | fn |  |
| 662 | `deleteModelBackups` | fn |  |
| 685 | `enableModelBackup` | fn |  |
| 705 | `modelImportName` | fn |  |
| 709 | `importModels` | fn |  |
| 728 | `readMeta` | fn |  |
| 740 | `writeMeta` | fn |  |
| 750 | `canonicalWorkspace` | fn | 使用稳定路径键，不要求路径当前存在（空间可能已被移动或卸载）。 |
| 762 | `ensureAutoCopyMeta` | fn |  |
| 829 | `readAutoCopyConfig` | fn |  |
| 851 | `autoCopyRuleKey` | fn |  |
| 855 | `getAutoCopyRules` | fn |  |
| 883 | `dedupeAutoCopySessionRows` | fn | row (the SQL callers order newest activity first) for plans and UI counts. |
| 898 | `setAutoCopyAllSessions` | fn |  |
| 906 | `isAutoCopySessionSelected` | fn |  |
| 916 | `setAutoCopyRule` | fn |  |
| 959 | `addLineageMember` | fn |  |
| 966 | `getAutoCopySession` | fn |  |
| 976 | `getAutoCopySessionMembers` | fn | the copier repair stale mappings without creating another row. |
| 997 | `getAutoCopySessionMemberRecords` | fn | not only the account that happened to be active during the switch. |
| 1018 | `selectLatestAutoCopyMember` | fn | files.  Ties are resolved by member order so repeated switches stay stable. |
| 1033 | `ensureAutoCopySessions` | fn |  |
| 1057 | `ensureAutoCopySession` | fn |  |
| 1080 | `collectAutoCopyDuplicates` | fn |  |
| 1097 | `normalizeAutoCopyLineages` | fn |  |
| 1126 | `mergeAutoCopyLineages` | fn |  |
| 1181 | `addAutoCopySessionMember` | fn |  |
| 1203 | `removeAutoCopySessionMember` | fn | intentionally leaves the lineage and other account members intact. |
| 1238 | `pickArchivedCrossAccountTargets` | fn | 「同 lineage 且主账号那份确为 archived」的前置筛选在 daemon 侧 collectArchivedCopyState 完成。 |
| 1309 | `moveAutoCopySession` | fn |  |
| 1328 | `removeAutoCopySession` | fn |  |
| 1369 | `collectLineageMembersForDelete` | fn | 返回 [{ uid, id, lineageId }]；uid 可能为空（脏索引），id 必有值。 |
| 1384 | `addLink` | const |  |
| 1455 | `isAutoCopySuppressed` | fn |  |
| 1466 | `getSuppressedLineagesForTarget` | fn | 避免逐行读 meta。 |
| 1481 | `isAutoCopySuppressedForTarget` | fn | 便捷写法：自己读一次 meta。调用方已经有 config 时用 isAutoCopySuppressed(config, ...) 更省。 |
| 1488 | `setAutoCopySuppression` | fn |  |
| 1505 | `clearAutoCopySuppression` | fn |  |
| 1518 | `clearLineageSuppressions` | fn |  |
| 1554 | `resolveSessionDeletePlan` | fn |  |
| 1567 | `buildLocal` | const |  |
| 1583 | `buildCascade` | const |  |
| 1611 | `removeAutoCopyAccount` | fn |  |
| 1635 | `resolveMappingLineage` | fn |  |
| 1646 | `getAutoCopyMapping` | fn | while all persisted keys use lineageId + targetUid. |
| 1652 | `setAutoCopyMapping` | fn |  |
| 1664 | `deleteAutoCopyMapping` | fn |  |
| 1682 | `getAutoCopyLineageSyncedAt` | fn |  |
| 1701 | `setAutoCopyLineageSyncedAt` | fn |  |
| 1718 | `getAutoCopyJudge` | fn |  |
| 1722 | `setAutoCopyJudge` | fn |  |
| 1733 | `logFile` | fn |  |
| 1736 | `backupPath` | fn |  |
| 1741 | `retireLogoutMarker` | fn | WorkBuddy ignores auth files while this marker exists; retire it after a switch. |
| 1782 | `migrateLegacyDataDir` | fn |  |
| 1827 | `ensureDirs` | fn |  |
| 1838 | `readAuthFile` | fn | 读取登录信息文件并抽取账号关键字段（不返回令牌内容） |
| 1851 | `updateMeta` | fn | 残留 lastLogin 标记，也不得覆盖切换路径建立的绑定关系。 |
| 1876 | `backupAuthFile` | fn |  |
| 1896 | `backupCurrent` | fn | （真实事故：s 账号备份曾被 2026-08-21 存档覆盖成 8-19 的 token）。 |
| 1915 | `resolveAuthTarget` | fn |  |
| 1921 | `sameChannel` | const |  |
| 1956 | `getAccountOrder` | fn | 账号展示顺序保存在 profile 元数据中，不改写登录备份格式。0 表示未排序，排在末尾。 |
| 1960 | `setAccountOrder` | fn |  |
| 1980 | `setAccountNote` | fn | 备注仅写入当前 profile 的元数据，保留认证备份和其他账号设置。 |
| 1992 | `listAccounts` | fn | 列出所有已备份账号（直接读备份文件提取展示字段，按最近刷新时间倒序） |
| 2051 | `deleteAuthFilesForUid` | fn | 的根因：删除只清了 backups 目录，auth 目录里残留的存档会在下一次扫描时复活账号。 |
| 2083 | `deleteAccount` | fn | 永久删除某个账号的备份文件（不影响当前登录） |
| 2125 | `switchTo` | fn | 切换登录账号：把备份文件复制回登录信息文件（先校验 uid 匹配） |

## scripts/win-launcher.js  （1929 行 / 102 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 107 | `log` | fn |  |
| 114 | `sleep` | fn | ---------- 小工具 ---------- |
| 116 | `readApiToken` | fn |  |
| 123 | `localApiHeaders` | fn |  |
| 128 | `readUiPortFile` | fn |  |
| 132 | `writeUiPortFile` | fn |  |
| 141 | `useUiPort` | fn |  |
| 148 | `configureUiPort` | fn |  |
| 173 | `relaunchWithDesktopShell` | fn |  |
| 190 | `runHiddenPowerShell` | fn |  |
| 219 | `showWindowsMessageBox` | fn |  |
| 225 | `showWindowsNotification` | fn |  |
| 236 | `powershellQuote` | fn |  |
| 240 | `reportAndExit` | fn |  |
| 245 | `validCdpPort` | fn |  |
| 249 | `readCdpPortFile` | fn |  |
| 256 | `writeCdpPortFile` | fn |  |
| 265 | `cdpPortCandidates` | fn |  |
| 268 | `add` | const |  |
| 276 | `portOpen` | fn |  |
| 285 | `isLocalPortAvailable` | fn |  |
| 289 | `finish` | const |  |
| 304 | `reserveEphemeralCdpPort` | fn |  |
| 308 | `finish` | const |  |
| 321 | `httpGet` | fn |  |
| 333 | `httpPost` | fn |  |
| 347 | `isWorkBuddyCdp` | fn |  |
| 351 | `isWorkBuddyCdpAt` | fn |  |
| 370 | `configureCdpPort` | fn |  |
| 402 | `strictPowerShellLines` | fn |  |
| 412 | `bestEffortPowerShellLines` | fn |  |
| 421 | `powershellLiteral` | fn |  |
| 426 | `getWorkBuddyProcesses` | fn | 通过 CIM 查询当前 profile 主程序的路径、父 PID 和命令行；命令行正文绝不写入日志/Sentry。 |
| 445 | `daemonRunning` | fn | 仅保留为本地端口诊断；daemon 启动成功必须走 exactDaemonStatus 完整身份校验。 |
| 449 | `isPrewarmProcess` | fn |  |
| 453 | `workBuddyProcesses` | fn |  |
| 468 | `tasklistProcessIds` | fn | 只读诊断：tasklist 结果仅写入失败快照，绝不进入任何 taskkill 参数或退出判定。 |
| 484 | `processCdpPort` | fn |  |
| 490 | `processHasCdpArg` | fn |  |
| 494 | `processDiagnostics` | fn |  |
| 515 | `logProcessDiagnostics` | fn |  |
| 523 | `requireWorkBuddyClosedBeforeLaunch` | fn | 通过 quitWorkBuddy() 对当前 profile 的已验证进程做精确重启。 |
| 539 | `readDaemonVersion` | fn |  |
| 547 | `readDaemonIdentity` | fn |  |
| 560 | `findNode` | fn | ---------- 定位 node（安装包内置优先，WorkBuddy 托管运行时次之，最后 PATH） ---------- |
| 600 | `findWorkBuddy` | fn |  |
| 602 | `tryFile` | const |  |
| 627 | `addCandidate` | const |  |
| 684 | `psLiteral` | const |  |
| 706 | `listenerPids` | fn |  |
| 722 | `queryNodeProcesses` | fn |  |
| 749 | `uniqueNodeProcess` | fn |  |
| 759 | `readWatchdogPid` | fn |  |
| 771 | `watchdogState` | fn |  |
| 829 | `validateDaemonProcess` | fn |  |
| 841 | `exactDaemonStatus` | fn |  |
| 858 | `readStatus` | fn |  |
| 865 | `authenticatedElevatedDaemonStatus` | fn |  |
| 877 | `waitForExactDaemon` | fn |  |
| 891 | `killVerifiedNodeProcess` | fn |  |
| 911 | `authorizeDaemonTermination` | fn |  |
| 924 | `removeWatchdogPidIf` | fn |  |
| 931 | `stopDaemonByPort` | fn |  |
| 975 | `ensureDaemon` | fn |  |
| 1044 | `workBuddyRunning` | fn | ---------- 2/3. WorkBuddy CDP 处理 ---------- |
| 1048 | `runTaskkill` | fn |  |
| 1052 | `finish` | const |  |
| 1065 | `waitForWorkBuddyExit` | fn |  |
| 1074 | `exitSnapshot` | fn |  |
| 1082 | `killForExit` | fn |  |
| 1099 | `killVerifiedWorkBuddyProcess` | fn |  |
| 1117 | `quitWorkBuddy` | fn |  |
| 1156 | `launchWorkBuddy` | fn |  |
| 1181 | `waitForWorkBuddyCdp` | fn |  |
| 1188 | `start` | const |  |
| 1249 | `findNextAvailableCdpPort` | fn |  |
| 1258 | `injectNow` | fn |  |
| 1287 | `injectNowOrPending` | fn |  |
| 1298 | `hasElevatedSessionConsent` | fn |  |
| 1306 | `nativeHelperPath` | fn |  |
| 1310 | `runNativeHelper` | fn |  |
| 1326 | `nativeWorkBuddyProcessSummary` | fn |  |
| 1349 | `nativeWorkBuddyDiscoverySummary` | fn |  |
| 1353 | `nativeWorkBuddyRunning` | fn |  |
| 1360 | `stopNativeWorkBuddy` | fn |  |
| 1391 | `isAccessDeniedStopError` | fn |  |
| 1408 | `tryStopNativeWorkBuddy` | fn |  |
| 1423 | `findWorkBuddyNative` | fn |  |
| 1435 | `add` | const |  |
| 1519 | `stopVerifiedLegacyManagedLifecycle` | fn |  |
| 1527 | `nativeDaemonDiagnostics` | fn |  |
| 1566 | `nativeCdpDiagnostics` | fn |  |
| 1591 | `nativeDaemonStatusMatches` | fn |  |
| 1608 | `waitForNativeDaemon` | fn |  |
| 1627 | `stopNativeLifecycle` | fn |  |
| 1637 | `ensureDaemonNative` | fn |  |
| 1654 | `startWatchdog` | const |  |
| 1667 | `waitWithProgress` | const |  |
| 1692 | `waitForWorkBuddyCdpNative` | fn |  |
| 1695 | `start` | const |  |
| 1748 | `nativeLaunchFailed` | fn |  |
| 1755 | `nativeStartupMain` | fn |  |

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

## scripts/session-sync.js  （1116 行 / 51 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 34 | `canonicalTranscriptRecord` | fn | fields so an account round-trip does not become a false content conflict. |
| 46 | `canonical` | fn |  |
| 56 | `safePath` | fn |  |
| 68 | `safePathAsync` | fn |  |
| 84 | `readSessionSizes` | fn | concurrent scans, never the size/file count of a session itself. |
| 92 | `stat` | fn |  |
| 99 | `base` | fn |  |
| 108 | `visit` | fn |  |
| 147 | `aliasesEqual` | fn |  |
| 159 | `readSnapshot` | fn | only when computed for the same aliases. |
| 174 | `safePathFast` | fn |  |
| 186 | `attachBytes` | fn |  |
| 202 | `cached` | fn |  |
| 210 | `visit` | fn |  |
| 315 | `validSessionId` | fn |  |
| 319 | `sameFileStat` | fn |  |
| 324 | `hashFileAsync` | fn |  |
| 336 | `readStableBytesAsync` | fn |  |
| 343 | `readTranscriptAsync` | fn |  |
| 390 | `readSnapshotAsync` | fn |  |
| 401 | `safePathFastAsync` | fn |  |
| 417 | `cached` | fn |  |
| 426 | `visit` | fn |  |
| 527 | `readSessionFingerprintAsync` | fn | workspace backup directories are excluded because they are local-only data. |
| 533 | `addStat` | const |  |
| 544 | `addDirectoryChildren` | const |  |
| 578 | `readSessionQuickFingerprintAsync` | fn | catches file creation/removal without enumerating every project/session file. |
| 582 | `add` | const |  |
| 616 | `compareSnapshots` | fn |  |
| 642 | `selectTargetSnapshot` | fn | only hashes while scanning, so duplicate workspaces do not accumulate in RAM. |
| 684 | `longestFirst` | const |  |
| 701 | `unchanged` | fn |  |
| 706 | `removeSyncBackup` | fn |  |
| 710 | `removeSyncBackupAsync` | fn |  |
| 717 | `pruneSyncBackups` | fn | when the daemon starts so old versions cannot grow the data directory forever. |
| 747 | `inspectSyncBackups` | fn | contents never leave the machine and are never included in the response. |
| 752 | `sizeOf` | const |  |
| 785 | `targetRelative` | fn |  |
| 789 | `changedTargetFiles` | fn |  |
| 807 | `rebindTranscriptLine` | fn | message IDs and user text can legitimately contain the same string. |
| 838 | `reboundTranscriptInfo` | fn |  |
| 848 | `targetBytes` | fn |  |
| 864 | `applySnapshot` | fn |  |
| 893 | `save` | const |  |
| 901 | `verifyPublished` | const |  |
| 966 | `unchangedAsync` | fn |  |
| 972 | `targetBytesAsync` | fn |  |
| 985 | `existingHashAsync` | fn |  |
| 990 | `applySnapshotAsync` | fn |  |
| 1032 | `save` | const |  |
| 1040 | `verifyPublished` | const |  |

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

合计 **1982** 个函数。
