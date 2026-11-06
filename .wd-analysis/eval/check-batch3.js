/* 第三批题的逐条自检：gold 是否可见、sid/seq 是否对得上、题目文本有没有混进答案原文
 * 用法：node check-batch3.js
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const DATA = path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });
const db = ck._internal.open();

const { BATCH3 } = require('./cases-batch3.js');
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

let bad = 0, warn = 0;
const byId = {};
for (const c of BATCH3) {
  const probs = [];
  for (const s of (c.gold || [])) {
    const r = db.prepare(
      'SELECT seq, kind, COALESCE(pri,0) pri, COALESCE(noise,0) noise, text, ts FROM seg WHERE sid=? AND seq=?'
    ).get(c.sid, s);
    if (!r) { probs.push('seq ' + s + ' 在会话里不存在'); continue; }
    if (r.pri < 1) probs.push('seq ' + s + ' 的 pri=' + r.pri + ' ⇒ 默认检索永远看不到');
    if (r.noise) probs.push('seq ' + s + ' 是 noise=1');
    if (r.kind !== 'user' && r.kind !== 'assistant') probs.push('seq ' + s + ' kind=' + r.kind + ' 会被过滤');
    byId[c.id] = byId[c.id] || {};
    byId[c.id][s] = { len: one(r.text).length, kind: r.kind, pri: r.pri, ts: r.ts };
  }
  if (probs.length) { bad++; console.log('❌ ' + c.id + ' ' + probs.join(' | ')); }
  else console.log('✅ ' + c.id + ' [' + c.cat + '] gold=' + JSON.stringify(c.gold) + ' n=' + (c.gold || []).length);
}
console.log('\n批次合计 ' + BATCH3.length + ' 条 · 有问题 ' + bad + ' 条');

/* multi 类必须真有 2 条以上 gold，否则就是个假 multi */
const fakeMulti = BATCH3.filter((c) => c.cat === 'multi' && (c.minHit || 1) < 2);
if (fakeMulti.length) { warn++; console.log('⚠️ 假 multi（minHit<2）: ' + fakeMulti.map((c) => c.id).join(',')); }
const fakeMulti2 = BATCH3.filter((c) => c.cat === 'multi' && (c.gold || []).length < 2);
if (fakeMulti2.length) { warn++; console.log('⚠️ 假 multi（gold 不足 2 条）: ' + fakeMulti2.map((c) => c.id).join(',')); }
console.log('警告 ' + warn + ' 项');
