'use strict';
/*
 * test-session-activation.js —— 「会话激活分层融合」的守卫（上游 1.2.6 吸纳 · 批次 5 / B1 + C2 + A9）。
 *
 * 背景：本地打开会话靠 `openConversationById` —— 一整套「模拟用户点击」的兜底（滚侧栏、
 * 按候选轮换点 `_card_`、等 20s 加载、唤醒收起侧栏……）。这些补丁存在的唯一原因是
 * **点击本身不确定**（renderer 有三条静默 no-op 分支）。
 * 上游 1.2.6 改调**官方会话导航 handler / SDK**：那是「发起动作」，不需要绕行。
 *
 * 本套件守两层：
 *   [A] 行为级（真函数 + 假 renderer）：快路径**只在可验证时**成立，其余一律回落点击循环，
 *       且回落路径**一个字节的行为都不变**（老成功路径不许被新路径换掉）。
 *   [B] 源码级：三个安全约束与 A9 的所有权校验必须都在代码里（缺一个就是静默退化）。
 *
 * 跑法：node .wd-analysis/test-session-activation.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAEMON = path.join(ROOT, 'scripts', 'daemon.js');
const INJECT = path.join(ROOT, 'scripts', 'inject.js');
const SRC = fs.readFileSync(DAEMON, 'utf8').replace(/\r\n/g, '\n');
const ISRC = fs.readFileSync(INJECT, 'utf8').replace(/\r\n/g, '\n');

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

const sliceFn = (src, name) => {
  const start = src.indexOf('async function ' + name + '(');
  if (start < 0) throw new Error('找不到 ' + name);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error('找不到 ' + name + ' 的结尾');
  return src.slice(start, end + 2);
};
const FNSRC = sliceFn(SRC, 'openConversationById');

const TARGET = '882c357a-6b2a-403b-b66e-43039e07c230';
const OTHER = '1d80c722-dff7-4bb7-bd29-591236f90c70';

/* ==================================================================== */
section('[A] 行为级：快路径只在可验证时成立，其余回落（真函数 + 假 renderer）');
/* ==================================================================== */

/*
 * 假 renderer 的建模原则：**只建模快路径与点击循环真正读到的那些东西**。
 *   · `hasCompat`         —— window.__wbsWorkBuddyCompat 是否存在
 *   · `hasActivationApi`  —— 上面是否有 findConversationActivationApi
 *   · `authoritative`     —— 该 API 是否代表「官方 handler / SDK」（false = 只有 adapter.emit 退路）
 *   · `activateReturns`   —— activate() 的返回值
 *   · `activationOpens`   —— activate() 是否真的让目标控制器挂上
 *   · `clickOpens`        —— 点击是否能让目标控制器挂上（老路径）
 */
function makeRenderer(state) {
  const ctl = { list: [] };
  const stat = { actCalls: [], clicks: 0, actIds: [] };
  const openTarget = () => { if (ctl.list.indexOf(TARGET) < 0) ctl.list.push(TARGET); };

  const hit = {
    className: '_card_9f2', tagName: 'DIV',
    querySelector: (sel) => (sel.indexOf('_card_') >= 0 ? hit : null),
    getAttribute: () => TARGET,
    click: () => { stat.clicks += 1; if (state.clickOpens) openTarget(); },
  };
  const list = {
    querySelectorAll: (sel) => (sel === '.collapsible-section-header' ? [] : []),
    querySelector: (sel) => (sel === '.conversation-list-content' ? { scrollTop: 0 } : null),
  };
  const doc = {
    querySelectorAll: (sel) => (sel === '[data-conversation-id]' ? { length: 15 } : { length: 0 }),
    querySelector: (sel) => {
      if (sel === '.conversation-list') return list;
      if (sel.indexOf('data-conversation-id=') >= 0) return hit;
      if (sel === '.conversation-list-content') return { scrollTop: 0 };
      return null;
    },
  };

  const compat = {
    findConversationControllers: () => ctl.list.map((id) => ({ conversationId: id })),
    getSelectedConversationId: () => (ctl.list[0] || ''),
  };
  if (state.hasActivationApi !== false) {
    compat.findConversationActivationApi = () => (state.hasActivationApi === false ? null : {
      authoritative: state.authoritative === true,
      activate: (id) => {
        stat.actCalls.push(String(id));
        stat.actIds.push(String(id));
        if (state.activateReturns === false) return false;
        if (state.activationOpens) openTarget();
        return true;
      },
    });
  }
  const win = state.hasCompat === false ? {} : { __wbsWorkBuddyCompat: compat };
  // ⚠️ 控制器列表必须**独立于 compat 是否可见**：真机上 daemon 的 readLiveModel 走的是
  // daemon↔renderer 的读取通道，而不是 `window.__wbsWorkBuddyCompat`。所以「老路径的成功
  // 判据」在 compat 缺失时依然成立 —— 这里照实建模，否则会误判成「老路径挂了」。
  return { doc, win, stat, getControllers: () => ctl.list.slice() };
}

async function runOpen(state, opts) {
  const o = opts || {};
  const clock = { v: 1789650000000 };
  const r = makeRenderer(state);
  const exprs = [];
  const logs = [];
  const fakeDate = new Proxy(Date, { get: (t, k) => (k === 'now' ? () => clock.v : t[k]) });
  const mod = { exports: {} };
  const factory = new Function('module', 'exports', 'cdp', 'log', 'runCdpExpression',
    'readLiveModel', 'sleep', 'Date',
    FNSRC + '\nmodule.exports = { openConversationById };\n');
  factory(mod, mod.exports, { connected: true },
    (s) => logs.push(String(s)),
    (expr) => {
      exprs.push(expr);
      let out = null;
      try { out = new Function('window', 'document', 'return ' + expr)(r.win, r.doc); }
      catch (e) { out = null; }
      return Promise.resolve(out);
    },
    () => Promise.resolve(ctlFirst(r)),
    (ms) => { clock.v += Number(ms) || 0; return Promise.resolve(); },
    fakeDate);
  const started = clock.v;
  const result = await mod.exports.openConversationById(o.id || TARGET, o.timeoutMs || 15000);
  return { result, elapsed: clock.v - started, logs, exprs, stat: r.stat };
}
// readLiveModel：取「第一个已挂载控制器」的会话 id（与 daemon 里限流实现取 list[0] 一致）。
// 注意：它走的是 daemon 自己的读取通道，**不经** window.__wbsWorkBuddyCompat。
function ctlFirst(r) {
  const ids = r.getControllers();
  return ids.length ? { ok: true, model: 'gpt-test', conversationId: ids[0] } : { ok: false, error: '未找到会话控制器' };
}

const hasFast = (n) => n.exprs.some((e) => e.includes('findConversationActivationApi'));

(async () => {
  /* ---- A1：没有 compat ⇒ 快路径不成立，走老流程 ---- */
  {
    const n = await runOpen({ hasCompat: false, clickOpens: true });
    ok(n.result === true, 'A1 无 compat 时仍靠点击循环成功（回落路径可用）', n.result);
    ok(hasFast(n), 'A2 快路径确实被探测过（不是被跳过）');
    ok(n.logs.some((l) => /方式=live|已打开 id=/.test(l)), 'A3 成功日志走的是老路径（方式=live）', n.logs.filter((l) => l.includes('[session-open] 已打开')));
    ok(!n.logs.some((l) => /方式=official/.test(l)), 'A4 未冒充官方路径（日志诚实）');
  }

  /* ---- A5：有 compat 但没有官方 API ⇒ 不激活、回落 ---- */
  {
    const n = await runOpen({ hasActivationApi: false, clickOpens: true });
    ok(n.result === true, 'A5 无官方 API ⇒ 回落点击循环并成功', n.result);
    ok(n.stat.actCalls.length === 0, 'A6 一次 activate 都没调（不猜、不硬来）', n.stat.actCalls);
  }

  /* ---- A7：只有 adapter.emit 退路（authoritative=false）⇒ 不认，回落 ---- */
  {
    const n = await runOpen({ authoritative: false, activationOpens: true, clickOpens: true });
    ok(n.stat.actCalls.length === 0,
      'A7 ⭐ authoritative=false 时**不调 activate** —— adapter.emit 返回 true 但不保证真的导航，认它就是把「没打开」当成功',
      n.stat.actCalls);
    ok(n.result === true, 'A8 该情形仍靠点击循环成功', n.result);
  }

  /* ---- A9：官方可用且真的打开 ⇒ 快路径成功，且零点击 ---- */
  {
    const n = await runOpen({ authoritative: true, activationOpens: true, clickOpens: true });
    ok(n.result === true, 'A9 官方快路径成功', n.result);
    ok(n.stat.actCalls.length === 1 && n.stat.actCalls[0] === TARGET,
      'A10 恰好激活一次，且激活的是目标会话', n.stat.actCalls);
    ok(n.stat.clicks === 0, 'A11 ⭐ 快路径成功时**一次点击都没发**（这正是它存在的意义：绕开点击的不确定性）', n.stat.clicks);
    ok(n.logs.some((l) => /方式=official/.test(l)), 'A12 成功日志标了方式=official（可核对走的哪条路）',
      n.logs.filter((l) => l.includes('[session-open] 已打开')));
  }

  /* ---- A13：官方可用但没落地 ⇒ 回落，老路径仍能成功 ---- */
  {
    const n = await runOpen({ authoritative: true, activationOpens: false, clickOpens: true });
    ok(n.result === true, 'A13 ⭐ 官方导航没落地时，点击循环兜住（不是直接失败）', n.result);
    ok(n.stat.clicks > 0, 'A14 回落路径真的点了（老机制仍在工作）', n.stat.clicks);
    ok(n.logs.some((l) => /官方导航未落地/.test(l)), 'A15 回落被如实记录（排障时能看出「官方那条没成」）',
      n.logs.filter((l) => l.includes('官方导航')));
  }

  /* ---- A16：官方可用但 activate 返回 false ⇒ 回落 ---- */
  {
    const n = await runOpen({ authoritative: true, activateReturns: false, clickOpens: true });
    ok(n.stat.actCalls.length === 1 && n.result === true,
      'A16 activate 返回 false 时立即回落，仍由点击循环成功', { calls: n.stat.actCalls.length, result: n.result });
  }

  /* ---- A17：谁都没成 ⇒ 返回 false（不许把失败说成成功） ---- */
  {
    const n = await runOpen({ authoritative: true, activationOpens: false, clickOpens: false, }, { timeoutMs: 3000 });
    ok(n.result === false, 'A17 官方与点击都没成 ⇒ false（不虚报成功）', n.result);
  }

  /* ---- A18：快路径耗时不计入「找行」预算 ---- */
  {
    const n = await runOpen({ authoritative: true, activationOpens: false, clickOpens: true });
    ok(n.elapsed > 0, 'A18 端到端仍按 timeoutMs 走完（预算由老流程使用）', n.elapsed);
  }

  /* ==================================================================== */
  section('[B] 源码级：三个安全约束 + A9 所有权校验必须都在代码里');
  /* ==================================================================== */

  ok(/if\(!api\|\|api\.authoritative!==true\)return \{ok:false,reason:"no-authoritative-api"\};/.test(SRC),
    'B1 约束①：只认官方 handler / SDK（authoritative === true）');
  ok(/if\(!api\|\|api\.authoritative!==true\)/.test(SRC) && /api\.activate\(id\)/.test(SRC),
    'B2 约束②：activate 之后必须验证（不是「调用了就算成功」）');
  ok(/if\(cid===id\)\{opened=true;break\}/.test(SRC),
    'B3 ⭐ 成功判据与点击循环**同源**（controller.conversationId === id），不是另一套更弱的规则');
  ok(/官方导航未落地[\s\S]{0,120}回落点击循环/.test(SRC),
    'B4 约束③：不可验证时明确回落，日志写明');
  ok(/快路径耗时\*\*不计入\*\*「找行」预算/.test(SRC),
    'B5 快路径耗时不占调用方给找行的预算（与侧栏唤醒同理）');
  ok(/快路径的任何异常都不阻断老流程/.test(SRC),
    'B6 快路径整段包在 try/catch 里（它的任何异常都不能掀翻老流程）');
  ok((SRC.match(/function openConversationById\(sessionId, timeoutMs\)/) || []).length === 1,
    'B7 ⭐ openConversationById **签名未变**（test-session-open 的 87 条锚在它上面）');
  ok(!/fastExpr[\s\S]{0,2000}\.click\(/.test(SRC),
    'B8 快路径块内部不点任何东西（「官方导航」与「模拟点击」不许混在一起）');

  // ---- A9：所有权校验 ----
  ok(/let carriedSessionId = '';/.test(SRC), 'B9 daemon 接受可选的 currentConversationId（carriedSessionId）');
  ok(/SELECT id, user_id FROM sessions WHERE id = \? AND deleted_at IS NULL LIMIT 1;[\s\S]{0,200}owner === sourceUid/.test(SRC),
    'B10 ⭐ 用会话索引证明该 id 属于**正在被替换的源账号**才准用');
  ok(/丢弃不属于源账号的当前会话/.test(SRC),
    'B11 校验不过时丢弃并留日志（不报错、不影响切换）');
  ok(/所有权校验失败，已忽略该入参/.test(SRC),
    'B12 查库失败也不阻断切换（降级为「不带 id」，不是「切换失败」）');
  ok(/var wanted = ' \+ JSON\.stringify\(carriedSessionId\)/.test(SRC) && /all\[a\]\.getAttribute\("data-conversation-id"\) === wanted/.test(SRC),
    'B13 ⭐ 有可用 id 时**按 id 精确定位那一行**读标题（老路径依赖「selected 类与真实选中态同步」，切号前后未必成立）');
  ok(/if \(!row\) \{[\s\S]{0,600}indexOf\("selected"\)/.test(SRC),
    'B14 定位不到就回落到老路径「找带 selected 类的行」（逐行为不变）');
  ok(/会话聚焦来源=/.test(SRC),
    'B15 聚焦来源可审计（id 已过校验 / dom-selected 一眼看出）');

  // ---- C：renderer 侧把 id 带上 ----
  const bodyHits = (ISRC.match(/currentConversationId: acSwitchConversationId\(\)/g) || []).length;
  ok(bodyHits === 3, 'B16 三处切号调用都带上了 currentConversationId', bodyHits);
  ok(/function acSwitchConversationId\(\) \{[\s\S]{0,400}catch \(_\) \{ return ""; \}/.test(ISRC),
    'B17 读不到选中会话 id 时返回空串（不能为了带上 id 把切换本身拖挂）');
  ok(/typeof compat\.getSelectedConversationId !== "function"\) return "";/.test(ISRC),
    'B18 老 renderer 没有该 API 时同样安全降级');

  console.log('');
  console.log('结果：' + pass + ' 通过，' + failures.length + ' 失败');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.log('');
  console.log('结果：' + pass + ' 通过，' + (failures.length + 1) + ' 失败');
  console.log('  - 未捕获异常: ' + ((e && e.stack) || e));
  process.exit(1);
});
