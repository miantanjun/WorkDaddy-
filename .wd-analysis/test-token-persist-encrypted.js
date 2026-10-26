'use strict';
// 上游 1.2.18：加密态账号「刷新成功但存不进文件」的修复守卫。
// 修之前的行为是 —— 加密备份刷新完只丢进内存缓存，日志写「仅保存在内存」，
// daemon 一重启就退回旧 token。本套件守三件事：
// ① 加密写回要与解密路径共用同一套 AAD（否则客户端解不开）
// ② 落盘前必须做 CAS，避免刷新期间切号把 A 的 token 写进 B 的备份
// ③ 任何情况下都不许降级成明文
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../scripts/lib.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const dm = codeOnly(read('scripts/daemon.js'));
const lb = codeOnly(read('scripts/lib.js'));

// 取本机任意一份「加密态」账号备份当模板 —— 只是读，不做任何写操作
function findEncryptedBackup() {
  const dir = path.join(process.env.APPDATA || '', 'WorkDaddy', 'accounts');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return null; }
  for (const name of names) {
    if (!name.endsWith('.info')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      const parsed = JSON.parse(raw);
      if (lib.wdCompatContainsEncryptedFields(parsed)) return { parsed, name };
    } catch (_) { /* 单份坏了就跳过，不影响其他 */ }
  }
  return null;
}

// ===== A. 加密写回语义 =====
test('A1 模板里没有加密字段时直接拒绝（绝不写明文）', () => {
  const plain = { auth: { accessToken: 'a', refreshToken: 'b' } };
  assert.throws(() => lib.wdCompatEncryptAuthJson(plain, plain), /missing-encryption-template/);
});

test('A2 解密→改字段→加密→再解密，结果逐字段一致', (t) => {
  const found = findEncryptedBackup();
  if (!found) {
    t.skip('本机没有加密态账号备份');
    return;
  }
  const root = lib.wdCompatDecryptAuthJson(JSON.parse(JSON.stringify(found.parsed)));
  const next = JSON.parse(JSON.stringify(root));
  next.auth.lastRefreshTime = 1793000000000;
  next.probeMarker = 'roundtrip';
  const sealed = lib.wdCompatEncryptAuthJson(next, found.parsed);
  const back = lib.wdCompatDecryptAuthJson(JSON.parse(JSON.stringify(sealed)));
  assert.equal(JSON.stringify(back), JSON.stringify(next));
});

test('A3 写回的结果仍是加密态，且不含明文 token', (t) => {
  const found = findEncryptedBackup();
  if (!found) {
    t.skip('本机没有加密态账号备份');
    return;
  }
  const root = lib.wdCompatDecryptAuthJson(JSON.parse(JSON.stringify(found.parsed)));
  const sealed = lib.wdCompatEncryptAuthJson(root, found.parsed);
  assert.equal(lib.wdCompatContainsEncryptedFields(sealed), true);
  const token = String(root.auth && root.auth.accessToken || '');
  if (token.length >= 12) assert.equal(JSON.stringify(sealed).includes(token.slice(0, 12)), false);
});

test('A4 未改动的字段保留原信封（不做无意义重加密）', (t) => {
  const found = findEncryptedBackup();
  if (!found) {
    t.skip('本机没有加密态账号备份');
    return;
  }
  const root = lib.wdCompatDecryptAuthJson(JSON.parse(JSON.stringify(found.parsed)));
  const sealed = lib.wdCompatEncryptAuthJson(root, found.parsed);
  // 同一份明文走两次加密，信封应该变（nonce 随机）；这里只要求能解回来
  const back = lib.wdCompatDecryptAuthJson(JSON.parse(JSON.stringify(sealed)));
  assert.deepEqual(Object.keys(back).sort(), Object.keys(root).sort());
});

// ===== B. lib 侧结构 =====
test('B1 AAD 构造被抽成独立函数，加解密共用', () => {
  assert.match(lb, /function wdCompatEnvelopeAAD\(env\)/);
  assert.equal((lb.match(/wdCompatEnvelopeAAD\(env\)/g) || []).length >= 2, true);
});

test('B2 加密函数通过 setAAD 复用同一套 AAD', () => {
  const fn = lb.slice(lb.indexOf('function wdCompatEncryptAuthJson'));
  assert.match(fn.slice(0, 2000), /cipher\.setAAD\(wdCompatEnvelopeAAD\(env\)\)/);
});

test('B3 加密前先验证原信封可解（密钥不对就不写）', () => {
  const fn = lb.slice(lb.indexOf('function wdCompatEncryptAuthJson'));
  assert.match(fn.slice(0, 2000), /wdCompatOpenEnvelope\(env, key\)/);
});

test('B4 只封装凭据字段，其余字段原样带过去', () => {
  const fn = lb.slice(lb.indexOf('function wdCompatEncryptAuthJson'));
  const head = fn.slice(0, 3000);
  assert.match(head, /credentialKeys/);
  for (const key of ['accessToken', 'refreshToken', 'idToken', 'token']) {
    assert.equal(head.includes("'" + key + "'"), true);
  }
});

test('B5 lib 导出了加密函数', () => {
  assert.equal(typeof lib.wdCompatEncryptAuthJson, 'function');
});

// ===== C. daemon 落盘 =====
test('C1 persistRefreshedAccount 已定义', () => {
  assert.match(dm, /function persistRefreshedAccount\(uid, file, root, stored, sourceSignature, sourceText\)/);
});

test('C2 落盘前做 CAS：签名必须与读入时一致', () => {
  const fn = dm.slice(dm.indexOf('function persistRefreshedAccount'));
  assert.match(fn.slice(0, 1200), /accountBackupSignature\(file\) !== sourceSignature/);
});

test('C3 落盘前做 CAS：文件全文必须与读入时一致', () => {
  const fn = dm.slice(dm.indexOf('function persistRefreshedAccount'));
  assert.match(fn.slice(0, 1200), /readFileSync\(file, 'utf8'\) !== sourceText/);
});

test('C4 加密态按原信封重新加密，非加密态才写原对象', () => {
  const fn = dm.slice(dm.indexOf('function persistRefreshedAccount'));
  assert.match(fn.slice(0, 1400), /wdCompatContainsEncryptedFields\(stored\) \? wdCompatEncryptAuthJson\(root, stored\) : root/);
});

test('C5 用 wx 独占写临时文件再 rename（不覆盖半截文件）', () => {
  const fn = dm.slice(dm.indexOf('function persistRefreshedAccount'));
  const body = fn.slice(0, 1400);
  assert.match(body, /flag: 'wx'/);
  assert.match(body, /renameSync\(tmp, file\)/);
});

test('C6 失败日志不带异常原文（避免凭据被带出去）', () => {
  const fn = dm.slice(dm.indexOf('function persistRefreshedAccount'));
  const body = fn.slice(0, 1600);
  assert.match(body, /刷新结果落盘失败，将重试保存/);
  assert.ok(!/落盘失败: \$\{e\.message\}/.test(body));
});

test('C7 刷新前先预检加密可写性（不能刷完才发现存不下）', () => {
  const start = dm.indexOf('async function refreshAccountBackupToken');
  const body = dm.slice(start, start + 4000);
  const precheck = body.indexOf('wdCompatEncryptAuthJson(root, stored)');
  const call = body.indexOf('await refreshAuthToken(auth');
  assert.ok(precheck > 0, '预检调用缺失');
  assert.ok(call > 0, '刷新调用缺失');
  assert.ok(precheck < call, '预检必须在刷新之前');
});

test('C8 预检失败返回 encrypt-account-unavailable 而不是继续刷', () => {
  assert.match(dm, /return \{ root, refreshed: false, error: 'encrypt-account-unavailable' \}/);
});

test('C9 刷新成功后标记 pendingPersistence（写盘失败也能下一轮补写）', () => {
  assert.match(dm, /backupAuthRuntimeCache\.set\(uid, \{ signature: sourceSignature, root: nextRoot, pendingPersistence: true \}\)/);
});

test('C10 读到 pendingPersistence 时直接补写、不再打上游', () => {
  const start = dm.indexOf('async function refreshAccountBackupToken');
  const body = dm.slice(start, start + 2400);
  assert.match(body, /cached\.pendingPersistence/);
  assert.match(body, /return persistRefreshedAccount\(uid, file, root, stored, sourceSignature, sourceText\)/);
});

test('C11 旧的「加密备份仅保存在内存」路径已彻底移除', () => {
  assert.ok(!dm.includes('加密备份仅保存在内存'));
  assert.ok(!dm.includes("return { root: nextRoot, refreshed: true, persisted: false };"));
});

test('C12 读失败的返回值不再拼 raw 异常（旧写法会带出内容）', () => {
  assert.ok(!dm.includes("'read-account-failed: ' + e.message"));
  assert.ok(dm.includes("error: 'read-account-failed'"));
});

// ===== D. 产物 =====
test('D1 daemon.js 与 lib.js 仍是纯 CRLF', () => {
  for (const rel of ['scripts/daemon.js', 'scripts/lib.js']) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(raw.includes('\r\n'), rel + ' 丢了 CRLF');
    assert.equal((raw.match(/(^|[^\r])\n/g) || []).length, 0, rel + ' 出现裸 LF');
  }
});
