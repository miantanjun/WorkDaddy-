// 验收 searchWithRetry：只测「该救的救回来、不该救的不能伪造」
const path = require('path');
const crypto = require('crypto');
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

function dfOf(t) {
  return Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(lower(text), ?) > 0').get(String(t).toLowerCase()).c) || 0;
}
// 生成库内绝对不存在的串
function uniq(prefix, kind) {
  for (let i = 0; i < 99; i++) {
    const h = crypto.randomBytes(3).toString('hex').toUpperCase();
    const s = kind === 'id' ? prefix + '-' + String(10000 + Math.floor(Math.random() * 89999)) + h.slice(0, 2) : prefix + h;
    if (dfOf(s) === 0) return s;
  }
  return prefix + crypto.randomBytes(4).toString('hex').toUpperCase();
}

const F_EN = uniq('ZQX', 'en');
const F_ID1 = uniq('ABC', 'id');
const F_ID2 = uniq('DEF', 'id');
const F_ID3 = uniq('GHI', 'id');
const F_ID4 = uniq('JKL', 'id');
console.log('虚构:', F_EN, F_ID1, F_ID2, F_ID3, F_ID4, '| df 全 0 =',
  [F_EN, F_ID1, F_ID2, F_ID3, F_ID4].every((x) => dfOf(x) === 0));

const CASES = [
  // ── 应该救回（剔掉查无词后还有库内锚点）──
  { q: 'Nafeza 单据 ' + F_ID1,   want: 'retry' },
  { q: 'SUNRISE 尾款 ' + F_ID2,  want: 'retry' },
  { q: 'ZeroTier 网段 ' + F_ID3, want: 'retry' },
  { q: 'KITFIRE 合同 ' + F_ID4,  want: 'retry' },
  { q: 'REL_TIE 阈值 ' + F_ID1,  want: 'retry' },
  { q: 'WAL 只增不减 ' + F_EN,   want: 'retry' },
  // ── 不该救（剔完没有库内锚点 → 保持拒答）──
  { q: F_EN + ' 那不勒斯 披萨 配方',  want: 'none' },
  { q: F_EN + ' 量子纠缠 退相干',    want: 'none' },
  { q: F_EN + ' ' + F_ID1,          want: 'none' },
  // ── 正常查询：不该被杀 ──
  { q: 'WAL 只增不减 怎么修',        want: 'first' },
  { q: '尾款 金额',                 want: 'first' },
];

let pass = 0;
console.log('\n===== searchWithRetry 行为 =====');
for (const c of CASES) {
  const a = I.search(SID, c.q, 8) || {};                 // 原始 search
  const b = I.searchWithRetry(SID, c.q, 8, false) || {}; // 带重试
  const na = (a.hits || []).length, nb = (b.hits || []).length;
  const got = nb > 0 ? (b.retried ? 'retry' : 'first') : 'none';
  const ok = got === c.want;
  if (ok) pass++;
  console.log(
    (ok ? '[OK] ' : '[!!] ') + c.q.slice(0, 34).padEnd(34),
    '原 search', String(na).padStart(2), String(a.via || '').padEnd(9),
    '→ retry版', String(nb).padStart(2), String(b.via || '').padEnd(9),
    b.retried ? ('剔「' + (b.dropped || []).join(',') + '」重查「' + b.retryQuery + '」') : '',
    ok ? '' : '  ⚠️ 期望 ' + c.want
  );
}
console.log('\n判定：' + pass + ' / ' + CASES.length);
