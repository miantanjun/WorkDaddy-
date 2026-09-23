'use strict';
/*
 * test-auto-copy-leader.js —— 方案 D / D1「内容定源（判主偏序）」的落地守卫。
 *
 * 守六件事：
 *   [A] relationOf 纯映射：上游 compareSnapshots 的 5 个 kind 逐一翻成 gt/lt/eq/div，
 *       其中 repair 的**方向**必须看 missingRight/missingLeft（看反了就会拿祖先覆盖后代）
 *   [B] 真实快照判主：唯一领导者 / 全部等价 / 兄弟分叉 / 附属文件单向差 / 双向差 / 三成员链
 *   [C] 不可读与不足：读不出来的成员被**排除**而不是被当成等价；可读不足两个 ⇒ insufficient
 *   [D] 定源独立性（本轮最核心的红线）：**mtime 绝不参与定源** —— 显式构造
 *       「旧实现按 mtime 会选 T，新判主按内容必须选 S」的对立样本
 *   [E] alias 契约：aliases 必须传全成员 id，否则同一份内容的不同副本会被判 conflict
 *   [F] 无副作用：判主只读，不改动磁盘任何一个字节/时间戳
 *
 * 全部在 os.tmpdir() 沙箱里跑，不碰真机数据。
 * 跑法：node .wd-analysis/test-auto-copy-leader.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const judge = require(path.join(ROOT, 'scripts', 'auto-copy-judge.js'));
const leader = require(path.join(ROOT, 'scripts', 'auto-copy-leader.js'));
const lib = require(path.join(ROOT, 'scripts', 'lib.js'));
// 打包白名单守卫（共用）：mac DMG 显式白名单 vs Windows cp -R 整目录。
const packagingGuard = require(path.join(__dirname, 'packaging-whitelist.js'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function eq(actual, expected, label) { ok(actual === expected, label, { actual, expected }); }
function section(t) { console.log(t); }

/** 造一个会话：正文 jsonl + 任意附属文件（key 用相对路径，含真实 id）。 */
function mkSession(root, id, records, extras = {}) {
  const projDir = path.join(root, 'projects', 'p-one');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, id + '.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const rel of Object.keys(extras)) {
    const abs = path.join(root, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, extras[rel]);
  }
}
/** 造正文：第一条是会话身份行，后面是消息行。 */
function body(id, messages) {
  return [{ type: 'session', sessionId: id }].concat(messages.map((text) => ({ type: 'message', text })));
}
function setMtime(root, id, ms) {
  const f = path.join(root, 'projects', 'p-one', id + '.jsonl');
  fs.utimesSync(f, new Date(ms), new Date(ms));
}
/** 递归指纹：只取 path|size|mtimeMs，用来证明「判主没改盘」。 */
function treeFingerprint(dir) {
  const parts = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const name of fs.readdirSync(abs).sort()) {
      const childRel = rel ? rel + '/' + name : name;
      const st = fs.lstatSync(path.join(dir, childRel));
      if (st.isDirectory()) { parts.push(childRel + '|D'); walk(childRel); }
      else parts.push(childRel + '|F|' + st.size + '|' + st.mtimeMs);
    }
  };
  walk('');
  return parts.join('\n');
}
function sandbox(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wd-leader-' + tag + '-'));
}
function aliasesOf(ids) { return ids.slice(); }

/* ==================================================================== */
section('[A] relationOf：上游 kind → 偏序关系（纯函数）');
/* ==================================================================== */

eq(leader.relationOf({ kind: 'left-extends' }), 'gt', 'A1 left-extends ⇒ gt（左含右）');
eq(leader.relationOf({ kind: 'right-extends' }), 'lt', 'A2 right-extends ⇒ lt（右含左）');
eq(leader.relationOf({ kind: 'equal' }), 'eq', 'A3 equal ⇒ eq');
eq(leader.relationOf({ kind: 'conflict' }), 'div', 'A4 conflict ⇒ div');
eq(leader.relationOf({ kind: 'repair', missingRight: true, missingLeft: false }), 'gt',
  'A5 repair 只有左多文件 ⇒ gt（方向看 missingRight）');
eq(leader.relationOf({ kind: 'repair', missingRight: false, missingLeft: true }), 'lt',
  'A6 repair 只有右多文件 ⇒ lt（方向看 missingLeft）');
eq(leader.relationOf({ kind: 'repair', missingRight: true, missingLeft: true }), 'div',
  'A7 repair 双向都有对方没有的文件 ⇒ div（谁也不是谁的超集）');
eq(leader.relationOf(null), 'div', 'A8 null / 未知 kind ⇒ div（保守：绝不放行成 eq）');
eq(leader.relationOf({ kind: 'brand-new-kind-from-upstream' }), 'div',
  'A9 将来上游新增的 kind 也按 div 处理（宁可多报分叉，不可误判等价去覆盖）');

/* ==================================================================== */
section('[B] 真实快照判主');
/* ==================================================================== */

/* B1/B2：S 内容更全，但 T 的 mtime 更新 —— 领导者必须是 S */
{
  const root = sandbox('b12');
  mkSession(root, 'S', body('S', ['m1', 'm2', 'm3']));
  mkSession(root, 'T', body('T', ['m1', 'm2']));
  setMtime(root, 'S', 1_600_000_000_000);
  setMtime(root, 'T', 1_700_000_000_000);   // T 更「新」
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: aliasesOf(['S', 'T']) });
  eq(r.kind, 'leader', 'B1 S 多一条消息 ⇒ 存在唯一领导者');
  eq(r.leaderId, 'S', 'B2 领导者 = S（内容更全），而不是 mtime 更新的 T');

  /* D2：与旧选源实现正面对照 —— 两者结论必须相反 */
  const members = [
    { uid: 'u1', id: 'S', contentMtime: 1_600_000_000_000, updatedAt: 1_600_000_000_000 },
    { uid: 'u2', id: 'T', contentMtime: 1_700_000_000_000, updatedAt: 1_700_000_000_000 },
  ];
  eq(lib.selectLatestAutoCopyMember(members).id, 'T', 'D2a 旧实现（比 mtime）会选 T');
  eq(r.leaderId !== lib.selectLatestAutoCopyMember(members).id, true,
    'D2b 新判主与旧选源**结论相反** —— 这就是本条要拦住的回归');
}

/* B3：全部等价 ⇒ all-equal，且 preferredId 决定稳定代表 */
{
  const root = sandbox('b3');
  mkSession(root, 'S', body('S', ['m1']));
  mkSession(root, 'T', body('T', ['m1']));
  judge.clearJudgeCache();
  const members = [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }];
  const a = leader.resolveContentLeader(root, members, { aliases: aliasesOf(['S', 'T']) });
  eq(a.kind, 'all-equal', 'B3 内容等价（身份行已被 alias 归一化）⇒ all-equal');
  const b = leader.resolveContentLeader(root, members, { aliases: aliasesOf(['S', 'T']), preferredId: 'T' });
  eq(b.leaderId, 'T', 'B4 preferredId 只在「全部等价」时定代表（T）');
}

/* B5：兄弟分叉（同一位置内容不同）⇒ divergent，且给出分叉对 */
{
  const root = sandbox('b5');
  mkSession(root, 'S', body('S', ['m1', 'AAA']));
  mkSession(root, 'T', body('T', ['m1', 'BBB']));
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: aliasesOf(['S', 'T']), preferredId: 'T' });
  eq(r.kind, 'divergent', 'B5 兄弟分叉 ⇒ divergent（一份都不覆盖）');
  eq(r.leaderId, null, 'B6 分叉时**没有**领导者（preferredId 不许参与裁决）');
  eq(r.pairs.length === 1 && r.pairs[0].kind === 'conflict', true,
    'B7 分叉对已登记（供用户裁决用）', r.pairs);
}

/* B8：附属文件单向差 ⇒ 谁多谁是领导者（repair 的方向必须判对） */
{
  const root = sandbox('b8');
  mkSession(root, 'S', body('S', ['m1']));
  mkSession(root, 'T', body('T', ['m1']), { 'tasks/T/extra.json': '{"x":1}' });
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: aliasesOf(['S', 'T']) });
  eq(r.kind, 'leader', 'B8 正文相同、T 多一个附属文件 ⇒ 仍能判出领导者');
  eq(r.leaderId, 'T', 'B9 领导者 = T（文件更多的那一侧），方向没看反');
}

/* B10：附属文件双向差 ⇒ 真分叉 */
{
  const root = sandbox('b10');
  mkSession(root, 'S', body('S', ['m1']), { 'tasks/S/s.json': '{"s":1}' });
  mkSession(root, 'T', body('T', ['m1']), { 'tasks/T/t.json': '{"t":1}' });
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: aliasesOf(['S', 'T']) });
  eq(r.kind, 'divergent', 'B10 双方各有对方没有的文件 ⇒ divergent（谁都不是超集）');
}

/* B11：三成员链 A ⊃ B ⊃ C ⇒ 唯一领导者 A，其余标记 same */
{
  const root = sandbox('b11');
  mkSession(root, 'A', body('A', ['m1', 'm2', 'm3']));
  mkSession(root, 'B', body('B', ['m1', 'm2']));
  mkSession(root, 'C', body('C', ['m1']));
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root,
    [{ uid: 'u1', id: 'A' }, { uid: 'u2', id: 'B' }, { uid: 'u3', id: 'C' }],
    { aliases: aliasesOf(['A', 'B', 'C']) });
  eq(r.kind, 'leader', 'B11 链式祖先关系 ⇒ 唯一领导者');
  eq(r.leaderId, 'A', 'B12 领导者 = A（链顶）');
  eq(r.members.map((m) => m.status).join(','), 'leader,same,same', 'B13 其余成员标记 same');
}

/* B14：A 同时含 B/C，而 B 与 C 只在附属文件上互斥 ⇒ 仍以 A 为领导者 */
{
  const root = sandbox('b14');
  mkSession(root, 'A', body('A', ['m1', 'm2']));
  mkSession(root, 'B', body('B', ['m1']), { 'tasks/B/b.json': '{"b":1}' });
  mkSession(root, 'C', body('C', ['m1']), { 'tasks/C/c.json': '{"c":1}' });
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root,
    [{ uid: 'u1', id: 'A' }, { uid: 'u2', id: 'B' }, { uid: 'u3', id: 'C' }],
    { aliases: aliasesOf(['A', 'B', 'C']) });
  eq(r.kind, 'leader', 'B14 A 含 B、A 含 C（B/C 之间互斥）⇒ 仍判得出唯一领导者');
  eq(r.leaderId, 'A', 'B15 领导者 = A（直接含住每一个可读成员）');
}

/* B16：判主与成员传入顺序无关 */
{
  const root = sandbox('b16');
  mkSession(root, 'S', body('S', ['m1', 'm2']));
  mkSession(root, 'T', body('T', ['m1']));
  judge.clearJudgeCache();
  const ids = aliasesOf(['S', 'T']);
  const a = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }], { aliases: ids });
  const b = leader.resolveContentLeader(root, [{ uid: 'u2', id: 'T' }, { uid: 'u1', id: 'S' }], { aliases: ids });
  eq(a.leaderId === b.leaderId && a.leaderId === 'S', true, 'B16 判主结果与传入顺序无关（稳定）');
}

/* ==================================================================== */
section('[C] 不可读 / 可读不足：绝不把读坏的副本当成等价');
/* ==================================================================== */

/* C1：三个成员，C 读不出来 ⇒ 排除后仍能判主 */
{
  const root = sandbox('c1');
  mkSession(root, 'A', body('A', ['m1', 'm2']));
  mkSession(root, 'B', body('B', ['m1']));
  const r = leader.resolveContentLeader(root,
    [{ uid: 'u1', id: 'A' }, { uid: 'u2', id: 'B' }, { uid: 'u3', id: 'C' }],
    {
      aliases: aliasesOf(['A', 'B', 'C']),
      readSnapshot: (id) => {
        if (id === 'C') throw new Error('会话消息文件为空，未同步');
        return judge.readJudgedSnapshot(root, id, aliasesOf(['A', 'B', 'C']));
      },
    });
  eq(r.kind, 'leader', 'C1 一个成员读不出来 ⇒ 排除它之后仍能判主');
  eq(r.leaderId, 'A', 'C2 领导者仍是 A');
  eq(r.members.find((m) => m.id === 'C').status, 'excluded', 'C3 读不出来的成员标记 excluded');
}

/* C4：两个成员、其中一个读不出来 ⇒ insufficient，**不许**把读不出来的当成等价放行 */
{
  const root = sandbox('c4');
  mkSession(root, 'S', body('S', ['m1', 'm2']));
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    {
      aliases: aliasesOf(['S', 'T']),
      readSnapshot: (id) => {
        if (id === 'T') throw new Error('会话文件正在变化，请稍后重试');
        return judge.readJudgedSnapshot(root, id, aliasesOf(['S', 'T']));
      },
    });
  eq(r.kind, 'insufficient', 'C4 可读只剩一份 ⇒ insufficient（不放行、不覆盖）');
  eq(r.leaderId, null, 'C5 insufficient 时没有领导者');
}

/* C6：全部读不出来 */
{
  const root = sandbox('c6');
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: ['S', 'T'], readSnapshot: () => { throw new Error('会话消息文件为空，未同步'); } });
  eq(r.kind, 'insufficient', 'C6 全部读不出来 ⇒ insufficient');
}

/* ==================================================================== */
section('[D] 定源独立性：mtime 不参与（等价内容不因时间被特殊化）');
/* ==================================================================== */

{
  const root = sandbox('d1');
  mkSession(root, 'S', body('S', ['m1']));
  mkSession(root, 'T', body('T', ['m1']));
  setMtime(root, 'S', 1_500_000_000_000);
  setMtime(root, 'T', 1_800_000_000_000);   // 差 300000 秒
  judge.clearJudgeCache();
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: aliasesOf(['S', 'T']) });
  eq(r.kind, 'all-equal', 'D1 内容等价 → all-equal（不因为 T 的 mtime 新就把它特殊化）');
  eq(r.candidates.length, 2, 'D2 两个候选都保留（顺序不代表优先级）');
}

/* ==================================================================== */
section('[E] alias 契约：aliases 必须是全成员 id');
/* ==================================================================== */

{
  const root = sandbox('e1');
  // 关键：正文里**引用了兄弟成员的 id**（跨副本互相引用/被引用是真实存在的）。
  // ⚠️ 必须用 identityKeys 白名单里的字段（sessionId/conversationId/ownerConversationId/
  //    session_id/conversation_id），写个自定义的 ref 字段是**不会被归一化**的，测不出东西。
  // 每个副本自己的 id 必然会被归一化（readSnapshot 把自身 id 也算进 knownIds），
  // 所以只有当 aliases 含**全部成员 id** 时，这条跨副本引用才会被一起归一化。
  mkSession(root, 'S', [{ type: 'session', sessionId: 'S' }, { type: 'message', text: 'm1', ownerConversationId: 'T' }]);
  mkSession(root, 'T', [{ type: 'session', sessionId: 'T' }, { type: 'message', text: 'm1', ownerConversationId: 'T' }]);
  judge.clearJudgeCache();
  const members = [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }];
  const withAlias = leader.resolveContentLeader(root, members, { aliases: aliasesOf(['S', 'T']) });
  judge.clearJudgeCache();
  const noAlias = leader.resolveContentLeader(root, members, { aliases: [] });
  eq(withAlias.kind, 'all-equal', 'E1 传全成员 alias ⇒ 跨副本引用被归一化，判等价');
  eq(noAlias.kind, 'divergent', 'E2 只传自身 alias ⇒ 对其他成员的引用归一化不了，会被误判成 conflict');
}

/* ==================================================================== */
section('[F] 无副作用：判主只读');
/* ==================================================================== */

{
  const root = sandbox('f1');
  mkSession(root, 'S', body('S', ['m1', 'm2']), { 'tasks/S/t.json': '{"t":1}' });
  mkSession(root, 'T', body('T', ['m1']));
  judge.clearJudgeCache();
  const before = treeFingerprint(root);
  const r = leader.resolveContentLeader(root, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: aliasesOf(['S', 'T']) });
  const after = treeFingerprint(root);
  eq(r.kind, 'leader', 'F1 前置：本轮判主确实有结论');
  eq(before === after, true, 'F2 判主没有改动磁盘的任何一个文件（路径/大小/mtime 全同）');
}

/* ==================================================================== */
section('[G] daemon 接线守卫（静态形态断言，防「改回去也不知道」）');
/* ==================================================================== */

{
  // ⚠️ 只匹配**代码形态**（带前缀的整句），别匹配裸符号 —— 补丁注释里提到被删的符号不算数。
  // ⚠️ daemon.js 是 CRLF，断言片段按 LF 写：先归一化再匹配，否则多行片段命中 0 次、
  //     断言会「静默失效」成假红（这是本仓库反复踩过的坑）。
  const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  const has = (needle) => daemonSrc.includes(needle);
  const at = (needle) => daemonSrc.indexOf(needle);

  ok(has("const autoCopyLeader = require('./auto-copy-leader.js');"),
    'G1 daemon 已 require 内容判主模块');
  ok(has('\n  getAutoCopyJudge,\n'), 'G2 已从 lib.js 导入 getAutoCopyJudge（缺它开关永远是 mtime）');
  ok(has("const judgeMode = String((options && options.judge) || (typeof getAutoCopyJudge === 'function' ? getAutoCopyJudge(DATA_DIR) : 'mtime')) === 'content'"),
    'G3 judgeMode 的完整形态（含默认回落 mtime）在源码里');
  ok(has("const latest = forcedSource || contentLatest || selectLatestAutoCopyMember(live);")
    && has('const forcedSource = (forceResolve && forceSourceId)')
    && has("const forceSourceId = String((options && options.forceSourceId) || '').trim();"),
    'G4 选源仍是「内容领导者优先，旧实现只作 mtime 路径的兜底」；forcedSource 只在显式裁决（force）时才插到最前');
  ok(has('const changedSinceBaseline = (judgeMode === \'content\' || !(baselineAt > 0))'),
    'G5 mtime 水位线判据在 content 模式下停用');
  ok(has("if (!forceResolve && judgeMode !== 'content' && changedSinceBaseline.length >= 2) {"),
    'G6 旧的「≥2 就报冲突」已被 content 模式让路（否则内容判据永远走不到）；!forceResolve 是唯一旁路');
  ok(has("if (!forceResolve && judgeMode !== 'content' && targetPresent && baselineAt > 0 && changedSinceBaseline.length === 0) {"),
    'G7 旧的「没变化就跳过」同样让路（否则会抢在判主之前误判 unchanged）；同样只允许 force 旁路');
  ok(has("{ aliases: live.map((member) => member.id), preferredId: String(targetUid || '').trim(), cache: getSessionSyncCache() }"),
    'G8 判主传入的 alias 是**全成员 id**（含自身）、preferredId 只用于等价时代表，且第 3 项透传 A3 文件级指纹缓存');
  ok(has("if (contentLead.kind === 'divergent' || contentLead.kind === 'insufficient') {"),
    'G9 分叉/可读不足走同一个「一份都不覆盖」出口');
  ok(has('detail.branch = result.branch || null;'),
    'G10 分叉明细已透到 job 明细（用户通知的数据通道）');
  ok(has('if (result.divergent) job.divergences += 1;'), 'G11 分叉计数已累加');
  ok(at('autoCopyLeader.resolveContentLeader(') > 0
    && at('autoCopyLeader.resolveContentLeader(') < at('const forcedSource = (forceResolve && forceSourceId)')
    && at('autoCopyLeader.resolveContentLeader(') < at('const latest = forcedSource || contentLatest || selectLatestAutoCopyMember(live);'),
    'G12 判主发生在选源之前（顺序不能被重排）');
  ok(has("const syncOptions = { skipWorkspaceSessions: true, judge: autoCopyJudgeMode, force: !!job.force, forceSourceUid: job.force ? String(job.sourceUid || '') : '' };")
    && has("const autoCopyJudgeMode = typeof getAutoCopyJudge === 'function' ? getAutoCopyJudge(DATA_DIR) : 'mtime';"),
    'G13 判据模式在任务级读一次并显式下传（别每条会话都重读 meta.json）；force/forceSourceUid 一并下传，默认中性值');
}

/* ==================================================================== */
section('[H] 打包白名单守卫（daemon 启动期 require 的模块必须在发行白名单里）');
/* ==================================================================== */

{
  // mac DMG 走的是**显式白名单**（Windows 走 cp -R 整目录），漏一个就 daemon 启动即崩。
  // 这是既有缺口（SKILL §40.11），这里把它变成一条机器判据。
  // ⚠️ 2026-09-23：判据从「daemon.js 直接 require」升级为**传递闭包** —— 只查直接
  // require 会漏掉二级依赖（daemon → token-stats → stats-discipline），那次加
  // thinking-stats.js 时就漏登记过一次。共用 helper：packaging-whitelist.js。
  const mac = fs.readFileSync(path.join(ROOT, 'scripts', 'build-mac-dmg.sh'), 'utf8');
  const daemonLf = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  const required = [...new Set([...daemonLf.matchAll(/require\('\.\/([A-Za-z0-9._-]+\.js)'\)/g)].map((m) => m[1]))]
    .filter((name) => fs.existsSync(path.join(ROOT, 'scripts', name)));
  const directMissing = required.filter((name) => !new RegExp('(^|[\\s"])' + name.replace(/[.]/g, '\\.') + '($|[\\s;])', 'm').test(mac));
  const reachable = packagingGuard.reachableModules(ROOT);
  const closureMissing = packagingGuard.macWhitelistMissing(ROOT);

  ok(required.includes('auto-copy-leader.js'), 'H1 能从 daemon.js 抓到自建模块清单（含本轮新增的判主模块）');
  ok(directMissing.length === 0, 'H2 daemon 启动期 require 的自建模块全在 mac 白名单里', directMissing);
  ok(closureMissing.length === 0,
    'H3 【传递闭包】daemon 可达的所有自建模块都在 mac 白名单里（含二级依赖，如 stats-discipline.js）'
    + ' —— 可达 ' + reachable.length + ' 个', closureMissing);
}

/* ==================================================================== */
section('[I] 面板文案守卫（inject.js：分叉与旧「两边都改过」必须区分）');
/* ==================================================================== */

{
  // ⚠️ inject.js 也是 CRLF —— 同样先归一化再匹配（否则多行片段命中 0 ⇒ 假红）。
  const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
  const has = (needle) => injectSrc.includes(needle);

  // 2026-09-21：这两条文案抽进了共用 helper（autoCopyConflictTitle/Detail），
  // 好让「切号进度条」与「会话同步面板」说同一句话 —— 断言跟着挪到 helper 里，
  // 同时补一条「两处都调用同一个 helper」的守卫，防止有人再各写一份。
  ok(has('divergences: Math.max(0, Number(job && job.divergences) || 0),'),
    'I1 面板已读取 job.divergences');
  ok(has("        ? c.divergences + ' 个会话两边各自分叉，已保留双方，未覆盖任何一边'")
    && has("        : (c.conflicts || 1) + ' 个会话两边都修改过，未覆盖任何一边';"),
    'I2 分叉走新文案、旧的「两边都修改过」仍在（两条都要在，不能被替换掉）');
  ok(has('var conflictTitle = autoCopyConflictTitle(job);')
    && has('headLabel = autoCopyConflictTitle(job);')
    && has("+ ' · ' + autoCopyConflictDetail(job)"),
    'I4 「会话同步面板」与「切号进度条」共用同一组冲突文案（不再各写一份，避免一个说冲突一个说失败）');
  ok(has("} else if (job.status === 'conflict') {")
    && has('toast(prefix + autoCopyConflictDetail(job), false, root);'),
    'I5 切号进度条与 toast 都补了 conflict 分支（此前落进 else ⇒ 显示「自动复制失败」，是假报错）');
  ok(has("' 个会话两边各自分叉，已保留双方，未覆盖任何一边':"), 'I3 新长句已整句入 i18n 词典（否则会被短词撕成中英混杂）');
}

/* ==================================================================== */
section('[J] 手动强制覆盖守卫（「立即同步」勾选后跳过分叉保护；不勾 ⇒ 零变化）');
/* ==================================================================== */

{
  const daemonLf = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  const dHas = (needle) => daemonLf.includes(needle);
  const injectLf = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
  const iHas = (needle) => injectLf.includes(needle);

  ok(dHas("if (options && options.force && !String(options.forceSourceId || '').trim()) {")
    && dHas('const hitForceMember = wantedForceUid'),
    'J1 账号级强制覆盖按 uid 定源，且只在「没给 forceSourceId」时归一化（面板 prefer 那条老路径不受影响）');
  ok(dHas("options = Object.assign({}, options, { forceSourceId: hitForceMember ? String(hitForceMember.id) : '', force: !!hitForceMember });"),
    'J2 uid 不在本血缘 ⇒ 整块 force 作废、退回保护性判据（宁可不覆盖，也不拿别人的副本顶上）');
  ok(dHas('function startAutoCopyJob(sourceUid, targetUid, plan, labels, opts) {')
    && dHas('force: !!(opts && opts.force),'),
    'J3 任务对象记录 force（不传 opts ⇒ undefined ⇒ 逐行为不变）');
  ok(dHas('force: !!job.force,'), 'J4 对外任务快照透出 force（面板据此区分「强制覆盖」与普通同步）');
  ok(dHas("return { sources: [], explicit: false, code: 400, error: '强制覆盖必须指定源账号（源账号不能留空）' };"),
    'J5 服务端拒绝「强制覆盖 + 源留空」（留空 = 多源互相覆盖，谁赢取决于排队顺序，不是用户能预期的行为）');
  ok(dHas("const force = !!(body && body.force);"), 'J6 路由默认 force=false（只认显式传参）');
  ok(iHas("if (job.force) parts.push('强制覆盖：以源账号为准');"),
    'J7 结果文案标明这次走了强制覆盖（否则事后分不清有没有覆盖过别人）');
  ok(iHas("'勾上后，两边各自分叉的会话会以源账号为准覆盖过去，目标账号里那一边的新内容会被丢掉，且不可撤销。只在自动同步反复提示「两边分叉」、且你确认要以源账号为准时才勾；勾上后必须点名一个源账号。':"),
    'J8 警示长句整句入 i18n 词典（句内含 源账号/目标账号 等短词条，不整句入典会被撕成中英混杂）');
}

/* ==================================================================== */

console.log('');
console.log('test-auto-copy-leader.js: ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
