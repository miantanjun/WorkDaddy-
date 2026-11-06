/* 全量回填：把磁盘上所有已索引进来的会话都灌进测试库
 *
 * 目的：在**真实规模**（79 会话 / 100k 行）上重测跨会话路由 @1，
 *       而不是 3 会话那个「漂亮但不可靠」的 8/9。
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const DATA = path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });

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
  return out;
}

const db = ck._internal.open();
const have = new Set(db.prepare('SELECT sid FROM sessions').all().map((r) => r.sid));
const all = walk();
const todo = all.filter((x) => !have.has(x.sid));
console.log('待回填', todo.length, '条 /', (todo.reduce((s, x) => s + x.size, 0) / 1048576).toFixed(1), 'MB');

const t0 = Date.now();
let done = 0, added = 0, errs = 0;
for (const p of todo) {
  let r = { added: 0 };
  try { r = ck._internal.ingestSession(db, p, {}); } catch (e) { errs++; console.log('ERR', p.sid.slice(0, 8), e.message); continue; }
  added += r.added || 0;
  done++;
  if (done % 10 === 0) {
    const q = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
    console.log(`  ${done}/${todo.length}  +${added} 行  seg=${q}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
const dt = (Date.now() - t0) / 1000;
const nSess = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
const nSeg = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const dbMB = fs.statSync(path.join(DATA, 'ck-memory', 'ck.db')).size / 1048576;
console.log(`\n完成: ${done} 会话 / +${added} 行 / 错误 ${errs} / ${dt.toFixed(0)}s`);
console.log(`库: 会话 ${nSess} / seg ${nSeg} 行 / ${dbMB.toFixed(0)} MB`);

/* 写一份 sid 白名单，供后续探针判断"哪些会话属于真实规模" */
const sids = db.prepare('SELECT sid, title FROM sessions ORDER BY sid').all();
fs.writeFileSync(path.join(__dirname, 'scale-sids.json'),
  JSON.stringify(sids.map((r) => ({ sid: r.sid, title: String(r.title || '').slice(0, 60) })), null, 1), 'utf8');
console.log('sid 清单已写 scale-sids.json');
