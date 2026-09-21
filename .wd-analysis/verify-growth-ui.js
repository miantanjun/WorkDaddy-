'use strict';
/*
 * verify-growth-ui.js —— 真机核对「成长任务·一键完成」是否真的进了面板（CDP，不重启 WorkBuddy）。
 *
 * 只看不点：除「打开浮层（click 账号卡的成长环）」与「切换档位开关再还原」以外不做任何动作，
 * **不会触发上报、不会消耗上游配额**。
 *
 * 验什么：
 *   A. 热更落地：注入的 CSS 有新 UI 样式；页面内联脚本里新词典（中英成对）都在；
 *   B. 打开账号卡的成长浮层，核对新 UI（一键完成全部 / 档位开关 / 单项按钮 / 门控提示按钮）；
 *   C. ⚠️ 关键：**默认未勾选**时 tier3 任务必须落到「门控提示」按钮；勾上后转为可执行按钮；
 *   D. 抓一张浮层截图留证。
 * 跑法：node verify-growth-ui.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const CDP = 'http://127.0.0.1:9222';
const OUT_PNG = path.join(__dirname, 'verify-growth-ui.png');
const CHANGE_HINT = '提示：跑之前先看各账号有没有在飞的一键完成作业 —— 有的话状态行会显示「正在执行 N/M」，属正常，不是缺陷。';

/** 读 daemon 的 token + 账号表（只读，用于跑前体检）。 */
function daemonCall(pathname) {
  const DATA = path.join(process.env.APPDATA, 'WorkDaddy');
  const token = fs.readFileSync(path.join(DATA, '.api-token'), 'utf8').trim();
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 47832, path: pathname, method: 'GET', headers: { 'X-WorkDaddy-Token': token } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(body); } catch (_) { j = null; } resolve(j); });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        });
      },
      close() { try { ws.close(); } catch (_) {} },
    }));
    ws.addEventListener('error', () => reject(new Error('ws error')));
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (!msg.id || !pending.has(msg.id)) return;
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
      else p.res(msg.result);
    });
  });
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面内异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0;
function check(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else { bad += 1; console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}

(async () => {
  const list = await fetch(CDP + '/json/list').then((r) => r.json());
  const page = list.find((t) => t.type === 'page' && /app\.asar/.test(t.url || '')) || list.find((t) => t.type === 'page');
  if (!page) throw new Error('未找到 WorkBuddy 页面 target');
  console.log('附加到页面: ' + (page.title || '').slice(0, 40) + '  ' + page.url.slice(0, 60) + '\n');

  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');

  /* ---------------- 跑前体检：有没有在飞的一键完成作业 ---------------- */
  const accounts = await daemonCall('/api/accounts');
  const uids = ((accounts && accounts.accounts) || []).map((a) => String(a.uid));
  const running = [];
  for (const uid of uids) {
    const st = await daemonCall('/api/growth/tasks-auto-status?uid=' + encodeURIComponent(uid));
    const phase = String((st && st.job && st.job.phase) || 'idle');
    if (phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'timeout') running.push(uid + '=' + phase);
  }
  console.log('跑前体检：账号 ' + uids.length + ' 个，在飞作业 ' + running.length + ' 个' + (running.length ? ' :: ' + running.join(', ') : ''));
  if (running.length) console.log('  ' + CHANGE_HINT);
  console.log('');

  /* ---------------- A. 热更落地 ---------------- */
  console.log('=== A. 热更落地（不重启 WorkBuddy 也生效）===');
  const a = await evaluate(c, `(function(){
    var style = document.getElementById('wbs-style');
    var css = style ? style.textContent : '';
    return {
      hasWidget: !!window.__wbsWidget,
      cssAutoBar: css.indexOf('.wbs-growth-auto-bar') >= 0,
      cssTier3: css.indexOf('.wbs-growth-tier3') >= 0,
      cssAutoStatus: css.indexOf('.wbs-growth-auto-status') >= 0,
      cssResult: css.indexOf('.wbs-growth-task-result') >= 0,
      cssIsAuto: css.indexOf('.wbs-growth-task-action.is-auto') >= 0,
      cssIsGated: css.indexOf('.wbs-growth-task-action.is-gated') >= 0
    };
  })()`);
  check(a.hasWidget, 'A1 面板控件在页面里（热更没把 inject 弄崩）');
  check(a.cssAutoBar && a.cssTier3 && a.cssAutoStatus && a.cssResult,
    'A2 新增 UI 的样式已随热更进页面（自动条 / 档位开关 / 状态行 / 结果行）', a);
  check(a.cssIsAuto && a.cssIsGated, 'A3 「一键完成」与「门控」两种按钮样式都在', a);
  // ⚠️ 这里**刻意不搜 document 文本找词典**：注入源码是走 Runtime.evaluate 执行的，不在 DOM 里；
  //    而页面 DOM 里有聊天记录（可能正好讨论到这些字眼），搜文本会假阳性。文案落地一律看**渲染结果**（见 B7/B8）。

  /* ---------------- B. 打开成长浮层 ---------------- */
  console.log('\n=== B. 打开账号卡的成长浮层（click 置顶，只读渲染）===');
  const opened = await evaluate(c, `(function(){
    var tab = document.querySelector('.wbs-tab[data-tab="accounts"]');
    if (tab) tab.click();
    var rings = document.querySelectorAll('.wbs-daily-rings[data-uid]');
    if (!rings.length) return { error: '没有 .wbs-daily-rings（账号卡可能还没渲染）' };
    var btn = rings[0];
    btn.click();
    return { uid: btn.getAttribute('data-uid'), rings: rings.length };
  })()`);
  if (opened.error) { console.log('  FAIL ' + opened.error); process.exit(2); }
  console.log('      目标账号 uid=' + opened.uid + '，页面共 ' + opened.rings + ' 张账号卡');
  await sleep(1600);

  const probe = `(function(){
    var p = document.getElementById('wbs-status-popover');
    if (!p) return { error: '#wbs-status-popover 不存在' };
    var all = p.querySelector('[data-wbs-growth-auto-all]');
    var tier3 = p.querySelector('[data-wbs-growth-tier3]');
    var autoBtns = p.querySelectorAll('[data-wbs-growth-auto]');
    var hintBtns = p.querySelectorAll('[data-wbs-growth-tier-hint]');
    var st = p.querySelector('.wbs-growth-auto-status');
    var rec = p.getBoundingClientRect();
    return {
      visible: !p.hidden && rec.width > 0,
      cls: p.className,
      rows: p.querySelectorAll('.wbs-growth-task-row').length,
      hasAutoAll: !!all, autoAllDisabled: all ? !!all.disabled : null, autoAllText: all ? (all.textContent || '').trim() : null,
      hasTier3: !!tier3, tier3Checked: tier3 ? !!tier3.checked : null,
      autoCount: autoBtns.length, hintCount: hintBtns.length,
      officialCount: p.querySelectorAll('[data-wbs-growth-official]').length,
      autoStatus: st ? (st.textContent || '').trim() : null,
      // 注意：data-wbs-growth-tier3 挂在 <input> 上，文案在它的 <label> 里 ⇒ 取 label 的文本。
      tier3Text: (function () { var l = p.querySelector('.wbs-growth-tier3'); return l ? (l.textContent || '').trim() : ''; })(),
      sampleAuto: autoBtns.length ? autoBtns[0].getAttribute('data-wbs-growth-auto') : null,
      sampleHint: hintBtns.length ? hintBtns[0].getAttribute('data-wbs-growth-tier-hint') : null,
      rect: { x: Math.round(rec.x), y: Math.round(rec.y), w: Math.round(rec.width), h: Math.round(rec.height) }
    };
  })()`;

  const b = await evaluate(c, probe);
  if (b.error) { console.log('  FAIL ' + b.error); process.exit(2); }

  check(b.visible && /is-daily/.test(b.cls), 'B1 成长浮层已打开（is-daily，只读渲染）', b.cls);
  check(b.rows > 0, 'B2 浮层里有成长任务行', b.rows);
  check(b.hasAutoAll, 'B3 有「一键完成全部」按钮', b.autoAllText);
  check(b.hasTier3, 'B4 有档位开关（纯上报任务）', b.tier3Checked);
  check(b.autoCount > 0, 'B5 有可自动的单项「一键完成」按钮', { autoCount: b.autoCount, sample: b.sampleAuto });
  check(typeof b.autoStatus === 'string' && b.autoStatus.length > 0, 'B6 显示了「可自动项数」状态行', b.autoStatus);
  // 这两条是「新代码真的渲染出来了」的证据（旧写法是「可自动 N 项」，新写法带 ' · ' 标点）。
  // ⚠️ 不要断言「必须是空闲写法」：有作业在跑时状态行本来就会变成「正在执行 N/M 任务码」，
  //    那是正常状态切换，不是缺陷（跑前体检已提示）。所以这里只断言「不会是旧写法」。
  const statusText = String(b.autoStatus || '');
  const isRunningWording = /^正在执行\s+\d+\/\d+/.test(statusText);
  const isIdleWording = /^可自动项数\s*·\s*\d+$/.test(statusText);
  check(isIdleWording || isRunningWording,
    'B7 状态行是新写法（空闲「可自动项数 · N」/ 执行中「正在执行 N/M 任务码」），不是旧的「可自动 N 项」',
    statusText);
  check(String(b.tier3Text || '').indexOf('包含纯上报任务') >= 0,
    'B8 档位开关标签文案已渲染（新代码确实在跑）', b.tier3Text);
  console.log('      浮层尺寸 ' + b.rect.w + 'x' + b.rect.h + '，任务行 ' + b.rows +
    '，可执行按钮 ' + b.autoCount + '，门控按钮 ' + b.hintCount + '，官网按钮 ' + b.officialCount);

  /* ---------------- C. 档位默认关：真机证据 ---------------- */
  console.log('\n=== C. ⚠️ 档位默认关（真机证据）===');
  check(b.tier3Checked === false, 'C1 档位开关默认**未勾选**（tier3 默认关）', b.tier3Checked);
  check(b.hintCount > 0, 'C2 未勾选时 tier3 任务落到「门控提示」按钮而不是「一键完成」按钮',
    { hintCount: b.hintCount, sample: b.sampleHint });
  check(b.autoCount > 0 && b.hintCount > 0,
    'C3 门控只挡 tier3，没有把 tier1/tier2 一起挡掉', { autoCount: b.autoCount, hintCount: b.hintCount });

  const toggled = await evaluate(c, `(function(){
    var p = document.getElementById('wbs-status-popover');
    var box = p && p.querySelector('[data-wbs-growth-tier3]');
    if (!box) return { error: '找不到档位开关' };
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  if (toggled.error) { console.log('  FAIL ' + toggled.error); process.exit(2); }
  await sleep(1200);
  const after = await evaluate(c, `(function(){
    var p = document.getElementById('wbs-status-popover');
    if (!p) return { error: '浮层消失了' };
    return { hintCount: p.querySelectorAll('[data-wbs-growth-tier-hint]').length,
             autoCount: p.querySelectorAll('[data-wbs-growth-auto]').length };
  })()`);
  check(!after.error && after.hintCount === 0 && after.autoCount > b.autoCount,
    'C4 勾上开关后门控按钮转为可执行按钮（开关真的接了线）',
    { before: { auto: b.autoCount, hint: b.hintCount }, after });
  // 还原现场：取消勾选
  await evaluate(c, `(function(){
    var p = document.getElementById('wbs-status-popover');
    var box = p && p.querySelector('[data-wbs-growth-tier3]');
    if (box && box.checked) { box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  })()`).catch(() => {});
  await sleep(900);

  /* ---------------- D. 截图留证 ---------------- */
  console.log('\n=== D. 截图留证 ===');
  const rect = await evaluate(c, `(function(){
    var p = document.getElementById('wbs-status-popover');
    if (!p || p.hidden) return null;
    var r = p.getBoundingClientRect();
    var x = Math.max(0, r.x - 8); var y = Math.max(0, r.y - 8);
    return { x: x, y: y, width: Math.min(window.innerWidth - x, r.width + 16), height: Math.min(window.innerHeight - y, r.height + 16) };
  })()`);
  if (rect) {
    const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, rect) });
    fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));
    console.log('  已保存 ' + OUT_PNG + '（' + Math.round(rect.width) + 'x' + Math.round(rect.height) + '）');
  } else {
    console.log('  浮层不可见，跳过截图');
  }

  // 关闭浮层（再次 click 环 = 取消置顶并隐藏），恢复现场
  await evaluate(c, `(function(){
    var rings = document.querySelectorAll('.wbs-daily-rings[data-uid]');
    if (rings.length) rings[0].click();
    var p = document.getElementById('wbs-status-popover');
    if (p) p.hidden = true;
    return true;
  })()`).catch(() => {});
  c.close();

  console.log('');
  console.log(bad === 0 ? '===== verify-growth-ui: 全部通过 =====' : '===== verify-growth-ui: ' + bad + ' 项未通过 =====');
  process.exit(bad ? 1 : 0);
})().catch((error) => { console.error('verify-growth-ui 失败: ' + (error && error.message || error)); process.exit(2); });
