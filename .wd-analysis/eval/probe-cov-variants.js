/* probe-cov-variants.js — 覆盖率公式变体的理论上限比较
 *
 * 核心问题：cov = Σ命中权重 / Σ全部权重，分母含「没命中的词」。
 *   这使「只命中核心词」的正确答案被系统性扣分。
 *
 * 对比变体（都在同一个 OR 候选池上，只换排序键）：
 *   V0 现状：cov（分母=全部权重）
 *   V1 Σ命中权重（不除分母）
 *   V2 Σ命中权重 / sqrt(len)   长度归一
 *   V3 cov^2 × Σ命中          —— 兼顾覆盖与绝对量
 *   V4 最高权重词是否命中（bool）+ 覆盖率的混合
 *   V5 bm25 原始分
 *   V6 bm25 × cov
 *   参考上界：gold 在候选池中的最优名次（即"只要排序对就能拿到"）
 *
 * ⚠️ 用 MRR@8 与 top5 命中率两个指标，不用 Recall@k（零和）。
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
  DF.set(p, n);
  return n;
}

const M = {};
for (const name of ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'ORACLE']) M[name] = { rr: 0, hit5: 0, hit8: 0, n: 0 };

for (const c of cases) {
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const maxW = Math.max(...w.values());
  const rows = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rows.length) continue;

  const scored = rows.map((r) => {
    const t = String(r.text || '');
    let got = 0, best = 0, cnt = 0;
    for (const p of live) {
      if (t.indexOf(p) >= 0) { got += w.get(p); cnt++; if (w.get(p) > best) best = w.get(p); }
    }
    const len = t.length;
    return {
      seq: r.seq,
      cov: got / wSum,
      got,
      gotDivSqrt: got / Math.sqrt(Math.max(len, 1)),
      covTimesGot: (got / wSum) * got,
      maxHit: got > 0 ? best / maxW : 0,   /* 最高权重词命中比例 */
      bm25: -Number(r.score),              /* bm25 越小越好，取负 */
      cnt,
      len,
    };
  });

  const rankOf = (keyFn) => {
    const arr = scored.slice().sort((a, b) => keyFn(b) - keyFn(a));
    const i = arr.findIndex((x) => c.gold.includes(x.seq));
    return i; /* -1 = 不在池 */
  };
  const keys = {
    V0: (x) => x.cov,
    V1: (x) => x.got,
    V2: (x) => x.gotDivSqrt,
    V3: (x) => x.covTimesGot,
    V4: (x) => x.maxHit * 0.5 + x.cov * 0.5,
    V5: (x) => x.bm25,
    V6: (x) => x.bm25 * x.cov,
    ORACLE: (x) => (c.gold.includes(x.seq) ? 1e9 : 0),
  };
  for (const [k, fn] of Object.entries(keys)) {
    const pos = rankOf(fn);
    M[k].n++;
    if (pos >= 0) {
      M[k].rr += 1 / (pos + 1);
      if (pos < 5) M[k].hit5++;
      if (pos < 8) M[k].hit8++;
    }
  }
}

console.log('候选池内排序变体对比（' + M.V0.n + ' 题，全部 gold 都在池中）\n');
console.log('变体'.padEnd(10), 'MRR'.padStart(8), 'top5'.padStart(9), 'top8'.padStart(9), ' 说明');
const DESC = {
  V0: 'cov（现状，分母=全部权重）',
  V1: 'Σ命中权重（不除分母）',
  V2: 'Σ命中/sqrt(len)',
  V3: 'cov × Σ命中',
  V4: '0.5×最高词命中率 + 0.5×cov',
  V5: 'bm25 原始分',
  V6: 'bm25 × cov',
  ORACLE: 'gold 全排第一（理论上界）',
};
const order = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'ORACLE'];
for (const k of order) {
  const m = M[k];
  console.log(
    k.padEnd(10),
    (m.rr / m.n * 100).toFixed(2).padStart(7) + '%',
    ((m.hit5 / m.n) * 100).toFixed(1).padStart(8) + '%',
    ((m.hit8 / m.n) * 100).toFixed(1).padStart(8) + '%',
    ' ' + DESC[k]
  );
}
