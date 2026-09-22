'use strict';
/*
 * diag-judge-content.js —— 方案 D4-2：`judge=content` 的**只读影响面诊断**。
 *
 * 目的：回答「若把会话同步判据从 mtime 切到 content，会有多少条血缘的结论发生变化」。
 * **纯只读**：不落盘、不改 meta、不复制、不删任何文件（`resolveContentLeader` 只构造 slim 快照）。
 *
 * 口径（两种判据各自「会做什么」）：
 *   · mtime（现状，daemon.js 默认）：源 = 正文 mtime 最大的成员；再看有多少成员比水位线新 ——
 *       0 个 = 无事可做；1 个 = 同步它；≥2 个 = 报分叉（保护性拒绝覆盖）。
 *   · content（灰度）：源 = 内容领导者；无唯一领导者 = 保留分叉；全部等价 = 无事可做。
 *
 * 输出四类计数：
 *   [1] 血缘数（≥2 个成员且本地都在）
 *   [2] 源选择是否不同（content 判出的 leader != mtime 判出的 latest）
 *   [3] 「动作」是否不同（noop / sync / conflict 三态互比）
 *   [4] 若切 content，被判为 divergent（保留分叉）的血缘数与涉及字节
 *
 * 跑法：node .wd-analysis/diag-judge-content.js [maxLineages]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const leader = require(path.join(ROOT, 'scripts', 'auto-copy-leader.js'));
const profiles = require(path.join(ROOT, 'scripts', 'profiles.js'));

const DATA_ROOT = profiles.getProfile().dataRoot;
const META = path.join(profiles.profileDataDir(profiles.getProfile()), 'meta.json');
const LIMIT = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 60;

/** 正文 mtime（与 daemon.js `sessionBodyMtime` 同口径：projects/&#42;/&lt;id&gt;.jsonl 的最大 mtime）。 */
function sessionBodyMtime(root, sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return 0;
  let latest = 0;
  const projects = path.join(root, 'projects');
  let entries = [];
  try { entries = fs.readdirSync(projects, { withFileTypes: true }); } catch (_) { return 0; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const st = fs.lstatSync(path.join(projects, entry.name, id + '.jsonl'));
      if (st.isFile()) latest = Math.max(latest, Number(st.mtimeMs || 0));
    } catch (_) { /* 这个项目目录下没有它的正文 */ }
  }
  return latest;
}

function dirBytes(target, acc) {
  let st;
  try { st = fs.lstatSync(target); } catch (_) { return acc; }
  if (st.isSymbolicLink()) return acc;
  if (st.isFile()) return acc + Number(st.size || 0);
  if (!st.isDirectory()) return acc;
  let entries = [];
  try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch (_) { return acc; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    acc = dirBytes(path.join(target, e.name), acc);
  }
  return acc;
}

/** 该会话在本地的总体积（正文 jsonl + projects/&lt;id&gt;/ + 产物索引）。 */
function sessionBytes(root, id) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(path.join(root, 'projects'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const rel of [path.join('projects', entry.name, id + '.jsonl'), path.join('projects', entry.name, id)]) {
        total = dirBytes(path.join(root, rel), total);
      }
    }
  } catch (_) {}
  total = dirBytes(path.join(root, 'artifact-index', id + '.json'), total);
  return total;
}

function main() {
  if (!fs.existsSync(META)) {
    console.log('找不到 meta.json：' + META);
    process.exit(2);
  }
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const ac = meta.autoCopy || {};
  const sessions = ac.sessions || {};
  const syncedAt = ac.syncedAt || {};
  const copies = ac.copies || {};

  // ⚠️ 血缘真身在 `autoCopy.sessions[lineageId].members`（**不要**去反解 sessionIndex ——
  //    它的方向是 `uid -> 本地会话id -> lineageId`，反过来解会把每条都当成独立血缘）。
  const lineages = new Map();
  for (const lineageId of Object.keys(sessions)) {
    const members = (sessions[lineageId] && Array.isArray(sessions[lineageId].members)) ? sessions[lineageId].members : [];
    const list = members.map((m) => ({ uid: String(m.uid || ''), id: String(m.id || '') })).filter((m) => m.uid && m.id);
    lineages.set(lineageId, list);
  }

  const multi = [...lineages.entries()].filter(([, members]) => members.length >= 2);
  console.log('judge 现状: ' + String(ac.judge || 'mtime'));
  console.log('dataRoot   : ' + DATA_ROOT);
  console.log('血缘总数   : ' + lineages.size + '，其中 ≥2 个成员的: ' + multi.length + '（本次分析上限 ' + LIMIT + '）');
  console.log('水位线条数 : ' + Object.keys(syncedAt).length + '，copies 记录: ' + Object.keys(copies).length);
  console.log('');

  let analyzed = 0;
  let liveOk = 0;
  let sourceDiffers = 0;
  let actionDiffers = 0;
  let divergent = 0;
  let divergentBytes = 0;
  let mtimeConflict = 0;
  let contentNoop = 0;
  let mtimeSync = 0;
  const samples = [];

  for (const [lineageId, members] of multi) {
    if (analyzed >= LIMIT) break;
    analyzed += 1;
    const live = members
      .map((m) => Object.assign({}, m, { bodyMtime: sessionBodyMtime(DATA_ROOT, m.id) }))
      .filter((m) => m.bodyMtime > 0);
    if (live.length < 2) continue;
    liveOk += 1;

    let lead = null;
    try {
      lead = leader.resolveContentLeader(DATA_ROOT, live.map((m) => ({ uid: m.uid, id: m.id })),
        { aliases: live.map((m) => m.id) });
    } catch (e) {
      samples.push({ lineageId, error: String(e && e.message || e) });
      continue;
    }
    const mtimeLatest = live.slice().sort((a, b) => b.bodyMtime - a.bodyMtime)[0];
    const sourceDiff = !!lead.leaderId && String(lead.leaderId) !== String(mtimeLatest.id);
    if (sourceDiff) sourceDiffers += 1;
    if (lead.kind === 'divergent' || lead.kind === 'insufficient') {
      divergent += 1;
      divergentBytes += sessionBytes(DATA_ROOT, mtimeLatest.id);
    }
    if (lead.kind === 'all-equal') contentNoop += 1;

    // 「动作」三态：水位线 `syncedAt` 是**按血缘**存的（键 = lineageId，值为时间戳），
    // 不是按 (lineageId,targetUid) —— copies 才是二元键。
    const baselineAt = Number(syncedAt[lineageId]) || 0;
    let mtimeVerdict = 'no-baseline';
    let contentVerdict = 'n/a';
    if (baselineAt > 0) {
      const changed = live.filter((m) => m.bodyMtime > baselineAt);
      mtimeVerdict = changed.length === 0 ? 'noop' : (changed.length >= 2 ? 'conflict' : 'sync');
      contentVerdict = lead.kind === 'all-equal' ? 'noop'
        : (lead.kind === 'divergent' || lead.kind === 'insufficient') ? 'conflict' : 'sync';
      if (mtimeVerdict === 'conflict') mtimeConflict += 1;
      if (mtimeVerdict === 'sync') mtimeSync += 1;
      if (mtimeVerdict !== contentVerdict) actionDiffers += 1;
    }
    const interesting = sourceDiff || (baselineAt > 0 && mtimeVerdict !== contentVerdict);
    if (interesting && samples.length < 12) {
      samples.push({
        lineageId: lineageId.slice(0, 8),
        members: live.length,
        mtime: mtimeVerdict,
        content: contentVerdict,
        contentKind: lead.kind,
        mtimeLatest: String(mtimeLatest.id).slice(0, 8),
        contentLeader: String(lead.leaderId || '').slice(0, 8),
        sourceDiff: sourceDiff,
        bytes: sessionBytes(DATA_ROOT, mtimeLatest.id),
        mtimes: live.map((m) => String(m.id).slice(0, 8) + '@' + new Date(m.bodyMtime).toISOString().slice(5, 16)),
      });
    }
  }

  console.log('分析血缘数            : ' + analyzed + '（本地两成员都在的: ' + liveOk + '）');
  console.log('[2] 源选择与 mtime 不同 : ' + sourceDiffers);
  console.log('[3] 动作与 mtime 不同   : ' + actionDiffers + '   （mtime 侧 conflict=' + mtimeConflict + ' / sync=' + mtimeSync + '；content 侧 equivalent=' + contentNoop + '）');
  console.log('[4] content 判 divergent: ' + divergent + '，涉及源侧体积 ≈ ' + (divergentBytes / 1048576).toFixed(1) + ' MB');
  console.log('');
  if (samples.length) {
    console.log('样例（最多 12 条）:');
    for (const s of samples) console.log('  ' + JSON.stringify(s));
  } else {
    console.log('样例: 无 —— 两种判据在被分析的血缘上结论一致。');
  }
}

main();
