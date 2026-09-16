'use strict';
// 读 WorkDaddy meta.json 的 autoCopy.copies 映射：谁是源会话、谁是目标账号的副本
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CANDIDATES = [
  path.join(process.env.APPDATA || '', 'Roaming', 'WorkDaddy', 'meta.json'),
  path.join(process.env.APPDATA || '', 'WorkDaddy', 'meta.json'),
  path.join(process.env.LOCALAPPDATA || '', 'WorkDaddy', 'meta.json'),
  'C:\\Users\\Lyon\\.workbuddy\\meta.json',
];
const out = [];
const log = (...a) => out.push(a.join(' '));

let metaPath = CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
log('meta.json = ' + (metaPath || '(未找到)'));
for (const c of CANDIDATES) log('  候选 ' + c + ' exists=' + fs.existsSync(c));

if (metaPath) {
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const ac = meta.autoCopy || {};
  log('');
  log('autoCopy.version=' + ac.version + ' allSessions=' + ac.allSessions);
  log('sessions=' + JSON.stringify(ac.sessions || []));
  log('workspaces=' + JSON.stringify(ac.workspaces || []));
  log('workspaceLinkMode=' + ac.workspaceLinkMode);
  log('');
  log('--- copies 映射（lineage|targetUid → copySessionId）---');
  const copies = ac.copies || {};
  for (const [k, v] of Object.entries(copies)) {
    log('  ' + k + ' → ' + JSON.stringify(v));
  }
}

// 用会话表把 id 翻译成 标题/账号/创建时间，还原 2a616066 / 882c357a 的关系
const db = new DatabaseSync('C:\\Users\\Lyon\\.workbuddy\\workbuddy.db');
const rows = db.prepare("SELECT id, user_id, cwd, title, custom_title, created_at, updated_at, deleted_at FROM sessions WHERE cwd LIKE '%2026-09-14-10-51-52%' OR id LIKE '2a616066%' OR id LIKE '882c357a%' OR id LIKE '4bae518c%'").all();
db.close();
log('');
log('--- 相关会话行 ---');
const fmt = (t) => (Number(t) ? new Date(Number(t)).toLocaleString('zh-CN') : '-');
for (const r of rows) {
  log(`  id=${String(r.id).slice(0, 8)} uid=${String(r.user_id || '-').slice(0, 8)} del=${r.deleted_at ? 'Y' : 'N'}`);
  log(`      created=${fmt(r.created_at)} updated=${fmt(r.updated_at)}`);
  log(`      cwd=${r.cwd}`);
  log(`      title=${r.title} / custom=${r.custom_title}`);
}

fs.writeFileSync(path.join(__dirname, 'probe-meta.out.txt'), out.join('\n') + '\n', 'utf8');
process.stdout.write('ok\n');
