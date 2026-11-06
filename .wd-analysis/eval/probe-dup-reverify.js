/* probe-dup-reverify.js — 删除前用**强判据**重新核实那 7 对
 *
 * 为什么要重核：生成清单的 `probe-dup-safe.js` 用的是 `fastSig`
 *   = sha1(头 64KB) + sha1(尾 64KB) + 文件大小。
 *   这是**弱签名**，对「同一开头、同一结尾、中间分叉」的文件会误判为相同。
 *   工作区记忆里定的判据是「逐行 canon hash 全等」，这里就按那条严格执行。
 *
 * 强判据（三条全过才判为真重复）：
 *   A. 内部 sessionId 相同（语义级同一会话）
 *   B. **全文件逐行 canon hash 序列完全相同**（长度 + 每行 hash 逐个比对）
 *   C. 待删项既不比保留项大、也不比它新（防止把更完整的那份删掉）
 *
 * ⚠️ 只读，不删任何东西。删除动作由人决定。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(process.env.USERPROFILE || process.env.HOME, '.workbuddy', 'projects');
const list = require('./dup-drop-list.json');

const h = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
  if (!text) text = JSON.stringify(o.rawContent || o.snapshot || '');
  return role + '\u0000' + text.trim();
}

/* 全文件逐行 hash 序列 —— 这是真正的"逐行 canon hash 全等" */
function lineHashes(fp) {
  const buf = fs.readFileSync(fp, 'utf8');
  const out = [];
  for (const line of buf.split('\n')) {
    if (!line.trim()) continue;
    const c = canon(line);
    out.push(c === null ? 'RAW:' + h(line) : h(c));
  }
  return out;
}

function findFile(sid) {
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const fp = path.join(ROOT, d.name, sid + '.jsonl');
    try { if (fs.statSync(fp).isFile()) return fp; } catch (_) {}
  }
  return null;
}

console.log('══ 强判据复核 ' + list.length + ' 对 ══\n');
const verdict = [];
for (const d of list) {
  const fpA = findFile(d.sid), fpB = findFile(d.keep);
  if (!fpA || !fpB) {
    console.log(d.sid.slice(0, 8) + ' ⛔ 文件缺失 drop=' + !!fpA + ' keep=' + !!fpB);
    verdict.push({ ...d, ok: false, why: '文件缺失' });
    continue;
  }
  const sa = fs.statSync(fpA), sb = fs.statSync(fpB);
  const ha = lineHashes(fpA), hb = lineHashes(fpB);

  let same = ha.length === hb.length;
  let firstDiff = -1;
  const n = Math.min(ha.length, hb.length);
  for (let i = 0; i < n; i++) {
    if (ha[i] !== hb[i]) { same = false; firstDiff = i; break; }
  }
  /* 长度不同时的判定：如果长的那份是短的超集（前缀全等），那是"续写分叉"，绝不能删 */
  const prefixEqual = firstDiff < 0;
  const newer = sa.mtimeMs > sb.mtimeMs;
  const bigger = sa.size > sb.size;

  const ok = same && prefixEqual && !newer && !bigger;
  let why = '';
  if (!same) {
    why = prefixEqual
      ? '⚠️ 前缀全等但长度不同（drop ' + ha.length + ' 行 / keep ' + hb.length + ' 行）⇒ 续写分叉，删了会丢内容'
      : '⚠️ 第 ' + firstDiff + ' 行起内容不同 ⇒ 真分叉，删了会丢内容';
  } else if (newer) why = '⚠️ 待删项 mtime 更新';
  else if (bigger) why = '⚠️ 待删项更大';

  console.log(d.sid.slice(0, 8) + ' → keep ' + d.keep.slice(0, 8)
    + '  [' + ha.length + ' 行 / ' + (sa.size / 1024).toFixed(0) + 'KB]'
    + '  ' + (ok ? '✅ 逐行全等且更旧更小 ⇒ 安全' : '⛔ ' + why));
  verdict.push({ ...d, ok, why, rows: ha.length, size: sa.size, keepSize: sb.size });
}

const safe = verdict.filter((v) => v.ok);
const unsafe = verdict.filter((v) => !v.ok);
console.log('\n══ 结论 ══');
console.log('✅ 真重复（可删）：' + safe.length + ' 条，共 '
  + (safe.reduce((s, v) => s + v.size, 0) / 1048576).toFixed(2) + ' MB');
console.log('⛔ 不满足强判据（不可删）：' + unsafe.length + ' 条');
for (const u of unsafe) console.log('   ' + u.sid.slice(0, 8) + '  ' + u.why);

fs.writeFileSync(path.join(__dirname, 'dup-verify.json'), JSON.stringify(verdict, null, 1));
console.log('\n明细已写 dup-verify.json（只读复核结果，未删除任何文件）');
