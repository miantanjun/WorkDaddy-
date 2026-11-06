// 拆解「磁盘上 N 条会话」的构成：已索引 / 太小 / 子代理 / 重复 / 待补
// 目的：让面板文案能写准确，而不是拍脑袋。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const I = ck._internal || {};
const scanSessions = I.scanSessions;
const backfillWorthy = I.backfillWorthy;
const buildDupIndex = I.buildDupIndex;
const isDupNonFirst = I.isDupNonFirst;

if (!scanSessions) { console.log('scanSessions 未导出'); process.exit(1); }

const scanned = scanSessions({ fresh: true });
const onDisk = scanned.length;

// 已索引集合（db 未直接导出，走 open()）
let db = null;
try { db = ck._internal.open(); } catch (e) { console.log('open 失败:', e.message); }
let indexed = new Set();
if (db) {
  for (const r of db.prepare('SELECT sid FROM sessions').all()) indexed.add(r.sid);
}

const followed = new Set((I.state && I.state.follow) || []);
const firstOf = buildDupIndex ? buildDupIndex(scanned) : null;

let nIndexed = 0, nTooSmall = 0, nSub = 0, nDup = 0, nPending = 0, nFollowedIdx = 0;
const tooSmallSizes = [];
const subList = [];
const dupList = [];

for (const f of scanned) {
  const isIdx = indexed.has(f.sid);
  const proj = String(f.proj || '');
  const sub = proj === 'subagents' || proj.indexOf('subagents') >= 0;
  const small = f.size < 1024 * 1024;
  const dup = firstOf && !isIdx && isDupNonFirst && isDupNonFirst(f, firstOf);

  if (isIdx) {
    nIndexed++;
    if (followed.has(f.sid)) nFollowedIdx++;
    continue;
  }
  if (sub) { nSub++; subList.push(f.sid.slice(0, 8) + ' ' + (f.size / 1048576).toFixed(2) + 'MB'); continue; }
  if (small) { nTooSmall++; tooSmallSizes.push(f.size); continue; }
  if (dup) { nDup++; dupList.push(f.sid.slice(0, 8) + ' ' + (f.size / 1048576).toFixed(2) + 'MB ' + proj); continue; }
  nPending++;
}

const mb = (a) => (a / 1048576).toFixed(2);
console.log('===== 磁盘会话构成 =====');
console.log('磁盘总会话          :', onDisk);
console.log('已索引              :', nIndexed, ' 其中显式跟踪:', nFollowedIdx, '/ 跟踪名单:', followed.size);
console.log('未索引小计          :', onDisk - nIndexed);
console.log('  ├ 子代理临时会话  :', nSub);
console.log('  ├ <1MB 内容太少   :', nTooSmall);
console.log('  ├ 同尺寸重复      :', nDup);
console.log('  └ 够格但还没补    :', nPending);
console.log('校验合计            :', nIndexed + nSub + nTooSmall + nDup + nPending, onDisk === nIndexed + nSub + nTooSmall + nDup + nPending ? 'OK' : 'MISMATCH');

if (tooSmallSizes.length) {
  tooSmallSizes.sort((a, b) => a - b);
  console.log('\n<1MB 会话体积分布: min', mb(tooSmallSizes[0]), 'MB / 中位',
    mb(tooSmallSizes[Math.floor(tooSmallSizes.length / 2)]), 'MB / max', mb(tooSmallSizes[tooSmallSizes.length - 1]), 'MB');
  console.log('合计体积          :', (tooSmallSizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1), 'MB');
}
if (subList.length) console.log('\n子代理:', subList.slice(0, 10).join(' | '));
if (dupList.length) console.log('\n重复  :', dupList.slice(0, 10).join(' | '));

// 库内统计
if (db) {
  console.log('\n===== 库内 =====');
  console.log('sessions 表行数:', db.prepare('SELECT COUNT(*) c FROM sessions').get().c);
  console.log('seg 总行数     :', db.prepare('SELECT COUNT(*) c FROM seg').get().c);
}
