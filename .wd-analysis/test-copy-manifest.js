'use strict';
/*
 * test-copy-manifest.js —— 「空间扫描 → 复制排队清单 → 自动复制排序」这条链路的断言。
 *
 * 三个层次：
 *   A 组：接线（源码级）。daemon.js 不能被 require（它会起 HTTP 服务），只能按字符查。
 *   B~E 组：模块契约。真建临时目录，真读写清单文件，真改文件触发 mtime 变化。
 *   F~G 组：排序与回写语义。注入受控的 measure 替身，数它被调了几次。
 *   H 组：真实数据对照（只读，不写盘）。
 *
 * 本套件最想守住的一件事：**「文件数多但字节小」的会话必须排到队尾**。
 * 这是原实现（只按体积升序）的真实盲点 —— 2MB / 8 万文件的会话在旧序里排第一，
 * 却要跑 8 万次文件操作，能把串行队列堵十几分钟。
 *
 * 跑法：node .wd-analysis/test-copy-manifest.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.join(__dirname, '..');
const cm = require(path.join(REPO, 'scripts', 'copy-manifest.js'));
const DAEMON_SRC = fs.readFileSync(path.join(REPO, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}
function eq(name, actual, expected) { ok(actual === expected, name, actual + ' ≠ ' + expected); }
function sleep(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

const MB = 1024 * 1024;
const UID1 = 'uid-1';
const UID2 = 'uid-2';
const SA = '11111111-1111-4111-8111-111111111111';
const SB = '22222222-2222-4222-8222-222222222222';
const CWD = 'D:\\WorkBuddy date\\2026-09-14-10-51-52';
const SLUG = cm.__SLUG_FOR_TEST__ || 'd-WorkBuddy date-2026-09-14-10-51-52';

function write(p, size) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(size, 7));
}

// ── 夹具：一个真临时目录 + 一份 v4 扫描结果 ──────────────────────────
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-manifest-'));
  write(path.join(root, 'workspace', 'sessions', SA, 'a.bin'), 100);
  write(path.join(root, 'projects', SLUG, SA + '.jsonl'), 50);
  const finishedAt = Date.now();
  return {
    root,
    scan: {
      version: 4,
      root,
      finishedAt,
      cancelled: false,
      sessions: [{
        id: SA, uid: UID1, cwd: CWD, title: '某任务',
        bytes: 150, rawBytes: 150, files: 2,
        payloadBytes: 100, payloadRawBytes: 100, payloadFiles: 1,
      }, {
        id: SB, uid: UID2, cwd: '', title: '另一条',
        bytes: 4000, rawBytes: 4000, files: 9,
        payloadBytes: 3900, payloadRawBytes: 3900, payloadFiles: 8,
      }],
      conversations: [{ title: '某任务', cwd: CWD, sessions: 1, bytes: 150, files: 2, payloadBytes: 100, payloadFiles: 1 }],
    },
  };
}

(async function main() {
  // ── A. 接线 ────────────────────────────────────────────────────────
  console.log('[A] daemon.js 接线');
  ok(DAEMON_SRC.indexOf("require('./copy-manifest.js')") >= 0,
    'A1 引入了 copy-manifest 模块');
  ok(/function\s+sortAutoCopyPlanBySize[\s\S]{0,400}?copyManifest\.sortPlan\(/.test(DAEMON_SRC),
    'A2 复制计划排序走清单（sortAutoCopyPlanBySize → copyManifest.sortPlan）');
  ok(DAEMON_SRC.indexOf('measure: sessionContentSize') >= 0,
    'A3 清单缺口仍由 sessionContentSize 现场测量兜底（不是"只有清单"）');
  ok(/writeManifest\(DATA_DIR,\s*result/.test(DAEMON_SRC),
    'A4 空间扫描完成后派生清单');
  ok(DAEMON_SRC.indexOf('deriveCopyManifestFromCache(') >= 0,
    'A5 启动时从已有扫描结果派生（免得用户为了生效而重扫一次）');
  ok(DAEMON_SRC.indexOf('mergeMeasured(DATA_DIR, sourceUid, sized.measured') >= 0,
    'A6 现场测量结果回写清单，下次即命中');
  ok(DAEMON_SRC.indexOf('invalidateCopyManifestCache()') >= 0,
    'A7 写完清单让读缓存失效（否则下一次排序还拿旧解析结果）');
  ok(/sessionBucketPaths[\s\S]{0,1200}?changes-detail[\s\S]{0,300}?file-tree-manifests/.test(DAEMON_SRC),
    'A8 现场测量口径补齐到与扫描器 KEYED_TOPS 一致（否则同一条会话两个数）');
  ok(DAEMON_SRC.indexOf('uid: options.uid,') >= 0
    && DAEMON_SRC.indexOf('sortAutoCopyPlanBySize(await buildAutoCopyPlan(sourceUid, targetUid), wbHome, { uid: sourceUid })') >= 0,
    'A9 排序按源账号 uid 取清单条目（跨账号副本不能互相顶）');
  ok(/档位 \$\{sized\.tiers\[0\]/.test(DAEMON_SRC)
    && /清单命中 \$\{sized\.stats\.fromList\}\/\$\{sized\.stats\.total\}/.test(DAEMON_SRC),
    'A10 任务启动日志里打出档位分布与清单命中率（可诊断）');
  ok(/DAEMON_VERSION = '1\.3\.(1[1-9]|[2-9]\d)'/.test(DAEMON_SRC),
    'A11 daemon 版本已递增（>= 1.3.11）');
  const buildId = (DAEMON_SRC.match(/DAEMON_BUILD_ID = '([^']+)'/) || [])[1] || '';
  const version = (DAEMON_SRC.match(/DAEMON_VERSION = '([^']+)'/) || [])[1] || '';
  ok(buildId.indexOf('release-' + version + '-') === 0, 'A12 buildId 与版本号自洽', buildId);
  ok(DAEMON_SRC.indexOf("const { scanSpace, spaceSlug, SPACE_SCAN_VERSION } = require('./space-scan.js');") >= 0
    && /SPACE_SCAN_VERSION\s*=\s*4/.test(fs.readFileSync(path.join(REPO, 'scripts', 'space-scan.js'), 'utf8')),
    'A13 扫描器已升到 v4（产物拆分是本链路的取数前提）');

  // ── B. buildManifest ──────────────────────────────────────────────
  console.log('\n[B] buildManifest：扫描结果 → 简洁清单');
  const fx = makeFixture();
  const m = cm.buildManifest(fx.scan);
  eq('B1 条目数 = sessions 数', m.entries.length, 2);
  eq('B2 结构版本', m.version, cm.MANIFEST_VERSION);
  eq('B3 记住来源扫描结构版本', m.scanVersion, 4);
  eq('B4 v4 结果标记为有产物拆分', m.payloadSplit, true);
  eq('B5 记下扫描时间', m.scannedAt, fx.scan.finishedAt);
  ok(m.complete === true, 'B6 未中断 → complete=true');
  const e0 = m.entries.find((x) => x.id === SA);
  eq('B7 产物体积进清单', e0.payloadBytes, 100);
  eq('B8 产物文件数进清单', e0.payloadFiles, 1);
  eq('B9 总量口径也保留（侧栏显示用的是它）', e0.bytes, 150);
  ok(e0.payloadSplit === true, 'B10 逐条标记 payloadSplit（混用时可解释）');
  ok(e0.measuredAt === fx.scan.finishedAt, 'B11 逐条带 measuredAt（判新鲜用）');
  ok(e0.mtimeAt > 0, 'B12 逐条带 mtimeAt 指纹（现场探出来的，用于判「扫描后被写过」）', e0.mtimeAt);
  eq('B13 对话层透传（与侧栏「任务对话」分组一致）', m.conversations.length, 1);

  const v3 = cm.buildManifest(Object.assign({}, fx.scan, { version: 3 }));
  eq('B14 v3 扫描结果 → payloadSplit=false（如实降级，不假装有数据）', v3.payloadSplit, false);
  eq('B15 v3 降级时产物口径回落为全量', v3.entries.find((x) => x.id === SA).payloadBytes, 150);
  eq('B16 条目上也有 payloadSplit=false', v3.entries.find((x) => x.id === SA).payloadSplit, false);

  const cancelled = cm.buildManifest(Object.assign({}, fx.scan, { cancelled: true }));
  eq('B17 中断的扫描 → complete=false', cancelled.complete, false);
  const noId = cm.buildManifest({ version: 4, root: fx.root, sessions: [{ title: '无 id' }, { id: SB, uid: UID2 }] });
  eq('B18 没有 id 的行被丢弃（无法索引）', noId.entries.length, 1);
  eq('B19 空输入不炸', cm.buildManifest(null).entries.length, 0);
  eq('B20 无 conversations 时给空数组', cm.buildManifest({ version: 4, sessions: [] }).conversations.length, 0);

  // ── C. tierOf 边界 ────────────────────────────────────────────────
  console.log('\n[C] tierOf：分档边界');
  const T = (b, f) => cm.tierOf({ payloadBytes: b, payloadFiles: f });
  eq('C1 空对象 → 0 档', cm.tierOf(null), 0);
  eq('C2 7.99MB / 10 文件 → 0 档', T(8 * MB - 1, 10), 0);
  eq('C3 8MB 整 → 1 档（含边界）', T(8 * MB, 10), 1);
  eq('C4 64MB 整 → 2 档', T(64 * MB, 10), 2);
  eq('C5 512MB 整 → 3 档', T(512 * MB, 10), 3);
  eq('C6 499 文件 → 0 档', T(1024, 499), 0);
  eq('C7 500 文件 → 1 档（含边界）', T(1024, 500), 1);
  eq('C8 5000 文件 → 2 档', T(1024, 5000), 2);
  eq('C9 50000 文件 → 3 档', T(1024, 50000), 3);
  eq('C10 取两者较大值：字节小但文件极多 → 3 档', T(2 * MB, 80000), 3);
  eq('C11 取两者较大值：字节极大但文件少 → 3 档', T(600 * MB, 3), 3);
  eq('C12 缺 payload 字段时回落总量口径', cm.tierOf({ bytes: 600 * MB, files: 3 }), 3);
  eq('C13 本机最大那种会话（436MB / 1709 文件）→ 2 档', T(436 * MB, 1709), 2);

  // ── D. 时效与判脏 ─────────────────────────────────────────────────
  console.log('\n[D] isEntryTrusted：清单条目还能不能信');
  const now = Date.now();
  const entry = m.entries.find((x) => x.id === SA);
  ok(cm.isEntryTrusted(entry, fx.root, now) === true, 'D1 刚扫描完 + 没被写过 → 信');
  ok(cm.isEntryTrusted(entry, fx.root, now + 25 * 3600 * 1000) === false,
    'D2 超过兜底时效（24h）→ 不信（防止 mtime 近似判据长期失真）');
  ok(cm.isEntryTrusted({ id: SA, measuredAt: 0 }, fx.root, now) === false, 'D3 没有 measuredAt → 不信');
  ok(cm.isEntryTrusted(entry, '', now) === true, 'D4 没给数据根目录时跳过探测，只受时效约束');
  ok(cm.isEntryTrusted(entry, fx.root, now, { probe: false }) === true, 'D5 可显式关掉探测');
  await sleep(20);
  write(path.join(fx.root, 'workspace', 'sessions', SA, 'later.bin'), 999);
  ok(cm.isEntryTrusted(entry, fx.root, now) === false,
    'D6 会话在扫描之后被写过（mtime 变了）→ 不信，回落现场测量');

  // ── E. 文件读写 ───────────────────────────────────────────────────
  console.log('\n[E] 清单文件读写');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-manifest-dir-'));
  eq('E1 清单文件名固定', path.basename(cm.manifestPath(dataDir)), 'copy-manifest.json');
  eq('E2 没有文件时读到 null', cm.readManifest(dataDir), null);
  const w1 = cm.writeManifest(dataDir, fx.scan, { wbHome: fx.root });
  ok(w1.written === true, 'E3 首次写入成功');
  const r1 = cm.readManifest(dataDir);
  ok(r1 && r1.entries.length === 2, 'E4 能读回', r1 && r1.entries.length);
  fs.writeFileSync(cm.manifestPath(dataDir), '{ 坏掉的 json');
  eq('E5 坏文件当没有（不抛，回落现场测量）', cm.readManifest(dataDir), null);
  cm.writeManifest(dataDir, fx.scan, { wbHome: fx.root, force: true });
  const w3 = cm.writeManifest(dataDir, Object.assign({}, fx.scan, { cancelled: true }));
  ok(w3.written === false, 'E6 中断的扫描不落盘（半截数字比旧数字更危险）', w3.reason);
  const older = Object.assign({}, fx.scan, { finishedAt: fx.scan.finishedAt - 60000 });
  const w4 = cm.writeManifest(dataDir, older);
  ok(w4.written === false, 'E7 更旧的扫描不覆盖更新的清单', w4.reason);
  const bumped = JSON.parse(fs.readFileSync(cm.manifestPath(dataDir), 'utf8'));
  bumped.version = cm.MANIFEST_VERSION + 1;
  fs.writeFileSync(cm.manifestPath(dataDir), JSON.stringify(bumped));
  eq('E8 结构版本不符 → 当没有（升级后自动重新派生）', cm.readManifest(dataDir), null);

  // ── F. 排序 ───────────────────────────────────────────────────────
  console.log('\n[F] sortPlan：把慢活排到队尾');
  const NOW = 1700000000000;
  const P = { id: '', cwd: '' };
  const plan = [
    Object.assign({}, P, { id: 'small' }),   // 5MB / 30 文件
    Object.assign({}, P, { id: 'many' }),    // 2MB / 80000 文件 ← 慢活
    Object.assign({}, P, { id: 'huge' }),    // 400MB / 1700 文件 ← 巨型
    Object.assign({}, P, { id: 'tiny' }),    // 0.5MB / 5 文件
  ];
  const mkEntry = (id, bytes, files) => ({
    id, uid: UID1, title: id, cwd: '', bytes, rawBytes: bytes, files,
    payloadBytes: bytes, payloadRawBytes: bytes, payloadFiles: files,
    payloadSplit: true, measuredAt: NOW, mtimeAt: 0,
  });
  const index = cm.indexManifest({
    version: cm.MANIFEST_VERSION,
    entries: [
      mkEntry('small', 5 * MB, 30),
      mkEntry('many', 2 * MB, 80000),
      mkEntry('huge', 400 * MB, 1700),
      mkEntry('tiny', 0.5 * MB, 5),
    ],
  });
  let measureCalls = 0;
  const measure = () => { measureCalls++; return { bytes: 1, files: 1, workspaceBytes: 1, workspaceFiles: 1 }; };
  const out = cm.sortPlan(plan, { uid: UID1, index, wbHome: '', measure, now: NOW });
  const order = out.plan.map((r) => r.id);
  eq('F1 档位：tiny/small 0 档、huge 2 档、many 3 档', JSON.stringify(out.tiers), JSON.stringify({ 0: 2, 1: 0, 2: 1, 3: 1 }));
  ok(order.indexOf('many') === 3, 'F2 「文件数极多但字节小」排到最后（旧序里它排第 1）', order);
  ok(order.indexOf('huge') === 2, 'F3 巨型会话排在队尾（但仍在「文件洪水」之前）', order);
  eq('F4 0 档内部按体积升序', order.slice(0, 2).join(','), 'tiny,small');
  eq('F5 全部命中清单 → 一次现场测量都没发生', measureCalls, 0);
  eq('F6 统计命中数', out.stats.fromList, 4);
  ok(out.plan.every((r) => r.sizeSource === 'manifest'), 'F7 每行标了取数来源（可诊断）');
  eq('F8 行上带档位', out.plan[3].sizeTier, 3);

  // 旧实现（纯体积升序）的对照：same 数据，只看 payloadBytes
  const legacy = plan.slice().sort((a, b) => {
    const ba = (index.get(UID1 + '\u0000' + a.id) || {}).payloadBytes || 0;
    const bb = (index.get(UID1 + '\u0000' + b.id) || {}).payloadBytes || 0;
    return ba - bb;
  }).map((r) => r.id);
  eq('F9 对照：旧序把慢活排在队首附近', legacy.indexOf('many') <= 1, true);
  console.log('      旧序 ' + legacy.join(' → ') + '   新序 ' + order.join(' → '));
  ok(legacy.indexOf('huge') === 3,
    'F10 对照：旧序里巨型也在尾部 —— 新序真正改变的是「文件洪水」那一类', legacy);

  // 未命中 → 现场测量
  measureCalls = 0;
  const missPlan = [Object.assign({}, P, { id: 'unknown-1' })];
  const out2 = cm.sortPlan(missPlan, { uid: UID1, index, wbHome: '', measure, now: NOW });
  eq('F11 清单没有的会话 → 现场测量', measureCalls, 1);
  eq('F12 测出来的条目被收集起来（供回写）', out2.measured.length, 1);
  eq('F13 标了 sizeSource=measure', out2.plan[0].sizeSource, 'measure');

  // 跨账号不能互相顶：UID2 的条目不该被 UID1 的排序用上
  eq('F14 清单按 uid + id 索引（换账号即 miss）',
    cm.sortPlan(missPlan, { uid: UID2, index, wbHome: '', measure, now: NOW }).plan[0].sizeSource, 'measure');

  // 稳定排序
  const tie = [
    Object.assign({}, P, { id: 'a' }), Object.assign({}, P, { id: 'b' }), Object.assign({}, P, { id: 'c' }),
  ];
  const tieIndex = cm.indexManifest({
    version: cm.MANIFEST_VERSION,
    entries: ['a', 'b', 'c'].map((id) => mkEntry(id, 3 * MB, 100)),
  });
  eq('F15 完全并列时保持计划原序（可预期，不会随机抖）',
    cm.sortPlan(tie, { uid: UID1, index: tieIndex, wbHome: '', measure, now: NOW }).plan.map((r) => r.id).join(','), 'a,b,c');
  eq('F16 空计划不炸', cm.sortPlan([], { uid: UID1, index, wbHome: '', now: NOW }).plan.length, 0);
  eq('F17 没有清单也没有 measure 时不炸', cm.sortPlan(plan, { uid: UID1, wbHome: '', now: NOW }).plan.length, 4);

  // 陈旧条目 → 回落测量
  const staleIndex = cm.indexManifest({
    version: cm.MANIFEST_VERSION,
    entries: [Object.assign(mkEntry('small', 5 * MB, 30), { measuredAt: NOW - 48 * 3600 * 1000 })],
  });
  measureCalls = 0;
  cm.sortPlan([Object.assign({}, P, { id: 'small' })], { uid: UID1, index: staleIndex, wbHome: '', measure, now: NOW });
  eq('F18 超过 24h 的条目 → 回落现场测量', measureCalls, 1);

  // ── G. 回写 ───────────────────────────────────────────────────────
  console.log('\n[G] mergeMeasured：现场测量结果回写');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-manifest-merge-'));
  const g1 = cm.mergeMeasured(dir2, UID1, [], {});
  ok(g1.written === false, 'G1 空输入不落盘');
  const g2 = cm.mergeMeasured(dir2, UID1, [{ id: 'x', bytes: 10, files: 1, payloadBytes: 9, payloadFiles: 1, measuredAt: NOW, mtimeAt: 5 }], {});
  ok(g2.written === true, 'G2 没有清单时也能起步（回写不依赖先有扫描）');
  const readBack = cm.readManifest(dir2);
  eq('G3 回写后能读到', readBack.entries.length, 1);
  eq('G4 值正确', readBack.entries[0].payloadBytes, 9);
  eq('G5 起始清单标记为不完整（没做过全量扫描）', readBack.complete, false);
  cm.writeManifest(dir2, fx.scan, { wbHome: fx.root, force: true });
  const g3 = cm.mergeMeasured(dir2, UID1, [{ id: 'y', bytes: 20, files: 2, payloadBytes: 19, payloadFiles: 2, measuredAt: NOW, mtimeAt: 7 }], {});
  eq('G6 只加不删', g3.added, 1);
  const after = cm.readManifest(dir2);
  eq('G7 原有条目保留', after.entries.length, 3);
  ok(after.entries.some((x) => x.id === SA && x.uid === UID1), 'G8 别的账号 / 别的会话的条目没被冲掉');
  const g4 = cm.mergeMeasured(dir2, UID1, [{ id: SA, bytes: 777, files: 8, payloadBytes: 700, payloadFiles: 7, measuredAt: NOW + 1000, mtimeAt: 11 }], {});
  const after2 = cm.readManifest(dir2);
  eq('G9 同 (uid,id) 覆盖而非追加', after2.entries.filter((x) => x.id === SA && x.uid === UID1).length, 1);
  eq('G10 覆盖后的值生效', after2.entries.find((x) => x.id === SA && x.uid === UID1).payloadBytes, 700);
  ok(g4.manifest.mergedAt > 0 && g4.manifest.scannedAt === fx.scan.finishedAt,
    'G11 合并时间与扫描时间分开记（别把两者混成一个）');

  // ── H. 真实数据（只读） ──────────────────────────────────────────
  console.log('\n[H] 真实扫描结果对照（只读）');
  const realPath = path.join(process.env.APPDATA || '', 'WorkDaddy', 'space-scan.json');
  if (fs.existsSync(realPath)) {
    const real = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    const rm = cm.buildManifest(real);
    ok(rm.entries.length === (real.sessions || []).length, 'H1 真实结果可派生清单',
      { manifest: rm.entries.length, scan: (real.sessions || []).length });
    const tiers = { 0: 0, 1: 0, 2: 0, 3: 0 };
    rm.entries.forEach((x) => { tiers[cm.tierOf(x)] += 1; });
    console.log('      真实分布（扫描版本 v' + rm.scanVersion + '，payloadSplit=' + rm.payloadSplit + '）：'
      + JSON.stringify(tiers));
    ok(tiers[0] >= rm.entries.length * 0.5, 'H2 大多数普通会话落在 0 档（不会被无谓重排）', tiers);
    ok(tiers[3] === 0, 'H3 本机没有「文件洪水」型会话（这类要靠阈值兜底，不是靠本机数据）', tiers);
    const realIndex = cm.indexManifest(rm);
    // 复制任务一次只处理**一个源账号**，所以按 uid 取一个子集来跑（uid 是索引键的一部分）。
    const firstUid = (rm.entries[0] || {}).uid || '';
    const realPlan = rm.entries.filter((e) => e.uid === firstUid).map((e) => ({ id: e.id, cwd: e.cwd }));
    // ⚠️ H4 的口径是「清单命中就不现场测量」，**不是**「清单新鲜度」。
    // 真实 space-scan.json 是**外部文件**：落盘超过 DEFAULT_FRESH_MS（24h）就被
    // isEntryTrusted 判过期，sortPlan 整批退回现场测量 —— 这条断言于是会随日历自己变红。
    // 2026-09-19 实测：扫描文件 31.4 小时前生成 ⇒ 19/19 全部 measure，与代码改动无关
    // （git stash 对照同样失败）。这里用「扫描完成时刻 +1 分钟」当 now，把新鲜度这个
    // 外部变量固定住，测的才是索引命中；「过期必须退回现场测量」由 H4b 单独钉死。
    const scanNow = Number(real.finishedAt) || Date.now();
    let calls = 0;
    const t0 = Date.now();
    const sorted = cm.sortPlan(realPlan, { uid: firstUid, index: realIndex, wbHome: '', measure: () => (calls++, {}), now: scanNow + 60000 });
    const ms = Date.now() - t0;
    ok(calls === 0, 'H4 真实清单全命中 → 零现场测量（省掉整棵目录树的同步遍历）',
      { calls, plan: realPlan.length, uid: firstUid });
    let staleCalls = 0;
    cm.sortPlan(realPlan, { uid: firstUid, index: realIndex, wbHome: '', measure: () => (staleCalls++, {}), now: scanNow + cm.DEFAULT_FRESH_MS + 60000 });
    ok(staleCalls === realPlan.length, 'H4b 清单过期（超过 DEFAULT_FRESH_MS）时退回现场测量，不吃陈旧体积',
      { staleCalls, plan: realPlan.length });
    console.log('      单账号 ' + realPlan.length + ' 条：清单路径排序 ' + ms + ' ms'
      + '（对照：现场全量测量 900ms/3 账号 ≈ 300ms/账号）');
    ok(ms < 50, 'H5 排序耗时可忽略', ms);
    ok(sorted.plan.length === realPlan.length, 'H6 不丢行');
  } else {
    console.log('  skip 没有真实扫描结果，跳过 H 组');
  }

  try { fs.rmSync(fx.root, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (_) {}

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试自身异常: ' + (e && e.stack || e));
  process.exit(2);
});
