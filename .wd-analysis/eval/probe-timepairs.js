/* 找「同一指标在库里存在多个不同时期的值」的行 —— 这是造新鲜度梯度题的原料
 *
 * 为什么不能随便拿两行：题面必须能被**同一条查询**同时命中两行，
 * 否则「问最新」和「问最早」不是同一道题的两种问法，测不出新鲜度作用。
 * 做法：按「正文里出现的数字族 + 公共汉字词」做聚类，找真正同主题不同期的行。
 */
'use strict';
const path = require('path');
const M = require('./lib-pool.js');
const db = M.db;

const SIDS = {
  wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  cat: '96f77df6-452b-4c05-916f-92e30accd72b',
};
const tag = process.argv[2] || 'wd';
const sid = SIDS[tag];
const rows = db.prepare(`SELECT seq, ts, text FROM seg
  WHERE sid=? AND COALESCE(pri,0)>=1 AND COALESCE(noise,0)=0
    AND kind IN ('user','assistant') ORDER BY ts`).all(sid);
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

/* 取「数字 + 量词」的指纹元组。同一指标反复记录时，数字变了但量词不变。 */
const UNIT = /(\d+(?:\.\d+)?)\s*(个|条|项|套|张|份|列|页|题|款|箱|柜|天|次|%|毫秒|ms|秒|分钟|小时|GB|MB|KB)/g;
function units(t) {
  const out = [];
  let m;
  UNIT.lastIndex = 0;
  while ((m = UNIT.exec(t))) out.push(m[2]);
  return out;
}
/* 公共英文/标识符词（型号、字段名），倾向同一主题 */
function keys(t) {
  const en = (t.match(/[A-Za-z][A-Za-z0-9_.\-]{2,}/g) || []).map((x) => x.toLowerCase());
  const zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
  const bg = [];
  for (let i = 0; i + 1 < zh.length; i++) bg.push(zh.slice(i, i + 2));
  return { en: new Set(en), bg: new Set(bg) };
}

const docs = rows.map((r) => ({ ...r, u: units(one(r.text)), k: keys(one(r.text)) }));
/* 只保留带 ≥2 个量词（有成组数字）的行 */
const cand = docs.filter((d) => d.u.length >= 2);

const pairs = [];
for (let i = 0; i < cand.length; i++) {
  for (let j = i + 1; j < cand.length; j++) {
    const a = cand[i], b = cand[j];
    /* 量词集合要高度重叠（同一组指标） */
    const ua = new Set(a.u), ub = new Set(b.u);
    const inter = [...ua].filter((x) => ub.has(x));
    if (inter.length < 2) continue;
    const jac = inter.length / new Set([...ua, ...ub]).size;
    if (jac < 0.5) continue;
    /* 公共英文词 / 汉字 bigram 要够多（确保同主题） */
    const enCommon = [...a.k.en].filter((x) => b.k.en.has(x)).length;
    const bgCommon = [...a.k.bg].filter((x) => b.k.bg.has(x)).length;
    if (bgCommon < 6 && enCommon < 2) continue;
    const days = Math.abs(a.ts - b.ts) / 86400000;
    if (days < 1) continue;                       // 至少隔 1 天
    pairs.push({ a, b, days, jac: +jac.toFixed(2), bgCommon, enCommon });
  }
}
pairs.sort((x, y) => y.bgCommon - x.bgCommon || y.days - x.days);
console.log(tag + ' 候选时序对 ' + pairs.length + ' 组（显示前 25）\n');
for (const p of pairs.slice(0, 25)) {
  console.log('── 相隔 ' + p.days.toFixed(1) + ' 天 · 量词重叠 ' + p.jac + ' · 公共词 ' + p.bgCommon + '/' + p.enCommon);
  console.log('  OLD #' + p.a.seq + ' : ' + one(p.a.text).slice(0, 130));
  console.log('  NEW #' + p.b.seq + ' : ' + one(p.b.text).slice(0, 130));
}
