'use strict';
// 回归跑批：逐个跑 .wd-analysis 的测试 + tools/updater-guard，汇总最后一行。
// 用法：node .wd-analysis/run-regression-all.js
// 报告写到 .wd-analysis/regression-all.out.txt（.out.txt 属本机证据，已 gitignore）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE = process.execPath;
const ROOT = path.resolve(__dirname, '..');
const SUITES = [
  ['test-sync-pause.js', 62],
  ['test-cascade-delete.js', 66],
  ['test-space-scan.js', 68],
  ['test-space-ui.js', 70],
  ['test-limit-failover.js', 47],
  ['test-limit-switchback.js', 138],
  ['test-idle-switchback.js', 135],
  ['test-switch-sync.js', 63],  // 2026-09-21 手动强制覆盖：C18 形态更新 + C22–C27 六条新守卫
  ['test-lineage-dedupe.js', 34],
  ['test-cloud-ghosts.js', 86],
  ['test-login-tip-i18n.js', 19],  // 2026-09-21 冲突文案：+1 源码取真身的分叉标题断言
  ['test-space-sort.js', 65],
  ['test-token-stats-attribution.js', 7],
  ['test-stats-t20-discipline.js', 139],  // 2026-09-23 T23（统计工程纪律五条）+ T20（思考效率与模型性价比）：宁缺勿猜（时间戳不留空回落/派生指标 null 不是 0/undated 台账）+ 只读打开（含写模式反向守卫）+ 只读头尾（单行 JSON 头部探测回归）+ 参数组合报错 + 命中率分母守卫 + 模型归属两路径（歧义/无候选/多模型一律不摊派）+ 三源合成派生口径精确 + credit 只来自权威表（含反向守卫）+ 缓存增量与版本号重建 + daemon/inject/i18n 接线静态守卫
  ['test-scheduled-send.js', 184],
  ['test-schedule-verify.js', 254],
  ['test-archive-isolation.js', 79],  // v1.3.8 归档仅主账号（63）；v1.7.1 补来源②：主账号 archived lineage 在其他账号上的【活行】（不限 status）也纳入清理，修「先取消归档→切号复制→再归档」留下的 completed 副本清不掉（+16）
  ['test-session-open.js', 87],   // v1.3.9/1.3.10：session.open 迷你 renderer 仿真；v1.3.13 加侧栏收起态
  ['test-copy-manifest.js', 96],  // v1.3.11：空间扫描 → 复制排队清单 → 排序；H4/H4b 拆开新鲜度口径
  ['test-send-verify.js', 81],    // v1.3.12 草稿核验 / 1.3.14 composerSendExpr / 1.3.15 草稿残留 / 1.3.16 busy 落定
  ['test-switch-settle.js', 47],  // v1.3.17 切号闸门：还原因定时任务切走的账号前，先等在飞的回合跑完（v1.4.3 B4 取并集后 42→47）
  ['test-autocopy-conflict-baseline.js', 42],  // v1.4.1 会话同步「假冲突 + 自锁」：血缘级 watermark 标尺 + 正文 mtime 收窄
  ['test-automations-guard.js', 41],  // v1.4.1 P0：读失败不得折成空集合（静默清空全部任务）+ 写侧骤减守卫 + 路由级兜底
  ['test-client-debug-relaunch.js', 34],  // 上游 1.2.12 吸纳/A1 + 1.2.13 补丁/B1：客户端「进程在跑但调试端口丢了」（官方自动更新后裸重启）的检测与一键恢复 —— VM 切片真跑状态机（阈值 3 / 命中才标记 / 恢复清零 / 未知不计数 / 不重复刷日志）+ 接线静态守卫（恢复路由先退后起 / 202 pending / 动作前重探 / 状态页按钮）+ ⭐ 非阻塞反向守卫（/api/status 与 cdpLoop 都不得同步探测，否则 Win 上 2.4~6.7s 拖垮 launcher 的 8000ms 探测预算）
  ['test-daemon-http.js', 23],  // v1.4.1 §9-3：HTTP 入口层（readBody 一定 settle / 有界 / 解析失败 reject）+ 鉴权契约；2026-10-13 上游 1.2.12/1.2.13 吸纳：+F3 反向守卫（POST 例外白名单必须落在公开路径集合内），F1 5→6、F2 改为「除显式白名单外不得出现在 POST 分支」；同日修 E7/E8 抖动：abort 探针与服务端解析请求头有竞态（RST 先到则该连接不计入），固定次数 + 精确计数会随负载随机变红 ⇒ 改 abortUntil 补发到目标达成（实测 8/8 稳定）
  ['test-usage-attribution-guard.js', 32],  // v1.4.1 §9-6：空间归属解析（裸前缀错归）+ 用量入库（NaN 拖垮整批）
  ['test-watchdog-backoff.js', 16],  // v1.4.1 §9-4：watchdog 退避复位判据（存活超 60s）+ 熔断
  ['test-failover-clock.js', 42],  // v1.4.1 §9-7：限流窗口绝对到期时刻 + 时钟回拨不可信 + 结构化「选不出账号」
  ['test-build-pin.js', 27],  // v1.4.1 §9-5：ws 钉版本（manifest+lock+npm ci）+ 真跑 vendoring 与内嵌 Python 块
  ['test-session-sync-124.js', 81],  // 上游 1.2.6 会话同步重定基：五态判定 + 选主不猜 + applySnapshot 真写 + fixture/delta provenance 锁（2026-09-27 随 1.2.8 重锚到 upstream-1.2.8.js，导出面 9→11）+ 上限取消/惰性读守卫 + readSessionSizes + [G] 免费继承项与本地 4 条 skip 域 delta 未被冲掉（+9）+ [H] 瞬态冲突延迟重读（1.2.128 / 批次 4-2，+6）；E12–E15 改为 1.2.8 的「提交即清理」语义
  ['test-auto-copy-judge.js', 39],  // 方案 D/D0：judge 开关（默认 mtime ⇒ 零行为变化）+ 快照域切分 + 指纹 memo（命中零读盘）+ slim/writable 护栏；2026-09-22 加 [E] D4 灰度入口（GET/POST /api/sessions/auto-copy/judge + 非法值 400 + 全仓唯一调用点反向守卫）12 条
  ['test-auto-copy-leader.js', 70],  // 方案 D/D1+D1.5：内容定源判主偏序 + mtime 不参与定源 + alias 契约 + daemon 接线 + 打包白名单 + 面板文案；2026-09-21 冲突文案抽共用 helper 后 +2（I4 两处共用 / I5 conflict 分支）；2026-09-23 打包白名单判据升级为**传递闭包**后 +1（H3，共用 packaging-whitelist.js）
  ['test-auto-copy-content-write.js', 72],  // 方案 D/D2：content 模式改走 applySnapshot 事务写入（差异集 + 备份 + journal + 发布后复检）+ 目标多余文件清理 + 产物域不动 + 备份按 mtime 裁剪 + 默认 mtime 路径逐字节未变；2026-09-27 上游 1.2.8 吸纳：C12–C15 改为「提交即清理」新语义（54 → 63，含 [C2] pruneSyncBackups / inspectSyncBackups 九条）；2026-09-29 切号后「复制会话失败」修复：新增 [G] 组（63 → 72，瞬态 CAS 冲突退避重试 + 重试前重读快照 + 端到端复现「取快照后源变化⇒首轮失败⇒重试成功」）
  ['test-session-sync-cache-a3.js', 42],  // 上游 1.2.5 吸纳/A3：文件级指纹缓存（命中零 readFileSync / 结论等价 / 同长度改写必失效 / 排除域不污染）+ judge/leader 第 4 参透传 + daemon 接线 + 缓存本体去抖落盘与脏条目剔除
  ['test-session-dirty.js', 43],  // 上游 1.2.6 吸纳/批次 1：脏标记索引（纯函数判据层）。重点守 **fail-open**（没 markBaseline 的账号 shouldSync 恒 true，错了是静默漏同步不是变慢）+ clear(expectedAt) 防竞态（陈旧通知不许抹掉新标记）+ 脏数据净化 + prune 不碰 initialized + CRLF 纪律 + mac 白名单两处
  ['test-wb-encrypted-compat.js', 60],  // 上游 1.2.6 吸纳/批次 6（阶段一 lib 层 + 阶段二 daemon 接线）：WorkBuddy 5.6+ $wbEncrypted 信封适配层。核心立场 = 本机 5.5.6 无信封 ⇒ 必须可证明零行为变化：[B] 明文路径与旧表达式逐例等价（3 处有意偏差显式登记）+ [C] 取钥不可用 fail-safe（不抛错/保留原值/不返回 [object Object]/恰 1 次取钥尝试）+ [D] 安全不变量（解密只用于校验、密文原样备份、refreshAccountBackupToken 的 encryptedAtRest 不落盘、先探测后解密）+ [E] backupAuthFile 真沙箱逐字节原样 + [F] 接线账本（裸 token 直读清零 / 导入走归一化且深克隆校验 / 写入者唯一）
  ['test-session-receipt-binding.js', 27],  // 上游 1.2.6 吸纳/批次 4 第 3 项：会话回执按**稳定 requestId** 绑定。5.6 把「乐观 user 消息」换正式 ID（CDP 实测 15 条 user 里 10 条 id!==requestId）⇒ 只认「最后一条」会误报「会话已有其他请求，已停止等待」。本套件用假 renderer 驱动真函数验：换 ID 不误报 / 多回合选中本轮 / 真换回合仍拦 / 旧回执向后兼容 / **不许照抄上游那半截**（hydrating·streaming·turnActive 三字段与本地 busy 必须保留，否则 daemon 两处闸门静默失效）
  ['test-growth-tasks.js', 113],  // 成长任务「一键完成」：指纹派生稳定 + 桌面 6 连事件形状 + 四条 CN 通道 + 领奖主备降级 + accept 回读重试 + 档位门控（tier3 默认关）+ 行形状兼容 + 端到端自动领奖 + 面板/daemon 接线 + 全量中文文案 i18n 守卫
  ['test-session-monitor.js', 55],  // 上游 1.2.6 吸纳/批次 4 第 4 项（A7）：会话监控中断判据。核心契约 = isSessionMonitorInterrupted 与判定层**结论完全一致**（允许绑定的会话必须等于会被续跑的会话）；另守抽函数后的静默退化陷阱（acControllerSnapshot 必须自带 completionMarker）+ 会话资源归一化的 protocolStatus 跨字段取终局
  ['test-session-activation.js', 36],  // 上游 1.2.6 吸纳/批次 5（B1/C2/A9）：会话激活分层融合。行为级验快路径（官方导航 handler/SDK 优先）**只在可验证时**成立：authoritative!==true 不调 activate、activate 后必须确认目标控制器真的挂上、没落地则回落点击循环且老路径零行为变化（快路径成功时零点击）；源码级守 A9 的 currentConversationId 所有权校验 + openConversationById 签名不变
  ['test-session-dirty-wiring.js', 49],  // 上游 1.2.6 吸纳/批次 3（A1 + A5-B6）：脏索引接线。**接线就绪 + 开关默认关**。守：索引持久化（本地口径 atomicWriteText / 去抖 / unref）、POST /api/sessions/dirty 的三道守卫 + 隐私边界、renderer feed 独立订阅与解绑；[B] 组用「出仓代码里没人写 fingerprintVersion」**硬证明规划期快路径今天必然不可达**，并守住「没有动 archived 过滤链的形态」（那条链是归档不变量的守卫锚点）；[D]/[E] 组行为级守 fail-open（未建基线恒 true，写反=静默漏同步）与抖动过滤（账号 reload / 仅 lastActivityAt 漂移不算脏）
  ['test-account-token-refresh.js', 48],  // 上游 1.2.12 吸纳/B4：面板打开时刷新全部账号 token。[A] daemon 契约（状态文件落 DATA_DIR / in-flight 合并 / mtime+size 指纹 / 带签名比对的时间状态 / 新路由排在 GET /api/accounts 之前且失败落 500 不裸抛）+ [B] 保活改按**自然日**（跨零点即新一天，不再满 24h）+ 按天去重 + force 只放宽非 daily 路径 + 并发合并（快速开关面板不产生 token 风暴）+ 单账号并发上限 3 + 结束清 in-flight + 返回四件套 + [C] ⭐ 隐私红线（rememberTokenRefreshSuccess **只**写公开时间字段，函数体里不得出现任何 token 字段名；落盘 0600）+ [D] 列表合并优先级（内存缓存→落盘状态→原样，全过签名比对）+ [E] inject 侧（先快照后触发 / 仅本次打开 / **代际守卫**防旧副本写 DOM / 零刷新不再取快照 / 整链 catch 兜底）+ [F] 反向守卫（写状态文件处禁 token 字段 / 必须在 DATA_DIR 下 / 临时名带 pid / 刷新本体不直接落盘 / 两文件纯 CRLF）
  ['test-automation-protocol-v3.js', 111],  // 上游 1.2.5 吸纳/B 组协议 V3：校验负向门（V1/V2 拒 prepare、prepare 只读白名单、condition 形状）+ prepare/condition 真跑语义（切换前执行 / 跳过不切不跑 / 收尾还原不受影响）+ orderCheckinAccounts 稳定排序 + B4 闸门有界可取消 + A9 失败屏障 + A11 409 + 接线静态守卫（含「不搬上游 job.completion / waitAutomationSyncJob」的反向守卫）
  ['test-upstream-125-step4-panel.js', 102],  // 上游 1.2.5 吸纳/Step 4：A7 作业指标（真跑切片函数 + 速率口径）+ A8 大会话提示 + A7/A8 面板文案整句入典（含重复 key 去重守卫）+ A10 会话体积/总量口径（总量不受筛选）+ 体积筛选字节精确
  ['test-account-health.js', 139],  // v1.4.5 F2：13 层分类顺序（含两条反向对照）+ 三条迁移纪律（不加深 / 取更远者 / 硬不降级）+ A5 分级排除 + A8 双状态位与幂等 + daemon 端点与切片反向守卫 + 面板徽标/i18n/CSS + mac 白名单；2026-09-23 补 E25 传递闭包白名单守卫 +1
  ['test-failover-manual.js', 62],  // F5：手动「换号并续跑」入口 —— markBlocked 三态（缺省零变化 / false 不写限流窗口）+ ports 装配与 core 分居两处（含模块级名字打错的静态守卫）+ 手动路由两个前置刻意不要求且立即 202 + status 透出不带正文 + 面板整句词条与 data-wbs-i18n-skip（数据不被当文案翻）
  ['test-context-audit.js', 59],  // 省 token 吸纳：上下文体检（记忆/skill 体积 + 会话成本形状）—— frontmatter 块标量 / 阈值分级 / 目录树行数真数 / 副本行去重 / sessionRoot 默认值回归（第一版传 home 导致会话维度静默全零）+ daemon 路由只读性静态守卫
  ['test-context-fix.js', 60],  // 省 token 吸纳（执行侧）：context-fix 只移动不删除 + 认 installed_plugins.json 保留激活版本（不靠目录名猜）+ dryRun 不碰盘 + 幂等 + 未知 fixId 拒绝 + daemon fix 路由只收 fixId 不收路径 + 面板折叠化与体检按钮接线 + B1 交接摘要（buildHandoff 纯函数 + GET /api/handoff 只读）
  ['test-memory-governance.js', 106],  // B2 记忆治理巡检：三层分层判据（云端/用户级/工作区/日档）+ 四类错层假阳性必须被排掉（中缀路径 / HTTP 路由 / 通配 / `..`）+ 死指针只认反引号路径且排占位符 + **只提醒不自动改写**（fix.kind 恒为 paste、counts.autoFixable 恒为 0、无 /api/memory-audit/fix 路由）+ mac 白名单两处 + CRLF 纪律
  ['test-structured-error.js', 102],  // F2 第二期（渲染层结构化错误）+ A3（模型级冷却）：形状无关扫描（多字段容错/不误报/循环与深度安全）+ 合成观测「无信号时与 F2 之前逐字相同」+ CDP 表达式自包含且伪页面真跑（幂等/抗 adapter 重建/sink 不外抛/环上限）+ isUsableForFailover 第 4 参 modelId（不传零变化）+ pickFailoverTarget 透传 + 切片反向守卫 + mac 白名单
  ['test-usage-unified-credit.js', 52],  // 2026-09-23 统一用量看板积分口径：同 id 只计一次（含旧实现 3× 对照）+ 权威源 credit_usage_records 三维聚合 + 兜底去重 + 窗口过滤 + 看板模板占位符/转义/内联脚本可解析 + daemon queryCredit 接线与「分子分母同区间」守卫；同日补 F 组（会话排行标题装配）：来源标注不留空白 + 第三方已给标题**也要脱敏**（官方自动标题＝首条提问截断）+ 血缘接回原始 id（缺 sessionIndex 就接不回）+ 查不到留空计 unresolved 不编造 + 快照只收非空真标题
  ['test-session-titles.js', 18],  // 2026-09-23 会话排行标题多源解析（修「未命名会话」）：解析优先级不许乱序（db→血缘→快照→正文 aiTitle→客户端缓存→首条提问）+ 两套 id 桥接（副本 jsonl 文件名 ↔ 内容 sessionId 互为别名，正反双向）+ 脱敏（凭据/手机号一律打码，含官方标题）+ 纪律（查不到返回空不编造 / 快照只增不减 / root 缺失只砍正文桥接不抛）
  ['test-upstream-127.js', 96],  // 上游 1.2.7 吸纳/批次 1+2+3：theme-patches 3 条新补丁（patch-102/103/104 逐条 CSS 片段 + 老条目未丢）+ usageModel 行为级四形状（旧代码是 [object Object]）+ 缓存版本 1→2（常量 + **行为级**：v1 忽略/v2 采纳）+ inject.js 六处定点 10 落点与 4 处旧形态消失 + toast 第四参向后兼容 + [F] Linux 三段（11 落点 + 上游 open-url 行为规范的 vm 真跑：三平台命令/参数/unref、非 http(s) 拒且不 spawn、缺 xdg-open 时 500 且**错误不回流 URL**）；含三条边界登记（数字 0 被 String(0) 采用 / usageModel(null) 抛 TypeError 但生产不可达 / 第二处 IS_WIN||IS_LINUX 属本地既有 CDP 路径）；2026-09-27 随 1.2.8 升到 100 条并加 A2b（patch-41 已按上游删除，不许回填）
  ['test-upstream-128.js', 63],  // 上游 1.2.8 吸纳（5 批全落地）：[A] 主题三件套必须同批（patch-105/106 + patch-41 已删 + theme-vars nebula 透明变量 + nebula theme.json）+ [B] 同步备份生命周期（prune/inspect 导出面、SYNC_BACKUP_DIR、changedTargetFiles 两处调用）+ [C] 模型限流表行为级（UPSERT/**过期自动清**/resetAt=null 只记不删/参数校验）+ [D] setAccountNote 行为级（原型污染串/白名单/2000 字/账号不存在/认证备份一字未动）+ [E] daemon 六路由与**直连 require session-sync**（漏了会 ReferenceError）+ [F] 本地红线与自研未被冲掉（无 firstTargetCopy / 无 mappingTargetLifecycleRevisionMatches / 4 个旧主题函数已删且无遗留调用 / 本地 5 处自研内容仍在 / 积分趋势仍 false）+ [G] 11 个关键文件行尾
  ['test-zh-reasoning.js', 29],  // 2026-09-29 中文思考开关（写入官方「全局自定义指令」settings.personalization.customPrompt）：vm 真跑纯函数 —— 块形状（起止标记精确包裹/首句直接思考指令/豁免代码命令路径/留语言出口）+ strip 安全性（空输入安全/无块不动/标记残缺不误删）+ ⭐ 开→关往返逐字节恢复用户内容 + 幂等（重复开启只一个块）+ ⭐ 与「决策弹窗」段共存互不干扰 + 两侧接线（daemon 两路由/启动刷新/关空时删键；inject 可见开关 + 失败回滚 UI 勾选态）
  ['test-api-gateway.js', 113],  // 2026-09-30 反代网关集成（sidecar）：checksums 解析 + 凭证桥（毫秒→秒/realm 推断/缺字段拒绝/uid 清洗防穿越）+ config 三条安全默认（listen 锁回环 / api_key 非空强制 / 定时任务全关）+ 纯 JS zip 自解压（stored+deflate / zip slip 拒绝 / 非法压缩法拒绝 / 真实官方包 sha256 与 checksums 一致且解出 PE 头）+ 状态不落 api_key + 目录布局 + 模型闭环（id/name 加前缀让同名共存 / 重复注册幂等 / 裸 id 撞车由 occupied 保护 / 撤销后用户条目逐字节恢复 / 接线 bili 后剥包裹前缀再判同源（否则 5 条已注册全判 absent、应用时多造一份副本））
  ['test-switch-presync.js', 73],
  ['test-skill-refs.js', 11],
  ['test-audit-fixes.js', 21],
  ['test-official-schedule.js', 20],
  ['test-upstream-1211.js', 26],
  ['test-launcher-privilege.js', 26],
  ['test-codebuddy-launcher-identity.js', 16],  // 2026-10-22 CodeBuddy 启动入口（方案A 直跑 node 启动器）：A 进程身份白名单认识 "codebuddy cn.exe"（缺它 ⇒ Expected executable is not a WorkBuddy-family binary，重启客户端那步直接崩，实测复现）+ 反向两条（外来 exe / 带路径分隔符的进程名仍拒）+ B start-codebuddy.cmd 纯 CRLF 且清 ELECTRON_RUN_AS_NODE（否则 --remote-debugging-port 变 bad option exit 9，实测前后对照）+ NODE_OPTIONS + WBSWITCH_NATIVE_LAUNCHER（原生发现只认 WorkBuddy 名字）+ 内置 node + profile 绑定 + C 能力表自洽（cdp / nativeComposer / enhance:false / binaryNames 对齐）
  ['test-codebuddy-lite-mode.js', 32],  // 2026-10-22 CodeBuddy 轻量版 + 注入健壮性：A daemon 漏导入 selectIdeTargets（每次 ideSyncScan 抛 ReferenceError ⇒ IDE 主窗口从未注入，实测 8 次/40 秒）+ B 全局错误钩子同类节流（CodeBuddy 的 AutomationBridge 失败 13 秒抛出 2870 条 unhandledrejection，250 条/秒，日志涨到 3.7MB）+ C 轻量版（codebuddy 两个 profile 标 lite，只摘 theme/automations/pc 页签且不碰 pane 容器；daemon 不装内置任务、不调度）+ D 行尾与语法
  ['test-codebuddy-inject-wait.js', 37],  // 2026-10-23 「一堆注入报错」：A /api/inject 把「主连接未就绪」当失败（launcher 每秒一条，30 条刷屏）⇒ manual 注入先主动等主连接 8s + 失败后 20s 冷却（不许每次重试都硬耗 8s）+ B CodeBuddy 主 target agentManager.html 是懒创建的（不开 AI 面板就没有），而 IDE 通道 workbench.html 早已注入成功（实测 [cdp-ide] IDE 浮层已注入）⇒ ideChannelMounted 成立即返回 mounted:true，不再误报失败 + B-2 状态页不再误报「调试端口不可达，请一键恢复」+ C launcher 单次请求超时 5s→12s、重试 24 次递增退避（前 6 次 1s 后 3s）、进度日志只在第 1 次与 5 的倍数打印 + D 真跑 injectRetryDelay 与 waitForManualCdpReady 冷却语义 + E 行尾与语法
  ['test-daemon-probe-guard.js', 14],
  ['test-models-file-format.js', 43],  // 2026-10-23 「从 WorkBuddy 导入模型显示成功、CodeBuddy 里一个都看不到」：CodeBuddy 的 models.json 是**对象** { models: [...] }（主进程 buildLocalCustomModelsResponse 只读 e.models，裸数组 ⇒ 0 条），WorkBuddy 是裸数组 ⇒ 按 profile 决定形态。A lib.js 形态判据（modelsFilePrefersObject / buildModelsFileDoc / normalizeModelsFileFormat / read 按 wantObject / write 统一构建 / 导出）+ ⚠️ availableModels 是可见性白名单，缺失或空数组时客户端不过滤 ⇒ **绝不凭空创建**，已有的只做并集 + B daemon 三条写盘路径（register-models / set-model-context / 启动迁移幂等，且在 acquireDaemonLock 之后）+ C 隔离 HOME 真跑（codebuddy 落盘对象且无 availableModels、导入 2 条、重复幂等、迁移留 .bak-array 备份；workbuddy 全程仍是裸数组）+ D 行尾与语法  // 注意：断言网关那两行必须走 daemonFlat —— codeOnly 的块注释剥离会被「与其它 /api/* 同一条」里的 `/*` 带偏，整段 500 行凭空消失
  ['test-upstream-1215.js', 30],  // 2026-10-16 上游 1.2.15 吸纳守卫（只取 1.2.40 + 1.2.41）：A 正向 19 条（lightClientRunning 走 tasklist 不碰 WMI / ⭐ 探测子进程入口真的改用它 / safeClientRunning 保留给安全路径 / 刷新 5s→15s + 环境变量覆盖 / 两处 CIM 都加 -Filter / 失效卷跳过 + 同卷根只提示一次 / ⭐ UPSTREAM_VERSION 同步 1.2.15）+ B 反向 4 条（⛔ 守住「不吸纳同步个性化」：persona 那批函数与路由一个都不许进来）+ C vm 桩测 6 条（tasklist 命中/未命中/探测失败三分支 + 首个命中即返回 + Linux 分支 + 异常兜底）+ D 真跑 --probe-client-running 入口不炸
  ['test-close-popups-preset.js', 34],
  ['test-gateway-account-sync.js', 33],  // 2026-10-16 网关账号池同步（修「新登录账号永远进不了池」：auths 原本只在 install 时写一次）：A syncAuthDocuments 增量语义真值 16 条（新增 / 幂等零写入含 mtime / 内容变了只重写一个 / 不在名单则删 / ⭐ 删除前三重保险：解析不出 uid、uid 与文件名不符、非 workbuddy- 前缀一律保留 / 异常入参不炸）+ B daemon 挂钩 10 条（网关未装零开销短路 / 新路由 / ⭐ scheduleBackup 后自动同步 / 启动同步 / status 透出 accountPool.missing / install 改走 sync 且旧全量调用已移除）+ C vm 切片真跑（未装 ⇒ skipped）+ D 面板抓手 6 条（漂移提示 + 「同步账号池」按钮 + 暗色样式）  // 2026-10-16 侧栏运营位轮播广告（Shadow DOM 内的 pc_fusion_carousel_close）纳入内置关闭任务：preset 静态（rev 3 + 两个历史 hash + 新定位器 5 组不丢旧 4 组 + ⭐ 定位器不得带 visible 否则 skipMove 点不动 + 挂在 delay 之前 + pageReady 触发不变）+ daemon 遮挡判定放宽到接受「命中 el 的祖先」（附 getRootNode 与 skipMove 判据）+ 真跑 installBuiltinTask（临时 dataDir：升级到 rev3 / 保留 enabled / 标记前进 / 用户改过则 skipped 且原样保留 / 重复升级幂等）  // 2026-10-14 上游 1.2.14（1.2.38）吸纳：daemon 探测子进程不得递归派生。静态（守卫在 refreshClientRunning 体内 / 顶层无裸调用 / startClientRunningMonitor 落在 acquireDaemonLock 之后 / 两个探针超时常量已接线）+ 动态（真跑 --probe-client-running 入口 ×4 profile，preload 拦截 execFile 断言累计派生 0，且入口仍能应答 {running:…}）
  ['test-dsh-ops-integration.js', 62],  // 2026-10-15 吸纳 T-Auto/dsh-ops（Rust 原生检索/批处理 → MCP）：桥脚本随包（shebang / -wb 标记 / 只依赖 node 内置 / HERE 相对 worker 路径 / read_only 与 write_roots）+ daemon 四路由十一函数 + 固定上游包版本与 sha512 integrity + 镜像源环境变量 + 非 Windows 拒绝 + 卸载「目录精确相等 + manifest」双重守卫 + mcp.json 损坏时拒写 + inject 专用卡（旧通用 MCP 卡已彻底移除 + 四个 API 调用 + 主按钮/暗色适配 + armed 二次确认 + 平台不支持分支）+ vm 切片真值（tar 解析 5 项 / sha512 校验 4 项）+ mac 白名单两处；含三条自检（A5b 只 node 内置 import / A5c write_roots 圈定 / B7b 有 manifest 才删）
  ['test-gateway-console.js', 171],  // 2026-10-15 反代网关「毛坯 → 控制台」重做：A 集成层真跑（版本钉 v1.13.0 + 资产名跟随 + 三条安全默认 + ⭐ preserve 升级不丢配置 12 条：用户改动保留 / 新键取模板默认 / 废弃键不带回 / 时间表保留而 *_enabled 不生效 / 管理键不被污染 / 不传 preserve 零回归 / 入参无副作用）+ B daemon（4 新路由 pool/log/set-enabled/probe + 5 新函数 + /api/gateway 改缓存快照 + healthz 的 healthy 是「可用账号数」不是布尔 + versionDrift/autoStart/registeredModelCount + install 三硬化：先停进程 / 复用 api_key 防 401 / preserve 旧配置 + 装完重拉 + 池快照白名单映射）+ C 面板（7 个新 DOM + 5 个新函数 + mini-btn 禁用态 + 启停互斥可用 + 自动拉起开关 + 日志懒加载 + 旧哑按钮写法清零）
  ['test-codebuddy-session-store.js', 4],  // 阶段① 地基：CodeBuddy 虚拟 sessions 表（VS Code state.vscdb 的 ItemTable 是 key-value，不是 SQL；读写都走官方主进程服务）
  ['test-codebuddy-files.js', 12],  // 阶段① 地基：CodeBuddy 四棵历史树（history/plan-task/check-point/file-tree）的归档/迁移/删除事务 + 用量按账号历史树采集（含已删除会话的墓碑）
  ['test-codebuddy-native.js', 7],  // 阶段① 地基：CodeBuddy 原生登录态替换（经 CDP 找 ipcMain auth handler，不 patch app.asar、不伪造 renderer 状态）
  ['test-codebuddy-native-recovery.js', 5],  // 阶段① 地基：CodeBuddy 原生会话恢复的选号判据（只用已确认可用的备份；显式退出登录不得自动恢复）
  ['test-sidebar-ad-guard.js', 25],  // 2026-10-21 侧栏运营位（积分包/成长活动轮播）常驻清理器：[A] 注入位置与幂等（重注入必须停掉旧 setInterval）· [B] ⭐ 必须发完整 pointerdown→mousedown→pointerup→mouseup→click（简化序列静默失效）· [C] 不可见不扫 / 恢复可见立刻扫 / 点不掉兜底隐藏宿主 / slot 换内容要还原 / CodeBuddy 早退 · [D] 语法 + 纯 CRLF
  ['test-codebuddy-daemon-wiring.js', 49],  // 阶段②③ 接缝（静态，因为真的读写要跑起客户端）：[A] 模块装配（sessionSync 必须 let）· [B] 会话库读写走 CODEBUDDY_SESSIONS 且旧手工正则嗅探已清除 · [C] Token 统计带历史树清单与兄弟 profile 隔离、思考效率页保持关闭 · [D] 注入层（selectIdeTargets / 只认 agentManager 的主连接 / binding 通道 / TrustedTypes bootstrap + 四处 innerHTML 重写 / injectWidget 必须 async · [E] inject 侧面板适配（mountPersistentOverlay / 浅色外观 / apiTransport=cdp 走 binding 桥 / nativeComposer 图标与配色 / CAPS.appName 的门控前置）· [E18–E22] daemon 侧发送路径按 profile 拼分支（声明必须在 sendExpr 之前）+ 改派发 click
  // 2026-10-01 官方 5.7.3 定时任务「融合」：只读官方 automations 表（硬约束：全仓无写操作）/ 时间戳单位按数量级判别（created_at 秒 vs next_run_at 毫秒）/ 冲突检测只判 daily / 面板引导 + i18n 整句入典 / 活体验证 nextSlot 年份合理  // 2026-10-01 全面审查 4 项修复：复制跳过特殊文件（含「必须放行符号链接」的回归守卫）/ cloud-ghosts 日志澄清（含 D12 契约反向守卫）/ 渲染层错误记录兜底（行为级验证不再出现 error: null）/ 代码索引覆盖扩容 4→10  // 2026-10-01 知识页「自愈」守卫：文件引用存在性 + 行号越界 + 反查表章节验真（借鉴 Hindsight Knowledge Pages 的 self-healing）  // 2026-09-30 切号「预同步+进度弹窗」：core 顺序重排（预同步先于切号 / 失败中止整轮不走 per-round catch / 可选端口守卫保证既有切片套件逐字等价 / 切片沙箱零标识符泄漏）+ 弹窗阶段机（惰性过期 / 取消复用既有中止机制 / 未活跃过不凭空造弹窗）+ 「只等 meta 阶段」判据 + 路由与 UI 静态守卫
  ['test-workbuddy-launch-env.js', 28],  // 上游 1.2.16 / #424：客户端「一重启就自动升级、不装完不让开窗」——官方 Windows updater 会在检查 feed 前恢复缓存的 Setup.exe，只钉 URL 拦不住。A 纯函数（TEMP/TMP 隔离到 <dataDir>/client-tmp/<id> 且真建目录 / 不套娃 / CN 与 intl 各自的更新域 / 配置目录与数据目录名 / 非 win32、codebuddy、customTarget 一律原样 / 路径非绝对时 throw 而不是静默不隔离 / 小写 temp 别名必须清 / 不 mutate 入参 / 保留无关变量）· B win-launcher 接线（引入 / launchWorkBuddy 走 getWorkBuddyLaunchEnv / 旧的「只补 CDP 变量」内联写法已清除 / environment 分支仍在）· C daemon 接线（relaunchWorkBuddy 同步接线 + 裸 process.env 副本已清除 + windowsHide:false 修「重启后只剩托盘」）· D 打包白名单两处 + 纯 CRLF
  ['test-client-tmp-cleanup.js', 25],  // client-tmp 回收（TEMP 隔离的配套）：A 盘点 13（超龄入选 / 新鲜保留 / 目录按自身 mtime / 含子目录体积 / root 缺失与相对路径一律空计划 / maxEntries 截断 / 自定义保留期 / 符号链接只删链接 / isInside 拒同名前缀）· B 执行 6（dryRun 不动盘 / 真删文件与目录 / 新鲜文件留下 / EBUSY 计入 failed 不抛 / 只删盘点清单里的路径）· C daemon 接线 5（require / 启动一次 / 24h / timer.unref / root 取 clientTmpRoot(DATA_DIR)）· D 纯 CRLF + mac 白名单两处
  ['test-token-persist-encrypted.js', 22],  // 上游 1.2.18：加密态账号「刷新成功但存不进文件」（旧行为=只丢内存+日志「仅保存在内存」，daemon 一重启就退回旧 token）。A 加密写回语义 4（无加密模板直接拒绝 / 解密→改→加密→再解密逐字段一致 / 写回仍是密态且不含明文 / 加解密共用同一 AAD）· B lib 结构 5（AAD 抽出 / setAAD 复用 / 写前先验证原信封可解 / 凭据白名单只封这几个 / 已导出）· C daemon 落盘 12（persistRefreshedAccount 定义 / ⭐ 双 CAS：签名 + 全文比对 / 加密态按原信封重加而非写明文 / wx 独占临时文件 + rename / 失败日志不带异常原文 / ⭐ 刷新前预检可写性否则 encrypt-account-unavailable 不刷 / pendingPersistence 标记 + 补写路径 / 旧「仅保存在内存」与旧 read-failed 拼消息已清除）· D 两个文件仍纯 CRLF。⚠️ A2–A4 依赖本机存在加密态账号备份，缺失时 skip 3 条（pass 变 19）
  ['test-session-silent-refresh.js', 18],  // 上游 1.2.18：会话列表「后台刷新把用户勾选冲掉」（自动复制收尾会延迟重载，旧实现每次都 selected={} + 退出批量模式）。A 闸门 5（四个不刷场景：批量/有勾选/页面隐藏/弹窗可见 + 面板必须 active + 自动复制在跑不刷 + 入口再拦一次）· B 静默语义 10（options.silent 解析 / ⭐ readSerial 竞态只认最新响应 / 快照比对数据没变不重渲染 / 不动 selected / 不退出批量模式 / 保住滚动 / 静默失败不擦列表）· C 调用边界 2（自动收尾走静默；用户切筛选仍走普通刷新，该清勾选就清）· D 纯 CRLF
];

// ── 0) 代码索引保鲜（2026-10-01 新增）─────────────────────────────────────────
// `CODE-INDEX.md` 是给「AI 定位函数」用的**生成物**（约 93 KB / 1527 个函数），但它会**腐烂**
// —— 实测 2026-09-22 生成后 **8 天**没刷新，索引里的行号就全漂了。
// 生成只要 **0.45 秒** ⇒ 每次跑回归顺带保鲜，不再依赖人记得。
// 失败**不阻断**回归（只提示），避免"索引生成器坏了导致整套回归跑不了"。
try {
  const genOut = execFileSync(NODE, [path.join(ROOT, '.wd-analysis', 'gen-code-index.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const stamp = String(genOut).split(/\r?\n/).filter((l) => /合计|索引 ->/.test(l)).join(' | ').trim();
  console.log('[index] 已刷新 CODE-INDEX.md   ' + stamp);
} catch (e) {
  console.log('[index] !! 刷新 CODE-INDEX.md 失败（不阻断回归）: ' + String((e && e.message) || e).slice(0, 160));
}

const out = [];
let bad = 0;
let totalPass = 0;
for (const [file, expect] of SUITES) {
  let text = '', code = 0;
  try {
    text = execFileSync(NODE, [path.join(ROOT, '.wd-analysis', file)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    text = String((e.stdout || '') + (e.stderr || ''));
    code = e.status === undefined ? -1 : e.status;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const summary = lines.filter((l) => /pass|fail|通过|失败/i.test(l)).slice(-1)[0] || lines.slice(-1)[0] || '';
  // node:test（TAP）风格：pass 与 fail 分两行输出（`# pass 12` / `# fail 0`），
  // 不能只取最后一行，否则永远解析不到 → f 为 null → 误判整套 FAIL。
  const tapPass = /^# pass (\d+)\s*$/m.exec(text);
  const tapFail = /^# fail (\d+)\s*$/m.exec(text);
  const m = (tapPass && tapFail)
    ? [null, tapPass[1], tapFail[1]]
    : summary.match(/(\d+)\s*pass\s*\/?\s*(\d+)?\s*fail/i)
      || summary.match(/(\d+)\s*passed,\s*(\d+)\s*failed/i)
      || summary.match(/passed=(\d+)\s+failed=(\d+)/i)
      || summary.match(/结果：\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
  const p = m ? Number(m[1]) : null;
  const f = m ? Number(m[2] || 0) : null;
  const okFlag = code === 0 && f === 0;
  if (!okFlag) bad++;
  if (p !== null) totalPass += p;
  out.push((okFlag ? 'ok  ' : 'FAIL') + '  ' + file.padEnd(34) + ' rc=' + code + '  汇总: ' + summary.trim() +
    (p === null ? '' : '   (预期 ' + expect + (p === expect ? ' ✓' : ' ✗ 实际 ' + p) + ')'));
}
// 更新器护栏
{
  let text = '', code = 0;
  try {
    text = execFileSync(NODE, [path.join(ROOT, 'tools', 'updater-guard.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { text = String((e.stdout || '') + (e.stderr || '')); code = e.status === undefined ? -1 : e.status; }
  const pass = (text.match(/PASS/g) || []).length;
  const failn = (text.match(/FAIL/g) || []).length;
  if (code !== 0 || failn) bad++;
  out.push((code === 0 && !failn ? 'ok  ' : 'FAIL') + '  tools/updater-guard.js'.padEnd(34) + ' rc=' + code + '  PASS=' + pass + ' FAIL=' + failn);
}
out.push('');
out.push(bad === 0
  ? '全部通过（' + (SUITES.length + 1) + ' 个套件 / ' + totalPass + ' 项断言）'
  : '有 ' + bad + ' 个套件未通过');
const file = path.join(__dirname, 'regression-all.out.txt');
fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
process.stdout.write(out.join('\n') + '\n');
