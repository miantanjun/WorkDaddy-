/* probe-cov-v2.js — 真正的问题在哪：linear Σ vs 稀有词聚焦
 *
 * 上一版结论：cov 分母是常数 ⇒ V0/V1/V3 排序等价，分母无罪。
 * 真问题：Σ(命中词 IDF) 是**线性求和**，命中 5 个泛词（各 10.46）> 命中 1 个核心词（10.75）。
 *   而 IDF 在 df=1..3 区间只差 6.6% ⇒ 泛词的"多命中"完全压过核心词的"稀有性"。
 *
 * 变体（全部在 OR 池内排序）：
 *   W0 线性 Σ（现状）
 *   W1 Σ(idf - minIdf)        —— 减去公共基线，把"多命中"的边际收益降到只与稀有度有关
 *   W2 Σ(idf^2)               —— 平方放大稀有度
 *   W3 Σ(idf^3)
 *   W4 max(命中词的 idf)       —— 只看最稀有的命中词
 *   W5 max + 0.3×Σ            —— 混合
 *   W6 Σ(exp(idf - maxIdf))   —— 指数聚焦最稀有
 *   W7 Σ(1/df)                —— 直接按稀有度反比，绕开 idf 的压缩
 *   W8 maxHit 权重 × (1 + 0.2×命中数)
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
const talk = db.prepare(`SELECT s.id, s.seq, s.text, t.score ${TAIL} WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}

const NAMES = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'];
const M = {};
for (const n of NAMES) M[n] = { rr: 0, hit5: 0, hit8: 0, n: 0 };

for (const c of cases) {
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const rows = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rows.length) continue;
  /* 每次查询内部先算各词的 idf，再归一化成相对稀有度 */
  const idfs = live.map((p) => idf(dfOf(p)));
  const minI = Math.min(...idfs), maxI = Math.max(...idfs);
  const w = new Map(live.map((p, i) => [p, idfs[i]]));

  const scored = rows.map((r) => {
    const t = String(r.text || '');
    const hitIdf = [];
    for (const p of live) if (t.indexOf(p) >= 0) hitIdf.push(w.get(p));
    const sum = hitIdf.reduce((a, b) => a + b, 0);
    const max = hitIdf.length ? Math.max(...hitIdf) : 0;
    const cnt = hitIdf.length;
    return { seq: r.seq, hitIdf, sum, max, cnt, minI, maxI };
  });

  const K = {
    W0: (x) => x.sum,
    W1: (x) => x.hitIdf.reduce((a, b) => a + (b - x.minI), 0),
    W2: (x) => x.hitIdf.reduce((a, b) => a + b * b, 0),
    W3: (x) => x.hitIdf.reduce((a, b) => a + b * b * b, 0),
    W4: (x) => x.max,
    W5: (x) => x.max + 0.3 * x.sum,
    W6: (x) => x.hitIdf.reduce((a, b) => a + Math.exp((b - x.maxI) * 3), 0),
    W7: (x) => x.hitIdf.reduce((a, b) => a + 1 / (dfOf_local(b, live, w)), 0),
    W8: (x) => x.max * (1 + 0.2 * x.cnt),
  };
  /* W7 需要 df，用反查：建立 idf→df 映射 */
  const i2d = new Map(live.map((p) => [w.get(p), dfOf(p)]));
  function dfOf_local(v) { return i2d.get(v) || 1; }

  for (const n of NAMES) {
    const fn = K[n];
    const arr = scored.slice().sort((a, b) => fn(b) - fn(a));
    const i = arr.findIndex((x) => c.gold.includes(x.seq));
    M[n].n++;
    if (i >= 0) { M[n].rr += 1 / (i + 1); if (i < 5) M[n].hit5++; if (i < 8) M[n].hit8++; }
  }
}

console.log('OR 池内排序：稀有度聚焦变体（' + M.W0.n + ' 题）\n');
console.log('变体'.padEnd(6), 'MRR'.padStart(8), 'top5'.padStart(8), 'top8'.padStart(8), ' 说明');
const D = {
  W0: 'Σ idf（现状）',
  W1: 'Σ(idf - minIdf) 去基线',
  W2: 'Σ idf²',
  W3: 'Σ idf³',
  W4: 'max(idf) 只看最稀有',
  W5: 'max + 0.3Σ',
  W6: 'Σ exp(3(idf-max))',
  W7: 'Σ 1/df',
  W8: 'max × (1+0.2×n)',
};
for (const n of NAMES) {
  const m = M[n];
  console.log(n.padEnd(6), (m.rr / m.n * 100).toFixed(2).padStart(7) + '%', ((m.hit5 / m.n) * 100).toFixed(1).padStart(7) + '%', ((m.hit8 / m.n) * 100).toFixed(1).padStart(7) + '%', ' ' + D[n]);
}
