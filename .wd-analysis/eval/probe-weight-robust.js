/* probe-weight-robust.js — W2(不加权) > W1(idf) 这个结论稳不稳？
 *
 * 一个孤立的 p=0.013 不足以下改产品的结论。四项检验：
 *   ① 全题集 vs 只统计「变化过」的题，看改进是否集中
 *   ② 分类别（single/numeric/coref/temporal/cross/open）看是否某类独大
 *   ③ 按 gold 名次分层，看是「把第 2 名救成第 1」还是「把第 200 名拉到第 8」（后者是假象）
 *   ④ 换 df 口径的敏感性：用 idf 但把分母改成「行数+1」v.s.「行数」v.s. 平滑
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')");
const A = require('./all-cases.js');
const cases = A.ALL.filter((c) => (c.gold || []).length > 0);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const docDf = (p) => {
  try { const r = db.prepare('SELECT doc FROM temp.wd_vocab WHERE term = ?').get(String(p).toLowerCase()); return r ? Number(r.doc) : 0; }
  catch (_) { return 0; }
};
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const talk = db.prepare(`SELECT s.seq, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);

const IDFS = {
  idf_a: (d) => Math.log((total + 1) / (d + 1)) + 1,
  idf_b: (d) => Math.log(total / Math.max(1, d)),
  idf_c: (d) => Math.log((total + 1) / (d + 0.5)),
  idf_d: (d) => 1 / Math.sqrt(d + 1),
};
const KEYS = ['count1', ...Object.keys(IDFS)];
const rec = [];
for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;
  const r = { id: c.id, cat: c.cat, k, ranks: {} };
  for (const tag of KEYS) {
    const wf = tag === 'count1' ? (() => 1) : IDFS[tag];
    const w = new Map(live.map((x) => [x.p, wf(x.df)]));
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const docs = rs.map((x) => {
      const t = String(x.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { seq: x.seq, s: got / wSum, bm: Number(x.score) || 0 };
    }).sort((a, b) => b.s - a.s || a.bm - b.bm);
    const i = docs.findIndex((d) => c.gold.includes(d.seq));
    r.ranks[tag] = i + 1;
  }
  rec.push(r);
}
const rr = (r, tag) => (r.ranks[tag] <= r.k ? 1 / r.ranks[tag] : 0);
const mrr = (sub, tag) => sub.reduce((s, r) => s + rr(r, tag), 0) / (sub.length || 1) * 100;

console.log('① 全集 vs 变化子集（n=' + rec.length + '）');
const changed = rec.filter((r) => r.ranks.count1 !== r.ranks.idf_a);
console.log('   全集      count1=' + mrr(rec, 'count1').toFixed(2) + '%  idf_a=' + mrr(rec, 'idf_a').toFixed(2) + '%');
console.log('   变化子集  count1=' + mrr(changed, 'count1').toFixed(2) + '%  idf_a=' + mrr(changed, 'idf_a').toFixed(2) + '%  (n=' + changed.length + ')');
console.log('   count1 更好 ' + changed.filter((r) => rr(r, 'count1') > rr(r, 'idf_a')).length +
  ' / 更差 ' + changed.filter((r) => rr(r, 'count1') < rr(r, 'idf_a')).length);

console.log('\n② 分类别');
const cats = [...new Set(rec.map((r) => r.cat))];
for (const cc of cats) {
  const sub = rec.filter((r) => r.cat === cc);
  const a = mrr(sub, 'count1'), b = mrr(sub, 'idf_a');
  console.log('   ' + cc.padEnd(10), 'n=' + String(sub.length).padStart(3),
    'count1=' + a.toFixed(1) + '%  idf=' + b.toFixed(1) + '%  Δ=' + ((a - b) >= 0 ? '+' : '') + (a - b).toFixed(1) + 'pp');
}

console.log('\n③ 按 idf_a 名次分层（看改进是救前排还是拉后排）');
const layers = [[1, 1], [2, 4], [5, 8], [9, 30], [31, 1e9]];
for (const [lo, hi] of layers) {
  const sub = rec.filter((r) => r.ranks.idf_a >= lo && r.ranks.idf_a <= hi);
  if (!sub.length) continue;
  const a = mrr(sub, 'count1'), b = mrr(sub, 'idf_a');
  console.log('   idf 名次 ' + String(lo + (hi > 1e8 ? '+' : '~' + hi)).padEnd(7),
    'n=' + String(sub.length).padStart(3), 'count1=' + a.toFixed(1) + '%  idf=' + b.toFixed(1) + '%  Δ=' + ((a - b) >= 0 ? '+' : '') + (a - b).toFixed(1) + 'pp');
}

console.log('\n④ idf 变体敏感性');
for (const tag of KEYS) {
  console.log('   ' + tag.padEnd(8), mrr(rec, tag).toFixed(2) + '%');
}
