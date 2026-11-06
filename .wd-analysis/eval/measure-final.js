/* 最终判据定型：把「英文专名」与「稀有度」组合起来，量出可接受的点
 *
 * 现状梳理（四轮测量，每轮都推翻了上一轮的想法）：
 *   ① IDF 加权覆盖率          —— 方向反了（负例 72.9% > 大多数正例）
 *   ② 未登录词率               —— 12% 阈值拒 88% 但砍 42% 正例
 *   ③ 内容词命中率             —— N07 内容词 6/6 全在库里，完全拦不住
 *   ④ 英文专名整词查无          —— 拒 50% / 误伤 0%，但 server(df 1326)、redis(df 113) 拦不住
 *
 * ④ 的漏网原因不是判据错，是**词太常见**：server / redis 在库里作为普通词大量出现，
 *   但「把它们当专有名词讨论」这件事没发生过。所以加一道「稀有度」：
 *   只有当这个英文词 **df 低于阈值**（真的罕见）时，它才有资格当「确定性锚点」；
 *   df 高说明它是日常用词，不能用来判定「没讨论过」。
 *
 * ⚠️⚠️ 这条判据的**代价必须写清楚**：它会让「用英文名问一件库里用中文记的事」查不到。
 *   按 ENT-MISS 的既定方针，这是可接受的取舍 —— 错误命中比漏召回更坏，
 *   因为用户会以为这件事真发生过（而漏召回时用户只是再问一次）。
 *   所以默认只对「df <= 阈值」的罕用英文词生效，且必须能关。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const { CASES } = require('./cases.js');

const db = ck._internal.open();
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')");
const V = new Map();
for (const r of db.prepare('SELECT term, doc FROM temp.wd_vocab').all()) V.set(String(r.term).toLowerCase(), Number(r.doc) || 0);
const TOTAL = Number(db.prepare('SELECT COUNT(*) c FROM seg').get().c) || 1;

function latinTerms(q) {
  const out = [];
  for (const m of String(q).match(/[A-Za-z][A-Za-z0-9_.\-]*/g) || []) {
    const t = m.toLowerCase().replace(/[.\-]+$/, '');
    if (t.length < 3) continue;
    if (!/[a-z]{3,}/.test(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}
const segs = (s) => String(s).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);

/* 返回该查询里「有资格当锚点、且确实查无」的英文词 */
function deadAnchors(q, dfMax) {
  const dead = [];
  for (const t of latinTerms(q)) {
    const parts = segs(t);
    if (!parts.length) continue;
    // 词的威力：取它在库里最「常见」的那一段的 df（保守 —— 只要有一段常见就不算罕见词）
    const maxDf = Math.max(...parts.map((x) => V.get(x) || 0));
    if (maxDf > dfMax) continue;        // 太常见，不配当锚点
    if (maxDf === 0) dead.push(t);      // 整库查无 ⇒ 确定不存在
  }
  return dead;
}

console.log('df阈值  正例误伤  负例拒答  拒答明细');
for (const th of [0, 2, 5, 10, 20, 50, 100, 200]) {
  const harmed = [], caught = [];
  for (const c of CASES) {
    const d = deadAnchors(c.q, th);
    if (!d.length) continue;
    if (c.gold.length) harmed.push(c.id + '(' + d.join(',') + ')');
    else caught.push(c.id);
  }
  const posN = CASES.filter((c) => c.gold.length).length;
  const negN = CASES.filter((c) => !c.gold.length).length;
  console.log((String(th)).padStart(5) + '   ' + (harmed.length + '/' + posN).padEnd(9)
    + ' ' + (caught.length + '/' + negN).padEnd(9) + ' ' + caught.join(',')
    + (harmed.length ? '   ⚠️ ' + harmed.join(' ') : ''));
}

/* 逐条看清每个负例到底缺什么 */
console.log('\n== 负例逐条（df<=5）==');
for (const c of CASES.filter((x) => !x.gold.length)) {
  const t = latinTerms(c.q);
  const detail = t.map((x) => x + '(df=' + Math.max(...segs(x).map((y) => V.get(y) || 0)) + ')');
  console.log('  ' + c.id + ' ' + JSON.stringify(c.q) + '  ' + (detail.length ? detail.join(' ') : '(无英文词)')
    + (deadAnchors(c.q, 5).length ? '  ⇒ 拒答' : '  ⇒ 漏'));
}
