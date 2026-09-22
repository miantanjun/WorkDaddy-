'use strict';
/*
 * test-auto-copy-judge.js —— 方案 D / D0 本地层（auto-copy-judge.js）的落地守卫。
 *
 * 守四件事：
 *   [A] judge 特性开关：默认 'mtime'（行为零变化）、可持久化、白名单投影可见、非法值归一、
 *       且**不得扰动** meta.autoCopy 的 v2 结构判据
 *   [B] 快照域切分：workspace/sessions 被排除在内容快照之外 —— 且必须证明这不是「空动作」
 *       （对照组：不排除时仅产物不同会判 conflict，排除后判 equal）
 *   [C] 指纹 memo：命中时**零文件读取**（靠 reads 计数证明，不是靠文本匹配）；
 *       同长度改写 / 增文件 / 删文件都必须失效；缓存快照与直读快照判定等价
 *   [D] slim / writable 护栏：slim 只可判定不可写盘（拿错会静默写坏，必须显式报错）
 *
 * 全部在 os.tmpdir() 沙箱里跑，不碰真机数据。
 * 跑法：node .wd-analysis/test-auto-copy-judge.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const judge = require(path.join(ROOT, 'scripts', 'auto-copy-judge.js'));
const sessionSync = require(path.join(ROOT, 'scripts', 'session-sync.js'));
const lib = require(path.join(ROOT, 'scripts', 'lib.js'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log(t); }

/* ==================================================================== */
section('[A] judge 特性开关（默认 mtime ⇒ 行为零变化）');
/* ==================================================================== */

const LIBDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-judge-lib-'));

ok(typeof lib.getAutoCopyJudge === 'function' && typeof lib.setAutoCopyJudge === 'function',
  'A1 getAutoCopyJudge / setAutoCopyJudge 已导出');
ok(lib.getAutoCopyJudge(LIBDIR) === 'mtime', 'A2 空 meta 下默认 mtime（未灰度 ⇒ 行为不变）');
ok(lib.readAutoCopyConfig(LIBDIR).judge === 'mtime',
  'A3 judge 出现在 readAutoCopyConfig 白名单投影里（否则 daemon 永远取不到）');
ok(lib.setAutoCopyJudge(LIBDIR, 'content') === 'content' && lib.getAutoCopyJudge(LIBDIR) === 'content',
  'A4 可切到 content');
ok(lib.setAutoCopyJudge(LIBDIR, 'xyz') === 'mtime' && lib.getAutoCopyJudge(LIBDIR) === 'mtime',
  'A5 非法值归一为 mtime（不做任何「未知即放行」）');
const shape = lib.readAutoCopyConfig(LIBDIR);
ok(shape.sessions && shape.sessionIndex && shape.workspaces && shape.copies
  && shape.suppressed && shape.syncedAt && shape.judge === 'mtime',
  'A6 开关不扰动 v2 结构判据（sessions/sessionIndex/workspaces/copies/suppressed/syncedAt 全在）');

/* ==================================================================== */
section('[B] 快照域切分：workspace/sessions 排除在内容快照之外');
/* ==================================================================== */

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-judge-sbx-'));
const PROJ = path.join(SANDBOX, 'projects', 'p-one');
fs.mkdirSync(PROJ, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'artifact-index'), { recursive: true });

const IDS = ['S', 'T'];
const SAME = ['message', 'message'].map((t, i) => JSON.stringify({ type: t, uuid: 'SAME-' + i, text: 'SAME-' + i })).join('\n') + '\n';
function write(id, text) { fs.writeFileSync(path.join(PROJ, id + '.jsonl'), text || SAME); }
function writePayload(id, text) {
  const dir = path.join(SANDBOX, 'workspace', 'sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'payload.bin'), text);
}
write('S'); write('T');
writePayload('S', 'AAA'); writePayload('T', 'AAA');
// ⚠️ 两个成员都必须有同一份附属文件 —— 否则「两侧只差产物」这个前提不成立：
//    少文件会先被 compareSnapshots 判成 repair(missingRight)，根本走不到产物语义比较。
for (const id of ['S', 'T']) {
  fs.mkdirSync(path.join(SANDBOX, 'tasks', id), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'tasks', id, 'job.json'), '{"k":1}');
}

const WS_KEY = 'workspace/sessions/__session__/payload.bin';
const rawS = sessionSync.readSnapshot(SANDBOX, 'S', IDS);
const skipS = sessionSync.readSnapshot(SANDBOX, 'S', IDS, { skipPrefixes: ['workspace/sessions'] });
ok(rawS.files.has(WS_KEY), 'B1 不排除时，产物文件进入快照（对照组，证明下面不是空动作）');
ok(!skipS.files.has(WS_KEY), 'B2 排除后，产物文件不再进入快照');
ok(Array.isArray(skipS.skipPrefixes) && skipS.skipPrefixes.includes('workspace/sessions'),
  'B3 快照记录了 skipPrefixes（供 unchanged 复检沿用同一域）', skipS.skipPrefixes);
ok(skipS.files.has('tasks/__session__/job.json'), 'B4 只排除 workspace/sessions，tasks/ 仍被收录');

// 只改 T 侧的产物内容（正文完全一致）
writePayload('T', 'BBB');
const rawT = sessionSync.readSnapshot(SANDBOX, 'T', IDS);
const skipT = sessionSync.readSnapshot(SANDBOX, 'T', IDS, { skipPrefixes: ['workspace/sessions'] });
ok(sessionSync.compareSnapshots(rawS, rawT).kind === 'conflict',
  'B5 不排除时：仅产物不同 → conflict（证明产物本来确实参与判定）',
  sessionSync.compareSnapshots(rawS, rawT).kind);
ok(sessionSync.compareSnapshots(skipS, skipT).kind === 'equal',
  'B6 排除后：仅产物不同 → equal（延续 v1.4.1「产物分歧不参与冲突判定」的裁决）',
  sessionSync.compareSnapshots(skipS, skipT).kind);

/* ==================================================================== */
(async function () {
  section('[C] 指纹 memo：命中时零文件读取');
  /* ==================================================================== */

  const stat = () => judge.judgeStats();
  const AL = ['S', 'T'];
  judge.clearJudgeCache();

  let a = stat();
  const first = judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  let b = stat();
  ok(b.misses - a.misses === 1 && b.reads - a.reads === 1,
    'C1 首次读：miss +1、真读盘 +1', { miss: b.misses - a.misses, read: b.reads - a.reads });

  a = b;
  const second = judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  b = stat();
  ok(b.hits - a.hits === 1 && b.reads - a.reads === 0,
    'C2 内容未变再读：hit +1 且**零读盘**（memo 真的省掉了 io 与 sha256）',
    { hit: b.hits - a.hits, read: b.reads - a.reads });
  ok(first === second, 'C3 命中时直接复用同一份 slim（不是重新构造的等价物）');

  // 同长度改写正文：size 不变，靠 mtime/ctime 必须仍能失效
  await new Promise((r) => setTimeout(r, 20));
  a = b;
  write('S', SAME.replace(/SAME-0/g, 'DIFF-0'));
  judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  b = stat();
  ok(b.reads - a.reads === 1, 'C4 同长度改写正文 → 指纹失效（靠 mtime/ctime，不靠 size）', b.reads - a.reads);
  write('S');

  a = b;
  fs.writeFileSync(path.join(SANDBOX, 'tasks', 'S', 'extra.json'), '{"e":1}');
  judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  b = stat();
  ok(b.reads - a.reads === 1, 'C5 新增附属文件 → 失效', b.reads - a.reads);

  a = b;
  fs.rmSync(path.join(SANDBOX, 'tasks', 'S', 'extra.json'));
  judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  b = stat();
  ok(b.reads - a.reads === 1, 'C6 删除附属文件 → 失效', b.reads - a.reads);

  a = b;
  judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  const cached = judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  const direct = sessionSync.readSnapshot(SANDBOX, 'S', IDS, { skipPrefixes: judge.judgeSkipPrefixes() });
  b = stat();
  ok(sessionSync.compareSnapshots(cached, direct).kind === 'equal',
    'C7 缓存出来的快照与直读快照判定等价（缓存不改变结论）');
  ok(b.reads - a.reads === 0, 'C8 第二次读零读盘（承接 C7，缓存确实生效）', b.reads - a.reads);

  ok(judge.evictCache(SANDBOX, 'S') >= 1, 'C9 evictCache 能按成员清掉缓存');
  a = stat();
  judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  b = stat();
  ok(b.reads - a.reads === 1, 'C10 evict 后重读必须真读盘（否则 evict 是假的）', b.reads - a.reads);
  ok(judge.clearJudgeCache() >= 1, 'C11 clearJudgeCache 能整表清空');

  /* ==================================================================== */
  section('[D] slim / writable 护栏');
  /* ==================================================================== */

  const slim = judge.readJudgedSnapshot(SANDBOX, 'S', AL);
  ok(slim.slim === true, 'D1 readJudgedSnapshot 产出的是 slim 快照');
  let d2 = null;
  try { judge.assertWritable(slim); } catch (e) { d2 = e.message; }
  ok(typeof d2 === 'string' && d2.indexOf('slim') >= 0,
    'D2 slim 快照交给写盘路径必须显式报错（不许静默写坏）', d2);

  const writable = judge.readWritableSnapshot(SANDBOX, 'S', AL);
  let d3 = null;
  try { judge.assertWritable(writable); } catch (e) { d3 = e.message; }
  ok(d3 === null && [...writable.files.values()].every((f) => Buffer.isBuffer(f.bytes)),
    'D3 readWritableSnapshot 含原始字节且通过护栏', d3);
  ok(judge.judgeSkipPrefixes().includes('workspace/sessions'),
    'D4 judgeSkipPrefixes 暴露排除清单（默认域收敛在一处）', judge.judgeSkipPrefixes());

  /* ==================================================================== */
  section('[E] D4 灰度入口：/api/sessions/auto-copy/judge（默认仍是 mtime）');
  /* ==================================================================== */

  const D4DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-d4-'));
  ok(lib.getAutoCopyJudge(D4DIR) === 'mtime', 'E1 空目录默认判据是 mtime（未灰度 = 零行为变化）');
  ok(lib.setAutoCopyJudge(D4DIR, 'content') === 'content', 'E2 显式切 content 生效');
  ok(lib.getAutoCopyJudge(D4DIR) === 'content', 'E3 切换后读回仍是 content（已落盘）');
  ok(lib.setAutoCopyJudge(D4DIR, 'mtime') === 'mtime', 'E4 可一键回退到 mtime');
  ok(lib.setAutoCopyJudge(D4DIR, 'CONTENT') === 'mtime', 'E5 非法值归一为 mtime（不产生第三态）');
  ok(lib.setAutoCopyJudge(D4DIR, '') === 'mtime', 'E6 空值同样归一为 mtime');
  fs.rmSync(D4DIR, { recursive: true, force: true });

  const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(daemonSrc.indexOf("p === '/api/sessions/auto-copy/judge'") >= 0, 'E7 daemon 暴露了 judge 端点');
  ok(daemonSrc.indexOf("if (req.method === 'GET' && p === '/api/sessions/auto-copy/judge')") >= 0
    && daemonSrc.indexOf("if (req.method === 'POST' && p === '/api/sessions/auto-copy/judge')") >= 0,
    'E8 GET 读 / POST 写两条都接上（只读一份实现）');
  ok(daemonSrc.indexOf("if (raw !== 'mtime' && raw !== 'content') {") >= 0
    && daemonSrc.indexOf("return json(res, 400, { ok: false, error: \"judge 只能是 'mtime' 或 'content'\" });") >= 0,
    'E9 非法值被 400 拒绝且不落盘（不做静默归一，用户要知道自己写了什么）');
  ok(daemonSrc.indexOf('  setAutoCopyJudge,') >= 0, 'E10 daemon 从 lib 引入了 setAutoCopyJudge');
  const setCalls = (daemonSrc.match(/setAutoCopyJudge\(DATA_DIR/g) || []).length;
  ok(setCalls === 1, 'E11 【反向守卫】setAutoCopyJudge 全仓只有这一个调用点 ⇒ 没有旁路偷偷改判据', setCalls);
  ok(daemonSrc.indexOf('const before = typeof getAutoCopyJudge === \'function\' ? getAutoCopyJudge(DATA_DIR) : \'mtime\';') >= 0,
    'E12 切换响应回带 changed（能回答「这次到底变没变」）');

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.rmSync(LIBDIR, { recursive: true, force: true });

  console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
  if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => {
  console.log('\n结果：' + pass + ' 通过 / ' + (failures.length + 1) + ' 失败');
  console.log('  - 未捕获异常: ' + (e && e.stack || e));
  process.exit(1);
});
