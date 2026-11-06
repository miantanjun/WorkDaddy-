/* 测量：把 ENT-MISS 的判据（强标识符 + 字面不存在）从事实路推广到原文路
 *
 * 为什么是这个方向：
 *   前面测了三种「中文词法」判据（覆盖率 / 未登录词率 / 内容词命中率），三种都失败：
 *     最硬的反例是 N07「Server Actions 的缓存策略」——
 *       **它的内容词 6/6 全在库里**（服务、缓存、策略这些词 WorkDaddy 讨论里到处都是）。
 *     也就是说：「词出现过」与「这个话题我们讨论过」是两件不同的事，
 *     中文 bigram 层面**根本无法区分**（这与阶段 2 的实测结论完全一致）。
 *
 *   但强标识符不一样：它不靠词频，靠**确定性字面**。
 *     · v3.0.0 版本号 —— 库里只有 v1.x，没有 v3.0.0 ⇒ 确定不存在
 *     · YKW-SU-260713 —— 单号，库里一次都没出现过 ⇒ 确定不存在
 *     · Kubernetes / Pod / PostgreSQL —— 英文专有名词，整词不在词表里
 *   这正是阶段 4 已为事实层实现的 ENT-MISS 判据，现在要验证它对原文路同样成立。
 *
 * ⚠️ 已知拦不住的两类（必须先看清，别指望这条规则包打天下）：
 *   纯自然语言的泛问题（N03「Redis 集群 slots 迁移怎么做」、N07）
 *   里面一个数字都没有 ⇒ 没有任何确定性锚点 ⇒ 词法层面无解。
 *   这两条要如实记为「已知边界」，不能用提高覆盖率阈值的办法去硬凑（会误伤正例）。
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

/* 判定一个标识符是否「字面存在于库里」：
 *   ① 全数字 → 查 bigram 词表（数字串会被切成 bigram，长数字不存在则必有 bigram 缺失）
 *   ② 含字母 → 归一化后整词查词表（unicode61 全小写；分隔符会被切掉，所以去掉再查）
 * ⚠️ 用「所有 bigram 都在」近似「这个串出现过」：只要有一个 bigram 不在，
 *   这个串就**一定**没出现过（充分条件），反过来说可能偏保守 —— 对拒答是安全的。
 */
function existsInDb(id) {
  const s = String(id).toLowerCase();
  if (!s) return true;
  const grams = [];
  const zh = s.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const m of zh) {
    if (m.length === 1) grams.push(m);
    else for (let i = 0; i < m.length - 1; i++) grams.push(m.substr(i, 2));
  }
  // 英文/数字按 bigram 的切法：\w 串整体保留（bigram() 不切英文）
  for (const w of s.match(/[a-z0-9][a-z0-9_]*/g) || []) grams.push(w);
  if (!grams.length) return true;
  const miss = grams.filter((x) => !(V.get(x) > 0));
  return miss.length === 0;
}

function anchors(q) {
  const ids = (ck.strongIds(q) || []).filter((t) => t.length >= 3);
  // 纯数字段（如 AB-260713 里的 260713）只在原文里单独出现时才算锚点，
  // 但作为判据它太容易误伤，这里保留但单独统计
  return ids.map((x) => ({ id: x, exists: existsInDb(x) }));
}

const pos = [], neg = [];
for (const c of CASES) {
  const a = anchors(c.q);
  const missing = a.filter((x) => !x.exists);
  (c.gold.length ? pos : neg).push({ id: c.id, n: a.length, missing: missing.map((x) => x.id) });
}

console.log('== 正例：锚点存在性 ==');
for (const x of pos) {
  if (!x.n) continue;
  const flag = x.missing.length ? '⚠️ 有缺失锚点 ' + x.missing.join(',') : 'ok';
  console.log('  ' + x.id + ' 锚点 ' + x.n + '  ' + flag);
}
console.log('== 负例 ==');
for (const x of neg) {
  console.log('  ' + x.id + ' 锚点 ' + x.n + (x.missing.length ? '  ⇒ 可拒答（缺 ' + x.missing.join(',') + '）' : '  ⇒ 拦不住（无缺失锚点）'));
}

const rej = neg.filter((x) => x.missing.length).length;
const harm = pos.filter((x) => x.missing.length).length;
console.log('\n判据：有强标识符且字面不存在 ⇒ 判无答案');
console.log('  负例拒答 ' + rej + '/' + neg.length + ' = ' + (rej / neg.length * 100).toFixed(0) + '%');
console.log('  正例误伤 ' + harm + '/' + pos.length + ' = ' + (harm / pos.length * 100).toFixed(0) + '%');
if (harm) console.log('  误伤的是：' + pos.filter((x) => x.missing.length).map((x) => x.id + '(' + x.missing.join(',') + ')').join(' '));
