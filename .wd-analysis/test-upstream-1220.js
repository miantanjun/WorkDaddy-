#!/usr/bin/env node
'use strict';
/**
 * 上游 1.2.20 吸纳回归守卫（2026-11-11）
 * ============================================================
 * 覆盖本轮四批吸纳：
 *   [A] 会话复制错误文案白名单 + taskFailed + fork sessionId 重绑 + patch-108
 *   [B] 限流码表**并集六码**（本地放宽 vs 上游收窄 —— 本测试把方向钉死）
 *   [C] workspace repair 改 opt-in（默认关闭）
 *   [D] inject 侧拖动排序/仅插入（结构守卫，不跑 DOM）
 *
 * ⚠️ 关键反例守卫：若有人日后「照抄上游」把码表收窄成 [6000,6004]，
 *    B3 会立刻变红 —— 因为那等于回退本地 BUG4 修复。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const S = (name) => path.join(ROOT, 'scripts', name);
const read = (name) => fs.readFileSync(S(name), 'utf8');

let passed = 0, failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (extra === undefined ? '' : '  → ' + extra)); }
}
function section(title) { console.log('\n' + title); }

const daemon = read('daemon.js');
const inject = read('inject.js');
const store = read('credit-usage-store.js');
const patches = read('theme-patches.js');
const copyErr = read('session-copy-error.js');

/* ==================================================================== */
section('[A] 会话复制错误文案白名单 + taskFailed + fork 重绑 + patch-108');

ok(/const \{ sanitizeSessionCopyError \} = require\('\.\/session-copy-error\.js'\);/.test(daemon),
  'A1 daemon 引入 sanitizeSessionCopyError');
ok(/job\.error = sanitizeSessionCopyError\(e\);/.test(daemon),
  'A2 ① runAutoCopyQueue 的 catch 走白名单，不再裸 e.message');
ok(/job\.taskFailed = true;/.test(daemon),
  'A2 taskFailed 标记落库');
ok(/taskFailed: job\.status === 'error',/.test(daemon),
  'A3 publicAutoCopyJob 暴露 taskFailed（前端据此给「重试」而非「查看详情」）');
ok(/log\(`\[sessions-auto-copy\] 任务失败: \$\{job\.error\}`\)/.test(daemon),
  'A4 日志同样只写白名单文案（原文不进日志）');

// 白名单模块本身
// ⚠️ 守卫必须排除注释行 —— 本文件注释里刻意写明了「上游是 require('./account-identity')」，
//    不排除注释就会把「已内联」误判成「仍依赖」。
const copyErrCode = copyErr.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
ok(!/require\('\.\/account-identity'\)/.test(copyErrCode),
  'A5 session-copy-error.js **零依赖**（注释之外的代码里无 account-identity 依赖）');
['SQLITE_BUSY', 'SQLITE_LOCKED', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC',
  'SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_ERROR'].forEach((token) => {
    ok(copyErr.includes(token), 'A6 白名单覆盖 ' + token);
  });
ok(/WBS_AMBIGUOUS_SESSION_ACCOUNT/.test(copyErr), 'A7 保留歧义账号 code 分支');
ok(/module\.exports = \{ sanitizeSessionCopyError \};/.test(copyErr), 'A8 导出面正确');

// fork 重绑
ok(/value\.sessionId !== src\.id/.test(daemon) && /sessionId: id/.test(daemon),
  'A9 fork 只重绑「源会话外壳」那一行（value.sessionId === src.id ⇒ 换新 id）');
ok(/plan\.records\.slice\(0, plan\.keptRecords\)\.map/.test(daemon),
  'A10 逐行映射基于 keptRecords 切片（消息 ID/payload/子会话保留原身份）');
ok(!/writeFile\(target, plan\.text/.test(daemon),
  'A11 旧写法（直写 plan.text）已清除 —— 否则 sessionId 不重绑');

// patch-108
const p108 = /id: 'patch-108',[\s\S]{0,600}?\.wb-dropdown__item-reason-hit\{background:transparent !important;border-color:transparent !important;box-shadow:none !important;\}/;
ok(p108.test(patches), 'A12 patch-108 已登记且 CSS 三件套齐全');
ok(/html\[data-wbs-theme-id\] body\[data-vscode-theme-name\] \.wb-popover\.wb-dropdown\.cr-workspace-picker-dropdown/.test(patches),
  'A13 patch-108 选择器与上游一致（无 themeId ⇒ 全主题生效）');
const p108Block = patches.slice(patches.indexOf("id: 'patch-108'"));
const p108Entry = p108Block.slice(0, p108Block.indexOf('},'));
ok(!/themeId:/.test(p108Entry), 'A14 patch-108 **不带 themeId**（照抄上游，别自作聪明加 nebula）');

/* ==================================================================== */
section('[B] 限流码表并集六码（本地放宽 ⊕ 上游 6000）');

ok(/const MODEL_LIMIT_CODES = \[14012, 14014, 14018, 14019, 6000, 6004\];/.test(store),
  'B1 credit-usage-store 单一定义 MODEL_LIMIT_CODES 六码');
ok(/MODEL_LIMIT_CODES,/.test(store), 'B2 该常量已导出（供 daemon 路由共用，避免两处漂移）');
const storeCode = store.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
ok(!/if \(reason !== 6000 && reason !== 6004\) throw/.test(storeCode),
  'B3 ⭐ **反例守卫**：未照抄上游收窄（照抄 = 打死本地 14012/14014/14018/14019 = BUG4 回退）');
ok(/if \(reason !== null && MODEL_LIMIT_CODES\.indexOf\(reason\) < 0\) throw/.test(store),
  'B4 saveModelRateLimit 改为按并集六码校验');
ok(/async function hasModelRateLimitElsewhere\(\{ uid, modelId, resetAt, reasonCode, now \}\)/.test(store),
  'B5 hasModelRateLimitElsewhere 增加 reasonCode 形参');
// ⚠️ SQL 里是 `reason_code = ? AND reset_at > ?`（SQL 的 AND，不是 JS 的 &&）—— 这里是最容易写错的一处。
ok(/reason_code = \? AND reset_at > \?/.test(store),
  'B6 SQL 加 reason_code 条件（6000 用量 ≠ 6004 频率，两类封锁不再互相误判重复）');
ok(/reasonCode === null \|\| reasonCode === undefined \? 6004 : Number\(reasonCode\)/.test(store),
  'B7 缺省 reasonCode = 6004（保持旧调用点行为不变）');

ok(/const RATE_LIMIT_CODES = CREDIT_USAGE_STORE\.MODEL_LIMIT_CODES;/.test(daemon),
  'B8 daemon 路由引用同一常量（不再是硬编码副本）');
ok(/reasonCode, now: Date\.now\(\) \}/.test(daemon),
  'B9 daemon 已把 reasonCode 透传给 hasModelRateLimitElsewhere');
ok(/AUTO_CONTINUE_QUOTA_CODES = \{ 14012: true, 14014: true, 14018: true, 14019: true, 6000: true, 6004: true \};/.test(inject),
  'B10 inject 渲染层码表同步加 6000（与 daemon 侧口径一致）');

/* ==================================================================== */
section('[C] workspace repair 改 opt-in（默认关闭）');

ok(/process\.env\.WORKDADDY_REPAIR_MISSING_SESSION_WORKSPACES !== '1'/.test(daemon),
  'C1 门控存在：未显式设 =1 时直接早退');
// 门控必须落在函数入口的**同一段**（平台判断之后一行即可，都早于任何 sqliteQuery），
// 取「函数定义 → 第一处 sqliteQuery」之间的片段做断言。
const rmr = daemon.slice(daemon.indexOf('function repairMissingSessionWorkspaces()'));
const rmrHead = rmr.slice(0, rmr.indexOf('sqliteQuery'));
ok(/IS_WIN/.test(rmrHead) && /WORKDADDY_REPAIR_MISSING_SESSION_WORKSPACES/.test(rmrHead),
  'C2 门控落在任何查询/扫描之前（与平台判断同处函数入口）');
ok(/WORKDADDY_REPAIR_MISSING_SESSION_WORKSPACES/.test(daemon) && !/WORKDADDY_REPAIR_MISSING_SESSION_WORKSPACES.*= '0'/.test(daemon),
  'C3 opt-in 语义正确（要显式 =1 才开，不是「非 0 即开」）');

/* ==================================================================== */
section('[D] inject 侧拖动排序 / 仅插入（结构守卫）');

ok(/var qpSortCleanup = null;/.test(inject), 'D1 声明 qpSortCleanup 清理句柄');
ok(/function createQuickPhraseSorter\(list, commit, reportError\)/.test(inject),
  'D2 sorter 工厂存在且签名与上游一致');
ok(/qpSortCleanup = createQuickPhraseSorter\(listEl, function \(ordered\)/.test(inject),
  'D3 renderQpList 接线 sorter');
ok(/if \(qpSortCleanup\) \{ try \{ qpSortCleanup\(\); \} catch \(_\) \{\} qpSortCleanup = null; \}/.test(inject),
  'D4 ⭐ 重建前先拆旧 sorter（否则每刷新一次就多一套 document/window 监听）');
ok(/if \(!sessState\.qpBatch\) \{\s*\n\s*qpSortCleanup = createQuickPhraseSorter/.test(inject),
  'D5 批量模式下不启用拖动（拖动会与勾选/全选交互打架）');
ok(/data-qp-drag draggable="true"/.test(inject), 'D6 拖动手柄带 draggable 属性');
ok(/'\[data-qp-drag\]'\)/.test(inject) || /querySelector\('\[data-qp-drag\]'\)/.test(inject),
  'D7 sorter 以 [data-qp-drag] 定位手柄（与本地 DOM 约定一致）');

ok(/data-qp-insert/.test(inject), 'D8 仅插入按钮已渲染');
ok(/\/api\/quick-phrase-insert/.test(inject), 'D9 前端调用 /api/quick-phrase-insert');
ok(/\/api\/quick-phrase-reorder/.test(inject), 'D10 前端调用 /api/quick-phrase-reorder');
ok(/if \(!editor\) \{ toast\('未找到输入框', true, root\); return; \}/.test(inject),
  'D11 找不到输入框时前端先拦（不发请求，避免 daemon 白失败）');
ok(/var listScrollTop = listEl\.scrollTop;/.test(inject) && /listEl\.scrollTop = listScrollTop;/.test(inject),
  'D12 重建列表保留滚动位置');
ok(/\.wbs-qp-drag\{/.test(inject) && /\.wbs-qp-dragging\{/.test(inject) && /\.wbs-explore-ins\{/.test(inject),
  'D13 新增三条 CSS 已落（手柄/拖动中/仅插入按钮）');

/* ==================================================================== */
section('[E] daemon 侧新路由与函数');

ok(/function reorderQuickPhrases\(ids\)/.test(daemon), 'E1 reorderQuickPhrases 存在');
ok(/function insertQuickPhraseIntoComposer\(text\)/.test(daemon), 'E2 insertQuickPhraseIntoComposer 存在');
ok(/p === '\/api\/quick-phrase-reorder'/.test(daemon), 'E3 路由 /api/quick-phrase-reorder');
ok(/p === '\/api\/quick-phrase-insert'/.test(daemon), 'E4 路由 /api/quick-phrase-insert');
ok(/await cdpSend\('Input\.insertText', \{ text: value \}\);/.test(daemon),
  'E5 插入走 CDP Input.insertText（不发送）');
ok(/if \(ids\.length !== state\.phrases\.length\) throw new Error\('快捷短语列表已变化，请刷新后重试'\);/.test(daemon),
  'E6 reorder 全量校验（数量不符即拒，防半截写入丢短语）');
ok(/if \(!id \|\| seen\.has\(id\) \|\| !byId\.has\(id\)\) throw new Error\('快捷短语顺序无效'\);/.test(daemon),
  'E7 reorder 拒绝空/重复/不存在的 id');
ok(/if \(value\.length > 10000\) throw new Error\('快捷短语过长'\);/.test(daemon),
  'E8 insert 长度上限 10000');

/* ==================================================================== */
section('[F] 打包白名单（新增模块必须登记，否则发版即崩）');

const mac = fs.readFileSync(S('build-mac-dmg.sh'), 'utf8');
const hits = (mac.match(/session-copy-error\.js/g) || []).length;
// 两处即可：① 第 59 行「复制运行时代码」的 for 循环白名单；② chmod 644 列表。
ok(hits === 2, 'F1 session-copy-error.js 在 build-mac-dmg.sh 出现 2 次（循环白名单 + chmod 列表）', hits);

try {
  const { reachableModules, macWhitelistMissing } = require('../.wd-analysis/packaging-whitelist.js');
  const reachable = reachableModules(ROOT, 'daemon.js');
  const missing = macWhitelistMissing(ROOT, 'daemon.js');
  ok(missing.length === 0, 'F2 ⭐ mac 白名单 0 缺失（工具自查，可达模块 ' + reachable.length + ' 个）', missing.join(','));
} catch (e) {
  ok(false, 'F2 白名单自查工具调用失败', e.message);
}

/* ==================================================================== */
console.log('\n' + (failed === 0 ? '✅' : '❌') + '  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
