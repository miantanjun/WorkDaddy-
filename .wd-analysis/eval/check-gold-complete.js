/* 评测集「gold 完整性」抽检：题目真答案可能不止标的那几行
 *
 * 这是评测集最容易犯的第二类错（第一类是 gold 不可见）：
 *   同一结论在会话里常出现多次（复述 / 引用 / 总结），只标了其中一条 ⇒
 *   检索命中了另一条等价表述，却被判「未召回」。
 *   这种错**只会让指标偏低**，而且看起来像「检索差」。
 *
 * 做法：拿每题的 gold 原文，抽出最具辨识度的片段（数字串 / 罕用实体 / 长汉字词），
 *   全会话扫一遍，列出还有哪些 pri>=1 行也含这些片段 —— 人工判断是否等价。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { CASES } = require('./cases.js');

const only = process.argv[2];
const st = db.prepare('SELECT seq, text, COALESCE(pri,0) pri FROM seg WHERE sid=? AND seq=?');
const all = db.prepare(`SELECT seq, text FROM seg WHERE sid=? AND COALESCE(pri,0)>=1
  AND COALESCE(noise,0)=0 AND kind IN ('user','assistant') ORDER BY seq`);

for (const c of CASES) {
  if (!c.gold || !c.gold.length) continue;
  if (only && c.id !== only) continue;
  const texts = [];
  for (const s of c.gold) { const r = st.get(c.sid, s); if (r) texts.push(r.text); }
  if (!texts.length) continue;
  // 提取指纹：连续数字串（>=4 位，含千分位）、英文实体、长汉字串
  const fps = new Set();
  for (const t of texts) {
    for (const m of String(t).matchAll(/\d[\d,]{3,}/g)) fps.add(m[0]);
    for (const m of String(t).matchAll(/[A-Za-z]{2,}[-_#]?[\dA-Za-z]*\d[\w.-]*/g)) if (m[0].length >= 5) fps.add(m[0]);
    for (const m of String(t).matchAll(/[\u4e00-\u9fa5]{6,12}/g)) fps.add(m[0]);
  }
  const list = [...fps].filter((x) => x.length >= 4).slice(0, 400);
  const rows = all.all(c.sid);
  const hits = new Map();
  for (const r of rows) {
    if (c.gold.includes(r.seq)) continue;
    let n = 0; const which = [];
    for (const f of list) if (String(r.text).includes(f)) { n++; which.push(f); }
    if (n >= 2) hits.set(r.seq, { n, which: which.slice(0, 4) });
  }
  const top = [...hits.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  console.log('\n' + c.id + '  「' + c.q + '」  gold=' + c.gold.join(',') + '  指纹 ' + list.length + ' 个');
  if (!top.length) console.log('    （无可疑等价行）');
  for (const [seq, v] of top) {
    console.log('    疑似 seq=' + seq + '  共命中 ' + v.n + ' 个指纹  ' + v.which.join(' | '));
  }
}
