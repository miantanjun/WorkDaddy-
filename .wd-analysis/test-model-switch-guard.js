'use strict';
// 模型切换守卫（只读提醒）。背景见 scripts/model-switch-guard.js 文件头。
// 核心判据三段式：unstable_setSessionModel（想用的）→ Sending request（实际发的，模型不一致）
//   → 紧随一次 refusal classified（确实失败）。三者齐全才算命中。
// 4 天真实日志回放：SET=118 / REQ=3567，只命中 5 次且全带错误码，276 次正常切换零误报。
// 本套件守：A 判据（含四条反向对照）· B 日志解析 · C 尾部读取 · D 扫描窗口 · E 策略读写 ·
//           F 接线与边界（只读 / 跨注入去重 / 打包白名单 / CRLF）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guard = require('../scripts/model-switch-guard.js');

const ROOT = path.resolve(__dirname, '..');
const readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const read = (p) => readFile(p).replace(/\r\n/g, '\n');

// 静态断言必须剥注释：文件头大段背景里写着 SET/REQ 等字样，不剥会被误判
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const T0 = Date.parse('2026-10-29T09:06:00.000Z');
const at = (sec) => T0 + sec * 1000;

const evSet = (m, sec) => ({ at: at(sec), kind: 'set', model: m });
const evReq = (m, sec, url) => ({ at: at(sec), kind: 'req', model: m, url: url || 'https://2api.xiaofanya.top/v1/chat/completions' });
const evErr = (sec, status, code) => ({ at: at(sec), kind: 'err', status: status === undefined ? 429 : status, code: code === undefined ? 6004 : code });

// ===== A. 判据 =====
test('A1 切了模型、请求仍发往旧模型、紧随失败 → 命中', () => {
  const hit = guard.detectSwitchMismatch([
    evSet('cn:deepseek-v4.1-flash', 0),
    evReq('deepseek-v4.1-flash', 1),
    evErr(1, 429, 6004),
  ]);
  assert.ok(hit, '这组必须命中');
  assert.equal(hit.wanted, 'cn:deepseek-v4.1-flash');
  assert.equal(hit.used, 'deepseek-v4.1-flash');
  assert.equal(hit.url, 'https://2api.xiaofanya.top/v1/chat/completions');
  assert.equal(hit.status, 429);
  assert.equal(hit.code, 6004);
  assert.equal(hit.at, at(0), '命中时刻取切换那一刻，不是报错那一刻');
});

test('A2 模型一致 → 不命中（切换生效，后面报错与切换无关）', () => {
  const hit = guard.detectSwitchMismatch([
    evSet('cn:deepseek-v4.1-flash', 0),
    evReq('cn:deepseek-v4.1-flash', 1),
    evErr(1),
  ]);
  assert.equal(hit, null);
});

test('A3 模型不一致但请求成功 → 不命中（用户没受影响，不许打扰）', () => {
  const hit = guard.detectSwitchMismatch([
    evSet('cn:deepseek-v4.1-flash', 0),
    evReq('deepseek-v4.1-flash', 1),
  ]);
  assert.equal(hit, null);
});

test('A4 custom-local: 前缀剥离后视为一致（SET 带、REQ 不带是常态）', () => {
  assert.equal(guard.normalizeModel('custom-local:cn:deepseek-v4.1-flash'), 'cn:deepseek-v4.1-flash');
  assert.equal(guard.normalizeModel('  cn:deepseek-v4.1-flash  '), 'cn:deepseek-v4.1-flash');
  const hit = guard.detectSwitchMismatch([
    evSet('custom-local:cn:deepseek-v4.1-flash', 0),
    evReq('cn:deepseek-v4.1-flash', 1),
    evErr(1),
  ]);
  assert.equal(hit, null, '带前缀与不带前缀是同一条线路，不能报');
});

test('A5 定时任务的 wb-lite 不参与判定', () => {
  const hit = guard.detectSwitchMismatch([
    evSet('cn:deepseek-v4.1-flash', 0),
    evReq('wb-lite', 1),
    evErr(1),
  ]);
  assert.equal(hit, null);
});

test('A6 中间夹了另一次请求 → 旧报错不算这次切换的（不许张冠李戴）', () => {
  const hit = guard.detectSwitchMismatch([
    evSet('cn:deepseek-v4.1-flash', 0),
    evReq('deepseek-v4.1-flash', 1),
    evReq('deepseek-v4.1-flash', 2),
    evErr(2),
  ]);
  assert.equal(hit, null);
});

test('A7 多次命中取最后一次（弹最新那次，别翻旧账）', () => {
  const hit = guard.detectSwitchMismatch([
    evSet('cn:deepseek-v4.1-flash', 0),
    evReq('deepseek-chat', 1),
    evErr(1),
    evSet('cn:deepseek-v4.1-pro', 10),
    evReq('deepseek-v4.1-flash', 11),
    evErr(11, 403, 1001),
  ]);
  assert.ok(hit);
  assert.equal(hit.wanted, 'cn:deepseek-v4.1-pro');
  assert.equal(hit.used, 'deepseek-v4.1-flash');
  assert.equal(hit.status, 403);
});

test('A8 没有切换记录的失败请求 → 不命中（正常重试/老会话不许报）', () => {
  const hit = guard.detectSwitchMismatch([evReq('deepseek-v4.1-flash', 1), evErr(1)]);
  assert.equal(hit, null);
});

// ===== B. 日志解析 =====
const fmt = (ms) => {
  const d = new Date(ms);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return '[' + d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' +
    p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3) + ']';
};

test('B1 三种行都识别，时间戳精确到毫秒', () => {
  const t = at(0);
  const text = [
    fmt(t) + ' unstable_setSessionModel called: sessionId=abc modelId=custom-local:cn:deepseek-v4.1-flash',
    fmt(t + 500) + ' Sending request: sessionId=abc model=deepseek-v4.1-flash, stream=true, url=https://www.workbuddy.cn/v1/chat',
    fmt(t + 900) + ' refusal classified: kind=rate_limit, httpStatus=429, bizCode=6004',
  ].join('\n');
  const ev = guard.parseLogEvents(text);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((e) => e.kind), ['set', 'req', 'err']);
  assert.equal(ev[0].at, t);
  assert.equal(ev[1].at, t + 500);
  assert.equal(ev[0].model, 'custom-local:cn:deepseek-v4.1-flash');
  assert.equal(ev[1].url, 'https://www.workbuddy.cn/v1/chat');
  assert.equal(ev[2].status, 429);
  assert.equal(ev[2].code, 6004);
});

test('B2 没带状态码/业务码的 refusal 也算一次失败（本地异常也要抓）', () => {
  const ev = guard.parseLogEvents(fmt(at(0)) + ' refusal classified: kind=local_error');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'err');
  assert.equal(ev[0].status, 0);
  assert.equal(ev[0].code, 0);
});

test('B3 无时间戳前缀的行（堆栈、空行、其它模块）一律忽略', () => {
  const ev = guard.parseLogEvents(['    at foo (bar.js:1:2)', '', 'Sending request: model=x, url=y', 'null'].join('\n'));
  assert.deepEqual(ev, []);
});

// ===== C. 尾部读取 =====
test('C1 从中间切入时首行残破必须丢掉（按行对齐）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-'));
  const f = path.join(dir, 'big.log');
  const line = 'X'.repeat(40) + '\n';
  fs.writeFileSync(f, line.repeat(20), 'utf8');
  const tail = guard.readTail(f, 95);
  assert.ok(tail.text.startsWith('X'.repeat(40)), '首字符必须是一整行的开头，不能是半截');
  assert.equal(tail.text.split('\n').filter(Boolean).length, 2);
  assert.equal(tail.text.endsWith('\n'), true);
});

test('C2 文件比窗口小 → 全量读出，首行不丢', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-'));
  const f = path.join(dir, 'small.log');
  const body = 'line1\nline2\nline3\n';
  fs.writeFileSync(f, body, 'utf8');
  const tail = guard.readTail(f, 1024 * 1024);
  assert.equal(tail.text, body);
  assert.equal(tail.size, body.length);
});

// ===== D. 扫描窗口 =====
function makeLogs(events, nowMs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-logs-'));
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  const dayDir = path.join(root, d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()));
  fs.mkdirSync(dayDir, { recursive: true });
  const file = path.join(dayDir, 'proj__a1b2c3d4e5f60708.log');
  fs.writeFileSync(file, events.join('\n') + '\n', 'utf8');
  return root;
}

// ⚠️ 必须用真实 now：文件活跃度是拿 mtime 比 now 判的，钉死一个假时刻会让文件被判成
// 「20 分钟内没写过」而直接跳过，测试就成了自欺（本套件第一版就踩过）。
test('D1 3 分钟内的命中 → 返回 hit 并带日志文件名', () => {
  const now = Date.now();
  const root = makeLogs([
    fmt(now - 174000) + ' unstable_setSessionModel called: modelId=custom-local:cn:deepseek-v4.1-flash',
    fmt(now - 173000) + ' Sending request: model=deepseek-v4.1-flash, url=https://2api.xiaofanya.top/v1/chat',
    fmt(now - 172000) + ' refusal classified: httpStatus=403, bizCode=1001',
  ], now);
  const r = guard.scanModelSwitch(root, { now });
  assert.ok(r.hit, '2 分 52 秒前发生的，还在新鲜窗口内');
  assert.equal(r.hit.logFile, 'proj__a1b2c3d4e5f60708.log');
  assert.equal(r.hit.used, 'deepseek-v4.1-flash');
  assert.equal(r.scanned, 1);
});

test('D2 超过新鲜窗口的旧账不翻（10 分钟前 → null）', () => {
  const now = Date.now();
  const root = makeLogs([
    fmt(now - 600000) + ' unstable_setSessionModel called: modelId=custom-local:cn:deepseek-v4.1-flash',
    fmt(now - 599000) + ' Sending request: model=deepseek-v4.1-flash, url=https://2api.xiaofanya.top/v1/chat',
    fmt(now - 598000) + ' refusal classified: httpStatus=429, bizCode=6004',
  ], now);
  assert.equal(guard.scanModelSwitch(root, { now }).hit, null);
});

test('D3 日志目录不存在 → 空结果，绝不抛（提醒功能不能变成新故障源）', () => {
  const r = guard.scanModelSwitch(path.join(os.tmpdir(), 'wd-msguard-not-exist-' + Date.now()), { now: Date.now() });
  assert.deepEqual(r.hit, null);
  assert.equal(r.scanned, 0);
});

// ===== E. 策略读写 =====
test('E1 没写过策略 → 默认开（缺省关掉会让用户继续在「切了没用」里耗时间）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-data-'));
  const p = guard.readGuardPolicy(dir);
  assert.equal(p.enabled, guard.DEFAULT_ENABLED);
  assert.equal(p.enabled, true);
  assert.equal(p.source, 'default');
});

test('E2 坏 JSON / 字段类型不对 → 退回默认开', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-data-'));
  fs.writeFileSync(guard.guardPolicyPath(dir), '{ not json', 'utf8');
  assert.equal(guard.readGuardPolicy(dir).enabled, true);
  fs.writeFileSync(guard.guardPolicyPath(dir), '{"enabled":"yes"}', 'utf8');
  const p = guard.readGuardPolicy(dir);
  assert.equal(p.enabled, true);
  assert.equal(p.source, 'default', '字符串 yes 不是布尔，必须退回默认而不是强转');
});

test('E3 写 false 后读回 false，source=file，updatedAt 是 ISO 时刻', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-data-'));
  const ret = guard.writeGuardEnabled(dir, false);
  assert.equal(ret.enabled, false);
  const p = guard.readGuardPolicy(dir);
  assert.equal(p.enabled, false);
  assert.equal(p.source, 'file');
  assert.match(p.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  guard.writeGuardEnabled(dir, true);
  assert.equal(guard.readGuardPolicy(dir).enabled, true);
});

test('E4 原子写：先写 .tmp 再 rename，不留残片', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-msguard-data-'));
  guard.writeGuardEnabled(dir, false);
  const target = guard.guardPolicyPath(dir);
  assert.equal(fs.existsSync(target), true);
  assert.equal(fs.existsSync(target + '.tmp'), false, '.tmp 必须已被 rename 掉');
  const body = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(Object.keys(body).sort(), ['enabled', 'updatedAt']);
});

// ===== F. 接线与边界 =====
test('F1 daemon 接线：require 模块 + 两条路由 + 1.5 秒节流缓存', () => {
  const src = codeOnly(read('scripts/daemon.js'));
  assert.match(src, /require\('\.\/model-switch-guard\.js'\)/, '缺 require');
  for (const name of ['readGuardPolicy', 'writeGuardEnabled', 'scanModelSwitch']) {
    assert.ok(src.includes(name + '('), 'daemon 没调用 ' + name);
  }
  assert.match(src, /'\/api\/model-switch-check'/);
  assert.match(src, /'\/api\/model-switch-guard-set'/);
  assert.match(src, /switchGuardCache/, '缺节流缓存：4 秒一poll 会反复解析日志');
  assert.match(src, /now - switchGuardCache\.at > 1500/, '节流窗口应为 1.5 秒');
});

test('F2 关掉开关时接口直接短路（不做任何日志解析）', () => {
  const src = codeOnly(read('scripts/daemon.js'));
  const idx = src.indexOf("'/api/model-switch-check'");
  assert.notEqual(idx, -1);
  const body = src.slice(idx, src.indexOf("'/api/model-switch-guard-set'", idx));
  const guardIdx = body.indexOf('policy.enabled');
  assert.notEqual(guardIdx, -1, '必须先读策略');
  assert.ok(guardIdx < body.indexOf('scanModelSwitch'), '短路判断必须在扫描之前');
  assert.match(body, /enabled: false/, '关闭时应原样回 enabled:false');
});

test('F3 注入层只提醒不发请求（守卫块里不许出现发消息/改模型的调用）', () => {
  const src = codeOnly(read('scripts/inject.js'));
  const start = src.indexOf('var MODEL_SWITCH_GUARD_MS');
  const end = src.indexOf('startModelSwitchGuard();', start);
  assert.ok(start !== -1 && end > start, '找不到守卫块');
  const block = src.slice(start, end);
  for (const banned of ['unstable_setSessionModel', 'sendMessage', 'composerSend', 'setSessionModel']) {
    assert.ok(!block.includes(banned), '只能提醒，不许碰 ' + banned);
  }
  assert.match(block, /runtime\.show\(/, '提醒必须走 toast');
  assert.match(block, /level: 'warning'/);
});

test('F4 去重键必须挂 window（inject 全量重建，闭包会重来）', () => {
  const src = codeOnly(read('scripts/inject.js'));
  assert.match(src, /window\.__wbsModelSwitchGuardSeen/);
  const start = src.indexOf('function pollModelSwitchGuard');
  const block = src.slice(start, src.indexOf('function startModelSwitchGuard', start));
  assert.match(block, /hit\.at/, '去重键应包含切换时刻');
  assert.match(block, /hit\.used/, '去重键应包含实际用的模型');
});

test('F5 增强页有卡片 + 开关 + 接线，轮询 4 秒一次', () => {
  const src = codeOnly(read('scripts/inject.js'));
  assert.match(src, /id="wbs-msguard-card"/);
  assert.match(src, /id="wbs-msguard-toggle"/);
  assert.match(src, /id="wbs-msguard-status"/);
  assert.match(src, /wireModelSwitchGuard\(\)/);
  assert.match(src, /'\/api\/model-switch-guard-set'/, '开关必须写策略');
  assert.match(src, /MODEL_SWITCH_GUARD_MS = 4000/, '轮询间隔 4 秒');
  assert.match(src, /setTimeout\(function \(\) \{[\s\S]*?\}, 5000\)/, '首轮延迟 5 秒等 daemon 就绪');
});

test('F6 开关不用 window.confirm（Electron 不实现，静默返回 false）', () => {
  const src = codeOnly(read('scripts/inject.js'));
  const start = src.indexOf('function wireModelSwitchGuard');
  assert.notEqual(start, -1);
  const block = src.slice(start, src.indexOf('function wireEnhancePane', start));
  assert.ok(!block.includes('confirm('), '不能依赖原生 confirm');
  assert.match(block, /sw\.checked = !enabled/, '写失败必须回滚开关状态');
});

test('F7 打包白名单两处都带上（漏一处 ⇒ 发出去的包装不起来）', () => {
  const sh = readFile('scripts/build-mac-dmg.sh');
  const n = (sh.match(/model-switch-guard\.js/g) || []).length;
  assert.equal(n, 2, 'for 循环列表与逐行 cp 列表各一处，实际 ' + n);
});

test('F8 scripts/model-switch-guard.js 是纯 CRLF（scripts 目录纪律）', () => {
  const buf = readFile('scripts/model-switch-guard.js');
  const lf = (buf.match(/\n/g) || []).length;
  const crlf = (buf.match(/\r\n/g) || []).length;
  assert.ok(lf > 0);
  assert.equal(lf, crlf, '存在裸 LF 行：' + (lf - crlf));
});
