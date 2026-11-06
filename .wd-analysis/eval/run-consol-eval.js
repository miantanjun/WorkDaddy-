/**
 * 整理前 / 整理后的检索质量对比（阶段 6 后半段的验收工具）。
 *
 * 为什么不能直接用现成的 run-eval 对比：那 39 条用例挂在本机真实库上，
 * 而真实库只有 24 条事实、几乎无冗余 ⇒ 整理在它上面跑一轮改动是 0，
 * 前后对比必然「逐位一致」，什么都证明不了（反而会给人「已验证」的错觉）。
 *
 * 所以这里在**临时副本库**上做两件事：
 *   ① 造一批「同一件事的多种表述」历史遗留数据（模拟抽取跑了几周之后的库）；
 *   ② 对同一组查询，比较「整理前」与「整理后」的：
 *        · 事实路召回（问题：重复事实把真正答案挤出前 k）
 *        · 事实路结果里的重复率（整理是否真的降了噪）
 *        · **内容不同的事实被误杀的条数**（整理是否把不同的东西合掉了 —— 最坏的失败）
 *
 * ⚠️ 第三条是重点：整理如果只会「合得多」，那它一定能把重复率降到 0，
 *   但同时把不同的东西也合掉了。所以必须同时看「降噪」和「误杀」，
 *   只看一个方向必然得出错误结论。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// ⚠️ 必须先改 dataDir 再 require —— ck-memory 在模块加载时就会算出库路径
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-consol-eval-'));
process.env.WD_CK_DATA_DIR = process.env.WD_CK_DATA_DIR || '';

const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: TMP });
const L = ck._internal;
const db = L.open();
if (!db) { console.error('打不开库'); process.exit(1); }

const SID = 'eval-consol';
const T = Date.now();

/* ---------- 造数据：每「一件事」给出 3 种表述（同义），共 8 件事 ---------- */
/**
 * 真实场景长这样：抽取跑了几天，同一件事被不同批次的对话反复提炼，
 * 表述略有差异（换了连接词、多了个尾巴、语序不同），但**数值与实体完全一致**。
 */
const CANON = [
  { id: 'addr', kind: 'tech', texts: [
    '记忆库文件在 APPDATA 下的 WorkDaddy ck-memory 目录里，文件名 ck.db',
    '记忆库文件放在 APPDATA 下的 WorkDaddy ck-memory 目录，文件名是 ck.db',
    'APPDATA 下的 WorkDaddy ck-memory 目录里存着记忆库文件，文件名 ck.db',
  ] },
  { id: 'port', kind: 'tech', texts: [
    '7863 端口是控制台，绝不能上 frp，免口令但必须保留 Origin 校验',
    '控制台固定在 7863 端口，免口令，但 Origin 校验必须保留，绝不能上 frp',
    '7863 端口跑控制台，免口令运行，Origin 校验保留，绝不上 frp',
  ] },
  { id: 'gate', kind: 'tech', texts: [
    '网关版本是 1.13.1-panel-wd9，发版时必须 bump 到 wd10',
    '网关版本 1.13.1-panel-wd9，每次发版要 bump 到 wd10',
    '网关当前版本 1.13.1-panel-wd9，发版要 bump 到 wd10',
  ] },
  { id: 'crlf', kind: 'tech', texts: [
    'scripts 目录下的 js 文件必须保持纯 CRLF，改完要复查 bareLF 等于 0',
    'scripts 下的 js 必须纯 CRLF，改完复查 bareLF 为 0',
    'scripts 目录里的 js 文件必须纯 CRLF 换行，改完复查 bareLF=0',
  ] },
  { id: 'mem', kind: 'decision', texts: [
    '记忆分层按回合划分：用户发言 pri 为 2，回合末条 assistant 为 1，过程话为 0',
    '记忆分层按回合：用户发言 pri=2，回合末条 assistant pri=1，过程话 pri=0',
    '记忆分层规则是按回合，用户发言 pri 2、回合末条 assistant pri 1、过程话 pri 0',
  ] },
  { id: 'ent', kind: 'tech', texts: [
    '实体归一化只去分隔符和大小写，绝不动数字字母，v1.9.9 与 v1.6.0 必须区分',
    '实体归一化只去分隔符与大小写，不能动数字字母，v1.9.9 和 v1.6.0 要区分开',
    '实体归一化仅去分隔符、大小写，绝不动数字字母，所以 v1.9.9 与 v1.6.0 不相等',
  ] },
  { id: 'eval', kind: 'tech', texts: [
    '评测集 39 条，分布是 single 16、multi 5、temporal 5、open 5、negative 8',
    '评测集共 39 条用例：single 16 条、multi 5 条、temporal 5 条、open 5 条、negative 8 条',
    '评测集有 39 条，其中 single 16、multi 5、temporal 5、open 5、negative 8',
  ] },
  { id: 'rrf', kind: 'tech', texts: [
    '三路 RRF 的权重是实体 1.5、事实 1.2、原文 1.0，第三路必须喂 exactItems',
    'RRF 三路权重：实体 1.5、事实 1.2、原文 1.0；第三路要喂 exactItems 不是 items',
    '三路 RRF 权重实体 1.5 事实 1.2 原文 1.0，第三路必须用 exactItems',
  ] },
];

/**
 * 刻意构造的「看起来像、其实不同」的对照组 —— 整理**一条都不许合并**。
 * 每对都是能过「词面相似」但被某一道闸挡住的组合。
 */
const TRAPS = [
  // 状态相反：数值集合都是空集，只有状态词表挡得住
  { a: '五柜埃及货已装运，ETD 泗水 9 月 2 日', b: '五柜埃及货未装运，ETD 泗水 9 月 2 日', why: '状态词对立' },
  // 不同订单、数值相同：只有实体不交能挡
  { a: '订单 AB-260713 尾款 USD 100 已付', b: '订单 CD-260713 尾款 USD 100 已付', why: '实体不交', kind: 'order' },
  // 同一订单不同阶段：数值集合不同
  { a: '订单 YKW-SU-260713 订金 USD 99,202.32 已入账', b: '订单 YKW-SU-260713 尾款 USD 231,472.08 未付', why: '数值不同', kind: 'order' },
  // 相似但对象不同（不同端口）
  { a: '7863 端口跑控制台，前端页面走同端口', b: '7866 端口跑网关面板，前端页面走同端口', why: '实体不交' },
];

const raw = (text, kind) => {
  const info = db.prepare(
    `INSERT INTO fact(sid, src_seg_id, text, kind, ents, h, valid_from, valid_to, vt_reason, conf, hits, last_hit_ts, created_at, model)
     VALUES(?,?,?,?,?,?,?,NULL,NULL,0.7,0,0,?,?)`
  ).run(SID, 0, text, kind || 'tech', '[]', 'h' + Math.random().toString(36).slice(2),
    T + Math.floor(Math.random() * 1000), T, 'eval');
  const id = Number(info.lastInsertRowid);
  try { db.prepare('INSERT INTO fact_fts(rowid, big) VALUES(?,?)').run(id, ck.bigram(text)); } catch (_) {}
  return id;
};

const idOf = new Map();   // 事实 id → 所属「件事」
for (const c of CANON) for (const t of c.texts) idOf.set(raw(t, c.kind), c.id);
const trapIds = [];
for (const t of TRAPS) {
  const a = raw(t.a, t.kind), b = raw(t.b, t.kind);
  trapIds.push({ a: a, b: b, why: t.why });
  idOf.set(a, 'trap-' + t.why + '-a');
  idOf.set(b, 'trap-' + t.why + '-b');
}

const total = Number(db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=?').get(SID).c);
console.log('=== 造数 ===');
console.log(`事实 ${total} 条：8 件事 × 3 种表述 = ${CANON.length * 3}，对照组 ${TRAPS.length} 对 = ${TRAPS.length * 2}`);

/* ---------- 查询集：问的正是那 8 件事 ---------- */
const QUERIES = [
  { q: '记忆库文件放在哪个目录', want: 'addr' },
  { q: '控制台用哪个端口', want: 'port' },
  { q: '网关版本号是多少', want: 'gate' },
  { q: '脚本文件的换行要求', want: 'crlf' },
  { q: '记忆分层是怎么划分的', want: 'mem' },
  { q: '实体归一化会不会动数字', want: 'ent' },
  { q: '评测集一共多少条用例', want: 'eval' },
  { q: '三路 RRF 的权重怎么配', want: 'rrf' },
];

/** 跑一组查询，返回「去重后有几种不同的事」以及「目标事在不在前 k」。 */
function probe(label) {
  const rows = [];
  let hitIn = 0, dupRateSum = 0;
  for (const c of QUERIES) {
    const r = L.searchFacts(SID, c.q, 5, {});
    const items = (r.items || []);
    const kinds = items.map((x) => idOf.get(Number(x.id)) || 'other');
    const uniq = new Set(kinds);
    const dupRate = items.length ? 1 - uniq.size / items.length : 0;
    dupRateSum += dupRate;
    const found = kinds.indexOf(c.want) >= 0;
    if (found) hitIn++;
    rows.push({ q: c.q, n: items.length, uniq: uniq.size, dup: dupRate, found: found, kinds: kinds });
  }
  return { label: label, rows: rows, recall: hitIn / QUERIES.length, dup: dupRateSum / QUERIES.length };
}

function report(x) {
  console.log('');
  console.log(`--- ${x.label} ---`);
  console.log('  Recall@5 = ' + (x.recall * 100).toFixed(1) + '%   平均重复率 = ' + (x.dup * 100).toFixed(1) + '%');
  for (const r of x.rows) {
    console.log('  ' + (r.found ? '○' : '×') + ' ' + r.q.padEnd(20, ' ') +
      ' 返回' + r.n + ' 去重后' + r.uni + ' 重复率' + (r.dup * 100).toFixed(0) + '%  ' + r.tags?.join(',') || '');
  }
}

const before = probe('整理前');

/* ---------- 阶段 A：只跑「补实体」（默认开启、无判断风险的那一步） ---------- */
const runEnt = L.consolidate({ force: true, ops: ['ent'] });
console.log('');
console.log('=== 阶段 A：补实体（默认开启）===');
console.log('runId ' + runEnt.runId + '，补实体 ' + ((runEnt.ent && runEnt.ent.changed) || 0) + ' 条，' + runEnt.ms + 'ms');

/* ---------- 阶段 B：候选清单（只列不改，主路径） ---------- */
const cand = L.consolCandidates(db, { sid: SID, limit: 100, jac: 0.42 });
const risky = cand.items.filter((x) => !x.blockers.length);
const blocked = cand.items.filter((x) => x.blockers.length);
console.log('');
console.log('=== 阶段 B：候选清单（只读）===');
console.log(`扫描 ${cand.scanned} 条，列出 ${cand.items.length} 对候选：` +
  `无疑似 ${risky.length} 对，有否决项 ${blocked.length} 对`);

// 关键验收 ①：8 组同义里有多少组被列出来（且没有否决项）
const canonHit = new Set();
for (const c of CANON) {
  const ids = c.texts.map((t) => {
    for (const [fid, cn] of idOf) if (cn === c.id) {
      const row = db.prepare('SELECT text FROM fact WHERE id=?').get(fid);
      if (row && row.text === t) return fid;
    }
    return -1;
  }).filter((x) => x > 0);
  const found = risky.some((p) => ids.indexOf(p.a.id) >= 0 && ids.indexOf(p.b.id) >= 0);
  if (found) canonHit.add(c.id);
}
console.log(`  同义组被识别：${canonHit.size}/${CANON.length} 组（有候选且无否决项）`);
for (const c of CANON) console.log('    ' + (canonHit.has(c.id) ? '○' : '×') + ' ' + c.id);

// 关键验收 ②：对照组必须**全部**落到 blocked 里，或被阈值排除（不成为候选）
const trapPass = [];
const trapFail = [];
for (const t of trapIds) {
  const asCand = cand.items.find((p) =>
    (p.a.id === t.a && p.b.id === t.b) || (p.a.id === t.b && p.b.id === t.a));
  if (!asCand) { trapPass.push({ why: t.why, how: '未进候选（词面未达阈值）' }); continue; }
  if (asCand.blockers.length) { trapPass.push({ why: t.why, how: '带否决项：' + asCand.blockers[0].slice(0, 30) }); }
  else trapFail.push(t);
}
console.log('  对照组处置：');
for (const p of trapPass) console.log('    ○ 【' + p.why + '】' + p.how);
for (const f of trapFail) console.log('    × 【' + f.why + '】**被列为可疑且无否决项** —— 会诱导人点错');

/* ---------- 阶段 C：人工确认合并（模拟用户按候选清单逐对点确认） ---------- */
//
// ⚠️ 这里模拟的是「用户看完清单、只点那些真正同义的」。
//   程序自己没有权限自动合 —— 这正是设计意图。所以评测要照这个流程走，
//   否则测的是一条产品里不会自动发生的路径。
let merged = 0;
const merges = [];
for (const p of risky) {
  const A = idOf.get(p.a.id), B = idOf.get(p.b.id);
  if (!A || A !== B || String(A).indexOf('trap') === 0) continue;   // 只合同一件事的
  const r = L.applyMergeCandidate(db, p.a.id, p.b.id, {});
  if (r.ok) { merged++; merges.push({ drop: p.b.id, keep: p.a.id, jac: p.jac }); }
}
console.log('');
console.log('=== 阶段 C：人工确认合并 ===');
console.log('确认并合并 ' + merged + ' 对（只合候选里「同一件事」的，对照组一律跳过）');

const after = probe('整理后');

/* ---------- 误杀检查：对照组必须一条都没被合 ---------- */
const wronglyMerged = [];
for (const t of trapIds) {
  const r = db.prepare('SELECT id, valid_to, vt_reason FROM fact WHERE id IN (?,?)').all(t.a, t.b);
  const dead = r.filter((x) => x.valid_to);
  if (dead.length) wronglyMerged.push({ why: t.why, ids: dead.map((x) => Number(x.id)), reason: dead[0].vt_reason });
}

/* ---------- 同义组：每组必须恰好剩 1 条活 ---------- */
const canonLive = [];
for (const c of CANON) {
  const live = Number(db.prepare(
    'SELECT COUNT(*) c FROM fact WHERE sid=? AND valid_to IS NULL AND text = ?'
  ).get(SID, c.texts[0]).c);
  // 精确到「这件事」的话，用 idOf 反查更准
  let n = 0;
  for (const [fid, cn] of idOf) {
    if (cn !== c.id) continue;
    const row = db.prepare('SELECT valid_to FROM fact WHERE id=?').get(fid);
    if (row && !row.valid_to) n++;
  }
  canonLive.push({ id: c.id, live: n, was: c.texts.length });
}

console.log('');
console.log('=== 结果对比 ===');
console.log('                 Recall@5    平均重复率');
console.log('  整理前         ' + (before.recall * 100).toFixed(1) + '%       ' + (before.dup * 100).toFixed(1) + '%');
console.log('  整理后         ' + (after.recall * 100).toFixed(1) + '%       ' + (after.dup * 100).toFixed(1) + '%');

console.log('');
console.log('=== 同义组是否收缩到 1 条 ===');
let shrinkOk = 0;
for (const c of canonLive) {
  const ok = c.live === 1;
  if (ok) shrinkOk++;
  console.log('  ' + (ok ? '○' : '×') + ' ' + c.id.padEnd(8) + ' ' + c.was + ' 条表述 → 剩 ' + c.live + ' 条有效');
}
console.log(`  ⇒ ${shrinkOk}/${canonLive.length} 组合并正确`);

console.log('');
console.log('=== 误杀检查（对照组一条都不许合）===');
if (!wronglyMerged.length) {
  console.log('  ○ 4 对对照组全部完好，共 8 条事实保持有效');
} else {
  for (const w of wronglyMerged) console.log('  × 【' + w.why + '】被误合：' + JSON.stringify(w.ids) + ' reason=' + w.reason);
}
console.log('');
console.log('整理历史：' + JSON.stringify(L.consolHistory(3).items[0] || {}));

/* ---------- 回滚验收 ---------- */
let revertedTotal = 0;
for (const m of merges) {
  const rr = L.rollbackConsol(db, m.runId || '');
  revertedTotal += rr.reverted || 0;
}
// 上面的 merge 每次是独立 runId，逐个回滚成本高；改成按 consol_log 里所有未回滚的都退掉
const pending = db.prepare('SELECT DISTINCT run_id FROM consol_log WHERE undone = 0').all()
  .map((r) => String(r.run_id));
for (const rid of pending) {
  const rr = L.rollbackConsol(db, rid);
  revertedTotal += rr.reverted || 0;
}
const afterRb = Number(db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=? AND valid_to IS NULL').get(SID).c);
const baseTotal = CANON.length * 3 + TRAPS.length * 2;
console.log('');
console.log('=== 回滚 ===');
console.log('回滚 ' + revertedTotal + ' 条日志 ⇒ 有效事实 ' + afterRb + ' 条（整理前应为 ' + baseTotal + '）');
const rbOk = afterRb === baseTotal;
console.log(rbOk ? '  ○ 完整还原' : '  × 未完全还原');

/* ---------- 判定 ---------- */
const okAll = canonHit.size === CANON.length && !trapFail.length && rbOk
  && after.recall >= before.recall;   // 整理后召回不许下降
console.log('');
console.log('判定：同义组识别 ' + canonHit.size + '/' + CANON.length +
  '，对照误判 ' + trapFail.length + '，回滚还原 ' + (rbOk ? '是' : '否') +
  '，召回不降 ' + (after.recall >= before.recall ? '是' : '否'));
console.log('结果：' + (okAll ? '通过' : '不通过'));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
process.exit(okAll ? 0 : 1);
