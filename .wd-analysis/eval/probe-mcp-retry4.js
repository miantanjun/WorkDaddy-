// 探针 4：定稿判据 —— 「剔词后仍留有库内锚点」才重试
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

function stripMiss(q, miss) {
  let out = String(q);
  for (const m of miss || []) {
    if (!m) continue;
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// 剔词后还剩什么锚点？
function anchorsOf(q2) {
  const out = [];
  // 英文专名
  for (const m of String(q2).match(/[A-Za-z][A-Za-z0-9_.\-]*/g) || []) {
    const t = m.toLowerCase().replace(/[.\-]+$/, '');
    if (t.length >= 3 && /[a-z]{3,}/.test(t)) out.push({ t, kind: 'en' });
  }
  // 强标识符
  try { for (const t of ck.strongIds(q2)) out.push({ t: String(t).toLowerCase(), kind: 'id' }); } catch (_) {}
  const seen = new Set();
  return out.filter((x) => { if (seen.has(x.t)) return false; seen.add(x.t); return true; });
}

// 该锚点在库里存在且不算超泛词
function anchorAlive(t) {
  const d = Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(lower(text), ?) > 0').get(t).c) || 0;
  return d > 0 ? d : 0;
}

const CASES = [
  { q: '索引 翻倍 怎么修 FOO-12345',      want: 'none' },   // 纯中文 + 虚构编号 → 不重试（保守）
  { q: 'Nafeza 单据 ZZZZ-88888',         want: 'retry' },
  { q: 'SUNRISE 尾款 HH-1234',           want: 'retry' },
  { q: '尾款 金额 XYZ-99999',            want: 'none' },   // 首查就中，不需重试
  { q: 'PIZZATOWN 那不勒斯 披萨 配方',    want: 'none' },   // 剔完只剩中文 → 不重试
  { q: 'QUANTUMFOO 量子纠缠 XYZ-99999',  want: 'none' },   // 首查就 8 条 OR（既有问题）
  { q: 'ZeroTier 网段 QQQQ-7777',        want: 'retry' },
  { q: 'KITFIRE 合同 WWWW-3333',         want: 'retry' },
  { q: 'REL_TIE 阈值 ZZZZ-1111',         want: 'retry' },
];

console.log('===== 判据验证：剔词后仍留库内锚点才重试 =====');
let pass = 0;
for (const c of CASES) {
  const r1 = I.search(SID, c.q, 8) || {};
  const n1 = (r1.hits || []).length;
  const miss = r1.miss || [];
  const q2 = stripMiss(c.q, miss);
  const anchors = anchorsOf(q2).map((a) => ({ ...a, df: anchorAlive(a.t) })).filter((a) => a.df > 0);
  const allow = !!(q2 && q2 !== c.q.trim() && anchors.length);
  let n2 = 0, via2 = '';
  if (n1 === 0 && allow) {
    const r2 = I.search(SID, q2, 8) || {};
    n2 = (r2.hits || []).length; via2 = r2.via || '';
  }
  const got = n1 > 0 ? 'first' : (allow && n2 > 0) ? 'retry' : 'none';
  const ok = got === c.want;
  if (ok) pass++;
  console.log(
    (ok ? '[OK] ' : '[!!] ') + c.q.padEnd(30),
    '首查', String(n1).padStart(2), String(r1.via || '').padEnd(9),
    '| 剔剩「' + (q2 || '').slice(0, 20) + '」',
    '| 锚点', String(anchors.map((a) => a.t + ':' + a.df).join(',') || '无').padEnd(22),
    '| 允许', allow ? 'Y' : 'N',
    '| 结果', got, '（期望 ' + c.want + '）'
  );
}
console.log('\n判定：' + pass + ' / ' + CASES.length + ' 符合预期');
