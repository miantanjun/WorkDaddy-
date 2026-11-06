/* 诊断八：决定性对照 —— 同一批查询，在【错误会话】vs【正确会话】上的差距有多大？
 *
 * 为什么这是决定性实验：
 *   9 条配对负例都是「A 会话的问题，答案在 B 会话」。
 *   于是每组天然有一对：(错会话, 对会话)。
 *   在同一查询、同一库、同一 k 下比较信号值 ⇒ **完全配对**，消除了题目难度差异。
 *   若两条分布重叠 ⇒ 任何阈值都必然在「挡住错会话」的同时挡住对会话 ⇒ 无解。
 *   若清晰分离 ⇒ 阈值存在，可以直接定。
 *
 * 信号：candidates（OR 后行数）、covW（IDF 加权覆盖）、top bm25、三者组合。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);

/* 由 why 字段人工映射「答案真实所在会话」—— 已逐条核对过 why 的描述 */
const SID_WD = '8f92c3fc-ff73-4db1-b104-eb060127daaf';   // WorkDaddy 维护
const SID_CAT = '96f77df6-452b-4c05-916f-92e30accd72b';  // 画册整理
const SID_APP = '3a1eef3c-382c-4d17-95ae-7b29e230ae68';  // lang app

/* 每条题：错会话 → 对会话 */
const PAIRS = [
  ['CX02', '8f92c3fc', '3a1eef3c', 'HTTPS 证书', 'lang app 会话（腾讯云 langpit）'],
  ['CX04', '96f77df6', '3a1eef3c', '安卓包逆向', 'lang app 会话（APK）'],
  ['CX06', '3a1eef3c', '8f92c3fc', '网关三账号扣积分', 'WorkDaddy 会话（网关控制台）'],
  ['CX08', '8f92c3fc', '96f77df6', '已排序目录合并', '画册整理会话'],
  ['CX10', '3a1eef3c', '8f92c3fc', 'md 文档卡顿', 'WorkDaddy 会话（md 查看器）'],
  ['XC01', '8f92c3fc', '96f77df6', '画册产品数', '画册整理会话'],
  ['XC02', '96f77df6', '8f92c3fc', '回归基线套件', 'WorkDaddy 会话'],
  ['XC03', '96f77df6', '3a1eef3c', '模型注册表', 'lang app 会话（本地模型）'],
  ['XC04', '3a1eef3c', '96f77df6', 'ppt 扫描页数', '画册整理会话'],
];
const map = {};
for (const c of PN) map[c.id] = c;

const db = ck._internal.open();
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const dfc = new Map();
function dfOf(p) {
  if (dfc.has(p)) return dfc.get(p);
  let v = 0;
  try { v = db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(text,?)>0').get(p).c; } catch (_) {}
  dfc.set(p, v); return v;
}
const idf = (df) => (df > 0 ? Math.log((total - df + 0.5) / (df + 0.5) + 1) : 0);

function feat(sid, q, k) {
  const r = ck._internal.search(sid, q, k);
  const hits = r.hits || [];
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const txt = hits.length ? String(hits[0].text || '') : '';
  let got = 0;
  for (const p of live) if (txt.indexOf(p) >= 0) got += w.get(p);
  return {
    via: r.via, n: hits.length,
    cand: r.candidates || 0,
    covW: live.length ? got / wSum : 0,
    top: hits.length ? Number(hits[0].score) || 0 : 0,
  };
}

console.log('=== 配对对照：同一查询，错会话 vs 对会话 ===');
console.log('  题    | 指标        | 错会话      | 对会话      | 对/错 方向');
const rows = [];
for (const [id, wrong, right, label, note] of PAIRS) {
  const c = map[id];
  if (!c) { console.log('  ' + id + ' 题缺失'); continue; }
  const wsid = { '8f92c3fc': SID_WD, '96f77df6': SID_CAT, '3a1eef3c': SID_APP }[wrong];
  const rsid = { '8f92c3fc': SID_WD, '96f77df6': SID_CAT, '3a1eef3c': SID_APP }[right];
  const w = feat(wsid, c.q, c.k);
  const r = feat(rsid, c.q, c.k);
  rows.push({ id, label, note, w, r });
  console.log('  ' + id.padEnd(5) + ' | candidates  | ' + String(w.cand).padStart(10) + '  | ' + String(r.cand).padStart(10)
    + '  | ' + (r.cand > w.cand ? '对' : '错') + '侧更多 ' + (w.cand ? (r.cand / w.cand).toFixed(2) + 'x' : '-'));
  console.log('  ' + ''.padEnd(5) + ' | covW        | ' + w.covW.toFixed(3).padStart(10) + '  | ' + r.covW.toFixed(3).padStart(10)
    + '  | ' + (r.covW > w.covW ? '✅' : '❌'));
  console.log('  ' + ''.padEnd(5) + ' | top bm25    | ' + w.top.toFixed(2).padStart(10) + '  | ' + r.top.toFixed(2).padStart(10)
    + '  | ' + (r.top < w.top ? '✅' : '❌'));
}

/* 汇总判别力 */
console.log('\n=== 判别力汇总（9 对）===');
for (const k of ['cand', 'covW', 'top']) {
  let ok = 0;
  for (const x of rows) {
    if (k === 'top') { if (x.r.top < x.w.top) ok++; }
    else if (x.r[k] > x.w[k]) ok++;
  }
  console.log('  ' + k.padEnd(6) + ' 对会话更优：' + ok + '/' + rows.length
    + (ok === rows.length ? '  ✅ 全对 —— 阈值可能存在' : '  ⚠️ 有反例'));
}

/* 若 covW 全对，给出使全部分开的阈值 */
console.log('\n=== 若用 covW 分隔，最大间隔在哪 ===');
{
  const wv = rows.map((x) => x.w.covW);
  const rv = rows.map((x) => x.r.covW);
  const wMax = Math.max(...wv);
  const rMin = Math.min(...rv);
  console.log('  错会话最大 covW = ' + wMax.toFixed(3) + '（' + rows[wv.indexOf(wMax)].id + '）');
  console.log('  对会话最小 covW = ' + rMin.toFixed(3) + '（' + rows[rv.indexOf(rMin)].id + '）');
  console.log('  间隔 = ' + (rMin - wMax).toFixed(3)
    + (rMin > wMax ? '  ✅ 可分，阈值取 (' + wMax.toFixed(3) + ', ' + rMin.toFixed(3) + ')' : '  ❌ 重叠，无解'));
}
