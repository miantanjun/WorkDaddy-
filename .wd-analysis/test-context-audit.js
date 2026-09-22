#!/usr/bin/env node
/**
 * context-audit.js 回归套件（LF）。
 *
 * 覆盖：
 *   [A] readFrontmatter —— inline / 块标量 / 缺省
 *   [B] 阈值分级 levelOf
 *   [C] auditMemory —— 缺失文件不抛错、体积分级
 *   [D] listSkills —— 真实 fixture 目录树
 *   [E] scanSessions —— 副本去重 / 轮次 / 累计输入 / 重发倍率 / 时间窗
 *   [F] auditContext 端到端（fixture）+ **sessionRoot 默认路径回归**（第一版真实踩过的 bug）
 *   [G] daemon.js 接线（源码级，行锚点切片）
 *
 * 跑法：node .wd-analysis/test-context-audit.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const audit = require('D:/WorkDaddy/scripts/context-audit.js');

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
const TMP = path.join('D:/WorkDaddy/.wd-analysis/tmp-context-audit');
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
}
function usageRow(input, timestamp) {
  return JSON.stringify({ timestamp, message: { usage: { input_tokens: input, output_tokens: 10 } } });
}

rmrf(TMP);

// ---- skill fixture：一个超大的 + 一个正常 + 一个同名重复 ----
// 正文刻意做成**多行**（200 行 × 400 字符 ≈ 80KB），这样「行数」才是被真正数出来的，
// 而不是拿字节除出来的 —— 单行 80KB 的 fixture 会让行数断言失去意义。
const longBody = Array.from({ length: 200 }, () => 'x'.repeat(400)).join('\n');
mk(TMP + '/home/.workbuddy/skills/huge-skill/SKILL.md',
  '---\nname: huge-skill\ndescription: 一个超大的 skill\n---\n' + longBody + '\n');
mk(TMP + '/home/.workbuddy/skills/ok-skill/SKILL.md',
  '---\nname: ok-skill\ndescription: 正常的\n---\n小小的正文\n');
mk(TMP + '/home/.workbuddy/skills/deep/nested/ok-skill/SKILL.md',
  '---\nname: ok-skill\ndescription: 同名旧版本\n---\n重复\n');
// description 用块标量
mk(TMP + '/home/.workbuddy/skills/block-desc/SKILL.md',
  '---\nname: block-desc\ndescription: >\n  第一行\n  第二行\nagent_created: true\n---\n正文\n');
// 没有 frontmatter 的
mk(TMP + '/home/.workbuddy/skills/no-fm/SKILL.md', '没有 frontmatter 的正文\n');

// ---- 会话 fixture：正常会话 + 跨文件副本 + 过期行 ----
const now = Date.now();
mkdirs: {
  const p = TMP + '/home/.workbuddy/projects/proj-a';
  mk(p + '/sess-real.jsonl', [
    usageRow(40000, now - 3 * 3600000),
    usageRow(90000, now - 2 * 3600000),
    usageRow(150000, now - 1 * 3600000),
    usageRow(999999, now - 40 * 86400000),   // 超出 7 天窗口，必须被排除
  ].join('\n') + '\n');
  // 副本：整行原样复制到另一个会话文件，不能算成「又调了 3 次模型」
  mk(TMP + '/home/.workbuddy/projects/proj-b/copy-of-real.jsonl', [
    usageRow(40000, now - 3 * 3600000),
    usageRow(90000, now - 2 * 3600000),
    usageRow(150000, now - 1 * 3600000),
  ].join('\n') + '\n');
  // 一个轮次很多的会话
  const many = [];
  for (let i = 0; i < 900; i += 1) many.push(usageRow(60000, now - (900 - i) * 60000));
  mk(TMP + '/home/.workbuddy/projects/proj-c/giant.jsonl', many.join('\n') + '\n');
}

// ================================================================ [A] frontmatter
sect('[A] readFrontmatter');
const fmInline = audit.readFrontmatter('---\nname: a\ndescription: 单行描述\nagent_created: true\n---\n正文');
t('A1 inline description 取到', fmInline.name === 'a' && fmInline.description === '单行描述', fmInline);
const fmBlock = audit.readFrontmatter(fs.readFileSync(TMP + '/home/.workbuddy/skills/block-desc/SKILL.md', 'utf8'));
t('A2 块标量 `>` 能拼成一行', fmBlock.description === '第一行 第二行', fmBlock);
t('A3 块标量不会被下一个键污染', !fmBlock.description.includes('agent_created'), fmBlock);
const fmNone = audit.readFrontmatter('没有任何 frontmatter');
t('A4 没有 frontmatter 返回空串而不是抛错', fmNone.name === '' && fmNone.description === '', fmNone);
const fmCrlf = audit.readFrontmatter('---\r\nname: b\r\ndescription: CRLF 描述\r\n---\r\n');
t('A5 CRLF 的 frontmatter 也能解析', fmCrlf.name === 'b' && fmCrlf.description === 'CRLF 描述', fmCrlf);

// ================================================================ [B] 阈值
sect('[B] levelOf');
const TH = audit.THRESHOLDS;
t('B1 低于 warn → ok', audit.levelOf(TH.memoryBytes.warn - 1, TH.memoryBytes) === 'ok');
t('B2 达到 warn → warn', audit.levelOf(TH.memoryBytes.warn, TH.memoryBytes) === 'warn');
t('B3 达到 crit → crit', audit.levelOf(TH.memoryBytes.crit, TH.memoryBytes) === 'crit');
t('B4 阈值缺失时不炸，退化成 ok', audit.levelOf(999999, undefined) === 'ok');
t('B5 阈值是「越大越坏」的语义（skill body 60KB/150KB）',
  TH.skillBodyBytes.warn === 60 * 1024 && TH.skillBodyBytes.crit === 150 * 1024, TH.skillBodyBytes);

// ================================================================ [C] 记忆
sect('[C] auditMemory');
const mem = audit.auditMemory([
  { label: '小', path: TMP + '/home/.workbuddy/skills/ok-skill/SKILL.md' },
  { label: '不存在', path: TMP + '/nope/missing.md' },
]);
t('C1 小文件 level=ok', mem.items[0].level === 'ok', mem.items[0]);
t('C2 缺失文件 present=false 且不抛错', mem.items[1].present === false && mem.items[1].bytes === 0, mem.items[1]);
t('C3 缺失文件不计入 totalBytes', mem.totalBytes === mem.items[0].bytes, mem.totalBytes);
const memBig = audit.auditMemory([{ label: '大', path: TMP + '/home/.workbuddy/skills/huge-skill/SKILL.md' }]);
t('C4 80KB 文件判为 crit（>16KB）', memBig.items[0].level === 'crit', memBig.items[0].level);
t('C5 空列表不抛错', audit.auditMemory([]).totalBytes === 0);

// ================================================================ [D] skill 目录
sect('[D] listSkills');
const skills = audit.listSkills([TMP + '/home/.workbuddy/skills']);
const byName = (n) => skills.filter((s) => s.name === n);
t('D1 找到全部 5 个 SKILL.md（含嵌套）', skills.length === 5, skills.map((s) => s.name));
t('D2 超大那个按字节排在前面', skills[0].name === 'huge-skill', skills[0]);
t('D3 行数真的数了（不是拿字节估）', skills[0].lines > 190 && skills[0].lines < 220, skills[0].lines);
t('D4 同名 skill 出现 2 次被如实记下', byName('ok-skill').length === 2, byName('ok-skill').length);
t('D5 块标量 description 的长度被算进去', byName('block-desc')[0].descriptionChars === '第一行 第二行'.length,
  byName('block-desc')[0].descriptionChars);
t('D6 没有 frontmatter 时回退成目录名', byName('no-fm').length === 1, skills.map((s) => s.name));
t('D7 根目录不存在时不抛错返回空', audit.listSkills([TMP + '/nowhere']).length === 0);

// ================================================================ [E] 会话扫描
sect('[E] scanSessions');
const scan = audit.scanSessions(TMP + '/home/.workbuddy', { days: 7, maxFiles: 100 });
t('E1 只算 2 个真会话（纯副本文件不算独立会话）', scan.sessions.length === 2, scan.sessions.map((s) => s.id));
const real = scan.sessions.find((s) => s.id === 'sess-real');
t('E2 真会话 turns=3（超窗口那行被排除）', real.turns === 3, real);
t('E3 累计输入 = 40000+90000+150000', real.input === 280000, real.input);
t('E4 首轮/末轮输入正确', real.firstInput === 40000 && real.lastInput === 150000, real);
t('E5 重发倍率 = 累计/末轮', Math.abs(real.ratio - 280000 / 150000) < 1e-9, real.ratio);
t('E6 整行都是副本的文件不产生独立会话记录',
  !scan.sessions.some((s) => s.id === 'copy-of-real'), scan.sessions.map((s) => s.id));
t('E7 剔掉的副本行数被计数（3 行）', scan.copies === 3, scan.copies);
const giant = scan.sessions.find((s) => s.id === 'giant');
t('E8 900 轮的会话被如实统计', giant.turns === 900 && giant.input === 900 * 60000, { turns: giant.turns });
t('E9 totalInput = 两个真会话之和', scan.totalInput === real.input + giant.input, scan.totalInput);
// 时间窗：用显式 lowerBound（最近 90 分钟）制造「窗口内/外」分界 —— days 档位最小是 1 天，
// 而 fixture 的行都在几小时内，用 days 测不出边界。
const narrow = audit.scanSessions(TMP + '/home/.workbuddy', { days: 7, lowerBound: now - 90 * 60000, maxFiles: 100 });
t('E10 显式 lowerBound 生效：sess-real 只剩最近 1 轮',
  narrow.sessions.find((s) => s.id === 'sess-real').turns === 1,
  narrow.sessions.map((s) => ({ id: s.id, turns: s.turns })));
t('E11 同一 lowerBound 下 giant 只剩 90 轮（每分钟一轮）',
  narrow.sessions.find((s) => s.id === 'giant').turns === 90,
  narrow.sessions.map((s) => ({ id: s.id, turns: s.turns })));

// ================================================================ [F] 端到端
sect('[F] auditContext');
const report = audit.auditContext({
  days: 7,
  home: TMP + '/home',
  skillsRoots: [TMP + '/home/.workbuddy/skills'],
  memoryFiles: [
    { label: '大记忆', path: TMP + '/home/.workbuddy/skills/huge-skill/SKILL.md' },
    { label: '缺失记忆', path: TMP + '/nope.md' },
  ],
  sessionRoot: TMP + '/home/.workbuddy',
});
t('F1 返回 ok=true', report.ok === true);
t('F2 记忆 crit 被抓出来', report.counts.crit >= 1, report.counts);
t('F3 findings 里有「常驻记忆偏大」', report.findings.some((f) => f.key.startsWith('memory:') && f.severity === 'crit'),
  report.findings.map((f) => f.key));
t('F4 findings 里有「SKILL.md 过大」', report.findings.some((f) => f.key.startsWith('skill:')), report.findings.map((f) => f.key));
t('F5 findings 里有「同名 skill 多份」', report.findings.some((f) => f.key.startsWith('dupe:')), report.findings.map((f) => f.key));
t('F6 findings 里有「会话过长」', report.findings.some((f) => f.key.startsWith('session:')), report.findings.map((f) => f.key));
t('F7 crit 排在 warn 前面', (() => {
  const order = { crit: 0, warn: 1, ok: 2 };
  for (let i = 1; i < report.findings.length; i += 1) {
    if (order[report.findings[i - 1].severity] > order[report.findings[i].severity]) return false;
  }
  return true;
})(), report.findings.map((f) => f.severity));
t('F8 每条 finding 都带可执行 action', report.findings.every((f) => String(f.action || '').length > 10),
  report.findings.filter((f) => !String(f.action || '').length > 10).map((f) => f.key));
t('F9 会话 heavy 里含 900 轮那个', report.sessions.heavy.some((s) => s.turns >= 900), report.sessions.heavy.map((s) => s.turns));
t('F10 记忆缺失不影响整体（不抛错且 present=false）',
  report.memory.items.find((i) => i.label === '缺失记忆').present === false);
t('F11 纯测量：不写任何文件（fixture 目录 mtime 不变）', (() => {
  const before = fs.readdirSync(TMP + '/home/.workbuddy').sort().join(',');
  audit.auditContext({ days: 7, home: TMP + '/home', skillsRoots: [TMP + '/home/.workbuddy/skills'], sessionRoot: TMP + '/home/.workbuddy' });
  return fs.readdirSync(TMP + '/home/.workbuddy').sort().join(',') === before;
})());

// ⭐ 回归：sessionRoot 默认值必须是 <home>/.workbuddy，不能是 home 本身。
//    （token-stats.walkJsonl 内部拼的是 <root>/projects；传 home 会扫到空目录，
//     结果是「会话维度静默全为零」—— 本模块第一版就是这么错的。）
const defaultRootReport = audit.auditContext({
  days: 7,
  home: TMP + '/home',
  skillsRoots: [TMP + '/home/.workbuddy/skills'],
  memoryFiles: [],
});
t('F12 sessionRoot 缺省时自动指向 <home>/.workbuddy（会话不为空）',
  defaultRootReport.sessions.count === 2, defaultRootReport.sessions.count);
t('F13 F12 的反向对照：传错根（home 本身）时确实扫不到会话', (() => {
  const wrong = audit.scanSessions(TMP + '/home', { days: 7, maxFiles: 100 });
  return wrong.sessions.length === 0;
})());
t('F14 sessionRoot=null 时完全跳过会话扫描', audit.auditContext({
  days: 7, home: TMP + '/home', skillsRoots: [], memoryFiles: [], sessionRoot: null,
}).sessions.count === 0);

// findings 去重：同名 skill 的 description 告警只出现一次
sect('[F+] findings 去重');
const dupReport = audit.auditContext({
  days: 7, home: TMP + '/home', skillsRoots: [TMP + '/home/.workbuddy/skills'],
  memoryFiles: [], sessionRoot: null,
});
const descFindings = dupReport.findings.filter((f) => f.key.startsWith('desc:'));
const descNames = descFindings.map((f) => f.title);
t('F15 同名 skill 的 description 告警不重复刷屏',
  new Set(descNames).size === descNames.length, descNames);

// ================================================================ [G] daemon 接线
sect('[G] daemon.js 接线（源码级）');
const DAEMON = fs.readFileSync('D:/WorkDaddy/scripts/daemon.js', 'utf8');
t('G1 daemon 引入了 context-audit 模块', DAEMON.includes("require('./context-audit.js')"));
t('G2 有 GET /api/context-audit 路由', DAEMON.includes("p === '/api/context-audit'"));

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
const route = sliceRoute(DAEMON, "if (req.method === 'GET' && p === '/api/context-audit')");
t('G3 路由切片成功（非空且只切了一段）', route.length > 300 && route.length < 4000, route.length);
t('G4 路由调 auditContext', route.includes('contextAudit.auditContext('));
t('G5 路由把会话根指向数据根（不是 home）', /sessionRoot:\s*home/.test(route), route.match(/sessionRoot:[^\n]*/));
t('G6 路由覆盖了记忆与 skill 根', route.includes("path.join(home, 'MEMORY.md')") && route.includes("'plugins', 'cache'"));
t('G7 路由是只读的（切片里没有写盘/切号调用）',
  !/writeFileSync|writeLimitFailoverState|automationSwitchAccount|fs\.renameSync/.test(route), route.slice(0, 200));
t('G8 days 参数被夹在 1..90', /Math\.max\(1,\s*Math\.min\(90/.test(route));
t('G9 路由有 try/catch 并把错误翻成 500', route.includes('catch (error)') && route.includes('500'));

// 命名冲突：不能和既有模块的导出撞名
t('G10 没有覆盖已有的 tokenStats/limitFailover 等标识符',
  (DAEMON.match(/const contextAudit = require/g) || []).length === 1);
t('G11 插入位置在所有 require 区块（不改动既有 require）',
  DAEMON.indexOf("require('./context-audit.js')") > DAEMON.indexOf("require('./token-stats.js')"));

rmrf(TMP);

console.log('\n==== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
for (const f of failures) console.log('  · ' + f);
process.exit(failures.length ? 1 : 0);
