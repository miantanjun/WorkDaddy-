#!/usr/bin/env node
/**
 * 切换登录账号：把备份文件复制回登录信息文件
 * 用法: node scripts/switch.js <uid>
 * 切换后需重启 WorkBuddy 生效。
 */
'use strict';
const { defaultDataDir, switchTo } = require('./lib.js');

const uid = (process.argv[2] || '').trim();
if (!uid) {
  console.error('用法: node scripts/switch.js <uid>');
  console.error('先运行 node scripts/list.js 查看所有账号 uid');
  process.exit(2);
}

try {
  const acct = switchTo(defaultDataDir(), uid);
  console.log(
    JSON.stringify({
      ok: true,
      uid: acct.uid,
      nickname: acct.nickname,
      hint: '切换成功，请重启 WorkBuddy 使新账号生效',
    })
  );
  process.exit(0);
} catch (e) {
  console.error('切换失败: ' + e.message);
  process.exit(1);
}
