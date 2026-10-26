'use strict';
// client-tmp 清理守卫：TEMP 隔离（1.2.16）把所有客户端临时文件收进 <dataDir>/client-tmp，
// 上游没有回收 ⇒ 我们按「超龄 7 天」收。本套件守三件事：
// ① 只删该删的（新鲜文件、正在用的、树外路径一律不碰）② 盘点与执行分离（dryRun 不动盘）
// ③ daemon 真的挂上了启动 + 24h 两处调度
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_MAX_AGE_MS,
  clientTmpRoot,
  isInside,
  planClientTmpCleanup,
  runClientTmpCleanup,
} = require('../scripts/client-tmp-cleanup.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26, 7, 0, 0);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wd-ctmp-'));
function age(target, days) {
  const t = new Date(NOW - days * DAY);
  fs.utimesSync(target, t, t);
}

// 造一棵固定的树：一个 10 天的文件、一个 1 天的文件、一个 9 天的目录（内含 512B）
function fixture() {
  const root = tmp();
  const oldFile = path.join(root, 'old.bin');
  fs.writeFileSync(oldFile, 'x'.repeat(1024));
  age(oldFile, 10);
  const newFile = path.join(root, 'new.bin');
  fs.writeFileSync(newFile, 'y'.repeat(2048));
  age(newFile, 1);
  const oldDir = path.join(root, 'old-dir');
  fs.mkdirSync(oldDir);
  fs.writeFileSync(path.join(oldDir, 'inner.bin'), 'z'.repeat(512));
  age(oldDir, 9); // 必须在写入子文件之后改：写子文件会刷新目录 mtime
  return { root, oldFile, newFile, oldDir };
}

// ===== A. 盘点 =====
test('A1 clientTmpRoot 拼在 dataDir 下', () => {
  assert.equal(clientTmpRoot('C:\\data'), path.join('C:\\data', 'client-tmp'));
});

test('A2 默认保留 7 天', () => {
  assert.equal(DEFAULT_MAX_AGE_MS, 7 * DAY);
});

test('A3 超龄文件进入待删清单', () => {
  const { root, oldFile } = fixture();
  const plan = planClientTmpCleanup({ root, now: NOW });
  assert.equal(plan.remove.some((x) => x.path === oldFile), true);
});

test('A4 新鲜文件被保留', () => {
  const { root, newFile } = fixture();
  const plan = planClientTmpCleanup({ root, now: NOW });
  assert.equal(plan.remove.some((x) => x.path === newFile), false);
  assert.equal(plan.kept, 1);
});

test('A5 超龄目录被标记为目录', () => {
  const { root, oldDir } = fixture();
  const item = planClientTmpCleanup({ root, now: NOW }).remove.find((x) => x.path === oldDir);
  assert.ok(item);
  assert.equal(item.isDirectory, true);
});

test('A6 目录体积含内部文件', () => {
  const { root, oldDir } = fixture();
  const item = planClientTmpCleanup({ root, now: NOW }).remove.find((x) => x.path === oldDir);
  assert.ok(item.bytes >= 512);
});

test('A7 合计字节覆盖所有待删项', () => {
  const { root } = fixture();
  const plan = planClientTmpCleanup({ root, now: NOW });
  const sum = plan.remove.reduce((acc, x) => acc + x.bytes, 0);
  assert.equal(plan.bytes, sum);
});

test('A8 root 不存在时给出空计划', () => {
  const plan = planClientTmpCleanup({ root: path.join(tmp(), 'nope'), now: NOW });
  assert.equal(plan.exists, false);
  assert.deepEqual(plan.remove, []);
});

test('A9 相对路径被拒绝（绝不按 CWD 猜）', () => {
  const plan = planClientTmpCleanup({ root: 'client-tmp', now: NOW });
  assert.equal(plan.exists, false);
  assert.deepEqual(plan.remove, []);
});

test('A10 maxEntries 触发截断标记', () => {
  const root = tmp();
  for (let i = 0; i < 5; i++) {
    const f = path.join(root, `f${i}.bin`);
    fs.writeFileSync(f, 'a');
    age(f, 10);
  }
  const plan = planClientTmpCleanup({ root, now: NOW, maxEntries: 2 });
  assert.equal(plan.truncated, true);
  assert.equal(plan.remove.length, 2);
});

test('A11 自定义保留期生效', () => {
  const { root, newFile } = fixture();
  const plan = planClientTmpCleanup({ root, now: NOW, maxAgeMs: 12 * 60 * 60 * 1000 });
  assert.equal(plan.remove.some((x) => x.path === newFile), true);
});

test('A12 符号链接只作为链接本身待删（不跟进目标）', (t) => {
  const root = tmp();
  const outside = tmp();
  const target = path.join(outside, 'outside.bin');
  fs.writeFileSync(target, 'outside');
  const link = path.join(root, 'link.bin');
  try {
    fs.symlinkSync(target, link, 'file');
    // 某些环境里 Node 的 fs 被 brokered shim 接管，symlink 会「不报错但也没建成」，
    // 所以不能只看有没有抛，必须回读确认。
    fs.lstatSync(link);
  } catch (_) {
    t.skip('当前环境无法创建符号链接');
    return;
  }
  // Windows 上 utimes 会跟进链接（可能 ENOENT），这里改用「保留期 0 + 时钟后移」
  // 让所有条目一律超龄，绕开对链接改 mtime 的平台差异。
  const item = planClientTmpCleanup({ root, now: Date.now() + 60000, maxAgeMs: 0 })
    .remove.find((x) => x.path === link);
  assert.ok(item);
  assert.equal(item.isLink, true);
  assert.equal(item.bytes, 0);
});

test('A13 isInside 拒绝同名前缀与父目录', () => {
  const root = path.join('C:\\', 'data', 'client-tmp');
  assert.equal(isInside(root, path.join(root, 'a')), true);
  assert.equal(isInside(root, root), false);
  assert.equal(isInside(root, path.join('C:\\', 'data', 'client-tmp-evil')), false);
  assert.equal(isInside(root, path.join('C:\\', 'data')), false);
});

// ===== B. 执行 =====
test('B1 dryRun 不删任何东西', () => {
  const { root, oldFile } = fixture();
  const result = runClientTmpCleanup({ root, now: NOW, dryRun: true });
  assert.equal(result.removed, 0);
  assert.equal(fs.existsSync(oldFile), true);
});

test('B2 真删超龄文件', () => {
  const { root, oldFile } = fixture();
  const result = runClientTmpCleanup({ root, now: NOW });
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(result.removed >= 1, true);
});

test('B3 真删超龄目录（含内部文件）', () => {
  const { root, oldDir } = fixture();
  runClientTmpCleanup({ root, now: NOW });
  assert.equal(fs.existsSync(oldDir), false);
});

test('B4 新鲜文件在真跑后仍在', () => {
  const { root, newFile } = fixture();
  runClientTmpCleanup({ root, now: NOW });
  assert.equal(fs.existsSync(newFile), true);
});

test('B5 删除失败计入 failed 而不抛（客户端占着文件是常态）', () => {
  const { root } = fixture();
  const result = runClientTmpCleanup({
    root, now: NOW,
    rm: () => { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; },
  });
  assert.equal(result.removed, 0);
  assert.equal(result.failed, result.remove.length);
});

test('B6 删除目标就是盘点清单里的路径（不多删）', () => {
  const { root } = fixture();
  const touched = [];
  const result = runClientTmpCleanup({ root, now: NOW, rm: (p) => touched.push(p) });
  assert.deepEqual(touched.sort(), result.remove.map((x) => x.path).sort());
});

// ===== C. daemon 接线 =====
const dm = codeOnly(read('scripts/daemon.js'));

test('C1 daemon 引入了 client-tmp-cleanup', () => {
  assert.match(dm, /require\('\.\/client-tmp-cleanup\.js'\)/);
});

test('C2 启动时跑一次（reason=启动）', () => {
  assert.match(dm, /cleanupClientTmpOnce\('启动'\)/);
});

test('C3 每 24 小时一次（reason=定时）', () => {
  assert.match(dm, /setInterval\(\(\) => cleanupClientTmpOnce\('定时'\), 24 \* 60 \* 60 \* 1000\)/);
});

test('C4 定时器 unref（不能拖住 daemon 退出）', () => {
  assert.match(dm, /clientTmpCleanupTimer\.unref && clientTmpCleanupTimer\.unref\(\)/);
});

test('C5 清理根取 clientTmpRoot(DATA_DIR)，不是硬编码路径', () => {
  assert.match(dm, /runClientTmpCleanup\(\{ root: clientTmpRoot\(DATA_DIR\) \}\)/);
});

// ===== D. 产物 =====
test('D1 scripts/client-tmp-cleanup.js 是纯 CRLF', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'scripts', 'client-tmp-cleanup.js'), 'utf8');
  assert.ok(raw.includes('\r\n'));
  assert.equal((raw.match(/(^|[^\r])\n/g) || []).length, 0);
});

test('D2 mac 打包白名单两处都登记了', () => {
  const sh = read('scripts/build-mac-dmg.sh');
  assert.equal((sh.match(/client-tmp-cleanup\.js/g) || []).length, 2);
});
