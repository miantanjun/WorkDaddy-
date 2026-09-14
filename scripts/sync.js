#!/usr/bin/env node
/**
 * 手动备份当前登录信息 -> accounts/<uid>.info
 * 用法: node scripts/sync.js
 * 输出: JSON 摘要
 */
'use strict';
const { defaultDataDir, backupCurrent } = require('./lib.js');

try {
  const info = backupCurrent(defaultDataDir());
  console.log(
    JSON.stringify({ ok: true, uid: info.uid, nickname: info.nickname })
  );
  process.exit(0);
} catch (e) {
  console.error('备份失败: ' + e.message);
  process.exit(1);
}
