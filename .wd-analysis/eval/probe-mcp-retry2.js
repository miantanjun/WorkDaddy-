// 探针 2：真正会返回 0 条的分支是 ENT-MISS / ID-MISS
// 实测这两种「确定性否决」下，把卡住的那个词剔掉再试一次，能不能救回来。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const I = ck._internal;
const db = I.open();

function findSession(term) {
  const r = db.prepare(`SELECT sid, COUNT(*) c FROM seg WHERE text LIKE ? GROUP BY sid ORDER BY c DESC`).all('%' + term + '%');
  return r.length ? r[0].sid : '';
}

// 找一个 ds 最多的会话，保证「内容确实在库里」
const sidWAL = findSession('WAL') || findSession('wal');
const sidMem = findSession('索引') || sidWAL;
const sidBiz = findSession('尾款') || sidWAL;
console.log('测试会话：WAL->', String(sidWAL).slice(0, 8), ' 索引->', String(sidMem).slice(0, 8), ' 尾款->', String(sidBiz).slice(0, 8));

// 构造会触发 ENT-MISS / ID-MISS 的查询：
// 加一个库里必然没有的专名，但保留真实关键词
const cases = [
  { q: 'WAL 只增不减 怎么修 QUANTUMFOO',     sid: sidWAL,  note: '真词全 + 一个虚构专名' },
  { q: 'WAL QUANTUMFOO',                     sid: sidWAL,  note: '真词 + 虚构专名' },
  { q: '尾款 金额 XYZ-99999',                sid: sidBiz,  note: '真词 + 虚构单号' },
  { q: '索引 翻倍 怎么修 FOO-12345',         sid: sidMem,  note: '真词 + 虚构编号' },
  { q: 'WAL 只增不减 怎么修',                sid: sidWAL,  note: '对照：没有虚构词' },
];

function stripMissing(q, miss) {
  let out = String(q);
  for (const m of miss || []) out = out.split(m).join(' ');
  return out.replace(/\s+/g, ' ').trim();
}

console.log('\n===== ENT-MISS / ID-MISS 场景 =====');
for (const c of cases) {
  const r1 = I.search(c.sid, c.q, 8) || {};
  const n1 = (r1.hits || []).length;
  let line = c.q.padEnd(36) + ' via=' + String(r1.via).padEnd(9) + ' 条=' + n1;
  if (r1.miss && r1.miss.length) {
    line += '  miss=' + JSON.stringify(r1.miss);
    // 剔掉查无的词再试
    const q2 = stripMissing(c.q, r1.miss);
    if (q2) {
      const r2 = I.search(c.sid, q2, 8) || {};
      line += '  → 剔词后「' + q2 + '」via=' + r2.via + ' 条=' + (r2.hits || []).length;
    }
  }
  console.log(line);
}

// 关键问题：latinMiss 认不认全大写虚构词？
console.log('\n===== latinMiss 判据观察 =====');
for (const w of ['QUANTUMFOO', 'XYZ-99999', 'FOO-12345', 'WAL', 'Nafeza', 'ZeroTier']) {
  const r = I.search(sidWAL, w, 3) || {};
  console.log('  ' + w.padEnd(14), 'via=' + String(r.via).padEnd(10), 'hits=' + (r.hits || []).length,
    r.miss ? ('miss=' + JSON.stringify(r.miss)) : '');
}
