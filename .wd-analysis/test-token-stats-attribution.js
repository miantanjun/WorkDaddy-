'use strict';
// 回归测试：用量统计的账号归属（scripts/token-stats.js）
// 三个场景全部取自 2026-09-17 的真实故障现场：
//   1) 切号自动复制（autoCopy）产生的副本会话：与源会话逐字节相同的「导入前缀行」应归
//      源会话的账号；副本里新追加的行应归副本会话的账号。
//      —— 本次「177 的 deepseek 用量查不到」的根因就在这里：追加行的内嵌 sessionId
//         仍然是源会话（882c357a），旧逻辑按内嵌字段归属，于是整段用量记到了源账号名下。
//   2) 会话行已被删除（deleted_at 非空）但用量仍在 → 归属映射必须仍能查到，
//      否则用量被静默丢弃、账号维度直接消失。
//   3) 同一行内容出现在两个账号各自的副本里、且它声称的源会话已不在场 → 真歧义，
//      不得凭空记给任何一方，只计入总量。
// 跑法：node .wd-analysis/test-token-stats-attribution.js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ts = require(path.join(__dirname, '..', 'scripts', 'token-stats.js'));

const A = '028cbdf0-a0b5-4b45-ad68-8681d5314736'; // 177
const B = '827977d7-1111-4111-8111-111111111111'; // 18688296454
const S = '882c357a-6b2a-403b-b66e-43039e07c230'; // 源会话（账号 B）
const F = '2a616066-b61f-480b-93d1-5642d50a1620'; // 副本会话（账号 A，本次事故现场）
const D = '9940d8b1-89f6-42bb-b13f-fded51b3b316'; // 已删除会话（账号 A）
const P = 'cccc3333-0000-4000-8000-000000000000'; // 账号 A 的副本
const Q = 'dddd4444-0000-4000-8000-000000000000'; // 账号 B 的副本
const Z = 'eeee5555-0000-4000-8000-000000000000'; // 两者共同声称、但已不在场的源会话

const NOW = Date.now();
const PJ = 'projects/d-WorkBuddy date-2026-09-14-10-51-52';

function row(sessionId, id, input, output) {
  return JSON.stringify({
    id,
    timestamp: NOW,
    type: 'function_call',
    sessionId,
    providerData: { model: 'deepseek-v4.1-flash', usage: { input_tokens: input, output_tokens: output } },
  });
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-tokenstats-'));
const dir = path.join(ROOT, PJ);
fs.mkdirSync(dir, { recursive: true });

// 场景 1：共享前缀逐字节一致，分别落在源会话/副本会话文件里；副本另有一条新追加行
const shared1 = row(S, 'msg-1', 100, 10);
const shared2 = row(S, 'msg-2', 200, 20);
const fOnly = row(S, 'msg-3', 300, 30); // 内嵌 sessionId 仍是 S —— 这正是旧逻辑踩坑的地方
fs.writeFileSync(path.join(dir, S + '.jsonl'), [shared1, shared2].join('\n') + '\n');
fs.writeFileSync(path.join(dir, F + '.jsonl'), [shared1, shared2, fOnly].join('\n') + '\n');

// 场景 2：已删除会话自己产生的用量
fs.writeFileSync(path.join(dir, D + '.jsonl'), row(D, 'msg-4', 400, 40) + '\n');

// 场景 3：两个账号各自的副本里出现同一行，且共同声称的源会话 Z 已不在场
const orphan = row(Z, 'msg-5', 1000, 100);
fs.writeFileSync(path.join(dir, P + '.jsonl'), orphan + '\n');
fs.writeFileSync(path.join(dir, Q + '.jsonl'), orphan + '\n');

const accountOptions = [{ uid: A, nickname: '177' }, { uid: B, nickname: '18688296454' }];
const pick = (stats, uid) => (stats.accounts.find((x) => x.account === uid) || { input: 0, output: 0, calls: 0 });
const brief = (t) => `in=${t.input} out=${t.output} calls=${t.calls}`;

let passed = 0, failed = 0;
const log = [];
function check(label, fn) {
  try { fn(); log.push('  PASS  ' + label); passed++; }
  catch (e) { log.push('  FAIL  ' + label + '\n        ' + e.message); failed++; }
}

log.push('fixture: ' + ROOT);
log.push('');
log.push('[主场景] sessionAccounts 覆盖已删除会话（= 修复后的 daemon 口径）');
const full = ts.scanTokenStats(ROOT, {
  now: NOW, days: 1, accountOptions,
  sessionAccounts: { [S]: B, [F]: A, [D]: A, [P]: A, [Q]: B },
});
const a = pick(full, A), b = pick(full, B);

check('副本里新追加的行归「副本会话」账号 177（本次故障的核心断言）', () =>
  assert.strictEqual(brief(a), 'in=700 out=70 calls=2',
    `期望 177 = 副本新追加 300/30 + 已删除会话 400/40；实得 ${brief(a)}`));
check('导入前缀行归「源会话」账号 18688296454', () =>
  assert.strictEqual(brief(b), 'in=300 out=30 calls=2',
    `期望 18688296454 = 共享前缀 100/10 + 200/20；实得 ${brief(b)}`));
check('总量守恒：既不重复计数也不丢量', () =>
  assert.strictEqual(brief(full.totals), 'in=2000 out=200 calls=5', `实得 ${brief(full.totals)}`));
check('真歧义行不计入任何账号，但计入总量', () => {
  const sum = full.accounts.filter((x) => x.account === A || x.account === B)
    .reduce((s, x) => s + x.input + x.output, 0);
  assert.strictEqual(sum, 1100, `账号维度合计应为 300+30+700+70=1100；实得 ${sum}`);
});
check('真歧义行在账号列表里不会凭空出现第三个桶', () =>
  assert.deepStrictEqual(full.accounts.map((x) => x.account).sort(), [A, B].sort(),
    `实得 ${JSON.stringify(full.accounts.map((x) => x.account))}`));

log.push('');
log.push('[对照组] sessionAccounts 漏掉已删除会话（= 修复前的 daemon 口径，WHERE deleted_at IS NULL）');
const partial = ts.scanTokenStats(ROOT, {
  now: NOW, days: 1, accountOptions,
  sessionAccounts: { [S]: B, [F]: A, [P]: A, [Q]: B }, // 故意不含 D
});
const a2 = pick(partial, A);
check('已删除会话的用量会静默消失（复现故障，证明 daemon 侧必须一起改）', () =>
  assert.strictEqual(brief(a2), 'in=300 out=30 calls=1',
    `期望丢掉 400/40 只剩 300/30；实得 ${brief(a2)}`));
check('丢失的用量仍留在总量里（所以只看总量永远看不出问题）', () =>
  assert.strictEqual(partial.totals.input, 2000, `实得 ${partial.totals.input}`));

fs.rmSync(ROOT, { recursive: true, force: true });
log.push('');
log.push(`结果：passed=${passed} failed=${failed}`);
fs.writeFileSync(path.join(__dirname, 'test-token-stats-attribution.out.txt'), log.join('\n') + '\n', 'utf8');
console.log(`passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
