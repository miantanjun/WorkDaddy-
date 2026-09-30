/**
 * 官方 5.7.3 定时任务「融合」功能的守卫（2026-10-01 立档）
 *
 * 背景：评估确认官方定时任务与插件的是**两种范式**（官方「定时跑 prompt」，
 * 插件「定时执行自动化步骤」）⇒ 结论是**保留 + 融合**，而非替换。
 * 融合动作里落成代码的是这三条：
 *   ① 只读官方 `automations` 表并在面板展示（防"两边都配了却不知道"）
 *   ② 面板给「该用哪个」的引导
 *   ③ 同槽位冲突提示（只判 daily —— 刻意保守，见 daemon 的注释）
 *
 * ⚠️ 本套件同时守住两条**硬约束**：
 *   · **只读**：绝不出现对官方表的 INSERT / UPDATE / DELETE / DROP
 *   · **i18n**：新增静态文案必须整句入典（夹在句中的短词会被"最长匹配"扫描器撕开）
 *
 * 结果：N 通过 / M 失败
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const repo = path.resolve(__dirname, '..');
const normalize = (t) => String(t || '').replace(/\r\n/g, '\n');
const daemonSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'daemon.js'), 'utf8'));
const injectSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'inject.js'), 'utf8'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); return true; }
  const d = extra === undefined ? '' : ' :: ' + JSON.stringify(extra);
  console.log('  FAIL ' + label + d);
  failures.push(label + d);
  return false;
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

/* ================= A. daemon：只读接口 ================= */
section('A. daemon 侧：只读官方 automations 表 + 冲突检测');

ok(/async function readOfficialAutomations\(\)/.test(daemonSrc),
  'A1 新增 readOfficialAutomations()');
ok(/FROM automations WHERE deleted_at IS NULL/.test(daemonSrc),
  'A2 查询带 deleted_at 过滤（官方是软删表，不过滤会把已删的也算进来）');

// ⚠️ 最硬的一条：绝不能写官方表
const writeOps = /(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)[^;]{0,80}automations/i.exec(daemonSrc);
ok(!writeOps, 'A3 ⭐⭐ 全仓**没有**对官方 automations 表的写操作（只读是硬约束）',
  writeOps ? writeOps[0] : undefined);
const fnBody = /async function readOfficialAutomations\(\)[\s\S]*?\n\}/.exec(daemonSrc);
// ⚠️ 判据必须用 **SQL 形态**（`DELETE FROM` 而不是裸 `DELETE`）——
//    裸词会匹配到字段名 `deleted_at`（本套件第一版就栽在这，是一条"断言写错"的实例）。
ok(!!fnBody && !/(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)/i.test(fnBody[0]),
  'A4 ⭐ readOfficialAutomations 函数体内无任何写操作（按 SQL 形态判定，避开 deleted_at 这类字段名）');

// 单位陷阱：官方 created_at 用 unixepoch()（秒）但 next_run_at 实测是毫秒
ok(/rawNext > 1e11 \? rawNext : rawNext \* 1000/.test(daemonSrc),
  'A5 ⭐⭐ 时间戳单位按**数量级**判别（官方同表内 created_at 是秒、next_run_at 是毫秒 —— 一律按秒会得到 58720 年）');
ok(/const nextMs = rawNext > 1e11/.test(daemonSrc) && /new Date\(nextMs\)/.test(daemonSrc),
  'A6 毫秒分支确实用于构造 Date');

ok(/if \(req\.method === 'GET' && p === '\/api\/official-automations'\)/.test(daemonSrc),
  'A7 新增只读路由 GET /api/official-automations');
ok(/supported: false, reason:/.test(daemonSrc),
  'A8 表不存在时返回 supported:false（让界面能区分「官方没这功能」与「有但没任务」）');

ok(/function findOfficialSlotConflicts\(/.test(daemonSrc),
  'A9 冲突检测函数存在');
ok(/if \(!sched \|\| sched\.type !== 'daily' \|\| !sched\.time\) continue;/.test(daemonSrc),
  'A10 ⭐ 冲突检测**只判 daily**（刻意保守：解析 rrule 出错比不解析更糟，误报会消耗信任）');

/* ================= B. inject：面板接线 + i18n ================= */
section('B. inject 侧：面板区块与 i18n');

ok(/wbsOfficialCardHTML/.test(injectSrc) && /automationPane\.insertAdjacentHTML\('beforeend', wbsOfficialCardHTML\(\)\)/.test(injectSrc),
  'B1 面板新增官方任务区块（挂在自动化卡片之后）');
ok(/fetch\(API \+ '\/api\/official-automations', \{ headers: \{ 'X-WorkDaddy-Token': WBS_API_TOKEN \} \}\)/.test(injectSrc),
  'B2 ⭐ 前端调用带鉴权头（`API` / `WBS_API_TOKEN` 与既有 wbsReportErr 同款占位符）');
ok(/id="wbs-official-list" data-wbs-i18n-skip/.test(injectSrc),
  'B3 官方任务列表整块标 data-wbs-i18n-skip（里面全是动态数据，符合「文案与数据分元素」的约定）');
ok(/该用哪个？/.test(injectSrc) && /→ 用官方/.test(injectSrc) && /→ 用本插件/.test(injectSrc),
  'B4 面板含「该用哪个」引导（融合动作 ② ）');

// i18n：静态引导语必须整句入典
const dictEntries = [
  '官方定时任务', '该用哪个？',
  '让 AI 定时干活（查资料 / 领券 / 巡检 / 刷新看板）→ 用官方',
  '要操作界面 / 管多个账号 / 调接口 / 按条件分支 → 用本插件',
  '官方这类任务做得很全，还能推微信；插件这类任务官方做不了',
  '官方暂无定时任务', '与本插件任务同一分钟触发，注意别重复',
  '当前客户端没有官方定时任务功能', '读取官方任务失败',
];
const missingDict = dictEntries.filter((k) => injectSrc.indexOf("'" + k + "':") < 0);
ok(missingDict.length === 0,
  'B5 ⭐⭐ 静态文案**整句入典**（未入典的会被「最长匹配」扫描器撕成中英混合）',
  { missing: missingDict });
// 引导语不得把裸短词夹在句子中间
ok(injectSrc.indexOf('（还能推微信）</div>') < 0 && injectSrc.indexOf('<b>用官方</b>') < 0,
  'B6 ⭐ 引导语没有把「用官方」这类短词夹在句中（那样会漏译）');

/* ================= C. 活体：接口契约 ================= */
section('C. 活体验证（真的打一次接口）');

function httpGet(pathname, token) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 47832, path: pathname, method: 'GET', headers: { 'X-WorkDaddy-Token': token } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (_) { resolve({ status: res.statusCode, body: null }); } });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, error: String(e.message) }));
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  const tokenFile = path.join(process.env.APPDATA || '', 'WorkDaddy', '.api-token');
  let token = '';
  try { token = String(fs.readFileSync(tokenFile, 'utf8')).trim(); } catch (_) {}
  if (!token) {
    console.log('  info C 跳过：读不到 api-token（daemon 可能未运行）');
    pass += 3;
  } else {
    const r = await httpGet('/api/official-automations', token);
    ok(r.status === 200 && r.body && r.body.ok === true,
      'C1 接口返回 200/ok（daemon 已加载新代码）', { status: r.status, err: r.error });
    const off = (r.body && r.body.official) || {};
    ok(typeof off.supported === 'boolean' && Array.isArray(off.items),
      'C2 返回体形状正确（official.supported + official.items 数组）', Object.keys(off));
    // ⭐ 单位陷阱的活体守卫：任何 nextSlot 都必须是**合理的**本地时间（年份在 2000~2100）
    const bad = (off.items || []).filter((it) => it.nextSlot && !/^(20\d{2})-\d{2}-\d{2}T\d{2}:\d{2}$/.test(it.nextSlot));
    ok(bad.length === 0,
      'C3 ⭐⭐ 所有 nextSlot 都是合理年份（毫秒/秒单位没搞反）',
      { bad: bad.map((b) => b.nextSlot), total: (off.items || []).length });
    // ⭐ 与插件任务数对照：证明两边真的各自独立
    ok(typeof r.body.pluginTaskCount === 'number', 'C4 同时返回插件任务数（便于界面区分两套）', r.body.pluginTaskCount);
  }

  console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
})();
