'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ALLOWED_WORKBUDDY_PROCESS_NAMES = new Set([
  'workbuddy.exe',
  'workbuddyai.exe',
  'codebuddy.exe',
  // CodeBuddy CN 实机主程序名带空格（安装在 D 盘 CodeBuddy CN 目录）
  'codebuddy cn.exe',
]);

function detectWindowsPrivilege(run = spawnSync) {
  const command = "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
  let result;
  try {
    result = run('powershell', ['-NoProfile', '-Command', command], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    });
  } catch (error) {
    throw new Error(`无法确认 Windows 进程权限: ${error.message}`);
  }
  if (!result || result.error) {
    throw (result && result.error) || new Error('无法确认 Windows 进程权限');
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim();
    throw new Error(`无法确认 Windows 进程权限${detail ? ': ' + detail : ''}`);
  }
  const value = String(result.stdout || '').trim().toLowerCase();
  if (value === 'false') return 'standard';
  if (value === 'true') return 'elevated';
  throw new Error('无法确认 Windows 进程是否为普通用户权限');
}

// Native children inherit the real Windows token. Ask the installed helper to
// verify it (including saved consent for elevated sessions), never an env flag.
function detectNativeWindowsPrivilege(appDir, profile, run = spawnSync) {
  const result = run(path.join(appDir, 'WorkDaddyLauncher.exe'), [
    '--launch-context', '--profile', profile, '--app-dir', appDir,
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (!result || result.error || result.status !== 0) {
    throw new Error('无法验证 Windows 启动权限或兼容安装授权，请重新运行安装程序');
  }
  let context;
  try { context = JSON.parse(result.stdout); } catch (_) {
    throw new Error('Windows 启动权限检测返回无效数据');
  }
  if (!context || !['standard', 'elevated'].includes(context.privilege)) {
    throw new Error('Windows 启动权限或客户端身份不匹配');
  }
  if (context.profile !== profile) {
    // ⚠️ 2026-10-20（CodeBuddy profile）：原生 launcher 往往只认有限几个 profile
    //   （本机 WorkDaddyLauncher.exe 只认 workbuddy-cn），它回报的 profile 是
    //   「我自己是谁」而不是「请求的是谁」—— 对它**不认识**的 profile 直接判身份冲突，
    //   会让 codebuddy-cn 永远起不来（launcher exit 5，实测已复现）。
    //   privilege=standard 可以采信（纯本地权限判定，与 profile 无关）；
    //   elevated 的授权记录是按 profile 存的，跨 profile 不可采信 ⇒ 仍拒绝。
    if (context.privilege !== 'standard') {
      throw new Error('Windows 启动权限或客户端身份不匹配');
    }
    return 'standard';
  }
  return context.privilege;
}

function assertStandardWindowsPrivilege(run = spawnSync) {
  const privilege = detectWindowsPrivilege(run);
  if (privilege !== 'standard') throw new Error('拒绝以管理员或 elevated 权限运行 WorkDaddy');
  return privilege;
}

function validateProcessRecord(row, options = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('CIM process query returned an invalid process record');
  }
  const pid = row.ProcessId;
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('CIM process record has an invalid PID');
  const name = typeof row.Name === 'string' ? row.Name.trim() : '';
  if (!name) throw new Error(`CIM process record ${pid} has no Name`);
  const executable = typeof row.ExecutablePath === 'string' ? row.ExecutablePath.trim() : '';
  if (!executable || !path.win32.isAbsolute(executable)) {
    throw new Error(`CIM process record ${pid} has no absolute executable path`);
  }
  if (options.requireCommandLine && (typeof row.CommandLine !== 'string' || !row.CommandLine.trim())) {
    throw new Error(`CIM process record ${pid} has no command line`);
  }
  let nativeArguments;
  if (options.requireNativeArguments) {
    if (row.ArgumentsSource !== 'CommandLineToArgvW' || !Array.isArray(row.Arguments) || !row.Arguments.length) {
      throw new Error(`CIM process record ${pid} has no trusted native Arguments`);
    }
    if (row.Arguments.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
      throw new Error(`CIM process record ${pid} has invalid native Arguments`);
    }
    nativeArguments = [...row.Arguments];
  }
  const owner = typeof row.Owner === 'string' ? row.Owner.trim() : '';
  if (options.requireCurrentOwner) {
    if (!owner) throw new Error(`CIM process record ${pid} has no owner`);
    if (row.OwnerIsCurrent !== true) {
      throw new Error(`CIM process record ${pid} is not owned by the current user`);
    }
  }
  return {
    ...row,
    ProcessId: pid,
    Name: name,
    ExecutablePath: executable,
    ...(owner ? { Owner: owner } : {}),
    ...(nativeArguments ? { Arguments: nativeArguments } : {}),
  };
}

function parseCimProcessResult(result, options = {}) {
  if (!result || result.error) {
    throw (result && result.error) || new Error('CIM process query did not return a result');
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim();
    if (options.allowTransientNotFound && /(0x80041002|ObjectNotFound|not found)/i.test(detail)) return [];
    throw new Error(`CIM process query exited with status ${result.status}${detail ? ': ' + detail : ''}`);
  }
  const output = String(result.stdout || '').trim();
  if (!output) return [];
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`CIM process query returned invalid JSON: ${error.message}`);
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => validateProcessRecord(row, options));
}

function resolveWindowsExecutable(value, realpath = fs.realpathSync.native) {
  const candidate = String(value || '').trim();
  if (!candidate || !path.win32.isAbsolute(candidate)) {
    throw new Error('Windows executable path must be absolute');
  }
  const resolved = String(realpath(candidate) || '').trim();
  if (!resolved || !path.win32.isAbsolute(resolved)) {
    throw new Error('Windows executable path could not be resolved');
  }
  return path.win32.normalize(resolved);
}

function sameWindowsPath(a, b) {
  return path.win32.normalize(String(a)).replace(/[\\/]+$/, '').toLowerCase() ===
    path.win32.normalize(String(b)).replace(/[\\/]+$/, '').toLowerCase();
}

function resolveWindowsCommandToken(value, realpath = fs.realpathSync.native) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error('Windows command token path contains leading, trailing, or control whitespace');
  }
  return resolveWindowsExecutable(value, realpath);
}

function buildNativeProcessQuery(helperPath, processSource) {
  const helper = String(helperPath || '');
  const source = String(processSource || '');
  if (!path.win32.isAbsolute(helper) || /[\r\n\0]/.test(helper) || !source.trim()) {
    throw new Error('Native process query requires a trusted absolute helper and source');
  }
  const quotedHelper = helper.replace(/'/g, "''");
  return `. '${quotedHelper}'; ${source} | ForEach-Object { ConvertTo-WorkDaddyProcessRecordIfPresent -Process $_ } | Where-Object { $null -ne $_ } | ConvertTo-Json -Compress -Depth 4`;
}

function sameWindowsFilePath(a, b) {
  return path.win32.normalize(String(a)).toLowerCase() ===
    path.win32.normalize(String(b)).toLowerCase();
}

function assertSameProcessIdentity(original, current) {
  const requirements = { requireCommandLine: true, requireCurrentOwner: true, requireNativeArguments: true };
  const before = validateProcessRecord(original, requirements);
  const after = validateProcessRecord(current, requirements);
  if (before.ProcessId !== after.ProcessId ||
      before.Name.toLowerCase() !== after.Name.toLowerCase() ||
      !sameWindowsPath(before.ExecutablePath, after.ExecutablePath) ||
      before.CommandLine !== after.CommandLine ||
      before.Arguments.length !== after.Arguments.length ||
      before.Arguments.some((argument, index) => argument !== after.Arguments[index]) ||
      before.Owner.toLowerCase() !== after.Owner.toLowerCase()) {
    throw new Error(`Process identity or owner changed before termination for PID ${before.ProcessId}`);
  }
  return after;
}

function filterVerifiedWindowsProcesses(expectedBinary, processes, realpath = fs.realpathSync.native, allowedProcessNames = null) {
  const expected = resolveWindowsExecutable(expectedBinary, realpath);
  const expectedDir = path.win32.dirname(expected);
  const expectedName = path.win32.basename(expected).toLowerCase();
  const allowedNames = allowedProcessNames
    ? new Set(Array.from(allowedProcessNames, (name) => String(name).toLowerCase()))
    : new Set([expectedName]);
  if (!allowedNames.has(expectedName) || Array.from(allowedNames).some((name) => !/^[^\\/:*?"<>|\0]+\.exe$/i.test(name)) ||
      (!allowedProcessNames && !ALLOWED_WORKBUDDY_PROCESS_NAMES.has(expectedName))) {
    throw new Error('Expected executable is not a WorkBuddy-family binary');
  }
  const verified = [];
  for (const item of Array.isArray(processes) ? processes : []) {
    const process = validateProcessRecord(item);
    const name = process.Name.toLowerCase();
    if (!allowedNames.has(name)) continue;
    let executable;
    try {
      executable = resolveWindowsExecutable(process.ExecutablePath, realpath);
    } catch (error) {
      // A process can disappear between CIM enumeration and realpath.
      if (error && error.code === 'ENOENT') continue;
      throw new Error(`Cannot verify executable path for PID ${process.ProcessId}`);
    }
    if (path.win32.basename(executable).toLowerCase() !== name) {
      throw new Error(`Executable name does not match CIM Name for PID ${process.ProcessId}`);
    }
    if (!sameWindowsPath(path.win32.dirname(executable), expectedDir)) continue;
    verified.push({ ...process, ExecutablePath: executable });
  }
  return verified;
}

function selectVerifiedProcessPids(expectedBinary, processes, realpath = fs.realpathSync.native) {
  return filterVerifiedWindowsProcesses(expectedBinary, processes, realpath)
    .map((process) => process.ProcessId);
}

function selectRunningProfileBinary(profileNames, processes, realpath = fs.realpathSync.native) {
  const names = profileNames instanceof Set ? profileNames : new Set(profileNames || []);
  const binaries = new Map();
  for (const item of Array.isArray(processes) ? processes : []) {
    const process = validateProcessRecord(item);
    const name = process.Name.toLowerCase();
    if (!names.has(name)) continue;
    let executable;
    try { executable = resolveWindowsExecutable(process.ExecutablePath, realpath); } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (path.win32.basename(executable).toLowerCase() !== name) {
      throw new Error(`Executable name does not match CIM Name for PID ${process.ProcessId}`);
    }
    binaries.set(executable.toLowerCase(), executable);
  }
  if (binaries.size > 1) throw new Error('检测到当前 profile 在多个安装目录运行，无法安全选择目标');
  return binaries.size ? Array.from(binaries.values())[0] : null;
}

function selectUniqueDiscoveredBinary(profileNames, candidates, realpath = fs.realpathSync.native) {
  const names = profileNames instanceof Set ? profileNames : new Set(profileNames || []);
  const binaries = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    let executable;
    try { executable = resolveWindowsExecutable(candidate, realpath); } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!names.has(path.win32.basename(executable).toLowerCase())) continue;
    binaries.set(executable.toLowerCase(), executable);
  }
  if (binaries.size > 1) {
    throw new Error('检测到当前 profile 的多个安装目录；请用 WBSWITCH_WORKBUDDY_BIN 明确指定目标');
  }
  return binaries.size ? Array.from(binaries.values())[0] : null;
}

// Discovery order is a priority order in the callers: explicit profile path,
// registry entries, conventional installs, then bounded scans. Dormant copies
// should not make startup fail when the first valid candidate is unambiguous.
function selectPreferredDiscoveredBinary(profileNames, candidates, realpath = fs.realpathSync.native) {
  const names = profileNames instanceof Set ? profileNames : new Set(profileNames || []);
  const seen = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    let executable;
    try { executable = resolveWindowsExecutable(candidate, realpath); } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!names.has(path.win32.basename(executable).toLowerCase())) continue;
    const key = executable.toLowerCase();
    if (!seen.has(key)) seen.set(key, executable);
  }
  return seen.size ? Array.from(seen.values())[0] : null;
}

function filterVerifiedNodeProcesses(expectedNode, expectedScript, processes, realpath = fs.realpathSync.native) {
  let node;
  let script;
  try {
    node = resolveWindowsExecutable(expectedNode, realpath);
    script = resolveWindowsExecutable(expectedScript, realpath);
  } catch (error) {
    // Stale installs and in-flight updates can remove the expected runtime or
    // script after discovery. There is no verified process to return then.
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const verified = [];
  for (const item of Array.isArray(processes) ? processes : []) {
    const process = validateProcessRecord(item, { requireCommandLine: true, requireNativeArguments: true });
    if (process.Name.toLowerCase() !== 'node.exe') continue;
    let executable;
    try { executable = resolveWindowsExecutable(process.ExecutablePath, realpath); } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!sameWindowsFilePath(executable, node)) continue;
    const args = process.Arguments;
    let entryIndex = 1;
    let commandNodeMatches = false;
    try {
      commandNodeMatches = args.length > 0 && path.win32.isAbsolute(args[0]) &&
        sameWindowsFilePath(resolveWindowsCommandToken(args[0], realpath), node);
    } catch (_) {}
    if (!commandNodeMatches) continue;
    if (args[entryIndex] === '--experimental-sqlite') entryIndex++;
    // ⭐ 2026-10-20（多 profile 并存）：daemon/watchdog 的命令行带 `--profile=<id>`，
    //   用来在进程枚举里区分实例（环境变量枚举不到，脚本名又是各 profile 共用的）。
    //   它必须排在脚本路径**之前** —— 下面 `args.length === entryIndex + 1`
    //   要求脚本名后不能再有参数，否则进程身份验证会永远失败。
    // 兼容历史写法（排在脚本前）；新写法排在脚本后，下面 trailingOk 一起认。
    if (typeof args[entryIndex] === 'string' && args[entryIndex].startsWith('--profile=')) entryIndex++;
    const entry = args[entryIndex];
    let scriptMatch = false;
    if (entry && path.win32.isAbsolute(entry)) {
      try { scriptMatch = sameWindowsFilePath(resolveWindowsCommandToken(entry, realpath), script); } catch (_) {}
    }
    // ⚠️ 2026-10-20 放宽：`--profile=<id>` 现在排在脚本路径**之后**（排在前面会被 Node
    //   当成自己的选项 ⇒ bad option ⇒ exit 9）。尾部只允许 `--profile=` 形式的参数，
    //   其余仍然严格拒绝，进程身份校验强度不变。
    const trailing = args.slice(entryIndex + 1);
    const trailingOk = trailing.length === 0 ||
      trailing.every((arg) => typeof arg === 'string' && /^--profile=[A-Za-z0-9._-]+$/.test(arg));
    if (scriptMatch && trailingOk) {
      verified.push({ ...process, ExecutablePath: executable });
    }
  }
  return verified;
}

function assertVerifiedNodeProcess(pid, expectedNode, expectedScript, processes, realpath = fs.realpathSync.native) {
  const numericPid = Number(pid);
  if (!Number.isSafeInteger(numericPid) || numericPid <= 0) throw new Error('Invalid process PID');
  const match = filterVerifiedNodeProcesses(expectedNode, expectedScript, processes, realpath)
    .find((process) => process.ProcessId === numericPid);
  if (!match) throw new Error(`Cannot verify node process identity for PID ${numericPid}`);
  return match;
}

function assertDaemonTerminationIdentity(options) {
  const status = options && options.status;
  if (!status || typeof status !== 'object') throw new Error('daemon status is missing');
  const profileId = status.profile && status.profile.id;
  if (profileId !== options.expectedProfileId) throw new Error('daemon profile mismatch');
  if (status.privilege !== 'standard' && status.privilege !== 'elevated') {
    throw new Error('daemon privilege is invalid');
  }
  if (options.expectedPrivilege && status.privilege !== options.expectedPrivilege) {
    throw new Error(`daemon privilege mismatch: expected ${options.expectedPrivilege}, got ${status.privilege}`);
  }
  const pid = status.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('daemon status PID is invalid');
  const listenerPids = Array.from(new Set((options.listenerPids || []).map(Number)));
  if (listenerPids.length !== 1 || listenerPids[0] !== pid) {
    throw new Error('daemon listener PID does not match status PID');
  }
  return assertVerifiedNodeProcess(
    pid, options.expectedNode, options.expectedScript, options.nodeProcesses, options.realpath
  );
}

function assertDaemonServiceIdentity(options) {
  const process = assertDaemonTerminationIdentity(options);
  const status = options.status;
  if (status.version !== options.expectedVersion) throw new Error('daemon version mismatch');
  if (status.buildId !== options.expectedBuildId) throw new Error('daemon buildId mismatch');
  return process;
}

// A standard process cannot read ExecutablePath/CommandLine for an elevated
// Node process. Reuse (never termination) may instead rely on the per-profile
// API capability token: authenticated /api/status exposes dataDir, which is
// omitted from public status responses. Bind that proof to the exact listener.
function assertAuthenticatedDaemonCapability(options) {
  const status = options && options.status;
  if (!status || typeof status !== 'object' || status.ok !== true) {
    throw new Error('authenticated daemon status is missing');
  }
  if (!status.profile || status.profile.id !== options.expectedProfileId) {
    throw new Error('authenticated daemon profile mismatch');
  }
  if (!options.allowVersionMismatch && status.version !== options.expectedVersion) {
    throw new Error('authenticated daemon version mismatch');
  }
  if (status.privilege !== 'elevated') {
    throw new Error('authenticated daemon is not elevated');
  }
  const pid = status.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('authenticated daemon PID is invalid');
  }
  const listenerPids = Array.from(new Set((options.listenerPids || []).map(Number)));
  if (listenerPids.length !== 1 || listenerPids[0] !== pid) {
    throw new Error('authenticated daemon listener PID does not match status PID');
  }
  if (typeof status.dataDir !== 'string' || !status.dataDir.trim() ||
      !sameWindowsPath(status.dataDir, options.expectedDataDir)) {
    throw new Error('authenticated daemon data directory mismatch');
  }
  return status;
}

module.exports = {
  ALLOWED_WORKBUDDY_PROCESS_NAMES,
  assertAuthenticatedDaemonCapability,
  assertDaemonServiceIdentity,
  assertDaemonTerminationIdentity,
  assertSameProcessIdentity,
  detectWindowsPrivilege,
  detectNativeWindowsPrivilege,
  assertStandardWindowsPrivilege,
  assertVerifiedNodeProcess,
  buildNativeProcessQuery,
  filterVerifiedNodeProcesses,
  filterVerifiedWindowsProcesses,
  parseCimProcessResult,
  resolveWindowsExecutable,
  sameWindowsPath,
  selectRunningProfileBinary,
  selectPreferredDiscoveredBinary,
  selectUniqueDiscoveredBinary,
  selectVerifiedProcessPids,
};
