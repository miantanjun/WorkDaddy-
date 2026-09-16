'use strict';
/*
 * test-space-scan.js —— 空间扫描引擎（scripts/space-scan.js）的归属 / 去重 / 可中断 / 隐私断言。
 *
 * 全部在 fs.mkdtempSync 的**合成目录树**上跑，独立地（不借助扫描器）自己走一遍目录算出
 * 「应有」的文件数与字节数做交叉校验。不碰真实 ~/.workbuddy（只在最后做一次带 maxEntries
 * 上限的只读冒烟）。
 *
 * 跑法：node .wd-analysis/test-space-scan.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const scan = require(path.join(__dirname, '..', 'scripts', 'space-scan.js'));

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}

const UID1 = 'uid-1';
const UID2 = 'uid-2';
const SA = '11111111-1111-4111-8111-111111111111';
const SB = '22222222-2222-4222-8222-222222222222';
const SX = '33333333-3333-4333-8333-333333333333';  // 未登记
const CWD = 'C:\\Users\\Lyon\\Proj';
const CWD2 = 'D:\\WorkBuddy date\\2026-08-11-17-57-19';

function write(p, size) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(size, 7));
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-space-'));
  write(path.join(root, 'workspace', 'sessions', SA, 'payload.bin'), 1000);
  // 嵌套一层目录：真实数据就是 workspace/sessions/<uuid>/<子目录>/<文件>。
  // 曾经在这层丢掉归属（默认归属没往下传），整棵子树静默落进 shared —— 保留这个用例做回归。
  write(path.join(root, 'workspace', 'sessions', SA, 'nested', 'deep.bin'), 40);
  write(path.join(root, 'workspace', 'sessions', SB, 'payload.bin'), 1000);
  // 硬链接：与 SA 的 payload 同一个 inode
  fs.unlinkSync(path.join(root, 'workspace', 'sessions', SB, 'payload.bin'));
  fs.linkSync(
    path.join(root, 'workspace', 'sessions', SA, 'payload.bin'),
    path.join(root, 'workspace', 'sessions', SB, 'payload.bin')
  );
  write(path.join(root, 'workspace', 'sessions', SX, 'secret-name.bin'), 10);
  write(path.join(root, 'storage', 'user-uid-1', 'store.bin'), 200);
  write(path.join(root, 'storage', 'user-uid-2-personal', 'store.bin'), 300);
  write(path.join(root, 'memory', 'uid-1_memory.md'), 50);
  write(path.join(root, 'projects', scan.spaceSlug(CWD), SA + '.jsonl'), 300);
  write(path.join(root, 'projects', scan.spaceSlug(CWD), SB + '.jsonl'), 400);
  write(path.join(root, 'projects', 'd-orphan-slug', 'x.jsonl'), 77);
  write(path.join(root, 'blobs', 'ab', 'blob.bin'), 500);
  write(path.join(root, 'file-history', SA, 'v1.bin'), 60);
  write(path.join(root, 'artifact-index', SA + '.json'), 70);
  write(path.join(root, 'workbuddy.db'), 1234);
  return root;
}

// 独立地走一遍，算出「应有」的总文件数与总字节数（用 stat.size，硬链接按出现次数各算一次）
function measure(root) {
  let files = 0;
  let rawBytes = 0;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const dir = rel ? path.join(root, rel) : root;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? rel + path.sep + entry.name : entry.name;
      if (entry.isDirectory()) stack.push(childRel);
      else if (entry.isFile()) {
        files += 1;
        rawBytes += fs.statSync(path.join(root, childRel)).size;
      }
    }
  }
  return { files, rawBytes };
}

const RESOLVE = {
  session: (key) => {
    if (key === SA) return { uid: UID1, cwd: CWD };
    if (key === SB) return { uid: UID2, cwd: CWD };
    return null;
  },
  // 注意：storage/ 下的目录名是 `user-<uid>` / `user-<uid>-<suffix>`，memory/ 下是
  // `<uid>_memory.md` 取 `_` 之前。扫描器只把「名字」交出来，怎么解析由调用方决定。
  accountName: (name) => {
    const base = String(name || '').replace(/^user-/, '');
    if (base === 'uid-1' || base === 'uid-1-personal') return UID1;
    if (base === 'uid-2' || base === 'uid-2-personal') return UID2;
    return null;
  },
  spaceSlug: (slug) => (slug === scan.spaceSlug(CWD) ? CWD : null),
};

(async function main() {
  const root = buildFixture();
  const expect = measure(root);
  console.log('[夹具] ' + root);
  console.log('       独立统计: files=' + expect.files + ' rawBytes=' + expect.rawBytes + '\n');

  console.log('[0] spaceSlug 与真实 projects 目录名一致（回归护栏）');
  // 期望值来自真实数据反推（2026-09-14）：sessions 表里 77 个真实 cwd 去对 projects/ 下的
  // 目录名，本规则命中 76/77（唯一未命中的那条，projects 目录本身已不存在）。
  // 早期写成 replace(/[:\\/]/g, '-') 会把 `D:\` 变成 `D--`，导致 projects 下**全部**目录
  // 都解析不出 cwd —— 这里锁死这个坑。
  ok(scan.spaceSlug('D:\\WorkBuddy date\\2026-08-11-17-57-19') === 'd-WorkBuddy date-2026-08-11-17-57-19',
    'A0a 盘符小写 + `:\\` 合并成一个 `-`', scan.spaceSlug('D:\\WorkBuddy date\\2026-08-11-17-57-19'));
  ok(scan.spaceSlug('C:\\Users\\Lyon\\WorkBuddy\\2026-08-11-14-13-10') === 'c-Users-Lyon-WorkBuddy-2026-08-11-14-13-10',
    'A0b 路径其余部分大小写照原（不做整体小写）',
    scan.spaceSlug('C:\\Users\\Lyon\\WorkBuddy\\2026-08-11-14-13-10'));
  ok(scan.spaceSlug('') === '' && scan.spaceSlug(null) === '' && scan.spaceSlug(undefined) === '',
    'A0c 空值安全（返回空串）');
  ok(scan.SPACE_SCAN_VERSION === 3, 'A0d 版本号已随归属口径变更递增（旧缓存会失效重扫）', scan.SPACE_SCAN_VERSION);

  console.log('[A] 结构与断言基线');
  const progress = [];
  const result = await scan.scanSpace(root, {
    resolveSession: RESOLVE.session,
    resolveAccountName: RESOLVE.accountName,
    resolveSpaceSlug: RESOLVE.spaceSlug,
    onProgress: (info) => progress.push(info),
    progressEvery: 1,
  });

  ok(result.version === scan.SPACE_SCAN_VERSION, 'A1 带版本号');
  ok(result.cancelled === false, 'A2 未被取消');
  ok(result.overlapping === true, 'A3 显式标记 accounts/spaces 口径重叠');

  console.log('\n[B] totals 恰好一次（总量口径唯一）');
  ok(result.totals.files === expect.files, 'B1 totals.files == 独立统计的文件数',
    { got: result.totals.files, want: expect.files });
  ok(result.totals.rawBytes === expect.rawBytes, 'B2 totals.rawBytes == 所有文件 size 之和',
    { got: result.totals.rawBytes, want: expect.rawBytes });
  ok(result.totals.bytes === expect.rawBytes - 1000, 'B3 totals.bytes 扣除硬链接重复的 1000',
    { got: result.totals.bytes, want: expect.rawBytes - 1000 });

  console.log('\n[C] 硬链接去重');
  ok(result.totals.dedupedFiles === 1, 'C1 去重文件数 = 1', result.totals.dedupedFiles);
  ok(result.totals.dedupedBytes === 1000, 'C2 去重字节 = 1000', result.totals.dedupedBytes);
  const acc1 = result.accounts.find((a) => a.uid === UID1);
  const acc2 = result.accounts.find((a) => a.uid === UID2);
  ok(acc1 && acc1.rawBytes === 1000 + 200 + 50 + 300 + 60 + 70 + 40, 'C3 账号1 rawBytes 含全部出现次数（含嵌套目录里的文件）',
    acc1 && acc1.rawBytes);
  ok(acc1 && acc1.files === 7, 'C4 账号1 文件数 = 7（含 nested/deep.bin）', acc1 && acc1.files);
  ok(acc2 && acc2.rawBytes === 1000 + 300 + 400, 'C5 账号2 rawBytes 含硬链接那年',
    acc2 && acc2.rawBytes);
  // 回归护栏：workspace 顶层自己不含文件；一旦嵌套归属再丢，这里会立刻变大。
  const wsShared = result.shared.find((s) => s.name === 'workspace');
  ok(!wsShared || wsShared.files === 0, 'C6 workspace 不残留未归属文件（嵌套归属未丢）',
    wsShared && { files: wsShared.files, rawBytes: wsShared.rawBytes });

  console.log('\n[D] 按账号归属');
  ok(!!acc1 && !!acc2, 'D1 两个账号都归出来了');
  ok(acc1 && acc1.sessions === 1 && acc2 && acc2.sessions === 1, 'D2 会话计数按去重后的会话键',
    { a1: acc1 && acc1.sessions, a2: acc2 && acc2.sessions });
  ok(result.accounts.length === 2, 'D3 未登记的会话没有凭空造出账号', result.accounts.map((a) => a.uid));

  console.log('\n[E] 按空间归属');
  const space = result.spaces.find((s) => s.cwd === CWD);
  ok(!!space, 'E1 空间 CWD 归出来了', result.spaces.map((s) => s.cwd));
  ok(space && space.sessions === 2, 'E2 该空间 2 个会话', space && space.sessions);
  // 空间视图 = 该空间下**所有**按会话归属的容器：产物目录 + projects jsonl +
  // file-history + artifact-index（它们都是会话级数据，只是落在不同顶层目录）。
  ok(space && space.rawBytes === 1000 + 40 + 1000 + 300 + 400 + 60 + 70 && space.files === 7,
    'E2b 空间视图 = 该空间所有会话级容器之和（含嵌套文件）',
    space && { rawBytes: space.rawBytes, files: space.files });
  ok(space && space.resolved === true, 'E3 resolved=true');
  const orphan = result.spaces.find((s) => s.slug === 'd-orphan-slug');
  ok(!!orphan && orphan.resolved === false, 'E4 slug 解析不出来时不硬猜：resolved=false 且以 slug 当 cwd',
    orphan);
  ok(orphan && orphan.rawBytes === 77, 'E5 未解析空间的体积仍然算出来了', orphan && orphan.rawBytes);

  console.log('\n[F] 未归属 / 共享');
  ok(result.unattributed.files === 1 && result.unattributed.rawBytes === 10,
    'F1 未知会话 uuid 归入未归属', result.unattributed);
  const blobs = result.shared.find((s) => s.name === 'blobs');
  ok(blobs && blobs.rawBytes === 500, 'F2 blobs 计入 shared', blobs);
  const db = result.shared.find((s) => s.name === 'workbuddy.db');
  ok(db && db.rawBytes === 1234, 'F3 顶层文件也计入 shared', db);

  console.log('\n[G] 默认不含文件名');
  const dump = JSON.stringify(result);
  ok(dump.indexOf('payload.bin') < 0, 'G1 结果里不含文件名 payload.bin');
  ok(dump.indexOf('secret-name.bin') < 0, 'G2 结果里不含文件名 secret-name.bin');
  ok(dump.indexOf('store.bin') < 0 && dump.indexOf('blob.bin') < 0, 'G3 结果里不含其它文件名');
  ok(progress.every((p) => !/\.bin|\.jsonl|\.md|\.json|\.db/.test(String(p.current || ''))),
    'G4 进度里的 current 也只到目录，不含文件名',
    progress.filter((p) => /\.bin|\.jsonl|\.md|\.json|\.db/.test(String(p.current || ''))).slice(0, 3));

  console.log('\n[H] 进度上报');
  ok(progress.length >= 2, 'H1 至少上报两次（中间 + final）', progress.length);
  ok(progress[progress.length - 1].final === true, 'H2 最后一次带 final=true');
  const last = progress[progress.length - 1];
  ok(last.files === expect.files && last.rawBytes === expect.rawBytes, 'H3 final 的数字与结果一致',
    { f: last.files, b: last.rawBytes });
  ok(last.dedupedBytes === 1000 && last.unreadable >= 0, 'H4 final 带去重信息', last.dedupedBytes);

  console.log('\n[I] 可中断');
  let seen = 0;
  const partial = await scan.scanSpace(root, {
    resolveSession: RESOLVE.session,
    resolveAccountName: RESOLVE.accountName,
    resolveSpaceSlug: RESOLVE.spaceSlug,
    progressEvery: 1,
    onProgress: () => { seen += 1; },
    shouldCancel: () => seen >= 3,
  });
  ok(partial.cancelled === true, 'I1 cancelled=true');
  ok(partial.processed >= 3 && partial.processed < expect.files, 'I2 中途停下（部分结果）',
    { processed: partial.processed, total: expect.files });
  ok(partial.totals.files < expect.files, 'I3 部分结果的计数确实小于全量', partial.totals.files);

  console.log('\n[J] 条目上限（测试用的确定性截断）');
  const bounded = await scan.scanSpace(root, {
    resolveSession: RESOLVE.session,
    resolveAccountName: RESOLVE.accountName,
    resolveSpaceSlug: RESOLVE.spaceSlug,
    maxEntries: 5,
  });
  ok(bounded.processed <= 6, 'J1 maxEntries 生效', bounded.processed);
  ok(bounded.totals.files < expect.files, 'J2 只处理了一部分文件', bounded.totals.files);

  console.log('\n[K] 真实根目录只读冒烟（限量，不写盘）');
  try {
    const realRoot = path.join(os.homedir(), '.workbuddy');
    if (!fs.existsSync(realRoot)) {
      console.log('  skip  本机无 ' + realRoot);
    } else {
      const smoke = await scan.scanSpace(realRoot, { maxEntries: 400, progressEvery: 200 });
      ok(typeof smoke.totals.files === 'number' && smoke.totals.files > 0, 'K1 真实根目录能扫出文件',
        smoke.totals.files);
      ok(Array.isArray(smoke.shared) && smoke.shared.length > 0, 'K2 shared 有明细', smoke.shared.length);
      ok(smoke.processed <= 401, 'K3 限量生效', smoke.processed);
      console.log('       真实根目录限量扫描: files=' + smoke.totals.files
        + ' bytes=' + smoke.totals.bytes + ' ms=' + smoke.elapsedMs);
    }
  } catch (e) {
    fail++; console.log('  FAIL K 真实根目录冒烟异常 → ' + (e && e.message));
  }

  // ---------------------------------------------------------------------------
  // [L] 任务对话维度（v3 新增）
  // 背景：WorkBuddy 给每个任务对话分配 <工作根目录>/<YYYY-MM-DD-HH-mm-ss> 形态的工作目录，
  // 目录名和用户提的需求毫无关系 —— 只按目录汇报，界面上就是一串时间戳。标题只在会话库里，
  // 所以这里锁死「调用方注入的 title 必须原样出现在 spaces[].conversations 上」。
  console.log('\n[L] 任务对话维度（工作目录 → 哪个任务）');
  {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-space-conv-'));
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // 无标题
    const slug2 = scan.spaceSlug(CWD2);
    write(path.join(root2, 'workspace', 'sessions', A, 'payload.bin'), 1000);
    write(path.join(root2, 'workspace', 'sessions', C, 'payload.bin'), 500);
    write(path.join(root2, 'workspace', 'sessions', D, 'payload.bin'), 30);
    // B 与 A 是同一份物理文件（切号自动复制留下的硬链接）→ 同一段对话的第二份记录
    write(path.join(root2, 'workspace', 'sessions', B, 'payload.bin'), 1000);
    fs.unlinkSync(path.join(root2, 'workspace', 'sessions', B, 'payload.bin'));
    fs.linkSync(path.join(root2, 'workspace', 'sessions', A, 'payload.bin'),
      path.join(root2, 'workspace', 'sessions', B, 'payload.bin'));
    write(path.join(root2, 'projects', slug2, A + '.jsonl'), 300);
    write(path.join(root2, 'projects', slug2, B + '.jsonl'), 400);
    write(path.join(root2, 'projects', slug2, C + '.jsonl'), 200);
    write(path.join(root2, 'projects', slug2, D + '.jsonl'), 20);

    const conv = await scan.scanSpace(root2, {
      resolveSession: (key) => {
        if (key === A) return { uid: UID1, cwd: CWD2, title: '代码助手改界面' };
        if (key === B) return { uid: UID2, cwd: CWD2, title: '代码助手改界面' };
        if (key === C) return { uid: UID1, cwd: CWD2, title: '导出对账单' };
        if (key === D) return { uid: UID1, cwd: CWD2 }; // 没标题
        return null;
      },
      resolveSpaceSlug: (slug) => (slug === slug2 ? CWD2 : null),
    });

    const space = conv.spaces.find((s) => s.cwd === CWD2);
    const list = (space && space.conversations) || [];
    const byTitle = {};
    list.forEach((x) => { byTitle[x.title] = x; });

    ok(conv.sessions.length === 4, 'L1 单条会话进 sessions[]（含跨账号副本）', conv.sessions.length);
    ok(conv.conversations.length === 3, 'L2 同一标题的多份记录聚合成 1 个对话', conv.conversations.length);
    ok(!!space && list.length === 3, 'L3 空间上挂了自己的对话列表', list.map((x) => x.title));
    ok(byTitle['代码助手改界面'] && byTitle['代码助手改界面'].sessions === 2,
      'L4 同一对话的两份记录被计为 ×2', byTitle['代码助手改界面'] && byTitle['代码助手改界面'].sessions);
    // A 的 payload 1000（B 是硬链接，去重后为 0）+ A.jsonl 300 + B.jsonl 400 = 1700
    ok(byTitle['代码助手改界面'] && byTitle['代码助手改界面'].bytes === 1700,
      'L5 对话占用按物理字节去重（硬链接副本不重复计）',
      byTitle['代码助手改界面'] && byTitle['代码助手改界面'].bytes);
    ok(byTitle['代码助手改界面'] && byTitle['代码助手改界面'].rawBytes === 2700,
      'L6 对话的 rawBytes 保留含重复口径（用于解释差值）',
      byTitle['代码助手改界面'] && byTitle['代码助手改界面'].rawBytes);
    ok(list[0] && list[0].title === '代码助手改界面' && list[0].bytes >= (list[1] ? list[1].bytes : 0),
      'L7 对话按实际占用降序（不能按 rawBytes 排，否则「3 份小对话」会压过「1 份大对话」）',
      list.map((x) => x.title + ':' + x.bytes));
    ok(list.some((x) => x.title === '(未命名对话)'), 'L8 没标题的会话有兜底分组，不会丢数据',
      list.map((x) => x.title));
    const convSum = list.reduce((sum, x) => sum + x.bytes, 0);
    ok(convSum === space.bytes, 'L9 对话之和 == 该空间实际占用（口径闭合，不会出现「加起来对不上」）',
      { convSum, spaceBytes: space.bytes });
    ok(Array.isArray(space.conversations) && conv.sessions.every((s) => typeof s.title === 'string'),
      'L10 sessions[] 每条都带 title 字段（缺失时为空格串而非 undefined）');

    const noTitle = await scan.scanSpace(root2, {});
    ok(noTitle.conversations.every((x) => x.title === '(未命名对话)') || noTitle.conversations.length === 0,
      'L11 调用方不注入 title 时不崩，统一落到「(未命名对话)」');
    try { fs.rmSync(root2, { recursive: true, force: true }); } catch (_) {}
  }

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试自身异常: ' + (e && e.stack || e));
  process.exit(2);
});
