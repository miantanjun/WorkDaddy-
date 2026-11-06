/* 校验 cases-extra.js 里每道题的 gold 是否「真的可被召回」，并打印原文首句
 * 用法：node check-extra.js
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { EXTRA_CASES } = require('./cases-extra.js');

const st = db.prepare('SELECT seq, kind, COALESCE(pri,0) pri, COALESCE(noise,0) noise, text FROM seg WHERE sid=? AND seq=?');
let bad = 0;
for (const c of EXTRA_CASES) {
  const probs = [];
  const bits = [];
  for (const s of (c.gold || [])) {
    const r = st.get(c.sid, s);
    if (!r) { probs.push('seq ' + s + ' 不存在'); continue; }
    const one = String(r.text).replace(/\s+/g, ' ');
    bits.push(s + ':p' + r.pri + '/' + r.kind.slice(0, 5) + ' 「' + one.slice(0, 90) + '」');
    if (r.pri < 1) probs.push('seq ' + s + ' pri=' + r.pri + ' ⇒ 默认检索看不到');
    if (r.noise) probs.push('seq ' + s + ' noise=1');
    if (r.kind !== 'user' && r.kind !== 'assistant') probs.push('seq ' + s + ' kind=' + r.kind);
  }
  if (probs.length) bad++;
  console.log((probs.length ? '❌' : '  ') + ' ' + c.id.padEnd(5) + ' [' + c.cat + '] ' + c.q);
  for (const b of bits) console.log('        ' + b);
  for (const p of probs) console.log('        ⚠️  ' + p);
}
console.log('\n共 ' + EXTRA_CASES.length + ' 条新增；' + (bad ? '⛔ ' + bad + ' 条有问题' : '✅ 全部 gold 可见'));
