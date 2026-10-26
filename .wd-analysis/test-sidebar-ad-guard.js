#!/usr/bin/env node
/**
 * 侧栏运营位「常驻清理器」守卫（2026-10-21）
 *
 * 背景：`积分包购买全面开放` / `做任务赢积分好礼` 这组侧栏轮播广告，
 *   原先只靠内置任务 `close-buddy-popups` 在 pageReady 后约 30 秒内轮询
 *   （logic.repeat 100 × 300ms）。但它是在页面就绪**很久之后**才冒出来的
 *   ⇒ 那一轮窗口早关了，用户会一直看到它。
 *
 * 现在改由 `inject.js` 里的 `startSidebarAdGuard()` 常驻扫描。本套件守：
 *   A. 注入位置与幂等（重注入不能留两份 setInterval）；
 *   B. ⭐ 点击必须发完整指针序列（该按钮只认真实事件链，简化序列静默失效）；
 *   C. 省电与兜底（不可见不扫、恢复可见立刻扫、点不掉就隐藏宿主、内容变了要还原）。
 *
 * 汇总行格式：结果：N 通过 / M 失败
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INJECT = path.join(ROOT, 'scripts/inject.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}

const raw = fs.readFileSync(INJECT, 'utf8');
// ⚠️ 必须先归一化行尾：JS 的 `.` 不匹配 \r，CRLF 上 `//.*$` 之类的剥离会静默失败。
const code = raw.replace(/\r\n/g, '\n');

// 注释剥离：只按整行 // 与 /* */ 块处理，够用且不会碰字符串里的 "//"。
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}
const pure = codeOnly(code);

const guardStart = pure.indexOf('function startSidebarAdGuard()');
const guardEnd = pure.indexOf('  function start() {');
const guardBody = guardStart >= 0 ? pure.slice(guardStart, guardStart + 6000) : '';
const tapStart = pure.indexOf('function wbsTapAdClose(btn)');
const tapBody = tapStart >= 0 ? pure.slice(tapStart, tapStart + 1400) : '';

/* ── A 组：注入位置 / 幂等 / 定位器 ── */
ok(guardStart > -1, 'A1 startSidebarAdGuard 定义存在');
ok(pure.includes('  startSidebarAdGuard();'), 'A2 有启动调用（不是只定义没调用）');
const callIdx = pure.indexOf('  startSidebarAdGuard();');
ok(callIdx > -1 && guardEnd > -1 && callIdx < guardEnd, 'A3 调用点在 function start() 之前（面板建好前就开始扫）');
ok((pure.match(/function startSidebarAdGuard\(\)/g) || []).length === 1, 'A4 定义只出现一次（重复插入会让两份 setInterval 同时跑）');
ok(pure.includes("var WBS_AD_GUARD_HOST = '.wb-slot--avatar-top-combo';"), 'A5 宿主定位器 = 侧栏头像上方那个 slot');
ok(pure.includes("var WBS_AD_GUARD_CLOSE = 'button[data-track-id=\"pc_fusion_carousel_close\"]';"), 'A6 关闭按钮用 data-track-id（短 id #x 太泛，不用）');
ok(pure.includes("var WBS_AD_GUARD_EXPOSE = '[data-track-expose-id=\"pc_fusion_carousel_show\"]';"), 'A7 用曝光标记认广告（避免误伤同一 slot 里的别的内容）');
ok(pure.includes('var WBS_AD_GUARD_TICK_MS = 1500;'), 'A8 扫描间隔 1500ms（够快且可忽略开销）');

/* ── B 组：⭐ 点击事件序列 + 幂等清理 ── */
ok(tapStart > -1, 'B1 wbsTapAdClose 定义存在');
['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type, i) => {
  ok(tapBody.includes("'" + type + "'"), 'B' + (2 + i) + ' 发出 ' + type + '（缺任何一个这条按钮都点不掉，且失败是静默的）');
});
ok(pure.includes('if (prevGuard && typeof prevGuard.stop === \'function\') prevGuard.stop();'), 'B7 重注入先 stop 旧实例（代际守卫）');
ok(/__wbsAdGuard\.stop\(\)/.test(pure) && /delete window\.__wbsAdGuard/.test(pure), 'B8 顶部兜底清理块里也停一次并清守卫');
const cleanupIdx = pure.indexOf('delete window.__wbsAdapter');
const stopIdx = pure.indexOf('window.__wbsAdGuard.stop()');
ok(cleanupIdx > -1 && stopIdx > cleanupIdx, 'B9 清理块的位置在注入守卫之前（旧 interval 必须先停）');

/* ── C 组：省电 / 兜底 / 不误伤 ── */
ok(guardBody.includes('if (document.hidden) return;'), 'C1 窗口不可见时不扫描（后台节流下没有意义）');
ok(guardBody.includes("document.addEventListener('visibilitychange', onAdGuardVisible)"), 'C2 恢复可见时立刻扫一次（不等 1.5s）');
ok(guardBody.includes("removeEventListener('visibilitychange', onAdGuardVisible)"), 'C3 stop 时必须摘掉监听（否则重注入后旧闭包继续扫）');
ok(guardBody.includes("setProperty('display', 'none', 'important')"), 'C4 点不掉的兜底是隐藏宿主（!important，防被内联样式覆盖）');
ok(guardBody.includes('releaseHost(host)'), 'C5 slot 内容不再是广告时要还原 display（不永久误伤）');
ok(guardBody.includes("PROFILE_ID === 'codebuddy-cn' || PROFILE_ID === 'codebuddy-intl'"), 'C6 CodeBuddy profile 早退（侧栏结构不同）');

/* ── D 组：文件纪律 ── */
let syntaxOk = true;
try {
  execFileSync(process.execPath, ['--check', INJECT], { stdio: 'pipe' });
} catch (e) {
  syntaxOk = false;
}
ok(syntaxOk, 'D1 inject.js 语法通过');
const crlf = (raw.match(/\r\n/g) || []).length;
const lfOnly = (raw.match(/(?<!\r)\n/g) || []).length;
ok(crlf > 20000 && lfOnly === 0, 'D2 scripts/*.js 必须纯 CRLF', { crlf, lfOnly });

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
