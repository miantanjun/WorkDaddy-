'use strict';
// 上游 1.2.18：会话列表「后台刷新把用户勾选冲掉」的修复守卫。
// 场景是 —— 自动复制收尾会延迟重载列表，而旧实现每次都 selected = {} / 退出批量模式，
// 用户正在勾第 5 条时列表一刷，前 4 条就没了。
// 结论：静默刷新必须 ① 有勾选/批量模式/弹窗/页面隐藏时直接不刷 ② 刷也不动 selected ③ 保住滚动位置
// ④ 数据没变就不重渲染（防闪）⑤ 并发响应按 serial 只认最新那次。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8');
const src = raw.replace(/\r\n/g, '\n');

// 取出 loadSessions 那一段（含前面新插的两个函数）
const start = src.indexOf('function canRefreshSessions()');
const sessStart = src.indexOf('function loadSessions(options)');
const end = src.indexOf('function renderSessions()');
const gate = start >= 0 ? src.slice(start, sessStart) : '';
const loadFn = sessStart >= 0 ? src.slice(sessStart, end) : '';

test('A1 有 canRefreshSessions 闸门', () => {
  assert.ok(gate.includes('function canRefreshSessions()'));
});

test('A2 闸门覆盖四个「不要刷」的场景', () => {
  assert.match(gate, /sessionsState\.batchMode/);
  assert.match(gate, /sessionsState\.selected\[id\]/);
  assert.match(gate, /document\.hidden/);
  assert.match(gate, /wbs-modal-mask/);
});

test('A3 闸门要求面板确实处于激活态（后台标签页不刷）', () => {
  assert.match(gate, /classList\.contains\('active'\)/);
});

test('A4 自动复制任务在跑时不刷（避免和收尾刷新打架）', () => {
  assert.match(gate, /autoCopyJob/);
  assert.match(gate, /queued\|running/);
});

test('A5 有 refreshSessionsSilently 入口，且先过闸门', () => {
  assert.match(gate, /function refreshSessionsSilently\(\)\s*\{\n\s*if \(!canRefreshSessions\(\)\) return;/);
});

test('A6 loadSessions 接受 options 并解析 silent', () => {
  assert.ok(sessStart > 0);
  assert.match(loadFn, /var silent = !!\(options && options\.silent\);/);
});

test('A7 静默刷新在函数入口再拦一次（防止中途状态变化）', () => {
  assert.match(loadFn, /if \(silent && !canRefreshSessions\(\)\) return;/);
});

test('A8 竞态防护：每次请求递增 readSerial', () => {
  assert.match(loadFn, /sessionsState\.readSerial = \(sessionsState\.readSerial \|\| 0\) \+ 1/);
});

test('A9 响应回来先比 serial，旧响应直接丢弃', () => {
  assert.match(loadFn, /if \(!alive \|\| serial !== sessionsState\.readSerial\) return;/);
});

test('A10 静默刷新前记快照', () => {
  assert.match(loadFn, /var snapshot = silent \? JSON\.stringify\(\[sessionsState\.all/);
});

test('A11 数据没变就跳过重渲染（防闪）', () => {
  assert.match(loadFn, /if \(silent && snapshot === JSON\.stringify\(\[nextAll, nextTotal, nextAutoCopy, nextAutoCopyAll\]\)\) return;/);
});

test('A12 静默刷新不动勾选', () => {
  assert.match(loadFn, /if \(!silent\) sessionsState\.selected = \{\};/);
  assert.ok(!/^\s+sessionsState\.selected = \{\};$/m.test(loadFn), '不得有无条件的 selected 重置');
});

test('A13 静默刷新不退出批量模式', () => {
  assert.match(loadFn, /if \(!silent && sessionsState\.batchMode\)/);
});

test('A14 静默刷新保住滚动位置', () => {
  assert.match(loadFn, /var listScroll = silent \? listEl\.scrollTop : 0;/);
  assert.match(loadFn, /if \(silent\) listEl\.scrollTop = listScroll;/);
});

test('A15 静默失败不清空列表（网络抖一下不该把界面擦成错误页）', () => {
  assert.match(loadFn, /if \(!silent && alive && serial === sessionsState\.readSerial\) \{/);
});

test('A16 自动复制收尾改走静默刷新', () => {
  assert.match(src, /setBuildTimeout\(function \(\) \{ refreshSessionsSilently\(\); \}, 800\);/);
});

test('A17 用户主动切筛选仍走普通刷新（该清勾选就清）', () => {
  // 切 range 的地方自己会先清 selected，然后普通 loadSessions
  const idx = src.indexOf("sessionsState.range = b.getAttribute('data-range');");
  assert.ok(idx > 0);
  const after = src.slice(idx, idx + 300);
  assert.match(after, /sessionsState\.selected = \{\};/);
  assert.match(after, /loadSessions\(\);/);
});

test('A18 inject.js 仍是纯 CRLF', () => {
  assert.ok(raw.includes('\r\n'));
  assert.equal((raw.match(/(^|[^\r])\n/g) || []).length, 0);
});
