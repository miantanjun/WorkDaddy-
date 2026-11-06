/* 诊断五：配对负例的「高覆盖」是不是虚词 bigram 造成的假相关？
 *
 * 观察：9 条负例的「本会话最佳段落覆盖 4~6 词」，若真相关就不该被当负例。
 * 怀疑：中文 bigram 把「多少 / 什么 / 一次 / 最新 / 怎么」这类虚词也切成词，
 *       它们在任何会话都高频 ⇒ cov 长期 >0.3 ⇒ 覆盖率失去判别力。
 *
 * 做法：把查询 bigram 拆成「实词 / 虚词」，分别统计覆盖，看差距是否来自虚词。
 *       （虚词表是**诊断用**，不写进产品 —— 只要它证明这一点就够。）
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const pos = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const neg = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const db = ck._internal.open();

/* 0. 会话身份：每个 sid 是什么标题 */
console.log('=== 涉及的会话身份 ===');
const sids = [...new Set(ALL.map((c) => c.sid))];
const q1 = db.prepare('SELECT COUNT(*) c, MIN(ts) a, MAX(ts) b FROM seg WHERE sid=?');
for (const sid of sids) {
  const r = q1.get(sid);
  const t = db.prepare("SELECT text FROM seg WHERE sid=? AND kind='user' AND COALESCE(noise,0)=0 ORDER BY ts LIMIT 1").get(sid);
  console.log('  ' + sid.slice(0, 8) + ' 行=' + String(r.c).padStart(6)
    + ' 首条用户发言: ' + String(t ? t.text : '').replace(/\s+/g, ' ').slice(0, 70));
}

/* 1. 虚词 bigram 表（诊断用） */
const STOP = new Set([
  '多少', '什么', '怎么', '一次', '一个', '一次', '这个', '那个', '现在', '还是',
  '是不', '不是', '可以', '能不', '不能', '么时', '时候', '候到', '到期', '最后',
  '用的', '的是', '一共', '总共', '有没', '没有', '以后', '之后', '前后', '合并',
  '出来', '个产', '品位', '组多', '少组', '些什', '什么', '么包', '几个', '在哪',
  '哪个', '文件', '怎么', '么读', '读的', '少个', '个套', '套件', '项断', '断言',
  '结果', '解决', '决的', '么解', '怎么', '处理', '情况', '问题', '知道', '告诉',
]);

function splitParts(q) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  const stop = parts.filter((p) => STOP.has(p));
  const real = parts.filter((p) => !STOP.has(p));
  return { parts, stop, real };
}

const stSes = db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=? AND instr(text,?)>0 AND COALESCE(pri,0)>=1');
const cov = (sid, list, txt) => {
  if (!list.length) return null;
  let g = 0;
  for (const p of list) if (String(txt).indexOf(p) >= 0) g++;
  return g / list.length;
};

function probe(c) {
  const { parts, stop, real } = splitParts(c.q);
  const r = ck._internal.search(c.sid, c.q, c.k);
  const top = (r.hits || [])[0];
  const txt = top ? top.text : '';
  /* 本会话里，实词/虚词分别在库中出现的比例 */
  const inSesRate = (list) => {
    if (!list.length) return null;
    let k = 0;
    for (const p of list) { try { if (stSes.get(c.sid, p).c > 0) k++; } catch (_) {} }
    return k / list.length;
  };
  return {
    nWords: parts.length, nStop: stop.length, nReal: real.length,
    stopInSes: inSesRate(stop), realInSes: inSesRate(real),
    topCovAll: cov(c.sid, parts, txt), topCovStop: cov(c.sid, stop, txt), topCovReal: cov(c.sid, real, txt),
    stop, real,
  };
}

const P = pos.map((c) => ({ c, s: probe(c) }));
const N = neg.map((c) => ({ c, s: probe(c) }));

console.log('\n=== 9 条配对负例：实词 vs 虚词 覆盖 ===');
for (const x of N) {
  const s = x.s;
  const f = (v) => (v === null ? ' n/a ' : v.toFixed(2));
  console.log('  ' + x.c.id.padEnd(5) + ' 词=' + s.nWords + '(虚' + s.nStop + '/实' + s.nReal + ')'
    + ' | 本会话出现率 虚=' + f(s.stopInSes) + ' 实=' + f(s.realInSes)
    + ' | top段覆盖 全=' + f(s.topCovAll) + ' 虚=' + f(s.topCovStop) + ' 实=' + f(s.topCovReal));
  if (s.real.length) console.log('        实词: ' + s.real.join(' '));
}

function stat(arr) {
  const a = arr.filter((x) => x !== null).sort((x, y) => x - y);
  if (!a.length) return 'n/a';
  const at = (p) => a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))];
  return 'p10=' + at(0.1).toFixed(2) + ' p50=' + at(0.5).toFixed(2) + ' p90=' + at(0.9).toFixed(2);
}
console.log('\n=== 分布：正例 vs 负例 ===');
for (const k of ['topCovAll', 'topCovReal', 'realInSes']) {
  console.log('  ' + k.padEnd(11) + ' 正例 ' + stat(P.map((x) => x.s[k])));
  console.log('  ' + ''.padEnd(11) + ' 负例 ' + stat(N.map((x) => x.s[k])));
}

console.log('\n=== 只用实词覆盖率，零误伤上限 ===');
{
  const pv = P.map((x) => x.s.topCovReal).filter((x) => x !== null);
  const nv = N.map((x) => x.s.topCovReal).filter((x) => x !== null);
  const T = Math.min(...pv);
  console.log('  正例最小实词覆盖=' + T.toFixed(2) + ' ⇒ 低于此值拦 ' + nv.filter((x) => x < T).length + '/9');
  console.log('  实词覆盖率均值 正例=' + (pv.reduce((a, b) => a + b, 0) / pv.length).toFixed(3)
    + ' 负例=' + (nv.reduce((a, b) => a + b, 0) / nv.length).toFixed(3));
}
