// 探针 5：用**真正库内不存在**的随机串重测（前几版被自己写进对话的字符串污染了）
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

function dfOf(term) {
  return Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(lower(text), ?) > 0').get(String(term).toLowerCase()).c) || 0;
}

// 造一个确定库内不存在的随机串
function uniq(prefix, kind) {
  let s;
  let guard = 0;
  do {
    const r = Math.random().toString(36).slice(2, 7).toUpperCase();
    s = kind === 'id' ? (prefix + '-' + r + '9') : (prefix + r);
    guard++;
  } while (dfOf(s) > 0 && guard < 50);
  return s;
}

const FAKE_EN = uniq('QUANTUM', 'en');
const FAKE_ID1 = uniq('XYZ', 'id');
const FAKE_ID2 = uniq('HH', 'id');
const FAKE_ID3 = uniq('QQQ', 'id');
console.log('虚构词:', FAKE_EN, FAKE_ID1, FAKE_ID2, FAKE_ID3,
  '| df:', dfOf(FAKE_EN), dfOf(FAKE_ID1), dfOf(FAKE_ID2), dfOf(FAKE_ID3));

function stripMiss(q, miss) {
  let out = String(q);
  for (const m of miss || []) {
    if (!m) continue;
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function anchorsOf(q2) {
  const out = [];
  for (const m of String(q2).match(/[A-Za-z][A-Za-z0-9_.\-]*/g) || []) {
    const t = m.toLowerCase().replace(/[.\-]+$/, '');
    if (t.length >= 3 && /[a-z]{3,}/.test(t)) out.push(t);
  }
  try { for (const t of ck.strongIds(q2)) out.push(String(t).toLowerCase()); } catch (_) {}
  return [...new Set(out)];
}

const CASES = [
  { q: 'Nafeza 单据 ' + FAKE_ID1,        want: 'retry', note: '真专名 + 虚构编号' },
  { q: 'SUNRISE 尾款 ' + FAKE_ID2,       want: 'retry', note: '真专名 + 虚构编号' },
  { q: 'ZeroTier 网段 ' + FAKE_ID3,      want: 'retry', note: '真专名 + 虚构编号' },
  { q: 'KITFIRE 合同 ' + FAKE_ID1,       want: 'retry', note: '真专名 + 虚构编号' },
  { q: 'REL_TIE 阈值 ' + FAKE_ID2,       want: 'retry', note: '真专名 + 虚构编号' },
  { q: 'WAL 只增不减 ' + FAKE_EN,        want: 'hold',  note: '短专名 + 虚构英文' },
  { q: FAKE_EN + ' 量子纠缠 退相干',      want: 'none',  note: '全虚构 → 不该重试' },
  { q: FAKE_EN + ' 那不勒斯 披萨 配方',   want: 'none',  note: '全虚构 + 库外中文' },
];

console.log('\n===== 定稿判据：剔词后仍留【库内存在的英文专名或强标识符】才重试 =====');
let pass = 0;
for (const c of CASES) {
  const r1 = I.search(SID, c.q, 8) || {};
  const n1 = (r1.hits || []).length;
  const miss = r1.miss || [];
  const q2 = stripMiss(c.q, miss);
  const anchors = anchorsOf(q2).map((t) => ({ t, df: dfOf(t) })).filter((a) => a.df > 0);
  const allow = !!(q2 && q2 !== c.q.trim() && anchors.length);
  let n2 = 0, via2 = '';
  if (n1 === 0 && allow) {
    const r2 = I.search(SID, q2, 8) || {};
    n2 = (r2.hits || []).length; via2 = r2.via || '';
  }
  const got = n1 > 0 ? 'first' : (allow && n2 > 0) ? 'retry' : 'none';
  const ok = got === c.want || (c.want === 'hold' && got !== 'none');
  if (ok) pass++;
  console.log(
    (ok ? '[OK] ' : '[!!] ') + c.q.slice(0, 34).padEnd(34),
    '首查', String(n1).padStart(2), String(r1.via || '').padEnd(9),
    '| 剔除', String(miss.length).padStart(2),
    '| 锚点', String(anchors.map((a) => a.t + ':' + a.df).join(',') || '无').padEnd(20),
    '| 允许', allow ? 'Y' : 'N',
    '| 得', got
  );
}
console.log('\n判定：' + pass + ' / ' + CASES.length);
