'use strict';
/*
 * test-automations-guard.js —— 「读失败折成空集合 ⇒ 静默清空全部自动化任务」的回归测试（v1.4.1）。
 *
 * 缺陷（2026-09-19 代码审查**唯一 P0**）：
 *   automation.js 的 readAutomations 用 `catch (_) { return []; }` 把所有读取失败
 *   （Windows 上杀软实时扫描 / 备份软件 / 编辑器占用文件抛的 EBUSY / EPERM —— 瞬时且可恢复）
 *   一律折成「没有任何任务」。而它下游 8 个调用点里 5 个是「读 → 改 → 写」：
 *     daemon.js:11484 / 11741、automation.js:323 / 779、automation-transfer.js:75
 *   ⇒ 一次瞬时读失败 + 用户任意一次写操作 = **全部自动化任务永久消失**，
 *   无 .bak、无轮转、无回滚 API，且**完全静默**。
 *   现有 `if (tasks.length >= 200) throw` 之类的「数量上限」守卫在 length===0 时必然通过，
 *   拦的是「太多」不是「太少」—— 恰好放行了唯一会毁数据的路径。
 *
 * 修法（两块，缺一不可）：
 *   ① automation.js：readAutomations 只在 ENOENT 时返回 []，其余一律抛错；
 *      JSON 解析失败也抛错（不再把损坏当成空）。
 *   ② automation.js：writeAutomations 增加**独立**守卫 —— 磁盘上条目数 ≥ 3
 *      （或「文件在、但读不出来」）而本次要写 0 条时拒绝，除非调用方显式声明删除
 *      （`{ allowEmpty: true }`，只有 daemon 的批量删除分支会传）。
 *
 * 配套（daemon.js，否则等于把「静默丢数据」换成「崩溃重启」）：
 *   · 纯读取路径（事件分发 / 恢复导航 / 1 秒一拍）改用 readAutomationsTolerant()，
 *     读失败降级为「本次跳过」并用 null 与「确实没有任务」区分；
 *   · handleApi 加路由级兜底：http 回调里同步抛出的异常原本会走到
 *     process.on('uncaughtException')，那个 handler 会在 5.5 秒后 **退出 daemon**。
 *
 * 四段：
 *   【A】readAutomations 的「确实为空」vs「读失败」（真实模块 + 临时目录 + 注入 fs 故障）10 项
 *   【B】writeAutomations 的骤减守卫（真跑，逐条核对磁盘结果）                        10 项
 *   【C】内置标记文件读失败不得把内置任务永久划成「用户自有」                          8 项
 *   【D】daemon.js / automation-transfer.js 的接线（源码断言，防回退）                10 项
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const auto = require(path.join(ROOT, 'scripts', 'automation.js'));

let pass = 0;
const failures = [];
function check(ok, name) {
  if (ok) { pass++; return; }
  failures.push(name);
}
function threw(fn) {
  try { fn(); return null; } catch (e) { return e; }
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wd-auto-guard-')); }
function storeOf(dir) { return path.join(dir, 'automations.json'); }
function writeRaw(dir, text) { fs.writeFileSync(storeOf(dir), text, 'utf8'); }
function taskOf(id) { return { id, name: 'task-' + id, schemaVersion: 2, trigger: { type: 'manual' }, schedule: { type: 'manual' }, steps: [{ op: 'logic.delay', ms: 1 }] }; }
function tasksFileOf(dir) { return JSON.parse(fs.readFileSync(storeOf(dir), 'utf8')); }

/** 只在读 automations.json 时注入指定 errno 故障 */
function withReadFailure(code, fn) {
  const original = fs.readFileSync;
  fs.readFileSync = function patched(target, ...rest) {
    if (typeof target === 'string' && /automations\.json$/.test(target)) {
      const error = new Error('injected ' + code);
      error.code = code;
      throw error;
    }
    return original.call(fs, target, ...rest);
  };
  try { return fn(); } finally { fs.readFileSync = original; }
}

const BUILTIN = path.join(ROOT, 'scripts', 'builtin', 'automations', 'rate-limit-auto-switch.json');
const BUILTIN_ID = 'mu0mg334-rate-limit-auto-switch';

function main() {
  /* ================= A 段：readAutomations —— 「确实为空」vs「读失败」 ================= */
  {
    const dir = tmpDir();
    // A1 文件确实不存在（ENOENT）→ 空集合，不抛
    check(Array.isArray(auto.readAutomations(dir)) && auto.readAutomations(dir).length === 0,
      'A1 目录里没有 automations.json（ENOENT）时返回空集合且不抛错');

    // A2 正常文件
    writeRaw(dir, JSON.stringify([taskOf('a'), taskOf('b')]));
    check(auto.readAutomations(dir).length === 2, 'A2 合法文件解析出 2 条');

    // A3 `{items:[...]}` 形态保持原行为
    writeRaw(dir, JSON.stringify({ items: [taskOf('a')] }));
    check(auto.readAutomations(dir).length === 1, 'A3 {items:[...]} 形态仍能解析');

    // A4/A5 内容损坏 → 抛错（不是当成空集合）
    writeRaw(dir, '{ "items": [');
    const corrupted = threw(() => auto.readAutomations(dir));
    check(!!corrupted, 'A4 内容损坏（非法 JSON）时抛错，而不是返回 []');
    check(!!corrupted && /损坏/.test(corrupted.message), 'A5 损坏时的错误消息可读（含「损坏」）');

    // A6/A7 读失败（EBUSY）→ 抛错，且消息带 errno
    writeRaw(dir, JSON.stringify([taskOf('a'), taskOf('b'), taskOf('c')]));
    const busy = withReadFailure('EBUSY', () => threw(() => auto.readAutomations(dir)));
    check(!!busy, 'A6 readFileSync 抛 EBUSY 时抛错（**这是本 P0 的核心断言**：绝不能折成 []）');
    check(!!busy && /EBUSY/.test(busy.message), 'A7 EBUSY 的错误消息带上了 errno，便于定位');

    // A8 EPERM 同源
    check(!!withReadFailure('EPERM', () => threw(() => auto.readAutomations(dir))), 'A8 EPERM 同样抛错');

    // A9 文件是目录（EISDIR）也算读失败
    const dirAsFile = tmpDir();
    fs.mkdirSync(storeOf(dirAsFile));
    check(!!threw(() => auto.readAutomations(dirAsFile)), 'A9 automations.json 是目录（EISDIR）时抛错');

    // A10 读失败没有副作用：磁盘上那 3 条原样还在
    check(fs.readFileSync(storeOf(dir), 'utf8') === JSON.stringify([taskOf('a'), taskOf('b'), taskOf('c')]),
      'A10 读失败不产生任何副作用（磁盘内容未被改动）');
  }

  /* ================= B 段：writeAutomations 的骤减守卫 ================= */
  {
    // B1/B2/B3 磁盘 3 条、写空、未声明删除 → 拒绝，且磁盘没被清空
    const dir = tmpDir();
    writeRaw(dir, JSON.stringify([taskOf('a'), taskOf('b'), taskOf('c')]));
    const rejected = threw(() => auto.writeAutomations(dir, []));
    check(!!rejected, 'B1 磁盘 3 条时写入空数组被拒绝（不声明删除）');
    check(!!rejected && /拒绝写入/.test(rejected.message), 'B2 拒绝时的错误消息可读（含「拒绝写入」）');
    check(tasksFileOf(dir).length === 3, 'B3 被拒绝后磁盘上仍是 3 条（数据未丢）');

    // B4 低于阈值不误伤：磁盘 2 条 + 写空 → 允许
    const dir2 = tmpDir();
    writeRaw(dir2, JSON.stringify([taskOf('a'), taskOf('b')]));
    check(!threw(() => auto.writeAutomations(dir2, [])) && tasksFileOf(dir2).length === 0,
      'B4 磁盘 2 条（< 阈值 3）写空被放行 —— 守卫不误伤正常的小集合');

    // B5 显式声明删除 → 放行
    const dir3 = tmpDir();
    writeRaw(dir3, JSON.stringify([taskOf('a'), taskOf('b'), taskOf('c')]));
    check(!threw(() => auto.writeAutomations(dir3, [], { allowEmpty: true })) && tasksFileOf(dir3).length === 0,
      'B5 显式声明删除（allowEmpty:true）时放行清空');

    // B6 文件在、但读不出来（previous===null）→ 同样拒绝写空
    const dir4 = tmpDir();
    writeRaw(dir4, '{ "broken"');
    check(!!threw(() => auto.writeAutomations(dir4, [])),
      'B6 文件存在但读不出来（previous===null）时拒绝写空 —— 未知条数不等于 0 条');

    // B7 首次部署（文件不存在）+ 写空 → 允许
    const dir5 = tmpDir();
    check(!threw(() => auto.writeAutomations(dir5, [])), 'B7 文件不存在时写空被放行（首次部署不误伤）');

    // B8 写非空列表不受守卫影响
    const dir6 = tmpDir();
    writeRaw(dir6, JSON.stringify([taskOf('a'), taskOf('b'), taskOf('c')]));
    check(!threw(() => auto.writeAutomations(dir6, [taskOf('a'), taskOf('b'), taskOf('c'), taskOf('d')])) &&
      tasksFileOf(dir6).length === 4, 'B8 写入非空列表不受守卫影响');

    // B9 双层防御：即使某调用点仍把 EBUSY 当成空集合，写回这一层也必须拦住
    const dir7 = tmpDir();
    writeRaw(dir7, JSON.stringify([taskOf('a'), taskOf('b'), taskOf('c')]));
    const blocked = withReadFailure('EBUSY', () => threw(() => auto.writeAutomations(dir7, [])));
    check(!!blocked && tasksFileOf(dir7).length === 3,
      'B9 对照：读 EBUSY + 写空 → 被写侧守卫拦住，磁盘仍是 3 条（双层防御）');

    // B10 拒绝路径不留 .tmp 残骸
    check(fs.readdirSync(dir).filter((n) => /\.tmp-/.test(n)).length === 0,
      'B10 被拒绝时不留 .tmp-<pid> 临时文件');
  }

  /* ================= C 段：内置标记（markers）读失败 ================= */
  {
    check(fs.existsSync(BUILTIN), 'C0 内置任务定义存在：scripts/builtin/automations/rate-limit-auto-switch.json');
    const markerOf = (dir) => path.join(dir, 'automation-builtins.json');
    const CORRUPT = '{ "mu0mg334": ';

    // C1/C2 markers 文件不存在（ENOENT）→ 正常安装，行为不变
    const dir = tmpDir();
    const installed = auto.installBuiltinTask(dir, BUILTIN);
    check(installed && installed.status === 'installed', 'C1 markers 文件不存在时正常安装（ENOENT 仍等价于「还没有标记」）');
    const markerAfterInstall = JSON.parse(fs.readFileSync(markerOf(dir), 'utf8'));
    check(markerAfterInstall[BUILTIN_ID] && markerAfterInstall[BUILTIN_ID].managed === true,
      'C2 安装后写下的标记是 managed:true');

    // C3/C4/C5 markers 损坏 → 跳过，且什么都不写
    const dir2 = tmpDir();
    fs.writeFileSync(markerOf(dir2), CORRUPT, 'utf8');
    const skipped = auto.installBuiltinTask(dir2, BUILTIN);
    check(skipped && skipped.status === 'skipped', 'C3 markers 内容损坏时跳过（不再当成「没有标记」）');
    check(!fs.existsSync(storeOf(dir2)), 'C4 C3 之后没有写入 automations.json（任务集合未被改动）');
    check(fs.readFileSync(markerOf(dir2), 'utf8') === CORRUPT, 'C5 C3 之后标记文件原样保留（没被覆盖）');

    // C6/C7 任务已存在 + markers 损坏 → 绝不能写 managed:false
    const dir3 = tmpDir();
    writeRaw(dir3, JSON.stringify([{ id: BUILTIN_ID, name: '内置任务', schemaVersion: 2, trigger: { type: 'manual' }, schedule: { type: 'manual' }, steps: [] }]));
    const before = fs.readFileSync(storeOf(dir3), 'utf8');
    fs.writeFileSync(markerOf(dir3), CORRUPT, 'utf8');
    const skipped2 = auto.installBuiltinTask(dir3, BUILTIN);
    check(skipped2 && skipped2.status === 'skipped' && fs.readFileSync(markerOf(dir3), 'utf8') === CORRUPT,
      'C6 任务已存在 + markers 损坏时跳过，绝不写 managed:false（否则该任务永久失去内置升级）');
    check(fs.readFileSync(storeOf(dir3), 'utf8') === before, 'C7 C6 之后任务集合原样未动');

    // C8 adoptBuiltinTask 同样不认领、不重写标记
    const dir4 = tmpDir();
    writeRaw(dir4, JSON.stringify([{ id: BUILTIN_ID, name: '内置任务', schemaVersion: 2, trigger: { type: 'manual' }, schedule: { type: 'manual' }, steps: [] }]));
    fs.writeFileSync(markerOf(dir4), CORRUPT, 'utf8');
    const adopted = threw(() => auto.adoptBuiltinTask(dir4, BUILTIN));
    const adoptResult = adopted || auto.adoptBuiltinTask(dir4, BUILTIN);
    check((!adopted && adoptResult && adoptResult.status === 'skipped') && fs.readFileSync(markerOf(dir4), 'utf8') === CORRUPT,
      'C8 adoptBuiltinTask 在 markers 损坏时跳过，不重写标记文件');
  }

  /* ================= D 段：daemon.js / automation-transfer.js 接线 ================= */
  {
    const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
    const assignSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'automation.js'), 'utf8');
    const transferSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'automation-transfer.js'), 'utf8');

    check(/function readAutomationsTolerant\(reason\)\s*\{[\s\S]{0,800}?return null;/.test(daemonSrc),
      'D1 daemon.js 定义了 readAutomationsTolerant，读失败返回 null（与「确实没有任务」区分）');
    check((daemonSrc.match(/readAutomationsTolerant\(/g) || []).length >= 4,
      'D2 daemon.js 至少 4 处使用容错读（定义处 + 事件分发 + 恢复导航 + 定时调度）');

    // 三个纯读取位置必须用容错读，且不再出现裸调用
    const sliceFn = (name, len) => {
      const at = daemonSrc.indexOf('function ' + name);
      return at < 0 ? '' : daemonSrc.slice(at, at + len);
    };
    const dispatchBody = sliceFn('dispatchAutomationEvent', 2600);
    const resumeBody = sliceFn('resumeAutomationAfterNavigation', 700);
    const scheduleBody = sliceFn('runAutomationSchedules', 700);
    check(/readAutomationsTolerant\(/.test(dispatchBody) && !/readAutomations\(DATA_DIR\)/.test(dispatchBody),
      'D3 事件分发（CDP 事件链）用容错读，不再裸调 readAutomations');
    check(/readAutomationsTolerant\(/.test(resumeBody) && !/readAutomations\(DATA_DIR\)/.test(resumeBody),
      'D4 恢复导航（在 finally 里）用容错读，不再裸调 readAutomations');
    check(/readAutomationsTolerant\(/.test(scheduleBody) && !/readAutomations\(DATA_DIR\)/.test(scheduleBody),
      'D5 1 秒一拍的定时调度用容错读，不再裸调 readAutomations');

    check(/writeAutomations\(DATA_DIR, tasks\.filter\([\s\S]{0,120}?\{ allowEmpty: true \}\)/.test(daemonSrc),
      'D6 批量删除分支显式声明 allowEmpty（唯一允许清空的入口）');

    check(/function handleApiRoute\(req, res\) \{/.test(daemonSrc) && /function handleApi\(req, res\) \{/.test(daemonSrc),
      'D7 handleApi 拆成「路由主体 handleApiRoute + 兜底壳 handleApi」');
    check(/const pending = handleApiRoute\(req, res\);[\s\S]{0,300}?pending\.catch\(failure\)/.test(daemonSrc) &&
      /Number\(error && error\.statusCode\) \|\| 500/.test(daemonSrc) &&
      /json\(res, status, \{ ok: false, error: message \}\)/.test(daemonSrc),
      'D8 兜底壳同时覆盖同步抛错与 Promise 拒绝，并按 error.statusCode 折成 400/413/500');
    check(/return handleApi\(req, res\)/.test(daemonSrc) && !/return handleApiRoute\(req, res\)/.test(daemonSrc),
      'D9 http 回调只调兜底壳 handleApi，路由主体不再被直接调用');

    check(/WIPE_GUARD_MIN = 3/.test(assignSrc) && /allowEmpty/.test(assignSrc) &&
      /e\.code === 'ENOENT'|error\.code === 'ENOENT'/.test(assignSrc),
      'D10 automation.js 三条修复都在位（阈值常量 / allowEmpty / ENOENT 例外）');
    check(!/catch \(_\) \{ return \[\]; \}/.test(assignSrc),
      'D11 automation.js 里不再有 `catch (_) { return []; }` 这种宽容读');
    // 体积文案两条线各自与实际阈值对齐：
    //   · readTransferBody 自身的阈值是 12 MiB → 文案必须写 12 MiB（原写 8 MiB，见审查报告 P2 第 6 项）
    //   · readFiles 受 automation-zip 的 MAX_BYTES = 8 MiB 约束 → 文案保持 8 MiB（改动它反而错）
    const bodyReader = (() => {
      const at = transferSrc.indexOf('function readTransferBody');
      return at < 0 ? '' : transferSrc.slice(at, at + 900);
    })();
    const zipSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'automation-zip.js'), 'utf8');
    check(/12 \* 1024 \* 1024/.test(bodyReader) && /任务文件不能超过 12 MiB/.test(bodyReader) &&
      /MAX_BYTES = 8 \* 1024 \* 1024/.test(zipSrc) &&
      (transferSrc.match(/任务文件不能超过 8 MiB/g) || []).length === 2,
      'D12 体积文案与实际阈值对齐：readTransferBody 12 MiB（自身阈值）/ readFiles 8 MiB（= MAX_BYTES）');
  }

  console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
}
