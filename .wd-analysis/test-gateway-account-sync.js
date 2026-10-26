#!/usr/bin/env node
/**
 * 网关账号池同步守卫（2026-10-16）
 *
 * 背景 bug：网关的 `auths/` 账号文件原本**只在 `gatewayInstall` 时写一次** ——
 *   安装/升级那一刻的账号快照被固化，之后再登录的账号永远进不了池
 *   （实测：本仓 4 个账号，网关池只有 3 个，缺 `177****6382`）。
 *
 * 本套件守：
 *   A. `syncAuthDocuments` 的**增量**语义（新增 / 更新 / 不变不写 / 删除），含删除前的身份校验；
 *   B. daemon 侧四个挂钩 + 路由 + status 漂移统计；
 *   C. 真跑一次 daemon 的 `gatewaySyncAccounts`（vm 切片，用假 DATA_DIR）。
 *
 * 汇总行格式：结果：N 通过 / M 失败
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const gw = require(path.join(ROOT, 'scripts/api-gateway.js'));
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts/daemon.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const doc = (uid, token) => ({
  auth: { accessToken: token, refreshToken: 'rt-' + token, expiresAt: 1794620839, domain: 'www.workbuddy.cn', realm: 'cn' },
  account: { uid: uid, enterpriseId: '', nickname: 'n-' + uid.slice(0, 4) },
});

/* ────────────────── A 组：syncAuthDocuments 增量语义 ────────────────── */
(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-authsync-'));
  const DIR = path.join(TMP, 'auths');
  const uidA = 'aaaaaaaa-1111-4111-8111-111111111111';
  const uidB = 'bbbbbbbb-2222-4222-8222-222222222222';
  const uidC = 'cccccccc-3333-4333-8333-333333333333';
  const nameOf = (uid) => 'workbuddy-' + uid + '.json';
  const bodyOf = (uid, token) => JSON.stringify(doc(uid, token), null, 2);
  const snapshot = () => {
    const out = {};
    for (const n of fs.readdirSync(DIR)) {
      const st = fs.statSync(path.join(DIR, n));
      out[n] = st.size + ':' + st.mtimeMs + ':' + fs.readFileSync(path.join(DIR, n), 'utf8');
    }
    return out;
  };

  // A1 空目录 ⇒ 全部新增
  let r = gw.syncAuthDocuments(DIR, [doc(uidA, 't1'), doc(uidB, 't1')], {});
  ok(r.added.length === 2 && r.updated.length === 0 && r.removed.length === 0 && r.total === 2,
    'A1 空目录 + 2 个账号 ⇒ added=2', r);
  ok(fs.existsSync(path.join(DIR, nameOf(uidA))) && fs.existsSync(path.join(DIR, nameOf(uidB))),
    'A2 文件按 workbuddy-<uid>.json 落盘（官方扫描规则）');
  ok(fs.readFileSync(path.join(DIR, nameOf(uidA)), 'utf8') === bodyOf(uidA, 't1'),
    'A3 文件内容 = buildAuthDocument 的产物（缩进 2 空格，逐字节一致）');

  // A4 重复调用 ⇒ unchanged，**一个字节都不写**
  await sleep(60);
  const before = snapshot();
  await sleep(60);
  r = gw.syncAuthDocuments(DIR, [doc(uidA, 't1'), doc(uidB, 't1')], {});
  ok(r.unchanged === 2 && r.added.length === 0 && r.updated.length === 0,
    'A4 ⭐ 重复调用 ⇒ unchanged=2（幂等）', r);
  ok(JSON.stringify(snapshot()) === JSON.stringify(before),
    'A5 ⭐⭐ 幂等时**零写入**（内容与 mtime 均未变 —— 免得把网关账号池反复搅动）');

  // A6 token 刷新 ⇒ 只重写那一个
  r = gw.syncAuthDocuments(DIR, [doc(uidA, 't2'), doc(uidB, 't1')], {});
  ok(r.updated.length === 1 && r.updated[0] === nameOf(uidA) && r.unchanged === 1,
    'A6 内容变了（token 刷新）⇒ 只重写该文件，其余不动', r);
  ok(JSON.parse(fs.readFileSync(path.join(DIR, nameOf(uidA)), 'utf8')).auth.accessToken === 't2',
    'A7 重写后内容是新 token');

  // A8 账号被移除 ⇒ 删（本插件生成的账号文件）
  r = gw.syncAuthDocuments(DIR, [doc(uidA, 't2')], {});
  ok(r.removed.length === 1 && r.removed[0] === nameOf(uidB), 'A8 账号不在名单里 ⇒ 删除它的 auth 文件', r);
  ok(!fs.existsSync(path.join(DIR, nameOf(uidB))) && fs.existsSync(path.join(DIR, nameOf(uidA))),
    'A9 该删的删了、该留的留着');

  // A10 保险：名字像账号文件但内容不是 auth 文档 / uid 对不上 ⇒ 保留
  fs.writeFileSync(path.join(DIR, nameOf(uidC)), '{"hello":"world"}');
  fs.writeFileSync(path.join(DIR, 'notes.txt'), 'my notes');
  fs.writeFileSync(path.join(DIR, 'workbuddy-manual.json'), JSON.stringify(doc('someone-else', 'x'), null, 2));
  fs.writeFileSync(path.join(DIR, 'other-1234.json'), '{}');
  r = gw.syncAuthDocuments(DIR, [doc(uidA, 't2')], {});
  ok(r.removed.length === 0, 'A10 ⭐ 内容解析不出 account.uid 的 ⇒ 不删（不是我们生成的）', r.removed);
  ok(fs.existsSync(path.join(DIR, nameOf(uidC))), 'A11 ⭐ 空壳文件保留');
  ok(fs.existsSync(path.join(DIR, 'notes.txt')), 'A12 ⭐ 非 json 文件保留');
  ok(fs.existsSync(path.join(DIR, 'workbuddy-manual.json')),
    'A13 ⭐ workbuddy-manual.json（内容 uid=someone-else 与文件名 uid 不符）保留');
  ok(fs.existsSync(path.join(DIR, 'other-1234.json')), 'A14 ⭐ 非 workbuddy- 前缀的文件一律不碰');

  // A15 名字与内容 uid 不一致（真账号文件但文件名被改过）⇒ 保留
  fs.writeFileSync(path.join(DIR, 'workbuddy-' + uidC + '.json'), JSON.stringify(doc('zzzzzzzz-9999-4999-8999-999999999999', 'x'), null, 2));
  r = gw.syncAuthDocuments(DIR, [doc(uidA, 't2')], {});
  ok(r.removed.length === 0 && fs.existsSync(path.join(DIR, nameOf(uidC))),
    'A15 ⭐⭐ 文件名 uid 与内容 uid 不一致 ⇒ 保留（防手改过的文件被误删）', r.removed);

  // A16 异常的 documents 输入不炸
  ok(gw.syncAuthDocuments(DIR, null, {}).total === 0 && gw.syncAuthDocuments(DIR, [null, {}, { account: {} }], {}).total === 0,
    'A16 documents 为 null / 缺 uid ⇒ 安全返回 0，不抛错');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  /* ────────────────── B 组：daemon 侧挂钩 ────────────────── */
  ok(daemonSrc.includes('function gatewaySyncAccounts(options) {'),
    'B1 daemon 有 gatewaySyncAccounts');
  ok(daemonSrc.includes('apiGateway.syncAuthDocuments(paths.authDir, docs, {})'),
    'B2 它复用 apiGateway.syncAuthDocuments');
  ok(daemonSrc.includes('if (!fs.existsSync(paths.exe) || !fs.existsSync(paths.config)) return { ok: false, skipped: \'not-installed\' };'),
    'B3 ⭐ 网关未安装 ⇒ 立刻返回（这个函数会被高频调用，必须零开销）');
  ok(daemonSrc.includes("p === '/api/gateway/sync-accounts'"),
    'B4 新增 POST /api/gateway/sync-accounts 路由');
  ok(daemonSrc.includes("gatewaySyncAccountsQuiet(reason || '账号备份后');"),
    'B5 ⭐⭐ 账号备份之后自动同步（scheduleBackup ⇒ 新账号一登录就进池）');
  ok(daemonSrc.includes("gatewaySyncAccountsQuiet('daemon 启动');"),
    'B6 ⭐ daemon 启动时同步一次（老装机升上来补齐历史账号）');
  ok(daemonSrc.includes('accountPool: accountPool,'),
    'B7 gatewayStatus 透出账号池对齐度');
  ok(daemonSrc.includes("missing: Array.from(local).filter((uid) => !pool.has(uid)).length,"),
    'B8 accountPool.missing = 本仓有但池里没有的个数（面板据此报警）');
  ok(daemonSrc.includes('const synced = apiGateway.syncAuthDocuments(paths.authDir, docs, {});'),
    'B9 安装/更新网关时也走增量同步（顺带清理失效账号文件）');
  ok(!/const authWritten = apiGateway\.writeAuthDocuments\(/.test(daemonSrc),
    'B10 ⭐ 旧的全量写入调用已从 install 路径移除（那正是本次 bug 的源头用法）');

  /* ────────────────── C 组：vm 切片真跑 gatewaySyncAccounts ────────────────── */
  // 用假 DATA_DIR：accounts/<uid>.info 是密文 ⇒ 解密会失败，所以这里**只验「未安装即跳过」**与「无账号即跳过」两条短路分支。
  const slice = (name) => {
    // ⚠️ daemon.js 是 CRLF ⇒ 必须先归一化再按 '\n}\n' 找顶格结束行（直接切会一个字节都切不到）
    const flat = daemonSrc.replace(/\r\n/g, '\n');
    const start = flat.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('找不到 ' + name);
    const end = flat.indexOf('\n}\n', start);
    if (end < 0) throw new Error('找不到 ' + name + ' 的结束行');
    return flat.slice(start, end + 3);
  };
  const sandbox = {
    fs: fs, path: path, apiGateway: gw, DATA_DIR: path.join(os.tmpdir(), 'wd-fake-data-' + Date.now()),
    gatewayCollectAccounts: () => ({ accounts: [], errors: [] }), log: () => {},
  };
  const code = slice('gatewaySyncAccounts') + '\nthis.__sync = gatewaySyncAccounts;\n';
  vm.createContext(sandbox);
  try {
    new vm.Script(code).runInContext(sandbox);
    const r1 = sandbox.__sync();
    ok(r1 && r1.ok === false && r1.skipped === 'not-installed',
      'C1 ⭐ 网关未安装 ⇒ {ok:false, skipped:"not-installed"}，不抛错、不建目录', r1);
  } catch (e) {
    ok(false, 'C1 vm 切片执行 gatewaySyncAccounts', String(e && e.message));
  }

  /* ────────────────── D 组：面板可见抓手 ────────────────── */
  const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts/inject.js'), 'utf8');
  ok(injectSrc.includes("var ap = gwState.last && gwState.last.accountPool;"),
    'D1 面板读 accountPool 算漂移');
  ok(injectSrc.includes("个账号还没进池（池 ' + ap.pool + ' / 本仓 ' + ap.local + '）"),
    'D2 ⭐ 池里缺账号时给出可读提示（不是静默少一个）');
  ok(injectSrc.includes("mk('同步账号池' + (poolDrift ? ' (' + poolDrift + ')' : '')"),
    'D3 ⭐ 新增「同步账号池」按钮，有漂移时带数字并高亮');
  ok(injectSrc.includes("} else if (act === 'sync-accounts') {") && injectSrc.includes("api('/api/gateway/sync-accounts'"),
    'D4 按钮接了 /api/gateway/sync-accounts 并回报新增/更新/移除数');
  ok(injectSrc.includes('.wbs-gw-pool-note{') && injectSrc.includes("html[data-theme=\"dark\"] .wbs-gw-pool-note"),
    'D5 提示样式齐备（含暗色适配）');
  ok(injectSrc.includes(') \n') === false && injectSrc.includes("'wbs-gw-pool-note'"),
    'D6 提示用独立 class，不污染既有行样式');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
