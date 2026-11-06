'use strict';
// 阶段 4 端到端：把真实会话的一段 seg 灌进临时库，走完整 extractFacts 流程
// 用法：node t4-fact-e2e.js [--live]
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const LIVE = process.argv.indexOf('--live') >= 0;
const TMP = path.join(os.tmpdir(), 'ckm-e2e-' + Date.now());
fs.mkdirSync(path.join(TMP, 'ck-memory'), { recursive: true });

const m = require(path.join(__dirname, '..', 'scripts', 'ck-memory.js'));

// 从正式库里搬一段真实对话进来（只读，不写正式库）
const REAL = path.join(process.env.APPDATA || '', 'WorkDaddy', 'ck-memory', 'ck.db');
const { DatabaseSync } = require('node:sqlite');
const src = new DatabaseSync(REAL, { readOnly: true });
const SID = 'e2etest';
const picked = src.prepare(
  "SELECT seq, ts, role, kind, tool, text, h, dup, noise, pri FROM seg " +
  "WHERE sid='8f92c3fc-ff73-4db1-b104-eb060127daaf' AND kind IN ('user','assistant') " +
  "AND COALESCE(noise,0)=0 AND COALESCE(pri,0)>=1 ORDER BY seq LIMIT 40"
).all();
src.close();
console.log('搬入真实消息', picked.length, '条');

// 假端点：固定返回一段合法 JSON（走 process.env.CKM_FAKE 时用）
let FAKE_BODY = null;
if (!LIVE) {
  FAKE_BODY = JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: '```json\n' + JSON.stringify([
          { text: 'WorkDaddy 项目根目录为 D:/WorkDaddy，当前发布版本 v1.9.9', kind: 'tech', time: '2026-11-01' },
          { text: '回归测试权威入口是 .wd-analysis/run-regression-all.js，该脚本失败也不改退出码', kind: 'tech', time: '' },
          { text: '记忆模块的 scripts 必须纯 CRLF，改完要复查裸 LF 为 0', kind: 'decision', time: '' },
          { text: 'WorkDaddy 项目根目录为 D:/WorkDaddy，当前发布版本 v1.9.9。', kind: 'tech', time: '2026-11-01' },
          { text: 'OK', kind: 'other', time: '' },
        ]) + '\n```',
      },
    }],
    usage: { prompt_tokens: 3000, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 0 } },
  });
} else {
  const KEY = fs.readFileSync(path.join(process.env.APPDATA || '', 'WorkDaddy', 'gateway', '.api_key'), 'utf8').trim();
  FAKE_BODY = null;
  process.env.CKM_PROXY_KEY = KEY;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (FAKE_BODY) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(FAKE_BODY);
      return;
    }
    // 透传到真实网关（避免自己再写一遍签名逻辑）
    const u = new URL('http://127.0.0.1:7863/v1/chat/completions');
    const p = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.CKM_PROXY_KEY },
    }, (r2) => { res.writeHead(r2.statusCode, r2.headers); r2.pipe(res); });
    p.on('error', (e) => { res.writeHead(500); res.end(String(e.message)); });
    p.end(body);
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  m.configure({
    dataRoot: TMP, dataDir: TMP, log: (s) => console.log('  [log] ' + s),
  });

  // 指向假端点（或代理）
  m._internal.saveConf({
    factBaseUrl: 'http://127.0.0.1:' + port + '/v1',
    factApiKey: 'test-key',
    factModel: LIVE ? 'cn:glm-5.3-flash' : 'fake-model',
    factBatchTurns: 1,
    factExtract: true,
  });

  const db = m._internal.open();
  // 灌数据
  const insSeg = db.prepare(
    'INSERT INTO seg(sid,seq,ts,role,kind,tool,text,h,dup,noise,last_ts,pri) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insFts = db.prepare('INSERT INTO seg_fts(rowid,big) VALUES(?,?)');
  db.exec('BEGIN');
  for (const r of picked) {
    const info = insSeg.run(SID, r.seq, r.ts, r.role, r.kind, r.tool, r.text, r.h, r.dup, r.noise, r.ts, r.pri);
    insFts.run(info.lastInsertRowid, m.bigram(r.text));
  }
  db.prepare('INSERT INTO sessions(sid,proj,title,src_path,byte_off,file_size,n_seg,first_ts,last_ts,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(SID, 'e2e', '端到端测试', '', 0, 1, picked.length, picked[0].ts, picked[picked.length - 1].ts, Date.now());
  db.exec('COMMIT');
  console.log('入库完成，seg 行数 =', db.prepare('SELECT COUNT(*) c FROM seg').get().c);

  console.log('\n--- extractFacts（' + (LIVE ? '真实模型' : '假端点') + '）---');
  const t0 = Date.now();
  const r = await m.extractFacts(SID, { force: true });
  console.log('  结果:', JSON.stringify(r), '耗时', Date.now() - t0, 'ms');

  const facts = db.prepare('SELECT id,text,kind,valid_from,valid_to,ents,model FROM fact ORDER BY id').all();
  console.log('\n--- 写入的事实', facts.length, '条 ---');
  for (const f of facts) {
    console.log(`  #${f.id} [${f.kind}] ${f.text}`);
    console.log(`      valid_from=${f.valid_from ? new Date(f.valid_from).toISOString().slice(0, 10) : '-'} valid_to=${f.valid_to || 'NULL'} ents=${f.ents}`);
  }

  const prog = db.prepare('SELECT * FROM factq WHERE sid=?').get(SID);
  console.log('\n--- 抽取进度 ---', JSON.stringify(prog));

  // 二次抽取应该 nothing-new
  const r2 = await m.extractFacts(SID, { force: false });
  console.log('--- 再抽一次（应 nothing-new）:', JSON.stringify(r2));

  // 检索
  console.log('\n--- 事实检索 ---');
  for (const q of ['项目路径', '回归测试', 'CRLF', 'v1.9.9']) {
    const s = m.searchFacts(SID, q, 5);
    console.log(`  「${q}」→ ${s.items.length} 条` + (s.items[0] ? ' 首条: ' + s.items[0].text.slice(0, 50) : ''));
  }

  // 融合
  const seg = m._internal.search(SID, '回归测试', 5);
  const factsHit = m.searchFacts(SID, '回归测试', 5).items;
  const fused = m.rrfFuse(factsHit, seg.hits.map((h, i) => Object.assign({ id: 's' + i }, h)));
  console.log('\n--- RRF 融合（原文 ' + seg.hits.length + ' 条 + 事实 ' + factsHit.length + ' 条）---');
  for (const x of fused.slice(0, 6)) {
    console.log(`  ${x.type.padEnd(4)} rrf=${x.score.toFixed(5)} ${String(x.item.text || '').slice(0, 55)}`);
  }

  console.log('\n--- factStats ---', JSON.stringify(m.factStats()));
  console.log('\n临时库:', TMP);
  server.close();
});
