# 代码索引（自动生成，勿手改）

> 由 `.wd-analysis/gen-code-index.js` 生成 · 2026-11-06 10:28:50
> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。
> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`

## scripts/daemon.js  （21327 行 / 701 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 67 | `resolveDaemonPrivilege` | fn |  |
| 295 | `readAutomationsTolerant` | fn |  |
| 369 | `dshOpsFindNodeExe` | fn | 探测 WorkBuddy 自带的 node（mcp.json 里 dsh-ops 条目需要绝对路径）。 |
| 382 | `dshOpsInspectDir` | fn | 读某目录下的部署状态（不抛异常）。 |
| 402 | `dshOpsReadMcp` | fn | 读 mcp.json（严格：存在但损坏时抛错，绝不覆盖用户配置）。 |
| 412 | `dshOpsStatus` | fn | 综合状态：安装 / 注册 / 启用。 |
| 441 | `dshOpsHttpGet` | fn | 下载（跟随重定向，120s 超时，200MB 上限）。 |
| 469 | `dshOpsUntar` | fn | 最小 tar 解析（npm tarball 为 ustar；只取普通文件，其余跳过）。 |
| 490 | `dshOpsVerifyIntegrity` | fn | sha512 完整性校验（integrity 形如 sha512-<base64>）。 |
| 498 | `dshOpsRegister` | fn | 把 dir 写成 mcp.json 的 dsh-ops 一条（幂等，保留既有 disabled 状态；顺手清 0.3.0 残留的 fastctx）。 |
| 512 | `dshOpsInstall` | fn | 安装：复用已有部署优先；否则从 npm 下载并校验后落盘。 |
| 569 | `dshOpsToggle` | fn | 启用 / 停用（只改 mcp.json 两条的 disabled）。 |
| 580 | `dshOpsUninstall` | fn | 从 mcp.json 注销；purge=true 时另删 WorkDaddy 自己装的目录（有 manifest 才删）。 |
| 1020 | `persistScheduleLedger` | fn |  |
| 1030 | `noteScheduleSlot` | fn | 槽位命中时登记「这一刻本该发生一次发送」（由 createScheduleTicker 的 onSlot 回调触发） |
| 1050 | `recordScheduleSlotOutcome` | fn | 运行结束后回填结果。只有登记过的槽位才回填（手动/事件/interval 运行不带 slot） |
| 1070 | `scheduleVerifyNotify` | fn |  |
| 1080 | `runScheduleVerify` | fn | 一拍：找出「该发而没发成」的槽位 → 写桌面人话报告 + 弹一次汇总提示 + 标记已上报 |
| 1087 | `nameOf` | const |  |
| 1137 | `waitForManualCdpReady` | fn |  |
| 1147 | `loadApiToken` | fn | 用 wx + 重读避免两个 watchdog 进程启动竞态时各自生成一枚 token。 |
| 1148 | `valid` | const |  |
| 1174 | `diagnosticsEnabled` | fn |  |
| 1182 | `redactDiagnosticText` | fn |  |
| 1195 | `shouldPersistBreadcrumb` | fn |  |
| 1201 | `validCdpPort` | fn |  |
| 1205 | `readCdpPortFile` | fn |  |
| 1214 | `writeCdpPortFile` | fn |  |
| 1229 | `readUiPortFile` | fn |  |
| 1233 | `writeUiPortFile` | fn |  |
| 1248 | `cdpPortCandidates` | fn |  |
| 1250 | `add` | const |  |
| 1258 | `isLocalPortAvailable` | fn |  |
| 1262 | `finish` | const |  |
| 1277 | `findAvailableCdpPort` | fn |  |
| 1284 | `selectCdpPort` | fn |  |
| 1360 | `updateSourceOrder` | fn | 源尝试顺序：粘性源优先，其余按 UPDATE_SOURCES 定义顺序补齐 |
| 1365 | `updateDebug` | fn |  |
| 1366 | `scrub` | const |  |
| 1396 | `writeUpdateAttempt` | fn |  |
| 1407 | `macWorkDaddyAppPath` | fn |  |
| 1430 | `resolveApplyUpdateVbs` | fn |  |
| 1449 | `semverCompare` | fn | 简单 semver 比较：a > b → 1，a < b → -1，相等 → 0（忽略预发布后缀） |
| 1462 | `hardTimeout` | fn | 这里用独立定时器到点强制 destroy + reject，保证「检查更新」不会长时间挂着。返回取消函数。 |
| 1474 | `httpsGet` | fn | 带超时的 HTTPS GET（返回 statusCode + body + headers） |
| 1503 | `githubAuthHeaders` | fn |  |
| 1513 | `latestTagViaHtml` | fn | 这条路径不消耗 GitHub API 配额，是 API 被限流时的兜底检测手段（拿不到资产名与 SHA-256）。 |
| 1537 | `deterministicAssetURL` | fn | 用于 API 被限流、只剩「网页检测」时的下载兜底；URL 可用不代表有 SHA-256。 |
| 1539 | `fileName` | const |  |
| 1544 | `updateApiErrorText` | fn | API 不可用时的统一提示语（区分限流/超时/不可见，便于判断是网络、代理还是仓库问题） |
| 1558 | `isNetworkFailure` | fn | 再试网页兜底只是白等一次超时，直接走缓存兜底。 |
| 1567 | `parseSha256` | fn | 注：GitHub 现在会为上传的资产自动给出 digest，正常路径走 asset.digest，这里只是兜底。 |
| 1581 | `parseSha256Map` | fn | Gitee 镜像没有 asset.digest 字段，多资产发布必须在 notes 里逐文件给哈希。 |
| 1591 | `normalizeAssetSha256` | fn |  |
| 1596 | `expectedUpdateSha256` | fn |  |
| 1601 | `checkUpdate` | fn | 检查更新：按源降级链请求 Releases API（GitHub 失败自动降级 Gitee），比对版本，结果写缓存（内存 + 文件） |
| 1653 | `assets` | const | 的 /releases/download/ 路径，防止响应里的任意地址被当作安装包来源。 |
| 1697 | `applyCache` | const | 二次兜底：读上次成功缓存。只认同一仓库的缓存，避免换源后读到旧数据。 |
| 1756 | `checkUpstreamUpdate` | fn | 上游官方安装包不含本修改版补丁，装上去等于退回官方状态，因此这里只提示、不下载安装。 |
| 1789 | `readUpstreamCache` | const |  |
| 1837 | `checkUpdateBoth` | fn | 面板「检查更新」按钮与后台定时检查统一走这里，保证两个版本号一次刷新到位。 |
| 1845 | `versionCheckPayload` | fn | 「关于」页需要的版本汇总字段（两个版本号 + 任一有更新即 anyUpdate） |
| 1871 | `downloadUpdate` | fn | 同一 daemon 内只允许一个下载流程，避免并发请求互相删除/覆盖固定目标文件。 |
| 1880 | `downloadUpdateInternal` | fn |  |
| 1938 | `cleanupTemp` | const |  |
| 1940 | `failDownload` | const |  |
| 2026 | `sha256File` | fn | 计算文件 SHA-256 |
| 2030 | `inspectPackagedApp` | fn |  |
| 2047 | `packagedAppVersionError` | fn |  |
| 2061 | `validateUpdateArtifact` | fn | 和旧版残留文件都可能留下普通文件。hdiutil imageinfo 是 macOS UDIF 的确定性预检。 |
| 2115 | `normTs` | fn | 时间戳归一化：秒/毫秒/字符串 → 毫秒；无效返回 null |
| 2123 | `httpJson` | fn | 带超时的 JSON 请求（返回解析后的 JSON；解析失败回退 {code,message}） |
| 2163 | `buildSeamlessAuthFile` | fn | （{account, auth, accounts, allAccounts}，与 lib.js switchTo 写回的格式一致） |
| 2230 | `scheduleOAuthStateCleanup` | fn |  |
| 2236 | `saveSeamlessAccount` | fn | 把无感登录采集到的账号写入 accounts/<uid>.info 备份（不触碰当前登录文件） |
| 2257 | `oauthPollOnce` | fn | 轮询一次授权结果：未完成返回 {done:false}；完成则入库并返回账号信息 |
| 2286 | `accData` | const |  |
| 2298 | `extractAppFromDmg` | fn | 从 dmg 中解出 WorkDaddy.app 到 UPDATE_DIR（挂载→拷贝→卸载），返回 app 目录 |
| 2346 | `applyUpdate` | fn | 由 Inno Setup 确认 WorkBuddy 已退出、替换文件并启动新版。 |
| 2371 | `markAttemptFailure` | const |  |
| 2380 | `markSpawnFailure` | const |  |
| 2502 | `rotateLogsIfNeeded` | fn | logWriteCount 声明在文件前部（模块初始化阶段也要能写日志，见那里的注释） |
| 2517 | `log` | fn |  |
| 2528 | `isLockPermissionError` | fn |  |
| 2532 | `reportDaemonLockFallback` | fn |  |
| 2542 | `isCurrentWindowsDaemonProcess` | fn |  |
| 2577 | `acquireDaemonLock` | fn | Windows 数据目录锁不可写时，使用同一台机器用户临时目录中的哈希锁继续保证单实例。 |
| 2634 | `releaseDaemonLock` | fn |  |
| 2647 | `scheduleBackup` | fn |  |
| 2721 | `settlePendingReloadInjection` | fn |  |
| 2733 | `armPendingReloadInjection` | fn |  |
| 2755 | `runPendingReloadInjection` | fn |  |
| 2782 | `findCdpEndpoint` | fn |  |
| 2791 | `ports` | const | 不会退化成「只看标题」的猜测，也就不会误连兄弟端。 |
| 2826 | `targetsBelongToProfile` | fn |  |
| 2846 | `isWorkBuddyCdpTarget` | fn |  |
| 2852 | `getPageTarget` | fn |  |
| 2858 | `cleanupForeignInjectedTargets` | fn |  |
| 2866 | `cleanupForeignInjectedTarget` | fn |  |
| 2875 | `finish` | const |  |
| 2918 | `cdpFocusDiagnostics` | fn |  |
| 2932 | `cdpMouseClick` | fn |  |
| 2955 | `cdpSend` | fn |  |
| 2973 | `cdpActivatePage` | fn | 激活页面（强制 lifecycle active + 置前），供 cdpSend 自动恢复与 devtools-proxy 保活复用 |
| 2974 | `raw` | const |  |
| 2986 | `connectCdp` | fn |  |
| 3063 | `waitForPageReadyThenDispatch` | fn |  |
| 3065 | `retry` | const |  |
| 3078 | `dispatchAutomationEvent` | fn |  |
| 3114 | `onCdpEvent` | fn |  |
| 3122 | `url` | const |  |
| 3212 | `resetClientDebugState` | fn |  |
| 3222 | `updateClientDebugState` | fn | clientRunning: true=进程在跑 / false=没跑 / null=未知（探测失败时不计数，避免误报） |
| 3244 | `safeClientRunning` | fn | __wbsClientDebugStateBlockEnd |
| 3273 | `lightClientRunning` | fn | 本函数只回答「在不在跑」。 |
| 3317 | `clientRunningRefreshDelay` | fn | 不提供 process，顶层读取会直接抛 ReferenceError。 |
| 3325 | `refreshClientRunning` | fn |  |
| 3347 | `startClientRunningMonitor` | fn | --probe-client-running 也会加载本文件，提前刷新会递归拉起探测子进程。 |
| 3355 | `cdpLoop` | fn |  |
| 3391 | `ideSend` | fn |  |
| 3410 | `ideInjectPage` | fn |  |
| 3457 | `ideConnectPage` | fn |  |
| 3515 | `ideSyncScan` | fn |  |
| 3548 | `reloadIdeWorkbenchWindows` | fn | 会触发 clearHistoryIndexCache。reload 后 loadEventFired 处理器会自动补注入。 |
| 3562 | `reloadWorkBuddyPage` | fn |  |
| 3564 | `withTimeout` | const |  |
| 3606 | `autoFocusSessionByTitle` | fn | 并自动展开折叠的分组；最长约 26s，找不到则静默放弃。 |
| 3729 | `queryWindowsWorkBuddyProcesses` | fn |  |
| 3743 | `resolveWorkBuddyBinary` | fn |  |
| 3746 | `tryFile` | const |  |
| 3758 | `psCmd` | const |  |
| 3787 | `addCandidate` | const |  |
| 3831 | `psQuote` | const |  |
| 3848 | `runCommand` | fn |  |
| 3855 | `finish` | const |  |
| 3879 | `restoreWorkBuddyWindow` | fn | Windows 的 WorkBuddy 可能记住“最小化到托盘”状态；重启后显式恢复主窗口，避免只看到托盘图标。 |
| 3908 | `verifiedWindowsWorkBuddyProcesses` | fn |  |
| 3924 | `revalidateWindowsWorkBuddyProcess` | fn |  |
| 3941 | `linuxWorkBuddyPids` | fn |  |
| 3965 | `workBuddyRunning` | fn |  |
| 3982 | `waitForWorkBuddyExit` | fn |  |
| 3997 | `waitForWorkBuddyExitTolerant` | fn |  |
| 4009 | `quitWorkBuddy` | fn | 退出 WorkBuddy，并确认进程已经消失；失败时拒绝继续登录切换。 |
| 4055 | `detail` | const |  |
| 4087 | `findWorkDaddyApp` | fn | 探测 WorkDaddy.app 位置（macOS 专用：退出登录后打开它，由其 launcher 以 CDP 模式重启 WorkBuddy 并注入组件） |
| 4113 | `resolveLauncherHome` | fn |  |
| 4123 | `resolveLinuxLaunchTarget` | fn |  |
| 4138 | `relaunchWorkBuddy` | fn | 重新启动 WorkBuddy：macOS 优先走 WorkDaddy.app launcher；Windows 直接带 CDP 参数重启 exe |
| 4219 | `clickByText` | fn |  |
| 4265 | `findByText` | fn |  |
| 4294 | `CLAIM_TEXTS` | const | ================= 自动领取积分（轮询点击"立即领取"） ================= |
| 4300 | `claimDebugFile` | fn | 临时调试日志：把领取查找过程写到 /tmp，方便排查"明明有按钮却识别不到" |
| 4303 | `claimLog` | fn |  |
| 4311 | `sleep` | fn |  |
| 4316 | `waitPageLoaded` | fn | 等待页面加载完成（reload 后调用），超时返回 false |
| 4363 | `automationStateFile` | const |  |
| 4364 | `readAutomationState` | fn |  |
| 4367 | `writeAutomationState` | fn |  |
| 4373 | `automationAccountStatus` | fn |  |
| 4407 | `automationDeepLocatorExpression` | fn |  |
| 4422 | `first` | fn |  |
| 4427 | `choose` | fn |  |
| 4428 | `firstByAttribute` | fn |  |
| 4438 | `automationDomAction` | fn |  |
| 4439 | `assertActive` | const |  |
| 4452 | `read` | const |  |
| 4508 | `automationHttpRequest` | fn |  |
| 4531 | `automationPublicRun` | fn |  |
| 4539 | `automationPanelSetInputActive` | fn | 运行结束若运行前面板本是展开的，再走「点机器人按钮」同一条 setOpen(true) 恢复。全程可逆。 |
| 4554 | `automationPanelSetOpen` | fn |  |
| 4562 | `automationPanelIsOpen` | fn | 读当前面板是否展开（.wbs-panel 是否带 .show，且视觉可见） |
| 4571 | `automationClearStaleHideTag` | fn | daemon 重启/运行中断可能残留，页面会一直面板不可见）。无 tag 时是 no-op，不影响面板开合状态。 |
| 4584 | `automationMarkerProbeExpression` | fn | 返回值 { lastText, lastDone, rowCount } |
| 4599 | `automationNotifyToast` | fn |  |
| 4629 | `isAutoCopyJobSettled` | fn | 本地作业模型：status ∈ queued\|running\|done\|partial\|conflict\|error\|paused，没有完成 Promise。 |
| 4630 | `assertAutoCopySucceeded` | fn |  |
| 4636 | `recordAccountSyncResult` | fn |  |
| 4648 | `assertAccountSwitchIdle` | fn |  |
| 4654 | `automationSwitchProgress` | fn |  |
| 4662 | `waitAutomationSyncBounded` | fn | 等入向同步「落定且成功」。被停止时立刻抛出（让上层走收尾），超时抛错而不是无限等。 |
| 4679 | `drainAutoCopyJobBounded` | fn | 停止后仍要等正在写盘的作业落定再释放账号锁 —— 提前释放会让「还原账号」与文件提交撞车。 |
| 4685 | `acquireAutomationAccountSwitch` | fn | 抢账号锁：忙碌时**有界等待**（上游是无限轮询），超时抛错。 |
| 4732 | `limitFailoverManualPublic` | fn |  |
| 4751 | `readLimitFailoverState` | fn |  |
| 4760 | `writeLimitFailoverState` | fn |  |
| 4771 | `limitFailoverAccounts` | fn | 全量账号（保证顺序）+ 已缓存的积分段（若该账号被查过积分）。 |
| 4785 | `orderCheckinAccounts` | fn | 未知到期时间排最后；到期时间相同保持原顺序（稳定排序，同上游 accountCreditCache.order 语义）。 |
| 4801 | `runCdpExpression` | fn |  |
| 4812 | `readLimitBanner` | fn |  |
| 4825 | `readStructuredError` | fn |  |
| 4829 | `readLiveModel` | fn |  |
| 4833 | `setLiveModel` | fn |  |
| 4837 | `readLastUserTaskText` | fn |  |
| 4845 | `readFailoverSnapshot` | fn |  |
| 4861 | `pickWorkbuddyDaemonClient` | fn |  |
| 4863 | `walk` | fn |  |
| 4900 | `cloudAgentCallExpression` | fn | 拼一次「渲染层调用 daemonClient[method](params)」的自包含表达式。 |
| 4915 | `cloudAgentCall` | fn | 调一次云侧能力，永不外抛 —— 失败以 `{ok:false,error}` 返回，便于上层分类。 |
| 4932 | `edgeSyncMappingDbPath` | fn |  |
| 4947 | `getEdgeSyncDb` | fn |  |
| 4960 | `readEdgeSyncRows` | fn |  |
| 4973 | `listLocalSessionIds` | fn | 本地仍存在的会话 id 集合（跨全部账号）——只有「本地已没了」的才算残留。 |
| 4999 | `probeCloudConversations` | fn |  |
| 5026 | `collectCloudGhosts` | fn |  |
| 5064 | `purgeCloudConversations` | fn |  |
| 5098 | `purgeCloudCopiesAfterLocalDelete` | fn |  |
| 5115 | `waitCloudClientReady` | fn | 切号会让页面整页 reload，React 树随之重建 —— 等 daemon 客户端重新挂上再动手。 |
| 5133 | `purgeCloudGhostsSwitching` | fn |  |
| 5142 | `switchBack` | const |  |
| 5183 | `limitReplyStartedExpression` | fn | 续跑是否已经"跑起来"：消息流里出现流式请求，或最后一条是 assistant。 |
| 5193 | `limitReplyStarted` | fn |  |
| 5198 | `taskHasFailoverStep` | fn | 找出启用中、且带 account.failoverContinue 步骤的任务（不写死 id，用户改名换 id 也能用）。 |
| 5205 | `findLimitFailoverTask` | fn |  |
| 5209 | `runningLimitFailoverRun` | fn |  |
| 5213 | `waitLimitVerdict` | fn |  |
| 5238 | `runLimitFailoverCore` | fn |  |
| 5269 | `hits` | const |  |
| 5558 | `buildLimitFailoverPorts` | fn |  |
| 5643 | `limitFailoverDesktopLogDir` | fn |  |
| 5652 | `writeAccountSwitchDesktopLog` | fn | 写桌面日志。**任何情况下都不抛**：日志写不出来不能影响切号本身。 |
| 5666 | `limitFailoverNotify` | fn |  |
| 5674 | `readLimitReplyIdle` | fn |  |
| 5678 | `limitFailoverAccountByUid` | fn |  |
| 5684 | `limitFailoverPrimaryUid` | fn |  |
| 5692 | `limitFailoverBlockedUntil` | fn | 两处一旦口径分叉，「选备选账号」与「等主账号窗口」就会各按各的时间走。 |
| 5698 | `limitFailoverLiveRole` | fn | 当前账号相对这次切号计划的状态：target(还在续跑账号) / primary(已经回到主账号) / other / unknown |
| 5707 | `cancelLimitFailoverSwitchBack` | fn |  |
| 5720 | `limitFailoverPlanCancelled` | fn |  |
| 5724 | `finishLimitFailoverSwitchBack` | fn |  |
| 5747 | `waitLimitFailoverChunks` | fn | 分片等待：期间随时可被「新一轮切号 / 手动切号 / 取消」打断 |
| 5762 | `runLimitFailoverSwitchBack` | fn |  |
| 5763 | `isCancelled` | const |  |
| 5764 | `elapsedMs` | const |  |
| 5765 | `stopIfUnsafe` | const |  |
| 5885 | `scheduleLimitFailoverSwitchBack` | fn |  |
| 5920 | `handleLimitFailoverOutcome` | fn | 注意 skip 不算「触发」，不写日志也不排切回。 |
| 5982 | `idleSwitchbackBusy` | fn | 此刻是否「不该抢账号」：任何任务在跑、切号在飞、切回计划待执行都算 |
| 5992 | `readSessionActivity` | fn |  |
| 5997 | `idleSwitchbackPublicState` | fn |  |
| 6030 | `runIdleSwitchBack` | fn | 真正执行一次「闲置切回」。切之前把所有前置条件再确认一遍（等待期间世界可能已经变了）。 |
| 6108 | `idleSwitchbackTick` | fn |  |
| 6167 | `startIdleSwitchbackTicker` | fn |  |
| 6179 | `automationSwitchAccount` | fn |  |
| 6238 | `readAutomationTurnState` | fn | ⚠️ hydration 不算「在飞」：历史还在加载时切号是安全的（v1.3.16 的教训）。 |
| 6245 | `waitForAutomationReplySettle` | fn | 等「当前会话没有在生成的回合」，最长 maxMs。ok:false 表示等满预算仍在生成。 |
| 6263 | `automationSwitchAccountWithSync` | fn | 行为与改动前完全一致 —— 闸门只加在「切完号要跑 steps」这一条路径上。 |
| 6276 | `runSwitch` | const | 会把其它运行的 DOM/发送步骤一起堵死（withInput 是模块级共享闸门）。 |
| 6299 | `automationRestoreAccountDeferring` | fn | 而硬切会掐死在跑的定时任务；代价不对等。 |
| 6311 | `automationAccountSwitchGuarded` | fn |  |
| 6333 | `automationNotificationNamespace` | fn |  |
| 6339 | `startAutomationRun` | fn |  |
| 6355 | `isCancelled` | const |  |
| 6358 | `appendRunLog` | const |  |
| 6373 | `panelPrepare` | const |  |
| 6385 | `withInput` | const |  |
| 6402 | `unconfirmedSendError` | const | ⚠️ 语义对齐 daemon.js 里那条既有政策：Do not retry an unconfirmed send. |
| 6412 | `readSession` | const | 必须保持原语义，否则会波及后面的「发送是否被受理」判定）。 |
| 6420 | `sessionAction` | const |  |
| 6428 | `openedUid` | const |  |
| 6459 | `accountUid` | const |  |
| 6555 | `completionReport` | const |  |
| 6582 | `publicAccounts` | const |  |
| 6583 | `publicCurrent` | const |  |
| 6586 | `sessionActionWithReceipt` | const | 定时任务核验台账把它当成 success 的凭据存起来（不改任何发送行为，只是旁路记录）。 |
| 6654 | `resumeAutomationAfterNavigation` | fn |  |
| 6665 | `todayStr` | fn |  |
| 6667 | `z` | const |  |
| 6671 | `loadCheckinCache` | fn |  |
| 6678 | `saveCheckinCache` | fn |  |
| 6701 | `accountBackupSignature` | fn | 备份文件的「指纹」（mtime+size）：文件换了，落盘的那份刷新时间就不再可信。 |
| 6710 | `loadTokenRefreshState` | fn |  |
| 6721 | `saveTokenRefreshState` | fn |  |
| 6735 | `persistedTokenRefreshState` | fn | 只有「备份文件未变」时，落盘的那份刷新时间才可信（否则宁可当没刷过）。 |
| 6741 | `rememberTokenRefreshSuccess` | fn |  |
| 6758 | `listAccountsWithRuntimeTokenCache` | fn |  |
| 6785 | `persistRefreshedAccount` | fn |  |
| 6807 | `refreshAccountBackupToken` | fn | 账号备份刷新：读 → 刷 → 按原信封加密写回。加密态在刷新前先预检可写性。 |
| 6875 | `refreshAllAccountTokensOnPanelOpen` | fn |  |
| 6877 | `task` | const |  |
| 6881 | `worker` | const |  |
| 6913 | `dailyCheckin` | fn |  |
| 6962 | `claimDailyForUid` | fn |  |
| 6971 | `performAccountCheckin` | fn |  |
| 7017 | `injectWidget` | fn | 通过 CDP 把右下角组件注入到 WorkBuddy 渲染进程（幂等，可反复调用） |
| 7083 | `desc` | const |  |
| 7128 | `buildInjectScript` | fn |  |
| 7170 | `html` | fn |  |
| 7172 | `set` | method |  |
| 7175 | `set` | method |  |
| 7178 | `value` | method |  |
| 7229 | `waitForCdpReady` | fn | c. 都不成才把原始错误交出去，由 launcher 按自己的节奏继续重试。 |
| 7242 | `ideChannelMounted` | fn |  |
| 7249 | `injectWidgetManual` | fn |  |
| 7271 | `readCdpTargets` | fn |  |
| 7282 | `readLogTail` | fn |  |
| 7293 | `collectDiagnostics` | fn |  |
| 7318 | `writeDiagnosticsSnapshot` | fn |  |
| 7362 | `codeBuddyProfileOwnerIds` | fn | 认不出来的 owner 保留（可能是删掉的账号或旧安装留下的），宁可多算也不静默丢。 |
| 7372 | `codeBuddyForeignOwnerIds` | fn |  |
| 7383 | `assertCodeBuddySessionsIdle` | fn | 渲染层问不到。运行中的会话被改归属会丢正文，所以写入前必须先问一次。 |
| 7386 | `sessions` | const |  |
| 7392 | `sqliteRun` | fn |  |
| 7395 | `sqliteQuery` | fn |  |
| 7410 | `officialSlotOf` | fn | 本地时区槽位 `YYYY-MM-DDTHH:MM`（与 scheduled-send 的 localSlot 同格式）。 |
| 7411 | `pad` | const |  |
| 7428 | `readOfficialAutomations` | fn |  |
| 7439 | `items` | const |  |
| 7473 | `findOfficialSlotConflicts` | fn |  |
| 7502 | `sessionPayloadExists` | fn | 会话载荷确实存在，并逐级拒绝符号链接/普通文件后再创建缺失目录。 |
| 7521 | `createDirectoryNoFollow` | fn |  |
| 7544 | `repairMissingSessionWorkspaces` | fn |  |
| 7613 | `sessionRangeMs` | fn |  |
| 7630 | `copySessionFiles` | fn | workspace/sessions/<id>/ 产物目录留到第二阶段单独复制，避免单条会话堵死整条串行队列。 |
| 7634 | `copyOne` | const |  |
| 7660 | `onlyCopyable` | const | 要拦的只有 socket / FIFO / 字符设备 / 块设备这类**根本无法复制**的特殊文件。 |
| 7768 | `sessionBodyMtime` | fn |  |
| 7785 | `sessionContentMtime` | fn |  |
| 7789 | `visit` | const |  |
| 7823 | `directoryStats` | fn |  |
| 7852 | `measurePathBytes` | fn | 单条路径的体积：文件取 stat.size，目录递归求和。与 directoryStats 同口径（跳过符号链接）。 |
| 7863 | `sessionBucketPaths` | fn | 会话的全部本地路径，供体积统计与产物复制复用。 |
| 7889 | `sessionContentSize` | fn | 会话总体积 + 其中「产物目录」（workspace/sessions/<id>/）的体积。 |
| 7904 | `formatByteSize` | fn | 人类可读体积，用于日志与进度提示。 |
| 7915 | `autoCopySessionLabel` | fn | 会话展示名，用于进度条上「正在处理哪个会话」。 |
| 7935 | `sortAutoCopyPlanBySize` | fn |  |
| 7954 | `readCopyManifestCache` | fn |  |
| 7965 | `invalidateCopyManifestCache` | fn | 让缓存失效（写完清单后必须调，否则下一次排序还会拿到旧解析结果）。 |
| 7974 | `deriveCopyManifestFromCache` | fn |  |
| 8001 | `workspaceLinkMode` | fn | 读取 meta.autoCopy.workspaceLinkMode（'link' \| 'copy'），缺省为 link。 |
| 8012 | `detectWorkspaceLinkSupport` | fn | 一次性探测：当前卷是否支持硬链接。失败则本进程内永久回落复制。 |
| 8034 | `emptyWorkspaceCounters` | fn |  |
| 8042 | `transferWorkspaceTree` | fn |  |
| 8050 | `copyFileAt` | const |  |
| 8143 | `copySessionWorkspacePayload` | fn |  |
| 8165 | `outcome` | const |  |
| 8177 | `yieldAutoCopyToRenderer` | fn | reliable source of truth; choose the freshest on-disk snapshot first. |
| 8198 | `syncAutoCopyLineage` | fn | 不变量 I-1：全表 status='archived' 的行只允许属于主账号。 |
| 8332 | `changedSinceBaseline` | const | 若还让它拦在前面 return，内容判据永远走不到 —— 两条判据同时存在只会互相打架。 |
| 8356 | `forcedSource` | const | content 模式那两道闸门用的是另一个独立布尔 forcePinnedSource（见上）。 |
| 8368 | `trackPayload` | const |  |
| 8426 | `sleepMs` | const |  |
| 8537 | `autoCopyConflictSnapshot` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 8583 | `listAutoCopyConflicts` | fn |  |
| 8596 | `dismissAutoCopyConflict` | fn | 只推进标尺、不碰会话内容 —— 这是「默认安全」的那一半：解掉自锁，数据一个字节都不动。 |
| 8610 | `preferAutoCopyConflict` | fn | 「以某个账号为准覆盖其余」——会丢数据，只在用户显式选择时调用。 |
| 8636 | `deleteSessionsCore` | fn | 删主账号的会话 → 向下级联，其他账号的同源副本一起删；删非主账号 → 只删本账号那一份。 |
| 8736 | `readNativeDeleteSweep` | fn |  |
| 8743 | `saveNativeDeleteSweep` | fn |  |
| 8756 | `pendingNativeDeletes` | fn | 水位线之后的待处理软删（只读，供进度展示与 sweep 使用） |
| 8763 | `sweepNativeSessionDeletes` | fn |  |
| 8835 | `readArchiveIsolation` | fn |  |
| 8842 | `saveArchiveIsolation` | fn |  |
| 8856 | `archiveIsolationEnabled` | fn |  |
| 8861 | `collectArchivedCopyState` | fn | 只读：全表 archived 活行 + 血缘登记索引（判定「这份副本在主账号那边还在不在」用） |
| 8877 | `members` | const |  |
| 8945 | `listArchivedCrossAccountCopies` | fn | 只读报告：主账号该留的 / 其他账号该清的 / 归类不明只上报的 |
| 8994 | `purgeLocalSessionCopyCore` | fn |  |
| 9026 | `purgeArchivedCrossAccountCopies` | fn |  |
| 9077 | `sweepArchivedCopies` | fn | 常驻拍子：只在「当前登录账号 ≠ 主账号」时删该账号名下的归档行（判定链见段首注释） |
| 9154 | `summarizeSessionImportErrors` | fn |  |
| 9164 | `archiveRelativePath` | fn |  |
| 9168 | `collectSessionArchiveFiles` | fn |  |
| 9171 | `collect` | const |  |
| 9211 | `ensureArchiveParentNoFollow` | fn |  |
| 9230 | `restoreSessionArchiveFiles` | fn |  |
| 9253 | `restoreStagedSessionArchiveFiles` | fn | from a JSON API payload or an unverified archive entry. |
| 9284 | `getSessionSyncCache` | fn |  |
| 9307 | `scheduleSessionSyncCacheSave` | fn | timer.unref() —— 缓存是尽力而为的，绝不允许它拖住 daemon 退出。 |
| 9323 | `isTaskSessionRecord` | fn |  |
| 9328 | `sqlPlaceholders` | fn |  |
| 9332 | `insertCopiedSession` | fn |  |
| 9362 | `createForkSession` | fn |  |
| 9395 | `prepareSessionExport` | fn |  |
| 9412 | `exportSessions` | fn |  |
| 9426 | `validImportedSessionUid` | fn |  |
| 9432 | `importSessions` | fn |  |
| 9436 | `importSessionArchives` | fn |  |
| 9484 | `adoptExistingCopyTarget` | fn |  |
| 9528 | `copySessionRecord` | fn |  |
| 9545 | `perform` | const |  |
| 9556 | `finishAutoDirty` | const |  |
| 9560 | `retain` | const |  |
| 9699 | `getSessionDirtyIndex` | fn |  |
| 9707 | `scheduleSessionDirtySave` | fn |  |
| 9724 | `markSessionDirty` | fn | 记一条脏标记；**只有真变化才置脏**（同一时刻的重复通知不写盘）。 |
| 9737 | `markSessionDirtyBaseline` | fn | renderer 建立基线（`body.ready`）。未建基线的账号一律 fail-open = 全当脏。 |
| 9742 | `clearSessionDirty` | fn | 清一条脏标记；`expectedAt` 不匹配就不清（**并发到来的新事件不许被旧的在飞清理抹掉**）。 |
| 9751 | `autoCopyDirtyFastpathEnabled` | fn | 批次 3 的开关：**默认关**（文件缺失 / 内容不是 {enabled:true} 都算关）。每次规划读一次。 |
| 9767 | `isAutoCopyRowCleanByDirty` | fn |  |
| 9772 | `lineageId` | const |  |
| 9781 | `buildAutoCopyPlan` | fn |  |
| 9864 | `isAutoCopyPausedError` | fn |  |
| 9871 | `beginRendererReloadPriority` | fn |  |
| 9886 | `hasPendingAutoCopyTo` | fn |  |
| 9895 | `pruneAutoCopyJobs` | fn |  |
| 9905 | `runAutoCopyQueue` | fn |  |
| 9935 | `autoCopyAfterAccountSwitch` | fn | 三个调用点统一走这里，别再各写一份（写散了必然漏）。 |
| 10002 | `enterSwitchFlowRunner` | fn | 进入一个切号流程；返回**幂等**的退出函数（重复调用不会把计数减成负）。 |
| 10031 | `setSwitchFlowPhase` | fn |  |
| 10037 | `terminal` | const |  |
| 10072 | `readSwitchFlowState` | fn | 读状态（惰性过期：终态留 TTL 供渲染层读到，过期即清）。 |
| 10084 | `requestSwitchFlowCancel` | fn | 「关闭弹窗」：置取消位 + 立刻请求中止复制（worker 在下个检查点收尾，不是硬停）。 |
| 10138 | `waitPreSyncSettled` | fn |  |
| 10192 | `preSyncBeforeSwitch` | fn |  |
| 10294 | `resolveSyncNowSources` | fn |  |
| 10295 | `all` | const |  |
| 10331 | `limitFailoverSyncWaitMs` | fn |  |
| 10366 | `openConversationById` | fn |  |
| 10390 | `fastExpr` | const |  |
| 10475 | `sidebarProbe` | const |  |
| 10645 | `prepareFailoverContinuation` | fn |  |
| 10651 | `degrade` | const |  |
| 10753 | `startAutoCopyJob` | fn |  |
| 10826 | `run` | const |  |
| 10834 | `finishPaused` | const | 任务（复制本身幂等：已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11118 | `activeAutoCopyJob` | fn |  |
| 11131 | `publicAutoCopyJob` | fn |  |
| 11213 | `publicSpaceScanJob` | fn |  |
| 11237 | `buildSpaceScanResolvers` | fn |  |
| 11283 | `readSpaceScanCache` | fn | 读缓存：面板打开时先用旧结果秒出，再决定要不要重扫。 |
| 11295 | `startSpaceScanJob` | fn |  |
| 11385 | `isValidSessionId` | fn |  |
| 11394 | `matchedSessionIds` | fn |  |
| 11399 | `resolveManagedSessionTarget` | fn |  |
| 11412 | `isManagedDirectoryNoFollow` | fn |  |
| 11436 | `removeSessionAppCache` | fn | app/sessions.json 是共享窗口缓存，只移除所选会话的条目，不删除整个文件或 app 目录。 |
| 11470 | `deleteSessionFiles` | fn | tasks/<id>/、file-history/<id>/、artifact-index/<id>.json（全部按会话 id 精确删除，不可恢复） |
| 11476 | `delOne` | const |  |
| 11520 | `json` | fn |  |
| 11551 | `isAllowedApiOrigin` | fn |  |
| 11571 | `hasApiToken` | fn |  |
| 11578 | `isApiRequestAuthorized` | fn |  |
| 11587 | `isAllowedDevtoolsOrigin` | fn |  |
| 11627 | `readBody` | fn |  |
| 11632 | `ignoreLateError` | const |  |
| 11633 | `cleanup` | const |  |
| 11643 | `finish` | const |  |
| 11649 | `fail` | fn |  |
| 11655 | `onData` | fn |  |
| 11668 | `onEnd` | fn |  |
| 11679 | `onError` | fn |  |
| 11682 | `onIncomplete` | fn |  |
| 11714 | `workbuddySettingsPath` | fn |  |
| 11718 | `readWorkbuddySettings` | fn |  |
| 11726 | `writeWorkbuddySettings` | fn |  |
| 11732 | `buildAskRuleBlock` | fn |  |
| 11737 | `stripAskRule` | fn | 从 customPrompt 中移除 wbs 规则段（保留用户其它内容） |
| 11747 | `getAskModeState` | fn |  |
| 11749 | `customPrompt` | const |  |
| 11762 | `setAskMode` | fn |  |
| 11777 | `refreshAskModeIfEnabled` | fn | 启动时调用：如已启用决策弹窗，把旧的 ASK_MODE_RULE 替换为最新版本（用 ASK_MODE_TAG_START/END 精确识别） |
| 11819 | `buildZhReasoningBlock` | fn |  |
| 11824 | `stripZhReasoning` | fn | 从 customPrompt 中移除中文思考段（保留用户其它内容与决策弹窗段） |
| 11834 | `getZhReasoningState` | fn |  |
| 11836 | `customPrompt` | const |  |
| 11852 | `setZhReasoning` | fn |  |
| 11872 | `refreshZhReasoningIfEnabled` | fn | 启动时调用：如已启用中文思考，把旧的规则段替换为最新版本（用标记精确识别） |
| 11897 | `readNoDisturbState` | fn |  |
| 11900 | `state` | const |  |
| 11922 | `readNoDisturbApplied` | fn |  |
| 11926 | `hasAll` | const |  |
| 11941 | `removeListItems` | fn |  |
| 11947 | `ensureSandboxObj` | fn |  |
| 11956 | `applyNoDisturbSwitch` | fn |  |
| 11960 | `recordAndMerge` | const | 关闭：仅回滚「本次新增」，绝不删除用户原有项。 |
| 11966 | `rollback` | const |  |
| 12014 | `setNoDisturbSwitch` | fn | 读-改-写（整文件原子替换），并维护 wbs.noDisturb.state |
| 12029 | `noDisturbAudit` | fn |  |
| 12064 | `acAppConfigPath` | fn |  |
| 12067 | `readAppConfig` | fn |  |
| 12075 | `writeAppConfig` | fn | 原子写 app-config.json：目录自动创建、0644、临时文件 + rename，写后由调用方读回校验 |
| 12080 | `acBlock` | fn |  |
| 12087 | `stripACBlocks` | fn |  |
| 12093 | `applyACBlock` | fn | 开启=追加（幂等：先剥离再追加，最终只保留一个最新 v1 块）；关闭=剥离 |
| 12099 | `acCustomPromptPresent` | fn |  |
| 12104 | `readAutoContinueState` | fn |  |
| 12119 | `setAutoContinue` | fn | 开启：先写 app-config（指令块），再持久化开关状态；关闭：先删除指令块，再持久化关闭状态 |
| 12136 | `refreshAutoContinueIfEnabled` | fn | 启动时调用：开关开启但指令块缺失/被外部改写 → 补写最新 v1 块；失败仅记录脱敏错误 |
| 12150 | `acDispatchEnter` | fn | 且内容非空时 Slate 自动隐藏占位符（解决 execCommand 模拟输入导致的占位符重叠/事件不生效）。 |
| 12167 | `acSendCurrentInput` | fn | 通过 CDP 直接发送「当前输入框已有内容」：仅聚焦 + 真实 Enter（不写入任何文字） |
| 12187 | `sessBuild` | fn |  |
| 12195 | `readSessionState` | fn |  |
| 12197 | `ns` | const |  |
| 12198 | `st` | const |  |
| 12230 | `writeSessionState` | fn |  |
| 12232 | `prior` | const |  |
| 12241 | `setSessionSwitch` | fn |  |
| 12249 | `addQuickPhrase` | fn |  |
| 12261 | `updateQuickPhrase` | fn |  |
| 12271 | `deleteQuickPhrases` | fn |  |
| 12278 | `normalizeQuickPhraseIds` | fn |  |
| 12290 | `exportQuickPhrases` | fn |  |
| 12306 | `importQuickPhrases` | fn |  |
| 12331 | `acSendPhrase` | fn | 通过 CDP 发送指定短语：聚焦 composer → 全选 → 真实输入短语 → 真实 Enter（replace 式发送，多行短语按段落插入） |
| 12340 | `selectAutomationModelById` | fn |  |
| 12353 | `confirmAutomationModel` | fn |  |
| 12361 | `restoreAutomationNewTaskPreference` | fn |  |
| 12369 | `automationAgentSurfaceExpression` | fn |  |
| 12371 | `visible` | fn |  |
| 12372 | `isNewTask` | fn |  |
| 12373 | `composerText` | fn |  |
| 12400 | `readAutomationAgentSurface` | fn |  |
| 12408 | `ensureAutomationNewTask` | fn |  |
| 12468 | `openNewAutomationAgentTask` | fn |  |
| 12487 | `currentAccount` | fn |  |
| 12493 | `a` | const |  |
| 12522 | `readAccountHealth` | fn |  |
| 12530 | `writeAccountHealth` | fn |  |
| 12546 | `recordAccountHealth` | fn |  |
| 12562 | `mergeLiveHealth` | fn |  |
| 12582 | `accountHealthRecords` | fn | 它只保留「今天签到成功」的记录，签到失败的 401 会被投影成 null，健康判据就断了。 |
| 12590 | `accountHealthBadges` | fn | 返回 `{ uid: 健康视图 }`。statusOnly=true 时去掉 uid 明细，只给状态接口用。 |
| 12607 | `groupAccountHealth` | fn | 按 state 分组 + 计数（`/api/account-health` 与面板概览用）。 |
| 12626 | `accountHealthSummary` | fn | 把健康视图投影成 /api/status 要的紧凑形状（**不带 uid 明细**）。 |
| 12642 | `sweepAccountHealth` | fn |  |
| 12661 | `buildFailoverHealthFilter` | fn |  |
| 12689 | `accountHealthUidOf` | fn | A8 端点的入参校验（与其他路由同一条 uid 口径）。 |
| 12699 | `accountHealthEcho` | fn |  |
| 12712 | `accountBackupFile` | fn |  |
| 12744 | `gatewayStatus` | fn |  |
| 12752 | `accountPool` | const | missing = 本仓有但池里没有（用户加的账号没进池）；stale = 池里有但本仓已删。 |
| 12798 | `gatewayCollectAccounts` | fn | 读本仓已登录的账号并解密（**复用 lib.js 的 [wd-compat] 解密器**，不另写一份帧格式）。 |
| 12807 | `auth` | const |  |
| 12808 | `account` | const |  |
| 12839 | `gatewaySyncAccounts` | fn |  |
| 12856 | `key` | const | 只在真的变了才写盘：本函数挂在每次账号备份之后，高频调用，无变化时不该碰磁盘。 |
| 12864 | `uidOf` | const |  |
| 12879 | `gatewaySyncAccountsQuiet` | fn | 同步后需要时给面板/日志一句话（安静版：只在真有变化时返回字符串）。 |
| 12894 | `gatewayProbeHealth` | fn | 探活（/healthz 免鉴权）。null = 不可达。 |
| 12913 | `gatewayFetchModels` | fn |  |
| 12945 | `sameGatewayOrigin` | fn |  |
| 12958 | `findGatewayModelEntry` | fn |  |
| 12970 | `readWorkbuddyModels` | fn |  |
| 12983 | `gatewayModelsOverview` | fn |  |
| 13021 | `by` | const |  |
| 13031 | `gatewayInstall` | fn | 下载 → SHA-256 校验 → 解压 → 凭证桥 → 生成 config。任一环节失败都不留半成品可用状态。 |
| 13033 | `task` | const |  |
| 13177 | `gatewayReadEnabled` | fn | 「用户是否启用」是 WorkDaddy 侧意图，与「装没装」分开记（沿用免打扰开关的记法）。 |
| 13184 | `gatewaySetEnabled` | fn |  |
| 13197 | `gatewayStart` | fn | 启动网关子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 13231 | `gatewayStop` | fn |  |
| 13258 | `gatewayHealthSnapshot` | fn |  |
| 13269 | `normalizeGatewayHealth` | fn | 把 /healthz 原始结果规范成面板要用的形状。 |
| 13285 | `gatewayPoolSnapshot` | fn |  |
| 13287 | `accounts` | const |  |
| 13289 | `tu` | const |  |
| 13311 | `realmTotals` | const |  |
| 13325 | `gatewayFetchJson` | fn | 带鉴权地打网关自己的 HTTP 接口（本仓持有 api_key，前端不必知道它）。 |
| 13350 | `gatewayFindPidByPort` | fn |  |
| 13365 | `gatewayLogTail` | fn | 读网关日志尾部（面板排障用；只读最后 N 行，不整份加载）。 |
| 13387 | `refreshGatewayIfEnabled` | fn |  |
| 13426 | `tunnelPaths` | fn |  |
| 13436 | `tunnelReadEnabled` | fn |  |
| 13443 | `tunnelSetEnabled` | fn |  |
| 13453 | `tunnelConfigInfo` | fn | 从 frpc.toml 取 admin API 口子与远端映射（配置是用户可改的，所以每次都读盘，不缓存）。 |
| 13457 | `num` | const |  |
| 13458 | `str` | const |  |
| 13474 | `tunnelProbe` | fn |  |
| 13508 | `tunnelStatus` | fn |  |
| 13515 | `proxies` | const |  |
| 13539 | `tunnelStart` | fn | 启动隧道子进程（stdio 用 ['ignore','pipe','pipe']：本环境给子进程建 stdin 管道会 EBUSY）。 |
| 13581 | `tunnelScheduleRestart` | fn | 退避重拉：3s 起，每次 ×1.6，封顶 60s；连续 20 次仍失败就停手等人工。 |
| 13606 | `tunnelStop` | fn |  |
| 13636 | `tunnelLogTail` | fn | 读隧道日志尾部（面板排障用）。 |
| 13656 | `refreshTunnelIfEnabled` | fn | 启动时：用户启用过就自动拉起（与网关 autoStart 同模式；未安装则静默跳过）。 |
| 13693 | `stashDir` | fn | ================= 暂存提示词（stash）辅助 ================= |
| 13698 | `safeKey` | fn | 与 /api/stash 写入时相同的 key 生成规则：safe(uid) + '__' + safe(conversationId) |
| 13703 | `listStashRecords` | fn | 扫描 stash 目录，返回全部暂存记录（按 savedAt 倒序）及 uid -> nickname 映射 |
| 13730 | `stashFilePath` | fn | key 文件名校验：替换非法字符但不截断（key 本身由 safe() 逐段限制长度，可能超过 80 字符） |
| 13736 | `stashRecordByKey` | fn |  |
| 13743 | `fetchConvNames` | fn | 通过 CDP 抓取侧边栏会话列表，返回 conversationId -> 会话名 映射（用于筛选下拉展示会话名而非 id） |
| 13771 | `deleteStashRecord` | fn | 删除单条暂存记录（删文件 + 同步 stash-index.json） |
| 13794 | `buildBusyExpr` | fn |  |
| 13805 | `visibleIn` | fn | 误判空闲会在回复中输入，正文/图片回填容易失败，这是原设计刻意保守的原因。 |
| 13832 | `waitAiIdle` | fn | 等待 AI 空闲；超时返回 false |
| 13843 | `busy` | const |  |
| 13874 | `resolveUsageBoardPython` | fn | 解析可用的 python：环境变量 → 托管 venv → 托管 base（版本目录）→ PATH 兜底。 |
| 13896 | `latestUsageBoardHtml` | fn | usage-board 目录里最新一份看板 HTML 文件名；没有则返回 null。 |
| 13907 | `latestUsageUnifiedHtml` | fn | 统一用量看板的产物：unified-board-<stamp>.html。 |
| 13921 | `creditUsageQuery` | fn |  |
| 13929 | `readUsageStatusJson` | fn |  |
| 13934 | `runUsageStatusExtractor` | fn | 跑一次第三方抽取器（只为补充指标）。失败/超时都只返回 ok:false，绝不抛。 |
| 13940 | `done` | const |  |
| 13962 | `builtinAssetsDir` | fn |  |
| 13978 | `builtinWallpaperSource` | fn |  |
| 13987 | `initBuiltinAssets` | fn |  |
| 14222 | `listThemes` | fn | 主题列表（内置 + 用户自定义；自定义文件与内置同名时以文件为准，不重复列出） |
| 14249 | `getTheme` | fn | 取主题完整定义（含 colors）。优先读 themes/ 目录的自定义文件（可覆盖内置同名主题），否则回退内置 |
| 14279 | `accountSwitchThemeExpression` | fn | 会被启动时的旧云端选择覆盖。这里不安装 hook，也不改其他账号或皮肤 CSS。 |
| 14324 | `preserveAccountSwitchTheme` | fn |  |
| 14341 | `nativeAppearanceSyncExpression` | fn | 的 CSS 资源；浅色/深色仍由 WorkBuddy 原生状态负责。 |
| 14344 | `removeNativeSheet` | fn |  |
| 14352 | `setAttr` | fn |  |
| 14357 | `setMode` | fn |  |
| 14368 | `sync` | fn |  |
| 14413 | `startNativeAppearanceSyncByCdp` | fn |  |
| 14418 | `releaseThemeByCdp` | fn |  |
| 14432 | `restoreNativeAppearanceByCdp` | fn |  |
| 14436 | `uid` | const |  |
| 14509 | `restoreSavedTheme` | fn | 恢复已保存的主题（CDP 连接/页面刷新后调用）：读取 current-theme.json 重新应用，保证深浅色在重启/刷新后仍生效 |
| 14553 | `loadThemePatches` | fn |  |
| 14569 | `themeExtrasCss` | fn | 主题附加样式：从 theme-patches.js 热加载，不硬编码在此 |
| 14581 | `loadThemeVars` | fn |  |
| 14597 | `themeVarsCss` | fn | 生成变量别名 CSS：isDark 时 darkOnly 条目加 html[data-theme="dark"] 前缀；浅色主题跳过 darkOnly 条目 |
| 14601 | `declOf` | const |  |
| 14612 | `lead` | const |  |
| 14620 | `readBackgroundBlur` | fn |  |
| 14631 | `applyThemeByCdp` | fn |  |
| 14665 | `uid` | const |  |
| 14667 | `colors` | const |  |
| 14790 | `wbsBuiltinAppearance` | fn | 让 WorkBuddy 内部 useTheme hook / 组件 theme prop 实时跟随，等价调用原生 setTheme()。 |
| 14802 | `wbsSnapshotNativeAppearance` | fn |  |
| 14826 | `wbsClearNativeCustomCss` | fn |  |
| 14865 | `wbsWriteAppearanceState` | fn |  |
| 14873 | `wbsSyncAppearanceKeys` | fn |  |
| 14900 | `wbsPrepareNativeAppearance` | fn |  |
| 14908 | `wbsSyncNativeTheme` | fn |  |
| 14922 | `wbsSyncNativeThemeQuiet` | fn | wbsSyncNativeThemeIdempotent：250ms 守护/keeper 的周期调用路径，属性同值时不写。 |
| 14977 | `keepSelectedTheme` | fn |  |
| 15015 | `wbsHasSpecialNativeAppearance` | fn |  |
| 15040 | `wbsHoldNativeAppearance` | fn |  |
| 15112 | `clearComposerByCdp` | fn |  |
| 15165 | `fnv1a32` | fn |  |
| 15182 | `composerDraftHash` | fn |  |
| 15199 | `composerDraftExpr` | fn |  |
| 15235 | `codeBuddySubmitExpr` | fn |  |
| 15264 | `composerDraftConsumed` | fn |  |
| 15295 | `composerSendExpr` | const |  |
| 15299 | `fiberOf` | fn |  |
| 15307 | `isStore` | fn |  |
| 15364 | `sendStashToComposer` | fn |  |
| 15370 | `guardedSend` | const |  |
| 15373 | `allItems` | const |  |
| 15382 | `s` | const |  |
| 15535 | `countBlocks` | const |  |
| 15545 | `pasteAndVerify` | const | 通用「合成 paste 后轮询验证 contentblock 增加」 |
| 15591 | `name` | const |  |
| 15607 | `disp` | const |  |
| 15639 | `visible` | fn |  |
| 15712 | `probeSendButton` | const | React may need more than one frame to enable the official send button. |
| 15726 | `readDraft` | const |  |
| 15734 | `draftConsumed` | const |  |
| 15737 | `awaitDraftConsumed` | const | 点击 / 接口调用之后统一的「草稿被吃掉了吗」等待（两条路径共用同一个判据）。 |
| 15848 | `fetchResource` | fn |  |
| 15882 | `data` | const |  |
| 15885 | `accounts` | const |  |
| 15917 | `fetchEnterpriseResource` | fn |  |
| 15963 | `robustFetchEnterpriseResource` | fn |  |
| 15986 | `resolveEnterpriseId` | fn |  |
| 16014 | `retryDelay` | const |  |
| 16018 | `robustFetchResource` | fn | 重试耗尽仍失败才抛出，由上层按现有错误路径处理。 |
| 16050 | `fetchCredits` | fn |  |
| 16108 | `refreshCreditRotationAccounts` | fn |  |
| 16132 | `rememberCreditRotation` | fn |  |
| 16144 | `cachedCreditRotationAccounts` | fn |  |
| 16156 | `listDailyUsage` | fn |  |
| 16162 | `syncCurrentCreditUsage` | fn |  |
| 16165 | `task` | const |  |
| 16206 | `exportSecretKey` | fn |  |
| 16210 | `decryptLegacyExport` | fn |  |
| 16221 | `handleApiRoute` | fn |  |
| 16553 | `currentHealth` | const |  |
| 17313 | `buildContextTiers` | const | 面板自己的 6 档预设不受影响（那是我们自己的下拉，不读这个数组）。 |
| 17519 | `uid` | const |  |
| 17582 | `d` | const |  |
| 17656 | `html` | const |  |
| 18001 | `uid` | const |  |
| 18145 | `dayOf` | const | 积分窗口与 token 窗口取同一个区间：分子分母同区间，否则 credit/1k 会被拉偏。 |
| 18202 | `finish` | const |  |
| 18279 | `pad` | const |  |
| 18287 | `prune` | const |  |
| 18480 | `worker` | const |  |
| 18517 | `uid` | const |  |
| 19112 | `probeModelEndpoint` | fn | 2xx/3xx/401/403/400/405 视为端点真实命中并立即返回；404/5xx/网络错误则继续尝试下一个候选。 |
| 19450 | `run` | const |  |
| 19700 | `targetUid` | const |  |
| 19729 | `targetUid` | const |  |
| 20080 | `id` | const |  |
| 20367 | `uid` | const |  |
| 20368 | `conv` | const |  |
| 20369 | `safe` | const |  |
| 20375 | `items` | const |  |
| 20438 | `key` | const |  |
| 20451 | `key` | const |  |
| 20466 | `key` | const |  |
| 20523 | `uid` | const |  |
| 20745 | `handleApi` | fn |  |
| 20746 | `failure` | const |  |
| 20777 | `stopCaffeinate` | fn |  |
| 20797 | `stopUserActivity` | fn | 停止防锁屏：清除续期定时器并杀掉 -u 进程（UserIsActive 断言随之释放） |
| 20805 | `startUserActivityLoop` | fn | 无需辅助功能权限（-u 走系统 IOKit 用户活动断言）。 |
| 20808 | `tick` | const |  |
| 20820 | `startCaffeinate` | fn |  |
| 20851 | `applySleepMode` | fn |  |
| 20880 | `sleepNow` | fn |  |
| 20901 | `restoreSleepMode` | fn |  |
| 20912 | `startServer` | fn |  |
| 21097 | `cleanup` | const |  |
| 21114 | `tryListen` | const |  |
| 21214 | `cleanupClientTmpOnce` | fn | 上游没有回收机制 ⇒ 这里启动跑一次 + 每 24h 一次，只删超过 7 天的条目。 |
| 21265 | `runAutomationSchedules` | fn |  |

## scripts/inject.js  （23101 行 / 941 个函数）

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
| 2002 | `wbsAutoHiddenInList` | fn |  |
| 2006 | `wbsIsBuiltinAutomation` | fn |  |
| 2015 | `wbsBuiltinAutomationText` | fn |  |
| 2067 | `wbsAutomationText` | fn |  |
| 2072 | `wbsAutomationEditedText` | fn |  |
| 2094 | `wbsErrGate` | fn |  |
| 2113 | `wbsReportErr` | fn |  |
| 2157 | `wbsClientVersion` | fn |  |
| 2287 | `isIdentityExpired` | fn | 今日签到状态展示：账号卡片底部与积分余额并列显示 |
| 2304 | `accountHealthLocked` | fn | 那个看 tokenExpiresAt / 签到 401，这个看 daemon 下发的账号健康视图）。 |
| 2309 | `esc` | fn |  |
| 2310 | `escAttr` | fn |  |
| 2313 | `summarizeCreditDays` | fn | 每个积分段只归入一个剩余天数桶；缺失有效期的余额不展示，不猜测到期日。 |
| 2315 | `add` | fn |  |
| 2341 | `creditOpacity` | fn |  |
| 2346 | `createAvatarLibrary` | fn |  |
| 2348 | `validImage` | fn |  |
| 2364 | `snapshot` | fn |  |
| 2365 | `commit` | fn |  |
| 2372 | `select` | method |  |
| 2376 | `add` | method |  |
| 2383 | `remove` | method |  |
| 2391 | `resolveAvatarChoice` | fn |  |
| 2397 | `checkinHtml` | fn |  |
| 2418 | `isGrowthActiveToday` | fn |  |
| 2424 | `activityStreakHtml` | fn |  |
| 2435 | `isKnownActivityStreak` | fn |  |
| 2439 | `el` | fn |  |
| 2446 | `maskPhone` | fn |  |
| 2452 | `fmtTime` | fn |  |
| 2462 | `initial` | fn |  |
| 2468 | `api` | fn |  |
| 2497 | `collectAll` | fn | 调试：递归收集所有元素（含 shadowRoot 与同域 iframe），用于抓取输入框内容 |
| 2511 | `allElements` | fn |  |
| 2524 | `captureComposer` | fn | 调试：抓取 WorkBuddy 输入框当前内容（文字/图片/附件/连接器/skill） |
| 2583 | `findComposer` | fn |  |
| 2593 | `findComposerRaw` | fn |  |
| 2640 | `composerHasContent` | fn | composerTextFromTree 跳过这两类装饰子树。 |
| 2648 | `getComposerContent` | fn | 干净地抓取输入框内容：只取 Slate 节点（不受页面装饰干扰） |
| 2664 | `getConversationId` | fn | 尽量拿到当前会话 id（URL / 当前布局选中会话 / 标题兜底） |
| 2679 | `build` | fn |  |
| 2685 | `mountPersistentOverlay` | fn |  |
| 2693 | `send` | method |  |
| 2714 | `removeTimer` | fn |  |
| 2718 | `setBuildTimeout` | fn |  |
| 2726 | `setBuildInterval` | fn |  |
| 2733 | `requestBuildFrame` | fn |  |
| 2742 | `listen` | fn |  |
| 2749 | `toast` | fn |  |
| 2753 | `receiveToast` | fn |  |
| 2787 | `switchFlowAccountLabel` | fn |  |
| 2794 | `switchFlowMaskEl` | fn |  |
| 2796 | `buildSwitchFlowMask` | fn |  |
| 2827 | `renderSwitchFlow` | fn |  |
| 2902 | `cancelSwitchFlow` | fn |  |
| 2928 | `scheduleSwitchFlowPoll` | fn |  |
| 2933 | `pollSwitchFlow` | fn |  |
| 2968 | `isVisibleHealthNode` | fn |  |
| 2976 | `findBlockingPrompt` | fn |  |
| 3005 | `findSessionError` | fn |  |
| 3025 | `readAssistantHealth` | fn |  |
| 3056 | `setSessionHealthResult` | fn |  |
| 3079 | `scanSessionHealth` | fn |  |
| 3156 | `summary` | method |  |
| 3157 | `active` | method |  |
| 3158 | `generation` | method |  |
| 3159 | `root` | method |  |
| 3163 | `summary` | method |  |
| 3164 | `active` | method |  |
| 3165 | `generation` | method |  |
| 3166 | `root` | method |  |
| 3171 | `isUsableThemeAuditRoot` | fn |  |
| 3180 | `findThemeAuditRoot` | fn |  |
| 3191 | `syncThemeAuditRoot` | fn |  |
| 3213 | `applyI18n` | fn |  |
| 3258 | `setLanguage` | fn |  |
| 3277 | `applyInjectedI18n` | fn |  |
| 3529 | `qpDiag` | fn | 面板关闭/重开：点击选项（发送/编辑/任意项）后关闭面板；重新进入按钮区恢复 hover 可展示 |
| 3542 | `mountExplorePopover` | fn | keeps it above the usage summary even when the composer creates its own layer. |
| 3548 | `listen` | fn |  |
| 3552 | `cancelClose` | fn |  |
| 3553 | `close` | fn |  |
| 3554 | `open` | fn |  |
| 3564 | `delayedClose` | fn |  |
| 3587 | `acMenuClose` | fn |  |
| 3601 | `readMessageNavigationEnabled` | fn |  |
| 3604 | `writeMessageNavigationEnabled` | fn |  |
| 3607 | `readSelectionQuoteEnabled` | fn |  |
| 3610 | `writeSelectionQuoteEnabled` | fn |  |
| 3613 | `readForkEnabled` | fn |  |
| 3616 | `writeForkEnabled` | fn |  |
| 3632 | `applySessionModule` | fn |  |
| 3661 | `syncSessionModule` | fn |  |
| 3667 | `setSessionSwitchWire` | fn | 开关切换：写 daemon 并回应用户界（设置失败回滚 UI 状态） |
| 3691 | `selectionQuoteElement` | fn | WorkBuddy 的 selection-quote renderer 会通过 InputContextTag 自己渲染消息图标。 |
| 3706 | `selectionQuoteBlock` | fn |  |
| 3723 | `hideSelectionQuoteButton` | fn |  |
| 3728 | `updateSelectionQuoteButton` | fn |  |
| 3751 | `scheduleSelectionQuoteButton` | fn |  |
| 3757 | `insertSelectionQuote` | fn |  |
| 3777 | `setupSelectionQuote` | fn |  |
| 3815 | `renderQpList` | fn | 增强页快捷短语列表渲染（含批量模式） |
| 3882 | `renderExploreOptions` | fn | 发送按钮面板选项 = 快捷短语列表；点击项经 CDP 发送该短语（替换式，发完默认关面板） |
| 3953 | `openQpEdit` | fn | 新增/编辑快捷短语弹窗（参考账号导出弹窗；textarea 最多 5 行 / 500 字） |
| 3976 | `closeQpEdit` | fn |  |
| 3997 | `confirmQpDelete` | fn | 删除二次确认弹窗（支持单选/批量） |
| 4011 | `closeQpDel` | fn |  |
| 4029 | `findActionRow` | fn | 定位输入框操作栏（含 voice-mic-wrap 的父容器） |
| 4059 | `findSendButton` | fn | 操作栏最右侧的「圆形可点击」元素才是发送按钮（左侧还可能有增强提示词/停止等圆形按钮） |
| 4087 | `isSendDisabled` | fn | 发送按钮是否处于「禁用」态（输入框为空时官方会禁用它） |
| 4098 | `insertStash` | fn | 新版或旧版内联工具栏存在时放进工具栏；带 voice-mic-wrap 的旧布局保持固定定位。 |
| 4127 | `isComposerAnchorVisible` | fn |  |
| 4136 | `positionExplore` | fn | 探索菜单按钮：位于暂存提示词按钮右侧（与暂存同款圆钮、发送图标，hover 悬浮菜单弹窗） |
| 4144 | `syncNativeStashLabelWidth` | fn | CodeBuddy 原生按钮宽 24px、文字放大后会溢出：把量到的宽度写进自定义属性，CSS 用它做展开宽度。 |
| 4152 | `applyThemeButtonColors` | fn |  |
| 4159 | `positionStash` | fn |  |
| 4226 | `removeStash` | fn |  |
| 4231 | `isWelcomePage` | fn | 用户要求欢迎页不展示暂存提示词按钮（欢迎页输入框只是快速提问入口，不需要暂存）。 |
| 4240 | `shouldShowStash` | fn | 欢迎页一律不显示。 |
| 4246 | `syncStash` | fn |  |
| 4281 | `watchSend` | fn |  |
| 4295 | `watchRow` | fn |  |
| 4314 | `guardSessionChange` | fn | 标签同步只对当前会话生效（syncQueueTags 内按 sessionId 过滤），旧会话的标签由面板重渲染自然清除。 |
| 4323 | `createMessageNavigation` | fn | 会话消息导航：完整索引来自 controller.messageStore，DOM 仅用于判断当前可见位置。 |
| 4357 | `messageText` | fn | （换行、缩进、列表、代码块全靠空白表达），导致详情浮层里全挤成一坨。 |
| 4378 | `ensureRoot` | fn |  |
| 4422 | `position` | fn |  |
| 4443 | `setActive` | fn |  |
| 4454 | `hideTooltip` | fn |  |
| 4465 | `showTooltip` | fn |  |
| 4503 | `render` | fn |  |
| 4521 | `updateActive` | fn |  |
| 4556 | `scheduleActive` | fn |  |
| 4573 | `refreshFromStore` | fn |  |
| 4598 | `unbindStore` | fn |  |
| 4611 | `bindAdapter` | fn |  |
| 4628 | `sync` | fn |  |
| 4678 | `setEnabled` | fn |  |
| 4693 | `turnForButton` | fn |  |
| 4698 | `navigateToTurn` | fn |  |
| 4709 | `dragIndexAt` | fn |  |
| 4720 | `onNavPointerDown` | fn |  |
| 4732 | `onNavPointerMove` | fn |  |
| 4740 | `finishNavDrag` | fn |  |
| 4762 | `onNavPointerUp` | fn |  |
| 4763 | `onNavPointerCancel` | fn |  |
| 4764 | `onPointerOver` | fn |  |
| 4769 | `onPointerOut` | fn |  |
| 4775 | `onFocusIn` | fn |  |
| 4779 | `onFocusOut` | fn |  |
| 4783 | `onClick` | fn |  |
| 4795 | `onKeyDown` | fn |  |
| 4804 | `onWindowChange` | fn |  |
| 4838 | `hideForkTooltip` | fn |  |
| 4839 | `showForkTooltip` | fn |  |
| 4857 | `syncForkButtons` | fn |  |
| 4879 | `scheduleForkButtons` | fn |  |
| 4965 | `wbsPanelShown` | fn | 因此：① 只在可见时做面板内的工作；② 只对「与注入功能相关」的 mutation 反应。 |
| 4971 | `wbsTabActive` | fn |  |
| 4977 | `wbsMutationsRelevant` | fn |  |
| 4994 | `syncGlassComposerTriggerBackgrounds` | fn | 毛玻璃主题下按实际节点写入内联透明背景，并在节点重建时重新应用。 |
| 5015 | `onDomChange` | fn |  |
| 5030 | `onInputSync` | fn |  |
| 5061 | `scheduleDomChange` | fn |  |
| 5095 | `acLimitBannerPresent` | fn |  |
| 5107 | `acLimitWatchTick` | fn |  |
| 5144 | `readFabBottom` | fn |  |
| 5151 | `clampFabBottom` | fn |  |
| 5156 | `clampFabRight` | fn |  |
| 5161 | `applyFabPosition` | fn |  |
| 5174 | `scheduleFabPos` | fn |  |
| 5182 | `positionFab` | fn |  |
| 5200 | `fixWidgetIframeBg` | fn |  |
| 5233 | `syncModernQueueSnapshot` | fn |  |
| 5339 | `dropModernOptimisticItem` | fn |  |
| 5353 | `getModernQueueSnapshot` | fn |  |
| 5368 | `findWbsAdapter` | fn |  |
| 5411 | `get` | method |  |
| 5422 | `bootstrapModernQueueBridge` | fn |  |
| 5447 | `waitForModernQueueAdapter` | fn | 第二次点击会得到两条。这里异步等待官方 adapter + 当前会话，不阻塞渲染主线程。 |
| 5451 | `probe` | fn |  |
| 5474 | `warmModernQueueAdapter` | fn | 后台预热只做只读查找，不触碰用户操作；点击路径随后直接复用缓存。 |
| 5486 | `handleModernQueueActionClick` | fn |  |
| 5517 | `stashSigs` | fn |  |
| 5523 | `stashIds` | fn |  |
| 5529 | `recordStashQueueItem` | fn |  |
| 5558 | `isStashItem` | fn | 判断一个 queue item 是否为「暂存提示词」消息（按文本签名匹配，仅当前会话） |
| 5571 | `syncQueueDomIds` | fn |  |
| 5598 | `syncQueueTags` | fn | 同步标签（仅当前会话的暂存签名）。只做幂等 DOM 插入/移除，不改 React 属性。 |
| 5629 | `watchQueueOrder` | fn |  |
| 5645 | `stashOrderValid` | fn | 顺序合规判定：按 order 排序的 pending 项中，第一个不是暂存项（即普通项在最前） |
| 5656 | `guardStashedPause` | fn |  |
| 5805 | `enforceStashOrder` | fn |  |
| 5847 | `wrapQueueReorder` | fn | 兼容旧调用点（onDomChange/onInputSync/setTimeout 仍调用旧函数名，改为内部转发） |
| 5852 | `clearModernComposerDraft` | fn | 暂存会话完全一致的 store；持久化键删除是官方 store 更新未同步落盘时的窄兜底。 |
| 5891 | `clearComposerViaOnChange` | fn | 直接清 store/onChange 有渲染进程风险——一律跳过（输入框留着内容，用户可见可清）。 |
| 5978 | `saveAutomationDraft` | fn | rich blocks in the existing stash format; only status crosses CDP. |
| 5996 | `withQueueTimeout` | fn | 队列操作超时包装：WorkBuddy 内部 Promise 可能永不 settle，超时后走本地暂存兜底，避免"卡死" |
| 6011 | `enqueueToWorkBuddyQueue` | fn |  |
| 6082 | `crumb` | fn |  |
| 6175 | `maxW` | fn |  |
| 6176 | `maxH` | fn |  |
| 6177 | `apply` | fn |  |
| 6210 | `endDrag` | fn |  |
| 6244 | `preloadAutomationDiscovery` | fn |  |
| 6250 | `findCreditSegment` | fn |  |
| 6259 | `ensureStatusPopover` | fn |  |
| 6270 | `hideStatusPopover` | fn |  |
| 6276 | `positionStatusPopover` | fn |  |
| 6301 | `showStatusPopover` | fn |  |
| 6312 | `creditPopoverHtml` | fn |  |
| 6319 | `hideCreditTooltip` | fn |  |
| 6325 | `showCreditTooltip` | fn |  |
| 6352 | `rotationReminderEnabled` | fn |  |
| 6416 | `setupFoldCard` | fn | 各账号互不影响。收起时 summary 行仍在（它就在头里），所以信息不会丢。 |
| 6422 | `sync` | fn |  |
| 6461 | `syncOpsDot` | fn |  |
| 6467 | `setOpsFlag` | fn | 供 renderFailoverCard / renderContextAuditCard 回填（函数声明会提升，可以先用后定义） |
| 6474 | `placeOpsPopover` | fn | 不用 fixed —— .wbs-panel 的 backdrop-filter 会把它降格成「相对面板」的绝对定位。 |
| 6488 | `setOpsPopover` | fn |  |
| 6530 | `idleMinutesText` | fn |  |
| 6541 | `fillIdleSummary` | fn | （命中词条后还会吞掉紧随的空格）。标签走整句词条，账号名/数字放 skip 子树。 |
| 6544 | `label` | fn |  |
| 6549 | `data` | fn |  |
| 6555 | `sep` | fn |  |
| 6556 | `gap` | fn |  |
| 6566 | `renderIdleCard` | fn |  |
| 6612 | `refreshIdleCard` | fn |  |
| 6620 | `saveIdleCard` | fn |  |
| 6680 | `failoverClock` | fn |  |
| 6685 | `failoverAccountLabel` | fn |  |
| 6694 | `failoverReasonText` | fn | 后端 reason（英文码）→ 一句整句中文词条。半句不命中词典，会被短词撕开。 |
| 6707 | `failoverDataRow` | fn | 拼在一起的账号名会被词典就地替换（「账号B」→「AccountB」，数据被当文案翻了）。 |
| 6721 | `failoverWindowRows` | fn | 前端不自己算窗口（两个时钟会对不上）—— 只挑出还没到期的那些。 |
| 6737 | `renderFailoverCard` | fn |  |
| 6785 | `refreshFailoverCard` | fn |  |
| 6847 | `caFindingRows` | fn | fix.kind 三态：auto=一键执行 / paste=复制指令粘给 AI / manual=只有建议文本。 |
| 6905 | `runContextFix` | fn | auto 类：直接调路由落地。前端**只传 fixId**，路径由后端算（避免面板成为任意路径移动的入口）。 |
| 6928 | `copyFixPrompt` | fn | paste 类：把 prompt 复制走 —— 老叶拿到直接粘给我就能执行，不用自己组织语言。 |
| 6931 | `done` | fn |  |
| 6936 | `fallback` | fn |  |
| 6959 | `renderContextAuditCard` | fn |  |
| 7005 | `loadContextAuditCard` | fn |  |
| 7069 | `openAccountOrderModal` | fn |  |
| 7096 | `close` | fn |  |
| 7101 | `drawRows` | fn |  |
| 7110 | `move` | fn |  |
| 7116 | `syncMode` | fn |  |
| 7195 | `setupCreditSummary` | fn |  |
| 7204 | `hide` | fn |  |
| 7205 | `deferHide` | fn |  |
| 7206 | `show` | fn |  |
| 7240 | `openOfficialGrowthCenter` | fn |  |
| 7246 | `confirmCurrentGrowthAccount` | fn |  |
| 7257 | `setupAccountNotePopover` | fn |  |
| 7274 | `trigger` | fn |  |
| 7275 | `dirty` | fn |  |
| 7276 | `update` | fn |  |
| 7283 | `hide` | fn |  |
| 7298 | `position` | fn |  |
| 7310 | `show` | fn |  |
| 7331 | `deferHide` | fn |  |
| 7339 | `submit` | fn |  |
| 7411 | `setupDailyProgressPopover` | fn |  |
| 7418 | `findRing` | fn |  |
| 7426 | `hide` | fn |  |
| 7436 | `deferHide` | fn |  |
| 7446 | `show` | fn |  |
| 7464 | `updateDailyTravelCountdowns` | fn |  |
| 7573 | `setupModelRateLimitPopover` | fn |  |
| 7580 | `findBadge` | fn |  |
| 7588 | `hide` | fn |  |
| 7598 | `deferHide` | fn |  |
| 7608 | `show` | fn |  |
| 7620 | `showSummary` | fn |  |
| 7691 | `closeSecureTransferModal` | fn |  |
| 7695 | `openSecureTransferModal` | fn |  |
| 7734 | `selectedIds` | fn |  |
| 7735 | `syncSelection` | fn |  |
| 7855 | `downloadTransfer` | fn |  |
| 7872 | `readTransferFile` | fn |  |
| 7881 | `copyPlainText` | fn |  |
| 7901 | `onExportAccounts` | fn | 导出账号：密码必填，daemon 使用随机 salt 加密后触发浏览器下载。 |
| 7917 | `onConfirm` | method |  |
| 7930 | `onImportFile` | fn | 导入账号：读文件后输入密码；空密码仅对历史 workdaddy 格式有效。 |
| 7954 | `openAccountImportChoice` | fn |  |
| 7974 | `sync` | fn |  |
| 7996 | `formatTokenCount` | fn |  |
| 8005 | `usageTrendChartHtml` | fn |  |
| 8013 | `usageTrendColors` | fn |  |
| 8020 | `resolveUsageColor` | fn |  |
| 8033 | `usagePieData` | fn |  |
| 8048 | `usagePieHtml` | fn |  |
| 8053 | `percent` | fn |  |
| 8054 | `description` | fn |  |
| 8055 | `legendRow` | fn |  |
| 8082 | `wireUsagePies` | fn |  |
| 8086 | `clear` | fn |  |
| 8091 | `preview` | fn |  |
| 8120 | `usageTrendGroups` | fn |  |
| 8142 | `renderUsageBreakdown` | fn |  |
| 8192 | `renderUsageTrendChart` | fn |  |
| 8264 | `hideTooltip` | fn |  |
| 8265 | `showTooltip` | fn |  |
| 8306 | `usageTimeSegmentHtml` | fn |  |
| 8314 | `onTokenStats` | fn |  |
| 8336 | `closeStats` | fn |  |
| 8365 | `usageDays` | fn |  |
| 8382 | `renderCredits` | fn |  |
| 8416 | `setCreditBusy` | fn |  |
| 8423 | `creditQueryFailed` | fn |  |
| 8430 | `showCreditJob` | fn |  |
| 8450 | `pollCreditJob` | fn |  |
| 8463 | `loadCredits` | fn |  |
| 8513 | `load` | fn | 就失去了入口 ⇒ 死代码里的副本永远看不到，只会与真实现漂移，故摘掉。 |
| 8580 | `perfTableHtml` | fn |  |
| 8617 | `onThinkingPerf` | fn |  |
| 8639 | `closePerf` | fn |  |
| 8653 | `load` | fn | 首屏慢（要扫 traces，首次 3–8 秒）⇒ 先渲染骨架再异步填表，绝不阻塞面板。 |
| 8687 | `wbsIsDarkTheme` | fn | 三维筛选（日期 × 账号 × 模型）与全部图表都在 HTML 内完成（数据内嵌 ⇒ 切筛选零延迟、断网可用）。 |
| 8699 | `onUsageBoard` | fn |  |
| 8732 | `boardUrl` | fn |  |
| 8736 | `closeBoard` | fn |  |
| 8750 | `showOverlay` | fn |  |
| 8751 | `hideOverlay` | fn |  |
| 8752 | `syncSrcBtn` | fn |  |
| 8753 | `loadBoard` | fn |  |
| 8766 | `fmtBoardTime` | fn |  |
| 8769 | `p2` | fn |  |
| 8772 | `generateBoard` | fn |  |
| 8811 | `rememberTab` | fn |  |
| 8814 | `readPanelTab` | fn |  |
| 8826 | `restorePanelTab` | fn |  |
| 8843 | `switchTab` | fn |  |
| 8882 | `buildAutomationPane` | fn |  |
| 8886 | `defaultTask` | fn |  |
| 8889 | `triggerBadgesHtml` | fn |  |
| 8909 | `autoSyncSuffix` | fn | 纯数字 + 斜杠语言无关、不需要入典；但必须**拼在整句 label 之后**，否则短词条会把句子撕开。 |
| 8917 | `autoProtocolLabel` | fn |  |
| 8921 | `taskStatusLabel` | fn |  |
| 8933 | `lastRunLabel` | fn |  |
| 8939 | `runFor` | fn |  |
| 8940 | `selectedIds` | fn |  |
| 8943 | `selectableTasks` | fn | 用户点「删除选中」会删掉一条他从没见过的任务。 |
| 8944 | `allSelected` | fn |  |
| 8945 | `syncBatchControls` | fn |  |
| 8953 | `render` | fn |  |
| 9000 | `load` | fn |  |
| 9003 | `renderExamples` | fn |  |
| 9017 | `loadAgentInfo` | fn |  |
| 9023 | `fuzzyTaskName` | fn |  |
| 9034 | `discoverySourceLabel` | fn |  |
| 9037 | `renderAutomationDiscovery` | fn |  |
| 9082 | `showAutomationDiscoveryGuide` | fn |  |
| 9092 | `showAutomationDiscovery` | fn |  |
| 9130 | `loadAutomationDiscovery` | fn |  |
| 9144 | `exampleById` | fn |  |
| 9147 | `generateAgentTask` | fn |  |
| 9165 | `finishSafetyReview` | fn |  |
| 9174 | `pollSafetyReview` | fn |  |
| 9189 | `startSafetyReview` | fn |  |
| 9200 | `closePanelModal` | fn |  |
| 9206 | `showAutomationConfirm` | fn |  |
| 9214 | `close` | fn |  |
| 9223 | `showAutomationLogs` | fn |  |
| 9250 | `close` | fn |  |
| 9266 | `showEditor` | fn |  |
| 9292 | `syncScheduleFields` | fn |  |
| 9308 | `hideEditor` | fn |  |
| 9309 | `saveEditor` | fn |  |
| 9353 | `isScheduledSendTaskUI` | fn |  |
| 9356 | `schedPad2` | fn |  |
| 9357 | `schedLocalSlot` | fn |  |
| 9360 | `schedDefaultOnceAt` | fn |  |
| 9366 | `schedWhenLabel` | fn |  |
| 9377 | `schedConversationLabel` | fn |  |
| 9388 | `schedRequestFromTask` | fn | 任务被复制或改名后，meta.request 里的旧值不能回写到原任务。 |
| 9398 | `hideScheduledSend` | fn |  |
| 9400 | `showScheduledSend` | fn |  |
| 9458 | `whenValue` | fn |  |
| 9466 | `currentRequest` | fn |  |
| 9481 | `syncSummary` | fn |  |
| 9487 | `syncWhen` | fn |  |
| 9494 | `setTarget` | fn |  |
| 9507 | `fitConversationList` | fn | 行数按选项数取 2~6，选项少时不留一堆空行。 |
| 9522 | `renderConversations` | fn |  |
| 9536 | `loadConversations` | fn |  |
| 9557 | `saveScheduledSend` | fn |  |
| 9633 | `mountAutomationModal` | fn |  |
| 9655 | `showCapabilities` | fn |  |
| 9665 | `showExamples` | fn |  |
| 9674 | `syncDraft` | fn |  |
| 9686 | `exportAutomationTasks` | fn |  |
| 9695 | `importIssueLabel` | fn |  |
| 9705 | `showTaskImport` | fn |  |
| 9721 | `selected` | fn |  |
| 9722 | `syncSelection` | fn |  |
| 9739 | `readAutomationImport` | fn |  |
| 9754 | `startPicker` | fn |  |
| 9766 | `wbsOfficialEsc` | fn |  |
| 9772 | `wbsOfficialCardHTML` | fn |  |
| 9798 | `wbsOfficialEmpty` | fn |  |
| 9802 | `wbsLoadOfficial` | fn |  |
| 9932 | `isTaskSessionRecordUI` | fn |  |
| 9937 | `canonicalWorkspaceUI` | fn |  |
| 9954 | `sessionCopyAccountLabel` | fn |  |
| 9960 | `renderSessionCopyProgress` | fn |  |
| 9991 | `scheduleSessionCopyProgressPoll` | fn |  |
| 9995 | `pollActiveSessionCopyJob` | fn |  |
| 10014 | `fmtCostInt` | fn |  |
| 10016 | `renderSessionCostCard` | fn |  |
| 10066 | `copyCurrentConversation` | fn | 取会话控制器复用本地既有 acFindConversationController（与成本卡同一个「当前会话」口径）。 |
| 10092 | `refreshSessionCost` | fn |  |
| 10122 | `startSessionCostPolling` | fn |  |
| 10131 | `stopSessionCostPolling` | fn |  |
| 10138 | `buildSessionsPane` | fn |  |
| 10249 | `renderSessionExport` | fn |  |
| 10268 | `pollSessionExport` | fn |  |
| 10290 | `cloudEls` | fn |  |
| 10302 | `cloudAccountName` | fn |  |
| 10310 | `renderCloudCard` | fn |  |
| 10361 | `checkCloudGhosts` | fn |  |
| 10383 | `runCloudPurge` | fn |  |
| 10412 | `wireCloudCard` | fn |  |
| 10436 | `loadSessionAccounts` | fn | 加载账号下拉（当前账号 + 全部备份账号 + 全部账号） |
| 10467 | `sessSizeFiltered` | fn | 账号总量是**全量口径**，跟筛选无关，所以它只认 sessionsState.totalBytes。 |
| 10475 | `sessMetaText` | fn | A10：每行「时间 · 体积」。体积读不出来的行**不显示**（不写成 0 B 冒充）。 |
| 10483 | `canRefreshSessions` | fn | 有勾选、在批量模式、有弹窗打开、或页面不可见时，一律不做静默刷新。 |
| 10492 | `refreshSessionsSilently` | fn |  |
| 10496 | `loadSessions` | fn |  |
| 10549 | `renderSessions` | fn | 按空间分组渲染：每个空间最多显示 INIT 条 + 展开按钮（每次 +STEP）。 |
| 10559 | `canEditAutoCopy` | fn |  |
| 10563 | `sessSyncButton` | fn | 闭包外的变量在切片里不可见，用外部常量会挂。 |
| 10567 | `autoCopyButton` | fn |  |
| 10649 | `activeAutoCopyCount` | fn |  |
| 10655 | `updateSessionSummary` | fn |  |
| 10665 | `updateAutoCopyAllButton` | fn |  |
| 10673 | `toggleAutoCopyAll` | fn |  |
| 10696 | `shortWs` | fn |  |
| 10701 | `bindSessEvents` | fn | 会话列表内事件委托 |
| 10757 | `toggleAutoCopyRule` | fn |  |
| 10788 | `updateAutoCopyButtons` | fn |  |
| 10816 | `updateSessCount` | fn |  |
| 10835 | `syncCheckAllBtn` | fn | 全选按钮：根据当前是否全选切换图标（勾选框 空/勾选 两种状态）与文案 |
| 10844 | `fmtHumanTime` | fn | 人性化时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / x 天前 / 日期 |
| 10864 | `setSessBatchBar` | fn | 关闭时恢复。批量按钮行与筛选行共用 toolbar，不再另起一行。 |
| 10879 | `wireSessionsPane` | fn |  |
| 11114 | `openCopyModal` | fn | 复制弹窗：选目标账号（复制，非迁移——原会话保留） |
| 11168 | `openAutoCopyConflictModal` | fn | 硬合会产出重复/错序的 tool_call 配对 —— 宁可让用户选一份，也不自动产出坏会话。 |
| 11267 | `openSyncNowModal` | fn | 不切号、不刷新页面；复用后端同一个任务队列，因此进度条 / 暂停 / 继续 三个能力天然连通。 |
| 11309 | `syncForceUi` | fn | 前端先拦一次，与服务端 resolveSyncNowSources 的拦截同源 —— 别等 400 回来才说。 |
| 11356 | `pauseAutoCopy` | fn | 所以这里先提示，下一轮轮询就会拿到 paused 状态。 |
| 11374 | `resumeAutoCopy` | fn | 复制本身幂等（已完成的行按 mapping 判 skipped），重跑等于只搬剩下的。 |
| 11398 | `openDeleteModal` | fn | 否则界面说的和后端删的可能不是一回事。 |
| 11497 | `selectedSessIds` | fn |  |
| 11500 | `showSessModal` | fn |  |
| 11511 | `buildModelsPane` | fn |  |
| 11541 | `maskModelKey` | fn | 前端脱敏：与后端 maskApiKey 一致。cell 列表展示短脱敏串，title 同样脱敏；编辑弹窗用明文原值 |
| 11548 | `modelDetailsHtml` | fn |  |
| 11557 | `modelRowHtml` | fn |  |
| 11587 | `loadModels` | fn |  |
| 11605 | `updateModelCounts` | fn |  |
| 11615 | `renderModels` | fn |  |
| 11661 | `updateModelBatchState` | fn |  |
| 11676 | `showModelConfirm` | fn |  |
| 11690 | `closeThirdPartyMenu` | fn |  |
| 11696 | `openThirdPartyModels` | fn |  |
| 11821 | `wireModelsPane` | fn |  |
| 11972 | `findModelBackup` | fn |  |
| 11979 | `openModelEdit` | fn |  |
| 12013 | `buildThemePane` | fn | ===== 主题 pane（构建：头像 + 悬浮机器人 + 主题选择 + WorkDaddy 壁纸）===== |
| 12100 | `buildEnhancePane` | fn | 增强 pane（构建：决策弹窗 + 开发者工具[默认隐藏，连点标题5次呼出]） |
| 12253 | `loadDshOps` | fn | dsh-ops 集成：状态 / 一键安装 / 启停 / 卸载（写 mcp.json 与磁盘，重启 WorkBuddy 生效）。 |
| 12365 | `buildPcPane` | fn | 电脑 pane：休眠设置（从增强页迁出，单独 Tab) |
| 12384 | `wirePcPane` | fn |  |
| 12417 | `buildAboutPane` | fn | 关于 pane：项目信息卡 + 简洁的错误诊断开关 + 版本 |
| 12522 | `syncLangSeg` | fn |  |
| 12549 | `wireTelemetrySettings` | fn |  |
| 12553 | `renderTelemetryState` | fn |  |
| 12591 | `checkForUpdate` | fn | 双版本语义：本修改版仓库有新版本 → 下载安装；上游仓库有新版本 → 只提示（官方包会覆盖本修改版） |
| 12707 | `updateLogTimestamp` | fn |  |
| 12712 | `appendUpdateLog` | fn |  |
| 12725 | `formatDownloadRate` | fn |  |
| 12731 | `formatDownloadEta` | fn |  |
| 12739 | `formatDownloadTransfer` | fn |  |
| 12752 | `formatUpdateFailure` | fn |  |
| 12766 | `startUpdate` | fn | 可见 Setup.exe；macOS 继续沿用原有自动安装与重启流程。 |
| 12785 | `openWindowsInstaller` | fn |  |
| 12807 | `showWindowsInstallerReady` | fn |  |
| 12821 | `openWindowsInstallerAfterDownload` | fn |  |
| 12855 | `pollUpdateProgress` | fn |  |
| 12864 | `renderRebootUi` | fn |  |
| 12970 | `syncWallpaperCardVisibility` | fn |  |
| 12983 | `syncThemeTakeoverVisibility` | fn | 关闭接管后只隐藏主题外观选项；头像和悬浮机器人独立于主题接管。 |
| 12993 | `wireThemePane` | fn | 主题 pane 事件绑定（元素在 buildThemePane 之后才存在，延迟到首次切换时绑定） |
| 13225 | `gwCtxLabel` | fn |  |
| 13236 | `gwSetModelContext` | fn | 写一个模型的 maxInputTokens；value=0 表示删掉该字段（回落到客户端默认）。 |
| 13258 | `gwCtxInlineEdit` | fn | 提交成功才调用 onCommit；取消 / 非法则原样复位下拉，不写盘。 |
| 13283 | `close` | fn |  |
| 13287 | `commit` | fn |  |
| 13315 | `gwSetAllContexts` | fn | 批量：把同一档位应用到全部已注册条目。 |
| 13339 | `gwCardEl` | fn |  |
| 13340 | `gwDockEl` | fn |  |
| 13341 | `gwEl` | fn |  |
| 13343 | `gwSetDock` | fn | 折叠行 ↔ 大浮层：开 = 每次回到干净初始态（日志与模型面板收起）后刷新；关 = 复位到折叠行。 |
| 13359 | `gwBindDockKey` | fn |  |
| 13373 | `gwBtnEl` | fn |  |
| 13381 | `gwFmtCredits` | fn |  |
| 13386 | `gwFmtRel` | fn |  |
| 13396 | `gwAction` | fn |  |
| 13413 | `gwArm` | fn | 破坏性操作二次确认（armed 双点，替代风格突兀的 window.confirm）。 |
| 13427 | `gwRenderPool` | fn |  |
| 13478 | `gwRender` | fn |  |
| 13587 | `gwFetchPool` | fn |  |
| 13607 | `gwRenderTunnel` | fn |  |
| 13646 | `gwRefresh` | fn |  |
| 13656 | `gwCopyUsage` | fn |  |
| 13668 | `gwToggleLog` | fn |  |
| 13691 | `gwCreditsNum` | fn | 倍率 "x0.05" → 0.05（取不到时给个大值，排序时沉底）。 |
| 13697 | `gwModelBadges` | fn | 一个模型的徽标（思考档位 / 只能思考 / 视觉 / 上下文 / 倍率）。 |
| 13708 | `gwOpenModels` | fn | 打开「注册模型」选择面板：拉可取清单 → 渲染（默认只勾本插件已注册的）。 |
| 13733 | `gwCloseModels` | fn |  |
| 13741 | `gwRenderModels` | fn |  |
| 13844 | `gwOnCtxChange` | fn | 上下文下拉的 change 委托：读值 → 自定义走行内输入 → 写盘。 |
| 13859 | `gwUpdateModelsDiff` | fn | 差异预览：应用后会发生什么。基准 = 面板打开时的勾选快照（所以「只是打开」不算改动）。 |
| 13886 | `gwSyncModelsChecks` | fn | 勾选状态回填到 DOM（工具按钮改完 sel 后调用）。 |
| 13894 | `gwModelsTool` | fn |  |
| 13912 | `gwApplyModels` | fn |  |
| 13931 | `buildGatewayCard` | fn |  |
| 14098 | `wireUpdatePolicy` | fn | 弹原生确认会静默返回 false，等于按钮永远点不动）。 |
| 14106 | `paint` | fn |  |
| 14115 | `sync` | fn |  |
| 14171 | `wireModelSwitchGuard` | fn |  |
| 14176 | `paint` | fn |  |
| 14180 | `sync` | fn |  |
| 14203 | `wireEnhancePane` | fn |  |
| 14238 | `lockPanelHeight` | fn | 面板高度固定为主题页高度：防止切 tab 时高度忽高忽低（首次主题页壁纸渲染后锁定一次） |
| 14246 | `loadWallpapers` | fn |  |
| 14354 | `setOpen` | fn |  |
| 14438 | `setupFabDrag` | fn |  |
| 14472 | `finishFabDrag` | fn |  |
| 14502 | `isDragging` | method |  |
| 14535 | `closeLoginModal` | fn |  |
| 14544 | `openLoginChoice` | fn |  |
| 14648 | `startSeamlessLogin` | fn |  |
| 14743 | `loadThemes` | fn |  |
| 14750 | `applyTheme` | fn |  |
| 14758 | `themeSelectValue` | fn | 当前主题 id（壁纸切换目标）：segmented 激活项；无则 nebula |
| 14776 | `openWebsite` | method |  |
| 14781 | `unlockDebug` | method |  |
| 14804 | `getItem` | method |  |
| 14805 | `setItem` | method |  |
| 14806 | `removeItem` | method |  |
| 14818 | `rememberAvatarWrapper` | fn |  |
| 14824 | `rememberAvatarImage` | fn |  |
| 14830 | `restoreAvatarDom` | fn |  |
| 14844 | `svgToPng` | fn | SVG → PNG dataURL |
| 14865 | `applyAvatar` | fn |  |
| 14934 | `replaceThemeBg` | fn | 替换当前主题背景图（保持主题配色不变，不再生成新主题——避免 reload 后被"切回最早背景图"） |
| 14975 | `hexOf` | fn |  |
| 14978 | `mixArr` | fn |  |
| 14979 | `extractPalette` | fn |  |
| 15013 | `imageToTheme` | fn |  |
| 15102 | `syncAskSwitch` | fn |  |
| 15154 | `ndEl` | fn |  |
| 15157 | `ndRefreshCount` | fn |  |
| 15167 | `ndSwitchEl` | fn |  |
| 15172 | `wireNoDisturbPane` | fn | 免打扰开关绑定（wireEnhancePane 调用） |
| 15212 | `bulkNoDisturb` | fn | 批量开/关：串行逐个应用（开需要已弹过确认；关直接执行） |
| 15246 | `setNoDisturb` | fn | 统一开关设置入口：POST daemon → 回写 UI 状态 → 联动 autoApprove observer |
| 15262 | `ndTitle` | fn |  |
| 15269 | `showNoDisturbConfirm` | fn | 挂载到面板容器（.wbs-panel）内并 absolute 覆盖，弹窗居中于面板而不是整个 WorkBuddy 窗口 |
| 15288 | `cleanup` | fn |  |
| 15292 | `onClick` | fn |  |
| 15305 | `syncNoDisturb` | fn | 从 daemon 拉开关状态并同步 UI（含自动点允许 observer 启停） |
| 15312 | `applyNoDisturbState` | fn |  |
| 15404 | `acLogLine` | fn |  |
| 15409 | `acLog` | fn |  |
| 15419 | `acLogR` | fn | 限频日志：同一 key 在窗口内最多打一条（流式 mutation 每帧都打会刷屏） |
| 15428 | `acSessionTitle` | fn |  |
| 15436 | `acMonitorLog` | fn |  |
| 15443 | `acScheduleMonitorLogRender` | fn |  |
| 15453 | `acResetState` | fn |  |
| 15485 | `acShowStatus` | fn |  |
| 15491 | `acHideStatus` | fn |  |
| 15496 | `acStartStatusAnim` | fn |  |
| 15497 | `acStopStatusAnim` | fn |  |
| 15500 | `acWeak` | fn | 弱提示：复用卡片标题右侧的 wbs-ac-status 小字，4s 后自动清除；若状态常驻显示则暂停，提示结束恢复 |
| 15513 | `acNotifyLimit` | fn |  |
| 15534 | `acPickBodyBlock` | fn | 取正文块：内容容器直接子块中排除 widget/推理/元信息折叠，优先最后一段文本内容块（_assistantTextContent/markdown） |
| 15551 | `acHasMarker` | fn | 匹配消息末尾的 [wbs-reply-done]: … 行（渲染不可见）。 |
| 15561 | `acHasCompletionActions` | fn |  |
| 15580 | `acSwitchConversationId` | fn | 读不到就返回空串 —— 不能为了「带上一个 id」把切换本身拖挂。 |
| 15588 | `acHasErrorSignal` | fn |  |
| 15602 | `acLooksTruncated` | fn |  |
| 15610 | `acReplyDecision` | fn |  |
| 15622 | `acIsBusyEl` | fn | 只认「可见 + 未隐藏 + 未禁用」的元素，避免把隐藏残留的停止按钮误判为忙碌 |
| 15638 | `acIsBusy` | fn |  |
| 15643 | `acFindComposer` | fn | 定位输入框：优先 textarea，其次 contenteditable；必须可见 |
| 15651 | `acComposerText` | fn |  |
| 15664 | `acFindSendButton` | fn | 定位发送按钮：最后一个可见、带 send/发送 语义的按钮 |
| 15680 | `acSetValue` | fn | 写入输入框（React 合成事件需 native setter；contenteditable/Slate 用插入文本） |
| 15701 | `acPressEnter` | fn |  |
| 15710 | `acAssistantMsgId` | fn | 用于 baseline 解锁/切换识别——只认官方 ID，绝不回退文本签名（文本变化不得视为新回复） |
| 15720 | `acMsgSignature` | fn | 消息稳定签名：正文规范化文本截断——DOM 虚拟列表重建后签名不变，可稳定判重（judgedMessages 用签名而非节点引用） |
| 15737 | `acUserMsgSnapshot` | fn | 用户消息快照（发送前后对比，作为真实发送证据） |
| 15759 | `acControllerComposerEmpty` | fn |  |
| 15767 | `acSendViaController` | fn | 不依赖输入框 DOM 与 CDP。只有控制器缺失/调用失败时才回退旧发送链。 |
| 15814 | `acSendContinue` | fn | 发送主流程：检测到异常中断先 toast 预告，记录发送前用户消息快照，然后发送固定文案 |
| 15851 | `acDoSend` | fn | CDP 失败才兜底：按钮可用（存在且未禁用）则先写入固定文案再点按钮；最后手段为本地模拟填写+合成 Enter。 |
| 15889 | `acVerifySent` | fn | 仅凭「输入框清空」不算成功（空输入框点发送=没发也清空）；证据缺失则重试，超时按失败汇报。 |
| 15937 | `acUserCancelled` | fn | 该消息是否为「用户主动取消」：内容容器带 cb-user-cancelled-indicator → 不发送继续，仅记日志 |
| 15943 | `acFindConversationController` | fn | WorkBuddy 与 WorkBuddy AI 若采用同一 controller 均走此路径。 |
| 15992 | `acCaptureControllerError` | fn |  |
| 16006 | `acRecordModelRateLimit` | fn |  |
| 16033 | `acControllerSnapshot` | fn |  |
| 16091 | `acControllerCheck` | fn |  |
| 16165 | `acBindController` | fn |  |
| 16198 | `acSettleCheck` | fn | 兜底：feedback 一直未出现（选择器失效）时，消息静默超 AC_IDLE_FALLBACK_MS 也判定一次 |
| 16293 | `acScheduleSettle` | fn |  |
| 16306 | `acActiveConversationId` | fn | 全部取不到返回 ''；绝不回退到任意会话、标题或文本（共享的 getConversationId 有任意会话兜底，本模块不用） |
| 16340 | `acSessionSig` | fn | 取不到返回 '' → 调用方保守跳过判定（绝不回退任意会话/标题/文本） |
| 16348 | `acSnapshot` | fn | 观察快照：最后一条助手消息「行」与内容容器 + 消息总数 |
| 16361 | `acOnMutation` | fn | 计数增加或消息 key 变化 → 解除等待进入新回复流；feedback/文本变化仅在非等待期判定 |
| 16460 | `acStartLegacyMonitor` | fn | 启动监控：优先绑定 ConversationController stores；旧客户端找不到 controller 时才挂 DOM observer。 |
| 16516 | `acStopLegacyMonitor` | fn |  |
| 16537 | `acMultiUpdateStatus` | fn |  |
| 16551 | `acMultiCreateSession` | fn |  |
| 16583 | `acMultiStatusFromResource` | fn |  |
| 16588 | `acMultiHandleSessionResourceUpdate` | fn |  |
| 16616 | `acMultiReconcileSidebar` | fn |  |
| 16649 | `sessionDirtyResourceRecords` | fn |  |
| 16660 | `bindSessionDirtyMonitor` | fn |  |
| 16692 | `acMultiBindSessionResource` | fn |  |
| 16705 | `acMultiUnbindSessionResource` | fn |  |
| 16714 | `acMultiSchedule` | fn |  |
| 16723 | `acMultiSend` | fn |  |
| 16766 | `acMultiCheckSession` | fn |  |
| 16865 | `acMultiBindController` | fn |  |
| 16916 | `acMultiFinishSession` | fn |  |
| 16925 | `acMultiDetachController` | fn |  |
| 16934 | `acMultiProbeSidebarApproval` | fn |  |
| 16991 | `acPendingItemSessionId` | fn | 解析侧栏待确认 .conversation-item → 官方会话 id（title 匹配 acMulti.sessions，key 需稳定 id） |
| 17014 | `acCdpClick` | fn |  |
| 17022 | `acAutoApproveClickItem` | fn |  |
| 17041 | `acAutoApproveItemByTitle` | fn |  |
| 17053 | `acAutoApprovePendingOnce` | fn |  |
| 17191 | `acAutoApproveReleaseStale` | fn | 不依赖易滞留的 session.status（sidebar 途径可能残留 awaiting-approval）。只有仍待确认的会话才保留 episodes。 |
| 17236 | `acAutoApproveFastStart` | fn |  |
| 17246 | `acAutoApproveFastStop` | fn |  |
| 17250 | `acMultiDiscover` | fn |  |
| 17286 | `acStartMultiMonitor` | fn |  |
| 17305 | `acStopMultiMonitor` | fn |  |
| 17323 | `acStartMonitor` | fn |  |
| 17328 | `acStopMonitor` | fn |  |
| 17334 | `acRenderLog` | fn | 把已累积日志渲染进开发者工具卡片（buildEnhancePane 重建后恢复显示） |
| 17345 | `acMonitorStatusLabel` | fn |  |
| 17354 | `acMonitorSafeDetail` | fn |  |
| 17366 | `acRenderMonitorLogModal` | fn |  |
| 17418 | `wireAutoContinuePane` | fn |  |
| 17448 | `wireSessionControls` | fn | 会话模块控件绑定：暂存提示词/消息索引/快捷短语开关 + 快捷短语列表。面板每次打开重建时重绑。 |
| 17589 | `syncAutoContinue` | fn |  |
| 17594 | `applyAutoContinueState` | fn |  |
| 17607 | `syncAutoContinueMonitor` | fn | 按 daemon 状态启动/停止监控（注入后、增强页构建时、开关切换时都会调用） |
| 17617 | `ensureAutoContinueMonitor` | fn | 注入后无条件检查一次开关状态（不依赖打开增强页），根除"开关开着但监控没跑" |
| 17623 | `acCheckPromptOnOpen` | fn | 每次打开面板时校验：开关开着但本地自定义指令块已丢失（外部重写/误删）→ 请求 daemon 补写（不弹 toast） |
| 17657 | `startNoDisturbAutoApprove` | fn | —— 弹窗自动点允许（兜底，默认关）—— |
| 17675 | `stopNoDisturbAutoApprove` | fn |  |
| 17680 | `scheduleNdScan` | fn |  |
| 17684 | `ndQueueScanRoot` | fn |  |
| 17704 | `ndVisible` | fn | background cards are intentionally allowed through the structured gate. |
| 17726 | `ndNormalizeLabel` | fn |  |
| 17730 | `ndIsDecisionGroup` | fn | 容器是否构成「允许+拒绝」决策组：含 ≥2 个按钮，且其中一个是精确 once 允许选项 |
| 17738 | `ndClassifyApprovalCandidate` | fn |  |
| 17749 | `ndSessionIdForNode` | fn |  |
| 17755 | `ndApprovalContext` | fn |  |
| 17791 | `scanNoDisturbApproval` | fn |  |
| 17821 | `toNdAudit` | fn |  |
| 17829 | `getSleepMode` | fn |  |
| 17834 | `postSleepMode` | fn | POST 休眠设置（模式 + 显示器开关） |
| 17852 | `isSessionBusy` | fn | 因此这里只保留兼容旧版 DOM 的最后降级分支。 |
| 17884 | `discoverSleepSessionBusy` | fn |  |
| 17915 | `isAnySessionBusy` | fn |  |
| 17929 | `startUntilDoneCheck` | fn |  |
| 17949 | `stopUntilDoneCheck` | fn |  |
| 17955 | `syncSleepState` | fn | 同步防休眠状态：三模式 radio + 显示器开关 + 状态文字 + 悬浮按钮角标（daemon 重启/状态变化后保持一致） |
| 17995 | `fmtDateTime` | fn | 渲染账号列表 |
| 18002 | `fmtDateTimeSeconds` | fn |  |
| 18009 | `fmtCredits` | fn |  |
| 18016 | `fmtCreditExpiry` | fn |  |
| 18029 | `creditTip` | fn |  |
| 18041 | `creditBarHtml` | fn |  |
| 18058 | `todayUsageHtml` | fn |  |
| 18066 | `accountStatusTagsHtml` | fn |  |
| 18071 | `checkinBadgeHtml` | fn |  |
| 18080 | `healthBadgeHtml` | fn | 而 title 不参与 i18n 文本节点走查，不用为它造一个带占位符的词条。 |
| 18096 | `modelRateLimitTip` | fn |  |
| 18105 | `modelRateLimitBadgeHtml` | fn |  |
| 18117 | `modelRateLimitPopoverHtml` | fn |  |
| 18134 | `modelRateLimitSummaryPopoverHtml` | fn |  |
| 18156 | `creditBlockHtml` | fn |  |
| 18177 | `nearestCreditExpiry` | fn |  |
| 18189 | `sortAccountsByCreditExpiry` | fn |  |
| 18209 | `reorderAccountCards` | fn |  |
| 18222 | `mergeAccountSnapshot` | fn |  |
| 18248 | `dailyProgressLabel` | fn |  |
| 18274 | `dailyRingsSvg` | fn |  |
| 18281 | `dailyRingsHtml` | fn |  |
| 18290 | `formatDailyTravelCountdown` | fn |  |
| 18301 | `dailyTravelCountdownText` | fn |  |
| 18307 | `dailyCatDetail` | fn |  |
| 18326 | `formatGrowthTaskDeadline` | fn |  |
| 18334 | `sortGrowthTasks` | fn |  |
| 18352 | `growthTaskActions` | fn |  |
| 18357 | `ensureGrowthTaskActions` | fn | 动作表只取一次（静态、零网络代价；失败时静默降级为「全部走官网」而不是报错打断面板）。 |
| 18369 | `growthAutoOf` | fn |  |
| 18373 | `growthAutoActionFor` | fn |  |
| 18382 | `startGrowthAuto` | fn |  |
| 18410 | `pollGrowthAuto` | fn |  |
| 18450 | `stopGrowthAutoPoll` | fn |  |
| 18458 | `ensureGrowthAutoStatus` | fn | daemon 侧保留作业态，所以问一次就能接上）。 |
| 18472 | `growthTaskRewardHtml` | fn |  |
| 18484 | `dailyProgressPopoverHtml` | fn |  |
| 18628 | `updateDailyProgressCells` | fn |  |
| 18651 | `refreshDailyProgressAccount` | fn |  |
| 18679 | `fetchDailyProgressForAccounts` | fn |  |
| 18706 | `accountCardLayoutKey` | fn |  |
| 18726 | `fmtBytes` | fn |  |
| 18736 | `fmtDuration` | fn |  |
| 18745 | `autoCopyTotalFailed` | fn |  |
| 18756 | `autoCopyConflictCounts` | fn | 是两回事，标题必须分开，否则用户看不出「要不要自己动手」这个关键差别。 |
| 18762 | `autoCopyConflictTitle` | fn |  |
| 18768 | `autoCopyConflictDetail` | fn |  |
| 18778 | `autoCopyMetricText` | fn | 片段各自是独立词条（值带尾随空格），拼进整句时不会被短词条撕成中英混合。 |
| 18800 | `shouldShowAutoCopy` | fn | 30 分钟后回收），面板就应当显示它并提供「继续同步」。 |
| 18806 | `autoCopyProgressEls` | fn |  |
| 18819 | `hideAutoCopyProgress` | fn |  |
| 18826 | `renderAutoCopyProgress` | fn | 保证 15/22 这样的比例在任何时刻含义都一致。 |
| 18931 | `scheduleAutoCopyHide` | fn |  |
| 18953 | `spaceNum` | fn |  |
| 18958 | `spaceShare` | fn |  |
| 18964 | `spaceTimeText` | fn |  |
| 18968 | `pad` | fn |  |
| 18972 | `spaceBaseName` | fn |  |
| 18977 | `spaceScanEls` | fn |  |
| 18994 | `setSpaceScanBox` | fn | state: '' 跑动中 / 'ok' / 'err' / 'paused'，与 .wbs-sess-progress 的修饰类一致。 |
| 19016 | `hideSpaceScanBox` | fn |  |
| 19022 | `stopSpacePolling` | fn |  |
| 19027 | `spaceJobSub` | fn |  |
| 19034 | `renderSpaceJob` | fn |  |
| 19051 | `spaceRowHtml` | fn |  |
| 19062 | `spaceRestRow` | fn |  |
| 19070 | `renderSpaceEmpty` | fn |  |
| 19087 | `spaceConvLabel` | fn | 标题只在会话库里，扫描器已透传到 space.conversations，这里把它提为主标签、路径降为副标签。 |
| 19095 | `spaceSubText` | fn |  |
| 19114 | `spaceSortOf` | fn |  |
| 19122 | `spaceSortClick` | fn | 第一下 = 从大到小 / 从多到少（用户要的默认），再点同一列才反过来；换一列 = 新列重新从大到小。 |
| 19130 | `spaceSortName` | fn |  |
| 19137 | `spaceSortList` | fn | 原地排序会让「默认顺序」在第二次渲染时已经无从恢复。 |
| 19158 | `spaceSortHeadHtml` | fn | 文案保持中文原文，交给 i18n 扫描器整句替换（两条 tooltip 必须整句入词典，否则会被撕成中英混合）。 |
| 19176 | `spaceSortRender` | fn | 用最近一次结果重渲染。数据没变、只是顺序变了 —— 不打 daemon、也不重新扫描。 |
| 19183 | `onSpaceSortClick` | fn | 所以每次重渲染都不需要重新绑事件。 |
| 19194 | `renderSpaceResult` | fn |  |
| 19311 | `sharedHint` | fn | 共享项是 dataRoot 的直接子项，给几个高频的补一句人话解释，其余留空。 |
| 19329 | `scheduleSpacePoll` | fn |  |
| 19337 | `pollSpaceScan` | fn |  |
| 19360 | `startSpaceScan` | fn |  |
| 19381 | `cancelSpaceScan` | fn |  |
| 19393 | `refreshSpaceScan` | fn | 进入空间页：正在跑就接管进度，否则用缓存结果秒出；没有缓存才提示扫描。 |
| 19415 | `buildSpacesPane` | fn |  |
| 19448 | `watchAutoCopyProgress` | fn | 观察当前活跃的复制任务。可在任何时刻重复调用（切号、打开面板、注入完成）。 |
| 19515 | `pollAutoCopyJob` | fn |  |
| 19522 | `tokenState` | fn | token 过期状态：< 7 天 / 已过期 -> 红字高亮 |
| 19532 | `render` | fn |  |
| 19694 | `maskAccountName` | fn |  |
| 19702 | `maskAccountId` | fn |  |
| 19713 | `applyAccountMask` | fn | 眼睛按钮 + 卡片文本联动：恢复上次选择，点击切换脱敏/明文 |
| 19739 | `toggleAccountMask` | fn |  |
| 19745 | `refresh` | fn |  |
| 19777 | `updateAccountSummary` | fn |  |
| 19802 | `rotationToday` | fn |  |
| 19807 | `closeRotationNotice` | fn |  |
| 19817 | `showRotationNotice` | fn |  |
| 19843 | `place` | fn |  |
| 19898 | `formatRotationEta` | fn |  |
| 19907 | `formatRotationDuration` | fn |  |
| 19918 | `checkCreditRotationAfterSession` | fn |  |
| 19920 | `run` | fn |  |
| 19942 | `updateCheckinCells` | fn |  |
| 20014 | `fetchActivityForAccounts` | fn |  |
| 20023 | `worker` | fn |  |
| 20074 | `requestCredit` | fn |  |
| 20100 | `updateCreditSummaryFromAccounts` | fn |  |
| 20109 | `refreshCreditForAccount` | fn |  |
| 20141 | `fetchCreditsForAccounts` | fn | 积分查询按 200ms 节奏发起，允许请求重叠，避免前一个账号的慢接口阻塞后续账号。 |
| 20146 | `settleBatch` | fn |  |
| 20156 | `queryAccount` | fn |  |
| 20207 | `updateCreditCell` | fn |  |
| 20251 | `updateDebugPanel` | fn |  |
| 20271 | `onDebugKey` | fn |  |
| 20280 | `markHealthGeneration` | fn |  |
| 20289 | `isHealthStopControl` | fn |  |
| 20294 | `isHealthSendControl` | fn |  |
| 20471 | `mdqvT` | fn | 去重不用数组：直接在 tab 元素上打 __wbsAdoptSkip（随元素移除自动回收） |
| 20473 | `mdqvReadEnabled` | fn |  |
| 20476 | `mdqvWriteEnabled` | fn |  |
| 20479 | `mdqvReadAdopt` | fn |  |
| 20482 | `mdqvWriteAdopt` | fn |  |
| 20487 | `mdqvFindPathByName` | fn | 用产物文件名在页面里反查绝对路径（正文产物卡 / 产物面板条目都带 data-dir）。 |
| 20508 | `mdqvAdoptTick` | fn | 成本：一次 querySelector 实测 0.02 ms 级，600 ms 一次 ⇒ 可忽略。 |
| 20528 | `mdqvAdoptStart` | fn |  |
| 20542 | `mdqvFileUrl` | fn | 不编码会因空格/中文导致 fetch 失败；整体 encodeURI 又会把已有的 % 二次编码。 |
| 20554 | `mdqvNormPath` | fn | 「未编码绝对路径」，否则会拼出 file:///file:///… 或中文二次编码。 |
| 20566 | `mdqvShortPath` | fn | 完整路径仍放在 title 里可悬停查看。 |
| 20577 | `mdqvRootRect` | fn | 面板要贴住的区域：整个应用的可见区（#root），拿不到就退回 window。 |
| 20585 | `mdqvDefaultWidth` | fn | 默认宽度：对齐官方文档视图的观感（约内容区 1/3），并夹到可用范围。 |
| 20593 | `mdqvReadWidth` | fn |  |
| 20600 | `mdqvWriteWidth` | fn |  |
| 20613 | `mdqvPlace` | fn |  |
| 20624 | `mdqvDetachShellGuard` | fn |  |
| 20630 | `mdqvReapply` | fn | 重算并写回让位量。观察者与窗口 resize 都走这里。 |
| 20653 | `mdqvAttachShellGuard` | fn | 1936 ⇄ 2296 之间跳（连带把对话区右边缘推过我的面板左边缘）。两个节点都守。 |
| 20669 | `mdqvApplyShift` | fn | 对话区会滑到面板底下。用父容器当前宽度反推，两种状态都自洽。 |
| 20698 | `mdqvRestoreShift` | fn |  |
| 20730 | `wbsHlClass` | fn |  |
| 20739 | `wbsHighlight` | fn | 高亮入口：返回**已转义**的 HTML 片段。 |
| 20772 | `wbsSafeImg` | fn | 其余属性一律丢弃 —— 防止 md 里塞 onerror 之类的注入面。 |
| 20783 | `mdqvInline` | fn | &amp; 当 URL 二次转义」这类双重转义（URL 进属性位一律走 escAttr）。 |
| 20824 | `mdqvRender` | fn | 分隔线 / 行内语法。**刻意不做**数学与 mermaid —— 遇到就给一行提示，不静默丢内容。 |
| 20828 | `flushPara` | fn |  |
| 20833 | `flushQuote` | fn |  |
| 20838 | `flushList` | fn |  |
| 20843 | `flushAll` | fn |  |
| 20844 | `warn` | fn |  |
| 20845 | `closeFence` | fn |  |
| 20859 | `cellsOf` | fn |  |
| 20865 | `alignsOf` | fn |  |
| 20963 | `mdqvCopyText` | fn | 复制文本（面板内代码块的「复制」用；不依赖 mdqvOpen 内的 flash）。 |
| 20991 | `mdqvBindCodeCopy` | fn | 给代码块顶栏的「复制」按钮接线（面板内走真实监听器；导出的离线页走内联脚本）。 |
| 21006 | `mdqvClose` | fn |  |
| 21021 | `mdqvOpen` | fn |  |
| 21229 | `mdqvStandalone` | fn | 跟随系统深色偏好。样式刻意不复用注入页那份（那份依赖 --wb-* 变量，外部没有）。 |
| 21288 | `mdqvInstall` | fn |  |
| 21323 | `registerBuild` | fn |  |
| 21347 | `wbsTapAdClose` | fn |  |
| 21365 | `startSidebarAdGuard` | fn |  |
| 21375 | `hideHost` | fn |  |
| 21382 | `releaseHost` | fn |  |
| 21390 | `scan` | fn |  |
| 21419 | `onAdGuardVisible` | fn | 窗口重新可见时立刻扫一次：后台被节流期间冒出来的广告不该再等 1.5 秒。 |
| 21432 | `stop` | method |  |
| 21461 | `modelSwitchGuardHost` | fn |  |
| 21466 | `modelSwitchGuardMessage` | fn |  |
| 21478 | `modelSwitchGuardNotify` | fn |  |
| 21493 | `pollModelSwitchGuard` | fn |  |
| 21508 | `startModelSwitchGuard` | fn |  |
| 21520 | `stop` | method |  |
| 21536 | `start` | fn |  |
| 21549 | `destroyWidget` | fn |  |
| 21575 | `readPerfMode` | fn |  |
| 21578 | `applyPerfMode` | fn |  |
| 23094 | `refresh` | method |  |
| 23096 | `getLanguage` | method |  |
| 23097 | `setLanguage` | method |  |

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

## scripts/api-gateway.js  （756 行 / 30 个函数）

| 行 | 函数 | 类型 | 摘要 |
|---|---|---|---|
| 78 | `gatewayDownloadCandidates` | fn |  |
| 100 | `isForkedGateway` | fn | 当前是否为本仓 fork 版（版本号形如 1.13.1-panel-wd9）。fork 版绝不允许退回上游原版。 |
| 105 | `gatewayDownloadBase` | fn | 把候选源拼成 `gh-proxy` 前置的真实下载前缀（镜像只改传输不改字节，靠 SHA-256 兜底）。 |
| 110 | `gatewayPaths` | fn |  |
| 126 | `assertSafeRelativePath` | fn |  |
| 137 | `parseChecksums` | fn | 从 checksums.txt（`<sha256>  <文件名>` 每行一条）里取指定资产的期望摘要（小写；取不到返回 ''）。 |
| 150 | `sha256` | fn | 文件/缓冲区的 sha256（十六进制小写）。 |
| 162 | `listZipEntries` | fn |  |
| 203 | `readZipEntry` | fn | 解压单个条目为 Buffer（数据偏移以**本地头**为准：本地头的 extra 长度可能与中央目录不同）。 |
| 225 | `extractZipToDir` | fn |  |
| 259 | `buildAuthDocument` | fn |  |
| 286 | `writeAuthDocuments` | fn | 写出 auths/<prefix>-<uid>.json（文件名必须匹配官方 `workbuddy*.json` 的扫描规则）。 |
| 321 | `syncAuthDocuments` | fn |  |
| 384 | `buildGatewayConfig` | fn |  |
| 392 | `isObj` | const |  |
| 393 | `merge` | const |  |
| 441 | `readGatewayState` | fn | 读 WorkDaddy 侧状态（缺失/损坏一律给出「未安装」的默认值，不抛错）。 |
| 451 | `writeGatewayState` | fn | 原子写状态（tmp + rename）。**不写 api_key 明文**，只写指纹与长度。 |
| 471 | `normalizeThinkingLevel` | fn | 归一化一个思考档位；非法值返回 ''（**不猜、不编造**）。 |
| 488 | `unwrapProxyUrl` | fn |  |
| 503 | `gatewaySameOrigin` | fn |  |
| 529 | `toWorkbuddyModelEntry` | fn |  |
| 578 | `gatewayModelState` | fn |  |
| 631 | `mergeGatewayModels` | fn |  |
| 636 | `incoming` | const |  |
| 637 | `stripPrefix` | const |  |
| 638 | `same` | const |  |
| 702 | `unmergeGatewayModels` | fn | 撤销：按名单把本插件写入的条目摘掉（**纯函数**；名单来自 gateway 状态文件）。 |
| 710 | `apiKeyHint` | fn | api_key 的展示用指纹（只回前 6 位 + 长度，够确认是不是同一把，又不泄漏）。 |
| 717 | `generateApiKey` | fn | 生成本地 api_key（32 字节 base64url，约 43 字符）。 |

合计 **2092** 个函数。
