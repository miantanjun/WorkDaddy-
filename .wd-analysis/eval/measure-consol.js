/**
 * 阶段 6 后半段（sleeptime）的**取证脚本** —— 先量再写，不凭印象设计整理规则。
 *
 * 要回答四个问题：
 *   ① 同一会话内、同 kind、词面高度相似且**结构化实体不交**的活事实有多少对？
 *      （这类被 insertFact 的冲突检测**故意跳过**了 —— 因为「实体不同 = 两件事」。
 *        但它们可能是同一件事的两种说法，也可能是真的两件事。必须先看数据。）
 *   ② **跨会话**的重复事实有多少？（UNIQUE(sid,h) 只挡同会话，跨会话挡不住。）
 *   ③ 被标失效的条目里，有没有「后来被证明其实没失效」的？（误判失效取证）
 *   ④ 实体链接缺失的有多少？（fact.ents 算出来的 与 ent 表里实际的行 对不上）
 *
 * ⚠️ 只读线上库，**不写任何东西**。真正的整理跑在 run-consolidate 里。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const DB = path.join(process.env.APPDATA || '', 'WorkDaddy', 'ck-memory', 'ck.db');

if (!fs.existsSync(DB)) { console.error('库不存在: ' + DB); process.exit(1); }
const db = new DatabaseSync(DB, { readOnly: true });

const grams = (s) => new Set(ck.bigram(s).split(/\s+/).filter(Boolean));
const jac = (a, b) => {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
};
/** 结构化实体（排除纯数字碎片）—— 与 insertFact 里的 entsKey 完全同一口径 */
const entKey = (t) => ck.strongIds(t).filter((x) => /[A-Za-z]/.test(x) || /[._:/-]/.test(x));

const facts = db.prepare(
  'SELECT id, sid, text, kind, ents, valid_from, valid_to, conf, src_seg_id FROM fact ORDER BY id'
).all().map((r) => ({
  id: Number(r.id), sid: String(r.sid || ''), text: String(r.text || ''),
  kind: String(r.kind || 'other'), ents: r.ents,
  validFrom: Number(r.valid_from) || 0, validTo: Number(r.valid_to) || 0,
  conf: Number(r.conf) || 0.7,
}));

const live = facts.filter((f) => !f.validTo);
console.log('事实总数 ' + facts.length + '，其中有效 ' + live.length + '，已失效 ' + (facts.length - live.length));
console.log('涉及会话 ' + new Set(facts.map((f) => f.sid)).size + ' 个');
console.log('');

/* ---- ① 同会话、同 kind、高相似、实体不交（insertFact 跳过的那些）---- */
console.log('=== ① 同会话高相似但实体不交（冲突检测故意跳过）===');
let n1 = 0;
for (let i = 0; i < live.length; i++) {
  for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.sid !== b.sid) continue;
    const J = jac(a.text, b.text);
    if (J < 0.5) continue;
    const ka = entKey(a.text), kb = entKey(b.text);
    const disjoint = ka.length && kb.length && !ka.some((x) => kb.indexOf(x) >= 0);
    if (!disjoint) continue;
    n1++;
    console.log(`  #${a.id} vs #${b.id}  J=${J.toFixed(3)}  kind=${a.kind}/${b.kind}`);
    console.log(`    A: ${a.text.slice(0, 78)}`);
    console.log(`    B: ${b.text.slice(0, 78)}`);
    console.log(`    实体: ${JSON.stringify(ka)} / ${JSON.stringify(kb)}`);
  }
}
if (!n1) console.log('  （无）');
console.log('');

/* ---- ② 跨会话重复 ---- */
console.log('=== ② 跨会话重复（UNIQUE(sid,h) 挡不住的）===');
let n2 = 0;
for (let i = 0; i < facts.length; i++) {
  for (let j = i + 1; j < facts.length; j++) {
    const a = facts[i], b = facts[j];
    if (a.sid === b.sid) continue;
    const J = jac(a.text, b.text);
    if (J < 0.72) continue;
    n2++;
    console.log(`  #${a.id}(${a.sid.slice(0, 8)}) vs #${b.id}(${b.sid.slice(0, 8)})  J=${J.toFixed(3)}  vt=${a.validTo}/${b.validTo}`);
    console.log(`    A: ${a.text.slice(0, 78)}`);
    console.log(`    B: ${b.text.slice(0, 78)}`);
  }
}
if (!n2) console.log('  （无）');
console.log('');

/* ---- ③ 已失效条目：有没有「后继事实也不存在了」的孤儿失效 ---- */
console.log('=== ③ 已失效条目的取证（谁把它顶掉的 / 顶它的那条还在不在）===');
for (const f of facts.filter((x) => x.validTo)) {
  const sibs = live.filter((x) => x.sid === f.sid && x.kind === f.kind)
    .map((x) => ({ x, J: jac(f.text, x.text) }))
    .sort((p, q) => q.J - p.J);
  const top = sibs[0];
  console.log(`  #${f.id} 失效于 ${new Date(f.validTo).toISOString().slice(0, 16)}`);
  console.log(`    ${f.text.slice(0, 78)}`);
  if (top && top.J > 0) {
    console.log(`    最相似的同 kind 活事实: #${top.x.id} J=${top.J.toFixed(3)} → ${top.x.text.slice(0, 60)}`);
  } else {
    console.log(`    ⚠️ 同 kind 无任何活事实 ⇒ 「孤儿失效」，可能是手动标的，也可能规则误判`);
  }
}
console.log('');

/* ---- ④ 实体链接一致性 ---- */
console.log('=== ④ 实体链接一致性（fact.ents 列 vs ent 表）===');
let n4 = 0;
for (const f of facts) {
  const col = new Set((() => { try { return JSON.parse(f.ents || '[]'); } catch (_) { return []; } })());
  const got = db.prepare('SELECT ent, norm FROM ent WHERE fact_id = ?').all(f.id);
  const gotSet = new Set(got.map((r) => String(r.ent)));
  const okList = [...col].filter((e) => {
    const nm = ck.normEnt(e);
    return nm && nm.length >= 2 && !gotSet.has(String(e));
  });
  const extra = [...gotSet].filter((e) => !col.has(e));
  if (okList.length || extra.length) {
    n4++;
    console.log(`  #${f.id} 缺 ${JSON.stringify(okList)} / 多 ${JSON.stringify(extra)}  ${f.text.slice(0, 50)}`);
  }
}
if (!n4) console.log('  （全部一致，实体回填在 v6 迁移里已经做过了）');
console.log('');

/* ---- ⑤ 全库统计摘要，给整理规则定量 ---- */
console.log('=== ⑤ 相似度分布（同会话、同 kind、双方都有结构化实体且不交）===');
const buckets = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const cnt = buckets.map(() => 0);
for (let i = 0; i < live.length; i++) {
  for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.sid !== b.sid || a.kind !== b.kind) continue;
    const ka = entKey(a.text), kb = entKey(b.text);
    if (!(ka.length && kb.length && !ka.some((x) => kb.indexOf(x) >= 0))) continue;
    const J = jac(a.text, b.text);
    for (let k = 0; k < buckets.length; k++) if (J >= buckets[k]) cnt[k]++;
  }
}
buckets.forEach((b, k) => console.log(`  J >= ${b}  : ${cnt[k]} 对`));
