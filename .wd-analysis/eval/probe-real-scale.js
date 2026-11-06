/* 诊断十二：真实库的会话规模（只读，绝不写）
 *
 * 为什么必须看这个：
 *   @1=8/9 是在 3 个会话的副本库里测的。真实库如果是 100+ 会话，
 *   会话级路由的正确率会显著下降（正确会话 vs 最优错误会话的余量只有 p50=5.2）。
 *
 * ⚠️ readOnly 打开，不与 daemon 抢锁。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(process.env.APPDATA || '', 'WorkDaddy', 'ck-memory', 'ck.db');
if (!fs.existsSync(dbPath)) { console.log('库不存在：' + dbPath); process.exit(0); }

/* ⚠️ 不要复制 107MB 库；readOnly + WAL 只读模式足够 */
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return [{ err: e.message }]; } };

console.log('=== 真实库规模 ===');
console.log('  库大小 ' + (fs.statSync(dbPath).size / 1048576).toFixed(0) + 'MB');
for (const r of q('SELECT COUNT(*) c FROM sessions')) console.log('  sessions 表 = ' + r.c);
for (const r of q('SELECT COUNT(*) c FROM seg')) console.log('  原文行数 = ' + r.c);

const per = q('SELECT sid, COUNT(*) c, MIN(ts) a, MAX(ts) b FROM seg GROUP BY sid ORDER BY c DESC');
console.log('  实际有行的会话数 = ' + per.length);
console.log('\n  前 15 大会话：');
for (const r of per.slice(0, 15)) {
  const d1 = new Date(r.a).toISOString().slice(0, 10);
  const d2 = new Date(r.b).toISOString().slice(0, 10);
  console.log('    ' + String(r.sid).slice(0, 8) + ' 行=' + String(r.c).padStart(6) + '  ' + d1 + ' → ' + d2);
}
const sizes = per.map((r) => r.c).sort((a, b) => a - b);
console.log('\n  会话行数分布：min=' + sizes[0] + ' p25=' + sizes[Math.floor(sizes.length * 0.25)]
  + ' p50=' + sizes[Math.floor(sizes.length * 0.5)] + ' p75=' + sizes[Math.floor(sizes.length * 0.75)]
  + ' max=' + sizes[sizes.length - 1]);

/* 单会话检索 vs 全库检索：耗时会随会话数涨多少 */
console.log('\n=== 全库（不限 sid）检索耗时：会话数 3 → ' + per.length + ' 的代价 ===');
const stmts = {
  scoped: db.prepare(
    `SELECT s.sid, s.seq, t.score FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
       WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
      JOIN seg s ON s.id = t.rid
      WHERE s.kind IN ('user','assistant') AND COALESCE(s.pri,0)>=1 AND COALESCE(s.noise,0)=0
      ORDER BY t.score LIMIT 60`),
};
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const queries = [
  'HTTPS 证书什么时候到期 后果是什么',
  '回归测试最新一次的基线是多少个套件 多少项断言',
  '画册一共多少个产品 同型号组多少组',
  '网关三个账号扣积分的优先级规则',
  '模型注册表在哪个文件 会话启动时怎么读的',
];
/* 用库里的真实 bigram 拼查询（不依赖 ck-memory 的 bigram，避免加载模块时改到配置） */
function bigrams(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  const out = new Set();
  for (const chunk of t.split(' ')) {
    const c = chunk.trim();
    if (!c) continue;
    if (/^[\x00-\x7f]+$/.test(c)) { if (c.length >= 2) out.add(c.toLowerCase()); }
    else for (let i = 0; i + 2 <= c.length; i++) out.add(c.slice(i, i + 2));
  }
  return [...out].slice(0, 24);
}
let sum = 0, mx = 0, n = 0;
for (const s of queries) {
  const m = bigrams(s).map(esc).join(' OR ');
  if (!m) continue;
  const t0 = process.hrtime.bigint();
  const rows = stmts.scoped.all(m);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  sum += ms; mx = Math.max(mx, ms); n++;
  console.log('  ' + ms.toFixed(1) + 'ms  命中候选中跨 ' + new Set(rows.map((r) => r.sid)).size + ' 个会话  q=' + s.slice(0, 24));
}
console.log('  平均 ' + (sum / n).toFixed(1) + 'ms · 最大 ' + mx.toFixed(1) + 'ms');
db.close();
