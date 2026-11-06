/* 回填代价测量：单条会话索引耗时 / 库膨胀 / 峰值内存
 *
 * ⚠️ 用产品自己的 nextBackfill + ingestSession，不另写扫描逻辑 ——
 *    上一轮刚踩过「复刻须逐字照抄」的坑，这里直接调生产函数。
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const DATA = path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });

const dbFile = path.join(DATA, 'ck-memory', 'ck.db');
const dbMB = () => +(fs.statSync(dbFile).size / 1048576).toFixed(1);

/* 自己扫一遍目录（只读，与 scanSessions 同规则：.jsonl 且 >=1KB） */
function walk() {
  const root = path.join(process.env.USERPROFILE || process.env.HOME, '.workbuddy', 'projects');
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(root, d.name)); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(root, d.name, f);
      let st;
      try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.size < 1024) continue;
      out.push({ sid: f.replace(/\.jsonl$/, ''), proj: d.name, path: fp, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  out.sort((a, b) => a.size - b.size);
  return out;
}

const db = ck._internal.open();
const have = new Set(db.prepare('SELECT sid FROM sessions').all().map((r) => r.sid));
const all = walk();
const miss = all.filter((x) => !have.has(x.sid));

console.log('磁盘会话', all.length, '｜已索引', have.size, '｜待回填', miss.length);
const totalMB = miss.reduce((s, x) => s + x.size, 0) / 1048576;
console.log('待回填总量', totalMB.toFixed(1), 'MB');
console.log('尺寸分位 MB: p10', (miss[Math.floor(miss.length * 0.1)].size / 1048576).toFixed(0),
  'p50', (miss[Math.floor(miss.length * 0.5)].size / 1048576).toFixed(1),
  'p90', (miss[Math.floor(miss.length * 0.9)].size / 1048576).toFixed(0),
  'max', (miss[miss.length - 1].size / 1048576).toFixed(0));

/* 取几个尺寸档位做实测：小的、中位、大的、最大的 */
const picks = [];
const pickNear = (targetMB) => {
  let best = null, bd = Infinity;
  for (const x of miss) {
    const d = Math.abs(x.size / 1048576 - targetMB);
    if (d < bd) { bd = d; best = x; }
  }
  if (best && !picks.includes(best)) picks.push(best);
};
[1, 5, 20, 60, 150, 383].forEach(pickNear);

console.log('\n=== 实测索引代价 ===');
console.log('会话      大小MB   耗时s   行数    库MB   MB/s');
for (const p of picks) {
  const t0 = Date.now();
  const m0 = process.memoryUsage().rss;
  let r = { added: 0, error: '' };
  try { r = ck._internal.ingestSession(db, p, {}); } catch (e) { r = { added: 0, error: e.message }; }
  const dt = (Date.now() - t0) / 1000;
  const m1 = process.memoryUsage().rss;
  const sizeMB = p.size / 1048576;
  console.log(
    p.sid.slice(0, 8).padEnd(9),
    sizeMB.toFixed(1).padStart(7),
    dt.toFixed(1).padStart(7),
    String(r.added || 0).padStart(7),
    dbMB().toFixed(1).padStart(7),
    (sizeMB / Math.max(dt, 0.01)).toFixed(1).padStart(6),
    r.error ? ' ERR ' + r.error : '',
    ' rssΔ' + ((m1 - m0) / 1048576).toFixed(0) + 'MB'
  );
}
console.log('\n最终库大小', dbMB(), 'MB');
console.log('seg 总行数', db.prepare('SELECT COUNT(*) c FROM seg').get().c);
