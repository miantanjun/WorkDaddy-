'use strict';
/*
 * probe-switch-settle-live.js —— v1.3.17 切号闸门的**真机零副作用**验证。
 *
 * 目的：证明「改动没把还原切号这条路弄坏」——
 *   建一个 manual 临时任务：account.forEach{ switch:true, steps:[logic.delay 1500] }
 *   （**不含任何发送步骤**），跑一次，观察：
 *     ① 任务仍以 success 收尾；
 *     ② 先切到目标账号，随后**仍然还原**回原账号（= 空闲时闸门放行，没有误伤）；
 *     ③ 日志里没有出现「延后还原账号」。
 *   跑完立刻把临时任务删掉。
 *
 * 跑法：node .wd-analysis/probe-switch-settle-live.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOME = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
const TOKEN = fs.readFileSync(path.join(HOME, 'WorkDaddy', '.api-token'), 'utf8').trim();
const LOG = path.join(HOME, 'WorkDaddy', 'daemon.log');
const TASK_ID = 'wd_tmp_settle_probe';
const PORT = 47832;

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: Object.assign({ 'X-WorkDaddy-Token': TOKEN },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(text || '{}')); }
        catch (_) { reject(new Error('非 JSON 响应(' + res.statusCode + '): ' + text.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function logLines(fromByte) {
  const fd = fs.openSync(LOG, 'r');
  const size = fs.fstatSync(fd).size;
  const start = Math.max(0, Math.min(fromByte, size));
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8').split(/\r?\n/).filter(Boolean);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const status = await api('GET', '/api/status');
  console.log('daemon: version=' + status.version + ' buildId=' + status.buildId + ' pid=' + status.pid);
  const accounts = await api('GET', '/api/accounts');
  const list = (accounts && accounts.accounts) || [];
  // /api/accounts 的形状：{ ok, current:{uid,nickname}, primaryUid, accountOrder, accounts:[] }
  const currentUid = String((accounts && accounts.current && accounts.current.uid) || '');
  const current = list.find((a) => a.uid === currentUid) || null;
  const other = list.find((a) => a.uid !== currentUid);
  console.log('账号表：' + list.map((a) => (a.nickname || a.uid) + (a.isPrimary ? '(主)' : '') + ((current && a.uid === current.uid) ? '[当前]' : '')).join(' / '));
  if (!current || !other) { console.log('✗ 需要至少两个账号才能验证，退出'); process.exit(2); }
  console.log('计划：' + (current.nickname || current.uid) + ' → ' + (other.nickname || other.uid) + ' → 还原回 ' + (current.nickname || current.uid));

  const mark = fs.statSync(LOG).size;
  const task = {
    schemaVersion: 1,
    id: TASK_ID,
    name: '临时探针·切号闸门（用完即删）',
    description: '验证 v1.3.17 还原闸门：只切换+等待，不含任何发送步骤',
    enabled: true,
    trigger: { type: 'manual' },
    variables: {},
    steps: [{ op: 'account.forEach', accounts: [other.uid], switch: true, steps: [{ op: 'logic.delay', ms: 1500 }] }],
    onSuccess: [], onFailure: [],
    updatedAt: Date.now(),
  };

  let created = await api('POST', '/api/automations', task);
  if (!created.ok) { console.log('✗ 建任务失败: ' + created.error); process.exit(2); }
  console.log('已建临时任务 ' + TASK_ID);

  const started = await api('POST', '/api/automations/run', { id: TASK_ID });
  if (!started.ok) {
    console.log('✗ 触发失败: ' + started.error);
    await api('POST', '/api/automations/bulk', { ids: [TASK_ID], action: 'delete' });
    process.exit(2);
  }
  const runId = started.run.id;
  console.log('已触发 run=' + runId);

  let run = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(600);
    const s = await api('GET', '/api/automations/run-status?id=' + encodeURIComponent(runId));
    if (s.ok && s.run && s.run.status !== 'running') { run = s.run; break; }
  }
  console.log('\nrun 结果：' + (run ? run.status + (run.error ? ' / ' + run.error : '') : '超时未结束'));
  if (run && run.logs) run.logs.forEach((l) => console.log('   runlog: ' + l.message));

  const lines = logLines(mark).filter((l) => /\[switch\]|automation:start .*"taskId":"wd_tmp|automation:finish .*"runId":"' + runId + '"/.test(l) || l.includes(runId) || l.includes(TASK_ID));
  console.log('\ndaemon.log（本次新增的相关行）：');
  lines.forEach((l) => console.log('   ' + l.replace(/^\[([^\]]+)\] \[[^\]]+\] \[[^\]]+\] /, '$1 ')));

  const deferred = lines.some((l) => l.includes('延后还原账号'));
  const switchedToOther = lines.some((l) => l.includes('已切换登录账号为 ' + (other.nickname || '')));
  const restored = lines.some((l) => l.includes('已切换登录账号为 ' + (current.nickname || '')));

  const after = await api('GET', '/api/accounts');
  const afterCurrent = { uid: String((after && after.current && after.current.uid) || '') };

  console.log('\n判定：');
  console.log('  ① 任务 success      : ' + (run && run.status === 'success' ? 'PASS' : 'FAIL'));
  console.log('  ② 切到目标账号      : ' + (switchedToOther ? 'PASS' : 'FAIL'));
  console.log('  ③ 空闲时仍还原      : ' + (restored ? 'PASS' : 'FAIL'));
  console.log('  ④ 未出现「延后还原」: ' + (!deferred ? 'PASS' : 'FAIL（空闲却延后了，闸门误判）'));
  console.log('  ⑤ 当前账号已回到原账号: ' + (afterCurrent && current && afterCurrent.uid === current.uid ? 'PASS' : 'FAIL → 现在 ' + (afterCurrent && (afterCurrent.nickname || afterCurrent.uid))));

  await api('POST', '/api/automations/bulk', { ids: [TASK_ID], action: 'delete' });
  const gone = await api('GET', '/api/automations');
  const still = (gone.tasks || []).some((t) => t.id === TASK_ID);
  console.log('  ⑥ 临时任务已清理    : ' + (!still ? 'PASS' : 'FAIL'));

  const okAll = run && run.status === 'success' && switchedToOther && restored && !deferred
    && afterCurrent && current && afterCurrent.uid === current.uid && !still;
  console.log('\n' + (okAll ? '==== 真机验证通过 ====' : '==== 真机验证未通过 ===='));
  process.exit(okAll ? 0 : 1);
})().catch((e) => { console.error('探针自身异常: ' + (e && e.stack || e)); process.exit(2); });
