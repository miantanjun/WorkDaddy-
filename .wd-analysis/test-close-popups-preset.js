#!/usr/bin/env node
/**
 * 内置任务「页面就绪后自动关闭首页弹窗」preset 守卫（2026-10-16）
 *
 * 背景：客户端新版在**侧栏左下角**（用户头像上方）加了一个运营位轮播广告
 *   （`积分包购买全面开放` / `做任务赢赢积分好礼` 两张卡轮流显示，带圆点与「限时加购 / 立即前往」按钮）。
 *   它整个渲染在**Shadow DOM** 里，原有 4 组 `document` 级选择器一条都命中不了。
 *
 * 本套件守三件事：
 *   A. preset 里新增的定位器与 revision 升级链正确；
 *   B. ⭐ 那个 locator **绝不能带 `visible: true`**（否则 daemon 的 dom.click 会 skipMove
 *      ⇒ 少发 mouseMoved ⇒ 这个关闭按钮**收不到就点不掉**，而且失败是静默的）；
 *   C. 真跑一遍 installBuiltinTask 的升级路径（临时 dataDir），并验证「用户改过就不升级」的保护仍在。
 *
 * 汇总行格式：结果：N 通过 / M 失败
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PRESET = path.join(ROOT, 'scripts/builtin/automations/close-buddy-popups.json');
const automation = require(path.join(ROOT, 'scripts/automation.js'));
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts/daemon.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}

const CAROUSEL_SEL = 'button[data-track-id="pc_fusion_carousel_close"]';
const REV1_HASH = '7409d4d92618b59326e56629f4d9ba804ae30a4e36d7d5ed156042b9a3a744bd';
const REV2_HASH = '9c47a98a2fd9e50263290126ea3702df05d690f950b097a4a61871b6cd7bce77';

const preset = JSON.parse(fs.readFileSync(PRESET, 'utf8'));
const inner = preset.steps[0].steps;
const collectLocators = (steps, out = []) => {
  (steps || []).forEach((s) => {
    if (!s || typeof s !== 'object') return;
    if (s.locator) out.push(s.locator);
    (s.locators || []).forEach((l) => out.push(l));
    collectLocators(s.steps, out);
    collectLocators(s.onError, out);
  });
  return out;
};
const allLocators = collectLocators(preset.steps);
const hitCarousel = allLocators.filter((l) => l && l.value === CAROUSEL_SEL);

/* ── A 组：preset 结构 ── */
ok(preset.id === 'buddy-fuel-station-close-on-account-switch', 'A1 任务 id 未变（改了会让老装机变成两个任务）');
ok(preset.revision === 3, 'A2 revision 升到 3（必须 > 已发布标记里的 2，否则 installBuiltinTask 直接 skip）', preset.revision);
ok(preset.upgradeFromContentHashes.includes(REV2_HASH) && preset.upgradeFromContentHashes.includes(REV1_HASH),
  'A3 历史 hash 两个都在（rev1 + rev2）⇒ 老装机内容两种都能被认成「未被用户改过」', preset.upgradeFromContentHashes);
ok(preset.name === '页面就绪后自动关闭首页弹窗', 'A4 任务名未改（用户看到的名字不变）');
ok(hitCarousel.length === 2, 'A5 ⭐ 新定位器出现 2 次（dom.click + dom.wait）', hitCarousel.length);
ok(hitCarousel.every((l) => l.kind === 'css'), 'A6 新定位器是 css（daemon 的 deep-locator 会穿透 shadow root）');
ok(hitCarousel.every((l) => l.visible !== true),
  'A7 ⭐⭐ 新定位器**不得**带 visible:true —— 带了 daemon 就 skipMove，少了 mouseMoved 这个按钮点不动（实测）');
ok(hitCarousel.every((l) => /^button\[data-track-id="pc_fusion_carousel_close"\]$/.test(l.value)),
  'A8 定位器用 data-track-id 精确匹配（`#x` 这种短 id 太泛，容易误点）');

const legacySelectors = [
  '#fuel-compact-close',
  'button.wb-related-playbooks__dismiss-today',
  'button[data-track-id="home_growth_close"]',
  '.wb-slot--home-growth button.wb-slot--closable-close',
  'button.activity-bubble__close',
  'button.claw-welcome-activity-card__close',
];
const allValues = allLocators.map((l) => l && l.value);
ok(legacySelectors.every((s) => allValues.includes(s)),
  'A9 原有 4 组定位器一条都没丢（只增不减）',
  legacySelectors.filter((s) => !allValues.includes(s)));

const catchGroups = inner.filter((s) => s.op === 'logic.catch');
ok(catchGroups.length === 5, 'A10 关闭组数 = 5（原 4 组 + 侧栏轮播）', catchGroups.length);
const carouselGroup = catchGroups.find((g) => g.steps.some((s) => s.locator && s.locator.value === CAROUSEL_SEL));
ok(!!carouselGroup, 'A11 新组挂成了 logic.catch（点不到时静默跳过，不影响其它组）');
ok(!!carouselGroup && carouselGroup.steps.some((s) => s.op === 'notify.toast'),
  'A12 新组成功后给一次 toast（用户能看出这次是它关的）');
ok(!!carouselGroup && carouselGroup.steps.some((s) => s.op === 'dom.wait' && s.until && s.until.state === 'hidden'),
  'A13 新组点击后等元素消失（确认真的关掉，而不是点空）');
ok(inner[inner.length - 1].op === 'logic.delay',
  'A14 新组插在 logic.delay 之前（每轮补查仍有一拍间隔）');
ok(preset.trigger && preset.trigger.restartOnNavigation === true && preset.trigger.types.join(',') === 'pageReady',
  'A15 触发方式仍是 pageReady + 切页面重跑（切账号/切会话后新出现的广告也能关）');

/* ── B 组：daemon 侧的遮挡判定 ── */
ok(daemonSrc.includes('!(hit===el||el.contains(hit)||hit.contains(el))'),
  'B1 ⭐ 遮挡判定接受「命中的是 el 的祖先」（else 侧栏轮播那个按钮会被误判成「被遮挡」而直接抛错）');
ok(daemonSrc.includes("var root=el.getRootNode();var hit=root.elementFromPoint("),
  'B2 遮挡判定用 getRootNode() 取根（shadow 内才能做命中测试）');
ok(daemonSrc.includes("{ skipMove: locators.some((item) => item && item.visible === true) }"),
  'B3 dom.click 的 skipMove 仍由 locator.visible 决定（A7 的约束来源）');

/* ── C 组：真跑升级链路（临时 dataDir） ── */
function hashOf(task) {
  const content = {
    schemaVersion: task.schemaVersion || 1,
    id: task.id,
    name: task.name || '',
    description: task.description || '',
    variables: task.variables || {},
    steps: task.steps || [],
    onSuccess: task.onSuccess || [],
    onFailure: task.onFailure || [],
    requires: task.requires || null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
// 复刻「已发布 rev2 装机内容」= 当前 preset 去掉新组、revision 回 2
const legacy = JSON.parse(JSON.stringify(preset));
legacy.revision = 2;
legacy.upgradeFromContentHashes = [REV1_HASH];
legacy.steps[0].steps = legacy.steps[0].steps.filter((s) => !(s.op === 'logic.catch' && s.steps.some((x) => x.locator && x.locator.value === CAROUSEL_SEL)));
ok(hashOf(legacy) === REV2_HASH,
  'C1 ⭐ 复刻出的 rev2 内容 hash 与线上标记完全一致（说明升级链的判据对齐了）', hashOf(legacy));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-close-popups-'));
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA, { recursive: true });
const writeTasks = (tasks) => fs.writeFileSync(path.join(DATA, 'automations.json'), JSON.stringify(tasks, null, 2) + '\n');
const writeMarkers = (m) => fs.writeFileSync(path.join(DATA, 'automation-builtins.json'), JSON.stringify(m) + '\n');

// C2：正常升级（内容与标记一致）
writeTasks([{ ...legacy, enabled: false, updatedAt: 1 }]);
writeMarkers({ [preset.id]: { managed: true, revision: 2, contentHash: REV2_HASH } });
const up = automation.installBuiltinTask(DATA, PRESET);
ok(up && up.status === 'upgraded' && up.revision === 3, 'C2 ⭐ 老装机（内容未改）⇒ 走升级路径到 revision 3', up);
const after = JSON.parse(fs.readFileSync(path.join(DATA, 'automations.json'), 'utf8'));
const upgraded = after.find((t) => t.id === preset.id);
ok(!!upgraded && collectLocators(upgraded.steps).some((l) => l && l.value === CAROUSEL_SEL),
  'C3 ⭐ 升级后的装机内容含侧栏轮播关闭步骤（真正落到了用户任务里）');
ok(upgraded.enabled === false, 'C4 升级保留用户的启用状态（用户禁用过就不擅自打开）');
const markerAfter = JSON.parse(fs.readFileSync(path.join(DATA, 'automation-builtins.json'), 'utf8'))[preset.id];
ok(markerAfter && markerAfter.revision === 3 && markerAfter.contentHash === hashOf(preset),
  'C5 升级后标记记到 revision 3 + 新内容 hash（下次改动能继续升）', markerAfter);

// C6：用户改过 ⇒ 保护，不覆盖
writeTasks([{ ...legacy, name: '我自己改过的名字', updatedAt: 2 }]);
writeMarkers({ [preset.id]: { managed: true, revision: 2, contentHash: REV2_HASH } });
const guarded = automation.installBuiltinTask(DATA, PRESET);
ok(guarded && guarded.status === 'skipped', 'C6 ⭐⭐ 用户改过内容 ⇒ 一律跳过、绝不覆盖（并落 managed:false 永久退出内置管理）', guarded);
const kept = JSON.parse(fs.readFileSync(path.join(DATA, 'automations.json'), 'utf8')).find((t) => t.id === preset.id);
ok(kept.name === '我自己改过的名字', 'C7 用户那条原样保留');

// C8：重复升级幂等
writeTasks([{ ...legacy, enabled: true, updatedAt: 3 }]);
writeMarkers({ [preset.id]: { managed: true, revision: 3, contentHash: hashOf(preset) } });
const again = automation.installBuiltinTask(DATA, PRESET);
ok(again && again.status === 'skipped', 'C8 已是最新版 ⇒ 不再重复升级（幂等）', again);

/* ────────────────── D 组：不抢渲染器（面板不能被它关掉） ──────────────────
 * 2026-10-19 事故：给本任务加第 5 组（侧栏轮播广告，Shadow DOM 里的关闭按钮）时，
 *   定位器**刻意省略 visible**（带 visible 会让 dom.click 走 skipMove，按钮收不到 hover 点不动）。
 *   而 taskIsPassiveCleanup 原判据要求每条 dom.click 都 visible===true ⇒ 整任务被判成
 *   「要独占渲染器」⇒ 每步 withInput 都关一次面板 ⇒ 用户看到「点开就关、一直循环」。
 * 这组守卫锁死：本任务必须走被动清理道，永不抢渲染器。 */
console.log('\n[D] 不抢渲染器');
ok(automation.taskIsPassiveCleanup(preset) === true,
  'D1 ⭐ 内置关闭弹窗任务是「被动清理」（共享短输入闸门，不独占渲染器）');
ok(!(automation.taskNeedsPanelClosed(preset) && !automation.taskIsPassiveCleanup(preset)),
  'D2 ⭐⭐ requiresLease 必须为 false —— 否则每步 DOM 都会发 panel-open{open:false}');
ok(preset.steps.some((s) => JSON.stringify(s).includes('pc_fusion_carousel_close')),
  'D3 第 5 组定位器在位（回归锚点：删了这条断言也该跟着改）');
// 精确取那条定位器对象，别用正则跨对象匹配（`[^}]*` 会跨到别的对象上）
let carouselLocator = null;
(function findLoc(v) {
  if (Array.isArray(v)) return v.forEach(findLoc);
  if (!v || typeof v !== 'object') return;
  if (v.value && String(v.value).includes('pc_fusion_carousel_close')) carouselLocator = v;
  else Object.values(v).forEach(findLoc);
})([preset.steps, preset.onSuccess, preset.onFailure]);
ok(!!carouselLocator && carouselLocator.visible !== true,
  'D4 ⭐ Shadow DOM 关闭按钮的定位器**不得带 visible:true**（带了就 skipMove 点不动）', carouselLocator);
ok(automation.taskIsPassiveCleanup({ trigger: { restartOnNavigation: true }, steps: [{ op: 'dom.click', locator: { kind: 'css', value: 'button.close' } }] }) === true,
  'D5 缺省 visible 的 dismiss 点击仍算被动清理');
ok(automation.taskIsPassiveCleanup({ trigger: { restartOnNavigation: true }, steps: [{ op: 'dom.click', locator: { kind: 'css', value: 'button.close', visible: false } }] }) === false,
  'D6 ⛔ 显式 visible:false 仍判否（「连隐藏的也点」必须留在独占道）');
ok(automation.taskIsPassiveCleanup({ trigger: { restartOnNavigation: true }, steps: [{ op: 'dom.click', locator: { kind: 'css', value: 'button.submit' } }] }) === false,
  'D7 ⛔ 非关闭意图的点击仍判否（不能把普通任务误放进来）');
ok(automation.taskIsPassiveCleanup({ trigger: {}, steps: [{ op: 'dom.click', locator: { kind: 'css', value: 'button.close' } }] }) === false,
  'D8 没有 restartOnNavigation 的任务不走这条道');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

if (fail) console.log('\n失败项：见上方 FAIL 行');
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
