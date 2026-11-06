/* 测量：能否用「IDF 加权覆盖率」把正例与负例分开
 *
 * 背景：评测基线显示 8 条负例**全部**被 OR 兜底召回（拒答率 0%），
 *   命中的是「怎么 / 什么 / 如何」这类虚词碎片。
 *   要判断「低覆盖率就直接判无答案」是否可行，必须看两条分布有没有重叠区。
 *   ⚠️ 这个阈值不能拍脑袋定 —— 定高了全是漏召回，定低了全是噪声。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const { CASES } = require('./cases.js');

const db = ck._internal.open();

/* 复刻 search 里的分词与 IDF 加权覆盖率算法（不改产品代码，只做测量） */
function bigram(s) {
  const t = String(s || '').toLowerCase().replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  if (t.length === 1) out.push(t);
  return out.join(' ');
}
function vocab() {
  const m = new Map();
  try {
    // ⚠️ 必须三参形式 ('main','seg_fts','row')：两参在 temp 库下报
    //    "wrong number of vtable arguments"（与产品代码同款坑，见 ck-memory.js termDf）
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')");
    const rows = db.prepare('SELECT term, doc FROM temp.wd_vocab').all();
    for (const r of rows) m.set(String(r.term).toLowerCase(), Number(r.doc) || 0);
  } catch (e) { console.error('vocab err', e.message); }
  return m;
}
const V = vocab();
const TOTAL = Number(db.prepare('SELECT COUNT(*) c FROM seg').get().c) || 1;
const idfOf = (df) => Math.log(1 + (TOTAL - df + 0.5) / (df + 0.5));
if (!V.size) { console.error('词表为空 —— fts5vocab 没建起来，测量无意义'); process.exit(1); }

function covOf(sid, q) {
  const parts = [...new Set(bigram(q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => (V.get(p) || 0) > 0);
  if (!live.length) return { cov: 0, parts: parts.length, live: 0 };
  const w = new Map(live.map((p) => [p, idfOf(V.get(p) || 1)]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  // 只看 Top-20 候选里的最高覆盖率（与实际返回口径接近）
  const rows = db.prepare(
    `SELECT s.text FROM (SELECT rowid AS rid FROM seg_fts WHERE seg_fts MATCH ? LIMIT -1) t
       JOIN seg s ON s.id = t.rid
      WHERE s.sid = ? AND COALESCE(s.pri,0) >= 1 AND COALESCE(s.noise,0)=0
        AND s.kind IN ('user','assistant')
      ORDER BY t.rid DESC LIMIT 20`
  ).all(live.map((p) => '"' + p + '"').join(' OR '), sid);
  let best = 0;
  for (const r of rows) {
    const t = String(r.text || '');
    let got = 0;
    for (const p of live) if (t.indexOf(p) >= 0) got += w.get(p);
    const c = got / wSum;
    if (c > best) best = c;
  }
  return { cov: best, parts: parts.length, live: live.length };
}

const pos = [], neg = [];
for (const c of CASES) {
  const r = covOf(c.sid, c.q);
  (c.gold.length ? pos : neg).push({ id: c.id, cov: r.cov, ...r });
}
const fmt = (x) => (x * 100).toFixed(1).padStart(5) + '%';
console.log('== 正例覆盖率 ==');
pos.sort((a, b) => a.cov - b.cov).forEach((x) => console.log('  ' + x.id + ' ' + fmt(x.cov) + '  live=' + x.live + '/' + x.parts));
console.log('== 负例覆盖率 ==');
neg.sort((a, b) => b.cov - a.cov).forEach((x) => console.log('  ' + x.id + ' ' + fmt(x.cov) + '  live=' + x.live + '/' + x.parts));

/* 扫描各阈值下的取舍 */
console.log('\n== 阈值扫描（正例保留率 / 负例拒答率）==');
console.log('阈值   正例保留  负例拒答');
for (const th of [0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45]) {
  const keep = pos.filter((x) => x.cov >= th).length / pos.length;
  const rej = neg.filter((x) => x.cov < th).length / neg.length;
  console.log(fmt(th) + '   ' + fmt(keep) + '   ' + fmt(rej));
}
