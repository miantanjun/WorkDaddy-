/* probe-lenbias.js — cov 的长度偏置：长文档只要「碰到」查询词就满分，哪怕 95% 无关
 *
 * 已知：TOP1 平均 1858 字 > gold 平均 1422 字；cov 只奖励命中、不惩罚冗余（无 tf、无长度归一）。
 * 测：
 *   L0 现状：cov desc → bm25 asc
 *   L1 BM25 式长度归一：cov / (1 - b + b*len/avgLen)，b 取 0.75 / 0.5 / 0.3
 *   L2 硬折减：cov - λ*log2(len/512)，λ 取 0.02 / 0.05 / 0.10
 *   L3 覆盖率 × 密度：cov * (nhit / (span/len + 1))
 * ⚠️ 必须同时报全量 MRR + 配对 Wilcoxon；只看名次 9+ 那 32 题会过拟合。
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
const talk = db.prepare(`SELECT s.id, s.seq, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}
function minSpan(text, parts) {
  const occ = [];
  for (let i = 0; i < parts.length; i++) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(parts[i], from);
      if (at < 0) break;
      occ.push([at, i]); from = at + 1;
      if (occ.length > 3000) break;
    }
  }
  if (!occ.length) return Infinity;
  occ.sort((a, b) => a[0] - b[0]);
  const cnt = new Map(); let best = Infinity, left = 0;
  for (let right = 0; right < occ.length; right++) {
    const gi = occ[right][1];
    cnt.set(gi, (cnt.get(gi) || 0) + 1);
    while (cnt.size === parts.length) {
      best = Math.min(best, occ[right][0] - occ[left][0]);
      const g2 = occ[left][1], c2 = cnt.get(g2) - 1;
      cnt.set(g2, c2); if (!c2) cnt.delete(g2);
      left++;
    }
  }
  return best;
}

const KEYS = [];
/* ⚠️ 必须用 toFixed 拼键：`'L2_l' + 0.10` 在 JS 里是 "L2_l0.1"（尾零被吃掉），
   与 fns 里手写的 'L2_l0.10' 对不上 ⇒ fn 为 undefined ⇒ 排序直接崩。
   这类「字符串键静默失配」和之前 v.ns→v.n 导致 NaN 是同一类错。 */
for (const b of [0.75, 0.5, 0.3]) KEYS.push('L1_b' + b.toFixed(2));
for (const l of [0.02, 0.05, 0.10]) KEYS.push('L2_l' + l.toFixed(2));
KEYS.push('L3_dens');
KEYS.unshift('L0');
const MRR = {}, HIT = {}, PER = {};
for (const k of KEYS) { MRR[k] = 0; HIT[k] = 0; PER[k] = []; }

let n = 0, sumLen = 0, sumLen2 = 0;
const data = [];
for (const c of cases) {
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rs.length) continue;
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const docs = [];
  for (const r of rs) {
    const t = String(r.text || '');
    let got = 0; const hp = [];
    for (const p of live) if (t.indexOf(p) >= 0) { got += w.get(p); hp.push(p); }
    if (got <= 0) continue;
    docs.push({ seq: r.seq, cov: got / wSum, score: Number(r.score) || 0, len: t.length, nh: hp.length,
      span: hp.length ? minSpan(t, hp) : 1e9 });
  }
  if (!docs.length) continue;
  if (docs.findIndex((d) => c.gold.includes(d.seq)) < 0) continue;
  n++;
  for (const d of docs) { sumLen += d.len; sumLen2++; }
  data.push({ c, docs });
}
const avgLen = sumLen / sumLen2;
console.log('题数', n, '| 候选平均长度', avgLen.toFixed(0), '字\n');

for (const { c, docs } of data) {
  const k = c.k || 8;
  const sortedBy = (fn) => {
    const s = docs.slice().sort((a, b) => fn(b) - fn(a) || a.score - b.score);
    const i = s.findIndex((d) => c.gold.includes(d.seq));
    return i < 0 ? 1e9 : i + 1;
  };
  const fns = {
    L0: (d) => d.cov,
    'L1_b0.75': (d) => d.cov / (1 - 0.75 + 0.75 * d.len / avgLen),
    'L1_b0.50': (d) => d.cov / (1 - 0.5 + 0.5 * d.len / avgLen),
    'L1_b0.30': (d) => d.cov / (1 - 0.3 + 0.3 * d.len / avgLen),
    'L2_l0.02': (d) => d.cov - 0.02 * Math.log2(Math.max(1, d.len) / 512),
    'L2_l0.05': (d) => d.cov - 0.05 * Math.log2(Math.max(1, d.len) / 512),
    'L2_l0.10': (d) => d.cov - 0.10 * Math.log2(Math.max(1, d.len) / 512),
    L3_dens: (d) => d.cov * (d.nh / (Math.max(1, d.span) / Math.max(1, d.len) + 1)),
  };
  for (const kk of KEYS) {
    const r = sortedBy(fns[kk]);
    const rr = r <= k ? 1 / r : 0;
    MRR[kk] += rr; if (r <= 8) HIT[kk]++; PER[kk].push(rr);
  }
}

console.log('键               MRR      HIT@8    vs L0');
const base = MRR.L0 / n * 100;
for (const kk of KEYS) {
  const m = MRR[kk] / n * 100;
  const d = m - base;
  console.log(kk.padEnd(12), m.toFixed(2) + '%', '  ' + String(HIT[kk]).padStart(3) + '/108',
    '  ' + (d >= 0 ? '+' : '') + d.toFixed(2) + 'pp');
}

function normCdf2(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const pr = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - pr : pr;
}
function wil(a, b) {
  const d = [];
  for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; if (Math.abs(x) > 1e-12) d.push(x); }
  const N = d.length;
  if (N < 3) return { n: N, p: 1 };
  const ab = d.map(Math.abs).sort((x, y) => x - y);
  let Wp = 0;
  for (const x of d) {
    const ax = Math.abs(x);
    const i = ab.findIndex((v) => Math.abs(v - ax) < 1e-12);
    let j = i;
    while (j + 1 < ab.length && Math.abs(ab[j + 1] - ax) < 1e-12) j++;
    const rk = (i + j) / 2 + 1;
    if (x > 0) Wp += rk;
  }
  /* ⚠️⚠️ 必须对 min(Wp, Wn) 求 z 再取 |z|，不能直接用 Wp：
     用 Wp 时「全部变差」会让 z 极负，而下面的正态近似只算上尾 ⇒ p 会算出 2.0（>1 的非法值）。
     用 min 已把方向吸收进 |z|，双尾 p 才有意义。 */
  const Wn = N * (N + 1) / 2 - Wp;
  const W = Math.min(Wp, Wn);
  const mu = N * (N + 1) / 4, sd = Math.sqrt(N * (N + 1) * (2 * N + 1) / 24);
  const z = (W - mu) / sd;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const dd = 0.3989423 * Math.exp(-z * z / 2);
  const pr = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const p = Math.min(1, 2 * (1 - normCdf2(Math.abs(z))));
  return { n: N, p };
}
console.log('\n配对 Wilcoxon vs L0：');
for (const kk of KEYS.slice(1)) {
  const w = wil(PER[kk], PER.L0);
  console.log(' ', kk.padEnd(12), 'n=' + w.n, 'p=' + w.p.toFixed(4), w.p < 0.05 ? '✅ 显著' : '— 不显著');
}
