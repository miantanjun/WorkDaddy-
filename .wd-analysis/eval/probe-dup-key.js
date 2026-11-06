/* probe-dup-key.js — 为「会话判重」找一个全库鲁棒的判据
 * 候选：
 *   K1 首行 id（message 行是 message uuid；session-meta 行是 meta uuid）
 *   K2 首行 sessionId 字段
 *   K3 (首行 timestamp + cwd)
 *   K4 文件大小完全相同
 * ⚠️ 必须验证误判率：把不同会话误判成同一条 = 丢数据，比重复更严重。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.env.USERPROFILE || process.env.HOME, '.workbuddy', 'projects');

function walk() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, d.name)); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(ROOT, d.name, f);
      let st;
      try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.size < 1024) continue;
      out.push({ sid: f.replace(/\.jsonl$/, ''), proj: d.name, path: fp, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/* 只读首行，避免 1.5GB 全读 */
function headLine(fp) {
  const fd = fs.openSync(fp, 'r');
  try {
    const b = Buffer.alloc(8192);
    const n = fs.readSync(fd, b, 0, 8192, 0);
    const s = b.toString('utf8', 0, n);
    const i = s.indexOf('\n');
    return i >= 0 ? s.slice(0, i) : s;
  } finally { fs.closeSync(fd); }
}

const all = walk();
console.log('扫描', all.length, '条会话');

for (const f of all) {
  try { f.h0 = JSON.parse(headLine(f.path)); } catch (_) { f.h0 = null; }
}

const k1 = (f) => (f.h0 && f.h0.id) || null;
const k2 = (f) => (f.h0 && f.h0.sessionId) || null;
const k3 = (f) => (f.h0 ? f.h0.timestamp + '|' + (f.h0.cwd || '') : null);

function groups(keyFn, label) {
  const m = new Map();
  let noKey = 0;
  for (const f of all) {
    const k = keyFn(f);
    if (!k) { noKey++; continue; }
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  const dups = [...m.entries()].filter(([, v]) => v.length > 1);
  console.log('\n--- ' + label + ' ---');
  console.log('  可用键', all.length - noKey, '/ 无键', noKey, '/ 碰撞组', dups.length);
  let extra = 0, bytes = 0;
  for (const [k, v] of dups) {
    extra += v.length - 1;
    bytes += v.slice(1).reduce((s, x) => s + x.size, 0);
    console.log('  组', k.slice(0, 20), 'x' + v.length);
    for (const f of v) console.log('     ', f.sid.slice(0, 8), (f.size / 1048576).toFixed(2) + 'MB', f.proj.slice(0, 42));
  }
  console.log('  ⇒ 可删冗余', extra, '条 /', (bytes / 1048576).toFixed(1), 'MB');
  return { dups, extra, bytes };
}

const g1 = groups(k1, 'K1 首行 id');
const g2 = groups(k2, 'K2 首行 sessionId');
const g3 = groups(k3, 'K3 首行 timestamp+cwd');

console.log('\n=== 判据一致性：K1 判同的组，K2 是否也判同？ ===');
let agree = 0, dis = 0;
for (const [, v] of g1.dups) {
  const sids = new Set(v.map((f) => k2(f)));
  if (sids.size === 1) agree++;
  else { dis++; console.log('  ⚠️ K1 判同但 K2 不同:', v.map((f) => f.sid.slice(0, 8) + '→' + String(k2(f)).slice(0, 8)).join(', ')); }
}
console.log('  一致', agree, '/ 分歧', dis);

console.log('\n=== 反向：K2 判同的组，K1 是否也判同？ ===');
agree = 0; dis = 0;
for (const [, v] of g2.dups) {
  const ids = new Set(v.map((f) => k1(f)));
  if (ids.size === 1) agree++;
  else { dis++; console.log('  ⚠️ K2 判同但 K1 不同:', v.map((f) => f.sid.slice(0, 8) + '→' + String(k1(f)).slice(0, 8)).join(', ')); }
}
console.log('  一致', agree, '/ 分歧', dis);
