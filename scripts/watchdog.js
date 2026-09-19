#!/usr/bin/env node
/**
 * WorkDaddy Windows watchdog.
 *
 * The loopback lock belongs to the OS and disappears automatically when this
 * process exits. watchdog.pid is only a hint for the native install helper;
 * it is never trusted on its own for process termination.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { getProfile, profileDataDir } = require('./profiles.js');

const PROFILE_ID = process.env.WBSWITCH_PROFILE || 'workbuddy-cn';
const PROFILE = getProfile(PROFILE_ID);
const DATA_DIR = process.env.WBSWITCH_DATA_DIR || profileDataDir(PROFILE);
const PID_FILE = path.join(DATA_DIR, 'watchdog.pid');
const LOG_FILE = path.join(DATA_DIR, 'watchdog.log');
const DAEMON_FILE = path.join(__dirname, 'daemon.js');
const LOCK_PORT = PROFILE.id === 'workbuddy-ai' ? 47933 : 47932;

let child = null;
let stopping = false;

const BACKOFF_START_MS = 3000;
const BACKOFF_MAX_MS = 60000;
// 连续这么多次「没活过 BACKOFF_MAX_MS」就熔断（只拉长间隔，不放弃）
const BREAKER_AFTER = 10;
const BREAKER_PROBE_MS = 10 * 60 * 1000;

/**
 * 重启退避状态机。
 *
 * ⚠️ 这里曾是 P1 缺陷（2026-09-19 审查 §9-4）：旧写法在每次 startDaemon() 里都挂一个
 * `setTimeout(() => { restartDelay = 3000 }, 60000)`，秒崩场景下 60s 内会累积多个复位定时器，
 * 退避永远到不了 60s 封顶（实测退出间隔 3000,6000,12000,24000,48000,3000,…）。
 * 正确判据是「上一次启动**存活超过** BACKOFF_MAX_MS」才算一次成功启动，据此复位。
 * 另外补断路器：连续快速退出到阈值后拉长到 BREAKER_PROBE_MS，避免长期崩溃风暴反复拉起；
 * 一旦有一次存活超阈值就整体复位 —— 不永久放弃（插件静默死亡比慢重试糟得多）。
 */
function createRestartBackoff() {
  let delay = BACKOFF_START_MS;
  let rapidExits = 0;
  return {
    /** 子进程刚 spawn：只记下启动时刻，**不设任何复位定时器** */
    onStarted(now) { return Number.isFinite(now) ? now : Date.now(); },
    /** 子进程退出：返回下一次该等多久 */
    onExit(startedAt, now) {
      const at = Number.isFinite(now) ? now : Date.now();
      const survived = at - (Number.isFinite(startedAt) ? startedAt : at);
      if (survived > BACKOFF_MAX_MS) { delay = BACKOFF_START_MS; rapidExits = 0; }
      else rapidExits++;
      const tripped = rapidExits >= BREAKER_AFTER;
      const wait = tripped ? BREAKER_PROBE_MS : delay;
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      return { wait, survived, rapidExits, tripped };
    },
    get state() { return { delay, rapidExits }; },
  };
}
const restartBackoff = createRestartBackoff();

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
  try { process.stdout.write(line); } catch (_) {}
}

function writePidFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = PID_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(temporary, String(process.pid), 'utf8');
  try {
    fs.renameSync(temporary, PID_FILE);
  } catch (_) {
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
    fs.renameSync(temporary, PID_FILE);
  }
}

function removePidFile() {
  try {
    if (Number(fs.readFileSync(PID_FILE, 'utf8').trim()) === process.pid) fs.unlinkSync(PID_FILE);
  } catch (_) {}
}

function startDaemon() {
  if (stopping) return;
  const args = ['--experimental-sqlite', DAEMON_FILE];
  log('启动 daemon: ' + process.execPath + ' ' + args.join(' '));
  const startedAt = restartBackoff.onStarted();
  child = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true, env: process.env });
  child.on('error', (error) => log('daemon 启动错误: ' + error.message));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) {
      log('daemon 已退出（watchdog 停止中）');
      return;
    }
    // 复位判据挂「上一次启动存活多久」，不再在启动时挂定时器（旧写法见 createRestartBackoff 注释）
    const next = restartBackoff.onExit(startedAt);
    log('daemon 退出 code=' + code + ' signal=' + signal + '，' + next.wait + 'ms 后重启' +
      (next.tripped
        ? '（连续 ' + next.rapidExits + ' 次未活过 ' + (BACKOFF_MAX_MS / 1000) + 's，已熔断为每 ' + (BREAKER_PROBE_MS / 60000) + ' 分钟探测一次）'
        : ''));
    setTimeout(startDaemon, next.wait);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log('watchdog 收到停止信号，结束 daemon');
  if (child) {
    try { child.kill(); } catch (_) {}
  }
  setTimeout(() => {
    removePidFile();
    try { lockServer.close(); } catch (_) {}
    process.exit(0);
  }, 800);
}

const lockServer = net.createServer();
lockServer.unref();
lockServer.once('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    log('当前 profile 的 watchdog 已在运行，本实例退出');
    process.exit(0);
  }
  throw error;
});
lockServer.listen({ host: '127.0.0.1', port: LOCK_PORT, exclusive: true }, () => {
  writePidFile();
  log('watchdog 已获取回环单实例锁 port=' + LOCK_PORT + ' pid=' + process.pid);
  startDaemon();
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', removePidFile);
