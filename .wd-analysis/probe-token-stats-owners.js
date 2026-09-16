// 精确诊断：去重后每条记录的「归属账号」是怎么算出来的，以及为什么会有多归属。
// 数据源：token-stats.js 写的缓存 .workdaddy-token-stats-cache.json + workbuddy.db
// 跑法：node .wd-analysis/probe-token-stats-owners.js > out.txt 2>&1
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = 'C:\\Users\\Lyon\\.workbuddy';
const CACHE = path.join(ROOT, '.workdaddy-token-stats-cache.json');
const FOCUS = process.env.FOCUS_MODEL || 'deepseek';

const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
log(`cache version=${cache.version} generatedAt=${new Date(cache.generatedAt).toLocaleString('zh-CN')}`);

const db = new DatabaseSync(path.join(ROOT, 'workbuddy.db'));
const all = db.prepare('SELECT id, user_id, cwd, title, deleted_at FROM sessions').all();
db.close();

const accountOf = {};   // 仅未删除会话（与 daemon 的 SQL 一致）
const titleOf = {};
const aliveOf = {};
for (const r of all) {
  const id = String(r.id || '');
  if (!id) continue;
  titleOf[id] = String(r.title || '');
  aliveOf[id] = !r.deleted_at;
  if (!r.deleted_at && r.user_id) accountOf[id] = String(r.user_id);
}

const start = new Date(); start.setHours(0, 0, 0, 0);
const LOWER = start.getTime();

// ---- 复刻 distinctRecords 的归属解析 ----
function resolve(rec) {
  if (rec.account) return { uid: rec.account, why: 'A 记录自带 uid 字段' };
  if (rec.sourceSession) {
    const a = accountOf[rec.sourceSession];
    return a ? { uid: a, why: 'B sourceSession→sessions.user_id' }
      : { uid: '', why: 'B sourceSession 查不到(已删/未登记)' };
  }
  const base = path.posix.basename(rec.file, '.jsonl');
  const a = accountOf[base];
  return a ? { uid: a, why: 'C 文件名→sessions.user_id' } : { uid: '', why: 'C 文件名查不到' };
}

// ---- 按 key 聚合（== distinctRecords）----
const groups = new Map();
let todayN = 0;
for (const [rel, item] of Object.entries(cache.todayFiles || {})) {
  for (const rec of item.entries || []) {
    if (rec.timestamp < LOWER) continue;
    todayN += 1;
    let g = groups.get(rec.key);
    if (!g) { g = { key: rec.key, copies: [] }; groups.set(rec.key, g); }
    const r = resolve(rec);
    g.copies.push({ rel, sess: rec.sourceSession || '', uid: r.uid, why: r.why,
      model: rec.model || '', in: rec.input, out: rec.output,
      cacheRead: rec.cacheRead, cacheWrite: rec.cacheWrite });
  }
}

log(`今天记录条目 n=${todayN}，去重后 n=${groups.size}`);

const merged = [];      // 去重后的“一条记录”
for (const g of groups.values()) {
  const owners = new Set(g.copies.map((c) => c.uid).filter(Boolean));
  const first = g.copies[0];
  merged.push({
    key: g.key, model: first.model, input: first.in, output: first.out,
    copies: g.copies, owners,
    final: owners.size === 1 ? [...owners][0] : '',
  });
}

const ambiguous = merged.filter((m) => !m.final);
const sumTok = (arr) => arr.reduce((s, m) => s + (m.input || 0) + (m.output || 0), 0);
const sumCalls = (arr) => arr.length;

log('');
log('=== 去重后归属结果 ===');
log(`  唯一归属: n=${merged.length - ambiguous.length}   tokens=${sumTok(merged.filter((m) => m.final))}`);
log(`  多归属→account='' 被丢弃: n=${ambiguous.length}   tokens=${sumTok(ambiguous)}`);
for (const m of ambiguous) {
  const models = {};
  for (const c of m.copies) models[c.model || '(空)'] = (models[c.model || '(空)'] || 0) + 1;
  log(`  x ${JSON.stringify(models)} in=${m.input} owners=${JSON.stringify([...m.owners].map((u) => u.slice(0, 8)))} copies=${m.copies.length}`);
}

// ---- 焦点模型：逐条看它被谁认领 ----
const focus = merged.filter((m) => (m.model || '').toLowerCase().includes(FOCUS.toLowerCase()));
log('');
log(`=== 焦点模型 ~"${FOCUS}" 去重后 n=${focus.length} tokens=${sumTok(focus)} ===`);
const byOwner = {};
for (const m of focus) {
  const k = m.final ? m.final.slice(0, 8) : "(空/被丢弃)";
  byOwner[k] = byOwner[k] || { n: 0, tokens: 0 };
  byOwner[k].n += 1; byOwner[k].tokens += (m.input || 0) + (m.output || 0);
}
log('  -- 现有逻辑下的归属分布 --');
for (const [k, v] of Object.entries(byOwner).sort((a, b) => b[1].tokens - a[1].tokens)) {
  log(`     ${k}  n=${v.n}  tokens=${v.tokens}`);
}

log('');
log('  -- 被丢弃的焦点记录，逐份副本明细（最多 4 组）--');
ambiguous.filter((m) => (m.model || '').toLowerCase().includes(FOCUS.toLowerCase())).slice(0, 4).forEach((m) => {
  log(`     key=${m.key.slice(0, 12)} in=${m.input} out=${m.output}`);
  for (const c of m.copies) {
    const base = path.posix.basename(c.rel, '.jsonl');
    log(`        ${c.rel}`);
    log(`          文件会话=${base.slice(0, 8)}(uid=${(accountOf[base] || '-').slice(0, 8)}, 标题=${(titleOf[base] || '-').slice(0, 22)}) 记录sourceSession=${c.sess ? c.sess.slice(0, 8) : '(无)'} 判定=${c.why} → ${(c.uid || '(空)').slice(0, 8)}`);
  }
});

// ---- 假想修复后的效果：多归属按副本均分 / 全量复制 ----
function project(mode) {
  const acc = {};
  for (const m of merged) {
    const owners = m.owners.size ? [...m.owners] : [''];
    for (const u of owners) {
      if (!u) continue;
      acc[u] = acc[u] || { n: 0, tokens: 0 };
      acc[u].n += 1;
      acc[u].tokens += mode === 'split'
        ? Math.round(((m.input || 0) + (m.output || 0)) / owners.length)
        : ((m.input || 0) + (m.output || 0));
    }
  }
  return acc;
}
log('');
log('=== 对焦点模型，两种修复口径下的归属 ===');
for (const mode of ['split', 'copy']) {
  const acc = project(mode);
  log(`  [${mode}]`);
  const focusKeys = new Set();
  for (const m of focus) for (const u of m.owners) focusKeys.add(u);
  for (const u of [...focusKeys].sort()) log(`     ${u.slice(0, 8)}  n=${acc[u] ? acc[u].n : 0}  tokens=${acc[u] ? acc[u].tokens : 0}`);
}

fs.writeFileSync(path.join(__dirname, 'probe-token-stats-owners.out.txt'), out.join('\n') + '\n', 'utf8');
process.stdout.write(out.join('\n') + '\n');
