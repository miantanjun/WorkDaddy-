/* probe-dup-content.js — 对 K1 判同的 6 组做内容级验证
 * 判据：逐行 canon hash 序列
 *   完全相同  ⇒ 真重复，可删
 *   前缀相同、后缀不同 ⇒ 分叉（复制会话后各自继续），不可删
 *   完全不同  ⇒ 只是首行 meta 相同（meta uuid 复用），不可删
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(process.env.USERPROFILE || process.env.HOME, '.workbuddy', 'projects');
const GROUPS = [
  ['0cbf865a', '678e84ea', '715a0f25'],
  ['24772a94', '4706a471'],
  ['0070ec5d', '3ce7b0d5', '8e737ab3'],
  ['02aeabe5', '8c03e010', 'ad6980e6'],
  ['04b32e9b', '602038c0', 'ba1b6a09'],
  ['6db59e51', 'b0c64fcd', 'edf6003c'],
];

function findFile(pfx) {
  for (const d of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, d);
    let st;
    try { st = fs.statSync(dir); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(pfx) && f.endsWith('.jsonl')) return path.join(dir, f);
    }
  }
  return null;
}

const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function canon(line) {
  let o;
  try { o = JSON.parse(line); } catch (_) { return null; }
  const msg = o.message || {};
  const role = msg.role || o.type || '';
  let text = '';
  const c = msg.content;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (typeof b === 'string') text += b;
      else if (b && typeof b === 'object') {
        if (typeof b.text === 'string') text += b.text;
        if (typeof b.content === 'string') text += b.content;
      }
    }
  }
  if (!text && typeof o.content === 'string') text = o.content;
  return role + '\u0000' + text.trim();
}

function sig(fp) {
  const raw = fs.readFileSync(fp, 'utf8');
  const lines = raw.split('\n').filter((x) => x.trim());
  const hs = [];
  let bad = 0;
  for (const l of lines) {
    const c = canon(l);
    if (c === null) { bad++; continue; }
    hs.push(h(c));
  }
  return { lines: lines.length, hs, bad };
}

function lcp(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  for (; i < n; i++) if (a[i] !== b[i]) break;
  return i;
}

for (const g of GROUPS) {
  console.log('\n=== 组', g.join(' / '), '===');
  const sigs = g.map((p) => {
    const fp = findFile(p);
    return fp ? { pfx: p, fp, ...sig(fp) } : { pfx: p, missing: true };
  });
  for (const s of sigs) {
    if (s.missing) { console.log(' ', s.pfx, 'MISSING'); continue; }
    console.log(' ', s.pfx, '| lines', String(s.lines).padStart(5), '| hash', s.hs.length, '| 坏行', s.bad);
  }
  const base = sigs[0];
  if (base.missing) continue;
  for (let i = 1; i < sigs.length; i++) {
    const s = sigs[i];
    if (s.missing) continue;
    const L = lcp(base.hs, s.hs);
    const identical = base.hs.length === s.hs.length && L === base.hs.length;
    const rel = identical ? 'IDENTICAL' : (L === Math.min(base.hs.length, s.hs.length) ? 'PREFIX(较短者是前缀)' : 'FORK@' + L);
    console.log('   ', base.pfx, 'vs', s.pfx, '| 共同前缀', L, '/', base.hs.length + ',' + s.hs.length, '⇒', rel);
    if (!identical && L > 0) {
      console.log('        分叉处内容 A:', (base.hs[L] || '-').slice(0, 8), ' B:', (s.hs[L] || '-').slice(0, 8));
    }
  }
}
