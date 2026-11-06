/* probe-df-caliber.js — df 口径核对：探针里的 COUNT(DISTINCT sid) vs 产品的 temp.wd_vocab.doc
 *
 * ⚠️⚠️ 之前所有探针都写 `SELECT COUNT(DISTINCT s.sid) ... MATCH ?`，而产品 termDf 读的是
 *   FTS5 的 `doc` 列（**文档数 = 行数**）。前者在本库最多返回 3（只有 3 个会话），
 *   后者最大 51393。两者相差 4 个数量级 ⇒ 所有基于 df 的诊断（idf 权重、稀有词、cov 分母）
 *   口径全是错的。
 *
 * 这条要验证：① doc 列确实存在且量级正确；② 两者在同一批 bigram 上的比值分布；
 *   ③ 换回正确 df 后，cov 的排序是否变化（MRR 有没有实质差异）。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const A = require('./all-cases.js');
const cases = A.ALL.filter((c) => (c.gold || []).length > 0);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;

/* ⚠️ 临时表是**连接级**的，open() 里 _vocabReady 是模块级标志，但建表必须在同一连接上执行。
   termDf 内部不建表（只在 ensureVocab 之后才可用），所以这里要显式建。 */
try { db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')"); } catch (e) { console.log('建表失败:', e.message); }
let vocabOk = true;
try { const r = db.prepare('SELECT doc FROM temp.wd_vocab LIMIT 1').get(); console.log('样例 vocab 行:', JSON.stringify(r)); } catch (e) { vocabOk = false; }
console.log('temp.wd_vocab 可用:', vocabOk);

const vocabDf = (p) => {
  try { const r = db.prepare('SELECT doc FROM temp.wd_vocab WHERE term = ?').get(String(p).toLowerCase()); return r ? Number(r.doc) : 0; }
  catch (_) { return -1; }
};
const distinctSidDf = (p) =>
  db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
const rowDf = (p) =>
  db.prepare('SELECT COUNT(*) c FROM seg_fts f WHERE seg_fts MATCH ?').get(esc(p)).c;

const allParts = new Set();
for (const c of cases) for (const p of ck.bigram(c.q).split(/\s+/).filter(Boolean)) allParts.add(p);
console.log('待核 bigram 数:', allParts.size, '| 全库行数:', total);

let nz = 0, sumRatio = 0, mismatch = 0;
const samples = [];
for (const p of allParts) {
  const v = vocabDf(p), d = distinctSidDf(p), r = rowDf(p);
  if (v > 0) nz++;
  if (v !== r) mismatch++;
  if (d > 0) { sumRatio += r / d; samples.push({ p, v, d, r }); }
}
console.log('vocab doc>0 的同数:', nz, '/', allParts.size);
console.log('vocab.doc 与真实行数不一致的:', mismatch, '/', allParts.size);
console.log('行数/会话数 平均比值:', (sumRatio / samples.length).toFixed(1));

console.log('\n抽样对照（term | vocab.doc | distinct sid | 真实行数）:');
for (const s of samples.sort((a, b) => b.r - a.r).slice(0, 8)) {
  console.log(' ', s.p.padEnd(10), String(s.v).padStart(7), String(s.d).padStart(10), String(s.r).padStart(10));
}
for (const s of samples.sort((a, b) => a.r - b.r).slice(0, 6)) {
  console.log(' ', s.p.padEnd(10), String(s.v).padStart(7), String(s.d).padStart(10), String(s.r).padStart(10));
}

/* 换正确 df 后重算 cov 排序 */
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const talk = db.prepare(`SELECT s.seq, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
ck._internal.invalidateDfCache && ck._internal.invalidateDfCache();

const M = { wrong: 0, right: 0, product: 0 };
let n = 0;
for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const wWrong = new Map(), wRight = new Map();
  let any = false;
  for (const p of parts) {
    const d = vocabDf(p);
    if (d > 0) { any = true; wWrong.set(p, Math.log((total + 1) / (distinctSidDf(p) + 1)) + 1); wRight.set(p, Math.log((total + 1) / (d + 1)) + 1); }
  }
  if (!any) continue;
  const rs = talk.all(parts.filter((p) => wRight.has(p)).map(esc).join(' OR '), c.sid);
  if (!rs.length) continue;
  const gi = rs.findIndex((r) => c.gold.includes(r.seq));
  if (gi < 0) continue;
  n++;
  for (const [tag, w] of [['wrong', wWrong], ['right', wRight]]) {
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const docs = rs.map((r) => {
      const t = String(r.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { seq: r.seq, cov: got / wSum, score: Number(r.score) || 0 };
    }).sort((a, b) => b.cov - a.cov || a.score - b.score);
    const idx = docs.findIndex((d) => c.gold.includes(d.seq));
    const rk = idx + 1;
    M[tag] += rk <= k ? 1 / rk : 0;
  }
  const res = ck._internal.search(db, c.sid, c.q, k);
  const hits = (res && res.hits) || [];
  const hr = hits.findIndex((h) => c.gold.includes(h.seq));
  M.product += hr >= 0 && hr < k ? 1 / (hr + 1) : 0;
}
console.log('\n口径影响（' + n + ' 题）：');
console.log('  df=会话数（错）   MRR=' + (M.wrong / n * 100).toFixed(2) + '%');
console.log('  df=行数（正确）   MRR=' + (M.right / n * 100).toFixed(2) + '%');
console.log('  产品 search()     MRR=' + (M.product / n * 100).toFixed(2) + '%');
console.log('  ⇒ 口径差', ((M.right - M.wrong) / n * 100).toFixed(2), 'pp');
