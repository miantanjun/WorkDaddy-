/* 测量：未登录词率（OOV）能否把「库里没有的问题」识别出来
 *
 * 动机：
 *   覆盖率的阈值扫描证明它**分不开**好坏（负例 N07 72.9% 比 31 条正例里 29 条都高）。
 *   这与阶段 2 的结论一致：中文 bigram 的覆盖率只反映「词出现过」，不反映「语义相关」。
 *
 *   但另一条线索是硬的：如果一个问题里的**关键内容词在整库里一次都没出现过**，
 *   那这个问题就不属于「我们讨论过的事」—— 这与 ENT-MISS 是同一条判据
 *   （带具体标识符但字面不存在 ⇒ 不拿相似的东西充数）。
 *
 *   所以要量的是：正例与负例的「库里查无此词」比例有没有区分度。
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
const idfOf = (df) => Math.log(1 + (TOTAL - df + 0.5) / (df + 0.5));

/* 中文虚词/疑问词：这些不算「内容词」，它们的 df 高低与问题是否属于本库无关。
 * ⚠️ 只用来**测量**，不作为产品逻辑的硬编码词表（阶段 1 已实测：硬编码停用词表会误杀）。 */
const FUNC = new Set(['怎么', '什么', '多少', '为什么', '哪个', '哪些', '之后', '之前', '最后',
  '怎么', '如何', '可以', '是否', '还是', '到底', '这个', '那个', '一次', '中间', '直接',
  '一起', '时间', '时候', '问题', '原因', '处理', '现在', '已经', '还有', '比较']);

function analyze(q) {
  const t = String(q || '').toLowerCase();
  const zh = t.match(/[\u4e00-\u9fa5]+/g) || [];
  const grams = [];
  for (const m of zh) {
    if (m.length === 1) { grams.push(m); continue; }
    for (let i = 0; i < m.length - 1; i++) grams.push(m.substr(i, 2));
  }
  // 英文/数字串整词（bigram 里也是整词形式）
  const words = t.match(/[a-z0-9][a-z0-9_.\-:/]*/g) || [];
  const all = [...new Set(grams.filter((g) => !FUNC.has(g)).concat(words))];
  const oov = all.filter((g) => !(V.get(g) > 0));
  // 加权：只算「内容词」里未登录的
  const wSum = all.reduce((s, g) => s + (V.get(g) > 0 ? idfOf(V.get(g)) : idfOf(1)), 0) || 1;
  const wOov = oov.reduce((s, g) => s + idfOf(1), 0);
  return { n: all.length, oov: oov.length, ratio: all.length ? oov.length / all.length : 0,
    wRatio: wOov / wSum, oovWords: oov.slice(0, 8) };
}

const pos = [], neg = [];
for (const c of CASES) {
  const a = analyze(c.q);
  (c.gold.length ? pos : neg).push({ id: c.id, ...a });
}
const f = (x) => (x * 100).toFixed(0).padStart(3) + '%';
console.log('== 正例：未登录词率 ==');
pos.sort((a, b) => b.ratio - a.ratio).forEach((x) => console.log('  ' + x.id + ' oov ' + f(x.ratio) + ' (' + x.oov + '/' + x.n + ')  ' + x.oovWords.join(' ')));
console.log('== 负例：未登录词率 ==');
neg.sort((a, b) => a.ratio - b.ratio).forEach((x) => console.log('  ' + x.id + ' oov ' + f(x.ratio) + ' (' + x.oov + '/' + x.n + ')  ' + x.oovWords.join(' ')));

console.log('\n== 阈值扫描（正例保留 / 负例拒答）==');
console.log('oov阈值  正例保留  负例拒答');
for (const th of [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7]) {
  const keep = pos.filter((x) => x.ratio < th).length / pos.length;
  const rej = neg.filter((x) => x.ratio >= th).length / neg.length;
  console.log(f(th) + '      ' + f(keep) + '     ' + f(rej));
}
