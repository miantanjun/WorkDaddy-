#!/usr/bin/env node
/**
 * memory-governance.js 回归套件（LF）。
 *
 * 覆盖：
 *   [A] levelOf 阈值分级
 *   [B] pathPrefixes —— 前缀归并 + **四类假阳性必须被排掉**（中缀路径 / HTTP 路由 / 通配 / `..`）
 *   [C] backtickPaths —— 占位符与路由不参与存在性校验
 *   [D] factLines —— 去前缀符号、压空白、短行丢弃
 *   [E] listBackups —— 命中 .bak / .bak-124 / .bak-final 等
 *   [F] auditMemoryGovernance 端到端（fixture）：三层体积、错层、残留、日档、重复、死指针
 *   [F+] **只提醒不自动改写**（全部 findings.fix.kind === 'paste' 且 counts.autoFixable === 0）
 *   [G] formatMemoryGovernance 输出
 *   [H] daemon.js 接线 + build-mac-dmg.sh 白名单两处 + 行尾纪律
 *
 * 跑法：node .wd-analysis/test-memory-governance.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const gov = require('D:/WorkDaddy/scripts/memory-governance.js');

let pass = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); return true; }
  failures.push(name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 300)));
  console.log('  FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 300)));
  return false;
}
function sect(title) { console.log('\n== ' + title + ' =='); }

// ---------------------------------------------------------------- fixture
const TMP = 'D:/WorkDaddy/.wd-analysis/tmp-memory-governance';
const HOME = TMP + '/home';
const WS = TMP + '/ws';
function rmrf(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) rmrf(full);
      else fs.unlinkSync(full);
    }
    fs.rmdirSync(dir);
  } catch (_) { /* 不存在就算了 */ }
}
function mk(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

rmrf(TMP);

// 一条**同时**出现在用户级与工作区记忆里的事实 ⇒ 必须被判重复
const SHARED = '统一口径：所有时间戳一律用本地时区，禁止直接用 UTC 字符串做日期比较';
// 用户级记忆：超硬限额（4,000 字符）+ 反复提到某个具体项目目录（错层）
const userBody = [
  '# 用户级记忆',
  '',
  '- ' + SHARED,
  '- 项目实测在 D:/OtherProject/src/engine.js，另外 D:/OtherProject/docs 也有一份说明。',
  '- 本机主目录是 C:/Users/Lyon，工具链都装在那下面；再强调一次主目录 C:/Users/Lyon。',
  '- ' + 'P'.repeat(4200),
].join('\n');
mk(HOME + '/MEMORY.md', userBody);
// 云端档案：超 crit（16KB）
mk(HOME + '/memory/1d80c722_memory.md', 'C'.repeat(20000));
// 残留副本：① 云端目录里的 .bak ② 用户级目录里的 .bak-final
mk(HOME + '/memory/1d80c722_memory.md.bak', 'C'.repeat(19900));
mk(HOME + '/MEMORY.md.bak-final', 'old user memory');
// 身份文件（常驻，但很小 ⇒ 不该触发身份告警）
mk(HOME + '/SOUL.md', '# SOUL\n短\n');
mk(HOME + '/IDENTITY.md', '# IDENTITY\n短\n');
mk(HOME + '/USER.md', '# USER\n短\n');

// 工作区记忆：超硬限额（3,000 字符）+ 记了别的项目 + 死指针 / 活指针
const deadPointer = 'D:/WorkDaddy/scripts/not-there-xyz.js';
const livePointer = 'D:/WorkDaddy/scripts/memory-governance.js';
const projectBody = [
  '# 工作区记忆',
  '',
  '- ' + SHARED,
  '- 旧结论：D:/Elsewhere/alpha 与 D:/Elsewhere/beta 是同一套实现，别再分别维护。',
  '- 死指针示意：`' + deadPointer + '`',
  '- 活指针示意：`' + livePointer + '`',
  '- ' + 'Q'.repeat(3200),
].join('\n');
mk(WS + '/.workbuddy/memory/MEMORY.md', projectBody);
// 残留副本：工作区目录里的 .bak-124
mk(WS + '/.workbuddy/memory/MEMORY.md.bak-124', 'old project memory');
// 日档：一份 40 天前的（该蒸馏）+ 一份 50KB 的（偏大）
const staleDaily = mk(WS + '/.workbuddy/memory/2026-01-05.md', '小日档\n');
const FAT_DAILY_BYTES = 50 * 1024;
mk(WS + '/.workbuddy/memory/2026-09-22.md', 'F'.repeat(FAT_DAILY_BYTES));
const longAgo = Date.now() - 40 * 86400000;
try { fs.utimesSync(staleDaily, longAgo / 1000, longAgo / 1000); } catch (_) { /* 时间戳设不上就少一条断言 */ }

const report = gov.auditMemoryGovernance({ home: HOME, workspace: WS });
const keys = report.findings.map((f) => f.key);
const has = (key) => keys.indexOf(key) >= 0;
const find = (key) => report.findings.filter((f) => f.key === key)[0] || null;

// ================================================================ [A] levelOf
sect('[A] levelOf 阈值分级');
t('A1 低于 warn 为 ok', gov.levelOf(100, { warn: 200, crit: 400 }) === 'ok');
t('A2 达到 warn 为 warn', gov.levelOf(200, { warn: 200, crit: 400 }) === 'warn');
t('A3 达到 crit 为 crit', gov.levelOf(400, { warn: 200, crit: 400 }) === 'crit');
t('A4 缺阈值恒 ok', gov.levelOf(999999, null) === 'ok');
t('A5 非数字按 0', gov.levelOf('abc', { warn: 1, crit: 2 }) === 'ok');
t('A6 undefined 按 0', gov.levelOf(undefined, { warn: 1, crit: 2 }) === 'ok');

// ================================================================ [B] pathPrefixes
sect('[B] pathPrefixes（前缀归并 + 排假阳性）');
const prefixes = gov.pathPrefixes([
  '见 D:/WorkDaddy/scripts/daemon.js 与 D:\\WorkDaddy\\scripts\\inject.js 两处',
  '还有 D:/WorkDaddy/README.md',
  'C:/Users/Lyon/.workbuddy/MEMORY.md 是家目录',
  '/Users/someone/proj/a.js 是 macOS 路径',
].join('\n'), { ignorePrefixes: ['C:/Users/Lyon'] });
const byPrefix = Object.fromEntries(prefixes.map((item) => [item.prefix, item.count]));
t('B1 同一项目的斜杠/反斜杠写法合并计数', byPrefix['D:/WorkDaddy'] === 3, byPrefix);
t('B2 被忽略的前缀不出现', !byPrefix['C:/Users/Lyon'], Object.keys(byPrefix));
t('B3 macOS 项目路径被识别', byPrefix['/Users/someone'] === 1, byPrefix);

// ⚠️ 四类假阳性（全部是实机跑出来的，不是假想）
t('B4 中缀路径不产生假根目录（`foo/bar.js` 里的 `/bar.js`）',
  !gov.pathPrefixes('绕法：重定向文件再 Read / node -e / Grep / `.wd-tmp/run-with-path.js`')
    .some((item) => item.prefix.indexOf('run-with-path') >= 0),
  gov.pathPrefixes('绕法：重定向文件再 Read / node -e / Grep / `.wd-tmp/run-with-path.js`'));
t('B5 HTTP 路由不算文件系统目录',
  gov.pathPrefixes('路由 GET /api/context-audit 与 POST /api/account-health 都是路由').length === 0,
  gov.pathPrefixes('路由 GET /api/context-audit 与 POST /api/account-health 都是路由'));
t('B6 通配符不算路径', gov.pathPrefixes('`scripts/*.js` 与 `src/**/*.ts`').length === 0);
t('B7 `..` / `...` 不算路径', gov.pathPrefixes('写 D:/... 或 /d/... 表示省略').length === 0);
t('B8 Windows 盘符路径不要求白名单', gov.pathPrefixes('D:/Anywhere/x').length === 1);
t('B9 结果按出现次数降序', (() => {
  const out = gov.pathPrefixes('D:/A/x D:/A/y D:/B/z');
  return out.length === 2 && out[0].prefix === 'D:/A' && out[0].count === 2;
})());
t('B10 带扩展名的末段会被退掉（切到目录层）', (() => {
  const out = gov.pathPrefixes('D:/One/two.js');
  return out.length === 1 && out[0].prefix === 'D:/One';
})());

// ================================================================ [C] backtickPaths
sect('[C] backtickPaths（只校验明确写成路径的）');
const bt = gov.backtickPaths('见 `D:/WorkDaddy/scripts/daemon.js` 与 `D:\\WorkBuddy date\\<会话>\\` 还有 `D:/...` 与 `/api/account-health`');
t('C1 正常绝对路径被抽出', bt.some((item) => item.indexOf('scripts/daemon.js') >= 0));
t('C2 占位符 <会话> 被排除', !bt.some((item) => item.indexOf('<') >= 0), bt);
t('C3 省略写法 D:/... 被排除', !bt.some((item) => item.indexOf('..') >= 0), bt);
t('C4 HTTP 路由被排除（/api 不是文件系统根）', !bt.some((item) => item.indexOf('/api/') >= 0), bt);
const bt2 = gov.backtickPaths('`/memory = LF。禁` 这种反引号里是句子');
t('C5 含空格的反引号内容被排除（是句子不是路径）', bt2.length === 0, bt2);
const bt3 = gov.backtickPaths('`/Users/lyon/code/a.js` 是文件系统路径');
t('C6 白名单内的 POSIX 根会被保留', bt3.length === 1 && bt3[0] === '/Users/lyon/code/a.js', bt3);
t('C7 行尾分隔符被裁掉', gov.backtickPaths('`D:\\WorkDaddy\\scripts\\`')[0] === 'D:\\WorkDaddy\\scripts');

// ================================================================ [D] factLines
sect('[D] factLines（可比对的事实行）');
const facts = gov.factLines([
  '- 这是一条足够长的、应当被保留下来的事实行内容，用来验证前缀被剥掉',
  '* 另一条同样足够长的、应当被保留下来的事实行内容，用来验证星号前缀',
  '3. 编号列表里的、同样足够长的事实行内容，用来验证编号前缀被剥掉',
  '## 标题也足够长，应当被保留下来作为事实行的内容，验证井号前缀',
  '太短',
  '| a | b |',
].join('\n'));
t('D1 短行被丢弃', facts.length === 4 && !facts.some((line) => line === '太短'), facts);
t('D2 列表前缀被剥掉', facts.some((line) => line.indexOf('这是一条足够长') === 0), facts);
t('D3 星号前缀被剥掉', facts.some((line) => line.indexOf('另一条同样足够长') === 0), facts);
t('D4 编号前缀被剥掉', facts.some((line) => line.indexOf('编号列表里的') === 0), facts);
t('D5 井号前缀被剥掉', facts.some((line) => line.indexOf('标题也足够长') === 0), facts);
t('D6 表格行被跳过', !facts.some((line) => line.indexOf('|') === 0), facts);
const sentence = gov.factLines('- 一条结尾带句号的、足够长的应当被保留的事实行内容。');
t('D7 行尾句号被裁掉', sentence.length === 1 && sentence[0].slice(-1) !== '。', sentence);

// ================================================================ [E] listBackups
sect('[E] listBackups');
const bkDir = TMP + '/bk';
mk(bkDir + '/MEMORY.md.bak', 'x');
mk(bkDir + '/MEMORY.md.bak-124', 'x');
mk(bkDir + '/MEMORY.md.bak-final', 'x');
mk(bkDir + '/MEMORY.md', 'x');
mk(bkDir + '/note.txt', 'x');
const backs = gov.listBackups(bkDir);
t('E1 三种 .bak 形态都被命中', backs.length === 3, backs.map((item) => item.name));
t('E2 当前版本不被当成副本', !backs.some((item) => item.name === 'MEMORY.md'));
t('E3 无关文件不被误判', !backs.some((item) => item.name === 'note.txt'));
t('E4 目录不存在时返回空数组不抛错', gov.listBackups(TMP + '/no-such-dir').length === 0);

// ================================================================ [F] 端到端
sect('[F] auditMemoryGovernance 端到端');
t('F1 ok 为 true', report.ok === true);
t('F2 云端只认 *_memory.md，.bak 不算', report.layers.cloud.files.length === 1, report.layers.cloud.files.length);
t('F3 云端档案体积正确', report.layers.cloud.bytes === 20000, report.layers.cloud.bytes);
t('F4 工作区层被识别', report.layers.project.files.length === 1);
t('F5 日档两份都被识别', report.layers.daily.files.length === 2, report.layers.daily.files.length);
t('F6 常驻体积 = 云端 + 用户级 + 工作区 + 身份', report.injected.totalBytes ===
  report.layers.cloud.bytes + report.layers.user.bytes + report.layers.project.bytes + report.injected.identityBytes,
  report.injected);
t('F7 常驻条目数含身份三件套', report.injected.count === report.layers.cloud.files.length + 1 + 1 + 3, report.injected.count);

// --- 体积类 ---
t('F8 云端档案超标判 crit', find('cloud:' + HOME + '/memory/1d80c722_memory.md').severity === 'crit');
t('F9 用户级超硬限额判 crit', find('user:' + HOME + '/MEMORY.md').severity === 'crit');
t('F10 工作区超硬限额判 crit', find('project:' + WS + '/.workbuddy/memory/MEMORY.md').severity === 'crit');
t('F11 身份文件小则不告警', !keys.some((key) => key === 'identity'), keys);
t('F12 用户级告警里写明了 4000 硬限额', /4,000 chars\/session/.test(find('user:' + HOME + '/MEMORY.md').detail));
t('F13 工作区告警里写明了 3000 硬限额', /3,000 chars\/session/.test(find('project:' + WS + '/.workbuddy/memory/MEMORY.md').detail));

// --- 错层类 ---
t('F14 项目细节写进跨项目层被识别', has('misfit:user'));
t('F15 错层描述里点名了那个项目目录', /D:\/OtherProject/.test(find('misfit:user').detail), find('misfit:user').detail);
t('F16 工作区里记别的项目被识别', has('misfit:project'));
t('F17 别的项目目录名被点出', /D:\/Elsewhere/.test(find('misfit:project').detail), find('misfit:project').detail);
t('F18 错层告警是 warn 而非 crit', find('misfit:user').severity === 'warn' && find('misfit:project').severity === 'warn');
t('F19 记忆系统自己的家 / OS 主目录不会被误判为错层（C:/Users 被忽略）',
  !/C:\/Users/.test(find('misfit:user').detail), find('misfit:user').detail);
t('F20 路由不会被误判成别的项目目录',
  gov.pathPrefixes('- 闸门用 /api/account-health 的 excludedFromFailover', { ignorePrefixes: [] }).length === 0);

// --- 残留副本 ---
t('F21 三处目录的 .bak 都被收进来', report.backups.length === 3, report.backups.map((item) => item.name));
t('F22 残留副本被单列一条 finding', has('backups'));
t('F23 残留说明里点明「不占 token」', /不占 token/.test(find('backups').detail));

// --- 日档 ---
t('F24 过期日档被识别（40 天 > 30 天）', has('daily:stale'));
t('F25 过期日档 finding 里点名了文件', /2026-01-05\.md/.test(find('daily:stale').detail));
t('F26 偏大日档被识别', has('daily:fat'));
t('F27 偏大日档 finding 里点名了最大那份', /2026-09-22\.md/.test(find('daily:fat').detail));
t('F28 未过期日档不会被判 stale', !/2026-09-22\.md/.test(find('daily:stale').detail));

// --- 重复 ---
t('F29 跨文件重复的事实被识别', has('duplicate'));
t('F30 重复 finding 里点出了重复条目的开头', /统一口径/.test(find('duplicate').detail), find('duplicate').detail);

// --- 死指针 ---
t('F31 失效路径被识别', has('dead-pointer'));
t('F32 死指针里点名了那个不存在的文件', new RegExp(deadPointer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(find('dead-pointer').detail));
t('F33 存在的路径不会被误报为失效', !/memory-governance\.js/.test(find('dead-pointer').detail));
t('F34 checkPaths=false 时不做存在性校验', !gov.auditMemoryGovernance({
  home: HOME, workspace: WS, checkPaths: false,
}).findings.some((item) => item.key === 'dead-pointer'));

// --- 分层与排序 ---
t('F35 findings 按严重度降序（crit 在前）', (() => {
  const order = { crit: 0, warn: 1, ok: 2 };
  for (let i = 1; i < report.findings.length; i += 1) {
    if (order[report.findings[i - 1].severity] > order[report.findings[i].severity]) return false;
  }
  return true;
})(), report.findings.map((item) => item.severity));
t('F36 counts 与 findings 一致', report.counts.crit === report.findings.filter((item) => item.severity === 'crit').length
  && report.counts.warn === report.findings.filter((item) => item.severity === 'warn').length);
t('F37 每条 finding 都带 key / title / detail / action', report.findings.every((item) =>
  item.key && item.title && item.detail && item.action));
t('F38 每条 finding 都标了所属层', report.findings.every((item) => ['cloud', 'user', 'project', 'daily'].indexOf(item.layer) >= 0));

// --- 不给 workspace：跳过项目/日档两层 ---
const noWs = gov.auditMemoryGovernance({ home: HOME });
t('F39 不给 workspace 时项目层为空', noWs.layers.project.files.length === 0);
t('F40 不给 workspace 时日档层为空', noWs.layers.daily.files.length === 0);
t('F41 不给 workspace 时不报错层/重复', !noWs.findings.some((item) => item.key === 'misfit:project' || item.key === 'duplicate'));
t('F42 不给 workspace 时常驻成本照常统计（云端 + 用户级 + 身份）',
  noWs.injected.totalBytes === 20000 + Buffer.byteLength(userBody) + noWs.injected.identityBytes,
  { total: noWs.injected.totalBytes, userBytes: Buffer.byteLength(userBody), identity: noWs.injected.identityBytes });
t('F43 目录都不存在时不抛错、仍返回 ok', gov.auditMemoryGovernance({ home: TMP + '/nope', workspace: TMP + '/nope2' }).ok === true);

// ================================================================ [F+] 只提醒不自动改写
sect('[F+] 只提醒不自动改写（B2 的铁律）');
t('F44 counts.autoFixable 恒为 0', report.counts.autoFixable === 0);
t('F45 全部 findings 的 fix.kind 都是 paste', report.findings.every((item) =>
  item.fix && item.fix.kind === 'paste'), report.findings.map((item) => item.fix && item.fix.kind));
t('F46 没有任何 fix 带 fixId（auto 动作）', !report.findings.some((item) => item.fix && item.fix.fixId));
t('F47 每条 paste 指令都非空且指向具体文件/动作', report.findings.every((item) =>
  typeof item.fix.prompt === 'string' && item.fix.prompt.length > 20));
t('F48 报告里不含任何写盘/网络 API', !/writeFileSync|mkdirSync|renameSync|unlinkSync|fetch\(|http\.request/.test(
  fs.readFileSync('D:/WorkDaddy/scripts/memory-governance.js', 'utf8').split('if (require.main === module)')[0]));

// ================================================================ [G] 格式化
sect('[G] formatMemoryGovernance');
const md = gov.formatMemoryGovernance(report);
t('G1 输出含标题', md.indexOf('# 记忆治理巡检') === 0, md.slice(0, 40));
t('G2 输出含「只提醒、不自动改写」声明', /只提醒、不自动改写/.test(md));
t('G3 输出含常驻成本小节', /## 一、常驻成本/.test(md));
t('G4 输出含发现条数', /## 二、发现（\d+ 条/.test(md), md.match(/## 二、发现[^\n]*/));
t('G5 输出含下一步小节', /## 三、下一步/.test(md));
t('G6 空报告不崩', gov.formatMemoryGovernance({}).indexOf('# 记忆治理巡检') === 0);
t('G7 空报告写「无」', /- 无。/.test(gov.formatMemoryGovernance({ findings: [] })));
t('G8 格式化是纯函数（连跑两次结果一致）', gov.formatMemoryGovernance(report) === md);

// ================================================================ [H] 接线与纪律
sect('[H] 接线与纪律');
const MODULE_SRC = fs.readFileSync('D:/WorkDaddy/scripts/memory-governance.js', 'utf8');
const crlf = (MODULE_SRC.match(/\r\n/g) || []).length;
const loneLF = (MODULE_SRC.match(/(?<!\r)\n/g) || []).length;
t('H1 scripts/*.js 行尾必须是 CRLF', crlf > 400 && loneLF === 0, { crlf, loneLF });

const DAEMON = fs.readFileSync('D:/WorkDaddy/scripts/daemon.js', 'utf8');
t('H2 daemon 引入了 memory-governance 模块', DAEMON.includes("require('./memory-governance.js')"));
t('H3 有 GET /api/memory-audit 路由', DAEMON.includes("p === '/api/memory-audit'"));
t('H4 **没有** /api/memory-audit/fix 路由（只提醒不自动改写）',
  !/p === '\/api\/memory-audit\/fix'/.test(DAEMON));

/** 行锚点切片（⚠️ 别用「掩码字符串 + indexOf」：needle 里的字面量会被掩码掉 ⇒ 返 −1）。 */
function sliceRoute(src, anchor) {
  const ls = src.split('\r\n');
  const start = ls.findIndex((l) => l.trim().startsWith(anchor));
  if (start < 0) return '';
  let depth = 0;
  let seen = false;
  for (let i = start; i < ls.length; i += 1) {
    for (const ch of ls[i]) {
      if (ch === '{') { depth += 1; seen = true; }
      else if (ch === '}') depth -= 1;
    }
    if (seen && depth === 0) return ls.slice(start, i + 1).join('\n');
  }
  return '';
}
const route = sliceRoute(DAEMON, "if (req.method === 'GET' && p === '/api/memory-audit')");
t('H5 路由切片成功（非空且只切了一段）', route.length > 200 && route.length < 3000, route.length);
t('H6 路由调 auditMemoryGovernance', route.includes('memoryGovernance.auditMemoryGovernance('));
t('H7 home 传的是数据根 PROFILE.dataRoot（不是 os.homedir）',
  /home:\s*PROFILE\.dataRoot/.test(route) && !/os\.homedir\(\)/.test(route), route.match(/home:[^\n]*/));
t('H8 workspace 由调用方传入', /workspace:\s*url\.searchParams\.get\('workspace'\)/.test(route));
t('H9 路由是只读的（切片里没有写盘/切号调用）',
  !/writeFileSync|writeLimitFailoverState|automationSwitchAccount|fs\.renameSync/.test(route), route.slice(0, 200));
t('H10 路由有 try/catch 并把错误翻成 500', route.includes('catch (error)') && route.includes('500'));
t('H11 支持 format=md 返回 markdown', route.includes("format") && route.includes('formatMemoryGovernance'));
t('H12 没有覆盖既有标识符（require 只有一次）',
  (DAEMON.match(/const memoryGovernance = require/g) || []).length === 1);

const MAC = fs.readFileSync('D:/WorkDaddy/scripts/build-mac-dmg.sh', 'utf8');
t('H13 mac 白名单 for 循环里含新模块', /for f in [^;]*memory-governance\.js/.test(MAC));
t('H14 mac 显式白名单里含新模块', MAC.includes('"$APP/Contents/Resources/scripts/memory-governance.js"'));
t('H15 mac 白名单里新模块出现**两处**（两处缺一都会被打包守卫抓住）',
  (MAC.match(/memory-governance\.js/g) || []).length === 2, (MAC.match(/memory-governance\.js/g) || []).length);

const SUITES = fs.readFileSync('D:/WorkDaddy/.wd-analysis/run-regression-all.js', 'utf8');
t('H16 回归总入口已收录本套件', SUITES.includes('test-memory-governance.js'));

rmrf(TMP);

console.log('\n==== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
for (const f of failures) console.log('  · ' + f);
process.exit(failures.length ? 1 : 0);
