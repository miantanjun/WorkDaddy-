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
  ['test-scheduled-send.js', 184],
  ['test-schedule-verify.js', 254],
  ['test-archive-isolation.js', 63],
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
  ['test-session-sync-124.js', 65],  // 上游 1.2.5 会话同步重定基：五态判定 + 选主不猜 + applySnapshot 真写 + fixture/delta provenance 锁（锚 1.2.5）+ 上限取消/惰性读守卫 + readSessionSizes
  ['test-auto-copy-judge.js', 27],  // 方案 D/D0：judge 开关（默认 mtime ⇒ 零行为变化）+ 快照域切分 + 指纹 memo（命中零读盘）+ slim/writable 护栏
  ['test-auto-copy-leader.js', 67],  // 方案 D/D1+D1.5：内容定源判主偏序 + mtime 不参与定源 + alias 契约 + daemon 接线 + 打包白名单 + 面板文案；2026-09-21 冲突文案抽共用 helper 后 +2（I4 两处共用 / I5 conflict 分支）
  ['test-auto-copy-content-write.js', 54],  // 方案 D/D2：content 模式改走 applySnapshot 事务写入（差异集 + 备份 + journal + 发布后复检）+ 目标多余文件清理 + 产物域不动 + 备份按 mtime 裁剪 + 默认 mtime 路径逐字节未变
  ['test-session-sync-cache-a3.js', 41],  // 上游 1.2.5 吸纳/A3：文件级指纹缓存（命中零 readFileSync / 结论等价 / 同长度改写必失效 / 排除域不污染）+ judge/leader 第 4 参透传 + daemon 接线 + 缓存本体去抖落盘与脏条目剔除
  ['test-growth-tasks.js', 113],  // 成长任务「一键完成」：指纹派生稳定 + 桌面 6 连事件形状 + 四条 CN 通道 + 领奖主备降级 + accept 回读重试 + 档位门控（tier3 默认关）+ 行形状兼容 + 端到端自动领奖 + 面板/daemon 接线 + 全量中文文案 i18n 守卫
  ['test-automation-protocol-v3.js', 111],  // 上游 1.2.5 吸纳/B 组协议 V3：校验负向门（V1/V2 拒 prepare、prepare 只读白名单、condition 形状）+ prepare/condition 真跑语义（切换前执行 / 跳过不切不跑 / 收尾还原不受影响）+ orderCheckinAccounts 稳定排序 + B4 闸门有界可取消 + A9 失败屏障 + A11 409 + 接线静态守卫（含「不搬上游 job.completion / waitAutomationSyncJob」的反向守卫）
  ['test-upstream-125-step4-panel.js', 98],  // 上游 1.2.5 吸纳/Step 4：A7 作业指标（真跑切片函数 + 速率口径）+ A8 大会话提示 + A7/A8 面板文案整句入典（含重复 key 去重守卫）+ A10 会话体积/总量口径（总量不受筛选）+ 体积筛选字节精确
  ['test-account-health.js', 138],  // v1.4.5 F2：13 层分类顺序（含两条反向对照）+ 三条迁移纪律（不加深 / 取更远者 / 硬不降级）+ A5 分级排除 + A8 双状态位与幂等 + daemon 端点与切片反向守卫 + 面板徽标/i18n/CSS + mac 白名单
  ['test-failover-manual.js', 62],  // F5：手动「换号并续跑」入口 —— markBlocked 三态（缺省零变化 / false 不写限流窗口）+ ports 装配与 core 分居两处（含模块级名字打错的静态守卫）+ 手动路由两个前置刻意不要求且立即 202 + status 透出不带正文 + 面板整句词条与 data-wbs-i18n-skip（数据不被当文案翻）
  ['test-context-audit.js', 59],  // 省 token 吸纳：上下文体检（记忆/skill 体积 + 会话成本形状）—— frontmatter 块标量 / 阈值分级 / 目录树行数真数 / 副本行去重 / sessionRoot 默认值回归（第一版传 home 导致会话维度静默全零）+ daemon 路由只读性静态守卫
  ['test-context-fix.js', 60],  // 省 token 吸纳（执行侧）：context-fix 只移动不删除 + 认 installed_plugins.json 保留激活版本（不靠目录名猜）+ dryRun 不碰盘 + 幂等 + 未知 fixId 拒绝 + daemon fix 路由只收 fixId 不收路径 + 面板折叠化与体检按钮接线 + B1 交接摘要（buildHandoff 纯函数 + GET /api/handoff 只读）
  ['test-memory-governance.js', 106],  // B2 记忆治理巡检：三层分层判据（云端/用户级/工作区/日档）+ 四类错层假阳性必须被排掉（中缀路径 / HTTP 路由 / 通配 / `..`）+ 死指针只认反引号路径且排占位符 + **只提醒不自动改写**（fix.kind 恒为 paste、counts.autoFixable 恒为 0、无 /api/memory-audit/fix 路由）+ mac 白名单两处 + CRLF 纪律
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
