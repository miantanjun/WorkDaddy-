# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-09-22 11:31:12
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （16113 行 / 542 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 55 | `resolveDaemonPrivilege` | fn |  |
| 251 | `readAutomationsTolerant` | fn |  |
| 591 | `persistScheduleLedger` | fn |  |
| 601 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 621 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 641 | `scheduleVerifyNotify` | fn |  |
| 651 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 658 | `nameOf` | const |  |
| 701 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 702 | `valid` | const |  |
| 727 | `diagnosticsEnabled` | fn |  |
| 735 | `redactDiagnosticText` | fn |  |
| 748 | `shouldPersistBreadcrumb` | fn |  |
| 754 | `validCdpPort` | fn |  |
| 758 | `readCdpPortFile` | fn |  |
| 767 | `writeCdpPortFile` | fn |  |
| 782 | `readUiPortFile` | fn |  |
| 786 | `writeUiPortFile` | fn |  |
| 801 | `cdpPortCandidates` | fn |  |
| 803 | `add` | const |  |
| 811 | `isLocalPortAvailable` | fn |  |
| 815 | `finish` | const |  |
| 830 | `findAvailableCdpPort` | fn |  |
| 837 | `selectCdpPort` | fn |  |
| 913 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 918 | `updateDebug` | fn |  |
| 919 | `scrub` | const |  |
| 949 | `writeUpdateAttempt` | fn |  |
| 960 | `macWorkDaddyAppPath` | fn |  |
| 983 | `resolveApplyUpdateVbs` | fn |  |
| 1002 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1015 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1027 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1056 | `githubAuthHeaders` | fn |  |
| 1066 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1090 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1092 | `fileName` | const |  |
| 1097 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1111 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1120 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1134 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1144 | `normalizeAssetSha256` | fn |  |
| 1149 | `expectedUpdateSha256` | fn |  |
| 1154 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1191 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1235 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1294 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1327 | `readUpstreamCache` | const |  |
| 1375 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1383 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1409 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1418 | `downloadUpdateInternal` | fn |  |
| 1476 | `cleanupTemp` | const |  |
| 1478 | `failDownload` | const |  |
| 1564 | `sha256File` | fn | 计算文件 SHA-256 |
| 1568 | `inspectPackagedApp` | fn |  |
| 1585 | `packagedAppVersionError` | fn |  |
| 1599 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 1653 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 1661 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 1701 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 1768 | `scheduleOAuthStateCleanup` | fn |  |
| 1774 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 1795 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 1824 | `accData` | const |  |
| 1836 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 1884 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 1909 | `markAttemptFailure` | const |  |
| 1918 | `markSpawnFailure` | const |  |
| 2040 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2055 | `log` | fn |  |
| 2066 | `isLockPermissionError` | fn |  |
| 2070 | `reportDaemonLockFallback` | fn |  |
| 2080 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2115 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2172 | `releaseDaemonLock` | fn |  |
| 2185 | `scheduleBackup` | fn |  |
| 2253 | `settlePendingReloadInjection` | fn |  |
| 2265 | `armPendingReloadInjection` | fn |  |
| 2287 | `runPendingReloadInjection` | fn |  |
| 2314 | `findCdpEndpoint` | fn |  |
| 2323 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2358 | `targetsBelongToProfile` | fn |  |
| 2378 | `isWorkBuddyCdpTarget` | fn |  |
| 2384 | `getPageTarget` | fn |  |
| 2390 | `cleanupForeignInjectedTargets` | fn |  |
| 2398 | `cleanupForeignInjectedTarget` | fn |  |
| 2407 | `finish` | const |  |
| 2450 | `cdpFocusDiagnostics` | fn |  |
| 2464 | `cdpMouseClick` | fn |  |
| 2487 | `cdpSend` | fn |  |
| 2505 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2506 | `raw` | const |  |
| 2518 | `connectCdp` | fn |  |
| 2595 | `waitForPageReadyThenDispatch` | fn |  |
| 2597 | `retry` | const |  |
| 2610 | `dispatchAutomationEvent` | fn |  |
| 2646 | `onCdpEvent` | fn |  |
| 2649 | `url` | const |  |
| 2730 | `cdpLoop` | fn |  |
| 2743 | `reloadWorkBuddyPage` | fn |  |
| 2745 | `withTimeout` | const |  |
| 2787 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 2910 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 2924 | `resolveWorkBuddyBinary` | fn |  |
| 2927 | `tryFile` | const |  |
| 2939 | `psCmd` | const |  |
| 2968 | `addCandidate` | const |  |
| 3012 | `psQuote` | const |  |
| 3029 | `runCommand` | fn |  |
| 3036 | `finish` | const |  |
| 3060 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3089 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3105 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3122 | `linuxWorkBuddyPids` | fn |  |
| 3146 | `workBuddyRunning` | fn |  |
| 3163 | `waitForWorkBuddyExit` | fn |  |
| 3178 | `waitForWorkBuddyExitTolerant` | fn |  |
| 3190 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 3236 | `detail` | const |  |
| 3268 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 3294 | `resolveLauncherHome` | fn |  |
| 3304 | `resolveLinuxLaunchTarget` | fn |  |
| 3319 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 3398 | `clickByText` | fn |  |
| 3444 | `findByText` | fn |  |
| 3473 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 3479 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 3482 | `claimLog` | fn |  |
| 3490 | `sleep` | fn |  |
| 3495 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 3542 | `automationStateFile` | const |  |
| 3543 | `readAutomationState` | fn |  |
| 3546 | `writeAutomationState` | fn |  |
| 3552 | `automationAccountStatus` | fn |  |
| 3586 | `automationDeepLocatorExpression` | fn |  |
| 3601 | `first` | fn |  |
| 3606 | `choose` | fn |  |
| 3607 | `firstByAttribute` | fn |  |
| 3617 | `automationDomAction` | fn |  |
| 3618 | `assertActive` | const |  |
| 3626 | `read` | const |  |
| 3682 | `automationHttpRequest` | fn |  |
| 3705 | `automationPublicRun` | fn |  |
| 3713 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 3724 | `automationPanelSetOpen` | fn |  |
| 3732 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 3741 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 3754 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 3769 | `automationNotifyToast` | fn |  |
| 3799 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 3800 | `assertAutoCopySucceeded` | fn |  |
| 3806 | `recordAccountSyncResult` | fn |  |
| 3818 | `assertAccountSwitchIdle` | fn |  |
| 3824 | `automationSwitchProgress` | fn |  |
| 3832 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 3849 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 3855 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 3902 | `limitFailoverManualPublic` | fn |  |
| 3921 | `readLimitFailoverState` | fn |  |
| 3930 | `writeLimitFailoverState` | fn |  |
| 3941 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 3955 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 3971 | `runCdpExpression` | fn |  |
| 3982 | `readLimitBanner` | fn |  |
| 3986 | `readLiveModel` | fn |  |
| 3990 | `setLiveModel` | fn |  |
| 3994 | `readLastUserTaskText` | fn |  |
| 4002 | `readFailoverSnapshot` | fn |  |
| 4018 | `pickWorkbuddyDaemonClient` | fn |  |
| 4020 | `walk` | fn |  |
| 4057 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4072 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4089 | `edgeSyncMappingDbPath` | fn |  |
| 4104 | `getEdgeSyncDb` | fn |  |
| 4117 | `readEdgeSyncRows` | fn |  |
| 4130 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4156 | `probeCloudConversations` | fn |  |
| 4183 | `collectCloudGhosts` | fn |  |
| 4221 | `purgeCloudConversations` | fn |  |
| 4255 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 4272 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 4290 | `purgeCloudGhostsSwitching` | fn |  |
| 4299 | `switchBack` | const |  |
| 4340 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 4350 | `limitReplyStarted` | fn |  |
| 4355 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 4362 | `findLimitFailoverTask` | fn |  |
| 4366 | `runningLimitFailoverRun` | fn |  |
| 4370 | `waitLimitVerdict` | fn |  |
| 4395 | `runLimitFailoverCore` | fn |  |
| 4426 | `hits` | const |  |
| 4656 | `buildLimitFailoverPorts` | fn |  |
| 4724 | `limitFailoverDesktopLogDir` | fn |  |
| 4733 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 4747 | `limitFailoverNotify` | fn |  |
| 4755 | `readLimitReplyIdle` | fn |  |
| 4759 | `limitFailoverAccountByUid` | fn |  |
| 4765 | `limitFailoverPrimaryUid` | fn |  |
| 4773 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 4779 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 4788 | `cancelLimitFailoverSwitchBack` | fn |  |
| 4801 | `limitFailoverPlanCancelled` | fn |  |
| 4805 | `finishLimitFailoverSwitchBack` | fn |  |
| 4828 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 4843 | `runLimitFailoverSwitchBack` | fn |  |
| 4844 | `isCancelled` | const |  |
| 4845 | `elapsedMs` | const |  |
| 4846 | `stopIfUnsafe` | const |  |
| 4966 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5001 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5063 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5073 | `readSessionActivity` | fn |  |
| 5078 | `idleSwitchbackPublicState` | fn |  |
| 5111 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 5171 | `idleSwitchbackTick` | fn |  |
| 5230 | `startIdleSwitchbackTicker` | fn |  |
| 5242 | `automationSwitchAccount` | fn |  |
| 5300 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 5307 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 5325 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 5338 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 5361 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 5373 | `automationAccountSwitchGuarded` | fn |  |
| 5395 | `startAutomationRun` | fn |  |
| 5411 | `isCancelled` | const |  |
| 5414 | `appendRunLog` | const |  |
| 5425 | `panelPrepare` | const |  |
| 5437 | `withInput` | const |  |
| 5454 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 5459 | `readSession` | const |  |
| 5464 | `sessionAction` | const |  |
| 5472 | `openedUid` | const |  |
| 5503 | `accountUid` | const |  |
| 5599 | `completionReport` | const |  |
| 5626 | `publicAccounts` | const |  |
| 5627 | `publicCurrent` | const |  |
| 5630 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 5698 | `resumeAutomationAfterNavigation` | fn |  |
| 5709 | `todayStr` | fn |  |
| 5711 | `z` | const |  |
| 5715 | `loadCheckinCache` | fn |  |
| 5722 | `saveCheckinCache` | fn |  |
| 5731 | `refreshAccountBackupToken` | fn | 刷新备份账号凭证：临期惰性刷新，或距上次刷新超过一天时执行保活。 |
| 5770 | `dailyCheckin` | fn |  |
| 5819 | `claimDailyForUid` | fn |  |
| 5828 | `performAccountCheckin` | fn |  |
| 5874 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 5938 | `desc` | const |  |
| 5983 | `buildInjectScript` | fn |  |
| 6020 | `injectWidgetManual` | fn |  |
| 6028 | `readCdpTargets` | fn |  |
| 6039 | `readLogTail` | fn |  |
| 6050 | `collectDiagnostics` | fn |  |
| 6075 | `writeDiagnosticsSnapshot` | fn |  |
| 6096 | `sqliteRun` | fn |  |
| 6102 | `codeBuddySessionRows` | fn |  |
| 6117 | `sqlParamAt` | fn |  |
| 6120 | `sqliteQuery` | fn |  |
| 6165 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 6184 | `createDirectoryNoFollow` | fn |  |
| 6203 | `repairMissingSessionWorkspaces` | fn |  |
| 6229 | `sessionRangeMs` | fn |  |
| 6246 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 6250 | `copyOne` | const |  |
| 6366 | `sessionBodyMtime` | fn |  |
| 6383 | `sessionContentMtime` | fn |  |
| 6387 | `visit` | const |  |
| 6421 | `directoryStats` | fn |  |
| 6450 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 6461 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 6487 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 6502 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 6513 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 6533 | `sortAutoCopyPlanBySize` | fn |  |
| 6552 | `readCopyManifestCache` | fn |  |
| 6563 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 6572 | `deriveCopyManifestFromCache` | fn |  |
| 6599 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 6610 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 6632 | `emptyWorkspaceCounters` | fn |  |
| 6640 | `transferWorkspaceTree` | fn |  |
| 6648 | `copyFileAt` | const |  |
| 6741 | `copySessionWorkspacePayload` | fn |  |
| 6763 | `outcome` | const |  |
| 6775 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 6796 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 6915 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 6937 | `forcedSource` | const | 真分叉下「最新」并不等于「用户想要的那份」，按时间选会静默丢另一边的内容。 |
| 6949 | `trackPayload` | const |  |
| 7082 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 7113 | `listAutoCopyConflicts` | fn |  |
| 7126 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 7140 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 7166 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 7266 | `readNativeDeleteSweep` | fn |  |
| 7273 | `saveNativeDeleteSweep` | fn |  |
| 7286 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 7293 | `sweepNativeSessionDeletes` | fn |  |
| 7365 | `readArchiveIsolation` | fn |  |
| 7372 | `saveArchiveIsolation` | fn |  |
| 7386 | `archiveIsolationEnabled` | fn |  |
| 7391 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 7407 | `members` | const |  |
| 7428 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 7472 | `purgeLocalSessionCopyCore` | fn |  |
| 7504 | `purgeArchivedCrossAccountCopies` | fn |  |
| 7554 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 7629 | `summarizeSessionImportErrors` | fn |  |
| 7639 | `archiveRelativePath` | fn |  |
| 7643 | `collectSessionArchiveFiles` | fn |  |
| 7646 | `collect` | const |  |
| 7686 | `ensureArchiveParentNoFollow` | fn |  |
| 7705 | `restoreSessionArchiveFiles` | fn |  |
| 7728 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 7759 | `getSessionSyncCache` | fn |  |
| 7782 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 7798 | `isTaskSessionRecord` | fn |  |
| 7803 | `sqlPlaceholders` | fn |  |
| 7807 | `insertCopiedSession` | fn |  |
| 7837 | `createForkSession` | fn |  |
| 7870 | `exportSessions` | fn |  |
| 7896 | `validImportedSessionUid` | fn |  |
| 7902 | `importSessions` | fn |  |
| 7906 | `importSessionArchives` | fn |  |
| 7954 | `adoptExistingCopyTarget` | fn |  |
| 7998 | `copySessionRecord` | fn |  |
| 8015 | `perform` | const |  |
| 8120 | `buildAutoCopyPlan` | fn |  |
| 8177 | `isAutoCopyPausedError` | fn |  |
| 8184 | `beginRendererReloadPriority` | fn |  |
| 8199 | `hasPendingAutoCopyTo` | fn |  |
| 8208 | `pruneAutoCopyJobs` | fn |  |
| 8218 | `runAutoCopyQueue` | fn |  |
| 8248 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 8275 | `resolveSyncNowSources` | fn |  |
| 8276 | `all` | const |  |
| 8312 | `limitFailoverSyncWaitMs` | fn |  |
| 8347 | `openConversationById` | fn |  |
| 8397 | `sidebarProbe` | const |  |
| 8567 | `prepareFailoverContinuation` | fn |  |
| 8573 | `degrade` | const |  |
| 8675 | `startAutoCopyJob` | fn |  |
| 8744 | `run` | const |  |
| 8752 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 9018 | `activeAutoCopyJob` | fn |  |
| 9031 | `publicAutoCopyJob` | fn |  |
| 9113 | `publicSpaceScanJob` | fn |  |
| 9137 | `buildSpaceScanResolvers` | fn |  |
| 9183 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 9195 | `startSpaceScanJob` | fn |  |
| 9285 | `isValidSessionId` | fn |  |
| 9294 | `matchedSessionIds` | fn |  |
| 9299 | `resolveManagedSessionTarget` | fn |  |
| 9312 | `isManagedDirectoryNoFollow` | fn |  |
| 9336 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 9370 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 9376 | `delOne` | const |  |
| 9420 | `json` | fn |  |
| 9449 | `isAllowedApiOrigin` | fn |  |
| 9469 | `hasApiToken` | fn |  |
| 9476 | `isApiRequestAuthorized` | fn |  |
| 9485 | `isAllowedDevtoolsOrigin` | fn |  |
| 9525 | `readBody` | fn |  |
| 9530 | `ignoreLateError` | const |  |
| 9531 | `cleanup` | const |  |
| 9541 | `finish` | const |  |
| 9547 | `fail` | fn |  |
| 9553 | `onData` | fn |  |
| 9566 | `onEnd` | fn |  |
| 9577 | `onError` | fn |  |
| 9580 | `onIncomplete` | fn |  |
| 9612 | `workbuddySettingsPath` | fn |  |
| 9616 | `readWorkbuddySettings` | fn |  |
| 9624 | `writeWorkbuddySettings` | fn |  |
| 9630 | `buildAskRuleBlock` | fn |  |
| 9635 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 9645 | `getAskModeState` | fn |  |
| 9647 | `customPrompt` | const |  |
| 9660 | `setAskMode` | fn |  |
| 9675 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 9701 | `readNoDisturbState` | fn |  |
| 9704 | `state` | const |  |
| 9710 | `removeListItems` | fn |  |
| 9716 | `ensureSandboxObj` | fn |  |
| 9725 | `applyNoDisturbSwitch` | fn |  |
| 9729 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 9735 | `rollback` | const |  |
| 9783 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 9798 | `noDisturbAudit` | fn |  |
| 9833 | `acAppConfigPath` | fn |  |
| 9836 | `readAppConfig` | fn |  |
| 9844 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 9849 | `acBlock` | fn |  |
| 9856 | `stripACBlocks` | fn |  |
| 9862 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 9868 | `acCustomPromptPresent` | fn |  |
| 9873 | `readAutoContinueState` | fn |  |
| 9888 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 9905 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 9919 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 9936 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 9956 | `sessBuild` | fn |  |
| 9963 | `readSessionState` | fn |  |
| 9965 | `ns` | const |  |
| 9966 | `st` | const |  |
| 9998 | `writeSessionState` | fn |  |
| 10000 | `prior` | const |  |
| 10009 | `setSessionSwitch` | fn |  |
| 10017 | `addQuickPhrase` | fn |  |
| 10029 | `updateQuickPhrase` | fn |  |
| 10039 | `deleteQuickPhrases` | fn |  |
| 10046 | `normalizeQuickPhraseIds` | fn |  |
| 10058 | `exportQuickPhrases` | fn |  |
| 10074 | `importQuickPhrases` | fn |  |
| 10099 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 10108 | `selectAutomationModelById` | fn |  |
| 10121 | `confirmAutomationModel` | fn |  |
| 10129 | `restoreAutomationNewTaskPreference` | fn |  |
| 10137 | `automationAgentSurfaceExpression` | fn |  |
| 10139 | `visible` | fn |  |
| 10140 | `isNewTask` | fn |  |
| 10141 | `composerText` | fn |  |
| 10168 | `readAutomationAgentSurface` | fn |  |
| 10176 | `ensureAutomationNewTask` | fn |  |
| 10236 | `openNewAutomationAgentTask` | fn |  |
| 10255 | `currentAccount` | fn |  |
| 10261 | `a` | const |  |
| 10290 | `readAccountHealth` | fn |  |
| 10298 | `writeAccountHealth` | fn |  |
| 10314 | `recordAccountHealth` | fn |  |
| 10330 | `mergeLiveHealth` | fn |  |
| 10350 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 10358 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 10375 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 10394 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 10410 | `sweepAccountHealth` | fn |  |
| 10429 | `buildFailoverHealthFilter` | fn |  |
| 10442 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 10452 | `accountHealthEcho` | fn |  |
| 10465 | `accountBackupFile` | fn |  |
| 10475 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 10480 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 10485 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 10512 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 10518 | `stashRecordByKey` | fn |  |
| 10525 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 10553 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 10576 | `buildBusyExpr` | fn |  |
| 10600 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 10611 | `busy` | const |  |
| 10639 | `builtinAssetsDir` | fn |  |
| 10655 | `builtinWallpaperSource` | fn |  |
| 10664 | `initBuiltinAssets` | fn |  |
| 10899 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 10926 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 10947 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 10989 | `loadThemePatches` | fn |  |
| 11005 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 11017 | `loadThemeVars` | fn |  |
| 11033 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 11037 | `declOf` | const |  |
| 11047 | `lead` | const |  |
| 11055 | `readBackgroundBlur` | fn |  |
| 11066 | `applyThemeByCdp` | fn |  |
| 11071 | `uid` | const |  |
| 11073 | `colors` | const |  |
| 11172 | `wbsSyncAppearanceKeys` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 11191 | `wbsSyncNativeTheme` | fn |  |
| 11241 | `keepSelectedTheme` | fn |  |
| 11304 | `clearComposerByCdp` | fn |  |
| 11357 | `fnv1a32` | fn |  |
| 11374 | `composerDraftHash` | fn |  |
| 11391 | `composerDraftExpr` | fn |  |
| 11431 | `composerDraftConsumed` | fn |  |
| 11462 | `composerSendExpr` | const |  |
| 11466 | `fiberOf` | fn |  |
| 11474 | `isStore` | fn |  |
| 11531 | `sendStashToComposer` | fn |  |
| 11537 | `guardedSend` | const |  |
| 11540 | `allItems` | const |  |
| 11549 | `s` | const |  |
| 11702 | `countBlocks` | const |  |
| 11712 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 11758 | `name` | const |  |
| 11774 | `disp` | const |  |
| 11785 | `visible` | fn |  |
| 11857 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 11871 | `readDraft` | const |  |
| 11879 | `draftConsumed` | const |  |
| 11882 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 11979 | `fetchResource` | fn |  |
| 12013 | `data` | const |  |
| 12016 | `accounts` | const |  |
| 12048 | `fetchEnterpriseResource` | fn |  |
| 12094 | `robustFetchEnterpriseResource` | fn |  |
| 12117 | `resolveEnterpriseId` | fn |  |
| 12145 | `retryDelay` | const |  |
| 12149 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 12181 | `fetchCredits` | fn |  |
| 12239 | `refreshCreditRotationAccounts` | fn |  |
| 12263 | `rememberCreditRotation` | fn |  |
| 12275 | `cachedCreditRotationAccounts` | fn |  |
| 12287 | `listDailyUsage` | fn |  |
| 12293 | `syncCurrentCreditUsage` | fn |  |
| 12296 | `task` | const |  |
| 12337 | `exportSecretKey` | fn |  |
| 12341 | `decryptLegacyExport` | fn |  |
| 12352 | `handleApiRoute` | fn |  |
| 12655 | `currentHealth` | const |  |
| 13183 | `uid` | const |  |
| 13246 | `d` | const |  |
| 13444 | `uid` | const |  |
| 13688 | `worker` | const |  |
| 13725 | `uid` | const |  |
| 14308 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 14582 | `run` | const |  |
| 14802 | `targetUid` | const |  |
| 14831 | `targetUid` | const |  |
| 15171 | `id` | const |  |
| 15457 | `uid` | const |  |
| 15458 | `conv` | const |  |
| 15459 | `safe` | const |  |
| 15465 | `items` | const |  |
| 15528 | `key` | const |  |
| 15541 | `key` | const |  |
| 15556 | `key` | const |  |
| 15613 | `uid` | const |  |
| 15713 | `handleApi` | fn |  |
| 15714 | `failure` | const |  |
| 15744 | `stopCaffeinate` | fn |  |
| 15757 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 15765 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 15768 | `tick` | const |  |
| 15780 | `startCaffeinate` | fn |  |
| 15800 | `applySleepMode` | fn |  |
| 15829 | `sleepNow` | fn |  |
| 15844 | `restoreSleepMode` | fn |  |
| 15855 | `startServer` | fn |  |
| 15962 | `cleanup` | const |  |
| 15979 | `tryListen` | const |  |
| 16065 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （17826 行 / 728 个函数）

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
| 239 | `classifyAutoContinueControllerSnapshot` | fn | 空闲后仍未 complete 的助手消息才是结构化的“回复中断”证据。 |
| 253 | `autoContinueMessageText` | fn |  |
| 260 | `autoContinueControllerCompleted` | fn |  |
| 265 | `selectAutoContinueAssistant` | fn |  |
| 288 | `normalizeQueueText` | fn |  |
| 302 | `parseComposerContentBlock` | fn |  |
| 314 | `composerBlocksFromTree` | fn | separately from querySelectorAll loses that order when quotes are interleaved. |
| 317 | `appendText` | fn |  |
| 325 | `collect` | fn |  |
| 358 | `composerTextFromTree` | fn |  |
| 364 | `selectionQuoteMeta` | fn |  |
| 375 | `contentItemToBlock` | fn |  |
| 392 | `contentToBlocks` | fn | quotes keep their serializable metadata so the official editor can restore the tag. |
| 424 | `isStashQueueItem` | fn | forbidden because ordinary prompts commonly contain a stashed prompt. |
| 437 | `stashContentSignature` | fn |  |
| 445 | `stashContentMatches` | fn |  |
| 475 | `classifyNoDisturbApprovalCandidate` | fn | Keep this deliberately narrow: a generic "确认" button must never qualify. |
| 489 | `isSessionMonitorInProgress` | fn |  |
| 505 | `normalizeSessionMonitorStatus` | fn |  |
| 509 | `sessionMonitorLifecycleAction` | fn |  |
| 519 | `normalizeSessionMonitorResourceRecord` | fn | stale working field cannot mask a newer completed protocol status. |
| 554 | `subscribeSessionMonitorResource` | fn |  |
| 557 | `recordsFromPayload` | fn |  |
| 588 | `createSessionMonitorRegistry` | fn | surface and must not turn conversation activity into a local log file. |
| 594 | `ensure` | fn |  |
| 612 | `update` | fn |  |
| 623 | `append` | fn |  |
| 636 | `remove` | fn |  |
| 644 | `clear` | fn |  |
| 648 | `list` | fn |  |
| 1474 | `wbsSystemLanguage` | fn |  |
| 1478 | `wbsNormalizeLanguage` | fn |  |
| 1483 | `escapeRegExp` | fn |  |
| 1484 | `wbsI18nBuildMatchers` | fn |  |
| 1521 | `wbsTranslateString` | fn |  |
| 1571 | `wbsIsBuiltinAutomation` | fn |  |
| 1580 | `wbsBuiltinAutomationText` | fn |  |
| 1632 | `wbsAutomationText` | fn |  |
| 1637 | `wbsAutomationEditedText` | fn |  |
| 1648 | `wbsReportErr` | fn |  |
| 1675 | `wbsClientVersion` | fn |  |
| 1787 | `isIdentityExpired` | fn | 今日签到状态展示：账号卡片底部与积分余额并列显示 |
| 1804 | `accountHealthLocked` | fn | 那个看 tokenExpiresAt / 签到 401，这个看 daemon 下发的账号健康视图）。 |
| 1809 | `esc` | fn |  |
| 1810 | `escAttr` | fn |  |
| 1813 | `summarizeCreditDays` | fn | 每个积分段只归入一个剩余天数桶；缺失有效期的余额不展示，不猜测到期日。 |
| 1815 | `add` | fn |  |
| 1841 | `creditOpacity` | fn |  |
| 1846 | `createAvatarLibrary` | fn |  |
| 1848 | `validImage` | fn |  |
| 1864 | `snapshot` | fn |  |
| 1865 | `commit` | fn |  |
| 1872 | `select` | method |  |
| 1876 | `add` | method |  |
| 1883 | `remove` | method |  |
| 1891 | `resolveAvatarChoice` | fn |  |
| 1897 | `checkinHtml` | fn |  |
| 1904 | `activityStreakHtml` | fn |  |
| 1915 | `isKnownActivityStreak` | fn |  |
| 1919 | `el` | fn |  |
| 1926 | `maskPhone` | fn |  |
| 1932 | `fmtTime` | fn |  |
| 1942 | `initial` | fn |  |
| 1948 | `api` | fn |  |
| 1975 | `collectAll` | fn | 调试：递归收集所有元素（含 shadowRoot 与同域 iframe），用于抓取输入框内容 |
| 1989 | `allElements` | fn |  |
| 2002 | `captureComposer` | fn | 调试：抓取 WorkBuddy 输入框当前内容（文字/图片/附件/连接器/skill） |
| 2056 | `findComposer` | fn | 可编辑节点；否则取所有 contenteditable 中 y 距 voice-mic-wrap 最近且在其上方的节点（输入框紧贴操作栏上方）。 |
| 2103 | `composerHasContent` | fn | composerTextFromTree 跳过这两类装饰子树。 |
| 2111 | `getComposerContent` | fn | 干净地抓取输入框内容：只取 Slate 节点（不受页面装饰干扰） |
| 2127 | `getConversationId` | fn | 尽量拿到当前会话 id（URL / 当前布局选中会话 / 标题兜底） |
| 2142 | `build` | fn |  |
| 2147 | `send` | method |  |
| 2168 | `removeTimer` | fn |  |
| 2172 | `setBuildTimeout` | fn |  |
| 2180 | `setBuildInterval` | fn |  |
| 2187 | `requestBuildFrame` | fn |  |
| 2196 | `listen` | fn |  |
| 2203 | `toast` | fn |  |
| 2207 | `receiveToast` | fn |  |
| 2216 | `isVisibleHealthNode` | fn |  |
| 2224 | `findBlockingPrompt` | fn |  |
| 2253 | `findSessionError` | fn |  |
| 2273 | `readAssistantHealth` | fn |  |
| 2304 | `setSessionHealthResult` | fn |  |
| 2327 | `scanSessionHealth` | fn |  |
| 2404 | `summary` | method |  |
| 2405 | `active` | method |  |
| 2406 | `generation` | method |  |
| 2407 | `root` | method |  |
| 2411 | `summary` | method |  |
| 2412 | `active` | method |  |
| 2413 | `generation` | method |  |
| 2414 | `root` | method |  |
| 2419 | `isUsableThemeAuditRoot` | fn |  |
| 2428 | `findThemeAuditRoot` | fn |  |
| 2439 | `syncThemeAuditRoot` | fn |  |
| 2461 | `applyI18n` | fn |  |
| 2506 | `setLanguage` | fn |  |
| 2525 | `applyInjectedI18n` | fn |  |
| 2717 | `qpDiag` | fn | 面板关闭/重开：点击选项（发送/编辑/任意项）后关闭面板；重新进入按钮区恢复 hover 可展示 |
| 2728 | `acMenuClose` | fn |  |
| 2744 | `readMessageNavigationEnabled` | fn |  |
| 2747 | `writeMessageNavigationEnabled` | fn |  |
| 2750 | `readSelectionQuoteEnabled` | fn |  |
| 2753 | `writeSelectionQuoteEnabled` | fn |  |
| 2756 | `readForkEnabled` | fn |  |
| 2759 | `writeForkEnabled` | fn |  |
| 2774 | `applySessionModule` | fn |  |
| 2797 | `syncSessionModule` | fn |  |
| 2803 | `setSessionSwitchWire` | fn | 开关切换：写 daemon 并回应用户界（设置失败回滚 UI 状态） |
| 2826 | `selectionQuoteElement` | fn | WorkBuddy 的 selection-quote renderer 会通过 InputContextTag 自己渲染消息图标。 |
| 2841 | `selectionQuoteBlock` | fn |  |
| 2858 | `hideSelectionQuoteButton` | fn |  |
| 2863 | `updateSelectionQuoteButton` | fn |  |
| 2886 | `scheduleSelectionQuoteButton` | fn |  |
| 2892 | `insertSelectionQuote` | fn |  |
| 2912 | `setupSelectionQuote` | fn |  |
| 2950 | `renderQpList` | fn | 增强页快捷短语列表渲染（含批量模式） |
| 3017 | `renderExploreOptions` | fn | 发送按钮面板选项 = 快捷短语列表；点击项经 CDP 发送该短语（替换式，发完默认关面板） |
| 3088 | `openQpEdit` | fn | 新增/编辑快捷短语弹窗（参考账号导出弹窗；textarea 最多 5 行 / 500 字） |
| 3111 | `closeQpEdit` | fn |  |
| 3132 | `confirmQpDelete` | fn | 删除二次确认弹窗（支持单选/批量） |
| 3146 | `closeQpDel` | fn |  |
| 3164 | `findActionRow` | fn | 定位输入框操作栏（含 voice-mic-wrap 的父容器） |
| 3194 | `findSendButton` | fn | 操作栏最右侧的「圆形可点击」元素才是发送按钮（左侧还可能有增强提示词/停止等圆形按钮） |
| 3222 | `isSendDisabled` | fn | 发送按钮是否处于「禁用」态（输入框为空时官方会禁用它） |
| 3233 | `insertStash` | fn | 新版或旧版内联工具栏存在时放进工具栏；带 voice-mic-wrap 的旧布局保持固定定位。 |
| 3262 | `isComposerAnchorVisible` | fn |  |
| 3271 | `positionExplore` | fn | 探索菜单按钮：位于暂存提示词按钮右侧（与暂存同款圆钮、发送图标，hover 悬浮菜单弹窗） |
| 3279 | `acIsDarkTheme` | fn |  |
| 3289 | `applyThemeButtonColors` | fn |  |
| 3300 | `watchThemeForButtons` | fn |  |
| 3307 | `positionStash` | fn |  |
| 3374 | `removeStash` | fn |  |
| 3379 | `isWelcomePage` | fn | 用户要求欢迎页不展示暂存提示词按钮（欢迎页输入框只是快速提问入口，不需要暂存）。 |
| 3388 | `shouldShowStash` | fn | 欢迎页一律不显示。 |
| 3394 | `syncStash` | fn |  |
| 3420 | `watchSend` | fn |  |
| 3434 | `watchRow` | fn |  |
| 3453 | `guardSessionChange` | fn | 标签同步只对当前会话生效（syncQueueTags 内按 sessionId 过滤），旧会话的标签由面板重渲染自然清除。 |
| 3462 | `createMessageNavigation` | fn | 会话消息导航：完整索引来自 controller.messageStore，DOM 仅用于判断当前可见位置。 |
| 3488 | `messageText` | fn |  |
| 3509 | `ensureRoot` | fn |  |
| 3553 | `position` | fn |  |
| 3574 | `setActive` | fn |  |
| 3585 | `hideTooltip` | fn |  |
| 3596 | `showTooltip` | fn |  |
| 3621 | `render` | fn |  |
| 3639 | `updateActive` | fn |  |
| 3669 | `scheduleActive` | fn |  |
| 3677 | `refreshFromStore` | fn |  |
| 3701 | `unbindStore` | fn |  |
| 3714 | `bindAdapter` | fn |  |
| 3731 | `sync` | fn |  |
| 3781 | `setEnabled` | fn |  |
| 3796 | `turnForButton` | fn |  |
| 3801 | `navigateToTurn` | fn |  |
| 3812 | `dragIndexAt` | fn |  |
| 3823 | `onNavPointerDown` | fn |  |
| 3835 | `onNavPointerMove` | fn |  |
| 3843 | `finishNavDrag` | fn |  |
| 3865 | `onNavPointerUp` | fn |  |
| 3866 | `onNavPointerCancel` | fn |  |
| 3867 | `onPointerOver` | fn |  |
| 3872 | `onPointerOut` | fn |  |
| 3878 | `onFocusIn` | fn |  |
| 3882 | `onFocusOut` | fn |  |
| 3886 | `onClick` | fn |  |
| 3898 | `onKeyDown` | fn |  |
| 3907 | `onWindowChange` | fn |  |
| 3935 | `hideForkTooltip` | fn |  |
| 3936 | `showForkTooltip` | fn |  |
| 3954 | `syncForkButtons` | fn |  |
| 3976 | `scheduleForkButtons` | fn |  |
| 4057 | `onDomChange` | fn |  |
| 4071 | `onInputSync` | fn |  |
| 4099 | `scheduleDomChange` | fn |  |
| 4127 | `acLimitBannerPresent` | fn |  |
| 4139 | `acLimitWatchTick` | fn |  |
| 4175 | `readFabBottom` | fn |  |
| 4182 | `clampFabBottom` | fn |  |
| 4187 | `clampFabRight` | fn |  |
| 4192 | `applyFabPosition` | fn |  |
| 4205 | `scheduleFabPos` | fn |  |
| 4213 | `positionFab` | fn |  |
| 4231 | `fixWidgetIframeBg` | fn |  |
| 4264 | `syncModernQueueSnapshot` | fn |  |
| 4370 | `dropModernOptimisticItem` | fn |  |
| 4384 | `getModernQueueSnapshot` | fn |  |
| 4399 | `findWbsAdapter` | fn |  |
| 4442 | `get` | method |  |
| 4453 | `bootstrapModernQueueBridge` | fn |  |
| 4466 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 4470 | `probe` | fn |  |
| 4493 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 4505 | `handleModernQueueActionClick` | fn |  |
| 4536 | `stashSigs` | fn |  |
| 4542 | `stashIds` | fn |  |
| 4548 | `recordStashQueueItem` | fn |  |
| 4577 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 4590 | `syncQueueDomIds` | fn |  |
| 4617 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 4648 | `watchQueueOrder` | fn |  |
| 4660 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 4671 | `guardStashedPause` | fn |  |
| 4781 | `enforceStashOrder` | fn |  |
| 4823 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 4828 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 4859 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 4946 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 4964 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 4979 | `enqueueToWorkBuddyQueue` | fn |  |
| 5043 | `crumb` | fn |  |
| 5139 | `preloadAutomationDiscovery` | fn |  |
| 5145 | `findCreditSegment` | fn |  |
| 5154 | `ensureStatusPopover` | fn |  |
| 5165 | `hideStatusPopover` | fn |  |
| 5171 | `positionStatusPopover` | fn |  |
| 5193 | `showStatusPopover` | fn |  |
| 5204 | `creditPopoverHtml` | fn |  |
| 5211 | `hideCreditTooltip` | fn |  |
| 5217 | `showCreditTooltip` | fn |  |
| 5244 | `rotationReminderEnabled` | fn |  |
| 5321 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 5327 | `sync` | fn |  |
| 5360 | `idleMinutesText` | fn |  |
| 5371 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 5374 | `label` | fn |  |
| 5379 | `data` | fn |  |
| 5385 | `sep` | fn |  |
| 5386 | `gap` | fn |  |
| 5396 | `renderIdleCard` | fn |  |
| 5442 | `refreshIdleCard` | fn |  |
| 5450 | `saveIdleCard` | fn |  |
| 5510 | `failoverClock` | fn |  |
| 5515 | `failoverAccountLabel` | fn |  |
| 5524 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 5537 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 5551 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 5567 | `renderFailoverCard` | fn |  |
| 5612 | `refreshFailoverCard` | fn |  |
| 5661 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 5719 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 5742 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 5745 | `done` | fn |  |
| 5750 | `fallback` | fn |  |
| 5773 | `renderContextAuditCard` | fn |  |
| 5818 | `loadContextAuditCard` | fn |  |
| 5882 | `openAccountOrderModal` | fn |  |
| 5909 | `close` | fn |  |
| 5914 | `drawRows` | fn |  |
| 5923 | `move` | fn |  |
| 5929 | `syncMode` | fn |  |
| 6008 | `setupCreditSummary` | fn |  |
| 6017 | `hide` | fn |  |
| 6018 | `deferHide` | fn |  |
| 6019 | `show` | fn |  |
| 6053 | `openOfficialGrowthCenter` | fn |  |
| 6059 | `confirmCurrentGrowthAccount` | fn |  |
| 6070 | `setupDailyProgressPopover` | fn |  |
| 6077 | `findRing` | fn |  |
| 6085 | `hide` | fn |  |
| 6095 | `deferHide` | fn |  |
| 6105 | `show` | fn |  |
| 6123 | `updateDailyTravelCountdowns` | fn |  |
| 6232 | `closeSecureTransferModal` | fn |  |
| 6236 | `openSecureTransferModal` | fn |  |
| 6275 | `selectedIds` | fn |  |
| 6276 | `syncSelection` | fn |  |
| 6396 | `downloadTransfer` | fn |  |
| 6413 | `readTransferFile` | fn |  |
| 6422 | `copyPlainText` | fn |  |
| 6442 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 6458 | `onConfirm` | method |  |
| 6471 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 6495 | `openAccountImportChoice` | fn |  |
| 6515 | `sync` | fn |  |
| 6537 | `formatTokenCount` | fn |  |
| 6546 | `usageTrendChartHtml` | fn |  |
| 6554 | `usageTrendColors` | fn |  |
| 6561 | `usageTrendGroups` | fn |  |
| 6580 | `renderUsageBreakdown` | fn |  |
| 6630 | `renderUsageTrendChart` | fn |  |
| 6702 | `hideTooltip` | fn |  |
| 6703 | `showTooltip` | fn |  |
| 6744 | `usageTimeSegmentHtml` | fn |  |
| 6752 | `onTokenStats` | fn |  |
| 6774 | `closeStats` | fn |  |
| 6795 | `usageDays` | fn |  |
| 6811 | `renderCredits` | fn |  |
| 6850 | `setCreditBusy` | fn |  |
| 6857 | `creditQueryFailed` | fn |  |
| 6864 | `showCreditJob` | fn |  |
| 6884 | `pollCreditJob` | fn |  |
| 6897 | `loadCredits` | fn |  |
| 6943 | `load` | fn |  |
| 7001 | `switchTab` | fn | ===== Tab 切换 ===== |
| 7034 | `buildAutomationPane` | fn |  |
| 7038 | `defaultTask` | fn |  |
| 7041 | `triggerBadgesHtml` | fn |  |
| 7061 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 7069 | `autoProtocolLabel` | fn |  |
| 7073 | `taskStatusLabel` | fn |  |
| 7085 | `lastRunLabel` | fn |  |
| 7091 | `runFor` | fn |  |
| 7092 | `selectedIds` | fn |  |
| 7093 | `allSelected` | fn |  |
| 7094 | `syncBatchControls` | fn |  |
| 7102 | `render` | fn |  |
| 7145 | `load` | fn |  |
| 7148 | `renderExamples` | fn |  |
| 7162 | `loadAgentInfo` | fn |  |
| 7168 | `fuzzyTaskName` | fn |  |
| 7179 | `discoverySourceLabel` | fn |  |
| 7182 | `renderAutomationDiscovery` | fn |  |
| 7227 | `showAutomationDiscoveryGuide` | fn |  |
| 7237 | `showAutomationDiscovery` | fn |  |
| 7275 | `loadAutomationDiscovery` | fn |  |
| 7289 | `exampleById` | fn |  |
| 7292 | `generateAgentTask` | fn |  |
| 7310 | `finishSafetyReview` | fn |  |
| 7319 | `pollSafetyReview` | fn |  |
| 7334 | `startSafetyReview` | fn |  |
| 7345 | `closePanelModal` | fn |  |
| 7351 | `showAutomationConfirm` | fn |  |
| 7359 | `close` | fn |  |
| 7368 | `showAutomationLogs` | fn |  |
| 7395 | `close` | fn |  |
| 7411 | `showEditor` | fn |  |
| 7437 | `syncScheduleFields` | fn |  |
| 7453 | `hideEditor` | fn |  |
| 7454 | `saveEditor` | fn |  |
| 7498 | `isScheduledSendTaskUI` | fn |  |
| 7501 | `schedPad2` | fn |  |
| 7502 | `schedLocalSlot` | fn |  |
| 7505 | `schedDefaultOnceAt` | fn |  |
| 7511 | `schedWhenLabel` | fn |  |
| 7522 | `schedConversationLabel` | fn |  |
| 7533 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 7543 | `hideScheduledSend` | fn |  |
| 7545 | `showScheduledSend` | fn |  |
| 7603 | `whenValue` | fn |  |
| 7611 | `currentRequest` | fn |  |
| 7626 | `syncSummary` | fn |  |
| 7632 | `syncWhen` | fn |  |
| 7639 | `setTarget` | fn |  |
| 7652 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 7667 | `renderConversations` | fn |  |
| 7681 | `loadConversations` | fn |  |
| 7702 | `saveScheduledSend` | fn |  |
| 7778 | `mountAutomationModal` | fn |  |
| 7800 | `showCapabilities` | fn |  |
| 7810 | `showExamples` | fn |  |
| 7819 | `syncDraft` | fn |  |
| 7831 | `exportAutomationTasks` | fn |  |
| 7840 | `importIssueLabel` | fn |  |
| 7850 | `showTaskImport` | fn |  |
| 7866 | `selected` | fn |  |
| 7867 | `syncSelection` | fn |  |
| 7884 | `readAutomationImport` | fn |  |
| 7899 | `startPicker` | fn |  |
| 7985 | `isTaskSessionRecordUI` | fn |  |
| 7990 | `canonicalWorkspaceUI` | fn |  |
| 8007 | `sessionCopyAccountLabel` | fn |  |
| 8013 | `renderSessionCopyProgress` | fn |  |
| 8044 | `scheduleSessionCopyProgressPoll` | fn |  |
| 8048 | `pollActiveSessionCopyJob` | fn |  |
| 8056 | `buildSessionsPane` | fn |  |
| 8158 | `cloudEls` | fn |  |
| 8170 | `cloudAccountName` | fn |  |
| 8178 | `renderCloudCard` | fn |  |
| 8229 | `checkCloudGhosts` | fn |  |
| 8251 | `runCloudPurge` | fn |  |
| 8280 | `wireCloudCard` | fn |  |
| 8304 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 8335 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 8343 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 8349 | `loadSessions` | fn |  |
| 8380 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 8390 | `canEditAutoCopy` | fn |  |
| 8391 | `autoCopyButton` | fn |  |
| 8473 | `activeAutoCopyCount` | fn |  |
| 8479 | `updateSessionSummary` | fn |  |
| 8489 | `updateAutoCopyAllButton` | fn |  |
| 8497 | `toggleAutoCopyAll` | fn |  |
| 8520 | `shortWs` | fn |  |
| 8525 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 8572 | `toggleAutoCopyRule` | fn |  |
| 8603 | `updateAutoCopyButtons` | fn |  |
| 8631 | `updateSessCount` | fn |  |
| 8650 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 8659 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 8679 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 8694 | `wireSessionsPane` | fn |  |
| 8913 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 8967 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 9066 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 9108 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 9155 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 9173 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 9197 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 9287 | `selectedSessIds` | fn |  |
| 9290 | `showSessModal` | fn |  |
| 9301 | `buildModelsPane` | fn |  |
| 9331 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 9338 | `modelDetailsHtml` | fn |  |
| 9347 | `modelRowHtml` | fn |  |
| 9376 | `loadModels` | fn |  |
| 9394 | `updateModelCounts` | fn |  |
| 9404 | `renderModels` | fn |  |
| 9450 | `updateModelBatchState` | fn |  |
| 9465 | `showModelConfirm` | fn |  |
| 9479 | `closeThirdPartyMenu` | fn |  |
| 9485 | `openThirdPartyModels` | fn |  |
| 9610 | `wireModelsPane` | fn |  |
| 9758 | `findModelBackup` | fn |  |
| 9765 | `openModelEdit` | fn |  |
| 9799 | `buildThemePane` | fn | ===== 主题 pane（构建：主题选择 + 头像 + WorkDaddy 壁纸）===== |
| 9868 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 9976 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 9995 | `wirePcPane` | fn |  |
| 10028 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 10133 | `syncLangSeg` | fn |  |
| 10160 | `wireTelemetrySettings` | fn |  |
| 10164 | `renderTelemetryState` | fn |  |
| 10202 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 10318 | `updateLogTimestamp` | fn |  |
| 10323 | `appendUpdateLog` | fn |  |
| 10336 | `formatDownloadRate` | fn |  |
| 10342 | `formatDownloadEta` | fn |  |
| 10350 | `formatDownloadTransfer` | fn |  |
| 10363 | `formatUpdateFailure` | fn |  |
| 10377 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 10396 | `openWindowsInstaller` | fn |  |
| 10418 | `showWindowsInstallerReady` | fn |  |
| 10432 | `openWindowsInstallerAfterDownload` | fn |  |
| 10466 | `pollUpdateProgress` | fn |  |
| 10475 | `renderRebootUi` | fn |  |
| 10581 | `syncWallpaperCardVisibility` | fn |  |
| 10593 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 10784 | `wireEnhancePane` | fn |  |
| 10816 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 10824 | `loadWallpapers` | fn |  |
| 10927 | `setOpen` | fn |  |
| 10962 | `setupFabDrag` | fn |  |
| 10996 | `finishFabDrag` | fn |  |
| 11026 | `isDragging` | method |  |
| 11059 | `closeLoginModal` | fn |  |
| 11068 | `openLoginChoice` | fn |  |
| 11172 | `startSeamlessLogin` | fn |  |
| 11267 | `loadThemes` | fn |  |
| 11281 | `applyTheme` | fn |  |
| 11289 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 11307 | `openWebsite` | method |  |
| 11312 | `unlockDebug` | method |  |
| 11335 | `getItem` | method |  |
| 11336 | `setItem` | method |  |
| 11337 | `removeItem` | method |  |
| 11349 | `rememberAvatarWrapper` | fn |  |
| 11355 | `rememberAvatarImage` | fn |  |
| 11361 | `restoreAvatarDom` | fn |  |
| 11375 | `svgToPng` | fn | SVG → PNG dataURL |
| 11396 | `applyAvatar` | fn |  |
| 11465 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 11506 | `hexOf` | fn |  |
| 11509 | `mixArr` | fn |  |
| 11510 | `extractPalette` | fn |  |
| 11544 | `imageToTheme` | fn |  |
| 11633 | `syncAskSwitch` | fn |  |
| 11685 | `ndEl` | fn |  |
| 11688 | `ndRefreshCount` | fn |  |
| 11692 | `ndSwitchEl` | fn |  |
| 11697 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 11737 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 11771 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 11787 | `ndTitle` | fn |  |
| 11794 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 11806 | `cleanup` | fn |  |
| 11810 | `onClick` | fn |  |
| 11823 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 11830 | `applyNoDisturbState` | fn |  |
| 11905 | `acLogLine` | fn |  |
| 11910 | `acLog` | fn |  |
| 11920 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 11929 | `acSessionTitle` | fn |  |
| 11937 | `acMonitorLog` | fn |  |
| 11944 | `acScheduleMonitorLogRender` | fn |  |
| 11954 | `acResetState` | fn |  |
| 11985 | `acShowStatus` | fn |  |
| 11991 | `acHideStatus` | fn |  |
| 11996 | `acStartStatusAnim` | fn |  |
| 11997 | `acStopStatusAnim` | fn |  |
| 12000 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 12014 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 12031 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 12041 | `acHasCompletionActions` | fn |  |
| 12057 | `acHasErrorSignal` | fn |  |
| 12071 | `acLooksTruncated` | fn |  |
| 12079 | `acReplyDecision` | fn |  |
| 12091 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 12107 | `acIsBusy` | fn |  |
| 12112 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 12120 | `acComposerText` | fn |  |
| 12133 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 12149 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 12170 | `acPressEnter` | fn |  |
| 12179 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 12189 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 12206 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 12228 | `acControllerComposerEmpty` | fn |  |
| 12236 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 12283 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 12320 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 12358 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 12406 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 12412 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 12451 | `acControllerSnapshot` | fn |  |
| 12489 | `acControllerCheck` | fn |  |
| 12571 | `acBindController` | fn |  |
| 12600 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 12695 | `acScheduleSettle` | fn |  |
| 12708 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 12731 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 12739 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 12752 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 12851 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 12907 | `acStopLegacyMonitor` | fn |  |
| 12928 | `acMultiUpdateStatus` | fn |  |
| 12942 | `acMultiCreateSession` | fn |  |
| 12974 | `acMultiStatusFromResource` | fn |  |
| 12979 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 13007 | `acMultiReconcileSidebar` | fn |  |
| 13018 | `acMultiBindSessionResource` | fn |  |
| 13031 | `acMultiUnbindSessionResource` | fn |  |
| 13040 | `acMultiSchedule` | fn |  |
| 13049 | `acMultiSend` | fn |  |
| 13092 | `acMultiCheckSession` | fn |  |
| 13198 | `acMultiBindController` | fn |  |
| 13239 | `acMultiFinishSession` | fn |  |
| 13248 | `acMultiDetachController` | fn |  |
| 13257 | `acMultiProbeSidebarApproval` | fn |  |
| 13314 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 13337 | `acCdpClick` | fn |  |
| 13345 | `acAutoApproveClickItem` | fn |  |
| 13364 | `acAutoApproveItemByTitle` | fn |  |
| 13376 | `acAutoApprovePendingOnce` | fn |  |
| 13514 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 13559 | `acAutoApproveFastStart` | fn |  |
| 13569 | `acAutoApproveFastStop` | fn |  |
| 13573 | `acMultiDiscover` | fn |  |
| 13609 | `acStartMultiMonitor` | fn |  |
| 13628 | `acStopMultiMonitor` | fn |  |
| 13646 | `acStartMonitor` | fn |  |
| 13651 | `acStopMonitor` | fn |  |
| 13657 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 13668 | `acMonitorStatusLabel` | fn |  |
| 13677 | `acMonitorSafeDetail` | fn |  |
| 13689 | `acRenderMonitorLogModal` | fn |  |
| 13741 | `wireAutoContinuePane` | fn |  |
| 13771 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 13876 | `syncAutoContinue` | fn |  |
| 13881 | `applyAutoContinueState` | fn |  |
| 13894 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 13904 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 13910 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 13945 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 13963 | `stopNoDisturbAutoApprove` | fn |  |
| 13968 | `scheduleNdScan` | fn |  |
| 13972 | `ndQueueScanRoot` | fn |  |
| 13992 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 14014 | `ndNormalizeLabel` | fn |  |
| 14018 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 14026 | `ndClassifyApprovalCandidate` | fn |  |
| 14037 | `ndSessionIdForNode` | fn |  |
| 14043 | `ndApprovalContext` | fn |  |
| 14079 | `scanNoDisturbApproval` | fn |  |
| 14109 | `toNdAudit` | fn |  |
| 14117 | `getSleepMode` | fn |  |
| 14122 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 14140 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 14172 | `discoverSleepSessionBusy` | fn |  |
| 14203 | `isAnySessionBusy` | fn |  |
| 14217 | `startUntilDoneCheck` | fn |  |
| 14237 | `stopUntilDoneCheck` | fn |  |
| 14243 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 14283 | `fmtDateTime` | fn | 渲染账号列表 |
| 14290 | `fmtCredits` | fn |  |
| 14297 | `fmtCreditExpiry` | fn |  |
| 14310 | `creditTip` | fn |  |
| 14322 | `creditBarHtml` | fn |  |
| 14339 | `todayUsageHtml` | fn |  |
| 14347 | `accountStatusTagsHtml` | fn |  |
| 14352 | `checkinBadgeHtml` | fn |  |
| 14361 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 14377 | `creditBlockHtml` | fn |  |
| 14398 | `nearestCreditExpiry` | fn |  |
| 14410 | `sortAccountsByCreditExpiry` | fn |  |
| 14430 | `reorderAccountCards` | fn |  |
| 14443 | `mergeAccountSnapshot` | fn |  |
| 14463 | `clampDailyRatio` | fn |  |
| 14470 | `dailyProgressLabel` | fn |  |
| 14488 | `dailyRingsSvg` | fn |  |
| 14497 | `dailyRingsHtml` | fn |  |
| 14506 | `formatDailyTravelCountdown` | fn |  |
| 14517 | `dailyTravelCountdownText` | fn |  |
| 14523 | `dailyCatDetail` | fn |  |
| 14542 | `formatGrowthTaskDeadline` | fn |  |
| 14550 | `sortGrowthTasks` | fn |  |
| 14568 | `growthTaskActions` | fn |  |
| 14573 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 14585 | `growthAutoOf` | fn |  |
| 14589 | `growthAutoActionFor` | fn |  |
| 14598 | `startGrowthAuto` | fn |  |
| 14626 | `pollGrowthAuto` | fn |  |
| 14666 | `stopGrowthAutoPoll` | fn |  |
| 14674 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 14688 | `growthTaskRewardHtml` | fn |  |
| 14700 | `dailyProgressPopoverHtml` | fn |  |
| 14844 | `updateDailyProgressCells` | fn |  |
| 14867 | `refreshDailyProgressAccount` | fn |  |
| 14895 | `fetchDailyProgressForAccounts` | fn |  |
| 14922 | `accountCardLayoutKey` | fn |  |
| 14942 | `fmtBytes` | fn |  |
| 14952 | `fmtDuration` | fn |  |
| 14961 | `autoCopyTotalFailed` | fn |  |
| 14972 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 14978 | `autoCopyConflictTitle` | fn |  |
| 14984 | `autoCopyConflictDetail` | fn |  |
| 14994 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 15016 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 15022 | `autoCopyProgressEls` | fn |  |
| 15035 | `hideAutoCopyProgress` | fn |  |
| 15042 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 15147 | `scheduleAutoCopyHide` | fn |  |
| 15169 | `spaceNum` | fn |  |
| 15174 | `spaceShare` | fn |  |
| 15180 | `spaceTimeText` | fn |  |
| 15184 | `pad` | fn |  |
| 15188 | `spaceBaseName` | fn |  |
| 15193 | `spaceScanEls` | fn |  |
| 15210 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 15232 | `hideSpaceScanBox` | fn |  |
| 15238 | `stopSpacePolling` | fn |  |
| 15243 | `spaceJobSub` | fn |  |
| 15250 | `renderSpaceJob` | fn |  |
| 15267 | `spaceRowHtml` | fn |  |
| 15278 | `spaceRestRow` | fn |  |
| 15286 | `renderSpaceEmpty` | fn |  |
| 15303 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 15311 | `spaceSubText` | fn |  |
| 15330 | `spaceSortOf` | fn |  |
| 15338 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 15346 | `spaceSortName` | fn |  |
| 15353 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 15374 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 15392 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 15399 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 15410 | `renderSpaceResult` | fn |  |
| 15527 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 15545 | `scheduleSpacePoll` | fn |  |
| 15553 | `pollSpaceScan` | fn |  |
| 15576 | `startSpaceScan` | fn |  |
| 15597 | `cancelSpaceScan` | fn |  |
| 15609 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 15631 | `buildSpacesPane` | fn |  |
| 15664 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 15721 | `pollAutoCopyJob` | fn |  |
| 15728 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 15738 | `render` | fn |  |
| 15898 | `maskAccountName` | fn |  |
| 15906 | `maskAccountId` | fn |  |
| 15917 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 15943 | `toggleAccountMask` | fn |  |
| 15949 | `refresh` | fn |  |
| 15981 | `updateAccountSummary` | fn |  |
| 16006 | `rotationToday` | fn |  |
| 16011 | `closeRotationNotice` | fn |  |
| 16021 | `showRotationNotice` | fn |  |
| 16047 | `place` | fn |  |
| 16102 | `formatRotationEta` | fn |  |
| 16111 | `formatRotationDuration` | fn |  |
| 16122 | `checkCreditRotationAfterSession` | fn |  |
| 16124 | `run` | fn |  |
| 16146 | `updateCheckinCells` | fn |  |
| 16209 | `fetchActivityForAccounts` | fn |  |
| 16218 | `worker` | fn |  |
| 16257 | `requestCredit` | fn |  |
| 16283 | `updateCreditSummaryFromAccounts` | fn |  |
| 16292 | `refreshCreditForAccount` | fn |  |
| 16324 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 16329 | `settleBatch` | fn |  |
| 16339 | `queryAccount` | fn |  |
| 16390 | `updateCreditCell` | fn |  |
| 16434 | `updateDebugPanel` | fn |  |
| 16451 | `onDebugKey` | fn |  |
| 16460 | `markHealthGeneration` | fn |  |
| 16469 | `isHealthStopControl` | fn |  |
| 16474 | `isHealthSendControl` | fn |  |
| 16579 | `registerBuild` | fn |  |
| 16588 | `start` | fn |  |
| 16601 | `destroyWidget` | fn |  |
| 17819 | `refresh` | method |  |
| 17821 | `getLanguage` | method |  |
| 17822 | `setLanguage` | method |  |

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

合计 **1294** 个函数。
