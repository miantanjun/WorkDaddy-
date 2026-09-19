'use strict';
/*
 * test-usage-attribution-guard.js —— 「空间归属解析」与「用量入库」两处静默错归/整批丢失的回归（v1.4.1 §9-6）。
 *
 * 两个缺陷都不报错、不崩溃，只是**结果悄悄不对**，所以此前 1600+ 条断言一条都没碰到：
 *
 *  ① resolveAccountName（daemon.js，space-scan 的归属解析器）
 *     旧写法 `base === uid || base.startsWith(uid)` 是**裸前缀匹配**。注释本意是
 *     `user-<uid>` / `user-<uid>-<suffix>` 两种形态都要认，但裸前缀让短 uid 直接吞掉长 uid 的目录：
 *        uids = ['abc', 'abcd']，目录 `user-abcd`
 *        → 命中 'abc'（因为 'abcd'.startsWith('abc')）→ **整个目录的占用记到别人账上**
 *     而且返回哪个**取决于 listAccounts() 的顺序** ⇒ 同样的磁盘、同样的代码，结果可以不一样。
 *     正确判据：前缀必须落在 `-` 分隔符上（`uid` 或 `uid + '-'`）；互为前缀时取最长者。
 *
 *  ② credit-usage-store.saveRecords
 *     旧写法 `Number(record.requestTime)` / `Number(record.credit)` 无兜底。远端记录缺字段时
 *     Number() 得 NaN，而 **NaN 绑进 NOT NULL 的 INTEGER/REAL 列会被 SQLite 当成 NULL**
 *     （实测 node:sqlite 报 `ERR_SQLITE_ERROR / NOT NULL constraint failed`）
 *     ⇒ `db.transaction(statements)` 整批回滚 ⇒ 该账号本次同步的**全部**用量丢失，
 *     且 `credit_usage_sync_state`（同步锚点）也不会推进 ⇒ 下次重放同一条继续失败，永久卡死。
 *     正确判据：逐条校验有限数，坏的只丢这一条；并把丢弃条数上报（不许静默）。
 *
 * 三段：
 *   【A】resolveAccountName 真跑（从 daemon.js 切片 → new Function 实例化）        13 项
 *   【B】saveRecords 真跑（假驱动 + strict 模式模拟 SQLite 的 NOT NULL 反应）      13 项
 *   【C】daemon / updater 接线与源码状态（防回退）                                  6 项
 *
 * 【对照组】A-L 与 B-L 把**旧实现原文**内联进来跑同一条探针 —— 证明这套探针真能发现缺陷，
 * 而不是「无论怎么改都绿」。项目红线：断言「动作真发生」就真执行，不做文本匹配。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
const { createCreditUsageStore } = require(path.join(ROOT, 'scripts', 'credit-usage-store.js'));

let pass = 0;
const failures = [];
function check(ok, name) {
  if (ok) { pass++; console.log('  ok   ' + name); return; }
  failures.push(name); console.log('  FAIL ' + name);
}
async function threwAsync(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

/** 按大括号配平从源码里切出一个函数（`header` 必须包含到参数列表末尾） */
function sliceFunction(text, header) {
  const at = text.indexOf(header);
  if (at < 0) throw new Error('锚点未找到: ' + header);
  const open = text.indexOf('{', at + header.length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(at, i + 1); }
  }
  throw new Error('大括号未配平: ' + header);
}

/* ============================ 【A】resolveAccountName ============================ */

const RESOLVER_HEADER = 'async function buildSpaceScanResolvers()';
/** 用给定的 uid 列表装配一个真的 resolveAccountName（sqliteQuery 返回空 ⇒ 归属解析不依赖会话表） */
function resolverWith(uids) {
  const factory = new Function(
    'sqliteQuery', 'listAccounts', 'DATA_DIR', 'spaceSlug',
    sliceFunction(daemonSrc, RESOLVER_HEADER) + '\nreturn buildSpaceScanResolvers;'
  );
  return factory(
    async () => [],
    () => uids.map((uid) => ({ uid })),
    'D:/fake-data-root',
    (cwd) => String(cwd || '').replace(/[:\\/]+/g, '-').toLowerCase()
  );
}
async function resolveMap(uids, names) {
  const resolvers = await resolverWith(uids)();
  return names.map((name) => resolvers.resolveAccountName(name));
}
/** 旧实现原文（改造前）：裸前缀匹配，用于对照组 */
function legacyResolve(uids) {
  return (name) => {
    const base = String(name || '').replace(/^user-/, '');
    if (!base) return null;
    for (const uid of uids) {
      if (base === uid || base.startsWith(uid)) return uid;
    }
    return null;
  };
}

/* ============================ 【B】saveRecords ============================ */

const USAGE_SQL = 'INSERT INTO credit_usage_records (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
function validIdentity(value, label) {
  const text = String(value || '').trim();
  if (!text || text.length > 512 || text.includes('\0')) throw new Error(`${label} 无效`);
  return text;
}

/**
 * 假驱动：只记录语句，不跑 SQL。
 * `strict: true` 时模拟 SQLite 对非有限数 / undefined 绑定的反应（NOT NULL constraint failed），
 * 这样「坏记录会不会拖垮整批」在测试里就能被真实观察到。
 */
function fakeAdapter(options = {}) {
  const state = { runs: [], transactions: [], bound: [] };
  const assertBindable = (params) => {
    for (const param of params) {
      state.bound.push(param);
      if (!options.strict) continue;
      if (typeof param === 'number' && !Number.isFinite(param)) {
        const error = new Error('NOT NULL constraint failed: credit_usage_records.credit');
        error.code = 'ERR_SQLITE_ERROR';
        throw error;
      }
      if (param === undefined) {
        const error = new Error('undefined 不能绑定到 NOT NULL 列');
        error.code = 'ERR_SQLITE_ERROR';
        throw error;
      }
    }
  };
  return {
    state,
    async run(sql, params) { assertBindable(params || []); state.runs.push({ sql, params }); return {}; },
    async all() { return []; },
    async transaction(statements) {
      for (const statement of statements) assertBindable(statement.params || []);
      state.transactions.push(statements);
      return statements.length;
    },
  };
}

/** 旧实现原文（改造前）：Number() 直接入库，用于对照组 */
const legacySaveRecords = new Function('db', 'profileId', `
  return async function legacySaveRecords(accountUid, records) {
    const list = Array.isArray(records) ? records : [];
    for (let offset = 0; offset < list.length; offset += 200) {
      const statements = list.slice(offset, offset + 200).map((record) => ({
        sql: 'INSERT_USAGE_SQL',
        params: [
          profileId,
          accountUid,
          String(record.requestId || ''),
          Number(record.requestTime),
          String(record.usageDate || ''),
          Number(record.credit),
          String(record.model || ''),
          String(record.client || ''),
          String(record.agentPurpose || ''),
        ],
      }));
      if (statements.length) await db.transaction(statements);
    }
  };
`);

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-usage-guard-')), 'credit-usage.db');
}
function storeWith(adapter, onSkip) {
  return createCreditUsageStore({ dbPath: tmpDbPath(), profileId: 'p1', adapter, onSkip });
}
function record(id, over) {
  return Object.assign({
    requestId: id, requestTime: 1758288000000, usageDate: '2026-09-19', credit: 1.5,
    model: 'm', client: 'c', agentPurpose: 'a',
  }, over || {});
}

async function main() {
  console.log('【A】resolveAccountName 归属解析（切片真跑）');

  // A1~A3 两种合法形态
  check((await resolveMap(['abc'], ['user-abc']))[0] === 'abc', 'A1  storage/ 的 `user-<uid>` 归到 uid');
  check((await resolveMap(['abc'], ['abc']))[0] === 'abc', 'A2  memory/ 的裸 `<uid>` 归到 uid');
  check((await resolveMap(['abc'], ['user-abc-591236f90c70']))[0] === 'abc', 'A3  `user-<uid>-<suffix>` 仍要认（改精确等值会丢掉这一类）');

  // A4~A6 核心缺陷：短 uid 不得吞掉长 uid
  check((await resolveMap(['abc', 'abcd'], ['user-abcd']))[0] === 'abcd', 'A4  uids=[abc,abcd] 时 `user-abcd` 不得归给 abc（裸前缀的错归）');
  check((await resolveMap(['abcd', 'abc'], ['user-abcd']))[0] === 'abcd', 'A5  同上但 uid 顺序反转，结果必须一致（旧写法结果随顺序变）');
  check((await resolveMap(['abc'], ['abcde']))[0] === null, 'A6  无分隔符的更长目录名 `abcde` 不是 uid abc 的（返回 null 走未归属）');

  // A7~A9 否定与边界
  check((await resolveMap(['abc'], ['']))[0] === null, 'A7  空名返回 null');
  check((await resolveMap(['abc'], ['user-']))[0] === null, 'A8  只有前缀 `user-` 返回 null');
  check((await resolveMap(['abc'], ['user-zzz']))[0] === null, 'A9  未知 uid 返回 null（不得错挂到任意账号）');

  // A10~A11 uid 自身含 '-' 时取最长者
  check((await resolveMap(['a-b', 'a-b-c'], ['user-a-b-c']))[0] === 'a-b-c', 'A10 uid 互为前缀时取最长者');
  check((await resolveMap(['a-b', 'a-b-c'], ['user-a-b-x']))[0] === 'a-b', 'A11 非最长候选时仍按分隔符落在 a-b 上');

  // A12 空 uid 列表
  check((await resolveMap([], ['user-abc']))[0] === null, 'A12 无账号时全部返回 null');

  // A-L 对照组：旧实现必须在这条探针上翻车
  const legacy = legacyResolve(['abc', 'abcd']);
  check(legacy('user-abcd') === 'abc' && legacy('abcd') === 'abc',
    'A13 对照组：旧实现把 `user-abcd` 归给 abc —— 证明本组探针确实能发现该缺陷');

  console.log('【B】credit-usage-store.saveRecords 入库校验（假驱动真跑）');

  // B1 正常路径
  {
    const adapter = fakeAdapter({ strict: true });
    const result = await storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records: [record('r1')], anchorRequestId: 'r1', syncedAt: Date.now() });
    const tx = adapter.state.transactions[0] || [];
    check(result === undefined && tx.length === 1 && tx[0].params.length === 9,
      'B1  合法记录照常入库（1 条语句 × 9 个参数）');
  }

  // B2~B4 单条坏记录：只丢自己
  for (const [id, over, label] of [
    ['B2', { credit: undefined }, 'credit 缺失'],
    ['B3', { requestTime: undefined }, 'requestTime 缺失'],
    ['B4', { credit: NaN }, 'credit 是 NaN'],
  ]) {
    const adapter = fakeAdapter({ strict: true });
    const error = await threwAsync(() => storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records: [record('r1', over)], anchorRequestId: 'r1', syncedAt: Date.now() }));
    check(error === null && adapter.state.transactions.length === 0,
      `${id} 单条坏记录（${label}）被跳过而不是抛错（无残句提交）`);
  }

  // B5 混合：坏记录不得拖垮同批的好记录（缺陷的可见后果）
  {
    const adapter = fakeAdapter({ strict: true });
    const records = [record('r1'), record('r2', { credit: undefined }), record('r3')];
    const error = await threwAsync(() => storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records, anchorRequestId: 'r3', syncedAt: Date.now() }));
    const tx = adapter.state.transactions[0] || [];
    const anchor = adapter.state.runs.filter((item) => /INSERT INTO credit_usage_sync_state/.test(item.sql));
    check(error === null && tx.length === 2 && anchor.length === 1,
      'B5  3 条里 1 条坏 ⇒ 好的 2 条入库、同步锚点照常推进（旧实现整批回滚）');
  }

  // B6 各种非数形态
  {
    const adapter = fakeAdapter({ strict: true });
    const bad = [NaN, Infinity, -Infinity, 'abc', null, '', undefined, {}, []];
    const records = bad.map((value, i) => record('bad-' + i, { credit: value }));
    const error = await threwAsync(() => storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records, anchorRequestId: '', syncedAt: Date.now() }));
    check(error === null && adapter.state.transactions.length === 0,
      'B6  NaN / ±Infinity / 非数字串 / null / 空串 / undefined / 对象 / 数组 一律不当成数字');
  }

  // B7 数字字符串要转成 number 再入库
  {
    const adapter = fakeAdapter({ strict: true });
    await storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records: [record('r1', { credit: '12.5', requestTime: '1758288000000' })], anchorRequestId: 'r1', syncedAt: Date.now() });
    const params = (adapter.state.transactions[0] || [{ params: [] }])[0].params;
    check(params[3] === 1758288000000 && params[5] === 12.5,
      'B7  数字字符串被转成 number 且值正确（requestTime / credit 位序不变）');
  }

  // B8 交给驱动的参数里不得出现非有限数（不变量）
  {
    const adapter = fakeAdapter({ strict: true });
    await storeWith(adapter).saveSuccessfulSync({
      uid: 'u1',
      records: [record('r1'), record('r2', { credit: undefined }), record('r3', { requestTime: 'x' }), record('r4', { credit: 0 })],
      anchorRequestId: 'r4', syncedAt: Date.now(),
    });
    const bad = adapter.state.bound.filter((p) => typeof p === 'number' && !Number.isFinite(p));
    check(bad.length === 0, 'B8  驱动收到的参数里没有任何 NaN/Infinity');
  }

  // B9~B11 上报
  {
    const seen = [];
    const adapter = fakeAdapter({ strict: true });
    await storeWith(adapter, (info) => seen.push(info)).saveSuccessfulSync({
      uid: 'u1', records: [record('r1'), record('r2', { credit: undefined })], anchorRequestId: 'r1', syncedAt: Date.now(),
    });
    check(seen.length === 1 && seen[0].uid === 'u1' && seen[0].skipped === 1 && seen[0].total === 2,
      'B9  跳过条数被上报（onSkip 恰好一次，带 uid/skipped/total）—— 不许静默丢弃');
  }
  {
    const adapter = fakeAdapter({ strict: true });
    const error = await threwAsync(() => storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records: [record('r1')], anchorRequestId: 'r1', syncedAt: Date.now() }));
    check(error === null, 'B10 不传 onSkip 时一切照旧（选项向后兼容）');
  }
  {
    const adapter = fakeAdapter({ strict: true });
    const error = await threwAsync(() => storeWith(adapter, () => { throw new Error('log 挂了'); })
      .saveSuccessfulSync({ uid: 'u1', records: [record('r1'), record('r2', { credit: undefined })], anchorRequestId: 'r1', syncedAt: Date.now() }));
    check(error === null && adapter.state.transactions.length === 1, 'B11 onSkip 自身抛错不得影响入库');
  }

  // B12 非数组入参
  {
    const adapter = fakeAdapter({ strict: true });
    const error = await threwAsync(() => storeWith(adapter).saveSuccessfulSync({ uid: 'u1', records: null, anchorRequestId: 'r1', syncedAt: Date.now() }));
    check(error === null, 'B12 records 为 null 时不炸（等价空批次）');
  }

  // B-L 对照组：旧实现必须在这条探针上翻车
  {
    const adapter = fakeAdapter({ strict: true });
    const legacy = legacySaveRecords(adapter, 'p1');
    const error = await threwAsync(() => legacy('u1', [record('r1'), record('r2', { credit: undefined })]));
    check(error !== null && /NOT NULL/.test(error.message),
      'B13 对照组：旧实现让 1 条坏记录把整批带崩（NOT NULL constraint failed）—— 探针有效');
  }

  console.log('【C】接线与源码状态（防回退）');

  check(!/base === uid \|\| base\.startsWith\(uid\)/.test(daemonSrc) && /base\.startsWith\(uid \+ '-'\)/.test(daemonSrc),
    'C1  resolveAccountName 仍是「落 - 分隔符」判据（裸 startsWith(uid) 已消失）');
  check(!/if \(!expectSha && updateState\.source !== 'gitee'\)/.test(daemonSrc) && !/download-skip-sha256/.test(daemonSrc),
    'C2  更新下载已无「gitee 免校验」放行分支');
  {
    const guards = daemonSrc.match(/if \(!expectSha\) \{/g) || [];
    const skipLog = /跳过完整性校验/.test(daemonSrc);
    check(guards.length === 1 && !skipLog && /安装包缺少完整性校验，已停止更新/.test(daemonSrc),
      'C3  拿不到 SHA-256 时只有「停止更新」一条出口');
  }
  check(/createCreditUsageStore\(\{[\s\S]{0,400}?onSkip:/.test(daemonSrc),
    'C4  daemon 给 CREDIT_USAGE_STORE 接了 onSkip（丢弃必须有痕）');
  {
    const buildId = (daemonSrc.match(/const DAEMON_BUILD_ID = '([^']+)'/) || [])[1] || '';
    check(/^release-\d+\.\d+\.\d+-\d{8}-/.test(buildId) && buildId.indexOf('request-entry-guard') < 0,
      'C5  DAEMON_BUILD_ID 已递增（本次改了 daemon.js ⇒ 必须能分辨跑着的是哪份代码）');
  }
  check(/function finiteNumber\(value\)/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'credit-usage-store.js'), 'utf8')),
    'C6  credit-usage-store 的 finiteNumber 兜底在位');

  console.log('');
  console.log(`通过 ${pass} / 失败 ${failures.length}  —— passed=${pass} failed=${failures.length}`);
  if (failures.length) {
    for (const name of failures) console.log('  - ' + name);
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('套件异常终止: ' + (error && error.stack || error));
  process.exit(1);
});
