/* probe-dup-sessions.js — 判断疑似重复会话是否同源（只读）
   判据层级：
     L1 文件大小几乎相同
     L2 首行 meta（cwd / timestamp / sessionId）
     L3 前 N 行内容 hash 集合重叠率
     L4 抽样行（每 1/10）内容 hash 重叠率
*/
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const CAND = [
  '4bae518c', '2a616066', '882c357a',
  '7b03f0', '39229f',
];

const ROOT = 'C:/Users/Lyon/.workbuddy/projects';

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

const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/* 提取一条记录里「有语义」的部分，去掉 uuid / timestamp 这类每次不同但内容相同的字段 */
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
  return role + '\u0000' + text.trim();
}

function scan(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter((x) => x.trim());
  const out = { file, bytes: fs.statSync(file).size, lines: lines.length };
  /* L2 首行 meta */
  try {
    const o = JSON.parse(lines[0]);
    out.meta0 = {
      type: o.type,
      cwd: o.cwd,
      sessionId: o.sessionId || o.session_id || o.id,
      timestamp: o.timestamp,
    };
  } catch (_) { out.meta0 = null; }

  /* L3 前 200 条语义 hash */
  out.head = lines.slice(0, 200).map(canon).filter(Boolean).map(h);
  /* 尾部 200 条 */
  out.tail = lines.slice(-200).map(canon).filter(Boolean).map(h);
  /* L4 每 1/50 抽样（跨全程） */
  const step = 50;
  out.sample = [];
  for (let i = 0; i < lines.length; i += step) {
    const c = canon(lines[i]);
    if (c) out.sample.push(h(c));
  }
  /* 首条真实用户消息文本，最直观 */
  out.firstUser = null;
  for (const l of lines.slice(0, 40)) {
    try {
      const o = JSON.parse(l);
      const m = o.message || {};
      if (m.role === 'user') {
        const c = m.content;
        const t = typeof c === 'string' ? c : (Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b && b.text) || '').join('') : '');
        if (t.trim()) { out.firstUser = t.trim().replace(/\s+/g, ' ').slice(0, 120); break; }
      }
    } catch (_) { /* 单行坏不致命 */ }
  }
  return out;
}

function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  let n = 0;
  for (const x of a) if (sb.has(x)) n++;
  return n / Math.min(a.length, b.length);
}

const info = [];
for (const p of CAND) {
  const f = findFile(p);
  if (!f) { console.log(p, 'NOT FOUND'); continue; }
  const s = scan(f);
  s.pfx = p;
  info.push(s);
}

console.log('=== 基本 ===');
for (const s of info) {
  console.log(s.pfx, '| lines', String(s.lines).padStart(7), '| size', (s.bytes / 1048576).toFixed(1) + 'MB', '| sid', (s.meta0 && s.meta0.sessionId || '').toString().slice(0, 12), '| ts0', (s.meta0 && s.meta0.timestamp) || '-');
  console.log('     cwd:', (s.meta0 && s.meta0.cwd) || '-');
  console.log('     firstUser:', (s.firstUser || '(none)').slice(0, 100));
}

console.log('\n=== 两两重叠（head / tail / sample）===');
for (let i = 0; i < info.length; i++) {
  for (let j = i + 1; j < info.length; j++) {
    const a = info[i], b = info[j];
    console.log(
      a.pfx + ' vs ' + b.pfx,
      '| head', overlap(a.head, b.head).toFixed(3),
      '| tail', overlap(a.tail, b.tail).toFixed(3),
      '| sample', overlap(a.sample, b.sample).toFixed(3),
      '| lenΔ', Math.abs(a.lines - b.lines)
    );
  }
}
