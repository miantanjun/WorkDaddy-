/* 测量新判据：英文/数字专名整词不在词表里 ⇒ 判无答案
 *
 * 为什么这条有希望：
 *   前面三种中文词法判据全失败（覆盖率 / 未登录词率 / 内容词命中率），
 *   最硬的反例 N07「Server Actions 的缓存策略」内容词 6/6 全在库里。
 *   但拆开看 df：
 *     Server   df=0   ← 整词不在库里
 *     Actions  df=0   ← 整词不在库里
 *     缓存     df=529 ← 在
 *     策略     df=153 ← 在
 *   ⇒ **中文部分是通用的、英文专名是具体的**。中文 bigram 判断不了「讨论过没有」，
 *     但一个英文专名在整库一次都没出现过，几乎可以断定这个话题没讨论过。
 *
 *   这与 ENT-MISS 同源（阶段 4）：带强标识符但字面不存在 ⇒ 绝不拿相似的东西充数。
 *   区别是「标识符」的判定范围从「字母+数字」放宽到「英文专名整词」。
 *
 * 风险必须量清楚：如果用户第一次用英文名提一件库里用中文记的事，
 *   这条规则会造成误伤。所以要看正例里含英文词的有几条、会不会被误杀。
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

/* 从查询里抠出「英文专名」：长度 >= 3 的连续字母串。
 * 排除纯数字（数字串已经在 strongIds 那条路里了）、排除单个字母。 */
function latinTerms(q) {
  const out = [];
  for (const m of String(q).match(/[A-Za-z][A-Za-z0-9_.\-]*/g) || []) {
    const t = m.toLowerCase().replace(/[.\-]+$/, '');
    if (t.length < 3) continue;
    // 拆成片段：v1.4.0 → v1, 4, 0 已经在 strongIds 里处理；这里只看纯字母段
    if (!/[a-z]{3,}/.test(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

/* 一个英文串是否「整词出现过」：
 *   bigram() 对英文**不切分**（整串当一个 token），所以直接整串查词表。
 *   但带点的（v1.4.0）会被 [^\w\u4e00-\u9fa5]+ 拆成 v1 / 4 / 0，
 *   所以先按 bigram 的规则粗切一遍，逐段判断。 */
function segments(s) {
  return String(s).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}
function existsAnywhere(term) {
  // 任一段在词表里就算「出现在库里」，避免把 UI / API 这类通用缩写误判
  const segs = segments(term);
  if (!segs.length) return true;
  return segs.some((x) => (V.get(x) || 0) > 0);
}

const pos = [], neg = [];
for (const c of CASES) {
  const terms = latinTerms(c.q);
  const dead = terms.filter((t) => !existsAnywhere(t));
  (c.gold.length ? pos : neg).push({ id: c.id, terms, dead });
}

console.log('== 正例：英文专名 ==');
for (const x of pos) {
  if (!x.terms.length) continue;
  console.log('  ' + x.id + ' ' + x.terms.join(',') + (x.dead.length ? '   ⚠️ 误伤候选: ' + x.dead.join(',') : '   ok'));
}
console.log('== 负例：英文专名 ==');
for (const x of neg) {
  console.log('  ' + x.id + ' ' + (x.terms.length ? x.terms.join(',') : '(无英文词)')
    + (x.dead.length ? '   ⇒ 可拒答（查无 ' + x.dead.join(',') + '）' : '   ⇒ 拦不住'));
}

const rej = neg.filter((x) => x.dead.length).length;
const harm = pos.filter((x) => x.dead.length).length;
console.log('\n判据：查询含英文专名，且该词整库查无 ⇒ 判无答案');
console.log('  负例拒答 ' + rej + '/' + neg.length + ' = ' + (rej / neg.length * 100).toFixed(0) + '%');
console.log('  正例误伤 ' + harm + '/' + pos.length + ' = ' + (harm / pos.length * 100).toFixed(0) + '%');
if (harm) console.log('  误伤：' + pos.filter((x) => x.dead.length).map((x) => x.id + '(' + x.dead.join(',') + ')').join(' '));
