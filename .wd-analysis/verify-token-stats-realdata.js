'use strict';
// 用真实数据验证修复：完全复刻 /api/token-stats 的调用方式（含全部会话的归属映射）
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ts = require(path.join(__dirname, '..', 'scripts', 'token-stats.js'));

const ROOT = 'C:\\Users\\Lyon\\.workbuddy';
const db = new DatabaseSync(path.join(ROOT, 'workbuddy.db'));
const rows = db.prepare('SELECT id, user_id FROM sessions;').all();  // 修复后的口径：含已删除
db.close();
const sessionAccounts = Object.fromEntries(rows
  .map((r) => [String(r.id || ''), String(r.user_id || '')])
  .filter((x) => x[0] && x[1]));

const NAMES = { '028cbdf0': '177', '827977d7': '18688296454', '1d80c722': '面瘫君' };
const nm = (u) => { if (!u) return '(空/未归属)'; const k = u.slice(0, 8); return (NAMES[k] || k) + ' [' + k + ']'; };

const accounts = [
  { uid: '028cbdf0-a0b5-4b45-ad68-8681d5314736', nickname: '177' },
  { uid: '827977d7-6e2f-4a6f-9d0f-000000000000', nickname: '' },
];

const out = [];
const log = (...a) => out.push(a.join(' '));

for (const days of [1, 7]) {
  const stats = ts.scanTokenStatsCached(ROOT, { days, accountOptions: [], sessionAccounts });
  log('==========================================================');
  log(`days=${days}  totals=${JSON.stringify(stats.totals)}`);
  log('  -- 账号维度 --');
  for (const a of stats.accounts) {
    log(`     ${nm(a.account).padEnd(26)} in=${String(a.input).padEnd(11)} out=${String(a.output).padEnd(8)} calls=${a.calls}`);
  }
  log('  -- 模型维度（前 6）--');
  for (const m of stats.models.slice(0, 6)) {
    log(`     ${String(m.model).padEnd(26)} in=${String(m.input).padEnd(11)} out=${String(m.output).padEnd(8)} calls=${m.calls}`);
  }
  log('');
}

log('=== 关键：177 账号 + deepseek 过滤 ===');
const only177 = ts.scanTokenStatsCached(ROOT, {
  days: 1, account: '028cbdf0-a0b5-4b45-ad68-8681d5314736', sessionAccounts,
});
log('  177 全部：' + JSON.stringify(only177.totals));
log('  177 模型维度：' + JSON.stringify(only177.models.map((m) => m.model + ':' + m.input + '/' + m.calls)));

fs.writeFileSync(path.join(__dirname, 'verify-realdata.out.txt'), out.join('\n') + '\n', 'utf8');
process.stdout.write('ok\n');
