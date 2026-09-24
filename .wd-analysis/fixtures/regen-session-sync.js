'use strict';
/*
 * regen-session-sync.js —— 由「上游原文 fixture + delta 表」重生成 scripts/session-sync.js。
 *
 * 用法：node .wd-analysis/fixtures/regen-session-sync.js
 *
 * 为什么不让工作副本自由发挥：
 *   我们要能长期与上游 diff。唯一可靠的做法是让工作副本**成为** fixture + delta 表的产物，
 *   而不是一份会被慢慢改歪的手改文件。改行为 ⇒ 先改 deltas.js ⇒ 再跑本脚本。
 *   脚本会校验 fixture 指纹（防 fixture 被误改）与「每条 delta 恰好命中 1 次」（防原地漂移）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPSTREAM_SHA256, applyDeltas } = require('./session-sync.deltas.js');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, 'session-sync.upstream-1.2.6.js');
const TARGET = path.join(ROOT, 'scripts', 'session-sync.js');

const upstream = fs.readFileSync(FIXTURE, 'utf8');

const sha = crypto.createHash('sha256').update(upstream, 'utf8').digest('hex');
if (sha !== UPSTREAM_SHA256) {
  console.error('fixture sha256 与登记不符，拒绝生成：' + sha);
  process.exit(1);
}
if (upstream.indexOf('\r') !== -1) {
  console.error('fixture 必须是纯 LF（否则与上游无法逐字节 diff）');
  process.exit(1);
}

const { text, problems } = applyDeltas(upstream);
if (problems.length) {
  console.error('delta 表不健康，拒绝生成：\n  ' + problems.join('\n  '));
  process.exit(1);
}

fs.writeFileSync(TARGET, text);
console.log('已生成 ' + TARGET);
console.log('  bytes = ' + Buffer.byteLength(text, 'utf8') + '，行数 = ' + text.split('\n').length);
console.log('  delta 条数 = ' + require('./session-sync.deltas.js').DELTAS.length);
