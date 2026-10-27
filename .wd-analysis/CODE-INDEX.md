# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-10-27 07:34:53
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （20808 行 / 687 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 67 | `resolveDaemonPrivilege` | fn |  |
| 287 | `readAutomationsTolerant` | fn |  |
| 368 | `dshOpsFindNodeExe` | fn | 探测 WorkBuddy 自带的 node（mcp.json 里 dsh-ops 条目需要绝对路径）。 |
| 381 | `dshOpsInspectDir` | fn | 读某目录下的部署状态（不抛异常）。 |
| 400 | `dshOpsReadMcp` | fn | 读 mcp.json（严格：存在但损坏时抛错，绝不覆盖用户配置）。 |
| 410 | `dshOpsStatus` | fn | 综合状态：安装 / 注册 / 启用。 |
| 438 | `dshOpsHttpGet` | fn | 下载（跟随重定向，120s 超时，200MB 上限）。 |
| 466 | `dshOpsUntar` | fn | 最小 tar 解析（npm tarball 为 ustar；只取普通文件，其余跳过）。 |
| 487 | `dshOpsVerifyIntegrity` | fn | sha512 完整性校验（integrity 形如 sha512-<base64>）。 |
| 495 | `dshOpsRegister` | fn | 把 dir 写成 mcp.json 里的 fastctx + dsh-ops 两条（幂等，保留既有 disabled 状态）。 |
| 508 | `dshOpsInstall` | fn | 安装：复用已有部署优先；否则从 npm 下载并校验后落盘。 |
| 565 | `dshOpsToggle` | fn | 启用 / 停用（只改 mcp.json 两条的 disabled）。 |
| 577 | `dshOpsUninstall` | fn | 从 mcp.json 注销；purge=true 时另删 WorkDaddy 自己装的目录（有 manifest 才删）。 |
| 1015 | `persistScheduleLedger` | fn |  |
| 1025 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 1045 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 1065 | `scheduleVerifyNotify` | fn |  |
| 1075 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 1082 | `nameOf` | const |  |
| 1132 | `waitForManualCdpReady` | fn |  |
| 1142 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 1143 | `valid` | const |  |
| 1169 | `diagnosticsEnabled` | fn |  |
| 1177 | `redactDiagnosticText` | fn |  |
| 1190 | `shouldPersistBreadcrumb` | fn |  |
| 1196 | `validCdpPort` | fn |  |
| 1200 | `readCdpPortFile` | fn |  |
| 1209 | `writeCdpPortFile` | fn |  |
| 1224 | `readUiPortFile` | fn |  |
| 1228 | `writeUiPortFile` | fn |  |
| 1243 | `cdpPortCandidates` | fn |  |
| 1245 | `add` | const |  |
| 1253 | `isLocalPortAvailable` | fn |  |
| 1257 | `finish` | const |  |
| 1272 | `findAvailableCdpPort` | fn |  |
| 1279 | `selectCdpPort` | fn |  |
| 1355 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 1360 | `updateDebug` | fn |  |
| 1361 | `scrub` | const |  |
| 1391 | `writeUpdateAttempt` | fn |  |
| 1402 | `macWorkDaddyAppPath` | fn |  |
| 1425 | `resolveApplyUpdateVbs` | fn |  |
| 1444 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1457 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1469 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1498 | `githubAuthHeaders` | fn |  |
| 1508 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1532 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1534 | `fileName` | const |  |
| 1539 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1553 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1562 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1576 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1586 | `normalizeAssetSha256` | fn |  |
| 1591 | `expectedUpdateSha256` | fn |  |
| 1596 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1648 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1692 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1751 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1784 | `readUpstreamCache` | const |  |
| 1832 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1840 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1866 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1875 | `downloadUpdateInternal` | fn |  |
| 1933 | `cleanupTemp` | const |  |
| 1935 | `failDownload` | const |  |
| 2021 | `sha256File` | fn | 计算文件 SHA-256 |
| 2025 | `inspectPackagedApp` | fn |  |
| 2042 | `packagedAppVersionError` | fn |  |
| 2056 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 2110 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 2118 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 2158 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 2225 | `scheduleOAuthStateCleanup` | fn |  |
| 2231 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 2252 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 2281 | `accData` | const |  |
| 2293 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 2341 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 2366 | `markAttemptFailure` | const |  |
| 2375 | `markSpawnFailure` | const |  |
| 2497 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2512 | `log` | fn |  |
| 2523 | `isLockPermissionError` | fn |  |
| 2527 | `reportDaemonLockFallback` | fn |  |
| 2537 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2572 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2629 | `releaseDaemonLock` | fn |  |
| 2642 | `scheduleBackup` | fn |  |
| 2716 | `settlePendingReloadInjection` | fn |  |
| 2728 | `armPendingReloadInjection` | fn |  |
| 2750 | `runPendingReloadInjection` | fn |  |
| 2777 | `findCdpEndpoint` | fn |  |
| 2786 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2821 | `targetsBelongToProfile` | fn |  |
| 2841 | `isWorkBuddyCdpTarget` | fn |  |
| 2847 | `getPageTarget` | fn |  |
| 2853 | `cleanupForeignInjectedTargets` | fn |  |
| 2861 | `cleanupForeignInjectedTarget` | fn |  |
| 2870 | `finish` | const |  |
| 2913 | `cdpFocusDiagnostics` | fn |  |
| 2927 | `cdpMouseClick` | fn |  |
| 2950 | `cdpSend` | fn |  |
| 2968 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2969 | `raw` | const |  |
| 2981 | `connectCdp` | fn |  |
| 3058 | `waitForPageReadyThenDispatch` | fn |  |
| 3060 | `retry` | const |  |
| 3073 | `dispatchAutomationEvent` | fn |  |
| 3109 | `onCdpEvent` | fn |  |
| 3117 | `url` | const |  |
| 3207 | `resetClientDebugState` | fn |  |
| 3217 | `updateClientDebugState` | fn | clientRunning: true=进程在跑 / false=没跑 / null=未知（探测失败时不计数，避免误报） |
| 3239 | `safeClientRunning` | fn | __wbsClientDebugStateBlockEnd |
| 3268 | `lightClientRunning` | fn | 本函数只回答「在不在跑」。 |
| 3312 | `clientRunningRefreshDelay` | fn | 不提供 process，顶层读取会直接抛 ReferenceError。 |
| 3320 | `refreshClientRunning` | fn |  |
| 3342 | `startClientRunningMonitor` | fn | --probe-client-running 也会加载本文件，提前刷新会递归拉起探测子进程。 |
| 3350 | `cdpLoop` | fn |  |
| 3386 | `ideSend` | fn |  |
| 3405 | `ideInjectPage` | fn |  |
| 3452 | `ideConnectPage` | fn |  |
| 3510 | `ideSyncScan` | fn |  |
| 3543 | `reloadIdeWorkbenchWindows` | fn | 会触发 clearHistoryIndexCache。reload 后 loadEventFired 处理器会自动补注入。 |
| 3557 | `reloadWorkBuddyPage` | fn |  |
| 3559 | `withTimeout` | const |  |
| 3601 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 3724 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 3738 | `resolveWorkBuddyBinary` | fn |  |
| 3741 | `tryFile` | const |  |
| 3753 | `psCmd` | const |  |
| 3782 | `addCandidate` | const |  |
| 3826 | `psQuote` | const |  |
| 3843 | `runCommand` | fn |  |
| 3850 | `finish` | const |  |
| 3874 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3903 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3919 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3936 | `linuxWorkBuddyPids` | fn |  |
| 3960 | `workBuddyRunning` | fn |  |
| 3977 | `waitForWorkBuddyExit` | fn |  |
| 3992 | `waitForWorkBuddyExitTolerant` | fn |  |
| 4004 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 4050 | `detail` | const |  |
| 4082 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 4108 | `resolveLauncherHome` | fn |  |
| 4118 | `resolveLinuxLaunchTarget` | fn |  |
| 4133 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 4214 | `clickByText` | fn |  |
| 4260 | `findByText` | fn |  |
| 4289 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 4295 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 4298 | `claimLog` | fn |  |
| 4306 | `sleep` | fn |  |
| 4311 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 4358 | `automationStateFile` | const |  |
| 4359 | `readAutomationState` | fn |  |
| 4362 | `writeAutomationState` | fn |  |
| 4368 | `automationAccountStatus` | fn |  |
| 4402 | `automationDeepLocatorExpression` | fn |  |
| 4417 | `first` | fn |  |
| 4422 | `choose` | fn |  |
| 4423 | `firstByAttribute` | fn |  |
| 4433 | `automationDomAction` | fn |  |
| 4434 | `assertActive` | const |  |
| 4447 | `read` | const |  |
| 4503 | `automationHttpRequest` | fn |  |
| 4526 | `automationPublicRun` | fn |  |
| 4534 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 4549 | `automationPanelSetOpen` | fn |  |
| 4557 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 4566 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 4579 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 4594 | `automationNotifyToast` | fn |  |
| 4624 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 4625 | `assertAutoCopySucceeded` | fn |  |
| 4631 | `recordAccountSyncResult` | fn |  |
| 4643 | `assertAccountSwitchIdle` | fn |  |
| 4649 | `automationSwitchProgress` | fn |  |
| 4657 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 4674 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 4680 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 4727 | `limitFailoverManualPublic` | fn |  |
| 4746 | `readLimitFailoverState` | fn |  |
| 4755 | `writeLimitFailoverState` | fn |  |
| 4766 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 4780 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 4796 | `runCdpExpression` | fn |  |
| 4807 | `readLimitBanner` | fn |  |
| 4820 | `readStructuredError` | fn |  |
| 4824 | `readLiveModel` | fn |  |
| 4828 | `setLiveModel` | fn |  |
| 4832 | `readLastUserTaskText` | fn |  |
| 4840 | `readFailoverSnapshot` | fn |  |
| 4856 | `pickWorkbuddyDaemonClient` | fn |  |
| 4858 | `walk` | fn |  |
| 4895 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4910 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4927 | `edgeSyncMappingDbPath` | fn |  |
| 4942 | `getEdgeSyncDb` | fn |  |
| 4955 | `readEdgeSyncRows` | fn |  |
| 4968 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4994 | `probeCloudConversations` | fn |  |
| 5021 | `collectCloudGhosts` | fn |  |
| 5059 | `purgeCloudConversations` | fn |  |
| 5093 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 5110 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 5128 | `purgeCloudGhostsSwitching` | fn |  |
| 5137 | `switchBack` | const |  |
| 5178 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 5188 | `limitReplyStarted` | fn |  |
| 5193 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 5200 | `findLimitFailoverTask` | fn |  |
| 5204 | `runningLimitFailoverRun` | fn |  |
| 5208 | `waitLimitVerdict` | fn |  |
| 5233 | `runLimitFailoverCore` | fn |  |
| 5264 | `hits` | const |  |
| 5553 | `buildLimitFailoverPorts` | fn |  |
| 5638 | `limitFailoverDesktopLogDir` | fn |  |
| 5647 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 5661 | `limitFailoverNotify` | fn |  |
| 5669 | `readLimitReplyIdle` | fn |  |
| 5673 | `limitFailoverAccountByUid` | fn |  |
| 5679 | `limitFailoverPrimaryUid` | fn |  |
| 5687 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 5693 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 5702 | `cancelLimitFailoverSwitchBack` | fn |  |
| 5715 | `limitFailoverPlanCancelled` | fn |  |
| 5719 | `finishLimitFailoverSwitchBack` | fn |  |
| 5742 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 5757 | `runLimitFailoverSwitchBack` | fn |  |
| 5758 | `isCancelled` | const |  |
| 5759 | `elapsedMs` | const |  |
| 5760 | `stopIfUnsafe` | const |  |
| 5880 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5915 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5977 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5987 | `readSessionActivity` | fn |  |
| 5992 | `idleSwitchbackPublicState` | fn |  |
| 6025 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 6103 | `idleSwitchbackTick` | fn |  |
| 6162 | `startIdleSwitchbackTicker` | fn |  |
| 6174 | `automationSwitchAccount` | fn |  |
| 6233 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 6240 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 6258 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 6271 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 6294 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 6306 | `automationAccountSwitchGuarded` | fn |  |
| 6328 | `automationNotificationNamespace` | fn |  |
| 6334 | `startAutomationRun` | fn |  |
| 6350 | `isCancelled` | const |  |
| 6353 | `appendRunLog` | const |  |
| 6368 | `panelPrepare` | const |  |
| 6380 | `withInput` | const |  |
| 6397 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 6407 | `readSession` | const | 必须保持原语义，否则会波及后面的「发送是否被受理」判定）。 |
| 6415 | `sessionAction` | const |  |
| 6423 | `openedUid` | const |  |
| 6454 | `accountUid` | const |  |
| 6550 | `completionReport` | const |  |
| 6577 | `publicAccounts` | const |  |
| 6578 | `publicCurrent` | const |  |
| 6581 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 6649 | `resumeAutomationAfterNavigation` | fn |  |
| 6660 | `todayStr` | fn |  |
| 6662 | `z` | const |  |
| 6666 | `loadCheckinCache` | fn |  |
| 6673 | `saveCheckinCache` | fn |  |
| 6696 | `accountBackupSignature` | fn | 备份文件的「指纹」（mtime+size）：文件换了，落盘的那份刷新时间就不再可信。 |
| 6705 | `loadTokenRefreshState` | fn |  |
| 6716 | `saveTokenRefreshState` | fn |  |
| 6730 | `persistedTokenRefreshState` | fn | 只有「备份文件未变」时，落盘的那份刷新时间才可信（否则宁可当没刷过）。 |
| 6736 | `rememberTokenRefreshSuccess` | fn |  |
| 6753 | `listAccountsWithRuntimeTokenCache` | fn |  |
| 6780 | `persistRefreshedAccount` | fn |  |
| 6802 | `refreshAccountBackupToken` | fn | 账号备份刷新：读 → 刷 → 按原信封加密写回。加密态在刷新前先预检可写性。 |
| 6870 | `refreshAllAccountTokensOnPanelOpen` | fn |  |
| 6872 | `task` | const |  |
| 6876 | `worker` | const |  |
| 6908 | `dailyCheckin` | fn |  |
| 6957 | `claimDailyForUid` | fn |  |
| 6966 | `performAccountCheckin` | fn |  |
| 7012 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 7078 | `desc` | const |  |
| 7123 | `buildInjectScript` | fn |  |
| 7165 | `html` | fn |  |
| 7167 | `set` | method |  |
| 7170 | `set` | method |  |
| 7173 | `value` | method |  |
| 7212 | `waitForCdpReady` | fn | c. 都不成才把原始错误交出去，由 launcher 按自己的节奏继续重试。 |
| 7225 | `ideChannelMounted` | fn |  |
| 7232 | `injectWidgetManual` | fn |  |
| 7254 | `readCdpTargets` | fn |  |
| 7265 | `readLogTail` | fn |  |
| 7276 | `collectDiagnostics` | fn |  |
| 7301 | `writeDiagnosticsSnapshot` | fn |  |
| 7345 | `codeBuddyProfileOwnerIds` | fn | 认不出来的 owner 保留（可能是删掉的账号或旧安装留下的），宁可多算也不静默丢。 |
| 7355 | `codeBuddyForeignOwnerIds` | fn |  |
| 7366 | `assertCodeBuddySessionsIdle` | fn | 渲染层问不到。运行中的会话被改归属会丢正文，所以写入前必须先问一次。 |
| 7369 | `sessions` | const |  |
| 7375 | `sqliteRun` | fn |  |
| 7378 | `sqliteQuery` | fn |  |
| 7393 | `officialSlotOf` | fn | 本地时区槽位 `YYYY-MM-DDTHH:MM`（与 scheduled-send 的 localSlot 同格式）。 |
| 7394 | `pad` | const |  |
| 7411 | `readOfficialAutomations` | fn |  |
| 7422 | `items` | const |  |
| 7456 | `findOfficialSlotConflicts` | fn |  |
| 7485 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 7504 | `createDirectoryNoFollow` | fn |  |
| 7527 | `repairMissingSessionWorkspaces` | fn |  |
| 7596 | `sessionRangeMs` | fn |  |
| 7613 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 7617 | `copyOne` | const |  |
| 7643 | `onlyCopyable` | const | 要拦的只有 socket / FIFO / 字符设备 / 块设备这类**根本无法复制**的特殊文件。 |
| 7751 | `sessionBodyMtime` | fn |  |
| 7768 | `sessionContentMtime` | fn |  |
| 7772 | `visit` | const |  |
| 7806 | `directoryStats` | fn |  |
| 7835 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 7846 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 7872 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 7887 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 7898 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 7918 | `sortAutoCopyPlanBySize` | fn |  |
| 7937 | `readCopyManifestCache` | fn |  |
| 7948 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 7957 | `deriveCopyManifestFromCache` | fn |  |
| 7984 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 7995 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 8017 | `emptyWorkspaceCounters` | fn |  |
| 8025 | `transferWorkspaceTree` | fn |  |
| 8033 | `copyFileAt` | const |  |
| 8126 | `copySessionWorkspacePayload` | fn |  |
| 8148 | `outcome` | const |  |
| 8160 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 8181 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 8315 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 8339 | `forcedSource` | const | content 模式那两道闸门用的是另一个独立布尔 forcePinnedSource（见上）。 |
| 8351 | `trackPayload` | const |  |
| 8409 | `sleepMs` | const |  |
| 8520 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 8566 | `listAutoCopyConflicts` | fn |  |
| 8579 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 8593 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 8619 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 8719 | `readNativeDeleteSweep` | fn |  |
| 8726 | `saveNativeDeleteSweep` | fn |  |
| 8739 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 8746 | `sweepNativeSessionDeletes` | fn |  |
| 8818 | `readArchiveIsolation` | fn |  |
| 8825 | `saveArchiveIsolation` | fn |  |
| 8839 | `archiveIsolationEnabled` | fn |  |
| 8844 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 8860 | `members` | const |  |
| 8928 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 8977 | `purgeLocalSessionCopyCore` | fn |  |
| 9009 | `purgeArchivedCrossAccountCopies` | fn |  |
| 9060 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 9137 | `summarizeSessionImportErrors` | fn |  |
| 9147 | `archiveRelativePath` | fn |  |
| 9151 | `collectSessionArchiveFiles` | fn |  |
| 9154 | `collect` | const |  |
| 9194 | `ensureArchiveParentNoFollow` | fn |  |
| 9213 | `restoreSessionArchiveFiles` | fn |  |
| 9236 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 9267 | `getSessionSyncCache` | fn |  |
| 9290 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 9306 | `isTaskSessionRecord` | fn |  |
| 9311 | `sqlPlaceholders` | fn |  |
| 9315 | `insertCopiedSession` | fn |  |
| 9345 | `createForkSession` | fn |  |
| 9378 | `prepareSessionExport` | fn |  |
| 9395 | `exportSessions` | fn |  |
| 9409 | `validImportedSessionUid` | fn |  |
| 9415 | `importSessions` | fn |  |
| 9419 | `importSessionArchives` | fn |  |
| 9467 | `adoptExistingCopyTarget` | fn |  |
| 9511 | `copySessionRecord` | fn |  |
| 9528 | `perform` | const |  |
| 9539 | `finishAutoDirty` | const |  |
| 9543 | `retain` | const |  |
| 9682 | `getSessionDirtyIndex` | fn |  |
| 9690 | `scheduleSessionDirtySave` | fn |  |
| 9707 | `markSessionDirty` | fn | 记一条脏标记；**只有真变化才置脏**（同一时刻的重复通知不写盘）。 |
| 9720 | `markSessionDirtyBaseline` | fn | renderer 建立基线（`body.ready`）。未建基线的账号一律 fail-open = 全当脏。 |
| 9725 | `clearSessionDirty` | fn | 清一条脏标记；`expectedAt` 不匹配就不清（**并发到来的新事件不许被旧的在飞清理抹掉**）。 |
| 9734 | `autoCopyDirtyFastpathEnabled` | fn | 批次 3 的开关：**默认关**（文件缺失 / 内容不是 {enabled:true} 都算关）。每次规划读一次。 |
| 9750 | `isAutoCopyRowCleanByDirty` | fn |  |
| 9755 | `lineageId` | const |  |
| 9764 | `buildAutoCopyPlan` | fn |  |
| 9847 | `isAutoCopyPausedError` | fn |  |
| 9854 | `beginRendererReloadPriority` | fn |  |
| 9869 | `hasPendingAutoCopyTo` | fn |  |
| 9878 | `pruneAutoCopyJobs` | fn |  |
| 9888 | `runAutoCopyQueue` | fn |  |
| 9918 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 9985 | `enterSwitchFlowRunner` | fn | 进入一个切号流程；返回**幂等**的退出函数（重复调用不会把计数减成负）。 |
| 10014 | `setSwitchFlowPhase` | fn |  |
| 10020 | `terminal` | const |  |
| 10055 | `readSwitchFlowState` | fn | 读状态（惰性过期：终态留 TTL 供渲染层读到，过期即清）。 |
| 10067 | `requestSwitchFlowCancel` | fn | 「关闭弹窗」：置取消位 + 立刻请求中止复制（worker 在下个检查点收尾，不是硬停）。 |
| 10121 | `waitPreSyncSettled` | fn |  |
| 10175 | `preSyncBeforeSwitch` | fn |  |
| 10277 | `resolveSyncNowSources` | fn |  |
| 10278 | `all` | const |  |
| 10314 | `limitFailoverSyncWaitMs` | fn |  |
| 10349 | `openConversationById` | fn |  |
| 10373 | `fastExpr` | const |  |
| 10458 | `sidebarProbe` | const |  |
| 10628 | `prepareFailoverContinuation` | fn |  |
| 10634 | `degrade` | const |  |
| 10736 | `startAutoCopyJob` | fn |  |
| 10809 | `run` | const |  |
| 10817 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11101 | `activeAutoCopyJob` | fn |  |
| 11114 | `publicAutoCopyJob` | fn |  |
| 11196 | `publicSpaceScanJob` | fn |  |
| 11220 | `buildSpaceScanResolvers` | fn |  |
| 11266 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 11278 | `startSpaceScanJob` | fn |  |
| 11368 | `isValidSessionId` | fn |  |
| 11377 | `matchedSessionIds` | fn |  |
| 11382 | `resolveManagedSessionTarget` | fn |  |
| 11395 | `isManagedDirectoryNoFollow` | fn |  |
| 11419 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 11453 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 11459 | `delOne` | const |  |
| 11503 | `json` | fn |  |
| 11534 | `isAllowedApiOrigin` | fn |  |
| 11554 | `hasApiToken` | fn |  |
| 11561 | `isApiRequestAuthorized` | fn |  |
| 11570 | `isAllowedDevtoolsOrigin` | fn |  |
| 11610 | `readBody` | fn |  |
| 11615 | `ignoreLateError` | const |  |
| 11616 | `cleanup` | const |  |
| 11626 | `finish` | const |  |
| 11632 | `fail` | fn |  |
| 11638 | `onData` | fn |  |
| 11651 | `onEnd` | fn |  |
| 11662 | `onError` | fn |  |
| 11665 | `onIncomplete` | fn |  |
| 11697 | `workbuddySettingsPath` | fn |  |
| 11701 | `readWorkbuddySettings` | fn |  |
| 11709 | `writeWorkbuddySettings` | fn |  |
| 11715 | `buildAskRuleBlock` | fn |  |
| 11720 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 11730 | `getAskModeState` | fn |  |
| 11732 | `customPrompt` | const |  |
| 11745 | `setAskMode` | fn |  |
| 11760 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 11802 | `buildZhReasoningBlock` | fn |  |
| 11807 | `stripZhReasoning` | fn | 从 customPrompt 中移除中文思考段（保留用户其它内容与决策弹窗段） |
| 11817 | `getZhReasoningState` | fn |  |
| 11819 | `customPrompt` | const |  |
| 11835 | `setZhReasoning` | fn |  |
| 11855 | `refreshZhReasoningIfEnabled` | fn | 启动时调用：如已启用中文思考，把旧的规则段替换为最新版本（用标记精确识别） |
| 11880 | `readNoDisturbState` | fn |  |
| 11883 | `state` | const |  |
| 11905 | `readNoDisturbApplied` | fn |  |
| 11909 | `hasAll` | const |  |
| 11924 | `removeListItems` | fn |  |
| 11930 | `ensureSandboxObj` | fn |  |
| 11939 | `applyNoDisturbSwitch` | fn |  |
| 11943 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 11949 | `rollback` | const |  |
| 11997 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 12012 | `noDisturbAudit` | fn |  |
| 12047 | `acAppConfigPath` | fn |  |
| 12050 | `readAppConfig` | fn |  |
| 12058 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 12063 | `acBlock` | fn |  |
| 12070 | `stripACBlocks` | fn |  |
| 12076 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 12082 | `acCustomPromptPresent` | fn |  |
| 12087 | `readAutoContinueState` | fn |  |
| 12102 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 12119 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 12133 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 12150 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 12170 | `sessBuild` | fn |  |
| 12178 | `readSessionState` | fn |  |
| 12180 | `ns` | const |  |
| 12181 | `st` | const |  |
| 12213 | `writeSessionState` | fn |  |
| 12215 | `prior` | const |  |
| 12224 | `setSessionSwitch` | fn |  |
| 12232 | `addQuickPhrase` | fn |  |
| 12244 | `updateQuickPhrase` | fn |  |
| 12254 | `deleteQuickPhrases` | fn |  |
| 12261 | `normalizeQuickPhraseIds` | fn |  |
| 12273 | `exportQuickPhrases` | fn |  |
| 12289 | `importQuickPhrases` | fn |  |
| 12314 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 12323 | `selectAutomationModelById` | fn |  |
| 12336 | `confirmAutomationModel` | fn |  |
| 12344 | `restoreAutomationNewTaskPreference` | fn |  |
| 12352 | `automationAgentSurfaceExpression` | fn |  |
| 12354 | `visible` | fn |  |
| 12355 | `isNewTask` | fn |  |
| 12356 | `composerText` | fn |  |
| 12383 | `readAutomationAgentSurface` | fn |  |
| 12391 | `ensureAutomationNewTask` | fn |  |
| 12451 | `openNewAutomationAgentTask` | fn |  |
| 12470 | `currentAccount` | fn |  |
| 12476 | `a` | const |  |
| 12505 | `readAccountHealth` | fn |  |
| 12513 | `writeAccountHealth` | fn |  |
| 12529 | `recordAccountHealth` | fn |  |
| 12545 | `mergeLiveHealth` | fn |  |
| 12565 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 12573 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 12590 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 12609 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 12625 | `sweepAccountHealth` | fn |  |
| 12644 | `buildFailoverHealthFilter` | fn |  |
| 12672 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 12682 | `accountHealthEcho` | fn |  |
| 12695 | `accountBackupFile` | fn |  |
| 12717 | `gatewayStatus` | fn |  |
| 12725 | `accountPool` | const | missing = 本仓有但池里没有（用户加的账号没进池）；stale = 池里有但本仓已删。 |
| 12771 | `gatewayCollectAccounts` | fn | 读本仓已登录的账号并解密（**复用 lib.js 的 [wd-compat] 解密器**，不另写一份帧格式）。 |
| 12780 | `auth` | const |  |
| 12781 | `account` | const |  |
| 12812 | `gatewaySyncAccounts` | fn |  |
| 12829 | `key` | const | 只在真的变了才写盘：本函数挂在每次账号备份之后，高频调用，无变化时不该碰磁盘。 |
| 12837 | `uidOf` | const |  |
| 12852 | `gatewaySyncAccountsQuiet` | fn | 同步后需要时给面板/日志一句话（安静版：只在真有变化时返回字符串）。 |
| 12867 | `gatewayProbeHealth` | fn | 探活（/healthz 免鉴权）。null = 不可达。 |
| 12886 | `gatewayFetchModels` | fn |  |
| 12918 | `sameGatewayOrigin` | fn |  |
| 12931 | `findGatewayModelEntry` | fn |  |
| 12943 | `readWorkbuddyModels` | fn |  |
| 12956 | `gatewayModelsOverview` | fn |  |
| 12994 | `by` | const |  |
| 13004 | `gatewayInstall` | fn | 下载 → SHA-256 校验 → 解压 → 凭证桥 → 生成 config。任一环节失败都不留半成品可用状态。 |
| 13006 | `task` | const |  |
| 13097 | `gatewayReadEnabled` | fn | 「用户是否启用」是 WorkDaddy 侧意图，与「装没装」分开记（沿用免打扰开关的记法）。 |
| 13104 | `gatewaySetEnabled` | fn |  |
| 13117 | `gatewayStart` | fn | 启动网关子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 13151 | `gatewayStop` | fn |  |
| 13178 | `gatewayHealthSnapshot` | fn |  |
| 13189 | `normalizeGatewayHealth` | fn | 把 /healthz 原始结果规范成面板要用的形状。 |
| 13205 | `gatewayPoolSnapshot` | fn |  |
| 13207 | `accounts` | const |  |
| 13209 | `tu` | const |  |
| 13231 | `realmTotals` | const |  |
| 13245 | `gatewayFetchJson` | fn | 带鉴权地打网关自己的 HTTP 接口（本仓持有 api_key，前端不必知道它）。 |
| 13270 | `gatewayFindPidByPort` | fn |  |
| 13285 | `gatewayLogTail` | fn | 读网关日志尾部（面板排障用；只读最后 N 行，不整份加载）。 |
| 13307 | `refreshGatewayIfEnabled` | fn |  |
| 13328 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 13333 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 13338 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 13365 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 13371 | `stashRecordByKey` | fn |  |
| 13378 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 13406 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 13429 | `buildBusyExpr` | fn |  |
| 13440 | `visibleIn` | fn | 误判空闲会在回复中输入，正文/图片回填容易失败，这是原设计刻意保守的原因。 |
| 13467 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 13478 | `busy` | const |  |
| 13509 | `resolveUsageBoardPython` | fn | 解析可用的 python：环境变量 → 托管 venv → 托管 base（版本目录）→ PATH 兜底。 |
| 13531 | `latestUsageBoardHtml` | fn | usage-board 目录里最新一份看板 HTML 文件名；没有则返回 null。 |
| 13542 | `latestUsageUnifiedHtml` | fn | 统一用量看板的产物：unified-board-<stamp>.html。 |
| 13556 | `creditUsageQuery` | fn |  |
| 13564 | `readUsageStatusJson` | fn |  |
| 13569 | `runUsageStatusExtractor` | fn | 跑一次第三方抽取器（只为补充指标）。失败/超时都只返回 ok:false，绝不抛。 |
| 13575 | `done` | const |  |
| 13597 | `builtinAssetsDir` | fn |  |
| 13613 | `builtinWallpaperSource` | fn |  |
| 13622 | `initBuiltinAssets` | fn |  |
| 13857 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 13884 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 13914 | `accountSwitchThemeExpression` | fn | 会被启动时的旧云端选择覆盖。这里不安装 hook，也不改其他账号或皮肤 CSS。 |
| 13959 | `preserveAccountSwitchTheme` | fn |  |
| 13976 | `nativeAppearanceSyncExpression` | fn | 的 CSS 资源；浅色/深色仍由 WorkBuddy 原生状态负责。 |
| 13979 | `removeNativeSheet` | fn |  |
| 13987 | `setAttr` | fn |  |
| 13992 | `setMode` | fn |  |
| 14003 | `sync` | fn |  |
| 14048 | `startNativeAppearanceSyncByCdp` | fn |  |
| 14053 | `releaseThemeByCdp` | fn |  |
| 14067 | `restoreNativeAppearanceByCdp` | fn |  |
| 14071 | `uid` | const |  |
| 14144 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 14188 | `loadThemePatches` | fn |  |
| 14204 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 14216 | `loadThemeVars` | fn |  |
| 14232 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 14236 | `declOf` | const |  |
| 14247 | `lead` | const |  |
| 14255 | `readBackgroundBlur` | fn |  |
| 14266 | `applyThemeByCdp` | fn |  |
| 14300 | `uid` | const |  |
| 14302 | `colors` | const |  |
| 14425 | `wbsBuiltinAppearance` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 14437 | `wbsSnapshotNativeAppearance` | fn |  |
| 14461 | `wbsClearNativeCustomCss` | fn |  |
| 14500 | `wbsWriteAppearanceState` | fn |  |
| 14508 | `wbsSyncAppearanceKeys` | fn |  |
| 14535 | `wbsPrepareNativeAppearance` | fn |  |
| 14543 | `wbsSyncNativeTheme` | fn |  |
| 14557 | `wbsSyncNativeThemeQuiet` | fn | wbsSyncNativeThemeIdempotent：250ms 守护/keeper 的周期调用路径，属性同值时不写。 |
| 14612 | `keepSelectedTheme` | fn |  |
| 14650 | `wbsHasSpecialNativeAppearance` | fn |  |
| 14675 | `wbsHoldNativeAppearance` | fn |  |
| 14747 | `clearComposerByCdp` | fn |  |
| 14800 | `fnv1a32` | fn |  |
| 14817 | `composerDraftHash` | fn |  |
| 14834 | `composerDraftExpr` | fn |  |
| 14870 | `codeBuddySubmitExpr` | fn |  |
| 14899 | `composerDraftConsumed` | fn |  |
| 14930 | `composerSendExpr` | const |  |
| 14934 | `fiberOf` | fn |  |
| 14942 | `isStore` | fn |  |
| 14999 | `sendStashToComposer` | fn |  |
| 15005 | `guardedSend` | const |  |
| 15008 | `allItems` | const |  |
| 15017 | `s` | const |  |
| 15170 | `countBlocks` | const |  |
| 15180 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 15226 | `name` | const |  |
| 15242 | `disp` | const |  |
| 15274 | `visible` | fn |  |
| 15347 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 15361 | `readDraft` | const |  |
| 15369 | `draftConsumed` | const |  |
| 15372 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 15483 | `fetchResource` | fn |  |
| 15517 | `data` | const |  |
| 15520 | `accounts` | const |  |
| 15552 | `fetchEnterpriseResource` | fn |  |
| 15598 | `robustFetchEnterpriseResource` | fn |  |
| 15621 | `resolveEnterpriseId` | fn |  |
| 15649 | `retryDelay` | const |  |
| 15653 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 15685 | `fetchCredits` | fn |  |
| 15743 | `refreshCreditRotationAccounts` | fn |  |
| 15767 | `rememberCreditRotation` | fn |  |
| 15779 | `cachedCreditRotationAccounts` | fn |  |
| 15791 | `listDailyUsage` | fn |  |
| 15797 | `syncCurrentCreditUsage` | fn |  |
| 15800 | `task` | const |  |
| 15841 | `exportSecretKey` | fn |  |
| 15845 | `decryptLegacyExport` | fn |  |
| 15856 | `handleApiRoute` | fn |  |
| 16175 | `currentHealth` | const |  |
| 16828 | `buildContextTiers` | const | 面板自己的 6 档预设不受影响（那是我们自己的下拉，不读这个数组）。 |
| 17034 | `uid` | const |  |
| 17097 | `d` | const |  |
| 17171 | `html` | const |  |
| 17516 | `uid` | const |  |
| 17660 | `dayOf` | const | 积分窗口与 token 窗口取同一个区间：分子分母同区间，否则 credit/1k 会被拉偏。 |
| 17717 | `finish` | const |  |
| 17794 | `pad` | const |  |
| 17802 | `prune` | const |  |
| 17995 | `worker` | const |  |
| 18032 | `uid` | const |  |
| 18627 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 18965 | `run` | const |  |
| 19215 | `targetUid` | const |  |
| 19244 | `targetUid` | const |  |
| 19595 | `id` | const |  |
| 19882 | `uid` | const |  |
| 19883 | `conv` | const |  |
| 19884 | `safe` | const |  |
| 19890 | `items` | const |  |
| 19953 | `key` | const |  |
| 19966 | `key` | const |  |
| 19981 | `key` | const |  |
| 20038 | `uid` | const |  |
| 20260 | `handleApi` | fn |  |
| 20261 | `failure` | const |  |
| 20292 | `stopCaffeinate` | fn |  |
| 20312 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 20320 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 20323 | `tick` | const |  |
| 20335 | `startCaffeinate` | fn |  |
| 20366 | `applySleepMode` | fn |  |
| 20395 | `sleepNow` | fn |  |
| 20416 | `restoreSleepMode` | fn |  |
| 20427 | `startServer` | fn |  |
| 20604 | `cleanup` | const |  |
| 20621 | `tryListen` | const |  |
| 20706 | `cleanupClientTmpOnce` | fn | 上游没有回收机制 ⇒ 这里启动跑一次 + 每 24h 一次，只删超过 7 天的条目。 |
| 20757 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （22734 行 / 923 个函数）

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
| 104 | `preserveNativePanelMount` | fn | 会话区的变更不应触发整篇文档扫描。 |
| 110 | `restore` | fn |  |
| 121 | `dispose` | fn |  |
| 136 | `createFabAppearance` | fn |  |
| 145 | `apply` | fn |  |
| 148 | `get` | method |  |
| 149 | `set` | method |  |
| 159 | `createFabQuietMode` | fn | 机器人闲置吸边：只监听指针位置，不拦截 WorkBuddy 事件；由 build lifecycle 清理。 |
| 171 | `geometry` | fn | 用未变换的尺寸计算，避免旋转/过渡中的包围盒让靠近区域来回跳动。 |
| 179 | `cancel` | fn |  |
| 183 | `wake` | fn |  |
| 220 | `isEnabled` | method |  |
| 221 | `setEnabled` | method |  |
| 226 | `destroy` | method |  |
| 233 | `classifySessionHealth` | fn | another prompt automatically when a provider stops without an explicit error. |
| 257 | `classifyAutoContinueReply` | fn | explicit error or visibly truncated reply should cause an automatic follow-up. |
| 283 | `normalizeAutoContinueError` | fn |  |
| 287 | `numberValue` | fn |  |
| 331 | `classifyAutoContinueError` | fn |  |
| 345 | `classifyAutoContinueControllerSnapshot` | fn | 空闲后仍未 complete 的助手消息才是结构化的“回复中断”证据。 |
| 366 | `autoContinueMessageText` | fn |  |
| 373 | `autoContinueControllerCompleted` | fn |  |
| 382 | `controllerAutoContinueDecision` | fn | 挡在门外，功能对这类会话彻底失效。判定与绑定必须共用同一份映射。 |
| 402 | `selectAutoContinueAssistant` | fn |  |
| 425 | `normalizeQueueText` | fn |  |
| 439 | `parseComposerContentBlock` | fn |  |
| 451 | `composerBlocksFromTree` | fn | separately from querySelectorAll loses that order when quotes are interleaved. |
| 454 | `appendText` | fn |  |
| 462 | `collect` | fn |  |
| 495 | `composerTextFromTree` | fn |  |
| 501 | `selectionQuoteMeta` | fn |  |
| 512 | `contentItemToBlock` | fn |  |
| 529 | `contentToBlocks` | fn | quotes keep their serializable metadata so the official editor can restore the tag. |
| 561 | `isStashQueueItem` | fn | forbidden because ordinary prompts commonly contain a stashed prompt. |
| 574 | `stashContentSignature` | fn |  |
| 582 | `stashContentMatches` | fn |  |
| 612 | `classifyNoDisturbApprovalCandidate` | fn | Keep this deliberately narrow: a generic "确认" button must never qualify. |
| 626 | `isSessionMonitorInProgress` | fn |  |
| 638 | `isSessionMonitorInterrupted` | fn | 同样不会绑定。 |
| 660 | `normalizeSessionMonitorStatus` | fn |  |
| 664 | `sessionMonitorLifecycleAction` | fn |  |
| 674 | `normalizeSessionMonitorResourceRecord` | fn | stale working field cannot mask a newer completed protocol status. |
| 718 | `subscribeSessionMonitorResource` | fn |  |
| 721 | `recordsFromPayload` | fn |  |
| 752 | `createSessionDirtyTracker` | fn | ids and event names, never message text or session contents. |
| 758 | `signature` | fn |  |
| 770 | `flush` | fn |  |
| 776 | `queue` | fn |  |
| 783 | `observe` | fn |  |
| 796 | `baseline` | fn |  |
| 804 | `destroy` | fn |  |
| 816 | `createSessionMonitorRegistry` | fn | surface and must not turn conversation activity into a local log file. |
| 822 | `ensure` | fn |  |
| 840 | `update` | fn |  |
| 851 | `append` | fn |  |
| 864 | `remove` | fn |  |
| 872 | `clear` | fn |  |
| 876 | `list` | fn |  |
| 886 | `conversationMessagesToMarkdown` | fn | 不搬上游那 30 个宿主函数（本地没有 wbs-session-usage-* 模块，见 reports/1.2.7 §3.2 R2/R4）。 |
| 888 | `roleOf` | fn |  |
| 894 | `blocksToMarkdown` | fn |  |
| 896 | `visit` | fn |  |
| 1899 | `wbsSystemLanguage` | fn |  |
| 1903 | `wbsNormalizeLanguage` | fn |  |
| 1908 | `escapeRegExp` | fn |  |
| 1909 | `wbsI18nBuildMatchers` | fn |  |
| 1946 | `wbsTranslateString` | fn |  |
| 1996 | `wbsIsBuiltinAutomation` | fn |  |
| 2005 | `wbsBuiltinAutomationText` | fn |  |
| 2057 | `wbsAutomationText` | fn |  |
| 2062 | `wbsAutomationEditedText` | fn |  |
| 2084 | `wbsErrGate` | fn |  |
| 2103 | `wbsReportErr` | fn |  |
| 2147 | `wbsClientVersion` | fn |  |
| 2277 | `isIdentityExpired` | fn | 今日签到状态展示：账号卡片底部与积分余额并列显示 |
| 2294 | `accountHealthLocked` | fn | 那个看 tokenExpiresAt / 签到 401，这个看 daemon 下发的账号健康视图）。 |
| 2299 | `esc` | fn |  |
| 2300 | `escAttr` | fn |  |
| 2303 | `summarizeCreditDays` | fn | 每个积分段只归入一个剩余天数桶；缺失有效期的余额不展示，不猜测到期日。 |
| 2305 | `add` | fn |  |
| 2331 | `creditOpacity` | fn |  |
| 2336 | `createAvatarLibrary` | fn |  |
| 2338 | `validImage` | fn |  |
| 2354 | `snapshot` | fn |  |
| 2355 | `commit` | fn |  |
| 2362 | `select` | method |  |
| 2366 | `add` | method |  |
| 2373 | `remove` | method |  |
| 2381 | `resolveAvatarChoice` | fn |  |
| 2387 | `checkinHtml` | fn |  |
| 2408 | `isGrowthActiveToday` | fn |  |
| 2414 | `activityStreakHtml` | fn |  |
| 2425 | `isKnownActivityStreak` | fn |  |
| 2429 | `el` | fn |  |
| 2436 | `maskPhone` | fn |  |
| 2442 | `fmtTime` | fn |  |
| 2452 | `initial` | fn |  |
| 2458 | `api` | fn |  |
| 2487 | `collectAll` | fn | 调试：递归收集所有元素（含 shadowRoot 与同域 iframe），用于抓取输入框内容 |
| 2501 | `allElements` | fn |  |
| 2514 | `captureComposer` | fn | 调试：抓取 WorkBuddy 输入框当前内容（文字/图片/附件/连接器/skill） |
| 2573 | `findComposer` | fn |  |
| 2583 | `findComposerRaw` | fn |  |
| 2630 | `composerHasContent` | fn | composerTextFromTree 跳过这两类装饰子树。 |
| 2638 | `getComposerContent` | fn | 干净地抓取输入框内容：只取 Slate 节点（不受页面装饰干扰） |
| 2654 | `getConversationId` | fn | 尽量拿到当前会话 id（URL / 当前布局选中会话 / 标题兜底） |
| 2669 | `build` | fn |  |
| 2675 | `mountPersistentOverlay` | fn |  |
| 2683 | `send` | method |  |
| 2704 | `removeTimer` | fn |  |
| 2708 | `setBuildTimeout` | fn |  |
| 2716 | `setBuildInterval` | fn |  |
| 2723 | `requestBuildFrame` | fn |  |
| 2732 | `listen` | fn |  |
| 2739 | `toast` | fn |  |
| 2743 | `receiveToast` | fn |  |
| 2777 | `switchFlowAccountLabel` | fn |  |
| 2784 | `switchFlowMaskEl` | fn |  |
| 2786 | `buildSwitchFlowMask` | fn |  |
| 2817 | `renderSwitchFlow` | fn |  |
| 2892 | `cancelSwitchFlow` | fn |  |
| 2918 | `scheduleSwitchFlowPoll` | fn |  |
| 2923 | `pollSwitchFlow` | fn |  |
| 2958 | `isVisibleHealthNode` | fn |  |
| 2966 | `findBlockingPrompt` | fn |  |
| 2995 | `findSessionError` | fn |  |
| 3015 | `readAssistantHealth` | fn |  |
| 3046 | `setSessionHealthResult` | fn |  |
| 3069 | `scanSessionHealth` | fn |  |
| 3146 | `summary` | method |  |
| 3147 | `active` | method |  |
| 3148 | `generation` | method |  |
| 3149 | `root` | method |  |
| 3153 | `summary` | method |  |
| 3154 | `active` | method |  |
| 3155 | `generation` | method |  |
| 3156 | `root` | method |  |
| 3161 | `isUsableThemeAuditRoot` | fn |  |
| 3170 | `findThemeAuditRoot` | fn |  |
| 3181 | `syncThemeAuditRoot` | fn |  |
| 3203 | `applyI18n` | fn |  |
| 3248 | `setLanguage` | fn |  |
| 3267 | `applyInjectedI18n` | fn |  |
| 3519 | `qpDiag` | fn | 面板关闭/重开：点击选项（发送/编辑/任意项）后关闭面板；重新进入按钮区恢复 hover 可展示 |
| 3532 | `mountExplorePopover` | fn | keeps it above the usage summary even when the composer creates its own layer. |
| 3538 | `listen` | fn |  |
| 3542 | `cancelClose` | fn |  |
| 3543 | `close` | fn |  |
| 3544 | `open` | fn |  |
| 3554 | `delayedClose` | fn |  |
| 3577 | `acMenuClose` | fn |  |
| 3591 | `readMessageNavigationEnabled` | fn |  |
| 3594 | `writeMessageNavigationEnabled` | fn |  |
| 3597 | `readSelectionQuoteEnabled` | fn |  |
| 3600 | `writeSelectionQuoteEnabled` | fn |  |
| 3603 | `readForkEnabled` | fn |  |
| 3606 | `writeForkEnabled` | fn |  |
| 3622 | `applySessionModule` | fn |  |
| 3651 | `syncSessionModule` | fn |  |
| 3657 | `setSessionSwitchWire` | fn | 开关切换：写 daemon 并回应用户界（设置失败回滚 UI 状态） |
| 3681 | `selectionQuoteElement` | fn | WorkBuddy 的 selection-quote renderer 会通过 InputContextTag 自己渲染消息图标。 |
| 3696 | `selectionQuoteBlock` | fn |  |
| 3713 | `hideSelectionQuoteButton` | fn |  |
| 3718 | `updateSelectionQuoteButton` | fn |  |
| 3741 | `scheduleSelectionQuoteButton` | fn |  |
| 3747 | `insertSelectionQuote` | fn |  |
| 3767 | `setupSelectionQuote` | fn |  |
| 3805 | `renderQpList` | fn | 增强页快捷短语列表渲染（含批量模式） |
| 3872 | `renderExploreOptions` | fn | 发送按钮面板选项 = 快捷短语列表；点击项经 CDP 发送该短语（替换式，发完默认关面板） |
| 3943 | `openQpEdit` | fn | 新增/编辑快捷短语弹窗（参考账号导出弹窗；textarea 最多 5 行 / 500 字） |
| 3966 | `closeQpEdit` | fn |  |
| 3987 | `confirmQpDelete` | fn | 删除二次确认弹窗（支持单选/批量） |
| 4001 | `closeQpDel` | fn |  |
| 4019 | `findActionRow` | fn | 定位输入框操作栏（含 voice-mic-wrap 的父容器） |
| 4049 | `findSendButton` | fn | 操作栏最右侧的「圆形可点击」元素才是发送按钮（左侧还可能有增强提示词/停止等圆形按钮） |
| 4077 | `isSendDisabled` | fn | 发送按钮是否处于「禁用」态（输入框为空时官方会禁用它） |
| 4088 | `insertStash` | fn | 新版或旧版内联工具栏存在时放进工具栏；带 voice-mic-wrap 的旧布局保持固定定位。 |
| 4117 | `isComposerAnchorVisible` | fn |  |
| 4126 | `positionExplore` | fn | 探索菜单按钮：位于暂存提示词按钮右侧（与暂存同款圆钮、发送图标，hover 悬浮菜单弹窗） |
| 4134 | `syncNativeStashLabelWidth` | fn | CodeBuddy 原生按钮宽 24px、文字放大后会溢出：把量到的宽度写进自定义属性，CSS 用它做展开宽度。 |
| 4142 | `applyThemeButtonColors` | fn |  |
| 4149 | `positionStash` | fn |  |
| 4216 | `removeStash` | fn |  |
| 4221 | `isWelcomePage` | fn | 用户要求欢迎页不展示暂存提示词按钮（欢迎页输入框只是快速提问入口，不需要暂存）。 |
| 4230 | `shouldShowStash` | fn | 欢迎页一律不显示。 |
| 4236 | `syncStash` | fn |  |
| 4271 | `watchSend` | fn |  |
| 4285 | `watchRow` | fn |  |
| 4304 | `guardSessionChange` | fn | 标签同步只对当前会话生效（syncQueueTags 内按 sessionId 过滤），旧会话的标签由面板重渲染自然清除。 |
| 4313 | `createMessageNavigation` | fn | 会话消息导航：完整索引来自 controller.messageStore，DOM 仅用于判断当前可见位置。 |
| 4347 | `messageText` | fn | （换行、缩进、列表、代码块全靠空白表达），导致详情浮层里全挤成一坨。 |
| 4368 | `ensureRoot` | fn |  |
| 4412 | `position` | fn |  |
| 4433 | `setActive` | fn |  |
| 4444 | `hideTooltip` | fn |  |
| 4455 | `showTooltip` | fn |  |
| 4493 | `render` | fn |  |
| 4511 | `updateActive` | fn |  |
| 4546 | `scheduleActive` | fn |  |
| 4563 | `refreshFromStore` | fn |  |
| 4588 | `unbindStore` | fn |  |
| 4601 | `bindAdapter` | fn |  |
| 4618 | `sync` | fn |  |
| 4668 | `setEnabled` | fn |  |
| 4683 | `turnForButton` | fn |  |
| 4688 | `navigateToTurn` | fn |  |
| 4699 | `dragIndexAt` | fn |  |
| 4710 | `onNavPointerDown` | fn |  |
| 4722 | `onNavPointerMove` | fn |  |
| 4730 | `finishNavDrag` | fn |  |
| 4752 | `onNavPointerUp` | fn |  |
| 4753 | `onNavPointerCancel` | fn |  |
| 4754 | `onPointerOver` | fn |  |
| 4759 | `onPointerOut` | fn |  |
| 4765 | `onFocusIn` | fn |  |
| 4769 | `onFocusOut` | fn |  |
| 4773 | `onClick` | fn |  |
| 4785 | `onKeyDown` | fn |  |
| 4794 | `onWindowChange` | fn |  |
| 4828 | `hideForkTooltip` | fn |  |
| 4829 | `showForkTooltip` | fn |  |
| 4847 | `syncForkButtons` | fn |  |
| 4869 | `scheduleForkButtons` | fn |  |
| 4955 | `wbsPanelShown` | fn | 因此：① 只在可见时做面板内的工作；② 只对「与注入功能相关」的 mutation 反应。 |
| 4961 | `wbsTabActive` | fn |  |
| 4967 | `wbsMutationsRelevant` | fn |  |
| 4984 | `syncGlassComposerTriggerBackgrounds` | fn | 毛玻璃主题下按实际节点写入内联透明背景，并在节点重建时重新应用。 |
| 5005 | `onDomChange` | fn |  |
| 5020 | `onInputSync` | fn |  |
| 5051 | `scheduleDomChange` | fn |  |
| 5085 | `acLimitBannerPresent` | fn |  |
| 5097 | `acLimitWatchTick` | fn |  |
| 5134 | `readFabBottom` | fn |  |
| 5141 | `clampFabBottom` | fn |  |
| 5146 | `clampFabRight` | fn |  |
| 5151 | `applyFabPosition` | fn |  |
| 5164 | `scheduleFabPos` | fn |  |
| 5172 | `positionFab` | fn |  |
| 5190 | `fixWidgetIframeBg` | fn |  |
| 5223 | `syncModernQueueSnapshot` | fn |  |
| 5329 | `dropModernOptimisticItem` | fn |  |
| 5343 | `getModernQueueSnapshot` | fn |  |
| 5358 | `findWbsAdapter` | fn |  |
| 5401 | `get` | method |  |
| 5412 | `bootstrapModernQueueBridge` | fn |  |
| 5437 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 5441 | `probe` | fn |  |
| 5464 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 5476 | `handleModernQueueActionClick` | fn |  |
| 5507 | `stashSigs` | fn |  |
| 5513 | `stashIds` | fn |  |
| 5519 | `recordStashQueueItem` | fn |  |
| 5548 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 5561 | `syncQueueDomIds` | fn |  |
| 5588 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 5619 | `watchQueueOrder` | fn |  |
| 5635 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 5646 | `guardStashedPause` | fn |  |
| 5795 | `enforceStashOrder` | fn |  |
| 5837 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 5842 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 5881 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 5968 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 5986 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 6001 | `enqueueToWorkBuddyQueue` | fn |  |
| 6072 | `crumb` | fn |  |
| 6165 | `maxW` | fn |  |
| 6166 | `maxH` | fn |  |
| 6167 | `apply` | fn |  |
| 6200 | `endDrag` | fn |  |
| 6234 | `preloadAutomationDiscovery` | fn |  |
| 6240 | `findCreditSegment` | fn |  |
| 6249 | `ensureStatusPopover` | fn |  |
| 6260 | `hideStatusPopover` | fn |  |
| 6266 | `positionStatusPopover` | fn |  |
| 6291 | `showStatusPopover` | fn |  |
| 6302 | `creditPopoverHtml` | fn |  |
| 6309 | `hideCreditTooltip` | fn |  |
| 6315 | `showCreditTooltip` | fn |  |
| 6342 | `rotationReminderEnabled` | fn |  |
| 6406 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 6412 | `sync` | fn |  |
| 6451 | `syncOpsDot` | fn |  |
| 6457 | `setOpsFlag` | fn | 供 renderFailoverCard / renderContextAuditCard 回填（函数声明会提升，可以先用后定义） |
| 6464 | `placeOpsPopover` | fn | 不用 fixed —— .wbs-panel 的 backdrop-filter 会把它降格成「相对面板」的绝对定位。 |
| 6478 | `setOpsPopover` | fn |  |
| 6520 | `idleMinutesText` | fn |  |
| 6531 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 6534 | `label` | fn |  |
| 6539 | `data` | fn |  |
| 6545 | `sep` | fn |  |
| 6546 | `gap` | fn |  |
| 6556 | `renderIdleCard` | fn |  |
| 6602 | `refreshIdleCard` | fn |  |
| 6610 | `saveIdleCard` | fn |  |
| 6670 | `failoverClock` | fn |  |
| 6675 | `failoverAccountLabel` | fn |  |
| 6684 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 6697 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 6711 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 6727 | `renderFailoverCard` | fn |  |
| 6775 | `refreshFailoverCard` | fn |  |
| 6837 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 6895 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 6918 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 6921 | `done` | fn |  |
| 6926 | `fallback` | fn |  |
| 6949 | `renderContextAuditCard` | fn |  |
| 6995 | `loadContextAuditCard` | fn |  |
| 7059 | `openAccountOrderModal` | fn |  |
| 7086 | `close` | fn |  |
| 7091 | `drawRows` | fn |  |
| 7100 | `move` | fn |  |
| 7106 | `syncMode` | fn |  |
| 7185 | `setupCreditSummary` | fn |  |
| 7194 | `hide` | fn |  |
| 7195 | `deferHide` | fn |  |
| 7196 | `show` | fn |  |
| 7230 | `openOfficialGrowthCenter` | fn |  |
| 7236 | `confirmCurrentGrowthAccount` | fn |  |
| 7247 | `setupAccountNotePopover` | fn |  |
| 7264 | `trigger` | fn |  |
| 7265 | `dirty` | fn |  |
| 7266 | `update` | fn |  |
| 7273 | `hide` | fn |  |
| 7288 | `position` | fn |  |
| 7300 | `show` | fn |  |
| 7321 | `deferHide` | fn |  |
| 7329 | `submit` | fn |  |
| 7401 | `setupDailyProgressPopover` | fn |  |
| 7408 | `findRing` | fn |  |
| 7416 | `hide` | fn |  |
| 7426 | `deferHide` | fn |  |
| 7436 | `show` | fn |  |
| 7454 | `updateDailyTravelCountdowns` | fn |  |
| 7563 | `setupModelRateLimitPopover` | fn |  |
| 7570 | `findBadge` | fn |  |
| 7578 | `hide` | fn |  |
| 7588 | `deferHide` | fn |  |
| 7598 | `show` | fn |  |
| 7610 | `showSummary` | fn |  |
| 7681 | `closeSecureTransferModal` | fn |  |
| 7685 | `openSecureTransferModal` | fn |  |
| 7724 | `selectedIds` | fn |  |
| 7725 | `syncSelection` | fn |  |
| 7845 | `downloadTransfer` | fn |  |
| 7862 | `readTransferFile` | fn |  |
| 7871 | `copyPlainText` | fn |  |
| 7891 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 7907 | `onConfirm` | method |  |
| 7920 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 7944 | `openAccountImportChoice` | fn |  |
| 7964 | `sync` | fn |  |
| 7986 | `formatTokenCount` | fn |  |
| 7995 | `usageTrendChartHtml` | fn |  |
| 8003 | `usageTrendColors` | fn |  |
| 8010 | `resolveUsageColor` | fn |  |
| 8023 | `usagePieData` | fn |  |
| 8038 | `usagePieHtml` | fn |  |
| 8043 | `percent` | fn |  |
| 8044 | `description` | fn |  |
| 8045 | `legendRow` | fn |  |
| 8072 | `wireUsagePies` | fn |  |
| 8076 | `clear` | fn |  |
| 8081 | `preview` | fn |  |
| 8110 | `usageTrendGroups` | fn |  |
| 8132 | `renderUsageBreakdown` | fn |  |
| 8182 | `renderUsageTrendChart` | fn |  |
| 8254 | `hideTooltip` | fn |  |
| 8255 | `showTooltip` | fn |  |
| 8296 | `usageTimeSegmentHtml` | fn |  |
| 8304 | `onTokenStats` | fn |  |
| 8326 | `closeStats` | fn |  |
| 8355 | `usageDays` | fn |  |
| 8372 | `renderCredits` | fn |  |
| 8406 | `setCreditBusy` | fn |  |
| 8413 | `creditQueryFailed` | fn |  |
| 8420 | `showCreditJob` | fn |  |
| 8440 | `pollCreditJob` | fn |  |
| 8453 | `loadCredits` | fn |  |
| 8503 | `load` | fn | 就失去了入口 ⇒ 死代码里的副本永远看不到，只会与真实现漂移，故摘掉。 |
| 8570 | `perfTableHtml` | fn |  |
| 8607 | `onThinkingPerf` | fn |  |
| 8629 | `closePerf` | fn |  |
| 8643 | `load` | fn | 首屏慢（要扫 traces，首次 3–8 秒）⇒ 先渲染骨架再异步填表，绝不阻塞面板。 |
| 8677 | `wbsIsDarkTheme` | fn | 三维筛选（日期 × 账号 × 模型）与全部图表都在 HTML 内完成（数据内嵌 ⇒ 切筛选零延迟、断网可用）。 |
| 8689 | `onUsageBoard` | fn |  |
| 8722 | `boardUrl` | fn |  |
| 8726 | `closeBoard` | fn |  |
| 8740 | `showOverlay` | fn |  |
| 8741 | `hideOverlay` | fn |  |
| 8742 | `syncSrcBtn` | fn |  |
| 8743 | `loadBoard` | fn |  |
| 8756 | `fmtBoardTime` | fn |  |
| 8759 | `p2` | fn |  |
| 8762 | `generateBoard` | fn |  |
| 8797 | `switchTab` | fn | ===== Tab 切换 ===== |
| 8835 | `buildAutomationPane` | fn |  |
| 8839 | `defaultTask` | fn |  |
| 8842 | `triggerBadgesHtml` | fn |  |
| 8862 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 8870 | `autoProtocolLabel` | fn |  |
| 8874 | `taskStatusLabel` | fn |  |
| 8886 | `lastRunLabel` | fn |  |
| 8892 | `runFor` | fn |  |
| 8893 | `selectedIds` | fn |  |
| 8894 | `allSelected` | fn |  |
| 8895 | `syncBatchControls` | fn |  |
| 8903 | `render` | fn |  |
| 8948 | `load` | fn |  |
| 8951 | `renderExamples` | fn |  |
| 8965 | `loadAgentInfo` | fn |  |
| 8971 | `fuzzyTaskName` | fn |  |
| 8982 | `discoverySourceLabel` | fn |  |
| 8985 | `renderAutomationDiscovery` | fn |  |
| 9030 | `showAutomationDiscoveryGuide` | fn |  |
| 9040 | `showAutomationDiscovery` | fn |  |
| 9078 | `loadAutomationDiscovery` | fn |  |
| 9092 | `exampleById` | fn |  |
| 9095 | `generateAgentTask` | fn |  |
| 9113 | `finishSafetyReview` | fn |  |
| 9122 | `pollSafetyReview` | fn |  |
| 9137 | `startSafetyReview` | fn |  |
| 9148 | `closePanelModal` | fn |  |
| 9154 | `showAutomationConfirm` | fn |  |
| 9162 | `close` | fn |  |
| 9171 | `showAutomationLogs` | fn |  |
| 9198 | `close` | fn |  |
| 9214 | `showEditor` | fn |  |
| 9240 | `syncScheduleFields` | fn |  |
| 9256 | `hideEditor` | fn |  |
| 9257 | `saveEditor` | fn |  |
| 9301 | `isScheduledSendTaskUI` | fn |  |
| 9304 | `schedPad2` | fn |  |
| 9305 | `schedLocalSlot` | fn |  |
| 9308 | `schedDefaultOnceAt` | fn |  |
| 9314 | `schedWhenLabel` | fn |  |
| 9325 | `schedConversationLabel` | fn |  |
| 9336 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 9346 | `hideScheduledSend` | fn |  |
| 9348 | `showScheduledSend` | fn |  |
| 9406 | `whenValue` | fn |  |
| 9414 | `currentRequest` | fn |  |
| 9429 | `syncSummary` | fn |  |
| 9435 | `syncWhen` | fn |  |
| 9442 | `setTarget` | fn |  |
| 9455 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 9470 | `renderConversations` | fn |  |
| 9484 | `loadConversations` | fn |  |
| 9505 | `saveScheduledSend` | fn |  |
| 9581 | `mountAutomationModal` | fn |  |
| 9603 | `showCapabilities` | fn |  |
| 9613 | `showExamples` | fn |  |
| 9622 | `syncDraft` | fn |  |
| 9634 | `exportAutomationTasks` | fn |  |
| 9643 | `importIssueLabel` | fn |  |
| 9653 | `showTaskImport` | fn |  |
| 9669 | `selected` | fn |  |
| 9670 | `syncSelection` | fn |  |
| 9687 | `readAutomationImport` | fn |  |
| 9702 | `startPicker` | fn |  |
| 9714 | `wbsOfficialEsc` | fn |  |
| 9720 | `wbsOfficialCardHTML` | fn |  |
| 9746 | `wbsOfficialEmpty` | fn |  |
| 9750 | `wbsLoadOfficial` | fn |  |
| 9880 | `isTaskSessionRecordUI` | fn |  |
| 9885 | `canonicalWorkspaceUI` | fn |  |
| 9902 | `sessionCopyAccountLabel` | fn |  |
| 9908 | `renderSessionCopyProgress` | fn |  |
| 9939 | `scheduleSessionCopyProgressPoll` | fn |  |
| 9943 | `pollActiveSessionCopyJob` | fn |  |
| 9962 | `fmtCostInt` | fn |  |
| 9964 | `renderSessionCostCard` | fn |  |
| 10014 | `copyCurrentConversation` | fn | 取会话控制器复用本地既有 acFindConversationController（与成本卡同一个「当前会话」口径）。 |
| 10040 | `refreshSessionCost` | fn |  |
| 10070 | `startSessionCostPolling` | fn |  |
| 10079 | `stopSessionCostPolling` | fn |  |
| 10086 | `buildSessionsPane` | fn |  |
| 10197 | `renderSessionExport` | fn |  |
| 10216 | `pollSessionExport` | fn |  |
| 10238 | `cloudEls` | fn |  |
| 10250 | `cloudAccountName` | fn |  |
| 10258 | `renderCloudCard` | fn |  |
| 10309 | `checkCloudGhosts` | fn |  |
| 10331 | `runCloudPurge` | fn |  |
| 10360 | `wireCloudCard` | fn |  |
| 10384 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 10415 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 10423 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 10431 | `canRefreshSessions` | fn | 有勾选、在批量模式、有弹窗打开、或页面不可见时，一律不做静默刷新。 |
| 10440 | `refreshSessionsSilently` | fn |  |
| 10444 | `loadSessions` | fn |  |
| 10497 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 10507 | `canEditAutoCopy` | fn |  |
| 10511 | `sessSyncButton` | fn | 闭包外的变量在切片里不可见，用外部常量会挂。 |
| 10515 | `autoCopyButton` | fn |  |
| 10597 | `activeAutoCopyCount` | fn |  |
| 10603 | `updateSessionSummary` | fn |  |
| 10613 | `updateAutoCopyAllButton` | fn |  |
| 10621 | `toggleAutoCopyAll` | fn |  |
| 10644 | `shortWs` | fn |  |
| 10649 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 10705 | `toggleAutoCopyRule` | fn |  |
| 10736 | `updateAutoCopyButtons` | fn |  |
| 10764 | `updateSessCount` | fn |  |
| 10783 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 10792 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 10812 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 10827 | `wireSessionsPane` | fn |  |
| 11062 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 11116 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 11215 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 11257 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 11304 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 11322 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11346 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 11445 | `selectedSessIds` | fn |  |
| 11448 | `showSessModal` | fn |  |
| 11459 | `buildModelsPane` | fn |  |
| 11489 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 11496 | `modelDetailsHtml` | fn |  |
| 11505 | `modelRowHtml` | fn |  |
| 11535 | `loadModels` | fn |  |
| 11553 | `updateModelCounts` | fn |  |
| 11563 | `renderModels` | fn |  |
| 11609 | `updateModelBatchState` | fn |  |
| 11624 | `showModelConfirm` | fn |  |
| 11638 | `closeThirdPartyMenu` | fn |  |
| 11644 | `openThirdPartyModels` | fn |  |
| 11769 | `wireModelsPane` | fn |  |
| 11920 | `findModelBackup` | fn |  |
| 11927 | `openModelEdit` | fn |  |
| 11961 | `buildThemePane` | fn | ===== 主题 pane（构建：头像 + 悬浮机器人 + 主题选择 + WorkDaddy 壁纸）===== |
| 12048 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 12180 | `loadDshOps` | fn | dsh-ops 集成：状态 / 一键安装 / 启停 / 卸载（写 mcp.json 与磁盘，重启 WorkBuddy 生效）。 |
| 12292 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 12311 | `wirePcPane` | fn |  |
| 12344 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 12449 | `syncLangSeg` | fn |  |
| 12476 | `wireTelemetrySettings` | fn |  |
| 12480 | `renderTelemetryState` | fn |  |
| 12518 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 12634 | `updateLogTimestamp` | fn |  |
| 12639 | `appendUpdateLog` | fn |  |
| 12652 | `formatDownloadRate` | fn |  |
| 12658 | `formatDownloadEta` | fn |  |
| 12666 | `formatDownloadTransfer` | fn |  |
| 12679 | `formatUpdateFailure` | fn |  |
| 12693 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 12712 | `openWindowsInstaller` | fn |  |
| 12734 | `showWindowsInstallerReady` | fn |  |
| 12748 | `openWindowsInstallerAfterDownload` | fn |  |
| 12782 | `pollUpdateProgress` | fn |  |
| 12791 | `renderRebootUi` | fn |  |
| 12897 | `syncWallpaperCardVisibility` | fn |  |
| 12910 | `syncThemeTakeoverVisibility` | fn | 关闭接管后只隐藏主题外观选项；头像和悬浮机器人独立于主题接管。 |
| 12920 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 13152 | `gwCtxLabel` | fn |  |
| 13163 | `gwSetModelContext` | fn | 写一个模型的 maxInputTokens；value=0 表示删掉该字段（回落到客户端默认）。 |
| 13185 | `gwCtxInlineEdit` | fn | 提交成功才调用 onCommit；取消 / 非法则原样复位下拉，不写盘。 |
| 13210 | `close` | fn |  |
| 13214 | `commit` | fn |  |
| 13242 | `gwSetAllContexts` | fn | 批量：把同一档位应用到全部已注册条目。 |
| 13266 | `gwCardEl` | fn |  |
| 13267 | `gwDockEl` | fn |  |
| 13268 | `gwEl` | fn |  |
| 13270 | `gwSetDock` | fn | 折叠行 ↔ 大浮层：开 = 每次回到干净初始态（日志与模型面板收起）后刷新；关 = 复位到折叠行。 |
| 13286 | `gwBindDockKey` | fn |  |
| 13300 | `gwBtnEl` | fn |  |
| 13308 | `gwFmtCredits` | fn |  |
| 13313 | `gwFmtRel` | fn |  |
| 13323 | `gwAction` | fn |  |
| 13340 | `gwArm` | fn | 破坏性操作二次确认（armed 双点，替代风格突兀的 window.confirm）。 |
| 13354 | `gwRenderPool` | fn |  |
| 13405 | `gwRender` | fn |  |
| 13514 | `gwFetchPool` | fn |  |
| 13529 | `gwRefresh` | fn |  |
| 13535 | `gwCopyUsage` | fn |  |
| 13547 | `gwToggleLog` | fn |  |
| 13570 | `gwCreditsNum` | fn | 倍率 "x0.05" → 0.05（取不到时给个大值，排序时沉底）。 |
| 13576 | `gwModelBadges` | fn | 一个模型的徽标（思考档位 / 只能思考 / 视觉 / 上下文 / 倍率）。 |
| 13587 | `gwOpenModels` | fn | 打开「注册模型」选择面板：拉可取清单 → 渲染（默认只勾本插件已注册的）。 |
| 13612 | `gwCloseModels` | fn |  |
| 13620 | `gwRenderModels` | fn |  |
| 13723 | `gwOnCtxChange` | fn | 上下文下拉的 change 委托：读值 → 自定义走行内输入 → 写盘。 |
| 13738 | `gwUpdateModelsDiff` | fn | 差异预览：应用后会发生什么。基准 = 面板打开时的勾选快照（所以「只是打开」不算改动）。 |
| 13765 | `gwSyncModelsChecks` | fn | 勾选状态回填到 DOM（工具按钮改完 sel 后调用）。 |
| 13773 | `gwModelsTool` | fn |  |
| 13791 | `gwApplyModels` | fn |  |
| 13810 | `buildGatewayCard` | fn |  |
| 13947 | `wireEnhancePane` | fn |  |
| 13980 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 13988 | `loadWallpapers` | fn |  |
| 14096 | `setOpen` | fn |  |
| 14177 | `setupFabDrag` | fn |  |
| 14211 | `finishFabDrag` | fn |  |
| 14241 | `isDragging` | method |  |
| 14274 | `closeLoginModal` | fn |  |
| 14283 | `openLoginChoice` | fn |  |
| 14387 | `startSeamlessLogin` | fn |  |
| 14482 | `loadThemes` | fn |  |
| 14489 | `applyTheme` | fn |  |
| 14497 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 14515 | `openWebsite` | method |  |
| 14520 | `unlockDebug` | method |  |
| 14543 | `getItem` | method |  |
| 14544 | `setItem` | method |  |
| 14545 | `removeItem` | method |  |
| 14557 | `rememberAvatarWrapper` | fn |  |
| 14563 | `rememberAvatarImage` | fn |  |
| 14569 | `restoreAvatarDom` | fn |  |
| 14583 | `svgToPng` | fn | SVG → PNG dataURL |
| 14604 | `applyAvatar` | fn |  |
| 14673 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 14714 | `hexOf` | fn |  |
| 14717 | `mixArr` | fn |  |
| 14718 | `extractPalette` | fn |  |
| 14752 | `imageToTheme` | fn |  |
| 14841 | `syncAskSwitch` | fn |  |
| 14893 | `ndEl` | fn |  |
| 14896 | `ndRefreshCount` | fn |  |
| 14906 | `ndSwitchEl` | fn |  |
| 14911 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 14951 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 14985 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 15001 | `ndTitle` | fn |  |
| 15008 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 15027 | `cleanup` | fn |  |
| 15031 | `onClick` | fn |  |
| 15044 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 15051 | `applyNoDisturbState` | fn |  |
| 15143 | `acLogLine` | fn |  |
| 15148 | `acLog` | fn |  |
| 15158 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 15167 | `acSessionTitle` | fn |  |
| 15175 | `acMonitorLog` | fn |  |
| 15182 | `acScheduleMonitorLogRender` | fn |  |
| 15192 | `acResetState` | fn |  |
| 15224 | `acShowStatus` | fn |  |
| 15230 | `acHideStatus` | fn |  |
| 15235 | `acStartStatusAnim` | fn |  |
| 15236 | `acStopStatusAnim` | fn |  |
| 15239 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 15252 | `acNotifyLimit` | fn |  |
| 15273 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 15290 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 15300 | `acHasCompletionActions` | fn |  |
| 15319 | `acSwitchConversationId` | fn | 读不到就返回空串 —— 不能为了「带上一个 id」把切换本身拖挂。 |
| 15327 | `acHasErrorSignal` | fn |  |
| 15341 | `acLooksTruncated` | fn |  |
| 15349 | `acReplyDecision` | fn |  |
| 15361 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 15377 | `acIsBusy` | fn |  |
| 15382 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 15390 | `acComposerText` | fn |  |
| 15403 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 15419 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 15440 | `acPressEnter` | fn |  |
| 15449 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 15459 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 15476 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 15498 | `acControllerComposerEmpty` | fn |  |
| 15506 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 15553 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 15590 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 15628 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 15676 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 15682 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 15731 | `acCaptureControllerError` | fn |  |
| 15745 | `acRecordModelRateLimit` | fn |  |
| 15772 | `acControllerSnapshot` | fn |  |
| 15830 | `acControllerCheck` | fn |  |
| 15904 | `acBindController` | fn |  |
| 15937 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 16032 | `acScheduleSettle` | fn |  |
| 16045 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 16079 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 16087 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 16100 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 16199 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 16255 | `acStopLegacyMonitor` | fn |  |
| 16276 | `acMultiUpdateStatus` | fn |  |
| 16290 | `acMultiCreateSession` | fn |  |
| 16322 | `acMultiStatusFromResource` | fn |  |
| 16327 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 16355 | `acMultiReconcileSidebar` | fn |  |
| 16388 | `sessionDirtyResourceRecords` | fn |  |
| 16399 | `bindSessionDirtyMonitor` | fn |  |
| 16431 | `acMultiBindSessionResource` | fn |  |
| 16444 | `acMultiUnbindSessionResource` | fn |  |
| 16453 | `acMultiSchedule` | fn |  |
| 16462 | `acMultiSend` | fn |  |
| 16505 | `acMultiCheckSession` | fn |  |
| 16604 | `acMultiBindController` | fn |  |
| 16655 | `acMultiFinishSession` | fn |  |
| 16664 | `acMultiDetachController` | fn |  |
| 16673 | `acMultiProbeSidebarApproval` | fn |  |
| 16730 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 16753 | `acCdpClick` | fn |  |
| 16761 | `acAutoApproveClickItem` | fn |  |
| 16780 | `acAutoApproveItemByTitle` | fn |  |
| 16792 | `acAutoApprovePendingOnce` | fn |  |
| 16930 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 16975 | `acAutoApproveFastStart` | fn |  |
| 16985 | `acAutoApproveFastStop` | fn |  |
| 16989 | `acMultiDiscover` | fn |  |
| 17025 | `acStartMultiMonitor` | fn |  |
| 17044 | `acStopMultiMonitor` | fn |  |
| 17062 | `acStartMonitor` | fn |  |
| 17067 | `acStopMonitor` | fn |  |
| 17073 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 17084 | `acMonitorStatusLabel` | fn |  |
| 17093 | `acMonitorSafeDetail` | fn |  |
| 17105 | `acRenderMonitorLogModal` | fn |  |
| 17157 | `wireAutoContinuePane` | fn |  |
| 17187 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 17328 | `syncAutoContinue` | fn |  |
| 17333 | `applyAutoContinueState` | fn |  |
| 17346 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 17356 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 17362 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 17396 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 17414 | `stopNoDisturbAutoApprove` | fn |  |
| 17419 | `scheduleNdScan` | fn |  |
| 17423 | `ndQueueScanRoot` | fn |  |
| 17443 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 17465 | `ndNormalizeLabel` | fn |  |
| 17469 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 17477 | `ndClassifyApprovalCandidate` | fn |  |
| 17488 | `ndSessionIdForNode` | fn |  |
| 17494 | `ndApprovalContext` | fn |  |
| 17530 | `scanNoDisturbApproval` | fn |  |
| 17560 | `toNdAudit` | fn |  |
| 17568 | `getSleepMode` | fn |  |
| 17573 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 17591 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 17623 | `discoverSleepSessionBusy` | fn |  |
| 17654 | `isAnySessionBusy` | fn |  |
| 17668 | `startUntilDoneCheck` | fn |  |
| 17688 | `stopUntilDoneCheck` | fn |  |
| 17694 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 17734 | `fmtDateTime` | fn | 渲染账号列表 |
| 17741 | `fmtDateTimeSeconds` | fn |  |
| 17748 | `fmtCredits` | fn |  |
| 17755 | `fmtCreditExpiry` | fn |  |
| 17768 | `creditTip` | fn |  |
| 17780 | `creditBarHtml` | fn |  |
| 17797 | `todayUsageHtml` | fn |  |
| 17805 | `accountStatusTagsHtml` | fn |  |
| 17810 | `checkinBadgeHtml` | fn |  |
| 17819 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 17835 | `modelRateLimitTip` | fn |  |
| 17844 | `modelRateLimitBadgeHtml` | fn |  |
| 17856 | `modelRateLimitPopoverHtml` | fn |  |
| 17873 | `modelRateLimitSummaryPopoverHtml` | fn |  |
| 17895 | `creditBlockHtml` | fn |  |
| 17916 | `nearestCreditExpiry` | fn |  |
| 17928 | `sortAccountsByCreditExpiry` | fn |  |
| 17948 | `reorderAccountCards` | fn |  |
| 17961 | `mergeAccountSnapshot` | fn |  |
| 17987 | `dailyProgressLabel` | fn |  |
| 18013 | `dailyRingsSvg` | fn |  |
| 18020 | `dailyRingsHtml` | fn |  |
| 18029 | `formatDailyTravelCountdown` | fn |  |
| 18040 | `dailyTravelCountdownText` | fn |  |
| 18046 | `dailyCatDetail` | fn |  |
| 18065 | `formatGrowthTaskDeadline` | fn |  |
| 18073 | `sortGrowthTasks` | fn |  |
| 18091 | `growthTaskActions` | fn |  |
| 18096 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 18108 | `growthAutoOf` | fn |  |
| 18112 | `growthAutoActionFor` | fn |  |
| 18121 | `startGrowthAuto` | fn |  |
| 18149 | `pollGrowthAuto` | fn |  |
| 18189 | `stopGrowthAutoPoll` | fn |  |
| 18197 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 18211 | `growthTaskRewardHtml` | fn |  |
| 18223 | `dailyProgressPopoverHtml` | fn |  |
| 18367 | `updateDailyProgressCells` | fn |  |
| 18390 | `refreshDailyProgressAccount` | fn |  |
| 18418 | `fetchDailyProgressForAccounts` | fn |  |
| 18445 | `accountCardLayoutKey` | fn |  |
| 18465 | `fmtBytes` | fn |  |
| 18475 | `fmtDuration` | fn |  |
| 18484 | `autoCopyTotalFailed` | fn |  |
| 18495 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 18501 | `autoCopyConflictTitle` | fn |  |
| 18507 | `autoCopyConflictDetail` | fn |  |
| 18517 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 18539 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 18545 | `autoCopyProgressEls` | fn |  |
| 18558 | `hideAutoCopyProgress` | fn |  |
| 18565 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 18670 | `scheduleAutoCopyHide` | fn |  |
| 18692 | `spaceNum` | fn |  |
| 18697 | `spaceShare` | fn |  |
| 18703 | `spaceTimeText` | fn |  |
| 18707 | `pad` | fn |  |
| 18711 | `spaceBaseName` | fn |  |
| 18716 | `spaceScanEls` | fn |  |
| 18733 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 18755 | `hideSpaceScanBox` | fn |  |
| 18761 | `stopSpacePolling` | fn |  |
| 18766 | `spaceJobSub` | fn |  |
| 18773 | `renderSpaceJob` | fn |  |
| 18790 | `spaceRowHtml` | fn |  |
| 18801 | `spaceRestRow` | fn |  |
| 18809 | `renderSpaceEmpty` | fn |  |
| 18826 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 18834 | `spaceSubText` | fn |  |
| 18853 | `spaceSortOf` | fn |  |
| 18861 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 18869 | `spaceSortName` | fn |  |
| 18876 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 18897 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 18915 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 18922 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 18933 | `renderSpaceResult` | fn |  |
| 19050 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 19068 | `scheduleSpacePoll` | fn |  |
| 19076 | `pollSpaceScan` | fn |  |
| 19099 | `startSpaceScan` | fn |  |
| 19120 | `cancelSpaceScan` | fn |  |
| 19132 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 19154 | `buildSpacesPane` | fn |  |
| 19187 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 19254 | `pollAutoCopyJob` | fn |  |
| 19261 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 19271 | `render` | fn |  |
| 19433 | `maskAccountName` | fn |  |
| 19441 | `maskAccountId` | fn |  |
| 19452 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 19478 | `toggleAccountMask` | fn |  |
| 19484 | `refresh` | fn |  |
| 19516 | `updateAccountSummary` | fn |  |
| 19541 | `rotationToday` | fn |  |
| 19546 | `closeRotationNotice` | fn |  |
| 19556 | `showRotationNotice` | fn |  |
| 19582 | `place` | fn |  |
| 19637 | `formatRotationEta` | fn |  |
| 19646 | `formatRotationDuration` | fn |  |
| 19657 | `checkCreditRotationAfterSession` | fn |  |
| 19659 | `run` | fn |  |
| 19681 | `updateCheckinCells` | fn |  |
| 19753 | `fetchActivityForAccounts` | fn |  |
| 19762 | `worker` | fn |  |
| 19813 | `requestCredit` | fn |  |
| 19839 | `updateCreditSummaryFromAccounts` | fn |  |
| 19848 | `refreshCreditForAccount` | fn |  |
| 19880 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 19885 | `settleBatch` | fn |  |
| 19895 | `queryAccount` | fn |  |
| 19946 | `updateCreditCell` | fn |  |
| 19990 | `updateDebugPanel` | fn |  |
| 20010 | `onDebugKey` | fn |  |
| 20019 | `markHealthGeneration` | fn |  |
| 20028 | `isHealthStopControl` | fn |  |
| 20033 | `isHealthSendControl` | fn |  |
| 20210 | `mdqvT` | fn | 去重不用数组：直接在 tab 元素上打 __wbsAdoptSkip（随元素移除自动回收） |
| 20212 | `mdqvReadEnabled` | fn |  |
| 20215 | `mdqvWriteEnabled` | fn |  |
| 20218 | `mdqvReadAdopt` | fn |  |
| 20221 | `mdqvWriteAdopt` | fn |  |
| 20226 | `mdqvFindPathByName` | fn | 用产物文件名在页面里反查绝对路径（正文产物卡 / 产物面板条目都带 data-dir）。 |
| 20247 | `mdqvAdoptTick` | fn | 成本：一次 querySelector 实测 0.02 ms 级，600 ms 一次 ⇒ 可忽略。 |
| 20267 | `mdqvAdoptStart` | fn |  |
| 20281 | `mdqvFileUrl` | fn | 不编码会因空格/中文导致 fetch 失败；整体 encodeURI 又会把已有的 % 二次编码。 |
| 20293 | `mdqvNormPath` | fn | 「未编码绝对路径」，否则会拼出 file:///file:///… 或中文二次编码。 |
| 20305 | `mdqvShortPath` | fn | 完整路径仍放在 title 里可悬停查看。 |
| 20316 | `mdqvRootRect` | fn | 面板要贴住的区域：整个应用的可见区（#root），拿不到就退回 window。 |
| 20324 | `mdqvDefaultWidth` | fn | 默认宽度：对齐官方文档视图的观感（约内容区 1/3），并夹到可用范围。 |
| 20332 | `mdqvReadWidth` | fn |  |
| 20339 | `mdqvWriteWidth` | fn |  |
| 20352 | `mdqvPlace` | fn |  |
| 20363 | `mdqvDetachShellGuard` | fn |  |
| 20369 | `mdqvReapply` | fn | 重算并写回让位量。观察者与窗口 resize 都走这里。 |
| 20392 | `mdqvAttachShellGuard` | fn | 1936 ⇄ 2296 之间跳（连带把对话区右边缘推过我的面板左边缘）。两个节点都守。 |
| 20408 | `mdqvApplyShift` | fn | 对话区会滑到面板底下。用父容器当前宽度反推，两种状态都自洽。 |
| 20437 | `mdqvRestoreShift` | fn |  |
| 20469 | `wbsHlClass` | fn |  |
| 20478 | `wbsHighlight` | fn | 高亮入口：返回**已转义**的 HTML 片段。 |
| 20511 | `wbsSafeImg` | fn | 其余属性一律丢弃 —— 防止 md 里塞 onerror 之类的注入面。 |
| 20522 | `mdqvInline` | fn | &amp; 当 URL 二次转义」这类双重转义（URL 进属性位一律走 escAttr）。 |
| 20563 | `mdqvRender` | fn | 分隔线 / 行内语法。**刻意不做**数学与 mermaid —— 遇到就给一行提示，不静默丢内容。 |
| 20567 | `flushPara` | fn |  |
| 20572 | `flushQuote` | fn |  |
| 20577 | `flushList` | fn |  |
| 20582 | `flushAll` | fn |  |
| 20583 | `warn` | fn |  |
| 20584 | `closeFence` | fn |  |
| 20598 | `cellsOf` | fn |  |
| 20604 | `alignsOf` | fn |  |
| 20702 | `mdqvCopyText` | fn | 复制文本（面板内代码块的「复制」用；不依赖 mdqvOpen 内的 flash）。 |
| 20730 | `mdqvBindCodeCopy` | fn | 给代码块顶栏的「复制」按钮接线（面板内走真实监听器；导出的离线页走内联脚本）。 |
| 20745 | `mdqvClose` | fn |  |
| 20760 | `mdqvOpen` | fn |  |
| 20968 | `mdqvStandalone` | fn | 跟随系统深色偏好。样式刻意不复用注入页那份（那份依赖 --wb-* 变量，外部没有）。 |
| 21027 | `mdqvInstall` | fn |  |
| 21062 | `registerBuild` | fn |  |
| 21086 | `wbsTapAdClose` | fn |  |
| 21104 | `startSidebarAdGuard` | fn |  |
| 21114 | `hideHost` | fn |  |
| 21121 | `releaseHost` | fn |  |
| 21129 | `scan` | fn |  |
| 21158 | `onAdGuardVisible` | fn | 窗口重新可见时立刻扫一次：后台被节流期间冒出来的广告不该再等 1.5 秒。 |
| 21171 | `stop` | method |  |
| 21187 | `start` | fn |  |
| 21200 | `destroyWidget` | fn |  |
| 21226 | `readPerfMode` | fn |  |
| 21229 | `applyPerfMode` | fn |  |
| 22727 | `refresh` | method |  |
| 22729 | `getLanguage` | method |  |
| 22730 | `setLanguage` | method |  |

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

## scripts/lib.js  （2410 行 / 128 个函数）

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
| 185 | `wdCompatEnvelopeAAD` | fn | AAD 构造抽出来供加密复用：写入时必须与打开时的 AAD 完全一致，否则客户端解不开。 |
| 187 | `lp` | const |  |
| 188 | `u32` | const |  |
| 195 | `wdCompatOpenEnvelope` | fn |  |
| 203 | `wdCompatDecryptAuthJson` | fn | 原地解密 JSON 中的全部 $wbEncrypted 信封字段；失败字段保留原值，不抛错。 |
| 205 | `walk` | const |  |
| 227 | `wdCompatEncryptAuthJson` | fn | 按原备份的字段信封加密刷新结果；密钥或模板不可用时拒绝写入，绝不降级明文。 |
| 232 | `inspect` | const |  |
| 242 | `seal` | const |  |
| 253 | `walk` | const |  |
| 272 | `samePath` | fn | ===================== [wd-compat] 适配层结束 ===================== |
| 276 | `isLegacyDataDir` | fn |  |
| 295 | `authDir` | fn |  |
| 299 | `safeAuthFileName` | fn |  |
| 305 | `normalizeAuthDomain` | fn |  |
| 316 | `tokenIssuerOrigin` | fn |  |
| 328 | `allowedAuthOrigins` | fn |  |
| 344 | `authRecordFromJson` | fn |  |
| 378 | `parseAuthFile` | fn |  |
| 389 | `parseAuthJson` | fn |  |
| 398 | `normalizeAccountImportJson` | fn |  |
| 421 | `listAuthRecords` | fn |  |
| 436 | `resolveCurrentAuth` | fn |  |
| 450 | `currentAuthFile` | fn |  |
| 454 | `resolveLogoutAuth` | fn |  |
| 467 | `defaultDataDir` | fn |  |
| 474 | `accountsDir` | fn |  |
| 477 | `metaFile` | fn |  |
| 481 | `workbuddyModelsFile` | fn |  |
| 485 | `isManagedProfileDataDir` | fn |  |
| 491 | `migrateLegacyModelBackups` | fn |  |
| 518 | `modelBackupsDir` | fn |  |
| 526 | `maskApiKey` | fn |  |
| 537 | `sanitizeModel` | fn | 模型列表摘要。默认脱敏 apiKey；UI 需要明文展示（模型页 cell / 编辑弹窗）时传 { revealKey: true }。 |
| 552 | `checkinDisplayValue` | fn |  |
| 563 | `modelsFilePrefersObject` | fn | 按「这个文件属于哪个 profile」决定形态，读和写共用同一判据。 |
| 573 | `buildModelsFileDoc` | fn | CodeBuddy 侧即使原文件是裸数组，也要输出成对象形态 —— 否则客户端的迁移永远不生效。 |
| 599 | `normalizeModelsFileFormat` | fn |  |
| 613 | `readModelsFile` | fn |  |
| 643 | `writeModelsFile` | fn |  |
| 656 | `modelBackupPath` | fn |  |
| 662 | `readModelBackup` | fn |  |
| 673 | `listModelBackups` | fn |  |
| 701 | `listOfficialModels` | fn |  |
| 706 | `readOfficialModel` | fn |  |
| 715 | `deleteOfficialModels` | fn |  |
| 727 | `backupOfficialModel` | fn |  |
| 741 | `writeModelBackup` | fn |  |
| 750 | `copyModelBackup` | fn |  |
| 761 | `editModelBackup` | fn |  |
| 780 | `deleteModelBackups` | fn |  |
| 803 | `enableModelBackup` | fn |  |
| 823 | `modelImportName` | fn |  |
| 827 | `importModels` | fn |  |
| 846 | `readMeta` | fn |  |
| 858 | `writeMeta` | fn |  |
| 868 | `canonicalWorkspace` | fn | 使用稳定路径键，不要求路径当前存在（空间可能已被移动或卸载）。 |
| 880 | `ensureAutoCopyMeta` | fn |  |
| 947 | `readAutoCopyConfig` | fn |  |
| 969 | `autoCopyRuleKey` | fn |  |
| 973 | `getAutoCopyRules` | fn |  |
| 1001 | `dedupeAutoCopySessionRows` | fn | row (the SQL callers order newest activity first) for plans and UI counts. |
| 1016 | `setAutoCopyAllSessions` | fn |  |
| 1024 | `isAutoCopySessionSelected` | fn |  |
| 1034 | `setAutoCopyRule` | fn |  |
| 1077 | `addLineageMember` | fn |  |
| 1084 | `getAutoCopySession` | fn |  |
| 1094 | `getAutoCopySessionMembers` | fn | the copier repair stale mappings without creating another row. |
| 1115 | `getAutoCopySessionMemberRecords` | fn | not only the account that happened to be active during the switch. |
| 1136 | `selectLatestAutoCopyMember` | fn | files.  Ties are resolved by member order so repeated switches stay stable. |
| 1151 | `ensureAutoCopySessions` | fn |  |
| 1175 | `ensureAutoCopySession` | fn |  |
| 1198 | `collectAutoCopyDuplicates` | fn |  |
| 1215 | `normalizeAutoCopyLineages` | fn |  |
| 1244 | `mergeAutoCopyLineages` | fn |  |
| 1299 | `addAutoCopySessionMember` | fn |  |
| 1321 | `removeAutoCopySessionMember` | fn | intentionally leaves the lineage and other account members intact. |
| 1356 | `pickArchivedCrossAccountTargets` | fn | 「同 lineage 且主账号那份确为 archived」的前置筛选在 daemon 侧 collectArchivedCopyState 完成。 |
| 1427 | `moveAutoCopySession` | fn |  |
| 1446 | `removeAutoCopySession` | fn |  |
| 1487 | `collectLineageMembersForDelete` | fn | 返回 [{ uid, id, lineageId }]；uid 可能为空（脏索引），id 必有值。 |
| 1502 | `addLink` | const |  |
| 1573 | `isAutoCopySuppressed` | fn |  |
| 1584 | `getSuppressedLineagesForTarget` | fn | 避免逐行读 meta。 |
| 1599 | `isAutoCopySuppressedForTarget` | fn | 便捷写法：自己读一次 meta。调用方已经有 config 时用 isAutoCopySuppressed(config, ...) 更省。 |
| 1606 | `setAutoCopySuppression` | fn |  |
| 1623 | `clearAutoCopySuppression` | fn |  |
| 1636 | `clearLineageSuppressions` | fn |  |
| 1672 | `resolveSessionDeletePlan` | fn |  |
| 1685 | `buildLocal` | const |  |
| 1701 | `buildCascade` | const |  |
| 1729 | `removeAutoCopyAccount` | fn |  |
| 1753 | `resolveMappingLineage` | fn |  |
| 1764 | `getAutoCopyMapping` | fn | while all persisted keys use lineageId + targetUid. |
| 1770 | `setAutoCopyMapping` | fn |  |
| 1782 | `deleteAutoCopyMapping` | fn |  |
| 1800 | `getAutoCopyLineageSyncedAt` | fn |  |
| 1819 | `setAutoCopyLineageSyncedAt` | fn |  |
| 1836 | `getAutoCopyJudge` | fn |  |
| 1840 | `setAutoCopyJudge` | fn |  |
| 1851 | `logFile` | fn |  |
| 1854 | `backupPath` | fn |  |
| 1859 | `retireLogoutMarker` | fn | WorkBuddy ignores auth files while this marker exists; retire it after a switch. |
| 1900 | `migrateLegacyDataDir` | fn |  |
| 1945 | `ensureDirs` | fn |  |
| 1956 | `readAuthFile` | fn | 读取登录信息文件并抽取账号关键字段（不返回令牌内容） |
| 1969 | `updateMeta` | fn | 残留 lastLogin 标记，也不得覆盖切换路径建立的绑定关系。 |
| 1994 | `backupAuthFile` | fn |  |
| 2014 | `backupCurrent` | fn | （真实事故：s 账号备份曾被 2026-08-21 存档覆盖成 8-19 的 token）。 |
| 2033 | `resolveAuthTarget` | fn |  |
| 2039 | `sameChannel` | const |  |
| 2074 | `getAccountOrder` | fn | 账号展示顺序保存在 profile 元数据中，不改写登录备份格式。0 表示未排序，排在末尾。 |
| 2078 | `setAccountOrder` | fn |  |
| 2098 | `setAccountNote` | fn | 备注仅写入当前 profile 的元数据，保留认证备份和其他账号设置。 |
| 2110 | `listAccounts` | fn | 列出所有已备份账号（直接读备份文件提取展示字段，按最近刷新时间倒序） |
| 2169 | `deleteAuthFilesForUid` | fn | 的根因：删除只清了 backups 目录，auth 目录里残留的存档会在下一次扫描时复活账号。 |
| 2201 | `deleteAccount` | fn | 永久删除某个账号的备份文件（不影响当前登录） |
| 2243 | `switchTo` | fn | 切换登录账号：把备份文件复制回登录信息文件（先校验 uid 匹配） |

## scripts/win-launcher.js  （1969 行 / 104 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 114 | `injectRetryDelay` | fn | 24 次合计覆盖约 60 秒。WorkBuddy 维持原样。 |
| 124 | `log` | fn |  |
| 131 | `sleep` | fn | ---------- 小工具 ---------- |
| 133 | `readApiToken` | fn |  |
| 140 | `localApiHeaders` | fn |  |
| 145 | `readUiPortFile` | fn |  |
| 149 | `writeUiPortFile` | fn |  |
| 158 | `useUiPort` | fn |  |
| 165 | `configureUiPort` | fn |  |
| 190 | `relaunchWithDesktopShell` | fn |  |
| 207 | `runHiddenPowerShell` | fn |  |
| 236 | `showWindowsMessageBox` | fn |  |
| 242 | `showWindowsNotification` | fn |  |
| 253 | `powershellQuote` | fn |  |
| 257 | `reportAndExit` | fn |  |
| 262 | `validCdpPort` | fn |  |
| 266 | `readCdpPortFile` | fn |  |
| 273 | `writeCdpPortFile` | fn |  |
| 282 | `cdpPortCandidates` | fn |  |
| 285 | `add` | const |  |
| 293 | `portOpen` | fn |  |
| 302 | `isLocalPortAvailable` | fn |  |
| 306 | `finish` | const |  |
| 321 | `reserveEphemeralCdpPort` | fn |  |
| 325 | `finish` | const |  |
| 338 | `httpGet` | fn |  |
| 350 | `httpPost` | fn |  |
| 364 | `isWorkBuddyCdp` | fn |  |
| 368 | `isWorkBuddyCdpAt` | fn |  |
| 387 | `configureCdpPort` | fn |  |
| 419 | `strictPowerShellLines` | fn |  |
| 429 | `bestEffortPowerShellLines` | fn |  |
| 438 | `powershellLiteral` | fn |  |
| 443 | `getWorkBuddyProcesses` | fn | 通过 CIM 查询当前 profile 主程序的路径、父 PID 和命令行；命令行正文绝不写入日志/Sentry。 |
| 462 | `daemonRunning` | fn | 仅保留为本地端口诊断；daemon 启动成功必须走 exactDaemonStatus 完整身份校验。 |
| 466 | `isPrewarmProcess` | fn |  |
| 470 | `workBuddyProcesses` | fn |  |
| 485 | `tasklistProcessIds` | fn | 只读诊断：tasklist 结果仅写入失败快照，绝不进入任何 taskkill 参数或退出判定。 |
| 501 | `processCdpPort` | fn |  |
| 507 | `processHasCdpArg` | fn |  |
| 511 | `processDiagnostics` | fn |  |
| 532 | `logProcessDiagnostics` | fn |  |
| 540 | `requireWorkBuddyClosedBeforeLaunch` | fn | 通过 quitWorkBuddy() 对当前 profile 的已验证进程做精确重启。 |
| 556 | `readDaemonVersion` | fn |  |
| 564 | `readDaemonIdentity` | fn |  |
| 577 | `findNode` | fn | ---------- 定位 node（安装包内置优先，WorkBuddy 托管运行时次之，最后 PATH） ---------- |
| 617 | `findWorkBuddy` | fn |  |
| 619 | `tryFile` | const |  |
| 644 | `addCandidate` | const |  |
| 701 | `psLiteral` | const |  |
| 727 | `listenerPids` | fn |  |
| 743 | `queryNodeProcesses` | fn |  |
| 770 | `uniqueNodeProcess` | fn |  |
| 782 | `hasAnyNodeProcess` | fn | 多个 daemon，所以这里只要**存在任一**即可，不能用 uniqueNodeProcess（它要求唯一）。 |
| 790 | `readWatchdogPid` | fn |  |
| 802 | `watchdogState` | fn |  |
| 860 | `validateDaemonProcess` | fn |  |
| 872 | `exactDaemonStatus` | fn |  |
| 889 | `readStatus` | fn |  |
| 896 | `authenticatedElevatedDaemonStatus` | fn |  |
| 908 | `waitForExactDaemon` | fn |  |
| 922 | `killVerifiedNodeProcess` | fn |  |
| 942 | `authorizeDaemonTermination` | fn |  |
| 955 | `removeWatchdogPidIf` | fn |  |
| 962 | `stopDaemonByPort` | fn |  |
| 1006 | `ensureDaemon` | fn |  |
| 1075 | `workBuddyRunning` | fn | ---------- 2/3. WorkBuddy CDP 处理 ---------- |
| 1079 | `runTaskkill` | fn |  |
| 1083 | `finish` | const |  |
| 1096 | `waitForWorkBuddyExit` | fn |  |
| 1105 | `exitSnapshot` | fn |  |
| 1113 | `killForExit` | fn |  |
| 1130 | `killVerifiedWorkBuddyProcess` | fn |  |
| 1148 | `quitWorkBuddy` | fn |  |
| 1187 | `launchWorkBuddy` | fn |  |
| 1214 | `waitForWorkBuddyCdp` | fn |  |
| 1221 | `start` | const |  |
| 1282 | `findNextAvailableCdpPort` | fn |  |
| 1291 | `injectNow` | fn |  |
| 1327 | `injectNowOrPending` | fn |  |
| 1338 | `hasElevatedSessionConsent` | fn |  |
| 1346 | `nativeHelperPath` | fn |  |
| 1350 | `runNativeHelper` | fn |  |
| 1366 | `nativeWorkBuddyProcessSummary` | fn |  |
| 1389 | `nativeWorkBuddyDiscoverySummary` | fn |  |
| 1393 | `nativeWorkBuddyRunning` | fn |  |
| 1400 | `stopNativeWorkBuddy` | fn |  |
| 1431 | `isAccessDeniedStopError` | fn |  |
| 1448 | `tryStopNativeWorkBuddy` | fn |  |
| 1463 | `findWorkBuddyNative` | fn |  |
| 1475 | `add` | const |  |
| 1559 | `stopVerifiedLegacyManagedLifecycle` | fn |  |
| 1567 | `nativeDaemonDiagnostics` | fn |  |
| 1606 | `nativeCdpDiagnostics` | fn |  |
| 1631 | `nativeDaemonStatusMatches` | fn |  |
| 1648 | `waitForNativeDaemon` | fn |  |
| 1667 | `stopNativeLifecycle` | fn |  |
| 1677 | `ensureDaemonNative` | fn |  |
| 1694 | `startWatchdog` | const |  |
| 1707 | `waitWithProgress` | const |  |
| 1732 | `waitForWorkBuddyCdpNative` | fn |  |
| 1735 | `start` | const |  |
| 1788 | `nativeLaunchFailed` | fn |  |
| 1795 | `nativeStartupMain` | fn |  |

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

## scripts/automation.js  （1235 行 / 48 个函数）

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
| 334 | `stepsContainCheckin` | fn |  |
| 340 | `taskNeedsPanelClosed` | fn |  |
| 341 | `walk` | const |  |
| 350 | `builtinContentHash` | fn |  |
| 365 | `installBuiltinTask` | fn |  |
| 384 | `writeMarker` | const |  |
| 385 | `managedMarker` | const |  |
| 439 | `adoptBuiltinTask` | fn |  |
| 467 | `validateLocator` | fn |  |
| 478 | `validateSteps` | fn |  |
| 538 | `validateTask` | fn |  |
| 563 | `createSafetyReviewTask` | fn |  |
| 598 | `interpolate` | fn |  |
| 608 | `resolveValue` | fn |  |
| 620 | `getPath` | fn |  |
| 622 | `compare` | fn |  |
| 636 | `safeLogParam` | fn |  |
| 647 | `capabilityText` | fn |  |
| 726 | `agentBridgePaths` | fn |  |
| 738 | `atomicWriteText` | fn |  |
| 753 | `agentGuideText` | fn |  |
| 772 | `ensureAgentBridge` | fn |  |
| 782 | `safeRequestId` | fn |  |
| 787 | `createAgentRequest` | fn |  |
| 828 | `importAgentInbox` | fn |  |
| 873 | `locatorExpression` | fn |  |
| 887 | `executeTask` | fn |  |
| 893 | `pad` | const |  |
| 908 | `assertActive` | const |  |
| 914 | `runSteps` | const |  |
| 933 | `runStep` | const |  |

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

## scripts/api-gateway.js  （697 行 / 27 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 57 | `gatewayPaths` | fn |  |
| 73 | `assertSafeRelativePath` | fn |  |
| 84 | `parseChecksums` | fn | 从 checksums.txt（`<sha256>  <文件名>` 每行一条）里取指定资产的期望摘要（小写；取不到返回 ''）。 |
| 97 | `sha256` | fn | 文件/缓冲区的 sha256（十六进制小写）。 |
| 109 | `listZipEntries` | fn |  |
| 150 | `readZipEntry` | fn | 解压单个条目为 Buffer（数据偏移以**本地头**为准：本地头的 extra 长度可能与中央目录不同）。 |
| 172 | `extractZipToDir` | fn |  |
| 206 | `buildAuthDocument` | fn |  |
| 233 | `writeAuthDocuments` | fn | 写出 auths/<prefix>-<uid>.json（文件名必须匹配官方 `workbuddy*.json` 的扫描规则）。 |
| 268 | `syncAuthDocuments` | fn |  |
| 331 | `buildGatewayConfig` | fn |  |
| 339 | `isObj` | const |  |
| 340 | `merge` | const |  |
| 388 | `readGatewayState` | fn | 读 WorkDaddy 侧状态（缺失/损坏一律给出「未安装」的默认值，不抛错）。 |
| 398 | `writeGatewayState` | fn | 原子写状态（tmp + rename）。**不写 api_key 明文**，只写指纹与长度。 |
| 418 | `normalizeThinkingLevel` | fn | 归一化一个思考档位；非法值返回 ''（**不猜、不编造**）。 |
| 435 | `unwrapProxyUrl` | fn |  |
| 450 | `gatewaySameOrigin` | fn |  |
| 476 | `toWorkbuddyModelEntry` | fn |  |
| 525 | `gatewayModelState` | fn |  |
| 578 | `mergeGatewayModels` | fn |  |
| 583 | `incoming` | const |  |
| 584 | `stripPrefix` | const |  |
| 585 | `same` | const |  |
| 649 | `unmergeGatewayModels` | fn | 撤销：按名单把本插件写入的条目摘掉（**纯函数**；名单来自 gateway 状态文件）。 |
| 657 | `apiKeyHint` | fn | api_key 的展示用指纹（只回前 6 位 + 长度，够确认是不是同一把，又不泄漏）。 |
| 664 | `generateApiKey` | fn | 生成本地 api_key（32 字节 base64url，约 43 字符）。 |

合计 **2057** 个函数。
