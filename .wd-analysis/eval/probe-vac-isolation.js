/* 诊断四：配对负例 0/9 到底是「拒答能力缺失」还是「会话隔离失效」？
 *
 * 这两个是完全不同的缺陷，修法相反：
 *   · 会话隔离失效 ⇒ 返回了**别的会话**的内容 ⇒ 严重 bug，必须修
 *   · 拒答能力缺失 ⇒ 返回了**本会话**的相关但无结论内容 ⇒ 是「能力边界」，不是 bug
 *
 * 判据：逐条检查 hits 的 sid 是否等于题目 sid（产品 search 内部已按 sid 过滤，
 *       所以这里要验证的是「过滤真的生效了」以及「跨会话泄漏是否为 0」）。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const neg = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const db = ck._internal.open();

/* ⚠️ search() 返回的 hit 不含 id，只有 seq —— 用 sid+seq 反查（同会话内 seq 唯一） */
const bySeq = db.prepare('SELECT sid, seq, pri, kind FROM seg WHERE sid = ? AND seq = ?');

console.log('=== 逐条核查：返回的内容是不是都在本会话内 ===');
let leak = 0;
for (const c of neg) {
  const r = ck._internal.search(c.sid, c.q, c.k);
  const hits = r.hits || [];
  const sids = new Set();
  for (const h of hits) {
    const row = bySeq.get(c.sid, h.seq);
    if (row) sids.add(row.sid);
  }
  const outside = [...sids].filter((s) => s !== c.sid);
  if (outside.length) leak++;
  console.log('  ' + c.id.padEnd(5) + ' n=' + hits.length
    + ' 涉及的 sid 数=' + sids.size
    + (outside.length ? '  ⛔ 跨会话泄漏 ' + outside.length : '  ✅ 全在本会话内'));
  console.log('        题 sid=' + c.sid.slice(0, 8) + '  返回 sid=' + [...sids].map((s) => s.slice(0, 8)).join(','));
}

console.log('\n跨会话泄漏题数：' + leak + '/' + neg.length + ' ⇒ '
  + (leak === 0 ? '✅ 会话隔离有效，0/9 不是隔离缺陷' : '⛔ 存在隔离缺陷'));

/* 第二批：这 9 条题的主题词，在【本会话全文（含 pri=0 过程话）】里到底有没有答案段落？
 * 用「同一段里同时出现 ≥3 个查询词」当「有实质答案」的近似判据。 */
console.log('\n=== 本会话（含过程话）里有没有「同时覆盖多词」的段落 ===');
const st = db.prepare(
  "SELECT id, seq, pri, text FROM seg WHERE sid = ? AND kind IN ('user','assistant') AND COALESCE(noise,0)=0"
);
for (const c of neg) {
  const parts = [...new Set(String(ck.bigram(c.q)).split(/\s+/).filter(Boolean))];
  const rows = st.all(c.sid);
  let best = 0, bestRow = null;
  for (const r of rows) {
    const t = String(r.text || '');
    let got = 0;
    for (const p of parts) if (t.indexOf(p) >= 0) got++;
    if (got > best) { best = got; bestRow = r; }
  }
  console.log('  ' + c.id.padEnd(5) + ' 查询词=' + String(parts.length).padStart(2)
    + ' 本会话最佳段落覆盖 ' + best + ' 词 (pri=' + (bestRow ? bestRow.pri : '-') + ')'
    + (best >= 3 ? '  ← 有实质相关段' : '  ← 无实质相关段'));
  if (bestRow) console.log('        ' + String(bestRow.text || '').replace(/\s+/g, ' ').slice(0, 100));
}
