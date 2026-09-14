#!/usr/bin/env node
/**
 * 列出所有已备份账号
 * 用法: node scripts/list.js [--json]
 */
'use strict';
const { AUTH_FILE, defaultDataDir, listAccounts, readAuthFile } = require('./lib.js');

const wantJson = process.argv.includes('--json');

let current = null;
try {
  const c = readAuthFile();
  current = { uid: c.uid, nickname: c.nickname };
} catch (_) {
  /* 当前登录文件不可读时视为无当前账号 */
}

const accounts = listAccounts(defaultDataDir());

if (wantJson) {
  console.log(JSON.stringify({ current, accounts }, null, 2));
  process.exit(0);
}

console.log(`登录信息文件: ${AUTH_FILE}`);
console.log(`已备份账号: ${accounts.length} 个`);
console.log('------------------------------');
for (const a of accounts) {
  const mark = current && a.uid === current.uid ? '[当前] ' : '      ';
  console.log(`${mark}${a.nickname || '(未命名)'}  ${a.uid}`);
  if (a.uin) console.log(`        uin: ${a.uin}`);
}
if (!current) {
  console.log('(当前登录信息文件不可读)');
}
process.exit(0);
