#!/usr/bin/env node
/**
 * 统一用量看板 —— 一键刷新（T26 / T22 后半 / T24 断档 的共用落地件）
 *
 * 用途：让「看板数据」不随时间断档。官方只保留 30 天逐笔明细（T24 已证实），
 *      本机已有 24 个历史会话的逐笔积分明细被清掉、只剩汇总。每天跑一次即可留住趋势。
 *
 * 用法：
 *   node refresh-usage-board.js            # 生成一次
 *   node refresh-usage-board.js --json     # 只输出 JSON（给 automation 解析）
 *   node refresh-usage-board.js --status   # 只查现状，不生成
 *
 * 退出码：0 = 成功；1 = 失败（daemon 未运行 / 接口报错 / 鉴权失败）。
 * 依赖：本机 WorkDaddy daemon 在跑（端口从 ui-port.json 读，默认 47832）。
 */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const APP_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'WorkDaddy');
const JSON_OUT = process.argv.includes('--json');
const STATUS_ONLY = process.argv.includes('--status');

function readPort() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'ui-port.json'), 'utf8'));
    if (j && Number(j.port)) return { port: Number(j.port), profile: j.profileId || '' };
  } catch (_) {}
  return { port: 47832, profile: '' };
}

function readToken() {
  try { return fs.readFileSync(path.join(APP_DIR, '.api-token'), 'utf8').trim(); } catch (_) { return ''; }
}

function call(port, token, apiPath, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: apiPath, method,
      headers: { 'X-WorkDaddy-Token': token, 'Content-Type': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(d); } catch (_) { body = { raw: d.slice(0, 600) }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.setTimeout(180000, () => { req.destroy(new Error('timeout 180s')); });
    req.on('error', reject);
    if (method === 'POST') req.write('{}');
    req.end();
  });
}

(async () => {
  const { port, profile } = readPort();
  const token = readToken();
  const out = { ok: false, port, profile, at: new Date().toISOString() };
  if (!token) { out.error = '读不到 .api-token：' + path.join(APP_DIR, '.api-token'); }
  try {
    const before = await call(port, token, '/api/usage-unified/status', 'GET');
    out.statusBefore = before.status === 200 ? { exists: before.body.exists, file: before.body.file } : before.body;
    if (before.status === 401) out.error = '本地 API 未授权（token 过期？）';
    if (!STATUS_ONLY) {
      const gen = await call(port, token, '/api/usage-unified/generate', 'POST');
      out.generate = gen.body;
      out.ok = gen.status === 200 && !!gen.body.ok;
      if (!out.ok && !out.error) out.error = String((gen.body && gen.body.error) || ('HTTP ' + gen.status));
      if (out.ok) {
        const p = path.join(APP_DIR, 'usage-board', gen.body.file);
        let size = 0;
        try { size = fs.statSync(p).size; } catch (_) {}
        out.artifact = { file: gen.body.file, bytes: size, url: 'http://127.0.0.1:' + port + '/usage-unified/' };
      }
    } else {
      out.ok = before.status === 200;
    }
  } catch (e) {
    out.error = '连不上 daemon（' + port + '）：' + (e && e.message) + ' —— 请确认 WorkBuddy / WorkDaddy daemon 在运行。';
  }

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(out) + '\n');
  } else {
    const L = [];
    L.push('[看板刷新] ' + (out.ok ? '成功' : '失败') + '  port=' + port + (profile ? '  profile=' + profile : ''));
    if (out.artifact) L.push('  产物: ' + out.artifact.file + '  ' + Math.round(out.artifact.bytes / 1024) + ' KB');
    if (out.generate) L.push('  buckets=' + out.generate.buckets + '  accounts=' + out.generate.accounts + '  models=' + out.generate.models + '  days=' + out.generate.days + '  用时 ' + out.generate.elapsedMs + 'ms');
    if (out.generate && out.generate.creditTotal != null) L.push('  积分合计=' + out.generate.creditTotal + '  creditSource=' + (out.generate.creditSource || '-'));
    if (out.generate && out.generate.enrichNote) L.push('  补充指标: ' + out.generate.enrichNote);
    if (out.error) L.push('  !! ' + out.error);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(out.ok ? 0 : 1);
})();
