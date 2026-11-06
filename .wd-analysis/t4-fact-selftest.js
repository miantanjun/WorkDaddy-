'use strict';
// 阶段 4 真机验证：临时库 + 假模型端点，端到端跑一遍
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = path.join(os.tmpdir(), 'ckm-stage4-' + Date.now());
fs.mkdirSync(path.join(TMP, 'ck-memory'), { recursive: true });

const m = require(path.join(__dirname, '..', 'scripts', 'ck-memory.js'));
m.configure({
  dataRoot: TMP,
  dataDir: TMP,
  log: (s) => console.log('  [log] ' + s),
});

const db = m._internal.open();
if (!db) { console.log('打不开库'); process.exit(1); }

const ver = Number(db.prepare('PRAGMA user_version').get().user_version);
console.log('user_version =', ver);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') AND name LIKE 'fact%'").all().map(r => r.name);
console.log('事实相关表：', tables.join(', '));

const cols = db.prepare('PRAGMA table_info(fact)').all().map(r => r.name);
console.log('fact 列：', cols.join(', '));

// ==== 1. parseFactJson 纯函数 ====
console.log('\n--- parseFactJson ---');
const cases = [
  ['裸数组', '[{"text":"A 订单金额 USD 100 未付","kind":"order","time":"2026-08-01"}]', 1],
  ['围栏包裹', '```json\n[{"text":"B 订单起运港为泗水 Semarang","kind":"shipment","time":""}]\n```', 1],
  ['前置废话', '好的，以下是抽取结果：\n[{"text":"C 税号 418478260","kind":"party"}]', 1],
  ['空数组', '[]', 0],
  ['非法 kind 兜底', '[{"text":"D 某个不知道的类型","kind":"瞎写"}]', 1],
  ['太短丢弃', '[{"text":"OK","kind":"other"}]', 0],
  ['坏 JSON', '[{"text":"E 缺引号,}]', -1],
  ['非数组', '{"text":"F"}', -1],
];
for (const [name, raw, want] of cases) {
  const r = m.parseFactJson(raw);
  const got = r.ok ? r.items.length : -1;
  const okk = got === want ? 'OK ' : 'FAIL';
  console.log(`  ${okk} ${name}: want=${want} got=${got}${r.ok ? '' : ' (' + r.why + ')'}` +
    (r.ok && r.items.length ? ' kind=' + r.items[0].kind : ''));
}

// ==== 2. factHash 去重 ====
console.log('\n--- factHash ---');
const h1 = m.factHash('尾款 USD 231,472.08 未付。');
const h2 = m.factHash('尾款 USD 231,472.08 未付');
const h3 = m.factHash('尾款 USD 231,472.08 已付');
console.log('  标点/句号差异应相同:', h1 === h2 ? 'OK' : 'FAIL');
console.log('  语义相反应不同:', h1 !== h3 ? 'OK' : 'FAIL');

// ==== 3. insertFact：ADD-only + 冲突失效 ====
console.log('\n--- insertFact ---');
const SID = 'stage4test';
const now = Date.now();
const r1 = m.insertFact(db, SID, 1, { text: 'OCTAGON 订单 YKW-SU-260713 尾款 USD 231,472.08 未付', kind: 'order' }, { now, model: 'test' });
console.log('  第 1 条:', r1, r1 === 'added' ? 'OK' : 'FAIL');
const r2 = m.insertFact(db, SID, 2, { text: 'OCTAGON 订单 YKW-SU-260713 尾款 USD 231,472.08 未付。', kind: 'order' }, { now, model: 'test' });
console.log('  同文本再说一遍应 dup:', r2, r2 === 'dup' ? 'OK' : 'FAIL');
// 冲突：同金额但已付 ⇔ 未付
const r3 = m.insertFact(db, SID, 3, { text: 'OCTAGON 订单 YKW-SU-260713 尾款 USD 231,472.08 已付', kind: 'order' }, { now: now + 1000, model: 'test' });
console.log('  状态反转应 invalidated:', r3, r3 === 'invalidated' ? 'OK' : 'FAIL');
// 不该误伤：金额不同的另一件事
const r4 = m.insertFact(db, SID, 4, { text: 'OCTAGON 订单 YKW-SU-260713 订金 USD 99,202.32 已付', kind: 'order' }, { now: now + 2000, model: 'test' });
console.log('  不同金额不应触发失效:', r4, r4 === 'added' ? 'OK（未误伤）' : 'FAIL 误伤了');

const all = db.prepare('SELECT id,text,valid_to FROM fact WHERE sid=? ORDER BY id').all(SID);
console.log('  库内事实：');
for (const f of all) console.log('    #' + f.id, f.valid_to ? '[已失效]' : '[有效]', f.text);

// ==== 4. searchFacts ====
console.log('\n--- searchFacts ---');
const s1 = m.searchFacts(SID, '尾款', 5);
console.log('  「尾款」有效命中', s1.items.length, '条，首条:', s1.items[0] && s1.items[0].text);
const s2 = m.searchFacts(SID, '尾款', 5, { includeExpired: true });
console.log('  「尾款」含失效命中', s2.items.length, '条');
const s3 = m.searchFacts(SID, '418478260', 5);
console.log('  「418478260」（不存在）', s3.items.length, '条');

// ==== 5. rrfFuse ====
console.log('\n--- rrfFuse ---');
const fused = m.rrfFuse(
  [{ id: 1, text: '事实A' }, { id: 2, text: '事实B' }],
  [{ id: 10, text: '原文1' }, { id: 11, text: '原文2' }]
);
console.log('  融合条数:', fused.length, fused.length === 4 ? 'OK' : 'FAIL');
console.log('  序列:', fused.map(x => x.type + ':' + (x.item.id)).join(' > '));

// ==== 6. factStats ====
console.log('\n--- factStats ---');
const st = m.factStats();
console.log('  ', JSON.stringify(st));

// ==== 7. 迁移幂等（再开一次） ====
console.log('\n--- 重开库（迁移幂等） ---');
m._internal.open();
const ver2 = Number(db.prepare('PRAGMA user_version').get().user_version);
console.log('  user_version 仍为', ver2, ver2 === ver ? 'OK' : 'FAIL');

console.log('\n临时库：', TMP);
