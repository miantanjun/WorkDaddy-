'use strict';
// 「定时任务到点到底发出去没有」核验机制回归测试（纯 Node，不需要 WorkBuddy / CDP）。
//
// 为什么这么测：
//   A 组 —— 槽位推算（离线补扫的地基）是纯函数，直接真跑；边界最容易出错（跨天、无匹配日、迭代上限）。
//   B 组 —— 台账状态机 + **防重复触发**：同一槽位只登记一次、ok 是终局证据、上报过就不再报、
//           重启（落盘→读回）后也不重报。这几条是用户点名要保证的。
//   C 组 —— 离线补扫：升级当天不能把历史任务全报一遍（闸③），报到过的槽位第二次启动不能重报。
//   D 组 —— 报告文案：人话 + **安全语义**（maybeSent 那类必须写「可能已经发出去，先看会话」）。
//   E 组 —— 接线（源码切片）：核验必须是只读旁路，**不能碰 marks、不能影响调度**。
//   F 组 —— 拿真 createScheduleTicker 跑：同一分钟 tick 两次只回调一次（防重复触发的核心断言）。
//
// 用法: node D:\WorkDaddy\.wd-analysis\test-schedule-verify.js
// 报告（UTF-8）: 同目录 test-schedule-verify.report.txt

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const ledger = require(path.join(SCRIPTS, 'schedule-ledger.js'));
const auto = require(path.join(SCRIPTS, 'automation.js'));
const ss = require(path.join(SCRIPTS, 'scheduled-send.js'));
const accountSwitchLog = require(path.join(SCRIPTS, 'account-switch-log.js'));

const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8').replace(/\r\n/g, '\n');
const DAEMON_SRC = read('daemon.js');
const AUTO_SRC = read('automation.js');
const LEDGER_SRC = read('schedule-ledger.js');

const lines = [];
let pass = 0, fail = 0;
const ok = (name) => { pass++; lines.push('ok   ' + name); };
const bad = (name, detail) => { fail++; lines.push('FAIL ' + name + (detail ? '  :: ' + detail : '')); };
const check = (name, cond, detail) => { cond ? ok(name) : bad(name, detail); };
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  a === b ? ok(name) : bad(name, 'got=' + a + '  expect=' + b);
};
const noThrow = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, String((e && e.message) || e)); } };
const sliceFn = (src, header) => {
  const start = src.indexOf(header);
  if (start < 0) return '';
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return '';
};

// 固定基准时刻：2026-09-17 是周四
const T = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = T(2026, 9, 17, 12, 5);

/* ================= A 组：槽位与推算 ================= */
lines.push('== A1 槽位格式 ==');
eq('slotOfDate 补零且是 YYYY-MM-DDTHH:MM', ledger.slotOfDate(new Date(2026, 8, 17, 9, 5)), '2026-09-17T09:05');
eq('slotOfDate 与 marks 同格式（正则一致）', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ledger.slotOfDate(new Date(NOW))), true);
eq('slotToMs 能解回同一时刻（本地时间）', ledger.slotToMs('2026-09-17T12:05'), NOW);
check('slotToMs 非法串返回 NaN', Number.isNaN(ledger.slotToMs('2026/09/17 12:05')));
check('slotToMs 空值返回 NaN', Number.isNaN(ledger.slotToMs(null)));

lines.push('== A2 scheduleIsVerifiable：哪些任务进核验 ==');
check('once 进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'once', at: '2026-09-17T12:05' } }) === true);
check('daily 进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'daily', time: '12:05' } }) === true);
check('weekly 进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'weekly', time: '12:05', days: [4] } }) === true);
check('monthly 进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'monthly', time: '12:05', day: 17 } }) === true);
check('interval **不**进核验（槽位是进程内相对时间）', ledger.scheduleIsVerifiable({ schedule: { type: 'interval', minutes: 30 } }) === false);
check('manual 不进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'manual' } }) === false);
check('没有 schedule 不进核验', ledger.scheduleIsVerifiable({}) === false);
check('once 时间格式坏掉不进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'once', at: '2026-09-17 12:05' } }) === false);
check('daily 缺 time 不进核验', ledger.scheduleIsVerifiable({ schedule: { type: 'daily' } }) === false);
check('null 安全', ledger.scheduleIsVerifiable(null) === false);

lines.push('== A3 slotsBetween：离线窗口内本该到点的时刻 ==');
const onceTask = { id: 't_once', enabled: true, schedule: { type: 'once', at: '2026-09-17T12:05' } };
eq('once 落在窗口内 → 报', ledger.slotsBetween(onceTask, T(2026, 9, 17, 11, 0), T(2026, 9, 17, 13, 0)), ['2026-09-17T12:05']);
eq('once 早于窗口 → 不报', ledger.slotsBetween(onceTask, T(2026, 9, 17, 13, 0), T(2026, 9, 17, 14, 0)), []);
eq('once 晚于窗口 → 不报', ledger.slotsBetween(onceTask, T(2026, 9, 17, 9, 0), T(2026, 9, 17, 11, 0)), []);
eq('once 正好等于窗口起点 → 不报（左开右闭）', ledger.slotsBetween(onceTask, T(2026, 9, 17, 12, 5), T(2026, 9, 17, 13, 0)), []);
eq('once 正好等于窗口终点 → 报（左开右闭）', ledger.slotsBetween(onceTask, T(2026, 9, 17, 11, 0), T(2026, 9, 17, 12, 5)), ['2026-09-17T12:05']);

const dailyTask = { id: 't_daily', enabled: true, schedule: { type: 'daily', time: '12:05' } };
eq('daily 一天一次', ledger.slotsBetween(dailyTask, T(2026, 9, 17, 9, 0), T(2026, 9, 17, 18, 0)), ['2026-09-17T12:05']);
// 窗口正好 24 小时零 1 分 ⇒ 装得下两次（这是 daily 在 24h 上限内能出现的最大值）
eq('daily 跨天两次（24h 窗口的极限）', ledger.slotsBetween(dailyTask, T(2026, 9, 17, 12, 4), T(2026, 9, 18, 12, 5)), ['2026-09-17T12:05', '2026-09-18T12:05']);
eq('⚠️ 超过 24 小时的窗口只扫最后 24 小时（不翻旧账）', ledger.slotsBetween(dailyTask, T(2026, 9, 17, 9, 0), T(2026, 9, 18, 18, 0)), ['2026-09-18T12:05']);
eq('daily 窗口不含该时刻 → 空', ledger.slotsBetween(dailyTask, T(2026, 9, 17, 13, 0), T(2026, 9, 17, 14, 0)), []);
eq('daily 窗口只差一分钟 → 空', ledger.slotsBetween(dailyTask, T(2026, 9, 17, 12, 6), T(2026, 9, 17, 23, 0)), []);

const weeklyTask = { id: 't_weekly', enabled: true, schedule: { type: 'weekly', time: '12:05', days: [1] } };
eq('weekly 只命中选中的星期（周四是 4，不在 [1] 里）', ledger.slotsBetween(weeklyTask, T(2026, 9, 17, 0, 0), T(2026, 9, 18, 23, 0)), []);
eq('weekly 命中周一', ledger.slotsBetween(weeklyTask, T(2026, 9, 20, 0, 0), T(2026, 9, 22, 0, 0)), ['2026-09-21T12:05']);

const monthlyTask = { id: 't_monthly', enabled: true, schedule: { type: 'monthly', time: '12:05', day: 17 } };
eq('monthly 只命中指定日', ledger.slotsBetween(monthlyTask, T(2026, 9, 17, 0, 0), T(2026, 9, 18, 0, 0)), ['2026-09-17T12:05']);
eq('monthly 该月没有那一天 → 空', ledger.slotsBetween({ schedule: { type: 'monthly', time: '12:05', day: 31 } }, T(2026, 9, 1, 0, 0), T(2026, 9, 30, 23, 0)), []);

eq('interval 不参与推算', ledger.slotsBetween({ schedule: { type: 'interval', minutes: 5 } }, T(2026, 9, 1, 0, 0), T(2026, 9, 30, 0, 0)), []);
const huge = ledger.slotsBetween(dailyTask, T(2026, 1, 1, 0, 0), T(2026, 12, 31, 0, 0));
check('超大窗口被 24 小时截断（迭代上限兜住性能）', huge.length === 1, 'count=' + huge.length);
check('坏窗口（to<=from）返回空', ledger.slotsBetween(dailyTask, T(2026, 9, 17, 13, 0), T(2026, 9, 17, 12, 0)).length === 0);
check('null 任务不抛', ledger.slotsBetween(null, 0, NOW).length === 0);

/* ================= B 组：状态机 + 防重复 ================= */
lines.push('== B1 登记（recordExpected）==');
const L = ledger.emptyLedger(NOW);
const SLOT = '2026-09-17T12:05';
const e1 = ledger.recordExpected(L, { taskId: 't1', slot: SLOT, source: 'once', name: '任务甲', bodyBrief: '摘要', dispatched: true, now: NOW });
eq('登记后状态是 pending（等结果）', e1.status, 'pending');
eq('expectedAt 由槽位解出', e1.expectedAt, NOW);
eq('source 记下了触发方式', e1.source, 'once');
check('未上报（还没到核验时刻）', e1.reportedAt === 0);
const e1b = ledger.recordExpected(L, { taskId: 't1', slot: SLOT, source: 'once', dispatched: true, now: NOW + 500 });
eq('同槽位重复登记不新增记录', Object.keys(L.entries.t1).length, 1);
eq('同槽位重复登记不覆盖已有字段', e1b.name, '任务甲');
const busy = ledger.recordExpected(L, { taskId: 't2', slot: SLOT, source: 'daily', dispatched: false, now: NOW });
eq('到点时任务正在跑（dispatched=false）→ busy', busy.status, 'busy');
const badSlot = ledger.recordExpected(L, { taskId: 't3', slot: '坏槽位', dispatched: true, now: NOW });
check('非法槽位不登记（返回 null）', badSlot === null);
check('非法槽位没有产生条目', Object.keys(L.entries.t3 || {}).length === 0);
check('缺 taskId 不登记', ledger.recordExpected(L, { slot: SLOT, dispatched: true }) === null);
noThrow('ledger 为 null 不抛', () => ledger.recordExpected(null, { taskId: 'x', slot: SLOT }));
noThrow('参数为空不抛', () => ledger.recordExpected(L, null));

lines.push('== B2 回填（recordOutcome）==');
const okEntry = ledger.recordOutcome(L, { taskId: 't1', slot: SLOT, status: 'ok', messageId: 'msg_1', now: NOW + 21300, startedAt: NOW });
eq('回填成功后状态 ok', okEntry.status, 'ok');
eq('回填记下会话回执（强证据）', okEntry.messageId, 'msg_1');
eq('回填算出耗时', okEntry.durationMs, 21300);
const afterOk = ledger.recordOutcome(L, { taskId: 't1', slot: SLOT, status: 'failed', error: '后来的失败不能翻案', now: NOW + 60000 });
eq('⚠️ ok 是终局证据：后面的回填不能把它改回 failed', afterOk.status, 'ok');
eq('⚠️ ok 的 error 也不会被写脏', afterOk.error, '');

const L2 = ledger.emptyLedger(NOW);
ledger.recordExpected(L2, { taskId: 't1', slot: SLOT, dispatched: true, now: NOW });
const f1 = ledger.recordOutcome(L2, { taskId: 't1', slot: SLOT, status: 'failed', error: '会话打不开', now: NOW + 16000, startedAt: NOW });
eq('回填失败 → failed', f1.status, 'failed');
eq('回填保留错误原文', f1.error, '会话打不开');
check('maybeSent 默认 false', f1.maybeSent === false);
const f2 = ledger.recordOutcome(L2, { taskId: 't1', slot: SLOT, status: 'failed', error: '没等到回执', maybeSent: true, now: NOW + 20000 });
check('maybeSent 可被回填为 true', f2.maybeSent === true);
check('未登记过的槽位不回填（返回 null）', ledger.recordOutcome(L2, { taskId: 'nope', slot: SLOT, status: 'ok' }) === null);
noThrow('回填参数为空不抛', () => ledger.recordOutcome(L2, null));

lines.push('== B3 待核验（dueEntries）==');
const L3 = ledger.emptyLedger(NOW);
ledger.recordExpected(L3, { taskId: 't1', slot: SLOT, dispatched: true, now: NOW });
eq('宽限期内不打扰', ledger.dueEntries(L3, { now: NOW + 30000, graceMs: 60000 }).length, 0);
eq('过宽限期后进入核验', ledger.dueEntries(L3, { now: NOW + 61000, graceMs: 60000 }).length, 1);
const L4 = ledger.emptyLedger(NOW);
ledger.recordExpected(L4, { taskId: 't1', slot: SLOT, dispatched: true, now: NOW });
ledger.recordOutcome(L4, { taskId: 't1', slot: SLOT, status: 'ok', now: NOW + 5000, startedAt: NOW });
eq('已成功的槽位永不核验', ledger.dueEntries(L4, { now: NOW + 600000, graceMs: 60000 }).length, 0);
const L5 = ledger.emptyLedger(NOW);
ledger.recordExpected(L5, { taskId: 't1', slot: SLOT, dispatched: true, now: NOW });
ledger.recordOutcome(L5, { taskId: 't1', slot: SLOT, status: 'failed', error: 'x', now: NOW + 5000, startedAt: NOW });
const due5 = ledger.dueEntries(L5, { now: NOW + 61000, graceMs: 60000 });
eq('失败的槽位进入核验', due5.length, 1);
eq('核验项带上 taskId', due5[0].taskId, 't1');
eq('⚠️ 任务仍在跑时不判「没跑完」', ledger.dueEntries(L5, { now: NOW + 61000, graceMs: 60000, isRunning: (id) => id === 't1' }).length, 0);
const L6 = ledger.emptyLedger(NOW);
ledger.recordExpected(L6, { taskId: 't1', slot: SLOT, dispatched: false, now: NOW });
eq('busy 槽位也会被核验（提示被跳过）', ledger.dueEntries(L6, { now: NOW + 61000, graceMs: 60000 }).length, 1);

lines.push('== B4 上报一次就不再报（含重启）==');
const L7 = ledger.emptyLedger(NOW);
ledger.recordExpected(L7, { taskId: 't1', slot: SLOT, dispatched: true, now: NOW });
ledger.recordOutcome(L7, { taskId: 't1', slot: SLOT, status: 'failed', error: 'x', now: NOW + 5000, startedAt: NOW });
const due7 = ledger.dueEntries(L7, { now: NOW + 61000, graceMs: 60000 });
eq('上报条数 = 1', ledger.markReported(L7, due7, { now: NOW + 61000 }), 1);
eq('上报后不再进入核验', ledger.dueEntries(L7, { now: NOW + 999000, graceMs: 60000 }).length, 0);
eq('重复 markReported 幂等（返回 0）', ledger.markReported(L7, due7, { now: NOW + 999000 }), 0);
check('上报时间已落盘字段', ledger.entryOf(L7, 't1', SLOT).reportedAt === NOW + 61000);

lines.push('== B5 落盘 / 读回（重启不重报）==');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-ledger-'));
noThrow('写盘不抛', () => ledger.writeLedger(tmpDir, L7, { fsImpl: fs }));
check('台账文件真的写出来了', fs.existsSync(path.join(tmpDir, ledger.LEDGER_FILE)));
const reread = ledger.readLedger(tmpDir, { fsImpl: fs, now: NOW });
eq('读回后槽位还在', Object.keys(reread.entries.t1).length, 1);
eq('读回后状态还是 failed', ledger.entryOf(reread, 't1', SLOT).status, 'failed');
eq('读回后 reportedAt 还在 → 重启不重报', ledger.dueEntries(reread, { now: NOW + 999000, graceMs: 60000 }).length, 0);
eq('读回后错误原文还在', ledger.entryOf(reread, 't1', SLOT).error, 'x');
check('无临时文件残留（原子写）', fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-')).length === 0);

lines.push('== B6 坏数据一律不抛 ==');
noThrow('读不存在的目录', () => ledger.readLedger(path.join(tmpDir, 'nope'), { fsImpl: fs, now: NOW }));
fs.writeFileSync(path.join(tmpDir, ledger.LEDGER_FILE), '{ not json');
const broken = ledger.readLedger(tmpDir, { fsImpl: fs, now: NOW });
check('坏 JSON 收敛成空台账（不抛、不丢 daemon）', Object.keys(broken.entries).length === 0);
check('坏 JSON 仍给出 createdAt', Number.isFinite(broken.createdAt));
const weird = ledger.normalizeLedger({ version: 99, createdAt: 'x', lastTickAt: null, entries: { a: { slot: 'bad' }, b: [], c: null, d: { '2026-09-17T12:05': { status: '鬼状态' } } } }, NOW);
check('数组/坏槽位的条目被丢弃', !weird.entries.a && !weird.entries.b && !weird.entries.c);
eq('未知 status 归一为 pending', weird.entries.d['2026-09-17T12:05'].status, 'pending');
eq('null 输入 → 空台账', Object.keys(ledger.normalizeLedger(null, NOW).entries).length, 0);
eq('数组输入 → 空台账', Object.keys(ledger.normalizeLedger([], NOW).entries).length, 0);
check('空台账有 createdAt', ledger.emptyLedger(NOW).createdAt === NOW);

lines.push('== B7 心跳（节流基准是「上次真落盘」，不是「上次心跳」）==');
const HB = ledger.emptyLedger(NOW);
// 语义：每次心跳都把 lastTickAt 推到「现在」；但**该不该落盘只看 lastWriteAt**，
// 而 lastWriteAt 只有 writeLedger 真的写成功才会推进（旧实现拿 lastTickAt 当基准，
// 于是 daemon 的 30 秒拍子永远够不到 60 秒阈值 ⇒ 心跳彻底不落盘，见 G1）。
const hbB7Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-hbB7-'));
check('刚建台账时不必立刻落盘', ledger.heartbeat(HB, NOW + 1000) === false);
check('距上次落盘满一分钟 → 该落盘（离线窗口才追得准）', ledger.heartbeat(HB, NOW + 61000) === true);
ledger.writeLedger(hbB7Dir, HB, { fsImpl: fs, now: NOW + 61000 });   // 调用方（daemon）真的落了盘
check('刚落过盘、59 秒内不重复写', ledger.heartbeat(HB, NOW + 120000) === false);
check('再攒满一分钟又落盘', ledger.heartbeat(HB, NOW + 181000) === true);
eq('心跳把 lastTickAt 推到最新', HB.lastTickAt, NOW + 181000);
check('空台账心跳不抛且返回 false', ledger.heartbeat(null, NOW) === false);
try { fs.rmSync(hbB7Dir, { recursive: true, force: true }); } catch (_) {}

lines.push('== B8 裁旧（不能裁掉没上报的）==');
const LT = ledger.emptyLedger(NOW);
ledger.recordExpected(LT, { taskId: 'old', slot: '2026-08-01T12:05', dispatched: true, now: T(2026, 8, 1, 12, 5) });
ledger.recordOutcome(LT, { taskId: 'old', slot: '2026-08-01T12:05', status: 'ok', now: T(2026, 8, 1, 12, 6), startedAt: T(2026, 8, 1, 12, 5) });
ledger.trimLedger(LT, { now: NOW, maxAgeMs: ledger.DEFAULT_MAX_AGE_MS });
check('超龄的条目被裁掉（给台账瘦身）', !LT.entries.old);
const LT2 = ledger.emptyLedger(NOW);
ledger.recordExpected(LT2, { taskId: 'unreported', slot: '2026-08-01T12:05', dispatched: true, now: T(2026, 8, 1, 12, 5) });
ledger.recordOutcome(LT2, { taskId: 'unreported', slot: '2026-08-01T12:05', status: 'failed', error: '没人看过', now: T(2026, 8, 1, 12, 6), startedAt: T(2026, 8, 1, 12, 5) });
eq('超龄的未上报条目也按时间裁（否则文件无限增大）', ledger.trimLedger(LT2, { now: NOW, maxAgeMs: ledger.DEFAULT_MAX_AGE_MS }), 1);

const LT3 = ledger.emptyLedger(NOW);
for (let i = 0; i < 5; i++) {
  const slot = '2026-09-17T12:0' + i;
  ledger.recordExpected(LT3, { taskId: 'many', slot, dispatched: true, now: NOW });
  ledger.recordOutcome(LT3, { taskId: 'many', slot, status: 'failed', error: 'x', now: NOW + 1000, startedAt: NOW });
  ledger.markReported(LT3, [{ taskId: 'many', slot }], { now: NOW + 2000 });
}
eq('超过 maxSlots 时优先裁最旧的已上报条目', ledger.trimLedger(LT3, { now: NOW, maxSlots: 3 }), 2);
eq('剩下的正好是 maxSlots 条', Object.keys(LT3.entries.many || {}).length, 3);
check('留下的是最新的三条', !!LT3.entries.many['2026-09-17T12:04'] && !LT3.entries.many['2026-09-17T12:00']);

const LT4 = ledger.emptyLedger(NOW);
for (let i = 0; i < 4; i++) {
  const slot = '2026-09-17T12:0' + i;
  ledger.recordExpected(LT4, { taskId: 'mix', slot, dispatched: true, now: NOW });
  ledger.recordOutcome(LT4, { taskId: 'mix', slot, status: 'failed', error: 'x', now: NOW + 1000, startedAt: NOW });
  if (i < 2) ledger.markReported(LT4, [{ taskId: 'mix', slot }], { now: NOW + 2000 });
}
ledger.trimLedger(LT4, { now: NOW, maxSlots: 2 });
check('⚠️ 条数超限时先裁已上报的', !LT4.entries.mix['2026-09-17T12:00'] && !LT4.entries.mix['2026-09-17T12:01']);
check('⚠️ 未上报的条目排最后裁（问题得先被看到）', !!LT4.entries.mix['2026-09-17T12:02'] && !!LT4.entries.mix['2026-09-17T12:03']);
noThrow('trim 参数为空不抛', () => ledger.trimLedger(null, {}));

/* ================= C 组：离线补扫 ================= */
lines.push('== C1 离线补扫（WorkBuddy 当时没开）==');
const created = T(2026, 9, 17, 0, 0);
function offlineLedger(lastTickAt) {
  const l = ledger.emptyLedger(created);
  l.lastTickAt = lastTickAt;
  return l;
}
const tasks = [{ id: 'd1', name: '日报任务', enabled: true, schedule: { type: 'daily', time: '12:05' } }];
eq('离线窗口里有 12:05 → 报 1 个槽位',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 11, 0)), tasks, { now: NOW + 120000, graceMs: 60000 })[0].slots, ['2026-09-17T12:05']);
// 单变量对照：同一时刻（12:06 看 12:05 那个槽位、宽限 5 秒），只差「上次心跳离现在多远」
eq('窗口太短（60 秒 < 90 秒，重启抖动）→ 不扫',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 12, 5)), tasks, { now: T(2026, 9, 17, 12, 6), graceMs: 5000 }).length, 0);
eq('窗口够长（180 秒）→ 扫',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 12, 3)), tasks, { now: T(2026, 9, 17, 12, 6), graceMs: 5000 }).length, 1);
eq('还没过宽限期 → 不报',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 11, 0)), tasks, { now: NOW + 30000, graceMs: 60000 }).length, 0);
eq('槽位早于台账建立时刻 → 不报（升级当天不误报历史）',
  ledger.offlineMisses(Object.assign(offlineLedger(T(2026, 9, 17, 0, 30)), { createdAt: T(2026, 9, 17, 12, 30) }), tasks, { now: NOW + 120000, graceMs: 60000 }).length, 0);
const withEntry = offlineLedger(T(2026, 9, 17, 11, 0));
ledger.recordExpected(withEntry, { taskId: 'd1', slot: '2026-09-17T12:05', dispatched: true, now: NOW });
ledger.recordOutcome(withEntry, { taskId: 'd1', slot: '2026-09-17T12:05', status: 'failed', error: 'x', now: NOW + 1000, startedAt: NOW });
eq('已有台账记录的槽位不算离线错过（走正常核验）',
  ledger.offlineMisses(withEntry, tasks, { now: NOW + 120000, graceMs: 60000 }).length, 0);
eq('停用的任务不报',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 11, 0)), [{ id: 'd1', enabled: false, schedule: { type: 'daily', time: '12:05' } }], { now: NOW + 120000, graceMs: 60000 }).length, 0);
eq('interval 任务不报',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 11, 0)), [{ id: 'i1', enabled: true, schedule: { type: 'interval', minutes: 5 } }], { now: NOW + 120000, graceMs: 60000 }).length, 0);
eq('once 在离线窗口内 → 报', ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 11, 0)), [{ id: 'o1', name: '一次性', enabled: true, schedule: { type: 'once', at: '2026-09-17T12:05' } }], { now: NOW + 120000, graceMs: 60000 })[0].slots, ['2026-09-17T12:05']);
eq('maxScanMs 之外的槽位不报（不翻旧账）',
  ledger.offlineMisses(offlineLedger(T(2026, 9, 10, 0, 0)), tasks, { now: NOW, graceMs: 60000, scanMs: 3600000 }).length, 0);
noThrow('坏任务列表不抛', () => ledger.offlineMisses(offlineLedger(T(2026, 9, 17, 11, 0)), [null, {}, 'x'], { now: NOW + 120000 }));
check('ledger 为 null 返回空', ledger.offlineMisses(null, tasks, { now: NOW }).length === 0);
check('tasks 不是数组返回空', ledger.offlineMisses(offlineLedger(NOW - 60000), null, { now: NOW }).length === 0);
check('fromMs 可显式指定（启动那一拍用）',
  ledger.offlineMisses(withEntry, tasks, { now: NOW + 120000, graceMs: 60000, fromMs: T(2026, 9, 17, 11, 0) }).length === 0);

lines.push('== C2 离线错过只报一次（补占位）==');
const L8 = offlineLedger(T(2026, 9, 17, 11, 0));
const off8 = ledger.offlineMisses(L8, tasks, { now: NOW + 120000, graceMs: 60000 });
eq('补扫出 1 条', off8.length, 1);
eq('标记上报（给没登记过的槽位补占位）', ledger.markReported(L8, off8, { now: NOW + 120000 }), 1);
eq('第二次启动不重报', ledger.offlineMisses(L8, tasks, { now: NOW + 600000, graceMs: 60000 }).length, 0);
check('补占位后该槽位出现在台账里', !!ledger.entryOf(L8, 'd1', '2026-09-17T12:05'));
eq('占位条目的状态是 missing', ledger.entryOf(L8, 'd1', '2026-09-17T12:05').status, 'missing');
eq('占位条目不会再被 dueEntries 抓走', ledger.dueEntries(L8, { now: NOW + 600000, graceMs: 60000 }).length, 0);
const manyTasks = [{ id: 'd2', name: '频繁任务', enabled: true, schedule: { type: 'daily', time: '12:05' } }];
const L9 = offlineLedger(T(2026, 9, 16, 0, 0));
const off9 = ledger.offlineMisses(L9, manyTasks, { now: T(2026, 9, 18, 23, 0), graceMs: 60000 });
eq('离线 71 小时：只报最近 24 小时内那一个槽位（不翻旧账）', off9[0].slots, ['2026-09-18T12:05']);
eq('总数与列出数一致', off9[0].totalSlots, 1);
check('离线项带上了离线窗口起止（报告要写时长）', Number.isFinite(off9[0].offlineFrom) && Number.isFinite(off9[0].offlineTo));
check('离线项也带任务名与摘要字段', 'name' in off9[0] && 'bodyBrief' in off9[0]);

/* ================= D 组：报告文案 ================= */
lines.push('== D1 人话文案 + 安全语义 ==');
const nameOf = () => '定时发送 · 带货文案';
const mk = (over) => Object.assign({
  taskId: 'task_sched_abc', slot: SLOT, expectedAt: NOW, source: 'once', status: 'failed',
  maybeSent: false, error: '未能在会话列表里找到并打开目标会话', bodyBrief: '请把这篇长文改成 800 字摘要',
}, over || {});
const notSent = ledger.buildMissReport([mk()], { now: NOW + 61000, taskNameOf: nameOf });
check('写清了「哪条任务」', notSent.indexOf('哪条任务') > 0 && notSent.indexOf('定时发送 · 带货文案') > 0);
check('写清了「本来该在」', notSent.indexOf('本来该在') > 0 && notSent.indexOf('2026-09-17 12:05') > 0);
check('写清了「卡在哪」（带原始错误）', notSent.indexOf('卡在哪') > 0 && notSent.indexOf('未能在会话列表里找到并打开目标会话') > 0);
check('给了补发指引', notSent.indexOf('要补发') > 0 && notSent.indexOf('定时发送') > 0);
check('⚠️ 明确写「不要在面板点立即运行」（带定时的任务跑不了）', notSent.indexOf('不能在面板里点「立即运行」') > 0);
check('确定没发出去时说的是「没发出去」', notSent.indexOf('没发出去') > 0);
check('确定没发出去时不说「可能已经发出」', notSent.indexOf('可能已经发出') < 0);
check('补发前要求先扫一眼会话', notSent.indexOf('先扫一眼目标会话') > 0);

const unknown = ledger.buildMissReport([mk({ maybeSent: true, error: '未确认会话发送回执，请检查 WorkBuddy；不会自动重发' })], { now: NOW + 61000, taskNameOf: nameOf });
check('⚠️ 不确定态必须写「结果不确定」', unknown.indexOf('结果不确定') > 0);
check('⚠️ 不确定态必须写「可能已经发出去了」', unknown.indexOf('可能已经发出') > 0);
check('⚠️ 不确定态必须要求先看会话再决定', unknown.indexOf('先打开目标会话') > 0 && unknown.indexOf('别直接重发') > 0);
check('⚠️ 不确定态绝不能给「直接补发」的指引', unknown.indexOf('要补发') < 0);
check('不确定态也带上原始错误', unknown.indexOf('未确认会话发送回执') > 0);

const interrupted = ledger.buildMissReport([mk({ status: 'pending', error: '', expectedAt: NOW })], { now: NOW + 61000, taskNameOf: nameOf });
check('没跑完的写「没跑完」+「结果未知」', interrupted.indexOf('没跑完') > 0 && interrupted.indexOf('结果未知') > 0);
check('没跑完的也要求先看会话', interrupted.indexOf('先打开目标会话') > 0);

const busyText = ledger.buildMissReport([mk({ status: 'busy' })], { now: NOW + 61000, taskNameOf: nameOf });
check('被跳过的写「上一次还在跑」', busyText.indexOf('上一次还在跑') > 0);
check('被跳过的写「不会补跑」', busyText.indexOf('不会补跑') > 0);
check('被跳过的给出可操作建议', busyText.indexOf('把触发时间往后挪') > 0);
check('被跳过的标题也写「被跳过」', busyText.indexOf('被跳过') > 0);

const offText = ledger.buildMissReport([{
  taskId: 'd1', name: '日报任务', kind: 'offline', expectedAt: NOW, slots: ['2026-09-17T12:05'],
  totalSlots: 1, offlineFrom: NOW - 120000, offlineTo: NOW + 120000, bodyBrief: '',
}], { now: NOW + 120000, taskNameOf: () => '日报任务' });
check('离线错过的写「WorkBuddy 没在运行」', offText.indexOf('WorkBuddy 没在运行') > 0);
check('离线错过的写「不会自动补跑」', offText.indexOf('不会自动补跑') > 0);
check('离线错过的列出本该到点的时刻', offText.indexOf('2026-09-17 12:05') > 0);
check('离线错过的写明离线窗口时长', offText.indexOf('离线窗口') > 0 && offText.indexOf('4 分钟') > 0);
check('离线错过的说明「按现在的设定推算」', offText.indexOf('现在的设定') > 0);
const offMany = ledger.buildMissReport([{
  taskId: 'd1', name: '日报任务', kind: 'offline', expectedAt: NOW,
  slots: ['2026-09-15T12:05', '2026-09-16T12:05', '2026-09-17T12:05'],
  totalSlots: 6, offlineFrom: NOW - 3600000, offlineTo: NOW, bodyBrief: '',
}], { now: NOW, taskNameOf: () => '日报任务' });
check('列不下时写明「更早的还有 N 次」', offMany.indexOf('更早的还有 3 次') > 0);

lines.push('== D2 隐私与噪音 ==');
const longBody = ledger.buildMissReport([mk({ bodyBrief: accountSwitchLog.snippet('啊'.repeat(500), 60) })], { now: NOW + 61000, taskNameOf: nameOf });
check('正文只留 60 字摘要（桌面是明文）', longBody.indexOf('啊'.repeat(60) + '…') > 0);
check('⚠️ 报告里不出现任务正文全文', longBody.indexOf('啊'.repeat(61)) < 0);
check('⚠️ 报告里不出现完整 uid / 长 id（只留前 16 位）', !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(notSent));
check('标题带分隔线（桌面日志好读）', notSent.indexOf('────') === 0 || notSent.indexOf('────') > 0);
eq('✅ 没有问题时报告是空串（不写文件）', ledger.buildMissReport([], { now: NOW, taskNameOf: nameOf }), '');
eq('✅ 没有问题时提示也是空串', ledger.buildToast([]), '');
const toast1 = ledger.buildToast([{ taskId: 't', name: '带货文案', expectedAt: NOW }]);
check('提示写清任务名与时刻', toast1.indexOf('带货文案') > 0 && toast1.indexOf('12:05') > 0);
check('提示指向桌面日志', toast1.indexOf('WorkDaddy-定时任务核验') > 0);
const toast3 = ledger.buildToast([{ taskId: 't', name: 'A', expectedAt: NOW }, { taskId: 'u', name: 'B' }, { taskId: 'v', name: 'C' }]);
check('多条聚合成一条提示（不刷屏）', toast3.indexOf('另有 2 条') > 0);
noThrow('报告参数为空不抛', () => ledger.buildMissReport(null, {}));
noThrow('报告缺 expectedAt 不抛', () => ledger.buildMissReport([{ taskId: 'x' }], {}));

lines.push('== D3 桌面报告落盘（复用账号切换日志那套）==');
const reportDir = path.join(tmpDir, 'desktop');
const rep1 = ledger.writeReport({ dir: reportDir, at: NOW, text: notSent, fsImpl: fs });
check('写入成功', rep1.ok === true);
check('文件名是「WorkDaddy-定时任务核验-日期.txt」', /WorkDaddy-定时任务核验-2026-09-17\.txt$/.test(rep1.file), rep1.file);
const repText1 = fs.readFileSync(rep1.file, 'utf8');
check('首写带 UTF-8 BOM（记事本不乱码）', repText1.charCodeAt(0) === 0xFEFF);
check('带说明头', repText1.indexOf('定时任务核验日志') > 0);
check('落盘是 CRLF', repText1.indexOf('\r\n') > 0 && !/[^\r]\n/.test(repText1));
const rep2 = ledger.writeReport({ dir: reportDir, at: NOW, text: offText, fsImpl: fs });
eq('当天第二次追加到同一个文件', rep2.file, rep1.file);
const repText2 = fs.readFileSync(rep2.file, 'utf8');
check('追加不覆盖前一段', repText2.indexOf('没发出去') > 0 && repText2.indexOf('WorkBuddy 没在运行') > 0);
eq('只出现一个 BOM', (repText2.match(/\uFEFF/g) || []).length, 1);
const repNext = ledger.writeReport({ dir: reportDir, at: T(2026, 9, 18, 9, 0), text: notSent, fsImpl: fs });
check('跨天另起一个文件', repNext.file !== rep1.file);
check('账号切换日志的文件名没被改动（回归）', accountSwitchLog.logFileName(NOW) === 'WorkDaddy-账号切换日志-2026-09-17.txt');
noThrow('没有目录时不抛，返回 ok:false', () => { const r = ledger.writeReport({ dir: '', at: NOW, text: 'x', fsImpl: fs }); if (r.ok) throw new Error('应当失败'); });
noThrow('resolveReportDir 不抛', () => ledger.resolveReportDir({ env: { USERPROFILE: 'C:\\Users\\Nobody' }, existsSync: () => false, fallbackDir: 'D:\\fallback' }));

/* ================= E 组：接线（源码切片） ================= */
lines.push('== E1 automation.js：槽位回调 ==');
check('createScheduleTicker 接受 hooks', /function createScheduleTicker\(dataDir, hooks\)/.test(AUTO_SRC));
check('hooks.onSlot 被安全取出（非函数则忽略）', /typeof hook\.onSlot === 'function' \? hook\.onSlot : null/.test(AUTO_SRC));
check('一个任务一份 slotTag（不串任务）', /let slotTag = null;/.test(AUTO_SRC) && /slotTag = null;/.test(AUTO_SRC));
check('登记带 dispatched（区分「在跑所以跳过」）', /dispatched: !isRunning\(task\.id\)/.test(AUTO_SRC));
check('派发事件带上 slot', /start\(task, \{ type: 'schedule', source: schedule\.type, slot: slotTag \}\)/.test(AUTO_SRC));
check('onSlot 抛错被吞（核验不能影响调度）', /try \{ onSlot\(\{ task, slot, expectedAt: slotMs, source: schedule\.type, dispatched: !isRunning\(task\.id\) \}\); \} catch \(_\) \{\}/.test(AUTO_SRC));
check('回调给的槽位时刻是整分点（不是 tick 的毫秒）', /const slotMs = date\.getTime\(\) - date\.getSeconds\(\) \* 1000 - date\.getMilliseconds\(\);/.test(AUTO_SRC));
const marksIdx = AUTO_SRC.indexOf('marks[task.id] = slot;');
const hookIdx = AUTO_SRC.indexOf('if (onSlot) { try { onSlot(');
const startIdx = AUTO_SRC.indexOf("start(task, { type: 'schedule', source: schedule.type, slot: slotTag })");
check('⚠️ 顺序：落 marks → 登记 → 派发（登记早于派发）', marksIdx > -1 && hookIdx > marksIdx && startIdx > hookIdx, 'marks=' + marksIdx + ' hook=' + hookIdx + ' start=' + startIdx);
check('atomicWriteText 已导出（台账复用它落盘）', /atomicWriteText,\n\};/.test(AUTO_SRC));

lines.push('== E2 daemon.js：接线与只读铁律 ==');
check('require 了 schedule-ledger', /const scheduleLedger = require\('\.\/schedule-ledger\.js'\)/.test(DAEMON_SRC));
check('ticker 接上了登记回调', /createScheduleTicker\(DATA_DIR, \{ onSlot: noteScheduleSlot \}\)/.test(DAEMON_SRC));
check('核验拍子间隔 30 秒', /SCHEDULE_VERIFY_TICK_MS = Math\.max\(5000, Number\(process\.env\.WBSWITCH_SCHEDULE_VERIFY_TICK_MS\) \|\| 30000\)/.test(DAEMON_SRC));
check('宽限期 60 秒', /SCHEDULE_VERIFY_GRACE_MS = Math\.max\(5000, Number\(process\.env\.WBSWITCH_SCHEDULE_VERIFY_GRACE_MS\) \|\| 60000\)/.test(DAEMON_SRC));
check('可开关（WBSWITCH_SCHEDULE_VERIFY=0）', /const SCHEDULE_VERIFY_ENABLED = String\(process\.env\.WBSWITCH_SCHEDULE_VERIFY \|\| ''\)\.trim\(\) !== '0'/.test(DAEMON_SRC));
check('有启动首拍（负责离线错过）', /setTimeout\(\(\) => \{ runScheduleVerify\('startup'\); \}, SCHEDULE_VERIFY_START_DELAY_MS\)/.test(DAEMON_SRC));
check('首拍的离线窗口在心跳之前抓', /const scheduleOfflineFrom = Number\(scheduleLedgerState\.lastTickAt\)/.test(DAEMON_SRC));
check('周期拍子已挂', /setInterval\(\(\) => runScheduleVerify\('tick'\), SCHEDULE_VERIFY_TICK_MS\)/.test(DAEMON_SRC));
check('心跳拍子已挂', /setInterval\(\(\) => \{\s*\n\s*try \{ if \(scheduleLedger\.heartbeat\(scheduleLedgerState, Date\.now\(\)\)\) persistScheduleLedger\(\); \}/.test(DAEMON_SRC));
check('run 结束（成功）回填', /recordScheduleSlotOutcome\(run, 'ok'\)/.test(DAEMON_SRC));
check('run 结束（失败）回填', /recordScheduleSlotOutcome\(run, 'failed'\)/.test(DAEMON_SRC));
check('run 记下槽位', /run\.scheduleSlot = event && event\.slot \? String\(event\.slot\) : '';/.test(DAEMON_SRC));
check('会话回执被旁路记下（成功判据）', /run\.lastMessageId = String\(result\.userMessageId\)/.test(DAEMON_SRC));
check('未确认发送的错误打上 maybeSent', /const unconfirmedSendError = \(message\) => \{[\s\S]{0,120}?error\.maybeSent = true;/.test(DAEMON_SRC));
check('catch 里读取 maybeSent', /run\.maybeSent = error && error\.maybeSent === true;/.test(DAEMON_SRC));
check('「发送后账号已变化」也算不确定（不再重发）', /throw unconfirmedSendError\('发送后账号已变化，请检查会话；不会自动重发'\)/.test(DAEMON_SRC));
check('「未确认会话发送回执」也算不确定', /throw unconfirmedSendError\('未确认会话发送回执，请检查 WorkBuddy；不会自动重发'\)/.test(DAEMON_SRC));
check('有只读端点 /api/schedule-ledger', /p === '\/api\/schedule-ledger'/.test(DAEMON_SRC));
check('端点暴露出上报目录与计数', /reportPrefix: scheduleLedger\.REPORT_PREFIX/.test(DAEMON_SRC) && /counts,/.test(DAEMON_SRC));

const verifySrc = sliceFn(DAEMON_SRC, 'function runScheduleVerify(reason) {');
check('能切出 runScheduleVerify 源码', verifySrc.length > 400, verifySrc.length + ' 字符');
check('⚠️ 核验不读也不写 marks（automation-schedule-state）', !/automation-schedule-state/.test(verifySrc));
check('⚠️ 核验不改写 marks', !/marks\s*\[/.test(verifySrc));
check('⚠️ 核验不调用任何发送路径（send/create/executeTask）', !/\bsendPhrase\b|\bacSendPhrase\b|executeTask/.test(verifySrc));
check('⚠️ 核验会先查「任务是否还在跑」', /isRunning: \(taskId\) => Array\.from\(automationRuns\.values\(\)\)/.test(verifySrc));
check('任务已删除/已停用时不打扰', /if \(!task \|\| task\.enabled === false\) continue;/.test(verifySrc));
check('核验写桌面报告', /scheduleLedger\.writeReport\(\{ dir, at: now, text, fsImpl: fs \}\)/.test(verifySrc));
check('核验只弹一条汇总提示', /scheduleVerifynotify|scheduleVerifyNotify\(/.test(verifySrc) && /id: 'miss'/.test(DAEMON_SRC));
check('核验有防重入', /if \(!SCHEDULE_VERIFY_ENABLED \|\| scheduleVerifyInFlight\) return null;/.test(verifySrc) && /scheduleVerifyInFlight = false;/.test(verifySrc));
check('核验异常不往外抛', /catch \(error\) \{\s*\n\s*log\('\[schedule-verify\] 核验异常: '/.test(verifySrc));

const ledgerSrcNoWrite = sliceFn(DAEMON_SRC, 'function noteScheduleSlot(info) {');
check('登记用原子写落盘', /scheduleLedger\.writeLedger\(DATA_DIR, scheduleLedgerState, \{ fsImpl: fs, atomicWriteText \}\)/.test(DAEMON_SRC));
check('登记失败只记 log 不抛', /catch \(error\) \{\s*\n\s*log\('\[schedule-verify\] 登记失败: '/.test(ledgerSrcNoWrite));

lines.push('== E3 schedule-ledger.js 自身红线 ==');
check('模块不 require daemon / automation（可独立单测）', !/require\('\.\/daemon/.test(LEDGER_SRC) && !/require\('\.\/automation/.test(LEDGER_SRC));
check('模块不含任何发送路径', !/session\.send|session\.create|acSendPhrase|executeTask/.test(LEDGER_SRC));
check('桌面写盘复用了账号切换日志那套', /accountSwitchLog\.appendNamedReport\(\{/.test(LEDGER_SRC));
check('报告文件名前缀独立（不混进账号切换日志）', /const REPORT_PREFIX = 'WorkDaddy-定时任务核验-';/.test(LEDGER_SRC));
check('正文摘要长度复用同一常量', /BODY_SNIPPET_CHARS = accountSwitchLog\.SNIPPET_CHARS/.test(LEDGER_SRC));
check('interval 被显式排除在可核验之外', /const NON_INTERVAL_TYPES = \['once', 'daily', 'weekly', 'monthly'\];/.test(LEDGER_SRC));
// ⚠️ 别把「当前那一版」写死进断言 —— 下一个功能一改 build id 就必然翻红（§28.6 的教训）。
// 一律写成「格式 + 下限 + 不等于基线」。
const buildId = (DAEMON_SRC.match(/const DAEMON_BUILD_ID = '([^']*)'/) || [])[1] || '';
const buildVer = (DAEMON_SRC.match(/const DAEMON_VERSION = '([^']*)'/) || [])[1] || '';
const verNum = (v) => { const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/); return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : -1; };
check('build id 格式合法（release-x.y.z-YYYYMMDD-功能）', /^release-\d+\.\d+\.\d+-\d{8}-[A-Za-z0-9][A-Za-z0-9-]*$/.test(buildId), buildId);
check('版本 ≥ 1.3.4（守「必须递增」）', verNum(buildVer) >= verNum('1.3.4'), buildVer);
check('build id 已递增（新代码才会被加载）', buildId !== 'release-1.3.3-20260917-schedule-verify', buildId);

/* ============ G 组：心跳落盘与冷启动锚点（D1/D2 回归，2026-09-17 实测缺陷） ============ */
// 这两个缺陷的共性是「只在真实启动路径上出现」：单测只要注入一个现成的台账对象就测不到。
// 所以这里刻意从**空目录**起步，并用合成时钟把「心跳拍子（30s）」与「落盘阈值（60s）」
// 摆成不整除 —— 旧实现正是栽在这个组合上（40 拍落盘 0 次）。
lines.push('== G1 心跳落盘：拍子周期不整除也必须能落（D1）==');
const HB_BASE = T(2026, 9, 17, 12, 5);
const hbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-hb-'));
const hbLed = ledger.readLedger(hbDir, { now: HB_BASE });
let hbWrites = 0;
for (let i = 1; i <= 40; i++) {
  const now = HB_BASE + i * 30000;
  if (ledger.heartbeat(hbLed, now)) { ledger.writeLedger(hbDir, hbLed, { fsImpl: fs, now }); hbWrites++; }
}
eq('⚠️ 30 秒一拍 × 40 拍 = 20 分钟 → 落盘 20 次（旧实现是 0 次）', hbWrites, 20);
check('心跳判据用的是 lastWriteAt（不是每拍都变的 lastTickAt）', /const last = Number\(ledger\.lastWriteAt\)/.test(LEDGER_SRC));
const hbFnSrc = sliceFn(LEDGER_SRC, 'function heartbeat(ledger, now) {');
check('能切出 heartbeat 源码', hbFnSrc.length > 100, hbFnSrc.length + ' 字符');
check('⚠️ heartbeat 自己不推进 lastWriteAt（只由 writeLedger 在真写成功后推进）', !/lastWriteAt\s*=/.test(hbFnSrc));
check('心跳拍子确实是 30 秒（正是与 60 秒阈值不整除的那个组合）', /\}, 30000\);\n/.test(DAEMON_SRC) && /HEARTBEAT_WRITE_MS = 60 \* 1000/.test(LEDGER_SRC));

const hbIdle = ledger.readLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-hb2-')), { now: HB_BASE });
eq('距上次落盘只有 30 秒 → 不落盘', ledger.heartbeat(hbIdle, HB_BASE + 30000), false);
eq('满 60 秒 → 落盘', ledger.heartbeat(hbIdle, HB_BASE + 60000), true);
eq('心跳不擅自改 lastWriteAt（写失败时下个 30 秒就能重试，不用白等一个周期）', hbIdle.lastWriteAt, HB_BASE);

lines.push('== G2 lastWriteAt 必须能落盘读回（白名单别漏字段）==');
check('落盘后 lastWriteAt 已推进', hbLed.lastWriteAt > HB_BASE, String(hbLed.lastWriteAt));
eq('⚠️ 读回来与内存一致（normalizeLedger 白名单漏了就会被丢掉）',
  ledger.readLedger(hbDir, { now: HB_BASE }).lastWriteAt, hbLed.lastWriteAt);

lines.push('== G3 冷启动：文件不存在要先锚住 createdAt（D2）==');
const coldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cold-'));
eq('空目录：ledgerFileExists = false', ledger.ledgerFileExists(coldDir, { fsImpl: fs }), false);
const coldLed = ledger.readLedger(coldDir, { now: HB_BASE });
ledger.writeLedger(coldDir, coldLed, { fsImpl: fs, now: HB_BASE });
eq('锚一次之后文件就在了', ledger.ledgerFileExists(coldDir, { fsImpl: fs }), true);
eq('⚠️ 第二天再启动：createdAt 仍是首次启动时刻（没被重置成「现在」）',
  ledger.readLedger(coldDir, { now: HB_BASE + 86400000 }).createdAt, HB_BASE);
eq('真·首次安装那一拍不报（没有「上一次还活着」可参照，也不该翻旧账）',
  ledger.offlineMisses(ledger.readLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cold2-')), { now: HB_BASE }),
    [{ id: 't_once', enabled: true, schedule: { type: 'once', at: '2026-09-17T12:05' } }],
    { now: HB_BASE, graceMs: 60000 }).length, 0);

const e2eDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-e2e-'));
const e2eBoot1 = T(2026, 9, 17, 8, 0), e2eOff = T(2026, 9, 17, 10, 0), e2eBoot2 = T(2026, 9, 17, 12, 0);
ledger.writeLedger(e2eDir, ledger.readLedger(e2eDir, { now: e2eBoot1 }), { fsImpl: fs, now: e2eBoot1 });
const e2eRun = ledger.readLedger(e2eDir, { now: e2eBoot1 });
for (let t = e2eBoot1 + 30000; t <= e2eOff; t += 30000) {
  if (ledger.heartbeat(e2eRun, t)) ledger.writeLedger(e2eDir, e2eRun, { fsImpl: fs, now: t });
}
const e2eLed = ledger.readLedger(e2eDir, { now: e2eBoot2 });
const e2eOut = ledger.offlineMisses(e2eLed,
  [{ id: 't_once2', name: '11点单次任务', enabled: true, schedule: { type: 'once', at: '2026-09-17T11:00' } }],
  { now: e2eBoot2, graceMs: 60000, fromMs: Number(e2eLed.lastTickAt) || Number(e2eLed.createdAt) });
eq('⚠️ 场景 B 端到端：08:00 首启 → 10:00 关机 → 12:00 再开，11:00 那个槽位被报出来（修前 0）', e2eOut.length, 1);
eq('报出来的槽位对得上', e2eOut[0] && e2eOut[0].slots, ['2026-09-17T11:00']);
check('daemon 启动段确实做了「文件不存在就落一次盘」', /if \(!scheduleLedger\.ledgerFileExists\(DATA_DIR, \{ fsImpl: fs \}\)\) \{[\s\S]{0,400}?persistScheduleLedger\(\);/.test(DAEMON_SRC));
check('ledgerFileExists 已导出（daemon 要用）', /readLedger,\n\s*ledgerFileExists,\n/.test(LEDGER_SRC));
// 踩过的坑：log() 里的 rotateLogsIfNeeded() 用 `++logWriteCount`，而 logWriteCount 原本声明在
// 文件末尾 ⇒ 模块初始化阶段调用 log() 会抛 TDZ 的 ReferenceError，又被 log() 自己的 try/catch
// 静默吞掉 —— 表现为「台账锚点建出来了，daemon.log 里一行都没有」。声明必须排在核验块之前。
check('⚠️ logWriteCount 声明在核验块之前（否则初始化阶段的 log() 被静默吞掉）',
  DAEMON_SRC.indexOf('let logWriteCount = 0;') > -1 &&
  DAEMON_SRC.indexOf('let logWriteCount = 0;') < DAEMON_SRC.indexOf('const SCHEDULE_VERIFY_ENABLED'),
  'logWriteCount@' + DAEMON_SRC.indexOf('let logWriteCount = 0;') + ' verifyBlock@' + DAEMON_SRC.indexOf('const SCHEDULE_VERIFY_ENABLED'));
try { fs.rmSync(hbDir, { recursive: true, force: true }); } catch (_) {}
try { fs.rmSync(coldDir, { recursive: true, force: true }); } catch (_) {}
try { fs.rmSync(e2eDir, { recursive: true, force: true }); } catch (_) {}

/* ================= F 组：真 ticker 集成（防重复触发的核心） ================= */
lines.push('== F 组：拿真 createScheduleTicker 跑 ==');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-tick-'));
  const minute = ledger.slotOfDate(new Date());
  const task = ss.buildTask({ message: '到点发送的内容', accountUid: 'uid_test_only', conversationId: 'new', schedule: { type: 'once', at: minute } }, { now: Date.now() });
  task.id = 'task_sched_verify_probe';
  const slots = [];
  const starts = [];
  const tick = auto.createScheduleTicker(dir, { onSlot: (info) => slots.push(info) });
  const nowMs = Date.now();
  tick([task], (t, e) => starts.push({ id: t.id, slot: e && e.slot }), () => false, nowMs);
  eq('命中槽位 → 回调一次', slots.length, 1);
  eq('回调带上了槽位串', slots[0] && slots[0].slot, minute);
  eq('回调带上了触发方式', slots[0] && slots[0].source, 'once');
  eq('回调带上的槽位时刻是整分点（与槽位串对得上）', slots[0] && slots[0].expectedAt, ledger.slotToMs(minute));
  eq('回调表示「已派发」', slots[0] && slots[0].dispatched, true);
  eq('任务被真的派发了一次', starts.length, 1);
  eq('派发事件带上了 slot', starts[0] && starts[0].slot, minute);

  tick([task], (t, e) => starts.push({ id: t.id, slot: e && e.slot }), () => false, nowMs + 1000);
  eq('⚠️ 同一分钟内再 tick：不再回调（marks 去重，核验不会重复触发）', slots.length, 1);
  eq('⚠️ 同一分钟内再 tick：不再派发', starts.length, 1);
  tick([task], (t, e) => starts.push({ id: t.id, slot: e && e.slot }), () => false, nowMs + 60000);
  eq('下一分钟：不再匹配（once 只有那一个时刻）', slots.length, 1);
  eq('下一分钟：也不再派发', starts.length, 1);

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-tick-'));
  const minute2 = ledger.slotOfDate(new Date());
  const task2 = ss.buildTask({ message: 'x', accountUid: 'uid_test_only', conversationId: 'new', schedule: { type: 'once', at: minute2 } }, { now: Date.now() });
  task2.id = 'task_sched_busy_probe';
  const slots2 = [];
  const starts2 = [];
  const tick2 = auto.createScheduleTicker(dir2, { onSlot: (info) => slots2.push(info) });
  tick2([task2], (t) => starts2.push(t.id), () => true, Date.now());
  eq('到点时任务正在跑 → 仍然回调（要记下「这一轮被跳过」）', slots2.length, 1);
  eq('⚠️ 回调标明未派发', slots2[0] && slots2[0].dispatched, false);
  eq('⚠️ 正在跑时不重复派发', starts2.length, 0);

  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-tick-'));
  const minute3 = ledger.slotOfDate(new Date());
  const task3 = ss.buildTask({ message: 'x', accountUid: 'uid_test_only', conversationId: 'new', schedule: { type: 'once', at: minute3 } }, { now: Date.now() });
  task3.id = 'task_sched_hookthrow_probe';
  const starts3 = [];
  const tick3 = auto.createScheduleTicker(dir3, { onSlot: () => { throw new Error('登记炸了'); } });
  noThrow('⚠️ 登记回调抛错，tick 不能崩', () => tick3([task3], (t) => starts3.push(t.id), () => false, Date.now()));
  eq('⚠️ 登记失败也必须照常派发（核验绝不能影响调度）', starts3.length, 1);

  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-tick-'));
  const intervalTask = ss.buildTask({ message: 'x', accountUid: 'uid_test_only', conversationId: 'new', schedule: { type: 'once', at: ledger.slotOfDate(new Date()) } }, { now: Date.now() });
  intervalTask.id = 'task_interval_probe';
  intervalTask.schedule = { type: 'interval', minutes: 30 };
  const slots4 = [];
  const starts4 = [];
  const tick4 = auto.createScheduleTicker(dir4, { onSlot: (info) => slots4.push(info) });
  tick4([intervalTask], (t) => starts4.push(t.id), () => false, Date.now());
  eq('interval 任务不被派发（首次只是排期）', starts4.length, 0);
  eq('⚠️ interval 不做核验登记（槽位是进程内相对时间）', slots4.length, 0);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(dir3, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(dir4, { recursive: true, force: true }); } catch (_) {}

  lines.push('');
  lines.push('结果: ' + pass + ' pass / ' + fail + ' fail');
  fs.writeFileSync(path.join(__dirname, 'test-schedule-verify.report.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('schedule-verify: ' + pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  lines.push('FATAL ' + String((error && error.stack) || error));
  fs.writeFileSync(path.join(__dirname, 'test-schedule-verify.report.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('schedule-verify: FATAL');
  process.exit(1);
});
