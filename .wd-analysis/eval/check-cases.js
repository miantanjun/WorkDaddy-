/* 评测集自检：确认每道题的 gold 行**真的可被召回**
 *
 * 为什么必须先做这一步：
 *   默认检索带 `AND COALESCE(s.pri,0) >= 1 AND COALESCE(s.noise,0)=0`。
 *   若 gold 落在 pri=0（过程话）或 noise=1 的行上，**任何实现都不可能召回它** ——
 *   那是题标错了，不是检索差。这种错不会报错，只会把 Recall 压低，
 *   然后被误读成「检索坏了」，进而推动一堆无效优化。
 *
 * 检查项：
 *   1. gold seq 是否真的存在
 *   2. 该行 pri / noise / kind 是否满足默认检索的可见条件
 *   3. 该会话总行数、gold 是否落在合理范围
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { CASES } = require('./cases.js');

const st = db.prepare('SELECT seq, kind, COALESCE(pri,0) pri, COALESCE(noise,0) noise, LENGTH(text) len FROM seg WHERE sid=? AND seq=?');
let bad = 0, warn = 0;
console.log('用例自检（默认检索可见性：pri>=1 且 noise=0 且 kind in user/assistant）');
console.log('='.repeat(96));
for (const c of CASES) {
  const gold = c.gold || [];
  if (!gold.length) { console.log('  ' + c.id.padEnd(5) + ' 负例，跳过'); continue; }
  const probs = [];
  const info = [];
  for (const s of gold) {
    const r = st.get(c.sid, s);
    if (!r) { probs.push('seq ' + s + ' 不存在'); continue; }
    info.push(s + ':p' + r.pri + (r.noise ? '/noise' : '') + '/' + r.kind.slice(0, 5) + '/' + r.len + '字');
    if (r.pri < 1) probs.push('seq ' + s + ' 的 pri=' + r.pri + ' ⇒ **默认检索永远看不到**');
    if (r.noise) probs.push('seq ' + s + ' 是 noise=1');
    if (r.kind !== 'user' && r.kind !== 'assistant') probs.push('seq ' + s + ' 的 kind=' + r.kind + ' ⇒ 被 kind 过滤掉');
  }
  const mark = probs.length ? '❌' : '  ';
  if (probs.length) bad++;
  console.log(mark + ' ' + c.id.padEnd(5) + ' ' + c.cat.padEnd(9) + ' ' + info.join(' , '));
  for (const p of probs) console.log('         ⚠️  ' + p);
  void warn;
}
console.log('='.repeat(96));
console.log(bad ? '⛔ ' + bad + ' 道题的 gold 不可被默认检索召回 —— 必须先修题' : '✅ 全部 gold 都满足默认检索的可见条件');
