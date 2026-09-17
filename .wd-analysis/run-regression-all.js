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
  ['test-space-scan.js', 55],
  ['test-space-ui.js', 70],
  ['test-limit-failover.js', 47],
  ['test-limit-switchback.js', 138],
  ['test-idle-switchback.js', 122],
  ['test-switch-sync.js', 57],
  ['test-lineage-dedupe.js', 34],
  ['test-cloud-ghosts.js', 86],
  ['test-login-tip-i18n.js', 14],
  ['test-space-sort.js', 65],
  ['test-token-stats-attribution.js', 7],
  ['test-scheduled-send.js', 184],
  ['test-schedule-verify.js', 254],
  ['test-archive-isolation.js', 63],
  ['test-session-open.js', 70],   // v1.3.9/1.3.10：session.open 迷你 renderer 仿真
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
