/* 测量：把「内容词在库里一个都没出现」当作无答案判据是否可行
 *
 * 背景：评测基线 8 条负例 100% 被误召回。前面已测过两种信号，都不好用：
 *   ① IDF 加权覆盖率 —— 负例 N07 72.9%，比 31 条正例里 29 条都高（**方向是反的**）
 *   ② 未登录词率 —— 12% 阈值能拒 88% 负例，但也砍掉 42% 正例
 *
 * 本脚本测第三种，也是最接近 ENT-MISS 那种「确定性」的：
 *   **有几个内容词真的出现在库里？出现了几个？**
 *   正常的检索至少会打中一两个（用户问的是记过的事），
 *   而「Kubernetes Pod 驱逐阈值」这类，除虚词外一个都不在。
 *
 * 关键是要排除**跨词碎片**（阶段 2 实测过：「标签栏显示」切出「栏显」df=2）。
 * 所以这里同时统计两种口径：
 *   hitAny  —— 只要有一个 bigram 在库里就算（宽松，容易被碎片骗过）
 *   hitReal —— 只看 df>=3 的内容词，抗碎片
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

const FUNC = new Set(['怎么', '什么', '多少', '为什', '什么', '哪个', '哪些', '之后', '之前', '最后',
  '如何', '可以', '是否', '还是', '到底', '这个', '那个', '一次', '中间', '直接',
  '一起', '时间', '时候', '问题', '原因', '处理', '现在', '已经', '还有', '比较']);

function grams(q) {
  const t = String(q || '').toLowerCase();
  const out = new Set();
  for (const m of t.match(/[\u4e00-\u9fa5]+/g) || []) {
    if (m.length === 1) { out.add(m); continue; }
    for (let i = 0; i < m.length - 1; i++) out.add(m.substr(i, 2));
  }
  for (const w of t.match(/[a-z0-9][a-z0-9_.\-:/]*/g) || []) out.add(w);
  return [...out].filter((g) => !FUNC.has(g));
}

function analyze(q) {
  const g = grams(q);
  const df = g.map((x) => [x, V.get(x) || 0]);
  const hitAny = df.filter((x) => x[1] > 0).length;
  const hitReal = df.filter((x) => x[1] >= 3).length;
  return {
    n: g.length, hitAny, hitReal,
    ratioAny: g.length ? hitAny / g.length : 0,
    ratioReal: g.length ? hitReal / g.length : 0,
    dead: df.filter((x) => x[1] === 0).map((x) => x[0]).slice(0, 6),
  };
}

const pos = [], neg = [];
for (const c of CASES) (c.gold.length ? pos : neg).push({ id: c.id, ...analyze(c.q) });
const f = (x) => (x * 100).toFixed(0).padStart(3) + '%';

console.log('== 正例（内容词命中率）==');
pos.sort((a, b) => a.ratioReal - b.ratioReal)
  .forEach((x) => console.log('  ' + x.id + ' real ' + f(x.ratioReal) + ' (' + x.hitReal + '/' + x.n + ')  any ' + f(x.ratioAny) + '  缺: ' + x.dead.join(' ')));
console.log('== 负例 ==');
neg.sort((a, b) => b.ratioReal - a.ratioReal)
  .forEach((x) => console.log('  ' + x.id + ' real ' + f(x.ratioReal) + ' (' + x.hitReal + '/' + x.n + ')  any ' + f(x.ratioAny) + '  缺: ' + x.dead.join(' ')));

console.log('\n== 判据比较 ==');
const rules = [
  ['hitReal === 0（一个真词都没打中）', (x) => x.hitReal === 0],
  ['ratioReal < 0.15', (x) => x.ratioReal < 0.15],
  ['ratioReal < 0.25', (x) => x.ratioReal < 0.25],
  ['ratioAny < 0.20', (x) => x.ratioAny < 0.20],
  ['ratioAny < 0.30', (x) => x.ratioAny < 0.30],
];
for (const [name, fn] of rules) {
  const kept = pos.filter((x) => !fn(x)).length / pos.length;
  const rej = neg.filter(fn).length / neg.length;
  console.log('  ' + name.padEnd(34) + ' 正例保留 ' + f(kept) + '  负例拒答 ' + f(rej));
}
