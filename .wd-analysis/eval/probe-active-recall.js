// 验证「AI 主动检索」这条路（search / MCP memory_search）对纯字母专名的召回
// ⚠️ 口径：必须在**内容所在会话**里查，否则是数据不在库里而不是检索失败。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const I = ck._internal;
const db = I.open();

// 找出每个关键词真正出现在哪些会话（拿它当「该去哪个会话查」的依据）
function sessionsOf(term) {
  const rows = db.prepare(
    `SELECT sid, COUNT(*) c FROM seg WHERE text LIKE ? GROUP BY sid ORDER BY c DESC`
  ).all('%' + term + '%');
  return rows.map((r) => ({ sid: r.sid, n: r.c }));
}

const cases = [
  // 纯字母专名 —— strongIds 会丢，但 search 不该丢
  { q: 'SUNRISE 尾款',       term: 'SUNRISE' },
  { q: 'SHARDA 波兰',        term: 'SHARDA' },
  { q: 'ZeroTier',           term: 'ZeroTier' },
  { q: 'Nafeza 单据',        term: 'Nafeza' },
  { q: 'REL_TIE 阈值',       term: 'REL_TIE' },
  { q: 'KITFIRE',            term: 'KITFIRE' },
  { q: 'OCTAGON 税号',       term: 'OCTAGON' },
  // 带数字的对照（本来就该能查到）
  { q: 'YKW-SU-260713',      term: 'YKW-SU-260713' },
  { q: 'CAIRO-11371',        term: 'CAIRO-11371' },
];

let hit = 0, miss = 0;
for (const c of cases) {
  const locs = sessionsOf(c.term);
  if (!locs.length) {
    console.log(('【库内无此词】' + c.term).padEnd(28), '→ 跳过（不是检索失败）');
    continue;
  }
  // 在内容最多的那条会话里查 —— 这是「AI 认为缺信息，去检索」的模拟场景
  const sid = locs[0].sid;
  let r = null;
  try { r = I.search(sid, c.q, 5) || {}; } catch (e) { console.log('查错:', c.term, e.message); }
  // ⚠️ search 返回 { hits, via, candidates, deep }，不是数组。
  //   hits = 最终返回；candidates = 候选池大小（判「召回失败」要看后者，别误诊）
  const res = r.hits || [];
  const cands = r.candidates;
  const via = r.via;
  const texts = res.map((h) => String(h.text || ''));
  // 判「是否真命中」：返回里有任意一条包含该专名
  const ok = texts.some((t) => t.toLowerCase().indexOf(c.term.toLowerCase()) >= 0);
  if (ok) hit++; else miss++;
  console.log(
    (ok ? '[命中] ' : '[未命中] ') + c.q.padEnd(20),
    '会话', sid.slice(0, 8),
    '| 库内', String(locs[0].n).padStart(4), '行 /', locs.length, '会话',
    '| via', String(via).padEnd(4), '| 候选', String(cands).padStart(3), '| 返回', res.length, '条',
    ok ? '' : '  返回首条：' + (texts[0] || '(空)').replace(/\s+/g, ' ').slice(0, 60)
  );
  if (ok) {
    const rank = texts.findIndex((t) => t.toLowerCase().indexOf(c.term.toLowerCase()) >= 0);
    if (rank > 0) console.log('         ↑ 命中排第', rank + 1);
  }
}
console.log('\n主动检索命中：' + hit + ' / ' + (hit + miss) + '  (未计库内无此词的)');
