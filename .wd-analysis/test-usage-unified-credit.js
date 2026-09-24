'use strict';
/*
 * test-usage-unified-credit.js —— 统一用量看板「积分口径」的回归（2026-09-23）。
 *
 * 背景：看板第一版把积分算成 269 956，而权威源（credit-usage.db）只有 2 919 —— 差 49 倍。
 * 根因不在图表，而在数据层：session_usage.credit_json 的键是**请求 id**，要靠 jsonl 反查
 * 日期与模型，而同一个 id 会出现在**多条** jsonl 记录里（父子引用等）；旧实现逐行累加，
 * 于是同一个请求被反复计入，虚增几乎全部堆在「今天」，趋势图彻底失真。
 * 这类缺陷不报错、不崩溃，只是结果悄悄错 50 倍，所以此前 2 999 条断言一条都没碰到。
 *
 * 现在积分走**权威源** credit-usage.db 的 credit_usage_records（逐请求，自带 uid /
 * usage_date / model），jsonl 反查降级为兜底，并且兜底路径也修掉了重复计数。
 *
 * 五段：
 *   【A】splitSessionCredit 同 id 只计一次（真跑，含【对照】旧实现证伪）        9 项
 *   【B】readCreditRecords 三维聚合（SUM 返回字符串也要算对）                  7 项
 *   【C】buildUsageUnified 真跑：权威优先 / 兜底去重 / 窗口过滤 / 孤儿告警      9 项
 *   【D】renderUsageBoardHtml：占位符唯一、payload 转义、内联脚本可解析         7 项
 *   【E】daemon 接线与看板口径一致性静态守卫                                   9 项
 *
 * 红线：断言「动作真发生」就真执行（建临时库/临时 jsonl 跑真函数），不做文本匹配；
 *      只有【E】这类「接线是否存在」才读源码，且都带反向条件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const { splitSessionCredit, readCreditRecords, buildUsageUnified, locateSessionJsonl, fillSessionTitles } =
  require(path.join(SCRIPTS, 'usage-unified.js'));
const { renderUsageBoardHtml } = require(path.join(SCRIPTS, 'usage-board-html.js'));

let pass = 0;
const failures = [];
function check(ok, name) {
  if (ok) { pass++; console.log('  ok   ' + name); return; }
  failures.push(name); console.log('  FAIL ' + name);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-uu-credit-'));

/** 建一个 <root>/projects/<slug>/<sid>.jsonl，内容按行写 */
function makeJsonl(root, slug, sid, lines) {
  const dir = path.join(root, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sid + '.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

const T1 = Date.parse('2026-09-20T10:00:00');
const T2 = Date.parse('2026-09-21T10:00:00');

/* ===================== 【A】splitSessionCredit 去重 ===================== */

console.log('[A] splitSessionCredit —— 同一个请求 id 只能计一次');
{
  const root = path.join(TMP, 'a');
  // R1 在 3 行里都出现（模拟父子引用），R2 只在第 4 行出现
  const lines = [
    JSON.stringify({ timestamp: T1, message: { model: 'm-one' }, providerData: { requestId: 'R1' } }),
    JSON.stringify({ timestamp: T1, message: { model: 'm-one' }, providerData: { parentRequestId: 'R1' } }),
    JSON.stringify({ timestamp: T2, message: { model: 'm-one' }, providerData: { parentRequestId: 'R1' } }),
    JSON.stringify({ timestamp: T2, message: { model: 'm-two' }, providerData: { requestId: 'R2' } }),
  ];
  const file = makeJsonl(root, 'p1', 'S1', lines);
  const map = { R1: 10, R2: 3 };

  const got = splitSessionCredit(file, map);
  const sum = got.items.reduce((n, it) => n + it.credit, 0);
  check(got.items.length === 2, 'A1  2 个请求 id ⇒ 恰好 2 条明细（不是 4 条）');
  check(sum === 13, 'A2  金额求和 = 13（R1 只算一次；旧实现会得 33）');
  check(got.items.filter((it) => it.credit === 10).length === 1, 'A3  被重复引用的 R1 只出现一次');
  check(got.unmatched === 0 && got.unmatchedAmount === 0, 'A4  全部命中 ⇒ 无 orphan');

  const days = got.items.map((it) => it.day);
  check(days.indexOf('2026-09-20') >= 0 && days.indexOf('2026-09-21') >= 0,
    'A5  明细带上真实日期（' + days.join(',') + '）');
  check(got.items.filter((it) => it.day === '2026-09-20')[0].model === 'm-one',
    'A6  明细带上模型名（日期 → 模型对得上）');

  // 同一行里两个不同 id 都必须计到（历史坑：正则漏 /g 会把同行第二个 id 判成「明细已丢失」）
  const both = makeJsonl(root, 'p1', 'S2', [
    JSON.stringify({ timestamp: T1, model: 'mx', a: 'R3', b: 'R4' }),
  ]);
  const got2 = splitSessionCredit(both, { R3: 1, R4: 2 });
  check(got2.items.length === 2 && got2.unmatched === 0, 'A7  同一行内两个 id 都命中（不误判丢失）');

  // 未知 id ⇒ 如实计入 orphan，不静默丢弃
  const got3 = splitSessionCredit(file, { R1: 10, R9: 7 });
  check(got3.unmatched === 1 && got3.unmatchedAmount === 7, 'A8  未命中的 id 如实计入 orphan（7 分）');

  // jsonl 不存在 ⇒ 全部 orphan，而不是算成 0
  const got4 = splitSessionCredit(path.join(root, 'nope.jsonl'), { R1: 10, R2: 3 });
  check(got4.items.length === 0 && got4.unmatched === 2 && got4.unmatchedAmount === 13,
    'A9  jsonl 缺失 ⇒ 全部计入 orphan（不静默算 0）');

  // 【对照】旧实现原文（无 counted 去重）在同一 fixture 上必然是 3 倍 ⇒ 证明这套探针真能发现缺陷
  (function controlGroup() {
    const text = fs.readFileSync(file, 'utf8');
    const keys = Object.keys(map);
    const matcher = new RegExp('"(' + keys.join('|') + ')"', 'g');
    let oldSum = 0, oldCount = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      matcher.lastIndex = 0;
      let m;
      while ((m = matcher.exec(line)) !== null) { oldSum += Number(map[m[1]]) || 0; oldCount++; }
    }
    check(oldSum === 33 && oldCount === 4 && oldSum !== sum,
      'A10【对照】旧实现同 fixture 得 33 分 / 4 条（现实现 13 分 / 2 条）⇒ 探针有效');
  })();
}

/* ===================== 【B】readCreditRecords ===================== */

console.log('');
console.log('[B] readCreditRecords —— 三维聚合与字符串 SUM 兜底');
(async () => {
  // sqlite 的 SUM(credit) 经 daemon 的查询封装会变成字符串（String(value).trim()），必须能算对
  const rows = [
    { uid: 'u1', usage_date: '2026-09-20', model: 'mA', credit: '443.19', requests: '3' },
    { uid: 'u1', usage_date: '2026-09-20', model: 'mB', credit: '11.11', requests: 2 },
    { uid: 'u2', usage_date: '2026-09-22', model: 'mA', credit: 100, requests: '5' },
    { uid: 'u2', usage_date: '', model: 'mA', credit: 999, requests: 1 },      // 缺日期 ⇒ 必须跳过
  ];
  const rec = await readCreditRecords(async () => rows, 'workbuddy-cn');

  check(typeof rec.total === 'number' && Math.abs(rec.total - 554.3) < 1e-9,
    'B1  SUM 返回字符串时仍算出数字合计（554.3，不是 "443.19" 拼接）');
  check(rec.items.length === 3, 'B2  缺 usage_date 的行被跳过（4 行 → 3 条）');
  check(rec.total === 554.3 && rec.requests === 10, 'B3  total / requests 累加正确（554.3 / 10）');
  check(rec.from === '2026-09-20' && rec.to === '2026-09-22', 'B4  coveredFrom / coveredTo 取到真实边界');
  check(rec.items.every((it) => it.day && it.account && it.model !== undefined),
    'B5  每条明细都带 (日期 × 账号 × 模型) 三键（三维筛选的前提）');

  const empty = await readCreditRecords(async () => [], 'workbuddy-cn');
  check(empty.items.length === 0 && empty.total === 0 && empty.from === '' && empty.to === '',
    'B6  空结果 ⇒ 全零且边界为空串（不抛）');

  let capturedSql = '', capturedParams = null;
  await readCreditRecords(async (sql, params) => { capturedSql = sql; capturedParams = params; return []; }, 'pf-1');
  check(/profile_id\s*=\s*\?/.test(capturedSql)
    && /GROUP\s+BY\s+uid\s*,\s*usage_date\s*,\s*model/i.test(capturedSql)
    && capturedParams[0] === 'pf-1',
    'B7  查询带 profile_id 过滤 + 按三维 GROUP BY，参数透传');

  /* ===================== 【C】buildUsageUnified 真跑 ===================== */

  console.log('');
  console.log('[C] buildUsageUnified —— 权威优先、兜底去重、窗口过滤');

  const rootC = path.join(TMP, 'c');
  fs.mkdirSync(rootC, { recursive: true });

  const creditRows = [
    { uid: 'u1', usage_date: '2026-09-20', model: 'mA', credit: '300.5', requests: '4' },
    { uid: 'u2', usage_date: '2026-09-21', model: 'mB', credit: '19.5', requests: '2' },
    { uid: 'u1', usage_date: '2020-01-01', model: 'mA', credit: '7777', requests: '1' }, // 窗口外
  ];
  const p1 = await buildUsageUnified({
    root: rootC,
    days: 90,
    accountOptions: [{ uid: 'u1', nickname: '一号' }, { uid: 'u2', nickname: '二号' }],
    queryCredit: async () => creditRows,
    profileId: 'workbuddy-cn',
  });

  check(p1.meta.credit.source === 'usage-records', 'C1  有 queryCredit ⇒ 走权威源 usage-records');
  check(p1.totals.credit === 320, 'C2  合计 = 320（300.5 + 19.5，窗口外的 7777 被排除）');
  check(p1.buckets.every((b) => b.d !== '2020-01-01'), 'C3  窗口外的积分没有进任何 bucket');
  check(p1.meta.credit.unmatchedRequests === 0 && p1.meta.credit.unmatchedAmount === 0,
    'C4  权威路径没有 orphan（三维自带，不需要猜归属）');
  check(p1.meta.credit.coveredFrom === '2026-09-20' && p1.meta.credit.coveredTo === '2026-09-21',
    'C5  meta.credit 的覆盖区间取自真实记录');
  check(p1.buckets.length === 2 && p1.accounts.length === 2,
    'C6  账号维度被正确分桶（u1 / u2 各一条，不是全压成一个）');
  check(!p1.warnings.some((w) => w.type === 'orphan-credit'), 'C7  权威路径不产生 orphan-credit 告警');

  // 兜底：没有 credit-usage.db 时必须退回 credit_json + jsonl，且**不得重复计数**
  const rootC2 = path.join(TMP, 'c2');
  makeJsonl(rootC2, 'p1', 'S9', [
    JSON.stringify({ timestamp: T1, message: { model: 'mZ' }, providerData: { requestId: 'RC' } }),
    JSON.stringify({ timestamp: T1, message: { model: 'mZ' }, providerData: { parentRequestId: 'RC' } }),
    JSON.stringify({ timestamp: T1, message: { model: 'mZ' }, providerData: { parentRequestId: 'RC' } }),
  ]);
  const sessionUsageRows = [{ session_id: 'S9', credit_json: JSON.stringify({ RC: 50 }) }];
  const sessionRows = [{ id: 'S9', user_id: 'u1', title: 't', model: 'mZ' }];
  const stubQuery = async (sql) => {
    if (/session_usage/i.test(sql)) return sessionUsageRows;
    if (/FROM\s+sessions/i.test(sql)) return sessionRows;
    return [];
  };
  const p2 = await buildUsageUnified({ root: rootC2, days: 90, query: stubQuery, accountOptions: [] });
  check(p2.meta.credit.source === 'credit-jsonl', 'C8  没有 queryCredit ⇒ 退回兜底口径 credit-jsonl');
  check(p2.totals.credit === 50,
    'C9  兜底路径同 id 出现 3 次仍只算 50（旧实现在这里会得 150 —— 就是那个 49 倍虚增的来源）');

  /* ===================== 【D】renderUsageBoardHtml ===================== */

  console.log('');
  console.log('[D] renderUsageBoardHtml —— 占位符唯一 / payload 安全 / 内联脚本可解析');

  const payload = {
    meta: {
      schema: 1, generatedAt: Date.now(), days: 90,
      since: Date.parse('2026-06-25T00:00:00'), until: Date.parse('2026-09-23T23:59:59'),
      timezone: 'Asia/Shanghai', files: 1, parsedLines: 1, parseErrors: 0, cached: false,
      credit: {
        source: 'usage-records', label: '来自本机同步的官方逐请求用量记录（credit-usage.db）',
        coveredFrom: '2026-09-20', coveredTo: '2026-09-21', rows: 2, requests: 6,
        total: 320, unmatchedRequests: 0, unmatchedAmount: 0,
      },
      coverage: { thinkingAvailable: true }, accountOptions: [], currentUid: 'u1',
    },
    totals: { i: 100, o: 10, cr: 50, cw: 0, th: 5, credit: 320, calls: 6 },
    accounts: [{ uid: 'u1', name: '一号', i: 100, o: 10, cr: 50, cw: 0, th: 5, credit: 320, calls: 6 }],
    models: [{ m: 'mA', i: 100, o: 10, cr: 50, cw: 0, th: 5, credit: 320, calls: 6 }],
    days: ['2026-09-20', '2026-09-21'],
    buckets: [
      { d: '2026-09-20', a: 'u1', m: 'mA', i: 60, o: 6, cr: 30, cw: 0, th: 3, credit: 300.5, calls: 4 },
      { d: '2026-09-21', a: 'u2', m: 'mB', i: 40, o: 4, cr: 20, cw: 0, th: 2, credit: 19.5, calls: 2 },
    ],
    warnings: [],
    enrich: { available: false },
    probe: '</script><script>alert(1)</script>',
  };

  let html = '';
  let renderError = null;
  try { html = renderUsageBoardHtml(payload); } catch (e) { renderError = e; }
  check(!renderError && typeof html === 'string' && html.length > 2000,
    'D1  真跑渲染成功（' + (renderError ? String(renderError.message) : html.length + ' 字节') + '）');
  check(html.indexOf('/*__PAYLOAD__*/null') < 0, 'D2  模板占位符已被 payload 替换掉（没有残留）');
  check(html.indexOf('__GENERATED__') < 0, 'D3  __GENERATED__ 全部被替换（head/tail 两侧都处理了）');
  // 只要 payload 里的 `<` 被转义成 \u003c，就没有 `</script` 能提前闭合脚本块（只需转义 `<`）。
  check(html.indexOf('</script><script>alert(1)') < 0 && html.indexOf('\\u003c/script>') > 0,
    'D4  payload 里的 </script> 被转义成 \\u003c（无法提前闭合脚本块）');

  // 内联脚本必须真能解析：模板里漏转义的 \n 会让生成页直接 SyntaxError（踩过）
  const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const appScript = scripts.length ? scripts[scripts.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
  const jsFile = path.join(TMP, 'inline.js');
  fs.writeFileSync(jsFile, appScript, 'utf8');
  let parseOk = true;
  // ⚠️ `stdio: 'pipe'` 会给子进程建 **stdin 管道**；本沙箱里那种 spawn 会 EBUSY
  //    （同一二进制从 bash 直接跑正常，显式 ignore stdin 也正常）⇒ 显式忽略 stdin。
  try { execFileSync(process.execPath, ['--check', jsFile], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    parseOk = false;
    console.log('     内联脚本解析失败: ' + String((e.stderr || '') + (e.stdout || '')).slice(0, 300));
  }
  check(parseOk && appScript.length > 1000, 'D5  内联脚本可被解析（' + appScript.length + ' 字符）');

  // 幂等：同一 payload 两次渲染只差生成时间戳
  const stripTime = (s) => s.replace(/\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}/g, '<TS>');
  check(stripTime(renderUsageBoardHtml(payload)) === stripTime(renderUsageBoardHtml(payload)),
    'D6  同一 payload 两次渲染结果一致（只差时间戳）');

  // 关键口径字段进了渲染产物（不是只存 JSON）
  check(html.indexOf('2026-09-20') > 0 && html.indexOf('usage-records') > 0,
    'D7  覆盖起点与积分来源出现在页面里（口径可见，不是藏在注释里）');

  /* ===================== 【E】接线与口径静态守卫 ===================== */

  console.log('');
  console.log('[E] daemon 接线与看板口径一致性');

  const daemonSrc = fs.readFileSync(path.join(SCRIPTS, 'daemon.js'), 'utf8');
  const boardSrc = fs.readFileSync(path.join(SCRIPTS, 'usage-board-html.js'), 'utf8');

  check(/function creditUsageQuery\(\)/.test(daemonSrc)
    && /createSessionDb\(\{\s*dbPath:\s*CREDIT_USAGE_DB_FILE\s*\}\)/.test(daemonSrc),
    'E1  daemon 有 creditUsageQuery()，且读的是 CREDIT_USAGE_DB_FILE（credit-usage.db）');
  check(/queryCredit:\s*creditUsageQuery\(\),\s*\n\s*profileId:\s*PROFILE\.id,/.test(daemonSrc),
    'E2  生成路由把 queryCredit + profileId 传给了 buildUsageUnified');
  check(/credit-usage\.db/.test(daemonSrc) && /const CREDIT_USAGE_DB_FILE = path\.join\(DATA_DIR, 'credit-usage\.db'\)/.test(daemonSrc),
    'E3  CREDIT_USAGE_DB_FILE 指向 DATA_DIR/credit-usage.db');
  {
    const buildId = (daemonSrc.match(/const DAEMON_BUILD_ID = '([^']+)'/) || [])[1] || '';
    // 2026-09-23 改：原来这里写死 `-usage-unified-r(\d+)` 且要求 n>=2 —— 那是**上一轮**的
    // 特性名，任何后续特性一 bump 就假红（T20 加 thinking-stats-r1 时当场红）。这里改成
    // 形状判据：release-<x.y.z>-<yyyymmdd>-<特性>-r<n>。
    // ⚠️ 「到底有没有真的递增」不在本断言职责内 —— 它由 test-archive-isolation.js 的 D0
    // （运行中 daemon 的 buildId 必须等于源码里的）＋「改完必须重启」流程共同保证。
    const shape = /^release-\d+\.\d+\.\d+-\d{8}-[A-Za-z0-9][A-Za-z0-9.-]*-r[1-9]\d*$/.test(buildId);
    check(shape,
      'E4  DAEMON_BUILD_ID 形状合规 release-<版本>-<yyyymmdd>-<特性>-r<n>（改了 daemon.js ⇔ 必须能分辨跑着的是哪份代码）：'
      + JSON.stringify(buildId));
  }
  check(/creditSource:/.test(daemonSrc) && /creditRequests:/.test(daemonSrc),
    'E5  生成接口把 creditSource / creditRequests 透出（便于事后核对，不用翻产物）');
  check(/var covFrom = \(\(P\.meta \|\| \{\}\)\.credit \|\| \{\}\)\.coveredFrom \|\| '';/.test(boardSrc)
    && /covMap = covFrom \? groupOf\(rows\.filter\(function \(b\) \{ return b\.d >= covFrom; \}\), keyFn\)\.map : \{\};/.test(boardSrc),
    'E6  明细表按覆盖区间另算一套分母（积分/百万token 分子分母同区间）');
  check(/v: perMTok\(totCov\)/.test(boardSrc) && /var totCov = covFrom \?/.test(boardSrc),
    'E7  合计行的「积分/百万token」用 totCov（不再拿整窗口 token 去除几天积分）');
  check(/function cr2orDash\(n\) \{ return num\(n\) < 0 \? '—' : cr2\(n\); \}/.test(boardSrc)
    && /key: 'credit', label: '积分', fmt: cr2orDash/.test(boardSrc)
    && /key: 'v', label: '积分\/百万token', fmt: cr2orDash/.test(boardSrc),
    'E8  覆盖区间外的积分与效率显示「—」（不是 0，0 会被读成免费/极高效率）');
  check(/var crDays = dayCount;/.test(boardSrc) && /日均 ' \+ cr2\(t\.credit \/ crDays\)/.test(boardSrc),
    'E9  总积分的「日均」分母只用有积分明细的天数（不被整窗口稀释）');

  console.log('');
  console.log('[F] 会话排行标题装配（fillSessionTitles：来源标注 / 全源脱敏 / 不编造）');
  {
    // 现场：排行的 id 是官方 trace 的**原始会话 id**，库里存的是各账号**副本 id** ⇒ 直接查库全落空。
    // 这套断言锁死三件不能退的事：① 来源标注不留空白；② 脱敏覆盖**所有**来源（第三方标题也是
    // 「首条提问截断」，实测夹带过手机号）；③ 查不到就留空 + 计入 unresolved，绝不编造。
    const FROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-uu-titles-'));
    const FDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-uu-titles-data-'));
    const LIN = '11111111-1111-4111-8111-111111111111';
    const M1 = '22222222-2222-4222-8222-222222222222';
    const SRC = '33333333-3333-4333-8333-333333333333';
    const SELF = '44444444-4444-4444-8444-444444444444';
    const UNK = '55555555-5555-4555-8555-555555555555';
    const PJ = 'projects/demo';
    fs.mkdirSync(path.join(FROOT, PJ), { recursive: true });
    // 血缘：sessions[lineage].members[].id 是成员副本 id；sessionIndex[uid][原始 id] = lineage
    // —— 缺了 sessionIndex 就只认副本 id，原始 id 接不回来（第一版 fixture 就漏在这里）
    fs.writeFileSync(path.join(FDATA, 'meta.json'), JSON.stringify({
      autoCopy: {
        version: 2,
        sessions: { [LIN]: { enabled: true, members: [{ uid: 'u1', id: M1 }] } },
        sessionIndex: { u1: { [SRC]: LIN } },
      },
    }), 'utf8');
    // 正文桥：文件名 == 内嵌 sessionId，带 aiTitle
    fs.writeFileSync(path.join(FROOT, PJ, SELF + '.jsonl'),
      JSON.stringify({ id: 'r1', sessionId: SELF, aiTitle: '正文里的标题' }) + '\n', 'utf8');

    const dbTitles = new Map([[M1, { title: '血缘抄回来的名字', customTitle: '' }]]);
    const enrich = {
      topSessions: [
        { sessionId: 'aaaaaaaa-0000-4000-8000-00000000000a', title: '联系 13912345678 处理售后' },
        { sessionId: 'aaaaaaaa-0000-4000-8000-00000000000b', title: '   ' },
        { sessionId: SRC, title: '' },
        { sessionId: SELF, title: '' },
        { sessionId: UNK, title: '' },
      ],
    };
    const stF = fillSessionTitles(enrich, { root: FROOT, dataDir: FDATA, dbTitles });
    const rw = enrich.topSessions;
    check(stF.total === 5 && stF.inherited === 1 && stF.resolved === 2 && stF.unresolved === 2,
      'F1  统计分账正确（total5 / inherited1 / resolved2 / unresolved2）：' + JSON.stringify(stF));
    check(rw[0].titleSource === 'db',
      'F2  第三方已给标题的行标成 db（来源提示不留空白）：' + JSON.stringify(rw[0].titleSource));
    check(rw[0].title.indexOf('13912345678') === -1 && /1\*{10}/.test(rw[0].title),
      'F3  第三方已给的标题也过脱敏（官方自动标题＝首条提问截断，会夹带手机号）：' + JSON.stringify(rw[0].title));
    check(rw[1].title === '' && rw[1].titleSource === undefined,
      'F4  纯空白标题算「没有」，且被归一成空串（不冒充 db 来源）：' + JSON.stringify(rw[1].title));
    check(rw[2].title === '血缘抄回来的名字' && rw[2].titleSource === 'lineage',
      'F5  原始 id 靠副本血缘接回标题：' + JSON.stringify(rw[2]));
    check(rw[3].title === '正文里的标题' && rw[3].titleSource === 'jsonl',
      'F6  库里没有时退回正文 aiTitle：' + JSON.stringify(rw[3]));
    check(rw[4].title === '' && rw[4].titleSource === undefined,
      'F7  哪儿都没有就留空（交给界面显示占位，不编造）：' + JSON.stringify(rw[4]));
    let snap = {};
    try {
      snap = JSON.parse(fs.readFileSync(path.join(FDATA, 'usage-board', 'session-title-snapshot.json'), 'utf8')).titles || {};
    } catch (_) { snap = {}; }
    check(snap[SRC] === '血缘抄回来的名字' && snap[SELF] === '正文里的标题',
      'F8  血缘与正文回补的真标题进快照（官方日后清理会话行也不丢）：' + JSON.stringify(snap));
    check(Object.values(snap).every((v) => String(v).trim()) && !Object.keys(snap).some((k) => !k.trim()),
      'F9  快照只收非空真标题（空值/空 id 一律不写）');
    check(!JSON.stringify(snap).match(/\b1[3-9]\d{9}\b/),
      'F10 快照里不得出现明文手机号（脱敏后的值才落盘）');
    try { fs.rmSync(FROOT, { recursive: true, force: true }); } catch (_) { /* 临时目录 */ }
    try { fs.rmSync(FDATA, { recursive: true, force: true }); } catch (_) { /* 临时目录 */ }
  }

  console.log('');
  console.log(`通过 ${pass} / 失败 ${failures.length}  —— passed=${pass} failed=${failures.length}`);
  if (failures.length) {
    for (const name of failures) console.log('  - ' + name);
    process.exit(1);
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 临时目录，删不掉也不影响 */ }
})().catch((error) => {
  console.log('套件异常终止: ' + (error && error.stack || error));
  process.exit(1);
});
