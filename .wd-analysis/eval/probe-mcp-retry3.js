// 探针 3：定稿重试策略
// 候选策略只有一条是安全的：**只剔除「整库查无」的那个词**，其余一概不做。
// 必须验证：正例救得回、负例不会靠泛词伪造命中。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const I = ck._internal;
const db = I.open();

function findSession(term) {
  const r = db.prepare(`SELECT sid, COUNT(*) c FROM seg WHERE text LIKE ? GROUP BY sid ORDER BY c DESC`).all('%' + term + '%');
  return r.length ? r[0].sid : '';
}
const SID = findSession('WAL') || findSession('尾款');
console.log('会话:', String(SID).slice(0, 8));

// 大小写不敏感地把 miss 词从原文里剔掉
function stripMiss(q, miss) {
  let out = String(q);
  for (const m of miss || []) {
    if (!m) continue;
    // ⚠️ latinMiss 返回小写，原文可能是大写 ⇒ 必须用大小写不敏感的全局替换
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

const cases = [
  // ── 正例：混入库里查无的词，剔除后应变好 ──
  { q: '尾款 金额 XYZ-99999',            want: 'hit',  note: '虚构单号' },
  { q: '索引 翻倍 怎么修 FOO-12345',      want: 'hit',  note: '虚构编号' },
  { q: 'WAL 只增不减 怎么修 QUANTUMFOO',  want: 'hit',  note: '虚构英文专名' },
  { q: 'Nafeza 单据 ZZZZ-88888',         want: 'hit',  note: '虚构编号 + 真专名' },
  { q: 'SUNRISE 尾款 HH-1234',           want: 'hit',  note: '虚构编号 + 真专名' },
  // ── 负例：整句都不存在，剔除后仍不应有真命中 ──
  { q: '量子纠缠 退相干 时间',           want: 'none', note: '纯中文库外话题' },
  { q: '法式甜点 马卡龙 配方',           want: 'none', note: '纯中文库外话题' },
  { q: 'QUANTUMFOO 量子纠缠 XYZ-99999',  want: 'none', note: '虚构词 + 库外中文' },
  { q: 'PIZZATOWN 那不勒斯 披萨 配方',    want: 'none', note: '虚构专名 + 库外中文' },
];

console.log('\n===== 剔除重试：正例救回 / 负例不伪造 =====');
let good = 0, bad = 0;
for (const c of cases) {
  const r1 = I.search(SID, c.q, 8) || {};
  const n1 = (r1.hits || []).length;
  const miss = r1.miss || [];
  const q2 = stripMiss(c.q, miss);
  let n2 = 0, via2 = '';
  if (n1 === 0 && q2 && q2 !== c.q.trim()) {
    const r2 = I.search(SID, q2, 8) || {};
    n2 = (r2.hits || []).length;
    via2 = r2.via || '';
  }
  const got = n1 > 0 ? 'first' : n2 > 0 ? 'retry' : 'none';
  const ok = (c.want === 'hit' && (n1 > 0 || n2 > 0)) || (c.want === 'none' && n1 === 0 && n2 === 0);
  if (ok) good++; else bad++;
  console.log(
    (ok ? '[OK] ' : '[!!] ') + c.q.padEnd(32),
    '首查', String(n1).padStart(2), String(r1.via || '').padEnd(9),
    '| miss=' + String(JSON.stringify(miss)).padEnd(24),
    '| 二查「' + (q2 || '(空)') + '」', String(n2).padStart(2), via2.padEnd(5),
    '→', got, ok ? '' : ' ⚠️ 期望 ' + c.want
  );
}
console.log('\n判定：' + good + ' / ' + (good + bad) + ' 符合预期');
