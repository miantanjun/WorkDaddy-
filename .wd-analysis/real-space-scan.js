// 用真实数据根目录跑一遍 scanSpace（不经 daemon），验证 v3 新增的
// sessions / conversations 是否真的把「时间戳目录」翻译成了「任务对话」。
// 跑法：node .wd-analysis/real-space-scan.js
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { scanSpace, spaceSlug } = require('../scripts/space-scan.js');

const DATA_ROOT = 'C:\\Users\\Lyon\\.workbuddy';
const DB = path.join(DATA_ROOT, 'workbuddy.db');

function buildResolvers() {
  const db = new DatabaseSync(DB);
  const rows = db.prepare('SELECT id, user_id, cwd, title, custom_title FROM sessions').all();
  const byId = new Map();
  const cwdBySlug = new Map();
  for (const row of rows) {
    const id = String(row.id || '');
    if (!id) continue;
    const uid = String(row.user_id || '');
    const cwd = row.cwd ? String(row.cwd) : '';
    const title = String(row.custom_title || row.title || '').trim();
    const prev = byId.get(id);
    if (!prev || (!prev.uid && uid)) {
      byId.set(id, { uid, cwd: cwd || (prev && prev.cwd) || '', title: title || (prev && prev.title) || '' });
    }
    if (cwd) cwdBySlug.set(spaceSlug(cwd), cwd);
  }
  const uids = Array.from(new Set(rows.map((r) => String(r.user_id || '')).filter(Boolean)));
  db.close();
  return {
    sessionCount: rows.length,
    resolveSession: (key) => byId.get(String(key)) || null,
    resolveAccountName: (name) => {
      const base = String(name || '').replace(/^user-/, '');
      if (!base) return null;
      for (const uid of uids) if (base === uid || base.startsWith(uid)) return uid;
      return null;
    },
    resolveSpaceSlug: (slug) => cwdBySlug.get(String(slug)) || null,
  };
}

function mb(n) { return (Number(n) || 0) / 1048576; }

(async () => {
  const resolvers = buildResolvers();
  console.log('sessions in db:', resolvers.sessionCount);
  const t0 = Date.now();
  const result = await scanSpace(DATA_ROOT, Object.assign({}, resolvers, {
    progressEvery: 2000,
    yieldEvery: 2000,
    onProgress: (info) => {
      if (info.processed % 20000 === 0) process.stdout.write('.');
    },
  }));
  process.stdout.write('\n');
  console.log('version:', result.version, '| elapsed:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('spaces:', result.spaces.length, '| sessions:', result.sessions.length, '| conversations:', result.conversations.length);

  console.log('\n=== 空间（工作目录）前 12：目录名 → 对话标题 ===');
  for (const s of result.spaces.slice(0, 12)) {
    const conv = s.conversations || [];
    const label = conv.length ? conv.map((c) => c.title + '(' + mb(c.bytes).toFixed(1) + 'MB×' + c.sessions + ')').join(' | ') : '(无会话记录)';
    console.log('  %s  %sMB/%d文件  %d份记录\n      → %s',
      String(s.cwd).slice(-30), mb(s.bytes).toFixed(1), s.files, s.sessions || 0, label);
  }

  console.log('\n=== 顶层对话前 12（按占用）===');
  for (const c of result.conversations.slice(0, 12)) {
    console.log('  ' + mb(c.bytes).toFixed(1) + 'MB / ' + c.files + '文件  ×' + c.sessions + '  ' + c.title
      + '\n      @ ' + c.cwd);
  }

  const noTitle = result.sessions.filter((s) => !s.title).length;
  console.log('\nsessions without title:', noTitle, '/', result.sessions.length);
  const spacesWithoutConv = result.spaces.filter((s) => !(s.conversations || []).length).length;
  console.log('spaces without conversations:', spacesWithoutConv, '/', result.spaces.length);

  // 抽样一致性：某个空间的对话字节之和 ≤ 该空间总字节
  const bad = result.spaces.filter((s) => {
    const sum = (s.conversations || []).reduce((a, c) => a + c.rawBytes, 0);
    return sum > s.rawBytes * 1.02;
  });
  console.log('spaces where conv sum > space total:', bad.length);

  fs.writeFileSync(path.join(__dirname, 'real-space-scan.json'), JSON.stringify(result));
  console.log('wrote .wd-analysis/real-space-scan.json');
})();
