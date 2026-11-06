/* probe-cov-why.js — 为什么 cov（IDF 加权覆盖率）把 gold 压到 5~236 名？
 *
 * 假说：
 *   H1 查询里含大量「虚词 bigram」（你说/那个/最后/怎么），它们在任何长文里都命中，
 *      反而让「长且泛」的段落拿高分 —— 分母 wSum 被虚词主导。
 *   H2 gold 是「结论型长文」，但用户问的是某个细节，细节词只在 gold 里出现 1 次，
 *      而噪声段落在标题里重复出现。
 *   H3 cov 只看「词是否出现」，不看次数与位置；长段落天然命中更多词。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const A = require('./all-cases.js');
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;

const CASES = ['CR01', 'NC08', 'CC06', 'TP09', 'CR04', 'NU13'];

for (const id of CASES) {
  const c = A.ALL.find((x) => x.id === id);
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const talk = db.prepare(`SELECT s.seq, s.text, t.score ${TAIL} WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
  const live = [];
  const dfCache = new Map();
  for (const p of parts) {
    const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
    if (n > 0) { live.push(p); dfCache.set(p, n); }
  }
  const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
  const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
  const w = new Map(live.map((p) => [p, idf(dfCache.get(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const rows = talk.all(live.map(esc).join(' OR '), c.sid);
  const scored = rows.map((r) => {
    const t = String(r.text || '');
    let got = 0;
    const hits = [];
    for (const p of live) if (t.indexOf(p) >= 0) { got += w.get(p); hits.push(p); }
    return { seq: r.seq, cov: got / wSum, hits, len: t.length, text: t };
  }).filter((x) => x.cov > 0).sort((a, b) => b.cov - a.cov);
  const goldIdx = scored.findIndex((x) => x.seq === c.gold[0]);
  const gold = scored[goldIdx];
  const top = scored[0];

  console.log('\n=== ' + id + ' ===  q: ' + c.q);
  console.log('  live bigram', live.length, '| wSum', wSum.toFixed(2));
  /* 每个查询词的 IDF 权重排序 —— 看虚词是否占大头 */
  const byW = [...w.entries()].sort((a, b) => b[1] - a[1]);
  console.log('  最高权重词:', byW.slice(0, 6).map(([p, v]) => `${p}(${v.toFixed(2)},df${dfCache.get(p)})`).join(' '));
  console.log('  最低权重词:', byW.slice(-6).map(([p, v]) => `${p}(${v.toFixed(2)},df${dfCache.get(p)})`).join(' '));

  console.log('  [TOP1 ] seq' + top.seq, 'cov=' + top.cov.toFixed(4), '| 命中', top.hits.length, '词 |', top.len, '字');
  console.log('         命中词:', top.hits.join(' '));
  console.log('         ', top.text.replace(/\s+/g, ' ').slice(0, 110));
  console.log('  [GOLD ] seq' + gold.seq, 'cov=' + gold.cov.toFixed(4), '| 命中', gold.hits.length, '词 |', gold.len, '字 | 排', goldIdx + 1);
  console.log('         命中词:', gold.hits.join(' '));
  console.log('         ', gold.text.replace(/\s+/g, ' ').slice(0, 110));

  /* 差异诊断：top 命中了哪些 gold 没命中的词？ */
  const miss = top.hits.filter((p) => !gold.hits.includes(p));
  const only = gold.hits.filter((p) => !top.hits.includes(p));
  console.log('  ⇒ TOP1 独有命中:', miss.join(' ') || '-');
  console.log('  ⇒ GOLD 独有命中:', only.join(' ') || '-');
}
