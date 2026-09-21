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
  ['test-idle-switchback.js', 122],
  ['test-switch-sync.js', 57],
  ['test-lineage-dedupe.js', 34],
  ['test-cloud-ghosts.js', 86],
  ['test-login-tip-i18n.js', 18],
  ['test-space-sort.js', 65],
  ['test-token-stats-attribution.js', 7],
  ['test-scheduled-send.js', 184],
  ['test-schedule-verify.js', 254],
  ['test-archive-isolation.js', 63],
  ['test-session-open.js', 87],   // v1.3.9/1.3.10：session.open 迷你 renderer 仿真；v1.3.13 加侧栏收起态
  ['test-copy-manifest.js', 96],  // v1.3.11：空间扫描 → 复制排队清单 → 排序；H4/H4b 拆开新鲜度口径
  ['test-send-verify.js', 81],    // v1.3.12 草稿核验 / 1.3.14 composerSendExpr / 1.3.15 草稿残留 / 1.3.16 busy 落定
  ['test-switch-settle.js', 42],  // v1.3.17 切号闸门：还原因定时任务切走的账号前，先等在飞的回合跑完
  ['test-autocopy-conflict-baseline.js', 35],  // v1.4.1 会话同步「假冲突 + 自锁」：血缘级 watermark 标尺 + 正文 mtime 收窄
  ['test-automations-guard.js', 41],  // v1.4.1 P0：读失败不得折成空集合（静默清空全部任务）+ 写侧骤减守卫 + 路由级兜底
  ['test-daemon-http.js', 22],  // v1.4.1 §9-3：HTTP 入口层（readBody 一定 settle / 有界 / 解析失败 reject）+ 鉴权契约
  ['test-usage-attribution-guard.js', 32],  // v1.4.1 §9-6：空间归属解析（裸前缀错归）+ 用量入库（NaN 拖垮整批）
  ['test-watchdog-backoff.js', 16],  // v1.4.1 §9-4：watchdog 退避复位判据（存活超 60s）+ 熔断
  ['test-failover-clock.js', 42],  // v1.4.1 §9-7：限流窗口绝对到期时刻 + 时钟回拨不可信 + 结构化「选不出账号」
  ['test-build-pin.js', 27],  // v1.4.1 §9-5：ws 钉版本（manifest+lock+npm ci）+ 真跑 vendoring 与内嵌 Python 块
  ['test-session-sync-124.js', 60],  // 上游 1.2.4 会话同步模块落地：五态判定 + 选主不猜 + applySnapshot 真写 + fixture/delta provenance 锁
  ['test-auto-copy-judge.js', 27],  // 方案 D/D0：judge 开关（默认 mtime ⇒ 零行为变化）+ 快照域切分 + 指纹 memo（命中零读盘）+ slim/writable 护栏
  ['test-auto-copy-leader.js', 57],  // 方案 D/D1+D1.5：内容定源判主偏序（repair 方向 + 分叉保留 + 不可读不放行）+ mtime 不参与定源 + alias 契约 + daemon 接线 + 打包白名单 + 面板文案
  ['test-auto-copy-content-write.js', 54],  // 方案 D/D2：content 模式改走 applySnapshot 事务写入（差异集 + 备份 + journal + 发布后复检）+ 目标多余文件清理 + 产物域不动 + 备份按 mtime 裁剪 + 默认 mtime 路径逐字节未变
  ['test-growth-tasks.js', 113],  // 成长任务「一键完成」：指纹派生稳定 + 桌面 6 连事件形状 + 四条 CN 通道 + 领奖主备降级 + accept 回读重试 + 档位门控（tier3 默认关）+ 行形状兼容 + 端到端自动领奖 + 面板/daemon 接线 + 全量中文文案 i18n 守卫
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
