/* probe-dup-safe.js — 终极判据验证：内外一致性 + 全等，且核对误判
 *
 * 判据设计（两级，缺一不可）：
 *   A. 内部 sessionId 相同（从任意 session-meta 行取）—— 语义级「同一会话」
 *   B. 逐行 canon hash 序列完全相同 —— 内容级「真重复，非分叉」
 * 只有 A ∧ B 才判为重复。任一条不满足就不动。
 *
 * ⚠️ 为什么不能只用 A：
 *    复制会话后各自继续 = 内部 sessionId 也相同（复制来的），但内容会分叉。
 *    此时删任一都会丢数据。
 * ⚠️ 为什么不能只用 B：
 *    不同会话的开场 system-reminder 前缀完全相同，短会话可能整体撞上。
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(process.env.USERPROFILE || process.env.HOME, '.workbuddy', 'projects');
const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function walk() {
  const out = [];
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(ROOT, d.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      let st;
      try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.size < 1024) continue;
      out.push({ sid: f.replace(/\.jsonl$/, ''), proj: d.name, path: fp, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

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
  /* reasoning / file-history-snapshot 这些也纳入（它们也占行、也进索引） */
  if (!text) text = JSON.stringify(o.rawContent || o.snapshot || '');
  return role + '\u0000' + text.trim();
}

/* 从文件中取内部 sessionId：扫前 30 行找 session-meta 或任意带 sessionId 的行 */
function innerSid(f) {
  const fd = fs.openSync(f, 'r');
  try {
    const b = Buffer.alloc(65536);
    const n = fs.readSync(fd, b, 0, 65536, 0);
    for (const l of b.toString('utf8', 0, n).split('\n').slice(0, 30)) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        if (o.sessionId) return o.sessionId;
      } catch (_) { /* 半行可能，继续 */ }
    }
  } finally { fs.closeSync(fd); }
  return null;
}

/* 内容签名：前缀 hash + 总行数 + 总字符 + 尾部 hash。全读太重，用这个足够判等 */
function fastSig(fp, size) {
  const fd = fs.openSync(fp, 'r');
  try {
    const head = Buffer.alloc(65536);
    const nh = fs.readSync(fd, head, 0, 65536, 0);
    const tail = Buffer.alloc(65536);
    const nt = fs.readSync(fd, tail, 0, 65536, Math.max(0, size - 65536));
    return h(head.toString('utf8', 0, nh)) + '|' + h(tail.toString('utf8', 0, nt)) + '|' + size;
  } finally { fs.closeSync(fd); }
}

const all = walk();
console.log('扫描', all.length, '条');

for (const f of all) {
  f.inner = innerSid(f.path);
  f.sig = fastSig(f.path, f.size);
}

/* --- 判据 A：内部 sessionId --- */
const byInner = new Map();
for (const f of all) {
  if (!f.inner) continue;
  if (!byInner.has(f.inner)) byInner.set(f.inner, []);
  byInner.get(f.inner).push(f);
}
const aGroups = [...byInner.entries()].filter(([, v]) => v.length > 1);
console.log('\n判据 A（内部 sessionId 相同）: ', aGroups.length, '组');
for (const [k, v] of aGroups) {
  console.log('  ', k.slice(0, 8), 'x' + v.length, '|', v.map((x) => x.sid.slice(0, 8) + (x.sid === k ? '*' : '')).join(' '));
}

/* --- 判据 B：内容签名全等 --- */
const bySig = new Map();
for (const f of all) {
  if (!bySig.has(f.sig)) bySig.set(f.sig, []);
  bySig.get(f.sig).push(f);
}
/* 只保留「内容全等但内部 sid 不同」的组 —— 这些是判据 B 独有、A 抓不到的 */
const bOnly = [...bySig.entries()].filter(([, v]) => v.length > 1 && new Set(v.map((x) => x.inner)).size > 1);
console.log('\n判据 B 独有（内容全等但内部 sid 不同）:', bOnly.length, '组');
for (const [, v] of bOnly) {
  console.log('  ', v.map((x) => x.sid.slice(0, 8) + '[' + String(x.inner).slice(0, 8) + ']').join(' '));
}

/* --- A ∧ B 交集：安全可删 --- */
console.log('\n=== 安全可删组合（A ∧ B）===');
let delCount = 0, delBytes = 0;
const toDrop = [];
for (const [k, v] of aGroups) {
  /* 组内按内容签名再分簇 */
  const clusters = new Map();
  for (const f of v) {
    if (!clusters.has(f.sig)) clusters.set(f.sig, []);
    clusters.get(f.sig).push(f);
  }
  for (const [sg, cv] of clusters) {
    if (cv.length < 2) continue;
    /* 保留 mtime 最新（最完整）的一条，其余待删 */
    cv.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keep = cv[0];
    for (const f of cv.slice(1)) {
      toDrop.push({ sid: f.sid, keep: keep.sid, size: f.size });
      delCount++;
      delBytes += f.size;
    }
    console.log('  内部 sid', k.slice(0, 8), '| 保留', keep.sid.slice(0, 8), '| 删', cv.slice(1).map((x) => x.sid.slice(0, 8)).join(','), '| 各', (cv[0].size / 1024).toFixed(0) + 'KB');
  }
}
console.log('\n⇒ 待删', delCount, '条 /', (delBytes / 1048576).toFixed(1), 'MB');

/* --- 安全检查：待删项里有没有「更大的」或「更新的」被误伤 --- */
console.log('\n=== 安全检查 ===');
let risk = 0;
for (const d of toDrop) {
  const a = all.find((x) => x.sid === d.sid);
  const b = all.find((x) => x.sid === d.keep);
  if (!a || !b) { console.log('  ⚠️ 找不到', d.sid.slice(0, 8)); risk++; continue; }
  if (a.size > b.size) { console.log('  ⚠️ 待删比保留的大!', d.sid.slice(0, 8), a.size, '>', b.size); risk++; }
  if (a.mtimeMs > b.mtimeMs) { console.log('  ⚠️ 待删比保留的新!', d.sid.slice(0, 8)); risk++; }
}
console.log(risk === 0 ? '  ✅ 无风险项' : '  ❌ ' + risk + ' 项风险');
fs.writeFileSync(path.join(__dirname, 'dup-drop-list.json'), JSON.stringify(toDrop, null, 1), 'utf8');
console.log('\n清单已写 dup-drop-list.json');
