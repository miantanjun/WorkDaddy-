#!/usr/bin/env node
/**
 * 统一网关「账号 × 模型健康矩阵 + 预热探测」守卫（2026-11-03）
 *
 * 背景（这轮要治的病）：面板请求记录里同一请求连着「换号重试第 2/3 次」。
 * 根因是三道：
 *   ① 选号完全盲：pick() 只看「号没冷却」，不知道这个号对这个模型能不能用；
 *   ② 冷却不分作用域：上游 429 是**按模型**限流（`user_model_rate_limited`），
 *      旧代码却按账号冷却 ⇒ 一个模型限流把整个号踢掉，下一个请求只能换号；
 *   ③ 状态只在内存：进程一重启，确认没积分的死号立刻复活被盲试。
 *
 * 本套件锁住修复后必须长期成立的契约（都是很容易在后续改动中悄悄退化的点）：
 *   H 后端：模型级健康矩阵 / 冷却作用域 / 持久化 / 预热够用就停
 *   I 前端：模型页「可用号」列与预热按钮
 *
 * 用法：node .wd-analysis/test-gateway-health.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const UDIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WorkDaddy', 'unified');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }
/** 剥注释：静态断言必须剥，否则会被自己写的注释骗过（本项目踩过多次）。 */
function codeOnly(raw) {
  return String(raw).replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
/** 取某个函数体（从签名到下一个顶层 `}`），用于「这个函数里必须有什么/不能有什么」 */
function bodyOf(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return '';
}

const SERVER_RAW = read(path.join(UDIR, 'server.js'));
const APP_RAW = read(path.join(UDIR, 'panel', 'app.js'));

if (!SERVER_RAW) {
  console.log('\n⊘ 未找到统一网关部署（' + UDIR + '）');
  console.log('  侧车是可剥离插件，摘掉后本套件整体跳过（不算失败）。');
  console.log('\n结果：0 通过 / 0 失败（已跳过）');
  process.exit(0);
}

const S = codeOnly(SERVER_RAW);
const A = codeOnly(APP_RAW);

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== H. 账号 × 模型健康矩阵（后端 server.js）===');

ok('H1 选号带 model 参数（pick(exclude, model)）—— 不带就是盲选',
  /pick\(exclude,\s*model\)/.test(S));

const pickBody = bodyOf(S, 'pick(exclude, model)');
ok('H2 ⭐ pick 用 badOf(a, model) 排除「这个模型已标坏」的号',
  /badOf\(a,\s*model\)/.test(pickBody));
ok('H3 ⭐ pick 做 known-good 优先分组（a.ok && a.ok[model]）',
  /a\.ok\s*&&\s*a\.ok\[model\]/.test(pickBody));
ok('H4 ⭐ 该模型全被标坏时不直接 503，有「最快恢复」兜底重试',
  /relax/.test(pickBody) && /bad\[model\]\[0\]/.test(pickBody));

ok('H5 请求主链路 p.pick(tried, model) 传了 model',
  /p\.pick\(tried,\s*model\)/.test(S));
ok('H6 请求成功要 markOk(a, model) —— 否则学不会「谁能用」',
  /p\.markOk\(a,\s*model\)/.test(S));
ok('H7 ⭐ 失败按作用域分派：model 级走 markBad，account 级走 cool',
  /v\.scope\s*===\s*'model'/.test(S) && /markBad\(a,\s*model/.test(S));

// ── 冷却作用域（本轮最核心的认知，写错就退回「频繁换号」）──
// ⚠️ 必须从 `class Raccoon` 之后取：基类里也有同名抽象方法，直接找会拿到空壳。
const raccoonClassify = bodyOf(S.slice(S.indexOf('class Raccoon')), 'classify(status, text, a)');
ok('H8 ⭐⭐ 429 必须是 scope=model（上游限流是按模型，不是按账号）',
  /status\s*===\s*429[\s\S]{0,200}scope:\s*'model'/.test(raccoonClassify));
ok('H9 ⭐⭐ insufficient_points 必须是 scope=account（余额不足全模型都挂）',
  /insufficient_points[\s\S]{0,220}scope:\s*'account'/.test(raccoonClassify));
ok('H10 ⭐⭐ 401 必须是 scope=account',
  /status\s*===\s*401[\s\S]{0,200}scope:\s*'account'/.test(raccoonClassify));
ok('H11 ⭐ 积分不足冷却 ≥ 12h（旧值 2h ⇒ 每 2 小时重演一次盲试，实测日志里反复出现）',
  !/insufficient_points[\s\S]{0,120}2\s*\*\s*3600\s*\*\s*1000/.test(raccoonClassify));

// ── 持久化 ──
ok('H12 健康矩阵落盘为 health.json',
  /health\.json/.test(S));
ok('H13 load() 里调用 loadHealth() —— 重启后继承上次判断',
  /this\.loadHealth\(\)/.test(bodyOf(S, 'load()')));
ok('H14 cool / markOk / markBad 都要 saveHealth()',
  /cool\(a,\s*ms,\s*why,\s*probeMs\)[\s\S]*this\.saveHealth\(\)/.test(S) &&
  /markOk\(a,\s*model\)[\s\S]*this\.saveHealth\(\)/.test(S) &&
  /markBad\(a,\s*model,\s*ms,\s*why\)[\s\S]*this\.saveHealth\(\)/.test(S));
ok('H15 token 换过就丢弃旧判断（换号包后不能沿用死号结论）',
  /h\.tok\s*&&\s*h\.tok\s*!==/.test(S));
ok('H16 ⭐ 死号探测有 probeAt（冷却中也能按计划复活探测，不必等满 24h）',
  /probeAt/.test(S));

// ── 指数退避 ──
ok('H17 ⭐ markBad 指数退避（否则 90s 后重探 → 又 429 的循环）',
  /Math\.pow\(2,\s*n\s*-\s*1\)/.test(S));

// ── 预热探测 ──
ok('H18 存在 warmModel 与 probeAccountModel',
  /async function warmModel\(/.test(S) && /async function probeAccountModel\(/.test(S));
ok('H19 ⭐⭐ 预热「够用就停」：fresh >= need 直接返回，不做全池铺开',
  /fresh\s*>=\s*need/.test(S));
ok('H20 ⭐⭐ 请求路径上不能同步探测：touchModel 用 setTimeout 异步触发',
  /function touchModel\([\s\S]{0,900}setTimeout\(/.test(S) && !/await warmModel/.test(bodyOf(S, 'function touchModel(pid, model)')));
ok('H21 探测并发受限（WARM.conc），不把上游打爆',
  /WARM\.conc/.test(S) && /warm_concurrency/.test(S));
ok('H22 只预热「热模型」（最近真被请求过的），不 6 个模型全探',
  /HOT\[key\]\s*=\s*Date\.now\(\)/.test(S) && /hotMs/.test(S));
ok('H23 请求进来时登记热模型（touchModel 被调用）',
  /touchModel\(target\.pid,\s*model\)/.test(S));
ok('H24 有定时巡检（warmTick），否则长时间不请求的模型永远不补',
  /warmTick\(\)/.test(S) && /setInterval/.test(S));
ok('H25 auto 兜底的 probeModel 也带 model 选号（否则假阴性）',
  /p\.pick\(new Set\(\),\s*model\)/.test(S));

// ── 接口 ──
ok('H26 后端提供 /panel/api/health（模型 × 可用号）',
  /tail === 'health'/.test(S) && /freshOk\(model\)/.test(S));
ok('H27 后端提供手动预热接口 /panel/api/warm',
  /tail === 'warm'/.test(S));
ok('H28 ⭐⭐ 启动预热：把**已注册进客户端**的模型先探一遍（冷模型第一次请求就首枪命中）',
  /async function warmStartup\(/.test(S) && /readRegistered\(\)/.test(bodyOf(S, 'async function warmStartup()')));
ok('H29 ⭐ 启动预热延迟且串行（延迟 20s，避免和 daemon 启动流量抢上游；模型之间不并发）',
  /setTimeout\([^,]*warmStartup[^,]*,\s*20000\)/.test(S) && /for \(const t of targets\)[\s\S]{0,120}await warmModel/.test(S));
ok('H30 ⭐⭐ 标坏时把该模型的 ok 记录降级（否则 90s 一过又回优先组，每 90 秒重撞一次 429）',
  /a\.ok\[model\]\s*=\s*0/.test(bodyOf(S, 'markBad(a, model, ms, why)')));

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== I. 控制台前端（panel/app.js）===');
ok('I1 模型页有「可用号」列',
  /可用号/.test(A));
ok('I2 ⭐ 未探过的模型显示「未探」而不是红色 0（别拿红色吓人）',
  /'未探'/.test(A));
ok('I3 每个模型行有「预热」按钮',
  /data-warm=/.test(A) && /预热/.test(A));
ok('I4 预热走 POST /panel/api/warm 并刷新健康',
  /api\('warm'/.test(A) && /loadHealth\(true\)/.test(A));
ok('I5 模型页加载时同时拉 health',
  /loadModels\(force\),\s*loadClient\(force\),\s*loadHealth\(force\)/.test(A));
ok('I6 可用号用 st 状态类着色（≥3 绿 / 1~2 黄 / 0 红）',
  /r\.fresh\s*>=\s*3/.test(A) && /'alive'/.test(A) && /'cooling'/.test(A));

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== J. 配置默认值合理 ===');
ok('J1 默认常备 6 个可用号', /warm_need\)\s*\|\|\s*6/.test(S));
ok('J2 单轮探测上限 20（护积分）', /warm_cap\)\s*\|\|\s*20/.test(S));
ok('J3 ok 记录默认 12 小时过期', /health_ok_ttl_h\)\s*\|\|\s*12/.test(S));
ok('J4 重试上限从 6 降到 4（最坏串号延迟减半）', /Math\.min\(4,\s*Math\.max\(1,\s*p\.pool\.length\)\)/.test(S));

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== K. 面板皮肤（浅色 / 深色）持久化 ===');
ok('K1 服务端渲染就把主题写进 <html>（首帧不闪，换浏览器也认）',
  /themeCls\s*=\s*CFG\.panel_theme\s*===\s*'light'/.test(S) && /<html lang="zh"\$\{themeCls\}/.test(S));
ok('K2 主题落在 config.json 的 panel_theme',
  /cur\.panel_theme\s*=\s*v/.test(S));
ok('K3 ⭐ 写盘必须「读-改-写 + 临时文件 rename」，不能整份覆盖（config 里还有 api_key / providers）',
  /readFileSync\(f,\s*'utf8'\)/.test(bodyOf(S, 'function savePanelTheme(theme)')) &&
  /fs\.renameSync\(tmp,\s*f\)/.test(S));
ok('K4 有 POST /panel/api/theme 接口',
  /tail === 'theme'/.test(S));
ok('K5 ⭐⭐ 主题初始化在启动入口里被调用，且**不能**再出现「定义了却从不调用的 boot()」',
  /renderShell\(\);\s*initTheme\(\);/.test(A) && !/function boot\(/.test(A));
ok('K6 ⭐ localStorage 之外还要写服务端（localStorage 按 origin 隔离，换地址就丢）',
  /fetch\('\/panel\/api\/theme'/.test(A));
ok('K7 侧栏有常驻切换按钮，且和「关于」页 checkbox 共用 applyTheme（状态永不打架）',
  /id="th-btn"/.test(A) && /c\.onchange = function \(\) \{ applyTheme\(c\.checked, true\); \}/.test(A));
ok('K8 切换时同步按钮文案 + aria 提示',
  /th-txt/.test(A) && /当前浅色，点击切深色/.test(A));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
