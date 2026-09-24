'use strict';
/*
 * test-session-dirty-wiring.js —— 「脏索引接线」的守卫（上游 1.2.6 吸纳 · 批次 3 / A1+A5-B6）。
 *
 * 批次 3 的形状是**接线就绪 + 开关默认关**：
 *   · 索引 + 持久化 + 新路由 + renderer feed = 真的接线（本套件 [A][C] 组）；
 *   · 规划期快路径 = **守卫版**：双重门控 ⇒ 今天**必然不可达**（[B] 组用「字段无人写入」证明它）。
 *
 * 为什么必须这么守：上游 1.2.109 原文「暂停持久化指纹快路径，恢复完整比较，避免旧映射误判」
 * —— **上游自己回滚过这条路**，后来靠「行修订号 + 启动批量校准 + fingerprintVersion:2 门控」
 * 才安全做回来。只摘「跳过扫描」那一半（不要门控）就是那条被回滚的错路。
 * 判据写反的后果不是变慢，是**静默漏同步**（该复制的会话不复制；界面正常、无报错、无红测试）。
 *
 * 跑法：node .wd-analysis/test-session-dirty-wiring.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAEMON = path.join(ROOT, 'scripts', 'daemon.js');
const INJECT = path.join(ROOT, 'scripts', 'inject.js');
const SRC = fs.readFileSync(DAEMON, 'utf8').replace(/\r\n/g, '\n');
const ISRC = fs.readFileSync(INJECT, 'utf8').replace(/\r\n/g, '\n');
const inject = require(INJECT);

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log(t); }

section('[A] daemon 侧：索引持久化 + 新路由 + 三道守卫 + 隐私边界');

ok(/const \{ createDirtyIndex \} = require\('\.\/session-dirty\.js'\);/.test(SRC),
  'A1 session-dirty.js 真的接进来了（不是抄了一份实现）');
ok(/const SESSION_DIRTY_FILE = path\.join\(DATA_DIR, 'session-dirty\.json'\);/.test(SRC),
  'A2 索引落在 DATA_DIR/session-dirty.json');
ok(/atomicWriteText\(SESSION_DIRTY_FILE, JSON\.stringify\(state\.index\.state\)/.test(SRC),
  'A3 ⭐ 落盘走**本地口径** atomicWriteText（不照抄上游的 replaceFileWithRetry 名字）');
ok(/}, 250\);/.test(SRC) && /if \(!state \|\| !state\.dirty \|\| state\.timer\) return;/.test(SRC) && /unref/.test(SRC),
  'A4 去抖 250ms + 已有定时器不重复注册 + unref（不为写一个索引把进程钉住）');
ok(/function markSessionDirty\(uid, sessionId, event\) \{[\s\S]{0,520}before\.at !== marker\.at \|\| before\.event !== marker\.event/.test(SRC),
  'A5 只有**真变化**才置脏（同一时刻的重复通知不写盘）');
ok(/function clearSessionDirty\(uid, sessionId, expectedAt\) \{[\s\S]{0,400}state\.index\.clear\(uid, sessionId, expectedAt\)/.test(SRC),
  'A6 clear 带 expectedAt（**并发到来的新事件不许被旧的在飞清理抹掉**）');

ok(/if \(req\.method === 'POST' && p === '\/api\/sessions\/dirty'\) \{/.test(SRC),
  'A7 路由存在：POST /api/sessions/dirty');
ok(/claimedUid !== currentUid[\s\S]{0,120}409[\s\S]{0,80}账号已切换/.test(SRC),
  'A8 守卫①：账号切换竞态 → 409（旧页面不许把新账号标脏）');
ok(/events\.length > 500[\s\S]{0,120}脏会话通知过多/.test(SRC),
  'A9 守卫②：单批 > 500 条 → 400');
ok(/for \(const event of events\) \{[\s\S]{0,260}!isValidSessionId\(id\)\) continue;/.test(SRC),
  'A10 守卫③：逐条用 isValidSessionId 过滤非法 id（id 会被当路径片段用）');
ok(/负载\*\*刻意\*\*只有会话 id 与事件名；正文永不出 WorkBuddy/.test(SRC),
  'A11 ⭐ 隐私边界写进代码注释：只上报 id + 事件名，正文不出 WorkBuddy（上游原文口径）');
ok(/if \(body\.ready === true\) markSessionDirtyBaseline\(uid\);/.test(SRC),
  'A12 `body.ready` 触发 baseline（此前该账号 fail-open = 全当脏）');
ok(/const uid = currentUid[\s\S]{0,200}accountBackupFile\(claimedUid\)/.test(SRC),
  'A13 声称的 uid 必须真有账号备份文件才认（不凭 renderer 一句话）');

section('[B] 规划期快路径：**守卫版**，今天必然不可达（用「字段无人写入」证明）');

ok(/if \(!index\.isInitialized\(sourceUid\)\) return false;/.test(SRC),
  'B1 门控①：索引未建基线 ⇒ 不跳过（fail-open，全当脏）');
ok(/if \(index\.shouldSync\(sourceUid, row && row\.id\)\) return false;/.test(SRC),
  'B2 门控②：该会话有脏标记 ⇒ 不跳过');
ok(/if \(Number\(mapping\.fingerprintVersion\) !== 2\) return false;/.test(SRC),
  'B3 门控③：映射必须是 `fingerprintVersion === 2`（上游 1.2.114+ 才引入的门控，**照抄不许省**）');
ok(/if \(!mapping \|\| !mapping\.targetId\) return false;/.test(SRC) && /catch \(_\) \{ return false; \}/.test(SRC),
  'B4 门控④：无映射 / 有异常 ⇒ 不跳过');

// ⭐ 不可达性的硬证明：全仓**出仓代码**里没有任何地方**写** fingerprintVersion。
// ⚠️ 必须先剥掉注释：我的门控注释里写了「映射必须是 fingerprintVersion === 2」，
//    而 `===` 的开头一个 `=` 会被「赋值」判据误判（这条自伤踩过一次）。
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const writers = [];
for (const dir of ['scripts']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/\.js$/.test(f)) continue;
    const code = stripComments(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'));
    if (/fingerprintVersion\s*:/.test(code) || /fingerprintVersion\s*=[^=]/.test(code)) writers.push(dir + '/' + f);
  }
}
ok(writers.length === 0,
  'B5 ⭐⭐ 出仓代码里没有任何地方**写** fingerprintVersion ⇒ 门控③永远不成立 ⇒ 快路径**今天必然不可达**（这是安全性的硬证据，不是注释）',
  writers);
ok(writers.length === 0 && /Number\(mapping\.fingerprintVersion\) !== 2/.test(SRC),
  'B5b 唯一出现该字段的地方就是门控本身的**读**（`!== 2` 判据），没有写方');
ok(/const dirtyFastpathOn = autoCopyDirtyFastpathEnabled\(\);/.test(SRC),
  'B6 开关在**规划开始读一次**，不在逐行判据里（否则每行都要读一次开关文件）');
ok(/function autoCopyDirtyFastpathEnabled\(\) \{[\s\S]{0,300}raw && raw\.enabled === true/.test(SRC),
  'B7 开关默认关：文件缺失 / 内容不是 {enabled:true} 都算关');
ok(/const planRows = dirtyFastpathOn\s*\n\s*\? selectedRows\.filter\(\(row\) => !isAutoCopyRowCleanByDirty\(source, row, rules\)\)\s*\n\s*: selectedRows;/.test(SRC),
  'B8 ⭐ 短路形态：`dirtyFastpathOn ? … : selectedRows` ⇒ 关着时**零额外读盘**（「加判据」不许变成「每行多读一次盘」）');
ok(/\.filter\(\(row\) => String\(row\.status \|\| ''\) !== 'archived'\);/.test(SRC),
  'B8b ⭐ 批次 3 **没有动** archived 过滤链的形态 —— 那条链是「归档行不参与复制」这条不变量的守卫锚点（改它 = 让不变量失去守卫；这条自伤踩过一次）');
ok(/const lineageSessionIds = planRows/.test(SRC) && /return planRows\.map\(\(row\) => Object\.assign/.test(SRC),
  'B8c 计划后续两步（建 lineage / 返回）都改用 planRows，没有漏掉一处');
ok(/1\.2\.109 原文/.test(SRC) && /上游自己回滚过/.test(SRC),
  'B9 代码里写明「上游自己回滚过这条路」（下一个改的人不必再踩一次）');
ok(/A5（revision 体系）落地/.test(SRC),
  'B10 写明真正的提速要等 A5 —— 不假装本批已提速');

section('[C] renderer 侧：tracker + 独立 feed + 解绑');

ok(/function createSessionDirtyTracker\(send, options\) \{/.test(ISRC) && /createSessionDirtyTracker: createSessionDirtyTracker,/.test(ISRC),
  'C1 createSessionDirtyTracker 已就位并导出（可单测的纯判据层）');
ok(/sessionDirtyTracker\.observe\(update\)/.test(ISRC) && /sessionDirtyTracker\.baseline\(records\)/.test(ISRC),
  'C2 feed 真的接了 observe + 首次快照当 baseline');
ok(/api\('\/api\/sessions\/dirty', \{[\s\S]{0,300}\.catch\(function \(\) \{\}\)/.test(ISRC),
  'C3 上报失败只吞掉（**绝不能影响会话本身运行**）');
ok(/与多会话监控\*\*各自独立订阅\*\*/.test(ISRC),
  'C4 与多会话监控各自独立订阅（脏标记=少做扫描；监控=续跑中断任务；合并会让重试/解绑互相牵连）');
ok(/registerDisposer\(function \(\) \{[\s\S]{0,600}sessionDirtyTracker\.destroy\(\);/.test(ISRC),
  'C5 有解绑（热更时旧订阅与定时器一并拆掉，不留堆叠）');
ok(/if \(!sessionDirtyRetryTimer\) sessionDirtyRetryTimer = setTimeout\(function \(\) \{[\s\S]{0,160}\}, 1500\);/.test(ISRC),
  'C6 会话资源拿不到时 1.5s 后重试（且不重复注册）');

section('[D] 行为级：tracker 的 baseline / 抖动过滤 / fail-open 语义');

const mkTracker = () => {
  const sent = [];
  const t = inject.createSessionDirtyTracker((p) => sent.push(p), { delay: 0 });
  return { t, sent };
};

if (typeof inject.createSessionDirtyTracker === 'function') {
  {
    const { t, sent } = mkTracker();
    t.baseline([{ id: 'session-a', status: 'completed', title: 'A' }]);
    ok(JSON.stringify(sent) === JSON.stringify([{ ready: true }]),
      'D1 ⭐ baseline 只发 `{ready:true}`，**历史行不被当成脏**', sent);
    ok(t.observe({ id: 'session-a', status: 'completed', title: 'A' }) === false,
      'D2 未变化的行 observe 返回 false');
    ok(t.observe({ id: 'session-a', status: 'running', title: 'A', updatedAt: 11, event: 'sessionUpdated' }) === true,
      'D3 标题/updatedAt 变化 ⇒ 算脏');
    t.flush();
    ok(JSON.stringify(sent[1]) === JSON.stringify([{ id: 'session-a', event: 'sessionUpdated' }]),
      'D4 批内容只有 `{id, event}`（**不含标题、不含正文** —— 隐私边界在 renderer 侧就守住）', sent[1]);
    t.destroy();
  }
  {
    const { t, sent } = mkTracker();
    t.baseline([{ id: 'session-a', title: 'A', status: 'completed', state: 'idle', active: false, terminal: true, updatedAt: 10, lastActivityAt: 10 }]);
    ok(t.observe({ id: 'session-a', title: 'A', status: 'running', state: 'hydrating', active: true, terminal: false, updatedAt: 10, lastActivityAt: 10, event: 'sessionUpdated' }) === false,
      'D5 ⭐ 账号 reload 的 status/state/active/terminal 全量抖动 ⇒ **不算脏**（那是 renderer 生命周期，不是内容）');
    t.flush();
    ok(JSON.stringify(sent) === JSON.stringify([{ ready: true }]), 'D6 该抖动一条都没上报', sent);
    t.destroy();
  }
  {
    const { t, sent } = mkTracker();
    t.baseline([{ id: 'session-a', title: 'A', updatedAt: 10, lastActivityAt: 10 }]);
    ok(t.observe({ id: 'session-a', title: 'A', updatedAt: 10, lastActivityAt: 11, status: 'completed', event: 'sessionUpdated' }) === false,
      'D7 ⭐ 只动 lastActivityAt（打开/激活已复制会话）⇒ 不算脏');
    t.flush();
    ok(JSON.stringify(sent) === JSON.stringify([{ ready: true }]), 'D8 该抖动一条都没上报', sent);
    t.destroy();
  }
  {
    const { t, sent } = mkTracker();
    ok(t.observe({ id: 'session-new', event: 'sessionCreated' }) === true,
      'D9 首次见到 + sessionCreated ⇒ 算脏（新建会话必须复制）');
    t.flush();
    ok(JSON.stringify(sent[0]) === JSON.stringify([{ id: 'session-new', event: 'sessionCreated' }]),
      'D10 新建会话如实上报', sent[0]);
    t.destroy();
  }
  {
    const { t } = mkTracker();
    ok(t.observe(null) === false && t.observe({}) === false && t.observe({ event: 'sessionUpdated' }) === false,
      'D11 没有 id 的更新一律忽略（不抛错、不上报）');
    t.destroy();
  }
}

section('[E] 纯索引模块的 fail-open 语义（与 test-session-dirty.js 互补，这里只守最要命那条）');

const { createDirtyIndex } = require(path.join(ROOT, 'scripts', 'session-dirty.js'));
if (typeof createDirtyIndex === 'function') {
  const idx = createDirtyIndex(null);
  ok(idx.shouldSync('account-a', 'session-a') === true,
    'E1 ⭐ 未建基线的账号 shouldSync 恒 true（**写反了就是静默漏同步**，不是变慢）');
  ok(idx.isInitialized('account-a') === false, 'E2 未建基线时 isInitialized = false');
  idx.markBaseline('account-a');
  ok(idx.isInitialized('account-a') === true && idx.shouldSync('account-a', 'session-a') === false,
    'E3 建基线后默认「干净」（只有被标脏的才要同步）');
  const marker = idx.mark('account-a', 'session-a', 'sessionUpdated', 100);
  ok(!!marker && idx.shouldSync('account-a', 'session-a') === true, 'E4 标脏后该会话要同步');
  ok(idx.clear('account-a', 'session-a', 99) === false, 'E5 ⭐ expectedAt 不匹配就不清（在飞的新事件不许被旧清理抹掉）');
  ok(idx.clear('account-a', 'session-a', 100) === true && idx.shouldSync('account-a', 'session-a') === false,
    'E6 匹配才清得掉');
}

console.log('');
console.log('结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
