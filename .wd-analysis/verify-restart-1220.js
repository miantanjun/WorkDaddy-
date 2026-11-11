#!/usr/bin/env node
'use strict';
/**
 * Kill the daemon then verify the new build came up with the 1.2.20 additions.
 * Run as a BACKGROUND task so the process outlives the current turn, and so the
 * daemon death (which also kills the gateway this agent talks through) happens
 * AFTER the turn's response has been delivered.
 *
 * Usage:  node verify-restart-1220.js [oldPid] [delaySeconds]
 *   oldPid defaults to the pid reported by GET /api/status (never hardcode one:
 *   the daemon respawns and the value goes stale within a single session).
 *
 * ASCII only (PowerShell/CMD locale issues).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = 'D:/WorkDaddy';
const LOG = path.join(ROOT, '.wd-analysis', 'absorb-121-verify.log');
const TOKEN_FILE = 'C:/Users/Lyon/AppData/Roaming/WorkDaddy/.api-token';
const PORT = 47832;
/* 0 = resolve from /api/status at start. Hardcoding a pid is a trap: the daemon
   respawns, so any literal written today is dead by the next session. */
const OLD_PID = Number(process.argv[2] || 0);
const DELAY_MS = Number(process.argv[3] || 12) * 1000;
const REAL_UID = '1d80c722-dff7-4bb7-bd29-591236f90c70';

function log(msg) {
  const line = '[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg + '\n';
  process.stdout.write(line);
  try { fs.appendFileSync(LOG, line, 'utf8'); } catch (_) {}
}

function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (_) { return ''; }
}

function req(method, urlPath, token, timeoutMs, body) {
  return new Promise((resolve) => {
    const headers = {};
    if (token) headers['X-WorkDaddy-Token'] = token;
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
    r.setTimeout(timeoutMs || 5000, () => { r.destroy(); resolve({ status: 0, body: 'timeout' }); });
    if (payload !== null) r.write(payload);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listeningPid(port) {
  try {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    for (const line of out.split(/\r?\n/)) {
      if (line.indexOf(':' + port) === -1) continue;
      if (line.indexOf('LISTENING') === -1) continue;
      const parts = line.trim().split(/\s+/);
      return Number(parts[parts.length - 1]) || 0;
    }
  } catch (_) {}
  return 0;
}

async function main() {
  try { fs.unlinkSync(LOG); } catch (_) {}
  const token0 = readToken();

  let oldPid = OLD_PID;
  if (!oldPid) {
    const st0 = await req('GET', '/api/status', token0, 8000);
    try { oldPid = Number(JSON.parse(st0.body).pid) || 0; } catch (_) {}
    if (!oldPid) { log('FAIL: cannot resolve current daemon pid from /api/status'); return; }
    log('resolved current daemon pid=' + oldPid + ' from /api/status');
  }
  log('=== START: kill daemon ' + oldPid + ' then verify upstream-1.2.20 absorption ===');

  // let the current turn's response actually leave the machine
  await sleep(DELAY_MS);

  log('taskkill /F /T /PID ' + oldPid);
  const kill = spawnSync('taskkill', ['/F', '/T', '/PID', String(oldPid)], { encoding: 'utf8', windowsHide: true });
  log('taskkill rc=' + kill.status + ' out=' + String(kill.stdout || '').trim() + ' err=' + String(kill.stderr || '').trim());

  const token = readToken();
  let up = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const st = await req('GET', '/api/status', token, 2500);
    if (st.status === 200) { up = i + 1; break; }
  }
  if (!up) { log('FAIL: api never came back within 90s'); return; }
  log('api back up after ' + up + 's');

  await sleep(5000);
  const st = await req('GET', '/api/status', token, 8000);
  let info = {};
  try { info = JSON.parse(st.body); } catch (_) {}
  const newPid = listeningPid(PORT);
  log('new pid=' + newPid + '  version=' + info.version + '  buildId=' + info.buildId + (newPid === oldPid ? '  (WARN same pid)' : ''));

  // --- A: new routes present? 400 = present-but-bad-arg, 404 = route missing ---
  const a1 = await req('POST', '/api/quick-phrase-reorder', token, 8000, { ids: [] });
  log('[A] quick-phrase-reorder status=' + a1.status + ' body=' + a1.body.slice(0, 200) + '   (want 400 "顺序无效", 404 = MISSING)');
  const a2 = await req('POST', '/api/quick-phrase-insert', token, 8000, { text: '' });
  log('[A] quick-phrase-insert   status=' + a2.status + ' body=' + a2.body.slice(0, 200) + '   (want 400 "短语不能为空", 404 = MISSING)');

  // --- B: rate-limit code table union. Real uid + out-of-window resetAt =>
  //         code-table rejection says "仅记录限流业务码", time-window rejection says "解封时间无效".
  //         Nothing is written to the DB because the invalid resetAt returns first.
  async function probe(code) {
    const r = await req('POST', '/api/model-rate-limit', token, 8000,
      { uid: REAL_UID, modelId: 'probe-model', reasonCode: code, resetAt: 1, modelName: 'probe', source: 'probe' });
    return r.status + ' ' + r.body.slice(0, 160);
  }
  log('[B] 6000  -> ' + await probe(6000) + '   (want "解封时间无效" = PASSED table; "仅记录限流业务码" = FAILED)');
  log('[B] 6004  -> ' + await probe(6004) + '   (want "解封时间无效")');
  log('[B] 14012 -> ' + await probe(14012) + '   (want "解封时间无效" = local code not regressed)');
  log('[B] 9999  -> ' + await probe(9999) + '   (want "仅记录限流业务码" = unknown rejected)');

  // --- C: plugins still healthy ---
  const c1 = await req('GET', '/api/ck-memory/tempsweep', token, 20000);
  log('[C] ck-memory/tempsweep status=' + c1.status + ' body=' + c1.body.slice(0, 300));
  const c2 = await req('GET', '/api/ck-memory/stats', token, 20000);
  log('[C] ck-memory/stats status=' + c2.status + ' body=' + c2.body.slice(0, 200));

  log('=== DONE ===');
}

main().catch((e) => log('crashed: ' + (e && e.stack || e)));
