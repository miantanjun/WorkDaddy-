#!/usr/bin/env node
/**
 * context-fix.js 回归套件（LF）。
 *
 * 覆盖：
 *   [A] readActiveVersions —— 认 installed_plugins.json（缺文件/坏 JSON/缺 version 都不炸）
 *   [B] listPruneTargets  —— 真实 fixture 目录树；保留激活版本；state 无记录时回退排序
 *   [C] dryRun            —— 只列清单，绝不碰文件系统
 *   [D] pruneSkillDupes   —— 真移动；激活版本与单版本目录**不被误移**；幂等；分批
 *   [E] applyContextFix   —— 未知 fixId 拒绝；已知 fixId 走通
 *   [F] 边界              —— 无 cache 目录；dirSize
 *   [G] 接线（源码级）     —— daemon 路由 / mac 白名单
 *
 * 跑法：node .wd-analysis/test-context-fix.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const fix = require('D:/WorkDaddy/scripts/context-fix.js');
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
const TMP = path.join('D:/WorkDaddy/.wd-analysis/tmp-context-fix');
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

function buildFixture() {
  rmrf(TMP);
  const root = TMP;
  const cacheRoot = path.join(root, 'plugins', 'cache');
  const stateFile = path.join(root, 'plugins', 'installed_plugins.json');
  const backupRoot = path.join(root, 'backup');
  // alpha：state 记录激活 2.0.0 ⇒ 1.0.0 是冗余
  mk(path.join(cacheRoot, 'vendor', 'alpha', '1.0.0', 'SKILL.md'), '# alpha 1.0.0\n' + 'x'.repeat(300));
  mk(path.join(cacheRoot, 'vendor', 'alpha', '2.0.0', 'SKILL.md'), '# alpha 2.0.0\n');
  // beta：单版本 ⇒ 不产生任何 item
  mk(path.join(cacheRoot, 'vendor', 'beta', '1.0.0', 'SKILL.md'), '# beta 1.0.0\n');
  // gamma：state 里没有记录 ⇒ 回退到目录名排序最大（1.1.0）
  mk(path.join(cacheRoot, 'vendor', 'gamma', '0.9.0', 'SKILL.md'), '# gamma 0.9.0\n');
  mk(path.join(cacheRoot, 'vendor', 'gamma', '1.0.0', 'SKILL.md'), '# gamma 1.0.0\n');
  mk(path.join(cacheRoot, 'vendor', 'gamma', '1.1.0', 'SKILL.md'), '# gamma 1.1.0\n');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    version: 2,
    plugins: {
      'alpha@vendor': [{ scope: 'user', version: '2.0.0', installPath: path.join(cacheRoot, 'vendor', 'alpha', '2.0.0') }],
      // beta 故意留空数组：不应崩
      'beta@vendor': [],
    },
  }, null, 2));
  return { root, cacheRoot, stateFile, backupRoot };
}

// ================================================================ A
sect('[A] readActiveVersions —— 认状态文件，不猜');
{
  const f = buildFixture();
  const active = fix.readActiveVersions(f.stateFile);
  t('A1 读出 alpha 的激活版本 2.0.0', active.alpha === '2.0.0', active);
  t('A2 空数组条目被跳过（beta 无记录）', !active.beta, active);

  const missing = fix.readActiveVersions(path.join(f.root, 'nope.json'));
  t('A3 文件缺失返回空对象且不抛', missing && typeof missing === 'object' && Object.keys(missing).length === 0);

  const badFile = path.join(f.root, 'bad.json');
  mk(badFile, '{ this is not json');
  const bad = fix.readActiveVersions(badFile);
  t('A4 坏 JSON 返回空对象且不抛', bad && Object.keys(bad).length === 0);

  const noVer = path.join(f.root, 'noversion.json');
  mk(noVer, JSON.stringify({ plugins: { 'delta@v': [{ installPath: path.join(f.cacheRoot, 'vendor', 'delta', '3.3.3') }] } }));
  const fromPath = fix.readActiveVersions(noVer);
  t('A5 version 缺失时从 installPath 末段取', fromPath.delta === '3.3.3', fromPath);
}

// ================================================================ B
sect('[B] listPruneTargets —— 谁该移、谁不该移');
{
  const f = buildFixture();
  const plan = fix.listPruneTargets({ cacheRoot: f.cacheRoot, stateFile: f.stateFile, backupRoot: f.backupRoot });
  t('B1 ok', plan.ok === true);
  t('B2 扫出 3 个冗余目录（alpha1.0.0 + gamma0.9.0 + gamma1.0.0）', plan.items.length === 3, plan.items.map((i) => i.plugin + '@' + i.version));
  const paths = plan.items.map((i) => i.from);
  t('B3 激活版本 alpha/2.0.0 不在清单里', paths.every((p) => p.indexOf(path.join('alpha', '2.0.0')) < 0));
  t('B4 单版本 beta 不产生条目', plan.items.every((i) => i.plugin !== 'beta'));
  t('B5 gamma 保留排序最大的 1.1.0', paths.every((p) => p.indexOf(path.join('gamma', '1.1.0')) < 0));
  t('B6 totalBytes 累加了真实体积', plan.totalBytes > 300, plan.totalBytes);
  const one = plan.items.find((i) => i.plugin === 'alpha');
  t('B7 to 路径 = backupRoot/vendor/plugin/version',
    one && one.to.indexOf(f.backupRoot) === 0 && one.to.indexOf(path.join('vendor', 'alpha', '1.0.0')) > 0, one && one.to);
  t('B8 每条都带 bytes 字段', plan.items.every((i) => typeof i.bytes === 'number' && i.bytes > 0));
}

// ================================================================ C
sect('[C] dryRun —— 只列清单，不碰文件系统');
{
  const f = buildFixture();
  const before = JSON.stringify(fs.readdirSync(path.join(f.cacheRoot, 'vendor', 'alpha')));
  const res = fix.pruneSkillDupes({ cacheRoot: f.cacheRoot, stateFile: f.stateFile, backupRoot: f.backupRoot, dryRun: true });
  t('C1 ok + dryRun 标记', res.ok === true && res.dryRun === true, res);
  t('C2 moved 为 0', res.moved === 0);
  t('C3 planned 报出 3', res.planned === 3, res.planned);
  t('C4 源目录完全没动', JSON.stringify(fs.readdirSync(path.join(f.cacheRoot, 'vendor', 'alpha'))) === before);
  t('C5 没有创建备份目录', !fs.existsSync(f.backupRoot));
}

// ================================================================ D
sect('[D] pruneSkillDupes —— 真移动（只移不删）');
{
  const f = buildFixture();
  const res = fix.pruneSkillDupes({ cacheRoot: f.cacheRoot, stateFile: f.stateFile, backupRoot: f.backupRoot });
  t('D1 ok 且 moved=3', res.ok === true && res.moved === 3, res);
  t('D2 failed=0', res.failed === 0);
  const alphaDir = path.join(f.cacheRoot, 'vendor', 'alpha');
  const gammaDir = path.join(f.cacheRoot, 'vendor', 'gamma');
  t('D3 alpha 只剩激活版本 2.0.0', JSON.stringify(fs.readdirSync(alphaDir)) === JSON.stringify(['2.0.0']), fs.readdirSync(alphaDir));
  t('D4 gamma 只剩 1.1.0', JSON.stringify(fs.readdirSync(gammaDir)) === JSON.stringify(['1.1.0']), fs.readdirSync(gammaDir));
  t('D5 beta 原封不动', JSON.stringify(fs.readdirSync(path.join(f.cacheRoot, 'vendor', 'beta'))) === JSON.stringify(['1.0.0']));
  t('D6 备份目录里真的有 3 份', fs.existsSync(path.join(f.backupRoot, 'vendor', 'alpha', '1.0.0'))
    && fs.existsSync(path.join(f.backupRoot, 'vendor', 'gamma', '0.9.0'))
    && fs.existsSync(path.join(f.backupRoot, 'vendor', 'gamma', '1.0.0')));
  t('D7 备份内容完整（SKILL.md 还在）', fs.existsSync(path.join(f.backupRoot, 'vendor', 'alpha', '1.0.0', 'SKILL.md')));
  const again = fix.pruneSkillDupes({ cacheRoot: f.cacheRoot, stateFile: f.stateFile, backupRoot: f.backupRoot });
  t('D8 幂等：再跑一次 moved=0', again.ok === true && again.moved === 0, again);

  // 分批：batchSize=2 ⇒ 3 项要跑两批，仍应全部完成
  const f2 = buildFixture();
  const batched = fix.pruneSkillDupes({ cacheRoot: f2.cacheRoot, stateFile: f2.stateFile, backupRoot: f2.backupRoot, batchSize: 2 });
  t('D9 batchSize=2 分批后仍 moved=3', batched.ok === true && batched.moved === 3, batched);
}

// ================================================================ E
sect('[E] applyContextFix —— 入口白名单');
{
  const f = buildFixture();
  const bad = fix.applyContextFix('definitely-not-a-fix', { cacheRoot: f.cacheRoot, stateFile: f.stateFile, backupRoot: f.backupRoot });
  t('E1 未知 fixId 被拒', bad.ok === false && bad.error === 'unknown-fix', bad);
  t('E2 AUTO_FIX_IDS 暴露 prune-skill-dupes', fix.AUTO_FIX_IDS.indexOf('prune-skill-dupes') >= 0, fix.AUTO_FIX_IDS);
  const good = fix.applyContextFix('prune-skill-dupes', { cacheRoot: f.cacheRoot, stateFile: f.stateFile, backupRoot: f.backupRoot, dryRun: true });
  t('E3 已知 fixId 走通并回带 fixId', good.ok === true && good.fixId === 'prune-skill-dupes', good);
  t('E4 空 fixId 被拒', fix.applyContextFix('', {}).ok === false);
}

// ================================================================ F
sect('[F] 边界');
{
  const absent = fix.listPruneTargets({ cacheRoot: path.join(TMP, 'no-such-cache'), stateFile: path.join(TMP, 'no.json') });
  t('F1 cache 目录不存在 → ok:false 且给出 reason', absent.ok === false && absent.reason === 'no-cache-dir', absent);
  const res = fix.pruneSkillDupes({ cacheRoot: path.join(TMP, 'no-such-cache'), stateFile: path.join(TMP, 'no.json') });
  t('F2 同样的缺失场景 prune 也不抛', res.ok === false && res.moved === 0);

  const f = buildFixture();
  const fileSize = fix.dirSize(path.join(f.cacheRoot, 'vendor', 'beta', '1.0.0', 'SKILL.md'));
  t('F3 dirSize 对文件返回真实字节', fileSize === Buffer.byteLength('# beta 1.0.0\n'), fileSize);
  const dirSize = fix.dirSize(path.join(f.cacheRoot, 'vendor', 'beta'));
  t('F4 dirSize 对目录递归累加', dirSize === fileSize);
  t('F5 dirSize 对不存在的路径返回 0', fix.dirSize(path.join(TMP, 'nope')) === 0);
}

// ================================================================ G
sect('[G] 接线（源码级）');
{
  const daemonSrc = fs.readFileSync('D:/WorkDaddy/scripts/daemon.js', 'utf8');
  t('G1 daemon 启动期 require 了 context-fix.js', daemonSrc.indexOf("require('./context-fix.js')") >= 0);
  t('G2 有 POST /api/context-audit/fix 路由',
    daemonSrc.indexOf("req.method === 'POST' && p === '/api/context-audit/fix'") >= 0);
  // 安全边界：面板只能传 fixId，路径一律由后端算
  const routeStart = daemonSrc.indexOf("'/api/context-audit/fix'");
  const routeBody = routeStart < 0 ? '' : daemonSrc.slice(routeStart, routeStart + 1400);
  t('G3 路由体里只取 fixId，不从请求体取路径', routeBody.indexOf('body.fixId') >= 0 && routeBody.indexOf('body.path') < 0 && routeBody.indexOf('body.cacheRoot') < 0);
  t('G4 默认 dryRun（只有显式 dryRun===false 才真做）', routeBody.indexOf('body.dryRun === false') >= 0, routeBody.slice(0, 200));
  t('G5 走 AUTO_FIX_IDS 白名单校验', routeBody.indexOf('AUTO_FIX_IDS') >= 0);

  const macSrc = fs.readFileSync('D:/WorkDaddy/scripts/build-mac-dmg.sh', 'utf8');
  const listHit = macSrc.split('\n').some((line) => line.indexOf('for f in ') >= 0 && line.indexOf('context-fix.js') >= 0);
  const explicitHit = macSrc.split('\n').some((line) => line.indexOf('Resources/scripts/context-fix.js') >= 0);
  t('G6 mac 白名单 for-f-in 列表含 context-fix.js', listHit);
  t('G7 mac 白名单显式拷贝段含 context-fix.js', explicitHit);

  // 面板接线：折叠化（治「卡片挤占账号列表」）+ 体检按钮（治「只看报告不知道干嘛」）
  const injectSrc = fs.readFileSync('D:/WorkDaddy/scripts/inject.js', 'utf8');
  t('G8 体检卡片改成折叠结构（默认收起）',
    injectSrc.indexOf("'<div class=\"wbs-pcard wbs-ca-card collapsed\" id=\"wbs-ca-card\">' +") >= 0);
  t('G9 限流卡片也折了（两张常驻卡不再挤占账号列表）',
    injectSrc.indexOf("'<div class=\"wbs-pcard wbs-failover-card collapsed\" id=\"wbs-failover-card\">' +") >= 0);
  t('G10 通用折叠类齐（head / body 隐藏规则）',
    injectSrc.indexOf('.wbs-fold-head{') >= 0
    && injectSrc.indexOf('.wbs-pcard.collapsed > .wbs-fold-body{display:none}') >= 0
    && injectSrc.indexOf('.wbs-fold-chevron{') >= 0);
  t('G11 折叠状态按卡片持久化（localStorage）',
    injectSrc.indexOf("'workdaddy.ui.fold.' + PROFILE_ID + '.' + card.id") >= 0);
  t('G12 按钮文案进了词典（留在 skip 子树外才翻得了）',
    injectSrc.indexOf("'一键清理': 'Clean up',") >= 0 && injectSrc.indexOf("'复制指令': 'Copy prompt',") >= 0);
  t('G13 一键清理只传 fixId，不传路径', injectSrc.indexOf('fixId: fix.fixId, dryRun: false') >= 0);
  t('G14 finding 文本走 skip、按钮留外面（i18n 铁律）',
    injectSrc.indexOf("actLabel.textContent = '处理建议：';") >= 0
    && injectSrc.indexOf("title.setAttribute('data-wbs-i18n-skip', '1');") >= 0);
  t('G15 daemon 有 GET /api/handoff（B1，只读返回文本、不写盘）',
    daemonSrc.indexOf("req.method === 'GET' && p === '/api/handoff'") >= 0);
  t('G16 面板有「生成交接摘要」按钮', injectSrc.indexOf('id="wbs-ca-handoff"') >= 0);
  t('G17 交接摘要按钮与成功提示都进了词典',
    injectSrc.indexOf("'生成交接摘要': 'Generate handoff',") >= 0
    && injectSrc.indexOf("'交接摘要已复制，粘到新会话开头即可': 'Handoff copied") >= 0);
}

// ================================================================ H
sect('[H] buildHandoff —— 交接摘要（纯函数，只拼字符串）');
{
  const report = {
    ok: true,
    generatedAt: Date.now(),
    days: 7,
    sessions: {
      count: 3, totalInput: 12345, copiesSkipped: 1,
      heavy: [{ id: 'abcdef123456', turns: 900, input: 5000000, lastInput: 200000, ratio: 25.5 }],
    },
    findings: [
      { severity: 'crit', title: '会话过长：abcdef12', action: '换任务就开新会话' },
      { severity: 'warn', title: '常驻记忆偏大：MEMORY.md', action: '当作索引精简' },
    ],
  };
  const md = audit.buildHandoff(report);
  t('H1 返回字符串且以标题开头', typeof md === 'string' && md.indexOf('# 交接摘要（自动生成）') === 0, typeof md);
  t('H2 会话事实落进正文（累计输入 / 重发倍率）', md.indexOf('12345') >= 0 && md.indexOf('25.5x') >= 0, md.slice(0, 240));
  t('H3 严重度分级正确（crit→严重 / warn→警告）', md.indexOf('[严重]') >= 0 && md.indexOf('[警告]') >= 0);
  t('H4 findings 条数写进小标题', md.indexOf('待处理项（上下文体检发现 2 条）') >= 0);
  t('H5 空 report 不抛且仍返回文本', typeof audit.buildHandoff({}) === 'string' && audit.buildHandoff({}).length > 0);
  t('H6 无 findings 时明确写「无」', audit.buildHandoff({ findings: [] }).indexOf('- 无') >= 0);
  t('H7 纯函数：同输入两次结构一致', audit.buildHandoff(report).split('\n').length === md.split('\n').length);
}

// ---------------------------------------------------------------- 收尾
rmrf(TMP);
console.log('\n==== ' + (failures.length ? 'FAIL' : '结果') + '：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
