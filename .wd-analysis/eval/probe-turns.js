/* 回合摘要：把会话切成「一轮提问 + 该轮结论」的配对，供人工挑题
 *
 * 为什么需要：
 *   扩题必须有可靠 gold。最省事又最可靠的来源是「用户真实问过 + 助手真的答了」的天然配对 ——
 *   query 是人的真实措辞、gold 就在那一段，不存在我拍脑袋编一个答案标错位置的风险。
 *
 * 输出每轮：user 提问全文（截断）+ 该轮最后一条 pri=1 的结论行（截断）+ 两者的 seq
 *   ⇒ 挑题时只要看这份摘要，不必翻原文。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const DATA = path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });
const db = ck._internal.open();

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}
const SIDS = {
  '8f92c3fc': '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  '3a1eef3c': '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  '96f77df6': '96f77df6-452b-4c05-916f-92e30accd72b',
};
const tag = argv.sid || '8f92c3fc';
const sid = SIDS[tag];
if (!sid) { console.error('未知 sid ' + tag); process.exit(2); }

// ⚠️ 只取 pri>=1 且非 noise：pri=0 的过程话数量是它的 40 倍，混进来会淹没摘要
const rows = db.prepare(`
  SELECT seq, kind, COALESCE(pri,0) pri, ts, text
  FROM seg
  WHERE sid=? AND COALESCE(pri,0)>=1 AND COALESCE(noise,0)=0
    AND kind IN ('user','assistant')
  ORDER BY seq`).all(sid);

const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const turns = [];
let cur = null;
for (const r of rows) {
  if (r.kind === 'user') {
    if (cur) turns.push(cur);
    cur = { useq: r.seq, q: one(r.text), ends: [], lastA: null };
  } else if (cur) {
    cur.ends.push(r.seq);
    cur.lastA = { seq: r.seq, text: one(r.text) };
  }
}
if (cur) turns.push(cur);

const lim = Number(argv.limit) || 0;
const out = [];
out.push('# ' + tag + ' 共 ' + turns.length + ' 轮（每轮：user 提问 → 该轮末条结论）\n');
let k = 0;
for (const t of turns) {
  if (lim && k >= lim) break;
  k++;
  // 跳过纯自动续跑 / 空提问
  if (/^(继续|继续。|continue)$/i.test(t.q.trim())) continue;
  if (t.q.length < 8) continue;
  out.push(`## turn ${k}  user#${t.useq}`);
  out.push('Q: ' + t.q.slice(0, 260));
  if (t.lastA) out.push('A#' + t.lastA.seq + ': ' + t.lastA.text.slice(0, 340));
  out.push('');
}
const dest = path.join(__dirname, 'out', 'turns-' + tag + '.md');
fs.mkdirSync(path.dirname(dest), { recursive: true });
const s = out.join('\n');
fs.writeFileSync(dest, s, 'utf8');
console.log('turn 总数=' + turns.length + ' 输出轮数=' + k + ' 字符=' + s.length + ' -> ' + dest);
