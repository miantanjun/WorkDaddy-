'use strict';
/*
 * 2026-09-17（v1.3.9）：定时发送「行找到了、点了却打不开」的二次修复。
 *
 * 现场（20:05 那次，无切号）：目标行在 DOM 里、每轮都在点、15.7 秒预算烧光，
 * 日志 `reason=unknown pick=0`。18:05 同一会话同一任务却成功。
 *
 * 真因在 WorkBuddy renderer（ui-docs-viewer 的 handleConversationClick）——有三个
 * **静默 no-op** 分支，本次命中的是 ①：
 *   ① loadingSessionIdRef.current === id → 该会话正在加载，点击被去重
 *      （源码注释原文：「loadSession 在飞时（daemon 忙时可达 90s+）… 每一次点击都是静默 no-op」）
 *   ② isRedundantConversationClick(...)  → 已选中且路由一致，点了等于没点
 *   ③ isCreatingConversation             → 正在新建会话，点击被吞
 * 也就是说：**点击本身不是有效动作**，能不能打开取决于「加载有没有落地」。
 * 旧实现每轮都点、点完只判效 1.6 秒，预算 15 秒 —— 加载超过 15 秒就必挂。
 *
 * 修法（两层，缺一不可）：
 *   · 预算：session.open 的 timeoutMs 由定时发送放大到 90s（原来写死 15000）。
 *   · 空转：判定「加载中」（waited 或 selected===id）后不再每轮点击，改观测等待；
 *     20 秒仍无进展才退回点击。**第 1 轮保留一次「预热点击」**——因为还存在
 *     「侧栏行高亮但路由没指过来」的情形，那种情况下点击才是唯一出路。
 *
 * 本套件用**迷你 renderer 仿真**（假时钟 + 真 DOM 替身 + 真执行注入表达式）跑同一个
 * 场景两次：一次跑 HEAD（修复前）、一次跑工作区（修复后）。断言修复前复现失败、
 * 修复后成功，且点击次数与等待时长符合预期。
 * 「点击」统计的是**真的执行到 card.click() 的次数**（表达式真跑），不是字符串匹配。
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const DAEMON = 'D:/WorkDaddy/scripts/daemon.js';
const SS = 'D:/WorkDaddy/scripts/scheduled-send.js';
const GIT = 'C:/Users/Lyon/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe';
const norm = (s) => String(s).replace(/\r\n/g, '\n');

const SRC = norm(fs.readFileSync(DAEMON, 'utf8'));
const SSRC = norm(fs.readFileSync(SS, 'utf8'));

let pass = 0, fail = 0, skip = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { fail += 1; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};
const skipOne = (label, why) => { skip += 1; console.log('  skip ' + label + (why ? '  (' + why + ')' : '')); };
const eq = (label, got, want) => ok(JSON.stringify(got) === JSON.stringify(want), label,
  'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));

const sliceFn = (src, name) => {
  const start = src.indexOf('async function ' + name + '(');
  if (start < 0) throw new Error('找不到 ' + name);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error('找不到 ' + name + ' 的结尾');
  return src.slice(start, end + 2);
};

const NEWFN = sliceFn(SRC, 'openConversationById');
let OLDFN = null;
try {
  OLDFN = sliceFn(norm(execFileSync(GIT, ['-C', 'D:/WorkDaddy', 'show', 'HEAD:scripts/daemon.js'],
    { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')), 'openConversationById');
} catch (e) { OLDFN = null; }

/* =================== A 组：源码接线 =================== */
console.log('\n[A] 源码接线');
ok(/const LOAD_WAIT_MS = 20000;/.test(SRC), 'A1 定义了 LOAD_WAIT_MS=20000');
ok(/let waitOnly = false;/.test(SRC), 'A2 有 waitOnly 开关');
const iFn = SRC.indexOf('async function openConversationById');
const iEnd = SRC.indexOf('\n}\n', iFn);
const FNBLOCK = SRC.slice(iFn, iEnd + 2);
const iWait = FNBLOCK.indexOf("'if(' + (waitOnly ? 'true' : 'false') + '){return {ok:true,found:true,waited:true");
const iClick = FNBLOCK.indexOf("'card.click();'");
ok(iWait > 0 && iClick > 0 && iWait < iClick, 'A3 「只观测」出口在 card.click() 之前（顺序反了就压不住点击）');
ok(/const loadingLike = res\.waited \|\| res\.selected === id;/.test(SRC), 'A4 加载态判定 = waited 或 selected===id');
ok(/if \(loadingLike && Date\.now\(\) - startedAt < LOAD_WAIT_MS\) \{[\s\S]{0,160}?waitOnly = true;/.test(SRC), 'A5 判定后置 waitOnly=true');
ok(/waitOnly = false;\n      clicks \+= 1;/.test(SRC), 'A6 退出等待后恢复点击，且计入点击次数');
ok(/selected=\(compat&&compat\.getSelectedConversationId\)/.test(SRC), 'A7 表达式里读 getSelectedConversationId');
ok(/controllers=\[' \+ String\(\(diag && diag\.controllers\)/.test(SRC), 'A8 失败日志带 controllers 现场');
ok(/行数=' \+ String\(\(diag && diag\.rows\) != null \? diag\.rows : '\?'\)/.test(SRC), 'A9 失败日志带行数现场');
ok(/点到=' \+ String\(\(diag && diag\.clicked\) \|\| '-'\)/.test(SRC), 'A10 失败日志带「点到了什么元素」');
ok(/预算可由 step 的 `timeoutMs` 放大/.test(SRC), 'A11 文档注释记录了二次修复');
ok(/loadingSessionIdRef\.current === id/.test(SRC), 'A12 注释写明命中的是 loadingSessionIdRef 去重分支');
ok(/ui-docs-viewer/.test(SRC), 'A13 注释给出取证来源（renderer 源码文件）');
ok(/"no-row"/.test(FNBLOCK), 'A14 「行不在」有独立 reason=no-row（不与 no-result 混淆）');
ok(/Math\.min\(300000, Math\.max\(3000, Number\(timeoutMs\) \|\| 15000\)\)/.test(SRC), 'A15 预算钳制在 [3s, 300s]');

console.log('\n[AA] scheduled-send 编译产物');
ok(/const OPEN_TIMEOUT_MS = 90000;/.test(SSRC), 'AA1 定义了 OPEN_TIMEOUT_MS=90000');
ok(/\{ op: 'session\.open', conversationId: r\.conversationId, timeoutMs: OPEN_TIMEOUT_MS \}/.test(SSRC), 'AA2 session.open 步骤带上 timeoutMs');
const ss = require(SS);
const CONV = '882c357a-6b2a-403b-b66e-43039e07c230';
const built = ss.buildTask({
  accountUid: '827977d7-77ca-437e-9602-159fdc11fe7d', conversationId: CONV,
  message: 'hi', conversationTitle: 't', accountNickname: 'n',
  schedule: { type: 'once', at: '2026-09-17T21:05' },
}, { now: 1789650000000 });
const inner = built.steps[0].steps;
eq('AA3 算子顺序不变', inner.map((s) => s.op), ['session.open', 'logic.delay', 'session.send']);
eq('AA4 session.open.timeoutMs = 90000', inner[0].timeoutMs, 90000);
eq('AA5 session.open.conversationId 不变', inner[0].conversationId, CONV);
const back = ss.extractTask(built);
ok(!!back && back.conversationId === CONV, 'AA6 反向编译仍能还原会话 id（多出的 timeoutMs 不影响）');
ok(back && back.accountUid === '827977d7-77ca-437e-9602-159fdc11fe7d', 'AA7 反向编译还原账号');

/* =================== B 组：迷你 renderer 仿真 =================== */
console.log('\n[B] 迷你 renderer 仿真（假时钟 + DOM 替身 + 真执行注入表达式）');

const TARGET = CONV;
const OTHER = '1d80c722-dff7-4bb7-bd29-591236f90c70';
const BASE_T = 1789650000000;

function baseState(over) {
  return Object.assign({
    targetId: TARGET,
    rows: 15,
    list: true,            // .conversation-list 是否存在
    hit: true,             // [data-conversation-id=目标] 是否存在
    card: true,            // hit 里能否找到 [class*="_card_"]
    cardHeader: false,
    convItem: false,
    selected: null,        // compat.getSelectedConversationId
    routeId: null,         // 路由当前指向的会话（决定「已选中+路由一致」才算冗余）
    controllers: [],       // 已挂载控制器的会话 id
    loadingId: null,       // 正在加载中的会话 id（点击会被 renderer 去重吞掉）
    creating: false,
    inert: false,          // 点击彻底无效（模拟点到错的元素）
    clickTarget: null,     // 点击实际会打开哪个会话（默认 = targetId）
    loadMs: 1500,          // 点击后多久控制器挂上
    loadFinishIn: null,    // 开场就有一个 load 在飞，再过这么久落地
    cdpNull: false,        // runCdpExpression 返回 null（渲染进程卡住）
  }, over || {});
}

function createRenderer(state, clock) {
  let pending = null;
  if (state.loadFinishIn != null) pending = { at: clock.v + state.loadFinishIn, id: state.targetId };
  const counter = { attempts: 0, effective: 0, swallowed: [], headerClicks: 0, evalError: null, perEval: [] };

  const materialize = () => {
    if (pending && clock.v >= pending.at) {
      if (state.controllers.indexOf(pending.id) < 0) state.controllers.push(pending.id);
      if (state.loadingId === pending.id) state.loadingId = null;
      state.routeId = pending.id;
      pending = null;
    }
  };
  const onClick = (kind) => {
    const target = state.clickTarget || state.targetId;
    counter.attempts += 1;
    if (state.creating) { counter.swallowed.push('creating'); return; }
    if (state.loadingId === target) { counter.swallowed.push('loading'); return; }   // 分支 ①
    if (state.selected === target && state.routeId === target) { counter.swallowed.push('redundant'); return; } // 分支 ②
    if (state.inert) { counter.swallowed.push('inert'); return; }
    state.selected = target;
    state.routeId = target;
    if (state.loadMs > 0) { state.loadingId = target; pending = { at: clock.v + state.loadMs, id: target }; }
    else if (state.controllers.indexOf(target) < 0) { state.controllers.push(target); }
    counter.effective += 1;   // 真的导航了
  };

  const card = { className: '_card_9f2', tagName: 'DIV', click: () => onClick('card') };
  const cardHeader = { className: '_header_7a1', tagName: 'DIV', click: () => onClick('header') };
  const convItem = { className: 'conversation-item', tagName: 'DIV', click: () => onClick('item') };
  const hit = {
    className: 'row', tagName: 'DIV',
    querySelector(sel) {
      if (sel.indexOf('_card_') >= 0) return state.card ? card : null;
      if (sel.indexOf('_header_') >= 0) return state.cardHeader ? cardHeader : null;
      if (sel === '.conversation-item') return state.convItem ? convItem : null;
      return null;
    },
    getAttribute: () => state.targetId,
    click: () => onClick('hit'),
  };
  const content = { scrollTop: 0 };
  const headerNodes = [
    { className: 'collapsible-section-header expanded', click: () => { counter.headerClicks += 1; } },
    { className: 'collapsible-section-header', click: () => { counter.headerClicks += 1; } },
  ];
  const list = {
    querySelectorAll: (sel) => (sel === '.collapsible-section-header' ? headerNodes : []),
    querySelector: (sel) => (sel === '.conversation-list-content' ? content : null),
  };
  const doc = {
    querySelectorAll: (sel) => (sel === '[data-conversation-id]' ? { length: state.rows } : { length: 0 }),
    querySelector(sel) {
      if (sel === '.conversation-list') return state.list ? list : null;
      if (sel.indexOf('data-conversation-id=') >= 0) return state.hit ? hit : null;
      if (sel === '.conversation-list-content') return content;
      return null;
    },
  };
  const win = {
    __wbsWorkBuddyCompat: {
      findConversationControllers() {
        materialize();
        return state.controllers.map((id) => ({ conversationId: id }));
      },
      getSelectedConversationId() { return state.selected; },
    },
  };
  const readLiveModel = () => {
    materialize();
    const cs = state.controllers;
    return Promise.resolve(cs.length
      ? { ok: true, model: 'gpt-test', conversationId: cs[0] }   // 与限流实现一致：取 list[0]
      : { ok: false, error: '未找到会话控制器（页面可能还没进入会话）' });
  };
  return { counter, doc, win, readLiveModel, materialize };
}

async function runImpl(fnSrc, state, opts) {
  const o = opts || {};
  const clock = { v: BASE_T };
  const r = createRenderer(state, clock);
  const exprs = [];
  const logs = [];
  const fakeDate = new Proxy(Date, { get: (t, k) => (k === 'now' ? () => clock.v : t[k]) });
  const mod = { exports: {} };
  const factory = new Function('module', 'exports', 'cdp', 'log', 'runCdpExpression',
    'readLiveModel', 'sleep', 'Date',
    fnSrc + '\nmodule.exports = { openConversationById };\n');

  factory(mod, mod.exports, { connected: true },
    (s) => logs.push(String(s)),
    (expr) => {
      r.materialize();
      exprs.push(expr);
      const before = r.counter.attempts;
      let out = null;
      // CDP 无响应 = 渲染进程根本没执行，所以**不能**先跑再丢（那会把点击算进去）
      if (!state.cdpNull) {
        try {
          // 真跑：既验证语法，也验证「到底点没点下去」
          out = new Function('window', 'document', 'return ' + expr)(r.win, r.doc);
        } catch (e) {
          r.counter.evalError = String((e && e.message) || e);
          out = null;
        }
      }
      r.counter.perEval.push({
        gate: expr.indexOf('if(true){return {ok:true,found:true,waited:true') >= 0,
        attempts: r.counter.attempts - before,
      });
      return Promise.resolve(out);
    },
    r.readLiveModel,
    (ms) => { clock.v += Number(ms) || 0; return Promise.resolve(); },
    fakeDate);

  const started = clock.v;
  const result = await mod.exports.openConversationById(o.id || TARGET, o.timeoutMs);
  return Object.assign({ result, elapsed: clock.v - started, logs, exprs }, r.counter);
}

const hasOld = !!OLDFN;
const GATE = (e) => e.gate;

(async () => {
  /* ---------- S1 目标已打开：立刻成功、一次点击都不发 ---------- */
  {
    const st = () => baseState({ selected: TARGET, routeId: TARGET, controllers: [TARGET] });
    const n = await runImpl(NEWFN, st(), { timeoutMs: 90000 });
    ok(n.result === true, 'S1 已打开 → true');
    eq('S2 已打开时点击次数为 0（点击是无效动作，别打断已有加载）', n.attempts, 0);
    ok(n.evalError === null, 'S3 注入表达式无异常');
    ok(n.logs.some((l) => /已打开 id=.*用时 \d+ms 点击=0/.test(l)), 'S4 成功也留一行可核对的日志');
  }

  /* ---------- S5 「加载中」+ 25s 才落地：修复前必挂、修复后必成 ---------- */
  const loadingState = () => baseState({
    selected: TARGET, routeId: TARGET, loadingId: TARGET,
    controllers: [], loadFinishIn: 25000,
  });
  {
    const n = await runImpl(NEWFN, loadingState(), { timeoutMs: 90000 });
    ok(n.result === true, 'S5 加载 25s 后落地 → 新实现 true（真实故障场景）');
    ok(n.elapsed >= 20000, 'S6 是「等」出来的成功，不是靠狂点', 'elapsed=' + n.elapsed);
    ok(n.attempts <= 4, 'S7 全程点击尝试 ≤4（第 1 轮预热 + 等待超时后少量重试）', 'attempts=' + n.attempts);
    ok(n.attempts >= 1, 'S8 至少发过 1 次预热点击（保底不被动）');
    const gated = n.perEval.filter(GATE);
    ok(gated.length >= 20, 'S9 等待期确实走了「只观测」通道', 'gated=' + gated.length + '/' + n.perEval.length);
    ok(n.perEval.filter((e) => e.gate).every((e) => e.attempts === 0), 'S10 「只观测」通道内一次点击都没发');
    ok(n.logs.some((l) => /等待中 id=.*目标会话正在加载/.test(l)), 'S11 等待期有心跳日志（人能看见它在干嘛）');

    if (hasOld) {
      const o = await runImpl(OLDFN, loadingState(), { timeoutMs: 15000 });
      ok(o.result === false, 'S12 旧实现同场景失败 —— 复现 20:05 那次报错');
      ok(o.elapsed >= 14000 && o.elapsed <= 17000, 'S13 旧实现烧光 15s 预算才放弃（现场 15.7s）', 'elapsed=' + o.elapsed);
      ok(o.attempts >= 6, 'S14 旧实现把预算全用在狂点上', 'attempts=' + o.attempts);
      ok(o.effective === 0, 'S15 旧实现那些点击一次都没生效（全被 renderer 去重吞掉）');
      ok(o.swallowed.length > 0 && o.swallowed.every((s) => s === 'loading'),
        'S16 每一次点击都是被「加载中去重」吞的（这就是 20:05 的真因）', JSON.stringify(o.swallowed));
      ok(o.logs.some((l) => /reason=unknown pick=\d+/.test(l)), 'S16b 旧实现现场日志是 reason=unknown（分不清「行不在」和「点了被吞」）');
    } else {
      skipOne('S12-S16 旧实现对照', '取不到 HEAD 版本');
    }
  }

  /* ---------- S17 侧栏行高亮但路由在首页：预热点击是唯一出路 ---------- */
  {
    const n = await runImpl(NEWFN, baseState({
      selected: TARGET, routeId: null, loadingId: null, controllers: [], loadMs: 2000,
    }), { timeoutMs: 90000 });
    ok(n.result === true, 'S17 行高亮 + 路由未指过来 → 第 1 轮预热点击后打开');
    ok(n.elapsed < 8000, 'S18 这种情况必须很快成功（没有被 20s 等待拖住）', 'elapsed=' + n.elapsed);
    eq('S19 只花了 1 次点击', n.attempts, 1);
    eq('S20 那 1 次点击真的生效了', n.effective, 1);
  }

  /* ---------- S21 行在、未选中：立刻点击（不退让） ---------- */
  {
    const mk = () => baseState({ selected: OTHER, routeId: OTHER, controllers: [OTHER], loadMs: 1500 });
    const n = await runImpl(NEWFN, mk(), { timeoutMs: 90000 });
    ok(n.result === true, 'S21 非加载态 → 点击后成功');
    ok(n.attempts === 1 && n.effective === 1, 'S22 立刻点击且立刻生效（1 次）');
    ok(n.elapsed < 4000, 'S23 用时短（没有多余的等待）', 'elapsed=' + n.elapsed);
    if (hasOld) {
      const o = await runImpl(OLDFN, mk(), { timeoutMs: 15000 });
      ok(o.result === true, 'S24 旧实现在这个场景也是成功的（说明修复没有拿旧场景换新场景）');
    }
  }

  /* ---------- S25 点了打不开（inert）：失败日志必须能定位 ---------- */
  {
    const n = await runImpl(NEWFN, baseState({
      selected: OTHER, routeId: OTHER, controllers: [OTHER], inert: true,
    }), { timeoutMs: 8000 });
    ok(n.result === false, 'S25 点不动 → false');
    ok(n.attempts >= 3, 'S26 点了多轮（候选元素在轮换）', 'attempts=' + n.attempts);
    ok(n.logs.some((l) => /打开会话失败 id=.*reason=unknown pick=\d+ 点击=\d+ 轮次=\d+ 用时=\d+ms selected=[0-9a-f]* controllers=\[/.test(l)), 'S27 失败日志带全部现场（reason/pick/点击/轮次/用时/selected/controllers）');
    ok(n.logs.some((l) => /行数=15/.test(l)), 'S28 失败日志带行数');
    ok(n.logs.some((l) => /点到=/.test(l)), 'S29 失败日志带「点到了什么元素」');
    ok(n.effective === 0, 'S30 inert 点击从未生效');
  }

  /* ---------- S31 无列表 / 无行 / CDP 无响应：三种原因必须能分开 ---------- */
  {
    const n1 = await runImpl(NEWFN, baseState({ list: false }), { timeoutMs: 3000 });
    ok(n1.result === false && n1.attempts === 0, 'S31 无列表 → false 且零点击');
    ok(n1.logs.some((l) => /reason=no-list/.test(l)), 'S32 reason=no-list');

    const n2 = await runImpl(NEWFN, baseState({ hit: false }), { timeoutMs: 3000 });
    ok(n2.result === false && n2.attempts === 0, 'S33 行不在 → false 且零点击');
    ok(n2.logs.some((l) => /reason=no-row/.test(l)), 'S34 reason=no-row（与 no-result 区分开）');
    ok(n2.headerClicks >= 1, 'S35 行不在时会尝试展开收起的会话分组');

    const n3 = await runImpl(NEWFN, baseState({ cdpNull: true }), { timeoutMs: 3000 });
    ok(n3.result === false && n3.attempts === 0, 'S36 CDP 无响应 → false 且零点击');
    ok(n3.logs.some((l) => /reason=no-result/.test(l)), 'S37 reason=no-result');
  }

  /* ---------- S38 预算钳制：timeoutMs 再小也不会「瞬间放弃」 ---------- */
  {
    const n = await runImpl(NEWFN, baseState({
      selected: TARGET, routeId: TARGET, loadingId: TARGET, controllers: [],
    }), { timeoutMs: 1 });
    ok(n.result === false, 'S38 一直加载中 → false');
    ok(n.elapsed >= 2800, 'S39 timeoutMs=1 被钳到 ≥3s（不会 0ms 秒退）', 'elapsed=' + n.elapsed);
    eq('S40 极小预算下仍保底发 1 次预热点击', n.attempts, 1);
    if (hasOld) {
      const o = await runImpl(OLDFN, baseState({
        selected: TARGET, routeId: TARGET, loadingId: TARGET, controllers: [],
      }), { timeoutMs: 1 });
      ok(o.elapsed < 2000, 'S41 旧实现 timeoutMs=1 → 只跑 1 轮就退（钳制是真的新增）', 'elapsed=' + o.elapsed);
    }
  }

  /* ---------- S42 所有注入表达式都可被 new Function 解析 ---------- */
  {
    const all = [];
    const cases = [
      ['已打开', baseState({ selected: TARGET, routeId: TARGET, controllers: [TARGET] })],
      ['加载中', baseState({ selected: TARGET, routeId: TARGET, loadingId: TARGET, loadFinishIn: 25000 })],
      ['无行', baseState({ hit: false })],
      ['无列表', baseState({ list: false })],
    ];
    for (const [name, st] of cases) {
      const r = await runImpl(NEWFN, st, { timeoutMs: 4000 });
      all.push(...r.exprs);
      ok(r.evalError === null, 'S42 ' + name + ' 场景注入表达式真跑无异常', r.evalError);
    }
    ok(all.length > 10, 'S43 采样到的表达式数量够多', 'n=' + all.length);
  }

  console.log('\n===== test-session-open: ' + pass + ' pass / ' + fail + ' fail / ' + skip + ' skip =====');
  if (fail > 0) process.exitCode = 1;
})();
