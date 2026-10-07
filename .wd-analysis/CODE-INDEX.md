# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-10-07 04:13:05
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （19317 行 / 632 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 56 | `resolveDaemonPrivilege` | fn |  |
| 268 | `readAutomationsTolerant` | fn |  |
| 703 | `persistScheduleLedger` | fn |  |
| 713 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 733 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 753 | `scheduleVerifyNotify` | fn |  |
| 763 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 770 | `nameOf` | const |  |
| 813 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 814 | `valid` | const |  |
| 839 | `diagnosticsEnabled` | fn |  |
| 847 | `redactDiagnosticText` | fn |  |
| 860 | `shouldPersistBreadcrumb` | fn |  |
| 866 | `validCdpPort` | fn |  |
| 870 | `readCdpPortFile` | fn |  |
| 879 | `writeCdpPortFile` | fn |  |
| 894 | `readUiPortFile` | fn |  |
| 898 | `writeUiPortFile` | fn |  |
| 913 | `cdpPortCandidates` | fn |  |
| 915 | `add` | const |  |
| 923 | `isLocalPortAvailable` | fn |  |
| 927 | `finish` | const |  |
| 942 | `findAvailableCdpPort` | fn |  |
| 949 | `selectCdpPort` | fn |  |
| 1025 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 1030 | `updateDebug` | fn |  |
| 1031 | `scrub` | const |  |
| 1061 | `writeUpdateAttempt` | fn |  |
| 1072 | `macWorkDaddyAppPath` | fn |  |
| 1095 | `resolveApplyUpdateVbs` | fn |  |
| 1114 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1127 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1139 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1168 | `githubAuthHeaders` | fn |  |
| 1178 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1202 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1204 | `fileName` | const |  |
| 1209 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1223 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1232 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1246 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1256 | `normalizeAssetSha256` | fn |  |
| 1261 | `expectedUpdateSha256` | fn |  |
| 1266 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1303 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1347 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1406 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1439 | `readUpstreamCache` | const |  |
| 1487 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1495 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1521 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1530 | `downloadUpdateInternal` | fn |  |
| 1588 | `cleanupTemp` | const |  |
| 1590 | `failDownload` | const |  |
| 1676 | `sha256File` | fn | 计算文件 SHA-256 |
| 1680 | `inspectPackagedApp` | fn |  |
| 1697 | `packagedAppVersionError` | fn |  |
| 1711 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 1765 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 1773 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 1813 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 1880 | `scheduleOAuthStateCleanup` | fn |  |
| 1886 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 1907 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 1936 | `accData` | const |  |
| 1948 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 1996 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 2021 | `markAttemptFailure` | const |  |
| 2030 | `markSpawnFailure` | const |  |
| 2152 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2167 | `log` | fn |  |
| 2178 | `isLockPermissionError` | fn |  |
| 2182 | `reportDaemonLockFallback` | fn |  |
| 2192 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2227 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2284 | `releaseDaemonLock` | fn |  |
| 2297 | `scheduleBackup` | fn |  |
| 2368 | `settlePendingReloadInjection` | fn |  |
| 2380 | `armPendingReloadInjection` | fn |  |
| 2402 | `runPendingReloadInjection` | fn |  |
| 2429 | `findCdpEndpoint` | fn |  |
| 2438 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2473 | `targetsBelongToProfile` | fn |  |
| 2493 | `isWorkBuddyCdpTarget` | fn |  |
| 2499 | `getPageTarget` | fn |  |
| 2505 | `cleanupForeignInjectedTargets` | fn |  |
| 2513 | `cleanupForeignInjectedTarget` | fn |  |
| 2522 | `finish` | const |  |
| 2565 | `cdpFocusDiagnostics` | fn |  |
| 2579 | `cdpMouseClick` | fn |  |
| 2602 | `cdpSend` | fn |  |
| 2620 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2621 | `raw` | const |  |
| 2633 | `connectCdp` | fn |  |
| 2710 | `waitForPageReadyThenDispatch` | fn |  |
| 2712 | `retry` | const |  |
| 2725 | `dispatchAutomationEvent` | fn |  |
| 2761 | `onCdpEvent` | fn |  |
| 2764 | `url` | const |  |
| 2845 | `cdpLoop` | fn |  |
| 2858 | `reloadWorkBuddyPage` | fn |  |
| 2860 | `withTimeout` | const |  |
| 2902 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 3025 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 3039 | `resolveWorkBuddyBinary` | fn |  |
| 3042 | `tryFile` | const |  |
| 3054 | `psCmd` | const |  |
| 3083 | `addCandidate` | const |  |
| 3127 | `psQuote` | const |  |
| 3144 | `runCommand` | fn |  |
| 3151 | `finish` | const |  |
| 3175 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3204 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3220 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3237 | `linuxWorkBuddyPids` | fn |  |
| 3261 | `workBuddyRunning` | fn |  |
| 3278 | `waitForWorkBuddyExit` | fn |  |
| 3293 | `waitForWorkBuddyExitTolerant` | fn |  |
| 3305 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 3351 | `detail` | const |  |
| 3383 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 3409 | `resolveLauncherHome` | fn |  |
| 3419 | `resolveLinuxLaunchTarget` | fn |  |
| 3434 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 3513 | `clickByText` | fn |  |
| 3559 | `findByText` | fn |  |
| 3588 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 3594 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 3597 | `claimLog` | fn |  |
| 3605 | `sleep` | fn |  |
| 3610 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 3657 | `automationStateFile` | const |  |
| 3658 | `readAutomationState` | fn |  |
| 3661 | `writeAutomationState` | fn |  |
| 3667 | `automationAccountStatus` | fn |  |
| 3701 | `automationDeepLocatorExpression` | fn |  |
| 3716 | `first` | fn |  |
| 3721 | `choose` | fn |  |
| 3722 | `firstByAttribute` | fn |  |
| 3732 | `automationDomAction` | fn |  |
| 3733 | `assertActive` | const |  |
| 3741 | `read` | const |  |
| 3797 | `automationHttpRequest` | fn |  |
| 3820 | `automationPublicRun` | fn |  |
| 3828 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 3839 | `automationPanelSetOpen` | fn |  |
| 3847 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 3856 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 3869 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 3884 | `automationNotifyToast` | fn |  |
| 3914 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 3915 | `assertAutoCopySucceeded` | fn |  |
| 3921 | `recordAccountSyncResult` | fn |  |
| 3933 | `assertAccountSwitchIdle` | fn |  |
| 3939 | `automationSwitchProgress` | fn |  |
| 3947 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 3964 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 3970 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 4017 | `limitFailoverManualPublic` | fn |  |
| 4036 | `readLimitFailoverState` | fn |  |
| 4045 | `writeLimitFailoverState` | fn |  |
| 4056 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 4070 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 4086 | `runCdpExpression` | fn |  |
| 4097 | `readLimitBanner` | fn |  |
| 4110 | `readStructuredError` | fn |  |
| 4114 | `readLiveModel` | fn |  |
| 4118 | `setLiveModel` | fn |  |
| 4122 | `readLastUserTaskText` | fn |  |
| 4130 | `readFailoverSnapshot` | fn |  |
| 4146 | `pickWorkbuddyDaemonClient` | fn |  |
| 4148 | `walk` | fn |  |
| 4185 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4200 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4217 | `edgeSyncMappingDbPath` | fn |  |
| 4232 | `getEdgeSyncDb` | fn |  |
| 4245 | `readEdgeSyncRows` | fn |  |
| 4258 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4284 | `probeCloudConversations` | fn |  |
| 4311 | `collectCloudGhosts` | fn |  |
| 4349 | `purgeCloudConversations` | fn |  |
| 4383 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 4400 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 4418 | `purgeCloudGhostsSwitching` | fn |  |
| 4427 | `switchBack` | const |  |
| 4468 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 4478 | `limitReplyStarted` | fn |  |
| 4483 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 4490 | `findLimitFailoverTask` | fn |  |
| 4494 | `runningLimitFailoverRun` | fn |  |
| 4498 | `waitLimitVerdict` | fn |  |
| 4523 | `runLimitFailoverCore` | fn |  |
| 4554 | `hits` | const |  |
| 4843 | `buildLimitFailoverPorts` | fn |  |
| 4928 | `limitFailoverDesktopLogDir` | fn |  |
| 4937 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 4951 | `limitFailoverNotify` | fn |  |
| 4959 | `readLimitReplyIdle` | fn |  |
| 4963 | `limitFailoverAccountByUid` | fn |  |
| 4969 | `limitFailoverPrimaryUid` | fn |  |
| 4977 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 4983 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 4992 | `cancelLimitFailoverSwitchBack` | fn |  |
| 5005 | `limitFailoverPlanCancelled` | fn |  |
| 5009 | `finishLimitFailoverSwitchBack` | fn |  |
| 5032 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 5047 | `runLimitFailoverSwitchBack` | fn |  |
| 5048 | `isCancelled` | const |  |
| 5049 | `elapsedMs` | const |  |
| 5050 | `stopIfUnsafe` | const |  |
| 5170 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5205 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5267 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5277 | `readSessionActivity` | fn |  |
| 5282 | `idleSwitchbackPublicState` | fn |  |
| 5315 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 5375 | `idleSwitchbackTick` | fn |  |
| 5434 | `startIdleSwitchbackTicker` | fn |  |
| 5446 | `automationSwitchAccount` | fn |  |
| 5505 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 5512 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 5530 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 5543 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 5566 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 5578 | `automationAccountSwitchGuarded` | fn |  |
| 5600 | `startAutomationRun` | fn |  |
| 5616 | `isCancelled` | const |  |
| 5619 | `appendRunLog` | const |  |
| 5630 | `panelPrepare` | const |  |
| 5642 | `withInput` | const |  |
| 5659 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 5669 | `readSession` | const | 必须保持原语义，否则会波及后面的「发送是否被受理」判定）。 |
| 5677 | `sessionAction` | const |  |
| 5685 | `openedUid` | const |  |
| 5716 | `accountUid` | const |  |
| 5812 | `completionReport` | const |  |
| 5839 | `publicAccounts` | const |  |
| 5840 | `publicCurrent` | const |  |
| 5843 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 5911 | `resumeAutomationAfterNavigation` | fn |  |
| 5922 | `todayStr` | fn |  |
| 5924 | `z` | const |  |
| 5928 | `loadCheckinCache` | fn |  |
| 5935 | `saveCheckinCache` | fn |  |
| 5947 | `refreshAccountBackupToken` | fn | 刷新备份账号凭证：临期惰性刷新，或距上次刷新超过一天时执行保活。 |
| 6001 | `dailyCheckin` | fn |  |
| 6050 | `claimDailyForUid` | fn |  |
| 6059 | `performAccountCheckin` | fn |  |
| 6105 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 6169 | `desc` | const |  |
| 6214 | `buildInjectScript` | fn |  |
| 6259 | `injectWidgetManual` | fn |  |
| 6267 | `readCdpTargets` | fn |  |
| 6278 | `readLogTail` | fn |  |
| 6289 | `collectDiagnostics` | fn |  |
| 6314 | `writeDiagnosticsSnapshot` | fn |  |
| 6335 | `sqliteRun` | fn |  |
| 6341 | `codeBuddySessionRows` | fn |  |
| 6356 | `sqlParamAt` | fn |  |
| 6359 | `sqliteQuery` | fn |  |
| 6401 | `officialSlotOf` | fn | 本地时区槽位 `YYYY-MM-DDTHH:MM`（与 scheduled-send 的 localSlot 同格式）。 |
| 6402 | `pad` | const |  |
| 6419 | `readOfficialAutomations` | fn |  |
| 6430 | `items` | const |  |
| 6464 | `findOfficialSlotConflicts` | fn |  |
| 6493 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 6512 | `createDirectoryNoFollow` | fn |  |
| 6531 | `repairMissingSessionWorkspaces` | fn |  |
| 6557 | `sessionRangeMs` | fn |  |
| 6574 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 6578 | `copyOne` | const |  |
| 6604 | `onlyCopyable` | const | 要拦的只有 socket / FIFO / 字符设备 / 块设备这类**根本无法复制**的特殊文件。 |
| 6712 | `sessionBodyMtime` | fn |  |
| 6729 | `sessionContentMtime` | fn |  |
| 6733 | `visit` | const |  |
| 6767 | `directoryStats` | fn |  |
| 6796 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 6807 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 6833 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 6848 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 6859 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 6879 | `sortAutoCopyPlanBySize` | fn |  |
| 6898 | `readCopyManifestCache` | fn |  |
| 6909 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 6918 | `deriveCopyManifestFromCache` | fn |  |
| 6945 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 6956 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 6978 | `emptyWorkspaceCounters` | fn |  |
| 6986 | `transferWorkspaceTree` | fn |  |
| 6994 | `copyFileAt` | const |  |
| 7087 | `copySessionWorkspacePayload` | fn |  |
| 7109 | `outcome` | const |  |
| 7121 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 7142 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 7263 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 7285 | `forcedSource` | const | 真分叉下「最新」并不等于「用户想要的那份」，按时间选会静默丢另一边的内容。 |
| 7297 | `trackPayload` | const |  |
| 7355 | `sleepMs` | const |  |
| 7466 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 7512 | `listAutoCopyConflicts` | fn |  |
| 7525 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 7539 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 7565 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 7665 | `readNativeDeleteSweep` | fn |  |
| 7672 | `saveNativeDeleteSweep` | fn |  |
| 7685 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 7692 | `sweepNativeSessionDeletes` | fn |  |
| 7764 | `readArchiveIsolation` | fn |  |
| 7771 | `saveArchiveIsolation` | fn |  |
| 7785 | `archiveIsolationEnabled` | fn |  |
| 7790 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 7806 | `members` | const |  |
| 7874 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 7923 | `purgeLocalSessionCopyCore` | fn |  |
| 7955 | `purgeArchivedCrossAccountCopies` | fn |  |
| 8006 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 8083 | `summarizeSessionImportErrors` | fn |  |
| 8093 | `archiveRelativePath` | fn |  |
| 8097 | `collectSessionArchiveFiles` | fn |  |
| 8100 | `collect` | const |  |
| 8140 | `ensureArchiveParentNoFollow` | fn |  |
| 8159 | `restoreSessionArchiveFiles` | fn |  |
| 8182 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 8213 | `getSessionSyncCache` | fn |  |
| 8236 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 8252 | `isTaskSessionRecord` | fn |  |
| 8257 | `sqlPlaceholders` | fn |  |
| 8261 | `insertCopiedSession` | fn |  |
| 8291 | `createForkSession` | fn |  |
| 8324 | `prepareSessionExport` | fn |  |
| 8341 | `exportSessions` | fn |  |
| 8355 | `validImportedSessionUid` | fn |  |
| 8361 | `importSessions` | fn |  |
| 8365 | `importSessionArchives` | fn |  |
| 8413 | `adoptExistingCopyTarget` | fn |  |
| 8457 | `copySessionRecord` | fn |  |
| 8474 | `perform` | const |  |
| 8595 | `getSessionDirtyIndex` | fn |  |
| 8603 | `scheduleSessionDirtySave` | fn |  |
| 8620 | `markSessionDirty` | fn | 记一条脏标记；**只有真变化才置脏**（同一时刻的重复通知不写盘）。 |
| 8631 | `markSessionDirtyBaseline` | fn | renderer 建立基线（`body.ready`）。未建基线的账号一律 fail-open = 全当脏。 |
| 8636 | `clearSessionDirty` | fn | 清一条脏标记；`expectedAt` 不匹配就不清（**并发到来的新事件不许被旧的在飞清理抹掉**）。 |
| 8645 | `autoCopyDirtyFastpathEnabled` | fn | 批次 3 的开关：**默认关**（文件缺失 / 内容不是 {enabled:true} 都算关）。每次规划读一次。 |
| 8661 | `isAutoCopyRowCleanByDirty` | fn |  |
| 8666 | `lineageId` | const |  |
| 8675 | `buildAutoCopyPlan` | fn |  |
| 8758 | `isAutoCopyPausedError` | fn |  |
| 8765 | `beginRendererReloadPriority` | fn |  |
| 8780 | `hasPendingAutoCopyTo` | fn |  |
| 8789 | `pruneAutoCopyJobs` | fn |  |
| 8799 | `runAutoCopyQueue` | fn |  |
| 8829 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 8896 | `enterSwitchFlowRunner` | fn | 进入一个切号流程；返回**幂等**的退出函数（重复调用不会把计数减成负）。 |
| 8925 | `setSwitchFlowPhase` | fn |  |
| 8931 | `terminal` | const |  |
| 8966 | `readSwitchFlowState` | fn | 读状态（惰性过期：终态留 TTL 供渲染层读到，过期即清）。 |
| 8978 | `requestSwitchFlowCancel` | fn | 「关闭弹窗」：置取消位 + 立刻请求中止复制（worker 在下个检查点收尾，不是硬停）。 |
| 9032 | `waitPreSyncSettled` | fn |  |
| 9086 | `preSyncBeforeSwitch` | fn |  |
| 9188 | `resolveSyncNowSources` | fn |  |
| 9189 | `all` | const |  |
| 9225 | `limitFailoverSyncWaitMs` | fn |  |
| 9260 | `openConversationById` | fn |  |
| 9284 | `fastExpr` | const |  |
| 9369 | `sidebarProbe` | const |  |
| 9539 | `prepareFailoverContinuation` | fn |  |
| 9545 | `degrade` | const |  |
| 9647 | `startAutoCopyJob` | fn |  |
| 9720 | `run` | const |  |
| 9728 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 10012 | `activeAutoCopyJob` | fn |  |
| 10025 | `publicAutoCopyJob` | fn |  |
| 10107 | `publicSpaceScanJob` | fn |  |
| 10131 | `buildSpaceScanResolvers` | fn |  |
| 10177 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 10189 | `startSpaceScanJob` | fn |  |
| 10279 | `isValidSessionId` | fn |  |
| 10288 | `matchedSessionIds` | fn |  |
| 10293 | `resolveManagedSessionTarget` | fn |  |
| 10306 | `isManagedDirectoryNoFollow` | fn |  |
| 10330 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 10364 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 10370 | `delOne` | const |  |
| 10414 | `json` | fn |  |
| 10443 | `isAllowedApiOrigin` | fn |  |
| 10463 | `hasApiToken` | fn |  |
| 10470 | `isApiRequestAuthorized` | fn |  |
| 10479 | `isAllowedDevtoolsOrigin` | fn |  |
| 10519 | `readBody` | fn |  |
| 10524 | `ignoreLateError` | const |  |
| 10525 | `cleanup` | const |  |
| 10535 | `finish` | const |  |
| 10541 | `fail` | fn |  |
| 10547 | `onData` | fn |  |
| 10560 | `onEnd` | fn |  |
| 10571 | `onError` | fn |  |
| 10574 | `onIncomplete` | fn |  |
| 10606 | `workbuddySettingsPath` | fn |  |
| 10610 | `readWorkbuddySettings` | fn |  |
| 10618 | `writeWorkbuddySettings` | fn |  |
| 10624 | `buildAskRuleBlock` | fn |  |
| 10629 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 10639 | `getAskModeState` | fn |  |
| 10641 | `customPrompt` | const |  |
| 10654 | `setAskMode` | fn |  |
| 10669 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 10711 | `buildZhReasoningBlock` | fn |  |
| 10716 | `stripZhReasoning` | fn | 从 customPrompt 中移除中文思考段（保留用户其它内容与决策弹窗段） |
| 10726 | `getZhReasoningState` | fn |  |
| 10728 | `customPrompt` | const |  |
| 10744 | `setZhReasoning` | fn |  |
| 10764 | `refreshZhReasoningIfEnabled` | fn | 启动时调用：如已启用中文思考，把旧的规则段替换为最新版本（用标记精确识别） |
| 10815 | `deriveAgentHealth` | fn |  |
| 10853 | `buildAgentHintRule` | fn |  |
| 10935 | `buildAgentHintBlock` | fn |  |
| 10947 | `stripAgentHint` | fn | 从 customPrompt 中移除子 Agent 提示段（保留用户其它内容，**且不改动用户原文一个字节**）。 |
| 10962 | `getAgentHintState` | fn |  |
| 10964 | `customPrompt` | const |  |
| 10981 | `setAgentHint` | fn |  |
| 11019 | `refreshAgentHintAfterCatalogChange` | fn |  |
| 11035 | `refreshAgentHintIfEnabled` | fn | 启动时调用：如已开启，把旧的提示规则替换为最新版本（用标记精确识别）。 |
| 11064 | `collectAgentUsage` | fn |  |
| 11120 | `readNoDisturbState` | fn |  |
| 11123 | `state` | const |  |
| 11145 | `readNoDisturbApplied` | fn |  |
| 11149 | `hasAll` | const |  |
| 11164 | `removeListItems` | fn |  |
| 11170 | `ensureSandboxObj` | fn |  |
| 11179 | `applyNoDisturbSwitch` | fn |  |
| 11183 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 11189 | `rollback` | const |  |
| 11237 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 11252 | `noDisturbAudit` | fn |  |
| 11287 | `acAppConfigPath` | fn |  |
| 11290 | `readAppConfig` | fn |  |
| 11298 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 11303 | `acBlock` | fn |  |
| 11310 | `stripACBlocks` | fn |  |
| 11316 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 11322 | `acCustomPromptPresent` | fn |  |
| 11327 | `readAutoContinueState` | fn |  |
| 11342 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 11359 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 11373 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 11390 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 11410 | `sessBuild` | fn |  |
| 11418 | `readSessionState` | fn |  |
| 11420 | `ns` | const |  |
| 11421 | `st` | const |  |
| 11453 | `writeSessionState` | fn |  |
| 11455 | `prior` | const |  |
| 11464 | `setSessionSwitch` | fn |  |
| 11472 | `addQuickPhrase` | fn |  |
| 11484 | `updateQuickPhrase` | fn |  |
| 11494 | `deleteQuickPhrases` | fn |  |
| 11501 | `normalizeQuickPhraseIds` | fn |  |
| 11513 | `exportQuickPhrases` | fn |  |
| 11529 | `importQuickPhrases` | fn |  |
| 11554 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 11563 | `selectAutomationModelById` | fn |  |
| 11576 | `confirmAutomationModel` | fn |  |
| 11584 | `restoreAutomationNewTaskPreference` | fn |  |
| 11592 | `automationAgentSurfaceExpression` | fn |  |
| 11594 | `visible` | fn |  |
| 11595 | `isNewTask` | fn |  |
| 11596 | `composerText` | fn |  |
| 11623 | `readAutomationAgentSurface` | fn |  |
| 11631 | `ensureAutomationNewTask` | fn |  |
| 11691 | `openNewAutomationAgentTask` | fn |  |
| 11710 | `currentAccount` | fn |  |
| 11716 | `a` | const |  |
| 11745 | `readAccountHealth` | fn |  |
| 11753 | `writeAccountHealth` | fn |  |
| 11769 | `recordAccountHealth` | fn |  |
| 11785 | `mergeLiveHealth` | fn |  |
| 11805 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 11813 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 11830 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 11849 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 11865 | `sweepAccountHealth` | fn |  |
| 11884 | `buildFailoverHealthFilter` | fn |  |
| 11912 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 11922 | `accountHealthEcho` | fn |  |
| 11935 | `accountBackupFile` | fn |  |
| 11956 | `gatewayStatus` | fn |  |
| 11976 | `gatewayCollectAccounts` | fn | 读本仓已登录的账号并解密（**复用 lib.js 的 [wd-compat] 解密器**，不另写一份帧格式）。 |
| 11985 | `auth` | const |  |
| 11986 | `account` | const |  |
| 12005 | `gatewayProbeHealth` | fn | 探活（/healthz 免鉴权）。null = 不可达。 |
| 12021 | `gatewayInstall` | fn | 下载 → SHA-256 校验 → 解压 → 凭证桥 → 生成 config。任一环节失败都不留半成品可用状态。 |
| 12023 | `task` | const |  |
| 12083 | `gatewayReadEnabled` | fn | 「用户是否启用」是 WorkDaddy 侧意图，与「装没装」分开记（沿用免打扰开关的记法）。 |
| 12090 | `gatewaySetEnabled` | fn |  |
| 12103 | `gatewayStart` | fn | 启动网关子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 12127 | `gatewayStop` | fn |  |
| 12135 | `refreshGatewayIfEnabled` | fn | 启动时：用户启用过就自动拉起（与 autoContinue 的「启动补写」同模式；未安装则静默跳过）。 |
| 12148 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 12153 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 12158 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 12185 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 12191 | `stashRecordByKey` | fn |  |
| 12198 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 12226 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 12249 | `buildBusyExpr` | fn |  |
| 12260 | `visibleIn` | fn | 误判空闲会在回复中输入，正文/图片回填容易失败，这是原设计刻意保守的原因。 |
| 12287 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 12298 | `busy` | const |  |
| 12329 | `resolveUsageBoardPython` | fn | 解析可用的 python：环境变量 → 托管 venv → 托管 base（版本目录）→ PATH 兜底。 |
| 12351 | `latestUsageBoardHtml` | fn | usage-board 目录里最新一份看板 HTML 文件名；没有则返回 null。 |
| 12362 | `latestUsageUnifiedHtml` | fn | 统一用量看板的产物：unified-board-<stamp>.html。 |
| 12376 | `creditUsageQuery` | fn |  |
| 12384 | `readUsageStatusJson` | fn |  |
| 12389 | `runUsageStatusExtractor` | fn | 跑一次第三方抽取器（只为补充指标）。失败/超时都只返回 ok:false，绝不抛。 |
| 12395 | `done` | const |  |
| 12417 | `builtinAssetsDir` | fn |  |
| 12433 | `builtinWallpaperSource` | fn |  |
| 12442 | `initBuiltinAssets` | fn |  |
| 12677 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 12704 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 12734 | `accountSwitchThemeExpression` | fn | 会被启动时的旧云端选择覆盖。这里不安装 hook，也不改其他账号或皮肤 CSS。 |
| 12779 | `preserveAccountSwitchTheme` | fn |  |
| 12796 | `nativeAppearanceSyncExpression` | fn | 的 CSS 资源；浅色/深色仍由 WorkBuddy 原生状态负责。 |
| 12799 | `removeNativeSheet` | fn |  |
| 12807 | `setAttr` | fn |  |
| 12812 | `setMode` | fn |  |
| 12823 | `sync` | fn |  |
| 12868 | `startNativeAppearanceSyncByCdp` | fn |  |
| 12873 | `releaseThemeByCdp` | fn |  |
| 12887 | `restoreNativeAppearanceByCdp` | fn |  |
| 12891 | `uid` | const |  |
| 12964 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 13008 | `loadThemePatches` | fn |  |
| 13024 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 13036 | `loadThemeVars` | fn |  |
| 13052 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 13056 | `declOf` | const |  |
| 13067 | `lead` | const |  |
| 13075 | `readBackgroundBlur` | fn |  |
| 13086 | `applyThemeByCdp` | fn |  |
| 13120 | `uid` | const |  |
| 13122 | `colors` | const |  |
| 13245 | `wbsBuiltinAppearance` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 13257 | `wbsSnapshotNativeAppearance` | fn |  |
| 13281 | `wbsClearNativeCustomCss` | fn |  |
| 13320 | `wbsWriteAppearanceState` | fn |  |
| 13328 | `wbsSyncAppearanceKeys` | fn |  |
| 13355 | `wbsPrepareNativeAppearance` | fn |  |
| 13363 | `wbsSyncNativeTheme` | fn |  |
| 13377 | `wbsSyncNativeThemeQuiet` | fn | wbsSyncNativeThemeIdempotent：250ms 守护/keeper 的周期调用路径，属性同值时不写。 |
| 13432 | `keepSelectedTheme` | fn |  |
| 13470 | `wbsHasSpecialNativeAppearance` | fn |  |
| 13495 | `wbsHoldNativeAppearance` | fn |  |
| 13567 | `clearComposerByCdp` | fn |  |
| 13620 | `fnv1a32` | fn |  |
| 13637 | `composerDraftHash` | fn |  |
| 13654 | `composerDraftExpr` | fn |  |
| 13694 | `composerDraftConsumed` | fn |  |
| 13725 | `composerSendExpr` | const |  |
| 13729 | `fiberOf` | fn |  |
| 13737 | `isStore` | fn |  |
| 13794 | `sendStashToComposer` | fn |  |
| 13800 | `guardedSend` | const |  |
| 13803 | `allItems` | const |  |
| 13812 | `s` | const |  |
| 13965 | `countBlocks` | const |  |
| 13975 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 14021 | `name` | const |  |
| 14037 | `disp` | const |  |
| 14048 | `visible` | fn |  |
| 14120 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 14134 | `readDraft` | const |  |
| 14142 | `draftConsumed` | const |  |
| 14145 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 14242 | `fetchResource` | fn |  |
| 14276 | `data` | const |  |
| 14279 | `accounts` | const |  |
| 14311 | `fetchEnterpriseResource` | fn |  |
| 14357 | `robustFetchEnterpriseResource` | fn |  |
| 14380 | `resolveEnterpriseId` | fn |  |
| 14408 | `retryDelay` | const |  |
| 14412 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 14444 | `fetchCredits` | fn |  |
| 14502 | `refreshCreditRotationAccounts` | fn |  |
| 14526 | `rememberCreditRotation` | fn |  |
| 14538 | `cachedCreditRotationAccounts` | fn |  |
| 14550 | `listDailyUsage` | fn |  |
| 14556 | `syncCurrentCreditUsage` | fn |  |
| 14559 | `task` | const |  |
| 14600 | `exportSecretKey` | fn |  |
| 14604 | `decryptLegacyExport` | fn |  |
| 14615 | `handleApiRoute` | fn |  |
| 14934 | `currentHealth` | const |  |
| 15334 | `code` | const | ⚠️「没有可委派的模型」是**用户可修正**的状态 ⇒ 400，不是 500 |
| 15680 | `uid` | const |  |
| 15743 | `d` | const |  |
| 15817 | `html` | const |  |
| 16043 | `uid` | const |  |
| 16180 | `dayOf` | const | 积分窗口与 token 窗口取同一个区间：分子分母同区间，否则 credit/1k 会被拉偏。 |
| 16237 | `finish` | const |  |
| 16314 | `pad` | const |  |
| 16322 | `prune` | const |  |
| 16515 | `worker` | const |  |
| 16552 | `uid` | const |  |
| 17147 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 17494 | `run` | const |  |
| 17744 | `targetUid` | const |  |
| 17773 | `targetUid` | const |  |
| 18124 | `id` | const |  |
| 18411 | `uid` | const |  |
| 18412 | `conv` | const |  |
| 18413 | `safe` | const |  |
| 18419 | `items` | const |  |
| 18482 | `key` | const |  |
| 18495 | `key` | const |  |
| 18510 | `key` | const |  |
| 18567 | `uid` | const |  |
| 18789 | `handleApi` | fn |  |
| 18790 | `failure` | const |  |
| 18821 | `stopCaffeinate` | fn |  |
| 18841 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 18849 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 18852 | `tick` | const |  |
| 18864 | `startCaffeinate` | fn |  |
| 18895 | `applySleepMode` | fn |  |
| 18924 | `sleepNow` | fn |  |
| 18945 | `restoreSleepMode` | fn |  |
| 18956 | `startServer` | fn |  |
| 19119 | `cleanup` | const |  |
| 19136 | `tryListen` | const |  |
| 19203 | `migrateAgentHintModel` | fn |  |
| 19206 | `cp` | const |  |
| 19269 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （21949 行 / 902 个函数）

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
| 4888 | `onDomChange` | fn |  |
| 4902 | `onInputSync` | fn |  |
| 4930 | `scheduleDomChange` | fn |  |
| 4961 | `acLimitBannerPresent` | fn |  |
| 4973 | `acLimitWatchTick` | fn |  |
| 5009 | `readFabBottom` | fn |  |
| 5016 | `clampFabBottom` | fn |  |
| 5021 | `clampFabRight` | fn |  |
| 5026 | `applyFabPosition` | fn |  |
| 5039 | `scheduleFabPos` | fn |  |
| 5047 | `positionFab` | fn |  |
| 5065 | `fixWidgetIframeBg` | fn |  |
| 5098 | `syncModernQueueSnapshot` | fn |  |
| 5204 | `dropModernOptimisticItem` | fn |  |
| 5218 | `getModernQueueSnapshot` | fn |  |
| 5233 | `findWbsAdapter` | fn |  |
| 5276 | `get` | method |  |
| 5287 | `bootstrapModernQueueBridge` | fn |  |
| 5300 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 5304 | `probe` | fn |  |
| 5327 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 5339 | `handleModernQueueActionClick` | fn |  |
| 5370 | `stashSigs` | fn |  |
| 5376 | `stashIds` | fn |  |
| 5382 | `recordStashQueueItem` | fn |  |
| 5411 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 5424 | `syncQueueDomIds` | fn |  |
| 5451 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 5482 | `watchQueueOrder` | fn |  |
| 5498 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 5509 | `guardStashedPause` | fn |  |
| 5658 | `enforceStashOrder` | fn |  |
| 5700 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 5705 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 5736 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 5823 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 5841 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 5856 | `enqueueToWorkBuddyQueue` | fn |  |
| 5920 | `crumb` | fn |  |
| 6008 | `maxW` | fn |  |
| 6009 | `maxH` | fn |  |
| 6010 | `apply` | fn |  |
| 6043 | `endDrag` | fn |  |
| 6077 | `preloadAutomationDiscovery` | fn |  |
| 6083 | `findCreditSegment` | fn |  |
| 6092 | `ensureStatusPopover` | fn |  |
| 6103 | `hideStatusPopover` | fn |  |
| 6109 | `positionStatusPopover` | fn |  |
| 6134 | `showStatusPopover` | fn |  |
| 6145 | `creditPopoverHtml` | fn |  |
| 6152 | `hideCreditTooltip` | fn |  |
| 6158 | `showCreditTooltip` | fn |  |
| 6185 | `rotationReminderEnabled` | fn |  |
| 6216 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 6222 | `sync` | fn |  |
| 6261 | `syncOpsDot` | fn |  |
| 6267 | `setOpsFlag` | fn | 供 renderFailoverCard / renderContextAuditCard 回填（函数声明会提升，可以先用后定义） |
| 6274 | `placeOpsPopover` | fn | 不用 fixed —— .wbs-panel 的 backdrop-filter 会把它降格成「相对面板」的绝对定位。 |
| 6288 | `setOpsPopover` | fn |  |
| 6330 | `idleMinutesText` | fn |  |
| 6341 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 6344 | `label` | fn |  |
| 6349 | `data` | fn |  |
| 6355 | `sep` | fn |  |
| 6356 | `gap` | fn |  |
| 6366 | `renderIdleCard` | fn |  |
| 6412 | `refreshIdleCard` | fn |  |
| 6420 | `saveIdleCard` | fn |  |
| 6480 | `failoverClock` | fn |  |
| 6485 | `failoverAccountLabel` | fn |  |
| 6494 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 6507 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 6521 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 6537 | `renderFailoverCard` | fn |  |
| 6583 | `refreshFailoverCard` | fn |  |
| 6632 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 6690 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 6713 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 6716 | `done` | fn |  |
| 6721 | `fallback` | fn |  |
| 6744 | `renderContextAuditCard` | fn |  |
| 6790 | `loadContextAuditCard` | fn |  |
| 6854 | `openAccountOrderModal` | fn |  |
| 6881 | `close` | fn |  |
| 6886 | `drawRows` | fn |  |
| 6895 | `move` | fn |  |
| 6901 | `syncMode` | fn |  |
| 6980 | `setupCreditSummary` | fn |  |
| 6989 | `hide` | fn |  |
| 6990 | `deferHide` | fn |  |
| 6991 | `show` | fn |  |
| 7025 | `openOfficialGrowthCenter` | fn |  |
| 7031 | `confirmCurrentGrowthAccount` | fn |  |
| 7042 | `setupAccountNotePopover` | fn |  |
| 7059 | `trigger` | fn |  |
| 7060 | `dirty` | fn |  |
| 7061 | `update` | fn |  |
| 7068 | `hide` | fn |  |
| 7083 | `position` | fn |  |
| 7095 | `show` | fn |  |
| 7116 | `deferHide` | fn |  |
| 7124 | `submit` | fn |  |
| 7196 | `setupDailyProgressPopover` | fn |  |
| 7203 | `findRing` | fn |  |
| 7211 | `hide` | fn |  |
| 7221 | `deferHide` | fn |  |
| 7231 | `show` | fn |  |
| 7249 | `updateDailyTravelCountdowns` | fn |  |
| 7358 | `setupModelRateLimitPopover` | fn |  |
| 7365 | `findBadge` | fn |  |
| 7373 | `hide` | fn |  |
| 7383 | `deferHide` | fn |  |
| 7393 | `show` | fn |  |
| 7405 | `showSummary` | fn |  |
| 7476 | `closeSecureTransferModal` | fn |  |
| 7480 | `openSecureTransferModal` | fn |  |
| 7519 | `selectedIds` | fn |  |
| 7520 | `syncSelection` | fn |  |
| 7640 | `downloadTransfer` | fn |  |
| 7657 | `readTransferFile` | fn |  |
| 7666 | `copyPlainText` | fn |  |
| 7686 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 7702 | `onConfirm` | method |  |
| 7715 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 7739 | `openAccountImportChoice` | fn |  |
| 7759 | `sync` | fn |  |
| 7781 | `formatTokenCount` | fn |  |
| 7790 | `usageTrendChartHtml` | fn |  |
| 7798 | `usageTrendColors` | fn |  |
| 7805 | `resolveUsageColor` | fn |  |
| 7818 | `usagePieData` | fn |  |
| 7833 | `usagePieHtml` | fn |  |
| 7838 | `percent` | fn |  |
| 7839 | `description` | fn |  |
| 7840 | `legendRow` | fn |  |
| 7867 | `wireUsagePies` | fn |  |
| 7871 | `clear` | fn |  |
| 7876 | `preview` | fn |  |
| 7905 | `usageTrendGroups` | fn |  |
| 7927 | `renderUsageBreakdown` | fn |  |
| 7977 | `renderUsageTrendChart` | fn |  |
| 8049 | `hideTooltip` | fn |  |
| 8050 | `showTooltip` | fn |  |
| 8091 | `usageTimeSegmentHtml` | fn |  |
| 8099 | `onTokenStats` | fn |  |
| 8121 | `closeStats` | fn |  |
| 8150 | `usageDays` | fn |  |
| 8167 | `renderCredits` | fn |  |
| 8201 | `setCreditBusy` | fn |  |
| 8208 | `creditQueryFailed` | fn |  |
| 8215 | `showCreditJob` | fn |  |
| 8235 | `pollCreditJob` | fn |  |
| 8248 | `loadCredits` | fn |  |
| 8298 | `load` | fn | 就失去了入口 ⇒ 死代码里的副本永远看不到，只会与真实现漂移，故摘掉。 |
| 8365 | `perfTableHtml` | fn |  |
| 8402 | `onThinkingPerf` | fn |  |
| 8424 | `closePerf` | fn |  |
| 8438 | `load` | fn | 首屏慢（要扫 traces，首次 3–8 秒）⇒ 先渲染骨架再异步填表，绝不阻塞面板。 |
| 8472 | `wbsIsDarkTheme` | fn | 三维筛选（日期 × 账号 × 模型）与全部图表都在 HTML 内完成（数据内嵌 ⇒ 切筛选零延迟、断网可用）。 |
| 8484 | `onUsageBoard` | fn |  |
| 8517 | `boardUrl` | fn |  |
| 8521 | `closeBoard` | fn |  |
| 8535 | `showOverlay` | fn |  |
| 8536 | `hideOverlay` | fn |  |
| 8537 | `syncSrcBtn` | fn |  |
| 8538 | `loadBoard` | fn |  |
| 8551 | `fmtBoardTime` | fn |  |
| 8554 | `p2` | fn |  |
| 8557 | `generateBoard` | fn |  |
| 8592 | `switchTab` | fn | ===== Tab 切换 ===== |
| 8630 | `buildAutomationPane` | fn |  |
| 8634 | `defaultTask` | fn |  |
| 8637 | `triggerBadgesHtml` | fn |  |
| 8657 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 8665 | `autoProtocolLabel` | fn |  |
| 8669 | `taskStatusLabel` | fn |  |
| 8681 | `lastRunLabel` | fn |  |
| 8687 | `runFor` | fn |  |
| 8688 | `selectedIds` | fn |  |
| 8689 | `allSelected` | fn |  |
| 8690 | `syncBatchControls` | fn |  |
| 8698 | `render` | fn |  |
| 8743 | `load` | fn |  |
| 8746 | `renderExamples` | fn |  |
| 8760 | `loadAgentInfo` | fn |  |
| 8766 | `fuzzyTaskName` | fn |  |
| 8777 | `discoverySourceLabel` | fn |  |
| 8780 | `renderAutomationDiscovery` | fn |  |
| 8825 | `showAutomationDiscoveryGuide` | fn |  |
| 8835 | `showAutomationDiscovery` | fn |  |
| 8873 | `loadAutomationDiscovery` | fn |  |
| 8887 | `exampleById` | fn |  |
| 8890 | `generateAgentTask` | fn |  |
| 8908 | `finishSafetyReview` | fn |  |
| 8917 | `pollSafetyReview` | fn |  |
| 8932 | `startSafetyReview` | fn |  |
| 8943 | `closePanelModal` | fn |  |
| 8949 | `showAutomationConfirm` | fn |  |
| 8957 | `close` | fn |  |
| 8966 | `showAutomationLogs` | fn |  |
| 8993 | `close` | fn |  |
| 9009 | `showEditor` | fn |  |
| 9035 | `syncScheduleFields` | fn |  |
| 9051 | `hideEditor` | fn |  |
| 9052 | `saveEditor` | fn |  |
| 9096 | `isScheduledSendTaskUI` | fn |  |
| 9099 | `schedPad2` | fn |  |
| 9100 | `schedLocalSlot` | fn |  |
| 9103 | `schedDefaultOnceAt` | fn |  |
| 9109 | `schedWhenLabel` | fn |  |
| 9120 | `schedConversationLabel` | fn |  |
| 9131 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 9141 | `hideScheduledSend` | fn |  |
| 9143 | `showScheduledSend` | fn |  |
| 9201 | `whenValue` | fn |  |
| 9209 | `currentRequest` | fn |  |
| 9224 | `syncSummary` | fn |  |
| 9230 | `syncWhen` | fn |  |
| 9237 | `setTarget` | fn |  |
| 9250 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 9265 | `renderConversations` | fn |  |
| 9279 | `loadConversations` | fn |  |
| 9300 | `saveScheduledSend` | fn |  |
| 9376 | `mountAutomationModal` | fn |  |
| 9398 | `showCapabilities` | fn |  |
| 9408 | `showExamples` | fn |  |
| 9417 | `syncDraft` | fn |  |
| 9429 | `exportAutomationTasks` | fn |  |
| 9438 | `importIssueLabel` | fn |  |
| 9448 | `showTaskImport` | fn |  |
| 9464 | `selected` | fn |  |
| 9465 | `syncSelection` | fn |  |
| 9482 | `readAutomationImport` | fn |  |
| 9497 | `startPicker` | fn |  |
| 9509 | `wbsOfficialEsc` | fn |  |
| 9515 | `wbsOfficialCardHTML` | fn |  |
| 9541 | `wbsOfficialEmpty` | fn |  |
| 9545 | `wbsLoadOfficial` | fn |  |
| 9588 | `wbsAgentCardHTML` | fn |  |
| 9616 | `wbsLoadAgent` | fn |  |
| 9774 | `isTaskSessionRecordUI` | fn |  |
| 9779 | `canonicalWorkspaceUI` | fn |  |
| 9796 | `sessionCopyAccountLabel` | fn |  |
| 9802 | `renderSessionCopyProgress` | fn |  |
| 9833 | `scheduleSessionCopyProgressPoll` | fn |  |
| 9837 | `pollActiveSessionCopyJob` | fn |  |
| 9856 | `fmtCostInt` | fn |  |
| 9858 | `renderSessionCostCard` | fn |  |
| 9908 | `copyCurrentConversation` | fn | 取会话控制器复用本地既有 acFindConversationController（与成本卡同一个「当前会话」口径）。 |
| 9934 | `refreshSessionCost` | fn |  |
| 9964 | `startSessionCostPolling` | fn |  |
| 9973 | `stopSessionCostPolling` | fn |  |
| 9980 | `buildSessionsPane` | fn |  |
| 10091 | `renderSessionExport` | fn |  |
| 10110 | `pollSessionExport` | fn |  |
| 10132 | `cloudEls` | fn |  |
| 10144 | `cloudAccountName` | fn |  |
| 10152 | `renderCloudCard` | fn |  |
| 10203 | `checkCloudGhosts` | fn |  |
| 10225 | `runCloudPurge` | fn |  |
| 10254 | `wireCloudCard` | fn |  |
| 10278 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 10309 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 10317 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 10323 | `loadSessions` | fn |  |
| 10359 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 10369 | `canEditAutoCopy` | fn |  |
| 10373 | `sessSyncButton` | fn | 闭包外的变量在切片里不可见，用外部常量会挂。 |
| 10377 | `autoCopyButton` | fn |  |
| 10459 | `activeAutoCopyCount` | fn |  |
| 10465 | `updateSessionSummary` | fn |  |
| 10475 | `updateAutoCopyAllButton` | fn |  |
| 10483 | `toggleAutoCopyAll` | fn |  |
| 10506 | `shortWs` | fn |  |
| 10511 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 10567 | `toggleAutoCopyRule` | fn |  |
| 10598 | `updateAutoCopyButtons` | fn |  |
| 10626 | `updateSessCount` | fn |  |
| 10645 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 10654 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 10674 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 10689 | `wireSessionsPane` | fn |  |
| 10924 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 10978 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 11077 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 11119 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 11166 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 11184 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11208 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 11307 | `selectedSessIds` | fn |  |
| 11310 | `showSessModal` | fn |  |
| 11326 | `buildModelsPane` | fn |  |
| 11357 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 11364 | `modelDetailsHtml` | fn |  |
| 11373 | `modelRowHtml` | fn |  |
| 11411 | `kindLabelOf` | fn |  |
| 11418 | `agentBlockHtml` | fn | 每行底部的「子 Agent」区块。⚠️ 只在「当前模型」tab 显示（备选模型没生效 ⇒ 统计无意义）。 |
| 11463 | `renderAgentSummary` | fn | 顶部汇总条（**只在「当前模型」tab 显示**）。 |
| 11494 | `loadAgentStats` | fn | 拉使用统计（**独立降级**：失败只影响统计区，不影响模型列表）。 |
| 11507 | `saveAgentEntry` | fn | 保存单个模型的子 Agent 声明（改动即存；失败回滚控件）。 |
| 11523 | `loadModels` | fn |  |
| 11547 | `updateModelCounts` | fn |  |
| 11557 | `renderModels` | fn |  |
| 11604 | `updateModelBatchState` | fn |  |
| 11619 | `showModelConfirm` | fn |  |
| 11633 | `closeThirdPartyMenu` | fn |  |
| 11639 | `openThirdPartyModels` | fn |  |
| 11764 | `wireModelsPane` | fn |  |
| 11926 | `findModelBackup` | fn |  |
| 11933 | `openModelEdit` | fn |  |
| 11967 | `buildThemePane` | fn | ===== 主题 pane（构建：头像 + 悬浮机器人 + 主题选择 + WorkDaddy 壁纸）===== |
| 12032 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 12160 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 12179 | `wirePcPane` | fn |  |
| 12212 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 12317 | `syncLangSeg` | fn |  |
| 12344 | `wireTelemetrySettings` | fn |  |
| 12348 | `renderTelemetryState` | fn |  |
| 12386 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 12502 | `updateLogTimestamp` | fn |  |
| 12507 | `appendUpdateLog` | fn |  |
| 12520 | `formatDownloadRate` | fn |  |
| 12526 | `formatDownloadEta` | fn |  |
| 12534 | `formatDownloadTransfer` | fn |  |
| 12547 | `formatUpdateFailure` | fn |  |
| 12561 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 12580 | `openWindowsInstaller` | fn |  |
| 12602 | `showWindowsInstallerReady` | fn |  |
| 12616 | `openWindowsInstallerAfterDownload` | fn |  |
| 12650 | `pollUpdateProgress` | fn |  |
| 12659 | `renderRebootUi` | fn |  |
| 12765 | `syncWallpaperCardVisibility` | fn |  |
| 12778 | `syncThemeTakeoverVisibility` | fn | 关闭接管后只隐藏主题外观选项；头像和悬浮机器人独立于主题接管。 |
| 12788 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 12977 | `gwCardEl` | fn | 面板只负责展示与触发 —— 判据与实现全在 scripts/api-gateway.js。 |
| 12978 | `gwBtn` | fn |  |
| 12983 | `gwRender` | fn |  |
| 12999 | `gwRefresh` | fn |  |
| 13004 | `gwAction` | fn |  |
| 13018 | `buildGatewayCard` | fn |  |
| 13074 | `wireEnhancePane` | fn |  |
| 13107 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 13115 | `loadWallpapers` | fn |  |
| 13223 | `setOpen` | fn |  |
| 13259 | `setupFabDrag` | fn |  |
| 13293 | `finishFabDrag` | fn |  |
| 13323 | `isDragging` | method |  |
| 13356 | `closeLoginModal` | fn |  |
| 13365 | `openLoginChoice` | fn |  |
| 13469 | `startSeamlessLogin` | fn |  |
| 13564 | `loadThemes` | fn |  |
| 13571 | `applyTheme` | fn |  |
| 13579 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 13597 | `openWebsite` | method |  |
| 13602 | `unlockDebug` | method |  |
| 13625 | `getItem` | method |  |
| 13626 | `setItem` | method |  |
| 13627 | `removeItem` | method |  |
| 13639 | `rememberAvatarWrapper` | fn |  |
| 13645 | `rememberAvatarImage` | fn |  |
| 13651 | `restoreAvatarDom` | fn |  |
| 13665 | `svgToPng` | fn | SVG → PNG dataURL |
| 13686 | `applyAvatar` | fn |  |
| 13755 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 13796 | `hexOf` | fn |  |
| 13799 | `mixArr` | fn |  |
| 13800 | `extractPalette` | fn |  |
| 13834 | `imageToTheme` | fn |  |
| 13923 | `syncAskSwitch` | fn |  |
| 13975 | `ndEl` | fn |  |
| 13978 | `ndRefreshCount` | fn |  |
| 13988 | `ndSwitchEl` | fn |  |
| 13993 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 14033 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 14067 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 14083 | `ndTitle` | fn |  |
| 14090 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 14109 | `cleanup` | fn |  |
| 14113 | `onClick` | fn |  |
| 14126 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 14133 | `applyNoDisturbState` | fn |  |
| 14225 | `acLogLine` | fn |  |
| 14230 | `acLog` | fn |  |
| 14240 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 14249 | `acSessionTitle` | fn |  |
| 14257 | `acMonitorLog` | fn |  |
| 14264 | `acScheduleMonitorLogRender` | fn |  |
| 14274 | `acResetState` | fn |  |
| 14306 | `acShowStatus` | fn |  |
| 14312 | `acHideStatus` | fn |  |
| 14317 | `acStartStatusAnim` | fn |  |
| 14318 | `acStopStatusAnim` | fn |  |
| 14321 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 14334 | `acNotifyLimit` | fn |  |
| 14355 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 14372 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 14382 | `acHasCompletionActions` | fn |  |
| 14401 | `acSwitchConversationId` | fn | 读不到就返回空串 —— 不能为了「带上一个 id」把切换本身拖挂。 |
| 14409 | `acHasErrorSignal` | fn |  |
| 14423 | `acLooksTruncated` | fn |  |
| 14431 | `acReplyDecision` | fn |  |
| 14443 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 14459 | `acIsBusy` | fn |  |
| 14464 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 14472 | `acComposerText` | fn |  |
| 14485 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 14501 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 14522 | `acPressEnter` | fn |  |
| 14531 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 14541 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 14558 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 14580 | `acControllerComposerEmpty` | fn |  |
| 14588 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 14635 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 14672 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 14710 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 14758 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 14764 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 14813 | `acCaptureControllerError` | fn |  |
| 14827 | `acRecordModelRateLimit` | fn |  |
| 14854 | `acControllerSnapshot` | fn |  |
| 14912 | `acControllerCheck` | fn |  |
| 14986 | `acBindController` | fn |  |
| 15019 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 15114 | `acScheduleSettle` | fn |  |
| 15127 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 15150 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 15158 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 15171 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 15270 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 15326 | `acStopLegacyMonitor` | fn |  |
| 15347 | `acMultiUpdateStatus` | fn |  |
| 15361 | `acMultiCreateSession` | fn |  |
| 15393 | `acMultiStatusFromResource` | fn |  |
| 15398 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 15426 | `acMultiReconcileSidebar` | fn |  |
| 15459 | `sessionDirtyResourceRecords` | fn |  |
| 15470 | `bindSessionDirtyMonitor` | fn |  |
| 15502 | `acMultiBindSessionResource` | fn |  |
| 15515 | `acMultiUnbindSessionResource` | fn |  |
| 15524 | `acMultiSchedule` | fn |  |
| 15533 | `acMultiSend` | fn |  |
| 15576 | `acMultiCheckSession` | fn |  |
| 15675 | `acMultiBindController` | fn |  |
| 15726 | `acMultiFinishSession` | fn |  |
| 15735 | `acMultiDetachController` | fn |  |
| 15744 | `acMultiProbeSidebarApproval` | fn |  |
| 15801 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 15824 | `acCdpClick` | fn |  |
| 15832 | `acAutoApproveClickItem` | fn |  |
| 15851 | `acAutoApproveItemByTitle` | fn |  |
| 15863 | `acAutoApprovePendingOnce` | fn |  |
| 16001 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 16046 | `acAutoApproveFastStart` | fn |  |
| 16056 | `acAutoApproveFastStop` | fn |  |
| 16060 | `acMultiDiscover` | fn |  |
| 16096 | `acStartMultiMonitor` | fn |  |
| 16115 | `acStopMultiMonitor` | fn |  |
| 16133 | `acStartMonitor` | fn |  |
| 16138 | `acStopMonitor` | fn |  |
| 16144 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 16155 | `acMonitorStatusLabel` | fn |  |
| 16164 | `acMonitorSafeDetail` | fn |  |
| 16176 | `acRenderMonitorLogModal` | fn |  |
| 16228 | `wireAutoContinuePane` | fn |  |
| 16258 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 16404 | `syncAutoContinue` | fn |  |
| 16409 | `applyAutoContinueState` | fn |  |
| 16422 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 16432 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 16438 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 16472 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 16490 | `stopNoDisturbAutoApprove` | fn |  |
| 16495 | `scheduleNdScan` | fn |  |
| 16499 | `ndQueueScanRoot` | fn |  |
| 16519 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 16541 | `ndNormalizeLabel` | fn |  |
| 16545 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 16553 | `ndClassifyApprovalCandidate` | fn |  |
| 16564 | `ndSessionIdForNode` | fn |  |
| 16570 | `ndApprovalContext` | fn |  |
| 16606 | `scanNoDisturbApproval` | fn |  |
| 16636 | `toNdAudit` | fn |  |
| 16644 | `getSleepMode` | fn |  |
| 16649 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 16667 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 16699 | `discoverSleepSessionBusy` | fn |  |
| 16730 | `isAnySessionBusy` | fn |  |
| 16744 | `startUntilDoneCheck` | fn |  |
| 16764 | `stopUntilDoneCheck` | fn |  |
| 16770 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 16810 | `fmtDateTime` | fn | 渲染账号列表 |
| 16817 | `fmtDateTimeSeconds` | fn |  |
| 16824 | `fmtCredits` | fn |  |
| 16831 | `fmtCreditExpiry` | fn |  |
| 16844 | `creditTip` | fn |  |
| 16856 | `creditBarHtml` | fn |  |
| 16873 | `todayUsageHtml` | fn |  |
| 16881 | `accountStatusTagsHtml` | fn |  |
| 16886 | `checkinBadgeHtml` | fn |  |
| 16895 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 16911 | `modelRateLimitTip` | fn |  |
| 16920 | `modelRateLimitBadgeHtml` | fn |  |
| 16932 | `modelRateLimitPopoverHtml` | fn |  |
| 16949 | `modelRateLimitSummaryPopoverHtml` | fn |  |
| 16971 | `creditBlockHtml` | fn |  |
| 16992 | `nearestCreditExpiry` | fn |  |
| 17004 | `sortAccountsByCreditExpiry` | fn |  |
| 17024 | `reorderAccountCards` | fn |  |
| 17037 | `mergeAccountSnapshot` | fn |  |
| 17063 | `dailyProgressLabel` | fn |  |
| 17089 | `dailyRingsSvg` | fn |  |
| 17096 | `dailyRingsHtml` | fn |  |
| 17105 | `formatDailyTravelCountdown` | fn |  |
| 17116 | `dailyTravelCountdownText` | fn |  |
| 17122 | `dailyCatDetail` | fn |  |
| 17141 | `formatGrowthTaskDeadline` | fn |  |
| 17149 | `sortGrowthTasks` | fn |  |
| 17167 | `growthTaskActions` | fn |  |
| 17172 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 17184 | `growthAutoOf` | fn |  |
| 17188 | `growthAutoActionFor` | fn |  |
| 17197 | `startGrowthAuto` | fn |  |
| 17225 | `pollGrowthAuto` | fn |  |
| 17265 | `stopGrowthAutoPoll` | fn |  |
| 17273 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 17287 | `growthTaskRewardHtml` | fn |  |
| 17299 | `dailyProgressPopoverHtml` | fn |  |
| 17443 | `updateDailyProgressCells` | fn |  |
| 17466 | `refreshDailyProgressAccount` | fn |  |
| 17494 | `fetchDailyProgressForAccounts` | fn |  |
| 17521 | `accountCardLayoutKey` | fn |  |
| 17541 | `fmtBytes` | fn |  |
| 17551 | `fmtDuration` | fn |  |
| 17560 | `autoCopyTotalFailed` | fn |  |
| 17571 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 17577 | `autoCopyConflictTitle` | fn |  |
| 17583 | `autoCopyConflictDetail` | fn |  |
| 17593 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 17615 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 17621 | `autoCopyProgressEls` | fn |  |
| 17634 | `hideAutoCopyProgress` | fn |  |
| 17641 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 17746 | `scheduleAutoCopyHide` | fn |  |
| 17768 | `spaceNum` | fn |  |
| 17773 | `spaceShare` | fn |  |
| 17779 | `spaceTimeText` | fn |  |
| 17783 | `pad` | fn |  |
| 17787 | `spaceBaseName` | fn |  |
| 17792 | `spaceScanEls` | fn |  |
| 17809 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 17831 | `hideSpaceScanBox` | fn |  |
| 17837 | `stopSpacePolling` | fn |  |
| 17842 | `spaceJobSub` | fn |  |
| 17849 | `renderSpaceJob` | fn |  |
| 17866 | `spaceRowHtml` | fn |  |
| 17877 | `spaceRestRow` | fn |  |
| 17885 | `renderSpaceEmpty` | fn |  |
| 17902 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 17910 | `spaceSubText` | fn |  |
| 17929 | `spaceSortOf` | fn |  |
| 17937 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 17945 | `spaceSortName` | fn |  |
| 17952 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 17973 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 17991 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 17998 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 18009 | `renderSpaceResult` | fn |  |
| 18126 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 18144 | `scheduleSpacePoll` | fn |  |
| 18152 | `pollSpaceScan` | fn |  |
| 18175 | `startSpaceScan` | fn |  |
| 18196 | `cancelSpaceScan` | fn |  |
| 18208 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 18230 | `buildSpacesPane` | fn |  |
| 18263 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 18329 | `pollAutoCopyJob` | fn |  |
| 18336 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 18346 | `render` | fn |  |
| 18508 | `maskAccountName` | fn |  |
| 18516 | `maskAccountId` | fn |  |
| 18527 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 18553 | `toggleAccountMask` | fn |  |
| 18559 | `refresh` | fn |  |
| 18591 | `updateAccountSummary` | fn |  |
| 18616 | `rotationToday` | fn |  |
| 18621 | `closeRotationNotice` | fn |  |
| 18631 | `showRotationNotice` | fn |  |
| 18657 | `place` | fn |  |
| 18712 | `formatRotationEta` | fn |  |
| 18721 | `formatRotationDuration` | fn |  |
| 18732 | `checkCreditRotationAfterSession` | fn |  |
| 18734 | `run` | fn |  |
| 18756 | `updateCheckinCells` | fn |  |
| 18828 | `fetchActivityForAccounts` | fn |  |
| 18837 | `worker` | fn |  |
| 18888 | `requestCredit` | fn |  |
| 18914 | `updateCreditSummaryFromAccounts` | fn |  |
| 18923 | `refreshCreditForAccount` | fn |  |
| 18955 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 18960 | `settleBatch` | fn |  |
| 18970 | `queryAccount` | fn |  |
| 19021 | `updateCreditCell` | fn |  |
| 19065 | `updateDebugPanel` | fn |  |
| 19085 | `onDebugKey` | fn |  |
| 19094 | `markHealthGeneration` | fn |  |
| 19103 | `isHealthStopControl` | fn |  |
| 19108 | `isHealthSendControl` | fn |  |
| 19199 | `readTokenRateEnabled` | fn | 常开会让用户把估算当精确值；需要时在 面板 → 会话 → token 速度读数 手动打开，一旦手动开过就记住。 |
| 19203 | `writeTokenRateEnabled` | fn |  |
| 19208 | `applyTokenRateEnabled` | fn | 开关变化时立即生效：关 ⇒ 立刻隐藏并停算；开 ⇒ 恢复上一次读数、并重算。 |
| 19224 | `readTokenRatePos` | fn | 读用户拖动后保存的视口坐标；无有效值返回 null。 |
| 19235 | `saveTokenRatePos` | fn |  |
| 19243 | `tokenRateDefaultPos` | fn | 默认位 = 输入框下方空置带左侧、垂直居中。量不到返回 null（下次再试）。 |
| 19255 | `clampTokenRatePos` | fn | 夹进视口（留 4px 边距）。仅在交互 / 定位路径调用。 |
| 19264 | `applyTokenRatePos` | fn |  |
| 19270 | `reuseOrBuildTokenRateEl` | fn | 复用页面上已有的读数节点，否则新建；两者都补挂拖动。 |
| 19299 | `showTokenRateDragShield` | fn |  |
| 19311 | `hideTokenRateDragShield` | fn |  |
| 19321 | `setupTokenRateDrag` | fn | 小框就再也收不到 pointermove。而拖动本来就必须跟手到框外，所以直接吃 window 事件最稳。 |
| 19341 | `onWinMove` | fn |  |
| 19353 | `finishTokenRateDrag` | fn |  |
| 19407 | `readRateEstTokens` | fn | 仍是估算（真实用量只能从 usage 记录拿），但比一刀切贴近。只用 querySelectorAll + textContent，不触发 reflow。 |
| 19432 | `ensureTokenRateEl` | fn | 取（必要时新建）读数节点。常驻 body 直下 + position:fixed；无用户位置时贴输入框下方默认位。 |
| 19443 | `setTokenRateBadge` | fn |  |
| 19469 | `updateTokenRateBadge` | fn |  |
| 19631 | `mdqvT` | fn | 去重不用数组：直接在 tab 元素上打 __wbsAdoptSkip（随元素移除自动回收） |
| 19633 | `mdqvReadEnabled` | fn |  |
| 19636 | `mdqvWriteEnabled` | fn |  |
| 19639 | `mdqvReadAdopt` | fn |  |
| 19642 | `mdqvWriteAdopt` | fn |  |
| 19647 | `mdqvFindPathByName` | fn | 用产物文件名在页面里反查绝对路径（正文产物卡 / 产物面板条目都带 data-dir）。 |
| 19668 | `mdqvAdoptTick` | fn | 成本：一次 querySelector 实测 0.02 ms 级，600 ms 一次 ⇒ 可忽略。 |
| 19688 | `mdqvAdoptStart` | fn |  |
| 19702 | `mdqvFileUrl` | fn | 不编码会因空格/中文导致 fetch 失败；整体 encodeURI 又会把已有的 % 二次编码。 |
| 19714 | `mdqvNormPath` | fn | 「未编码绝对路径」，否则会拼出 file:///file:///… 或中文二次编码。 |
| 19726 | `mdqvShortPath` | fn | 完整路径仍放在 title 里可悬停查看。 |
| 19737 | `mdqvRootRect` | fn | 面板要贴住的区域：整个应用的可见区（#root），拿不到就退回 window。 |
| 19745 | `mdqvDefaultWidth` | fn | 默认宽度：对齐官方文档视图的观感（约内容区 1/3），并夹到可用范围。 |
| 19753 | `mdqvReadWidth` | fn |  |
| 19760 | `mdqvWriteWidth` | fn |  |
| 19773 | `mdqvPlace` | fn |  |
| 19784 | `mdqvDetachShellGuard` | fn |  |
| 19790 | `mdqvReapply` | fn | 重算并写回让位量。观察者与窗口 resize 都走这里。 |
| 19813 | `mdqvAttachShellGuard` | fn | 1936 ⇄ 2296 之间跳（连带把对话区右边缘推过我的面板左边缘）。两个节点都守。 |
| 19829 | `mdqvApplyShift` | fn | 对话区会滑到面板底下。用父容器当前宽度反推，两种状态都自洽。 |
| 19858 | `mdqvRestoreShift` | fn |  |
| 19890 | `wbsHlClass` | fn |  |
| 19899 | `wbsHighlight` | fn | 高亮入口：返回**已转义**的 HTML 片段。 |
| 19932 | `wbsSafeImg` | fn | 其余属性一律丢弃 —— 防止 md 里塞 onerror 之类的注入面。 |
| 19943 | `mdqvInline` | fn | &amp; 当 URL 二次转义」这类双重转义（URL 进属性位一律走 escAttr）。 |
| 19984 | `mdqvRender` | fn | 分隔线 / 行内语法。**刻意不做**数学与 mermaid —— 遇到就给一行提示，不静默丢内容。 |
| 19988 | `flushPara` | fn |  |
| 19993 | `flushQuote` | fn |  |
| 19998 | `flushList` | fn |  |
| 20003 | `flushAll` | fn |  |
| 20004 | `warn` | fn |  |
| 20005 | `closeFence` | fn |  |
| 20019 | `cellsOf` | fn |  |
| 20025 | `alignsOf` | fn |  |
| 20123 | `mdqvCopyText` | fn | 复制文本（面板内代码块的「复制」用；不依赖 mdqvOpen 内的 flash）。 |
| 20151 | `mdqvBindCodeCopy` | fn | 给代码块顶栏的「复制」按钮接线（面板内走真实监听器；导出的离线页走内联脚本）。 |
| 20166 | `mdqvClose` | fn |  |
| 20181 | `mdqvOpen` | fn |  |
| 20389 | `mdqvStandalone` | fn | 跟随系统深色偏好。样式刻意不复用注入页那份（那份依赖 --wb-* 变量，外部没有）。 |
| 20448 | `mdqvInstall` | fn |  |
| 20483 | `registerBuild` | fn |  |
| 20492 | `start` | fn |  |
| 20505 | `destroyWidget` | fn |  |
| 21942 | `refresh` | method |  |
| 21944 | `getLanguage` | method |  |
| 21945 | `setLanguage` | method |  |

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

## scripts/win-launcher.js  （1891 行 / 101 个函数）

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
| 1374 | `isAccessDeniedStopError` | fn |  |
| 1391 | `tryStopNativeWorkBuddy` | fn |  |
| 1406 | `findWorkBuddyNative` | fn |  |
| 1418 | `add` | const |  |
| 1502 | `stopVerifiedLegacyManagedLifecycle` | fn |  |
| 1510 | `nativeDaemonDiagnostics` | fn |  |
| 1549 | `nativeCdpDiagnostics` | fn |  |
| 1574 | `nativeDaemonStatusMatches` | fn |  |
| 1587 | `waitForNativeDaemon` | fn |  |
| 1596 | `stopNativeLifecycle` | fn |  |
| 1606 | `ensureDaemonNative` | fn |  |
| 1623 | `startWatchdog` | const |  |
| 1655 | `waitForWorkBuddyCdpNative` | fn |  |
| 1658 | `start` | const |  |
| 1711 | `nativeLaunchFailed` | fn |  |
| 1718 | `nativeStartupMain` | fn |  |

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

合计 **1960** 个函数。
