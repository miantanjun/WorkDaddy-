/* probe-memory-eff2.js — 记忆系统效果实测（只读，修正签名）
 *
 * 三种用法分开测，别混：
 *   A. 生产用法：ck.search(q,k)        —— 只查「当前绑定会话」（MCP 就是这么用的）
 *   B. 全库用法：ck._internal.search(null,q,k) —— 跨会话，评测口径
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const one = (s, ...a) => db.prepare(s).get(...a);
const S = ck._internal.search;

console.log('======= 0. 当前绑定的是哪个会话 =======');
const bi = ck.bindInfo();
const act = ck.findActiveSession({ fresh: true });
console.log('  bindInfo.sid =', bi && bi.sid ? bi.sid.slice(0, 8) : '(空)');
console.log('  active.sid   =', act ? act.sid.slice(0, 8) : '(空)');
console.log('  判定依据     =', (bi && act && bi.sid === act.sid) ? 'panel（侧栏选中，可靠）' : 'mtime（猜的）');

console.log('\n======= A. 生产用法 ck.search(q,k)：只查当前会话 =======');
const casesA = [
  ['WAL 只增不减', '刚做完的事'],
  ['重复会话 正品', '刚做完的事'],
  ['REL_TIE', '上次改过'],
  ['备份 永久删除', '刚才'],
];
for (const [q, tag] of casesA) {
  const t0 = Date.now();
  const r = ck.search(q, 5, false);
  const ms = Date.now() - t0;
  const h = r.hits || [];
  console.log(`  ▸ "${q}" [${tag}]  ${h.length} 命中  via=${r.via}  ${ms}ms`);
  h.slice(0, 2).forEach((x, i) => {
    console.log(`     ${i + 1}. pri=${x.pri} kind=${x.kind} ${String(x.text || '').replace(/\s+/g, ' ').slice(0, 64)}`);
  });
}

console.log('\n======= B. 全库用法 _internal.search(null,q,k)：跨 29 个会话 =======');
const casesB = [
  ['WAL 只增不减', '技术决策'],
  ['REL_TIE 阈值', '技术决策'],
  ['重复会话 正品', '技术决策'],
  ['SUNRISE 尾款', '外贸'],
  ['OCTAGON 5 柜', '外贸'],
  ['SHARDA 波兰', '外贸'],
  ['OfficeTool 彩色打印机', '办公室IT'],
  ['ZeroTier 虚拟网卡', '网络'],
  ['喜马拉雅 下载', '个人'],
  ['CargoX 单据', '外贸'],
];
let ok = 0, zero = 0, tot = 0;
const detail = [];
for (const [q, tag] of casesB) {
  const t0 = Date.now();
  const r = S(null, q, 5, false);
  const ms = Date.now() - t0; tot += ms;
  const h = r.hits || [];
  if (h.length) ok++; else zero++;
  detail.push({ q, tag, n: h.length, via: r.via, ms });
  console.log(`  ▸ "${q}" [${tag}]  ${h.length} 命中  via=${r.via}  ${ms}ms`);
  h.slice(0, 2).forEach((x, i) => {
    console.log(`     ${i + 1}. pri=${x.pri} kind=${x.kind} sid=${String(x.sid || '').slice(0, 8)} ${String(x.text || '').replace(/\s+/g, ' ').slice(0, 60)}`);
  });
}
console.log(`\n  小结：有命中 ${ok} / 零命中 ${zero}，均值 ${(tot / casesB.length).toFixed(0)}ms`);

console.log('\n======= C. 当前会话的索引覆盖 =======');
if (act) {
  const c = one('SELECT COUNT(*) c FROM seg WHERE sid=?', act.sid);
  const c2 = one("SELECT COUNT(*) c FROM seg WHERE sid=? AND pri=2", act.sid);
  const c1 = one("SELECT COUNT(*) c FROM seg WHERE sid=? AND pri=1", act.sid);
  const mx = one('SELECT MAX(h) h FROM seg WHERE sid=?', act.sid);
  console.log(`  ${act.sid.slice(0, 8)}  seg=${c.c} 条（pri2=${c2.c} / pri1=${c1.c}）`);
  console.log(`  最新一条 h=${mx.h}`);
}
