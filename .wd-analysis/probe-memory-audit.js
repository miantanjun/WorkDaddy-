#!/usr/bin/env node
/**
 * GET /api/memory-audit 活体探针（LF）。
 *
 * 验证 daemon 真机上的 B2 路由：正常报告 / markdown / 缺 workspace / **没有 fix 路由**。
 * 只读，不改盘；不依赖外部库（用内置 http）。
 *
 * 跑法：node .wd-analysis/probe-memory-audit.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47832;
const WS = 'D:/WorkBuddy date/2026-09-14-10-51-52';
// 本地 API 需要 X-WorkDaddy-Token（在 %APPDATA%/WorkDaddy/.api-token）。
// ⚠️ 不带 token 一律 401「本地 API 未授权」—— 这不是路由不存在，别误判。
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'WorkDaddy', '.api-token'), 'utf8').trim();

let pass = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); return true; }
  failures.push(name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400)));
  console.log('  FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400)));
  return false;
}

function get(pathname) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method: 'GET',
      headers: { 'X-WorkDaddy-Token': TOKEN },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (error) => resolve({ status: 0, body: '', error: error.message }));
    req.end();
  });
}

(async () => {
  // ---- 0. 跑着的 daemon 必须是源码那个 buildId ----
  const src = fs.readFileSync('D:/WorkDaddy/scripts/daemon.js', 'utf8');
  const expectBuild = (src.match(/const DAEMON_BUILD_ID = '([^']+)'/) || [])[1];
  const status = await get('/api/status');
  const statusJson = (() => { try { return JSON.parse(status.body); } catch (_) { return {}; } })();
  const liveBuild = statusJson.buildId || (statusJson.daemon && statusJson.daemon.buildId) || '';
  console.log('源码 buildId = ' + expectBuild + '\n实跑 buildId = ' + liveBuild);
  t('0 实跑 daemon 的 buildId 与源码一致（不跑重启脚本这里就红）', liveBuild === expectBuild, { expectBuild, liveBuild });

  // ---- 1. 正常报告 ----
  const res = await get('/api/memory-audit?workspace=' + encodeURIComponent(WS));
  const report = (() => { try { return JSON.parse(res.body); } catch (_) { return {}; } })();
  t('1 GET /api/memory-audit 返回 200', res.status === 200, res.status);
  t('2 ok 为 true', report.ok === true, report);
  t('3 带 workspace 时工作区层被识别', !!(report.layers && report.layers.project && report.layers.project.files.length), report.layers && report.layers.project);
  t('4 云端档案层被识别', !!(report.layers && report.layers.cloud && report.layers.cloud.files.length >= 1));
  t('5 身份三件套单列一层（不再并进 user.bytes）',
    !!(report.layers && report.layers.identity && report.layers.identity.files.length === 3), report.layers && report.layers.identity);
  t('6 各层之和 == injected.totalBytes（恒等式）', (() => {
    const l = report.layers || {};
    const sum = (l.cloud ? l.cloud.bytes : 0) + (l.user ? l.user.bytes : 0)
      + (l.identity ? l.identity.bytes : 0) + (l.project ? l.project.bytes : 0);
    return sum === (report.injected && report.injected.totalBytes);
  })(), { layers: report.layers, injected: report.injected });
  t('7 常驻体积大于 40KB（本机实测约 53KB）', (report.injected && report.injected.totalBytes) > 40 * 1024, report.injected);
  t('8 有 findings 且 counts 自洽', Array.isArray(report.findings) && report.findings.length > 0
    && report.counts.crit === report.findings.filter((f) => f.severity === 'crit').length
    && report.counts.warn === report.findings.filter((f) => f.severity === 'warn').length);
  t('9 **全部 fix.kind 都是 paste（只提醒不自动改写）**',
    report.findings.every((f) => f.fix && f.fix.kind === 'paste'),
    report.findings.map((f) => f.fix && f.fix.kind));
  t('10 counts.autoFixable 恒为 0', report.counts.autoFixable === 0);
  t('11 没有任何 fix 带 fixId', !report.findings.some((f) => f.fix && f.fix.fixId));

  // ---- 2. 真机发现的形态（本机实测应有的几条）----
  const keys = report.findings.map((f) => f.key);
  console.log('   findings keys: ' + keys.join(' | '));
  t('12 检出用户级记忆超出硬限额', keys.some((k) => k.indexOf('user:') === 0));
  t('13 检出工作区记忆超出硬限额', keys.some((k) => k.indexOf('project:') === 0));
  t('14 检出云端档案偏大', keys.some((k) => k.indexOf('cloud:') === 0));
  t('15 检出残留 .bak 副本', keys.indexOf('backups') >= 0);
  t('16 **没有**误报「项目细节写进跨项目层」（C:/Users 必须被忽略）', keys.indexOf('misfit:user') < 0, keys);
  t('17 **没有**误报「记了别的项目」（/api/... 路由必须被忽略）', keys.indexOf('misfit:project') < 0, keys);
  t('18 **没有**误报「失效路径引用」（占位符必须被忽略）', keys.indexOf('dead-pointer') < 0, keys);

  // ---- 3. markdown ----
  const md = await get('/api/memory-audit?format=md&workspace=' + encodeURIComponent(WS));
  const mdJson = (() => { try { return JSON.parse(md.body); } catch (_) { return {}; } })();
  t('19 format=md 返回 200', md.status === 200, md.status);
  t('20 返回 markdown 且以标题开头', typeof mdJson.markdown === 'string' && mdJson.markdown.indexOf('# 记忆治理巡检') === 0);
  t('21 markdown 含「只提醒、不自动改写」声明', /只提醒、不自动改写/.test(mdJson.markdown || ''));

  // ---- 4. 缺 workspace ----
  const noWs = await get('/api/memory-audit');
  const noWsJson = (() => { try { return JSON.parse(noWs.body); } catch (_) { return {}; } })();
  t('22 不给 workspace 也返回 200', noWs.status === 200, noWs.status);
  t('23 不给 workspace 时项目层为空', !(noWsJson.layers && noWsJson.layers.project && noWsJson.layers.project.files.length));
  // ⚠️ 这里刻意**不写死体积阈值** —— 记忆文件被治理后会变小，写死会让探针在正确的事发生后变红。
  //    改判结构恒等式：云端 + 用户级 + 身份 == totalBytes（工作区层此时为空）。
  t('24 不给 workspace 时常驻成本照常统计（云端 + 用户级 + 身份 == total）', (() => {
    const l = noWsJson.layers || {};
    const i = noWsJson.injected || {};
    const sum = ((l.cloud && l.cloud.bytes) || 0) + ((l.user && l.user.bytes) || 0) + ((l.identity && l.identity.bytes) || 0);
    return i.totalBytes === sum && sum > 10 * 1024;
  })(), { layers: noWsJson.layers, injected: noWsJson.injected });

  // ---- 5. 没有 fix 路由（只提醒不自动改写的硬保证）----
  const fix = await get('/api/memory-audit/fix');
  t('25 GET /api/memory-audit/fix 不存在（不是 200）', fix.status !== 200, fix.status);

  // ---- 6. 幂等：两次读结果一致（只读无副作用）----
  const again = await get('/api/memory-audit?workspace=' + encodeURIComponent(WS));
  const againJson = (() => { try { return JSON.parse(again.body); } catch (_) { return {}; } })();
  t('26 两次调用的 findings 完全一致（只读、无副作用）',
    JSON.stringify(report.findings) === JSON.stringify(againJson.findings));

  console.log('\n==== 探针结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
  for (const f of failures) console.log('  · ' + f);
  process.exit(failures.length ? 1 : 0);
})();
