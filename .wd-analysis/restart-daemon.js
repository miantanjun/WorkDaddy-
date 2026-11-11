#!/usr/bin/env node
'use strict';
/**
 * Detached daemon restart helper (2026-11-11 upstream 1.2.20 absorption verify).
 *
 * Why detached + delayed: this agent talks to the model through the gateway
 * served by the very same daemon (127.0.0.1:7867). Killing it inline would cut
 * the in-flight response. So we spawn this helper detached, let the current
 * turn finish, then kill the daemon tree. watchdog.js respawns it.
 *
 * ASCII only on purpose (PowerShell/CMD locale issues).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = 'D:/WorkDaddy';
const LOG = path.join(ROOT, '.wd-analysis', 'restart-daemon.log');
const TOKEN_FILE = 'C:/Users/Lyon/AppData/Roaming/WorkDaddy/.api-token';
const PORT = 47832;

const OLD_PID = Number(process.argv[2] || 0);
const DELAY = Number(process.argv[3] || 20000);

function log(msg) {
  const line = '[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg + '\n';
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
  log('=== absorb-1.2.20 restart: helper pid=' + process.pid + ' target=' + OLD_PID + ' delay=' + DELAY + 'ms');
  await sleep(DELAY);

  log('killing tree PID ' + OLD_PID);
  const kill = spawnSync('taskkill', ['/F', '/T', '/PID', String(OLD_PID)], { encoding: 'utf8', windowsHide: true });
  log('taskkill rc=' + kill.status + ' out=' + String(kill.stdout || '').trim() + ' err=' + String(kill.stderr || '').trim());

  const token = readToken();
  let up = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const st = await req('GET', '/api/status', token, 2000);
    if (st.status === 200) {
      up = i + 1;
      log('api up after ' + up + 's');
      break;
    }
  }
  if (!up) { log('FAIL api never came back within 60s'); return; }

  await sleep(4000);
  const newPid = listeningPid(PORT);
  log('new listening pid on ' + PORT + ' = ' + newPid + (newPid === OLD_PID ? ' (WARN same pid)' : ''));

  // --- version baseline ---
  const ver = await req('GET', '/api/status', token, 8000);
  log('status body=' + ver.body.slice(0, 600));

  // --- A: new routes must exist. 400 = route present but arg rejected; 404 = ROUTE MISSING. ---
  const r1 = await req('POST', '/api/quick-phrase-reorder', token, 8000, { ids: [] });
  log('[A] quick-phrase-reorder status=' + r1.status + ' body=' + r1.body.slice(0, 300));
  const r2 = await req('POST', '/api/quick-phrase-insert', token, 8000, { text: '' });
  log('[A] quick-phrase-insert   status=' + r2.status + ' body=' + r2.body.slice(0, 300));

  // --- B: rate-limit code table union. Route order is:
  //   uid format -> modelId format -> account exists (404) -> CODE TABLE -> resetAt window -> DB write.
  // So probe with a REAL uid plus an out-of-window resetAt: code-table rejection and
  // time-window rejection produce DIFFERENT messages, and the invalid resetAt returns
  // before any DB write => zero side effects.
  const REAL_UID = '1d80c722-dff7-4bb7-bd29-591236f90c70';
  const BAD_RESET = 1; // far outside [-1d, +90d]
  async function probeCode(code, label, expect) {
    const r = await req('POST', '/api/model-rate-limit', token, 8000,
      { uid: REAL_UID, modelId: 'probe-model', reasonCode: code, resetAt: BAD_RESET, modelName: 'probe', source: 'probe' });
    log('[B] ' + label + ' status=' + r.status + ' body=' + r.body.slice(0, 240) + '   expected: ' + expect);
  }
  await probeCode(6000, 'rate-limit 6000 ', '400 "解封时间无效" (= code 6000 PASSED the table)');
  await probeCode(6004, 'rate-limit 6004 ', '400 "解封时间无效" (= code 6004 PASSED the table)');
  await probeCode(14012, 'rate-limit 14012', '400 "解封时间无效" (= local code PASSED, not regressed)');
  await probeCode(9999, 'rate-limit 9999 ', '400 "仅记录限流业务码" (= unknown code REJECTED)');

  // --- C: existing plugins still healthy ---
  const ts = await req('GET', '/api/ck-memory/tempsweep', token, 15000);
  log('[C] tempsweep status=' + ts.status + ' body=' + ts.body.slice(0, 400));

  log('done');
}

main().catch((e) => log('helper crashed: ' + (e && e.stack || e)));
