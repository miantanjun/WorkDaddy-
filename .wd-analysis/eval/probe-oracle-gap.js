/* probe-oracle-gap.js — 51.55% → 99.08% 的差距来自哪里？
 *
 * 已知：gold 全在池中（ORACLE 99.08%），稀有度加权调不动（全部 ~51.5%）。
 * 所以瓶颈是「排序键的判别力不足」，不是权重设计。
 *
 * 逐个特征测「单特征的金标准可分性」：
 *   对每题算 gold 与该特征 TOP1 的关系，用 AUC（gold vs 非 gold）衡量。
 *   AUC ≈ 0.5 表示该特征完全无法区分 gold；1.0 表示完美。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const A = require('./all-cases.js');
const cases = A.ALL.filter((c) => (c.gold || []).length > 0);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const talk = db.prepare(`SELECT s.id, s.seq, s.pri, s.ts, s.text, t.score ${TAIL} WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}

/* 特征集合 */
const FEATS = {
  bm25_neg: (x) => -x.score,
  sumIdf: (x) => x.sumIdf,
  hitCount: (x) => x.cnt,
  maxIdf: (x) => x.maxIdf,
  len: (x) => x.len,
  lenInv: (x) => -x.len,
  segLen: (x) => x.len,           /* 同 len，保留给对照 */
  pri: (x) => x.pri,
  fresh: (x) => x.ts,
  bm25PerLen: (x) => -x.score / Math.max(x.len, 1),
  bm25PerSqrtLen: (x) => -x.score / Math.sqrt(Math.max(x.len, 1)),
  hitDensity: (x) => x.cnt / Math.max(x.len, 1),
  /* 「命中词在文本中的最靠前位置」—— 关键词早出现通常更相关 */
  firstHitPos: (x) => -x.firstPos,
  /* 「唯一命中」：只被这一个候选命中的稀有词数 */
  rareOnly: (x) => x.rareOnly,
};

const acc = {};
for (const k of Object.keys(FEATS)) acc[k] = { auc: 0, pairs: 0, ns: 0 };

for (const c of cases) {
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const rows = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rows.length) continue;
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  /* 每个词的「在本会话内出现次数」—— 只在少数候选出现的词更稀有 */
  const inSession = new Map();
  for (const p of live) {
    let n = 0;
    for (const r of rows) if (String(r.text || '').indexOf(p) >= 0) n++;
    inSession.set(p, n);
  }

  const scored = rows.map((r) => {
    const t = String(r.text || '');
    let sumIdf = 0, maxIdf = 0, cnt = 0, firstPos = 1e9, rareOnly = 0;
    for (const p of live) {
      const i = t.indexOf(p);
      if (i >= 0) {
        const v = w.get(p);
        sumIdf += v; cnt++;
        if (v > maxIdf) maxIdf = v;
        if (i < firstPos) firstPos = i;
        if (inSession.get(p) === 1) rareOnly++;
      }
    }
    return {
      seq: r.seq, score: Number(r.score), sumIdf, maxIdf, cnt, len: t.length,
      pri: Number(r.pri) || 0, ts: Number(r.ts) || 0, firstPos: firstPos === 1e9 ? 1e6 : firstPos, rareOnly,
    };
  });

  const goldSet = new Set(c.gold);
  const g = scored.filter((x) => goldSet.has(x.seq));
  const n = scored.filter((x) => !goldSet.has(x.seq));
  if (!g.length || !n.length) { console.log("  SKIP", c.id, "g="+g.length, "n="+n.length); continue; }

  for (const [k, fn] of Object.entries(FEATS)) {
    /* AUC：随机取一 gold、一非 gold，gold 特征更大的概率 */
    let wins = 0, ties = 0;
    for (const a of g) for (const b of n) {
      const va = fn(a), vb = fn(b);
      if (va > vb) wins++; else if (va === vb) ties++;
    }
    acc[k].auc += (wins + 0.5 * ties) / (g.length * n.length);
    acc[k].ns++;
  }
}

console.log('单特征对 gold 的判别力（AUC，0.5=无效，1.0=完美）\n');
const sorted = Object.entries(acc).map(([k, v]) => [k, v.auc / v.ns]).sort((a, b) => b[1] - a[1]);
console.log('特征'.padEnd(18), 'AUC'.padStart(7), '  偏离0.5');
for (const [k, v] of sorted) {
  const dev = v - 0.5;
  const bar = '█'.repeat(Math.round(Math.abs(dev) * 60));
  console.log(k.padEnd(18), v.toFixed(4).padStart(7), ' ', (dev >= 0 ? '+' : '') + dev.toFixed(4), bar);
}
console.log('\n题数', acc.bm25_neg.ns);
