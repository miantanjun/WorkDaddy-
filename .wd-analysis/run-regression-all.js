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
  ['test-idle-switchback.js', 128],
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
  ['test-autocopy-conflict-baseline.js', 39],  // v1.4.1 会话同步「假冲突 + 自锁」：血缘级 watermark 标尺 + 正文 mtime 收窄
  ['test-automations-guard.js', 41],  // v1.4.1 P0：读失败不得折成空集合（静默清空全部任务）+ 写侧骤减守卫 + 路由级兜底
  ['test-daemon-http.js', 22],  // v1.4.1 §9-3：HTTP 入口层（readBody 一定 settle / 有界 / 解析失败 reject）+ 鉴权契约
  ['test-usage-attribution-guard.js', 32],  // v1.4.1 §9-6：空间归属解析（裸前缀错归）+ 用量入库（NaN 拖垮整批）
  ['test-watchdog-backoff.js', 16],  // v1.4.1 §9-4：watchdog 退避复位判据（存活超 60s）+ 熔断
  ['test-failover-clock.js', 42],  // v1.4.1 §9-7：限流窗口绝对到期时刻 + 时钟回拨不可信 + 结构化「选不出账号」
  ['test-build-pin.js', 27],  // v1.4.1 §9-5：ws 钉版本（manifest+lock+npm ci）+ 真跑 vendoring 与内嵌 Python 块
  ['test-session-sync-124.js', 74],  // 上游 1.2.6 会话同步重定基：五态判定 + 选主不猜 + applySnapshot 真写 + fixture/delta provenance 锁（锚 1.2.6）+ 上限取消/惰性读守卫 + readSessionSizes + [G] 免费继承项与本地 4 条 skip 域 delta 未被冲掉（+9）
  ['test-auto-copy-judge.js', 39],  // 方案 D/D0：judge 开关（默认 mtime ⇒ 零行为变化）+ 快照域切分 + 指纹 memo（命中零读盘）+ slim/writable 护栏；2026-09-22 加 [E] D4 灰度入口（GET/POST /api/sessions/auto-copy/judge + 非法值 400 + 全仓唯一调用点反向守卫）12 条
  ['test-auto-copy-leader.js', 68],  // 方案 D/D1+D1.5：内容定源判主偏序 + mtime 不参与定源 + alias 契约 + daemon 接线 + 打包白名单 + 面板文案；2026-09-21 冲突文案抽共用 helper 后 +2（I4 两处共用 / I5 conflict 分支）；2026-09-23 打包白名单判据升级为**传递闭包**后 +1（H3，共用 packaging-whitelist.js）
  ['test-auto-copy-content-write.js', 54],  // 方案 D/D2：content 模式改走 applySnapshot 事务写入（差异集 + 备份 + journal + 发布后复检）+ 目标多余文件清理 + 产物域不动 + 备份按 mtime 裁剪 + 默认 mtime 路径逐字节未变
  ['test-session-sync-cache-a3.js', 41],  // 上游 1.2.5 吸纳/A3：文件级指纹缓存（命中零 readFileSync / 结论等价 / 同长度改写必失效 / 排除域不污染）+ judge/leader 第 4 参透传 + daemon 接线 + 缓存本体去抖落盘与脏条目剔除
  ['test-session-dirty.js', 43],  // 上游 1.2.6 吸纳/批次 1：脏标记索引（纯函数判据层）。重点守 **fail-open**（没 markBaseline 的账号 shouldSync 恒 true，错了是静默漏同步不是变慢）+ clear(expectedAt) 防竞态（陈旧通知不许抹掉新标记）+ 脏数据净化 + prune 不碰 initialized + CRLF 纪律 + mac 白名单两处
  ['test-wb-encrypted-compat.js', 56],  // 上游 1.2.6 吸纳/批次 6 阶段一：WorkBuddy 5.6+ $wbEncrypted 信封适配层。核心立场 = 本机 5.5.6 无信封 ⇒ 必须可证明零行为变化：[B] 明文路径与旧表达式逐例等价（3 处有意偏差显式登记）+ [C] 取钥不可用 fail-safe（不抛错/保留原值/不返回 [object Object]/恰 1 次取钥尝试）+ [D][E] 安全不变量（解密只用于校验、密文原样备份、明文不入盘）+ [F] 阶段账本（lib 层已就绪 / daemon 层 16 处未接线，如实登记缺口）
  ['test-growth-tasks.js', 113],  // 成长任务「一键完成」：指纹派生稳定 + 桌面 6 连事件形状 + 四条 CN 通道 + 领奖主备降级 + accept 回读重试 + 档位门控（tier3 默认关）+ 行形状兼容 + 端到端自动领奖 + 面板/daemon 接线 + 全量中文文案 i18n 守卫
  ['test-automation-protocol-v3.js', 111],  // 上游 1.2.5 吸纳/B 组协议 V3：校验负向门（V1/V2 拒 prepare、prepare 只读白名单、condition 形状）+ prepare/condition 真跑语义（切换前执行 / 跳过不切不跑 / 收尾还原不受影响）+ orderCheckinAccounts 稳定排序 + B4 闸门有界可取消 + A9 失败屏障 + A11 409 + 接线静态守卫（含「不搬上游 job.completion / waitAutomationSyncJob」的反向守卫）
  ['test-upstream-125-step4-panel.js', 98],  // 上游 1.2.5 吸纳/Step 4：A7 作业指标（真跑切片函数 + 速率口径）+ A8 大会话提示 + A7/A8 面板文案整句入典（含重复 key 去重守卫）+ A10 会话体积/总量口径（总量不受筛选）+ 体积筛选字节精确
  ['test-account-health.js', 139],  // v1.4.5 F2：13 层分类顺序（含两条反向对照）+ 三条迁移纪律（不加深 / 取更远者 / 硬不降级）+ A5 分级排除 + A8 双状态位与幂等 + daemon 端点与切片反向守卫 + 面板徽标/i18n/CSS + mac 白名单；2026-09-23 补 E25 传递闭包白名单守卫 +1
  ['test-failover-manual.js', 62],  // F5：手动「换号并续跑」入口 —— markBlocked 三态（缺省零变化 / false 不写限流窗口）+ ports 装配与 core 分居两处（含模块级名字打错的静态守卫）+ 手动路由两个前置刻意不要求且立即 202 + status 透出不带正文 + 面板整句词条与 data-wbs-i18n-skip（数据不被当文案翻）
  ['test-context-audit.js', 59],  // 省 token 吸纳：上下文体检（记忆/skill 体积 + 会话成本形状）—— frontmatter 块标量 / 阈值分级 / 目录树行数真数 / 副本行去重 / sessionRoot 默认值回归（第一版传 home 导致会话维度静默全零）+ daemon 路由只读性静态守卫
  ['test-context-fix.js', 60],  // 省 token 吸纳（执行侧）：context-fix 只移动不删除 + 认 installed_plugins.json 保留激活版本（不靠目录名猜）+ dryRun 不碰盘 + 幂等 + 未知 fixId 拒绝 + daemon fix 路由只收 fixId 不收路径 + 面板折叠化与体检按钮接线 + B1 交接摘要（buildHandoff 纯函数 + GET /api/handoff 只读）
  ['test-memory-governance.js', 106],  // B2 记忆治理巡检：三层分层判据（云端/用户级/工作区/日档）+ 四类错层假阳性必须被排掉（中缀路径 / HTTP 路由 / 通配 / `..`）+ 死指针只认反引号路径且排占位符 + **只提醒不自动改写**（fix.kind 恒为 paste、counts.autoFixable 恒为 0、无 /api/memory-audit/fix 路由）+ mac 白名单两处 + CRLF 纪律
  ['test-structured-error.js', 102],  // F2 第二期（渲染层结构化错误）+ A3（模型级冷却）：形状无关扫描（多字段容错/不误报/循环与深度安全）+ 合成观测「无信号时与 F2 之前逐字相同」+ CDP 表达式自包含且伪页面真跑（幂等/抗 adapter 重建/sink 不外抛/环上限）+ isUsableForFailover 第 4 参 modelId（不传零变化）+ pickFailoverTarget 透传 + 切片反向守卫 + mac 白名单
  ['test-usage-unified-credit.js', 52],  // 2026-09-23 统一用量看板积分口径：同 id 只计一次（含旧实现 3× 对照）+ 权威源 credit_usage_records 三维聚合 + 兜底去重 + 窗口过滤 + 看板模板占位符/转义/内联脚本可解析 + daemon queryCredit 接线与「分子分母同区间」守卫；同日补 F 组（会话排行标题装配）：来源标注不留空白 + 第三方已给标题**也要脱敏**（官方自动标题＝首条提问截断）+ 血缘接回原始 id（缺 sessionIndex 就接不回）+ 查不到留空计 unresolved 不编造 + 快照只收非空真标题
  ['test-session-titles.js', 18],  // 2026-09-23 会话排行标题多源解析（修「未命名会话」）：解析优先级不许乱序（db→血缘→快照→正文 aiTitle→客户端缓存→首条提问）+ 两套 id 桥接（副本 jsonl 文件名 ↔ 内容 sessionId 互为别名，正反双向）+ 脱敏（凭据/手机号一律打码，含官方标题）+ 纪律（查不到返回空不编造 / 快照只增不减 / root 缺失只砍正文桥接不抛）
];

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
  const m = summary.match(/(\d+)\s*pass\s*\/?\s*(\d+)?\s*fail/i)
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
