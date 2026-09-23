'use strict';
/*
 * test-stats-t20-discipline.js —— T23（统计工程纪律五条）+ T20（思考效率与模型性价比）。
 *
 * 为什么单独成套件：T20 的整条链路是「三个数据源合成一张表」——
 *   traces 的 generation span 时长（时间） × token-stats 的 token × 权威积分表按模型 SUM（价值）
 * 三个源各有各的坑，而合成出来的表**看起来永远是对的**：错一个数没人能肉眼发现。
 * 所以这里把「口径」和「不猜」都变成机器判据。
 *
 * 守七组：
 *   [A] 纪律 1：数字错比报错糟糕 —— 时间戳拿不到就留空（绝不回落成 now）、
 *       派生指标拿不到就是 null（不是 0）、无时间戳记录进 undated 台账而不进任何日期维度
 *   [B] 纪律 2：只读打开 —— 只读 sqlite 选项、统计模块里**不许**出现写模式打开（反向守卫）
 *   [C] 纪律 3：只读头部/尾部 —— 单行 JSON 的头部探测必须能用（lineMode 踩坑回归）、
 *       窗口外 trace 只读 64 KB 头、缓存命中的窗口外条目不被补读全文
 *   [D] 纪律 4：参数组合做不到就报错 —— days/from 同给、只给 until、越界 days 一律 bad-param
 *   [E] 纪律 5：命中率分母守卫 —— 分母 <= 0 返回 null 而不是 0；cached > input 自动换分母并置 guarded
 *   [F] T20 归属：路径 A（trace 自带 modelInfo 单模型）/ 路径 B（时间窗对齐）/
 *       歧义不给模型 / 无候选不给模型 / modelInfo 列多个模型**不摊派**
 *   [G] T20 合成与缓存：tok/s、credit/1k、每次积分三个派生口径精确；credit 只来自权威表
 *       （**绝不用 token 占比摊派**，含源码反向守卫）；缓存 (mtime,size) 增量 + 版本号变更即重建
 *   [H] 接线静态守卫：daemon 路由（含非 workbuddy 返 400、cacheStatus 短路）、inject 面板
 *       （独立异步、不阻塞主表）、新文案整句入 i18n 词典
 *
 * 全部在 os.tmpdir() 沙箱里跑，不碰真机数据（fixture 全是自造的合成 trace / jsonl）。
 * 跑法：node .wd-analysis/test-stats-t20-discipline.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const discipline = require(path.join(ROOT, 'scripts', 'stats-discipline.js'));
const tokenStats = require(path.join(ROOT, 'scripts', 'token-stats.js'));
const thinking = require(path.join(ROOT, 'scripts', 'thinking-stats.js'));

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
function near(actual, expected, label, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  ok(typeof actual === 'number' && Math.abs(actual - expected) <= t, label, { actual, expected });
}
function section(t) { console.log(t); }

/* -------------------------------------------------------------------- */
/* 沙箱与 fixture                                                         */
/* -------------------------------------------------------------------- */

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wbs-t20-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {} });

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const tAgo = (days, hours) => NOW - days * DAY + (hours || 0) * 3600000;
const iso = (ms) => new Date(ms).toISOString();

let rootSeq = 0;
function mkRoot(tag) {
  const dir = path.join(SANDBOX, tag + '-' + (++rootSeq));
  fs.mkdirSync(path.join(dir, 'traces', 'p1'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects', 'pj'), { recursive: true });
  return dir;
}
function writeTrace(root, name, doc) {
  const dir = path.join(root, 'traces', 'p1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(doc));
}
function writeJsonl(root, name, lines) {
  const dir = path.join(root, 'projects', 'pj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}
/** 合成一条 trace：spans 只保留 generation（非 generation 的会被有意忽略）。 */
function traceDoc(options) {
  const base = options.startedAt;
  const spans = (options.genSpans || []).map((span) => ({
    type: 'generation',
    startedAt: iso(base + span.at),
    endedAt: iso(base + span.at + span.duration),
    duration: span.duration,
  }));
  if (options.extraSpans) spans.push(...options.extraSpans);
  const trace = {
    traceId: options.traceId || 'trace_x',
    endedAt: iso(base + (options.runMs || 1000)),
    duration: options.runMs || 1000,
    status: 'ok',
    spanCount: spans.length,
    totalTokens: options.totalTokens === undefined ? 1000 : options.totalTokens,
    sessionId: options.sessionId || '',
  };
  if (options.startedAt !== null) trace.startedAt = iso(base);
  if (options.models) trace.modelInfo = { models: options.models, totalOutputTokens: 0, callCount: spans.length };
  return { trace, spans };
}
/** 一条 usage 记录（字段名与官方 jsonl 一致）。 */
function usageLine(options) {
  const line = { message: { usage: {
    input_tokens: options.input || 0,
    output_tokens: options.output || 0,
    cache_read_input_tokens: options.cacheRead || 0,
    completion_thinking_tokens: options.thinking || 0,
  } } };
  if (options.timestamp !== null) line.timestamp = options.timestamp;
  if (options.model) line.model = options.model;
  return line;
}

/* ==================================================================== */
section('[A] 纪律 1：数字错比报错糟糕（宁缺勿猜）');
/* ==================================================================== */

{
  eq(discipline.parseTimestamp('不是时间'), discipline.UNKNOWN_TIMESTAMP,
    'A1 解析不出的时间戳返回哨兵（null），**不回落到现在** —— 回落会让导入的历史用量在时间轴上跳到今天');
  eq(discipline.parseTimestamp(''), discipline.UNKNOWN_TIMESTAMP, 'A2 空串同样返回哨兵（不是 0）');
  eq(discipline.firstTimestamp([undefined, null, 'x', '2026-09-20T10:00:00+08:00']),
    Date.parse('2026-09-20T10:00:00+08:00'), 'A3 firstTimestamp 逐个试，命中第一个可解析的候选');
  eq(discipline.firstTimestamp([null, 'x']), discipline.UNKNOWN_TIMESTAMP,
    'A4 全部拿不到 ⇒ 哨兵（调用方负责计数留痕，而不是填一个）');
  // 秒级时间戳要 ×1000；毫秒级原样（< 1e12 视为秒）
  eq(discipline.parseTimestamp(1758300000), 1758300000000, 'A5 10 位秒级时间戳按秒处理（×1000）');
  eq(discipline.parseTimestamp(1758300000000), 1758300000000, 'A6 13 位毫秒级原样');

  let threw = null;
  try { discipline.assertShape(false, 'bad-param', '结构不匹配'); } catch (error) { threw = error; }
  ok(threw && discipline.isStatsError(threw) && threw.code === 'bad-param',
    'A7 assertShape 失败抛结构化 StatsError（daemon 路由据此决定 400/500），而不是返回一个「差不多」的值');
  ok(discipline.assertShape(true, 'bad-param', 'ok') === true, 'A8 assertShape 通过时返回 true（可用于 return 表达式）');

  // undated 台账：只计数留痕，不把记录混进任何维度
  const ledger = discipline.makeUndatedLedger();
  ledger.add({ input: 100, output: 20, calls: 1 });
  eq(ledger.count, 1, 'A9 undated 台账记条数');
  eq(ledger.tokens, 120, 'A10 undated 台账记 token 总量（input+output）');
  eq(ledger.isEmpty(), false, 'A11 非空时 isEmpty=false（调用方可据此决定要不要暴露给用户）');
  eq(discipline.makeUndatedLedger().isEmpty(), true, 'A12 空台账 isEmpty=true');
}

/* ---- A13~A17：真实走一遍 token-stats，确认无时间戳的记录不落进任何日期维度 ---- */
{
  const root = mkRoot('undated');
  writeJsonl(root, 's1.jsonl', [
    usageLine({ timestamp: iso(tAgo(1)), model: 'm-dated', input: 500, output: 100, thinking: 40 }),
    usageLine({ timestamp: null, model: 'm-undated', input: 7000, output: 3000, thinking: 900 }),
  ]);
  const stats = tokenStats.scanTokenStats(root, { days: 7, now: NOW });
  eq(stats.undated.count, 1, 'A13 无时间戳的记录被单独计数（undated.count=1）');
  eq(stats.undated.tokens, 10000, 'A14 undated 台账累计 10000 token（7000+3000）');
  eq(stats.totals.input, 500,
    'A15 undated 记录的 input **没有**被算进总量（旧实现会漏算；回落到 now 则总量对得上、位置错，更糟）');
  eq(stats.totals.output, 100, 'A16 undated 记录的 output 同样不进总量');
  const datedDays = (stats.daily || []).map((row) => row.day);
  ok(datedDays.length === 1 && datedDays[0] === new Date(tAgo(1)).toISOString().slice(0, 10),
    'A17 日期维度只出现有真实时间戳的那一天（undated 不落任何日期桶）', datedDays);
}

/* ==================================================================== */
section('[B] 纪律 2：只读打开（统计绝不写数据文件）');
/* ==================================================================== */

{
  const opts = discipline.readonlySqliteOptions();
  eq(opts.readOnly, true, 'B1 sqlite 只读选项带 readOnly=true（不干扰正在跑的客户端）');
  eq(opts.fileMustExist, true,
    'B2 带 fileMustExist=true —— 路径写错时报错，而不是新建一个空库再读出「0 条记录」一本正经地展示');
  let fd = null, readBack = '';
  const probe = path.join(SANDBOX, 'readonly-probe.txt');
  fs.writeFileSync(probe, 'hello');
  try {
    fd = discipline.openReadOnly(probe);
    readBack = fs.readFileSync(fd, 'utf8');
  } finally { if (fd !== null) fs.closeSync(fd); }
  eq(readBack, 'hello', 'B3 openReadOnly 用 "r" 打开且可读');

  // 反向守卫：统计模块里不许出现写模式打开
  ['stats-discipline.js', 'thinking-stats.js', 'token-stats.js', 'session-cost.js'].forEach((name, index) => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', name), 'utf8');
    const hits = discipline.scanWriteModeOpens(source);
    ok(hits.length === 0, 'B' + (4 + index) + ' 【反向守卫】' + name + ' 里没有写模式打开', hits);
  });
  ok(discipline.scanWriteModeOpens("fs.openSync(p, 'w')").length === 1,
    'B8 scanWriteModeOpens 真的抓得到写模式打开（守卫自身有效，不是永远返回空）');
  ok(discipline.scanWriteModeOpens("  // fs.openSync(p, 'w') 是反例注释\nfs.openSync(p, 'r')").length === 0,
    'B9 注释里提到写模式不算命中（避免守卫变成噪音）');
}

/* ==================================================================== */
section('[C] 纪律 3：只读头部/尾部（JSON 无换行，头部探测不能假设有换行）');
/* ==================================================================== */

{
  // C1 是 2026-09-23 踩过的坑：readHead 默认 lineMode 若为 true，
  // 单行 JSON（lastIndexOf('\n') === -1）会被整段丢掉 ⇒ 头部探测永远失败、静默退化成全文读。
  const jsonFile = path.join(SANDBOX, 'single-line.json');
  fs.writeFileSync(jsonFile, JSON.stringify({ trace: { startedAt: iso(tAgo(2)), prompt: 'x'.repeat(500) } }));
  const head = discipline.readHead(jsonFile, 64 * 1024);
  ok(head.ok && head.text.length > 0,
    'C1 头部探测对**单行 JSON** 返回非空窗口（lineMode 默认 false 的回归守卫）', { ok: head.ok, len: head.text.length });
  ok(head.text.indexOf('"startedAt"') >= 0, 'C2 头部窗口里能抠到 startedAt（探针可用）');
  eq(head.truncated, false, 'C3 文件小于窗口 ⇒ truncated=false');

  // 尾部：jsonl 场景必须丢掉被截断的首行，否则 JSON.parse 必炸
  const jsonlFile = path.join(SANDBOX, 'tail.jsonl');
  const lines = [];
  for (let i = 0; i < 400; i++) lines.push(JSON.stringify({ i, pad: 'y'.repeat(60) }));
  fs.writeFileSync(jsonlFile, lines.join('\n') + '\n');
  const tail = discipline.readTail(jsonlFile, 2048);
  ok(tail.truncated === true && tail.text.length > 0, 'C4 尾部窗口 truncated=true 且非空');
  const parsedTail = tail.text.split('\n').filter(Boolean).every((line) => { JSON.parse(line); return true; });
  ok(parsedTail, 'C5 尾部窗口的每一行都是完整 JSON（首行被截断的那半截已丢掉）');
  const headMode = discipline.readHead(jsonlFile, 2048);
  ok(headMode.text.charAt(0) === '{',
    'C6 同样的窗口用头部模式读 ⇒ 原样返回（不丢行，因为头部本来就该从第一个字节开始）');

  // C7~C10：窗口外 trace 只读头，不读全文
  const root = mkRoot('headonly');
  writeTrace(root, 'trace_old.json', traceDoc({
    startedAt: tAgo(40), genSpans: [{ at: 0, duration: 5000 }], models: ['old-model'],
  }));
  const outOfWindow = thinking.buildThinkingStats({ root, days: 7, now: NOW });
  eq(outOfWindow.files.headOnly, 1, 'C7 窗口外的 trace 只读 64 KB 头（纪律 3 的核心收益）');
  eq(outOfWindow.files.full, 0, 'C8 窗口外 trace 不进全文读计数');
  eq(outOfWindow.files.skipped, 1, 'C9 窗口外 trace 被跳过');
  eq(outOfWindow.attribution.byModelInfo.ms, 0, 'C10 窗口外 trace 的时长不进统计');

  // C11：缓存里的「只有头」条目，窗口这次覆盖到时必须补读全文
  const root2 = mkRoot('headonly-reuse');
  writeTrace(root2, 'trace_old.json', traceDoc({
    startedAt: tAgo(40), genSpans: [{ at: 0, duration: 4000 }], models: ['m2'],
  }));
  const first = thinking.buildThinkingStats({ root: root2, days: 7, now: NOW });
  eq(first.files.headOnly, 1, 'C11a 第一次扫描：窗口外只读头并写进缓存（agg=null）');
  const second = thinking.buildThinkingStats({ root: root2, days: 7, now: NOW });
  eq(second.files.headOnly, 1, 'C11b 第二次扫描：缓存条目 agg=null 且仍在窗口外 ⇒ 继续只算头，**不补读全文**');
  eq(second.files.full, 0, 'C11c 第二次仍然零全文读（否则纪律 3 的收益会被缓存逻辑吃掉）');
}

/* ==================================================================== */
section('[D] 纪律 4：参数组合做不到就报错（不静默降级）');
/* ==================================================================== */

{
  const cases = [
    [{ from: '2026-09-14', days: 7 }, 'from 与 days 不能同时给'],
    [{ until: '2026-09-20' }, '只给 until 不给 from'],
    [{ days: 0 }, 'days 下越界'],
    [{ days: 91 }, 'days 上越界'],
    [{ days: 2.5 }, 'days 非整数'],
    [{ days: 'abc' }, 'days 非数字'],
    [{ from: '2026-09-01', until: '2026-08-01' }, '开始晚于结束'],
    [{ from: '2026-01-01', until: '2026-09-01' }, '区间超过 90 天'],
    [{ from: 'not-a-date' }, 'from 无法解析'],
  ];
  cases.forEach(([options, label], index) => {
    let threw = null;
    try { tokenStats.dateBounds(NOW, options); } catch (error) { threw = error; }
    ok(threw && discipline.isStatsError(threw) && threw.code === 'bad-param',
      'D' + (index + 1) + ' 拒绝「' + label + '」（bad-param，而不是夹紧/忽略后继续）',
      threw ? { code: threw.code, message: threw.message } : 'did not throw');
  });
  const good = tokenStats.dateBounds(NOW, { days: 7 });
  ok(Number.isFinite(good.from) && good.from <= good.until && good.days === 7,
    'D10 合法组合仍然正常返回（守卫不是把功能关掉）', good);

  let threw = null;
  try { discipline.requireIntRange(7, 1, 5, 'days'); } catch (error) { threw = error; }
  ok(threw && threw.code === 'bad-param', 'D11 requireIntRange 越界抛 bad-param');
  threw = null;
  try { discipline.requireEnum('c', ['a', 'b'], 'mode'); } catch (error) { threw = error; }
  ok(threw && threw.code === 'bad-param', 'D12 requireEnum 不在集合内抛 bad-param（不回落到默认值）');
  eq(discipline.requireEnum('b', ['a', 'b'], 'mode'), 'b', 'D13 requireEnum 合法值原样返回');
}

/* ==================================================================== */
section('[E] 纪律 5：缓存命中率分母守卫');
/* ==================================================================== */

{
  const zero = discipline.cacheHitRateDetail(0, 0);
  eq(zero.rate, null, 'E1 分母 <= 0 时命中率是 **null 而不是 0** —— 给 0 会被读成「缓存完全没命中」');
  eq(zero.denominator, null, 'E2 无分母时 denominator=null（面板据此留空而不是显示 0%）');
  eq(zero.guarded, false, 'E3 无分母不算「换过分母」');

  const normal = discipline.cacheHitRateDetail(500, 1000);
  near(normal.rate, 0.5, 'E4 正常口径是 cached ÷ input（本仓 input_tokens 已含 cache_read）');
  eq(normal.denominator, 'input', 'E5 正常口径标明分母是 input');
  eq(normal.guarded, false, 'E6 正常口径 guarded=false');

  const guarded = discipline.cacheHitRateDetail(1500, 1000);
  near(guarded.rate, 1500 / 2500, 'E7 cached > input 时自动换分母 cached ÷ (input + cached)');
  eq(guarded.denominator, 'input+cached', 'E8 换分母时 denominator 写明，便于事后追查口径');
  eq(guarded.guarded, true, 'E9 换分母时 guarded=true（面板可以标出来，而不是给一个 > 100% 的命中率）');
  ok(guarded.rate <= 1, 'E10 防护后的命中率不会超过 100%');
  eq(discipline.cacheHitRate(500, 1000), 0.5, 'E11 cacheHitRate 只是 detail.rate 的快捷取法（口径同一处）');

  // E12/E13：接线静态守卫（各脚本必须走同一个口径，不许自己再算一遍）
  const tokenSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'token-stats.js'), 'utf8');
  ok(/discipline\.cacheHitRateDetail\(row\.cacheRead, row\.input\)/.test(tokenSrc),
    'E12 token-stats 的命中率走 discipline.cacheHitRateDetail 一处定义');
  const costSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'session-cost.js'), 'utf8');
  ok(/discipline\.cacheHitRateDetail\(/.test(costSrc) && /const readTail = discipline\.readTail;/.test(costSrc),
    'E13 session-cost 的命中率与 readTail 都委派给 discipline（不再是各写一份的第二口径）');
}

/* ==================================================================== */
section('[F] T20 模型归属：两条路径 + 多候选一律不猜');
/* ==================================================================== */

{
  // F1~F5 路径 A：trace 自带 modelInfo 且只有一个模型
  const rootA = mkRoot('pathA');
  const baseA = tAgo(2);
  writeTrace(rootA, 'trace_a.json', traceDoc({
    traceId: 'trace_a', startedAt: baseA, runMs: 3000, models: ['alpha'], sessionId: 'sa',
    genSpans: [{ at: 0, duration: 1000 }, { at: 1000, duration: 2000 }],
    extraSpans: [{ type: 'tool', startedAt: iso(baseA), endedAt: iso(baseA + 50), duration: 50 }],
  }));
  const statsA = thinking.buildThinkingStats({
    root: rootA, days: 7, now: NOW, callPoints: [],
    models: [{ model: 'alpha', input: 10000, output: 2000, cacheRead: 8000, thinking: 600, calls: 3 }],
    creditByModel: { alpha: { credit: 3.6, count: 3 } },
  });
  eq(statsA.attribution.byModelInfo.spans, 2, 'F1 路径 A：自带 modelInfo 的 trace 直接按它归属');
  eq(statsA.attribution.byModelInfo.ms, 3000, 'F2 归属时长 = 所有 generation span duration 之和（非 generation 的 50 ms 不算）');
  eq(statsA.attribution.byTimeWindow.ms, 0, 'F3 路径 A 不需要时间窗对齐');
  const rowA = (statsA.models || []).find((row) => row.model === 'alpha');
  ok(rowA && rowA.thinkingSec === 3 && rowA.traces === 1,
    'F4 模型行拿到思考秒数与轮数（3 s / 1 轮）', rowA);
  eq(statsA.coverage.attributedRatio, 1, 'F5 全部时长可归属 ⇒ 归属率 100%');
}

{
  // F6~F9 路径 B：无 modelInfo ⇒ 按 span 时间窗对齐到调用点
  const rootB = mkRoot('pathB');
  const baseB = tAgo(2);
  writeTrace(rootB, 'trace_b.json', traceDoc({
    traceId: 'trace_b', startedAt: baseB, runMs: 5000,
    genSpans: [{ at: 0, duration: 5000 }],
  }));
  const statsB = thinking.buildThinkingStats({
    root: rootB, days: 7, now: NOW,
    callPoints: [{ t: baseB + 2500, model: 'beta' }],
    models: [{ model: 'beta', input: 1000, output: 500, calls: 1 }],
  });
  eq(statsB.attribution.byTimeWindow.spans, 1, 'F6 路径 B：时间窗内唯一模型 ⇒ 归属成功');
  eq(statsB.attribution.byTimeWindow.ms, 5000, 'F7 归属时长等于 span duration');
  const rowB = (statsB.models || []).find((row) => row.model === 'beta');
  ok(rowB && rowB.thinkingSec === 5, 'F8 时间窗归属的时长进到了正确模型行', rowB);
  eq(statsB.attribution.ambiguous.ms, 0, 'F9 唯一命中不留歧义残量');
}

{
  // F10~F13 多候选 ⇒ 歧义，**不给模型**（纪律 1：宁可不给，也不摊派）
  const rootC = mkRoot('ambiguous');
  const baseC = tAgo(2);
  writeTrace(rootC, 'trace_c.json', traceDoc({
    traceId: 'trace_c', startedAt: baseC, runMs: 5000, genSpans: [{ at: 0, duration: 5000 }],
  }));
  const statsC = thinking.buildThinkingStats({
    root: rootC, days: 7, now: NOW,
    callPoints: [{ t: baseC + 800, model: 'x' }, { t: baseC + 3000, model: 'y' }],
    models: [{ model: 'x', input: 100, output: 50, calls: 1 }, { model: 'y', input: 100, output: 50, calls: 1 }],
  });
  eq(statsC.attribution.ambiguous.spans, 1, 'F10 窗口内出现两个不同模型 ⇒ 判歧义');
  eq(statsC.attribution.ambiguous.ms, 5000, 'F11 歧义时长单独记桶（不摊给任何模型）');
  const xRow = (statsC.models || []).find((row) => row.model === 'x');
  ok(xRow && xRow.thinkingSec === null,
    'F12 歧义的时长**没有**被摊给候选模型（x 的思考秒数是 null，不是 2500）', xRow && xRow.thinkingSec);
  eq(statsC.unknown && statsC.unknown.thinkingMs, 5000, 'F13 歧义时长落在 unknown 桶里（暴露而不是丢弃）');
}

{
  // F14~F16 无候选 ⇒ unattributed
  const rootD = mkRoot('nocandidate');
  const baseD = tAgo(2);
  writeTrace(rootD, 'trace_d.json', traceDoc({
    traceId: 'trace_d', startedAt: baseD, runMs: 5000, genSpans: [{ at: 0, duration: 5000 }],
  }));
  const statsD = thinking.buildThinkingStats({
    root: rootD, days: 7, now: NOW,
    callPoints: [{ t: baseD + 10 * DAY, model: 'far-away' }],
    models: [{ model: 'far-away', input: 10, output: 5, calls: 1 }],
  });
  eq(statsD.attribution.unattributed.spans, 1, 'F14 时间窗内没有调用点 ⇒ 无候选');
  eq(statsD.attribution.unattributed.ms, 5000, 'F15 无候选时长单独记桶');
  eq(statsD.coverage.attributedRatio, 0, 'F16 归属率如实反映 0%，而不是给一张看起来完整的表');

  // 时间窗宽松量：span [s-1500, e+2000] 内的点都算候选（实测口径）
  const statsSlack = thinking.buildThinkingStats({
    root: rootD, days: 7, now: NOW,
    callPoints: [{ t: baseD + 5000 + 1900, model: 'slack-ok' }],
    models: [{ model: 'slack-ok', input: 10, output: 5, calls: 1 }],
  });
  eq(statsSlack.attribution.byTimeWindow.ms, 5000, 'F17 结束后 1.9 s 内的调用点仍算候选（MATCH_SLACK_AFTER_MS=2000）');
  const statsFar = thinking.buildThinkingStats({
    root: rootD, days: 7, now: NOW,
    callPoints: [{ t: baseD + 5000 + 2100, model: 'slack-no' }],
    models: [{ model: 'slack-no', input: 10, output: 5, calls: 1 }],
  });
  eq(statsFar.attribution.unattributed.ms, 5000, 'F18 超出宽松量（2.1 s）就不再算候选');
}

{
  // F19~F21 modelInfo 列了**多个**模型 ⇒ 无法逐 span 判断，不摊派
  const rootE = mkRoot('multimodel');
  const baseE = tAgo(2);
  writeTrace(rootE, 'trace_e.json', traceDoc({
    traceId: 'trace_e', startedAt: baseE, runMs: 4000, models: ['m1', 'm2'],
    genSpans: [{ at: 0, duration: 4000 }],
  }));
  const statsE = thinking.buildThinkingStats({
    root: rootE, days: 7, now: NOW, callPoints: [{ t: baseE + 1000, model: 'm1' }],
    models: [{ model: 'm1', input: 10, output: 5, calls: 1 }, { model: 'm2', input: 10, output: 5, calls: 1 }],
  });
  eq(statsE.attribution.ambiguous.ms, 4000, 'F19 modelInfo 列多个模型 ⇒ 判歧义（不是「取第一个」）');
  eq(statsE.attribution.byTimeWindow.ms, 0,
    'F20 多模型 trace **不走**路径 B —— 明知 trace 里有别的模型，按时间窗挑一个就是编数');
  const rowM1 = (statsE.models || []).find((row) => row.model === 'm1');
  ok(rowM1 && rowM1.thinkingSec === null, 'F21 m1 没有被摊到时长（避免「看起来对」的假数据）');

  // F22~F24 span 缺 startedAt ⇒ 拒绝归属并留痕
  const rootF = mkRoot('nospan');
  writeTrace(rootF, 'trace_f.json', traceDoc({
    traceId: 'trace_f', startedAt: tAgo(2), runMs: 4000, genSpans: [{ at: 0, duration: 4000 }],
  }));
  const brokenSrc = JSON.parse(fs.readFileSync(path.join(rootF, 'traces', 'p1', 'trace_f.json'), 'utf8'));
  delete brokenSrc.spans[0].startedAt;
  delete brokenSrc.spans[0].endedAt;
  fs.writeFileSync(path.join(rootF, 'traces', 'p1', 'trace_f.json'), JSON.stringify(brokenSrc));
  const statsF = thinking.buildThinkingStats({ root: rootF, days: 7, now: NOW, callPoints: [{ t: tAgo(2), model: 'zz' }] });
  eq(statsF.files.refused, 1, 'F22 span 缺 startedAt ⇒ 计数 refused（不可归属的成因是可查的）');
  ok((statsF.warnings || []).some((line) => line.indexOf('缺 startedAt') >= 0),
    'F23 该情形在 warnings 里明说（用户看到总量对不上时能一眼找到原因）', statsF.warnings);
  eq(statsF.attribution.unattributed.ms, 4000, 'F24 拒绝归属的时长留在 unattributed 桶，不落任何模型');
}

/* ==================================================================== */
section('[G] T20 三源合成：派生口径精确 + credit 只来自权威表');
/* ==================================================================== */

{
  const root = mkRoot('join');
  const base = tAgo(2);
  writeTrace(root, 'trace_j.json', traceDoc({
    traceId: 'trace_j', startedAt: base, runMs: 4000, models: ['gamma'], genSpans: [{ at: 0, duration: 4000 }],
  }));
  const stats = thinking.buildThinkingStats({
    root, days: 7, now: NOW, callPoints: [],
    models: [{ model: 'gamma', input: 20000, output: 4000, cacheRead: 16000, thinking: 1200, calls: 4 }],
    creditByModel: { gamma: { credit: 7.2, count: 4 } },
  });
  const row = (stats.models || []).find((item) => item.model === 'gamma');
  ok(!!row, 'G1 三个源按模型名归并成一行');
  eq(row.output, 4000, 'G2 output 来自 token-stats（traces 里没有保真的输出 token 口径）');
  eq(row.thinkingSec, 4, 'G3 思考秒数来自 traces 的 generation span（不是 jsonl 的推理 token）');
  near(row.tokPerSec, 4000 / 4, 'G4 tok/s = 输出 token ÷ 思考秒数（端到端口径）');
  near(row.creditPer1kTokens, 7.2 / (4000 / 1000), 'G5 credit/1k = 积分 ÷ 千输出 token');
  near(row.creditPerTrace, 7.2 / 1, 'G6 每次 = 积分 ÷ agent 轮数（轮数取自 traces，不是 span 数）');
  eq(row.creditCalls, 4, 'G7 积分表的记录数单独带出（便于和调用次数对账）');
  near(row.thinkingShare, 1200 / 4000, 'G8 thinkingShare = 推理 token ÷ 输出 token（token 维度）');
  eq(stats.totals.credit, 7.2, 'G9 总量里的积分来自权威表');

  // G10~G13：缺源时的行为 —— 留空 + 明说，不用占比摊派
  const noCredit = thinking.buildThinkingStats({
    root, days: 7, now: NOW, callPoints: [],
    models: [{ model: 'gamma', input: 20000, output: 4000, calls: 4 }],
    creditByModel: {},
  });
  const rowNoCredit = (noCredit.models || []).find((item) => item.model === 'gamma');
  eq(rowNoCredit.credit, null, 'G10 权威积分表没有这个模型 ⇒ credit 留 null（不是 0）');
  eq(rowNoCredit.creditPer1kTokens, null, 'G11 没有积分就没有 credit/1k（null，不是 0）');
  eq(rowNoCredit.creditPerTrace, null, 'G12 每次积分同样留空');
  ok((noCredit.warnings || []).some((line) => line.indexOf('权威积分表') >= 0 && line.indexOf('token 占比摊派') >= 0),
    'G13 而且在 warnings 里明说「credit 列留空，不用 token 占比摊派替代」', noCredit.warnings);

  // G14 反向守卫：源码里不许出现「按 output 占比分配 credit」这类摊派写法
  const thinkingSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'thinking-stats.js'), 'utf8');
  ok(!/credit\s*\*\s*[^;\n]*output\s*\//.test(thinkingSrc),
    'G14 【反向守卫】thinking-stats 里没有「credit × output 占比」的摊派写法');

  // G15~G17：拿不到时间维度的模型 ⇒ tok/s 留空（而不是 0）
  const onlyToken = thinking.buildThinkingStats({
    root: mkRoot('onlytoken'), days: 7, now: NOW, callPoints: [],
    models: [{ model: 'delta', input: 1000, output: 800, calls: 2 }],
    creditByModel: { delta: { credit: 1, count: 2 } },
  });
  const rowOnly = (onlyToken.models || []).find((item) => item.model === 'delta');
  eq(rowOnly.thinkingSec, null, 'G15 没有 trace 时长 ⇒ 思考秒数 null');
  eq(rowOnly.tokPerSec, null, 'G16 没有分母 ⇒ tok/s 是 null（不是 0，0 会被读成「慢到停止」）');
  near(rowOnly.creditPer1kTokens, 1 / 0.8, 'G17 credit/1k 只要 output 与 credit 都有就仍可算（不因为缺时长而留空）');
}

{
  // G18~G22 缓存：(mtime,size) 增量 + 版本号变更即重建
  const root = mkRoot('cache');
  writeTrace(root, 'trace_c1.json', traceDoc({
    traceId: 'trace_c1', startedAt: tAgo(2), runMs: 2000, models: ['eps'], genSpans: [{ at: 0, duration: 2000 }],
  }));
  const first = thinking.buildThinkingStats({ root, days: 7, now: NOW });
  eq(first.files.reused, 0, 'G18 首次扫描零复用');
  eq(first.files.full, 1, 'G19 首次扫描读了一次全文');
  const second = thinking.buildThinkingStats({ root, days: 7, now: NOW });
  eq(second.files.reused, 1, 'G20 第二次扫描按 (mtimeMs, size) 命中缓存');
  eq(second.files.full, 0, 'G21 命中缓存 ⇒ 不再读全文');
  eq(JSON.stringify(second.models), JSON.stringify(first.models), 'G22 缓存复用不改变结论');

  // 版本号守卫：形状变了必须重建，否则旧缓存会**静默**降级（2026-09-23 踩过）
  const cacheFile = path.join(root, '.workdaddy-thinking-stats-cache.json');
  const payload = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  ok(Number.isInteger(payload.version) && payload.version > 0,
    'G23 缓存文件带版本号（形状变更时据此整份作废）', { version: payload.version });
  fs.writeFileSync(cacheFile, JSON.stringify({ ...payload, version: payload.version + 1 }));
  const afterBump = thinking.buildThinkingStats({ root, days: 7, now: NOW });
  eq(afterBump.files.reused, 0,
    'G24 版本号不符 ⇒ 整份缓存作废重建（形状变更后旧缓存复用会静默少算，比慢更糟）');
}

/* ==================================================================== */
section('[H] 接线静态守卫（daemon 路由 / inject 面板 / i18n 词典）');
/* ==================================================================== */

{
  const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  const dHas = (needle) => daemonSrc.includes(needle);

  ok(dHas("const { buildThinkingStatsCached, thinkingStatsCacheReady } = require('./thinking-stats.js');"),
    'H1 daemon 启动期只取两个入口（面板轮询要的 result 缓存 + cacheStatus 探测）');
  ok(dHas("if (req.method === 'GET' && p === '/api/thinking-stats') {"), 'H2 路由存在且只收 GET');
  ok(dHas("if (PROFILE.kind !== 'workbuddy') return json(res, 400, { ok: false, error: '当前客户端不支持思考效率统计' });"),
    'H3 非 WorkBuddy 客户端直接 400（traces 目录结构不保证，硬算出来的是假数）');
  ok(dHas("if (url.searchParams.get('cacheStatus') === '1') return json(res, 200, { ok: true, cacheReady: thinkingStatsCacheReady(PROFILE.dataRoot) });"),
    'H4 cacheStatus=1 短路返回缓存就绪度（面板据此决定要不要显示「首次约 3 秒」）');
  ok(dHas('withCallPoints: true,'),
    'H5 服务端传 withCallPoints —— 少了这个，缺 modelInfo 的 trace 无法按时间窗归属，每模型 tok/s 会明显偏低');
  ok(dHas('creditRows = await CREDIT_USAGE_STORE.listModelUsageRange(dayOf(tokenStats.since), dayOf(tokenStats.until));'),
    'H6 积分窗口与 token 窗口取同一区间（分子分母同区间，否则 credit/1k 被拉偏）');
  ok(dHas("log('[thinking-stats] 读权威积分表失败（credit 列将留空）: ' + e.message);"),
    'H7 积分表读失败时降级为「留空」，不整条接口挂掉');
  ok(dHas("const badParam = /^(bad-param|shape-mismatch)$/.test(String(e && e.code));")
    && dHas('return json(res, badParam ? 400 : 500,'),
    'H8 结构化错误码映射到 400（形状/参数问题不该报 500，那是「服务器炸了」的语义）');
}

{
  const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
  const iHas = (needle) => injectSrc.includes(needle);

  ok(iHas('function onThinkingPerf() {') && iHas('function perfTableHtml(stats) {'),
    'H9 面板有独立的 onThinkingPerf + perfTableHtml（模型效率弹窗；渲染只有这一处实现）');
  ok(iHas("root.querySelector('[data-act=\"thinking-perf\"]').addEventListener('click', onThinkingPerf);"),
    'H10 账号工具栏入口已接线 —— 挂在 onTokenStats（原自绘用量统计）里的表用户**永远看不到**：'
    + '它在 2026-09-23 融合进「用量看板」时被刻意摘掉了入口（.wd-tmp/patch-inject-unified.js）');
  ok(iHas('data-act="thinking-perf" title="模型效率（思考秒数 × tok/s × 每次积分）"') && iHas('THINKING_PERF_ICON'),
    'H11 入口按钮带图标与文案（不是裸文字按钮，与相邻的用量看板/导出/导入一致）');
  ok(!iHas('loadThinkingPerf'),
    'H12 【反向守卫】死代码副本已摘掉：全文件不再出现 loadThinkingPerf（两份渲染必然漂移）');
  ok(iHas("api('/api/thinking-stats?days=' + encodeURIComponent(perfDays))")
    && iHas('if (current !== serial || !mask.isConnected) return;'),
    'H13 请求走弹窗自己的天数分段控件，且带代际 + 挂载双重守卫（弹窗重建后旧请求不得回写）');
  ok(iHas("if (warn) html += '<div class=\"wbs-perf-note\" data-wbs-i18n-skip>' + esc(warn) + '</div>';"),
    'H14 服务端告警按**数据**处理（data-wbs-i18n-skip），不让翻译层去猜它');
  ok(iHas('.wbs-perf-table{'), 'H15 面板样式已定义');
  ok(iHas('var rows = all.filter(function (item) { return item.thinkingSec || item.output; });'),
    'H16 只列入「有 token 或有时长」的模型 —— 只有积分的模型会渲染成一行全是「—」，看着像 bug');
  ok(iHas('if (creditOnly > 0) {') && iHas('个模型只有积分记录、没有可观测的 token 或时长，未列入本表'),
    'H17 被略过的模型在脚注里**明说省了多少**（不静默丢：用户要能看出「少了 1 个模型」）');

  // i18n：整句入典（最长优先扫描 —— 只登记半句会被短词撕成中英混杂）
  const entries = [
    "'思考效率与模型性价比': 'Thinking efficiency & model value',",
    "'正在读取 traces…（首次约 3 秒）': 'Reading traces… (about 3 s on first run)',",
    "'暂无数据': 'No data',",
    "'每次': 'Per call',",
    "'模型归属率': 'Model attribution ', // 尾随空格必须留在译文里（后面直接接 '91%'）",
    "'读取失败（traces 统计不可用）': 'Failed to read (traces stats unavailable)',",
    "'另有 {n} 个模型只有积分记录、没有可观测的 token 或时长，未列入本表':",
  ];
  entries.forEach((entry, index) => {
    ok(iHas(entry), 'H' + (18 + index) + ' 词条已入典：' + entry.slice(0, 26) + '…');
  });
  ok(iHas("'tok/s = 输出 token ÷ 模型生成秒数（端到端，含排队/网络）｜credit/1k = 积分 ÷ 千输出 token｜每次 = 每个 agent 轮次均摊的积分':"),
    'H25 长句脚注整句入典（句内含 模型/输出/每次/积分 等短词条，不整句入典必被撕成中英混杂）');
  ok(iHas('正在读取 Token 用量…') && iHas("'读取失败：'"),
    'H26 既有主表文案仍在（新增面板没有覆盖掉原有词条）');
}

/* ==================================================================== */

console.log('');
console.log('==== test-stats-t20-discipline: ' + pass + ' passed, ' + failures.length + ' failed ====');
if (failures.length) {
  failures.forEach((line) => console.log('  FAIL ' + line));
  process.exitCode = 1;
}
