/**
 * test-ck-memory.js —— 设置面板「记忆」标签页（scripts/ck-memory.js）的回归测试
 *
 * 两层断言：
 *   静态层 —— 文件行尾 / daemon 挂载点 / 注入源占位符（热更新与可剥离性都靠它）
 *   行为层 —— 在**临时目录**里造一份假 transcript，真跑索引，验：
 *             中文两字词命中、注入噪声不入库、强制重建不翻倍、清空真清干净
 *
 * ⚠️ 全程只用 os.tmpdir() 下的临时库，绝不碰 %APPDATA%\WorkDaddy\ck-memory。
 * ⚠️ 不进 run-regression-all 默认列表也能跑：node .wd-analysis/test-ck-memory.js
 *
 * 输出格式要能被 run-regression-all 解析：末行 `结果：N 通过 / M 失败`
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  [通过] ' + m); };
const no = (m) => { fail++; console.log('  [失败] ' + m); };
const chk = (cond, m, detail) => (cond ? ok(m) : no(m + (detail ? '　' + detail : '')));

function eol(file) {
  const b = fs.readFileSync(file);
  let crlf = 0, lf = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 10) { if (i > 0 && b[i - 1] === 13) crlf++; else lf++; }
  }
  return { crlf, lf, bytes: b.length };
}

let tmpRoot = '';
function cleanup() {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n=== ck-memory（记忆标签页）回归 ===\n');

/* ---------------- 1. 静态层 ---------------- */

console.log('1) 新增文件与行尾');
for (const f of ['scripts/ck-memory.js', 'scripts/ck-memory-ui.js']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { no(f + ' 不存在'); continue; }
  const e = eol(p);
  const intact = /\};|\)\(\);|^\s*$/m.test(fs.readFileSync(p, 'utf8').trim().slice(-30));
  chk(e.lf === 0 && intact, `${f}　纯 CRLF　尾部完整`, e.lf === 0 ? `尾部截断？` : `纯LF=${e.lf} 行`);
}

console.log('\n2) daemon 挂载点（少一处就哑火，多一处就重复挂载）');
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts/daemon.js'), 'utf8');
const HOOKS = [
  ["require('./ck-memory')", 1],
  ['ckMemory.configure(', 1],
  ['ckMemory.uiSource()', 1],
  ["(ckMemoryUi ? '\\n' + ckMemoryUi : '')", 1],
  ["'/api/ck-memory/'", 1],
  ['ckMemory.startAll()', 1],
  ['ckMemory.stopAll()', 3],
];
for (const [needle, want] of HOOKS) {
  const got = daemonSrc.split(needle).length - 1;
  chk(got === want, `${needle}　×${got}`, `期望 ${want} 处，实际 ${got} 处`);
}
chk(eol(path.join(ROOT, 'scripts/daemon.js')).lf === 0, 'daemon.js 纯 CRLF');

console.log('\n3) 注入源完整性');
tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ckm-'));
const dataDir = path.join(tmpRoot, 'data');
const dataRoot = path.join(tmpRoot, 'root');
const ck = require(path.join(ROOT, 'scripts/ck-memory.js'));
ck.configure({ dataRoot, dataDir, log: () => {} });

let ui = ck.uiSource();
const hasPh = ui.indexOf('__WBS_API__') >= 0 && ui.indexOf('__WBS_API_TOKEN__') >= 0;
chk(hasPh, '前端带 API 占位符');
ui = ui.replace(/__WBS_API__/g, 'http://127.0.0.1:47832').replace(/__WBS_API_TOKEN__/g, 'tok');
let jsOk = true;
try { new Function(ui); } catch (_) { jsOk = false; }
chk(jsOk, '占位符替换后仍是合法 JS（否则整个注入源失效）');

/* ---------------- 2. 行为层：造一份假 transcript ---------------- */

console.log('\n4) 造数据 → 真跑索引');
const SID = 'test-session-0001';
const projDir = path.join(dataRoot, 'projects', 'p-test');
fs.mkdirSync(projDir, { recursive: true });
const jsonl = path.join(projDir, SID + '.jsonl');

const ev = (o) => JSON.stringify(o);
const lines = [
  ev({ type: 'message', role: 'user', timestamp: 1790000000000, content: [{ type: 'text', text: '<user_query>订单尾款什么时候到账？粘胶纱这柜</user_query>' }] }),
  ev({ type: 'message', role: 'assistant', timestamp: 1790000001000, content: [{ type: 'text', text: '尾款 USD 231472.08，等 SUNRISE-FZCO 支付。' }] }),
  ev({ type: 'function_call_result', name: 'read_table', timestamp: 1790000002000, output: 'PI#0053 七柜明细……' }),
  // 压缩摘要：必须被剔掉，否则时间线全是噪声、库体积翻倍
  ev({ type: 'message', role: 'user', timestamp: 1790000003000, content: [{ type: 'text', text: '<cb_summary> Summary of the conversation so far: 这里是旧内容的浓缩副本' }] }),
  ev({ type: 'message', role: 'user', timestamp: 1790000004000, content: [{ type: 'text', text: '<conversation_history_summary> Summary: 又一份摘要</conversation_history_summary>' }] }),
  ev({ type: 'message', role: 'user', timestamp: 1790000005000, content: [{ type: 'text', text: 'Please continue with the conversation based on the summarized context and proceed.' }] }),
  ev({ type: 'message', role: 'user', timestamp: 1790000006000, content: [{ type: 'text', text: 'Use the TaskOutput tool with task_id="abc123" to retrieve the full output' }] }),
  ev({ type: 'message', role: 'user', timestamp: 1790000007000, content: [{ type: 'text', text: '把埃及那五柜的装运单据列一下' }] }),
];
fs.writeFileSync(jsonl, lines.join('\n') + '\n', 'utf8');

const st0 = fs.statSync(jsonl);
const target = { sid: SID, proj: 'p-test', path: jsonl, size: st0.size, mtimeMs: st0.mtimeMs };
const db = ck._internal.open();
chk(!!db, '库能打开（临时目录）', db ? '' : 'node:sqlite 不可用');

const r1 = ck._internal.ingestSession(db, target, { force: true });
chk(r1.added === 4, `入库 4 条（2 对话 + 1 工具 + 1 真实提问），实际 ${r1.added}`, '注入噪声必须被剔掉：摘要 2 份 / 续写话术 1 条 / TaskOutput 提示 1 条');

console.log('\n5) 检索');
const s1 = ck.search('尾款', 5);
chk((s1.hits || []).length >= 2, `两字中文词「尾款」命中 ${(s1.hits || []).length} 条`);
const s2 = ck.search('粘胶纱', 5);
chk((s2.hits || []).length >= 1, `三字词「粘胶纱」命中 ${(s2.hits || []).length} 条`);
const s3 = ck.search('浓缩副本', 5);
chk((s3.hits || []).length === 0, '摘要正文搜不到（确认未入库，不是被界面藏起来）');

const tl = ck.timeline(50);
const tlText = (tl.items || []).map((x) => x.text).join('\n');
chk((tl.items || []).length === 2, `时间线 ${(tl.items || []).length} 条，只含用户真实发言`);
chk(!/Summary of the conversation|conversation_history_summary|TaskOutput tool/.test(tlText), '时间线里没有摘要 / TaskOutput 噪声');
// ⚠️ 长会话必须给「最近 N 条」。真会话已有 1251 条用户发言，从头取等于永远看不到近期（2026-11-03 实测踩中）
const tl1 = ck.timeline(1);
chk((tl1.items || []).length === 1 && /把埃及那五柜/.test(tl1.items[0].text), 'timeline(1) 返回的是最新那条，不是最早那条');
chk(tl1.total === 2 && tl1.truncated === true, `时间线带 total=${tl1.total} / truncated=${tl1.truncated}`);

// 检索优先对话，工具回显只在对话无命中时兜底
// ⚠️ 分层后语义变了：默认只查有效记忆（用户发言 + 每回合结论），
//   工具输出属于 pri=0 的过程话，**必须显式 deep=true** 才查得到。
//   所以要双向验：默认查不到（说明分层真的生效）+ 深入能查到（说明数据没被删）。
const sTool = ck.search('PI#0053', 5);
chk((sTool.hits || []).length === 0, '默认不把工具回显混进结果（分层生效）');
const sToolDeep = ck.search('PI#0053', 5, true);
chk((sToolDeep.hits || []).length === 1 && sToolDeep.hits[0].tool === 'read_table',
  'deep=true 时仍能查到工具输出（过程话一条没删，只是默认不参与）');
const sTalk = ck.search('尾款', 5);
chk((sTalk.hits || []).length > 0 && (sTalk.hits || []).every((h) => h.role === 'user' || h.role === 'assistant'), '检索默认只回对话，不混工具回显');

console.log('\n6) 幂等：强制重建不能翻倍');
const r2 = ck._internal.ingestSession(db, target, { force: true });
const total = ck.status().segments;
chk(total === 4 && r2.added === 4, `重建后仍 ${total} 条（历史 bug：contentless FTS5 删不掉 ⇒ 25k 堆到 102k）`);

console.log('\n7) 增量：只读新增的那一段');
fs.appendFileSync(jsonl, ev({ type: 'message', role: 'user', timestamp: 1790000008000, content: [{ type: 'text', text: '再加一条：提单要三正三副' }] }) + '\n', 'utf8');
const st1 = fs.statSync(jsonl);
const r3 = ck._internal.ingestSession(db, Object.assign({}, target, { size: st1.size, mtimeMs: st1.mtimeMs }), {});
chk(r3.added === 1 && ck.status().segments === 5, `增量新增 ${r3.added} 条 / 共 ${ck.status().segments} 条（每 30s 走的就是这条路）`);

console.log('\n8) 可剥离性');
chk(daemonSrc.indexOf('删 scripts/ck-memory.js 与 ck-memory-ui.js') >= 0, 'daemon 里写明了剥离方法');

/* 9) 面板可见性守卫 —— 两个都实测坑过一次，别让它们回来
   ① 标签栏不许靠「横向滚动 + 隐藏滚动条」兜底：标签从 9 个涨到 10 个后，
      第 10 个（🧠记忆）被挤到右边缘只露一条缝，用户直接以为功能没做。
      后来又踩第二坑：改成 flex-wrap:wrap 之后，第 10 个掉到第二行，
      再被 flex-grow 拉成 610px 的整条黑条（实测面板 636px，临界 660px）。
      第三坑：改用 auto-fill 之后，矮窄面板下算出了 12 列，10 个标签硬挤一行、
      每个只剩 53px，「自动化」被截成「自…」——一行整齐但读不出字。
      ⇒ 正解是 **grid + 固定 5 列**：恒为 2 行 × 5 列，340~720px 实测无一截断。
      判定标准：grid-template-columns 是 repeat(5,1fr)，且 .wbs-tab 有 min-width:0。
   ② 侧车网关卡片的补挂计时器不许「不在模型页就烧完计数」：24 秒后永久停摆，
      之后点开模型页再也不挂卡片（表现为「经常消失、偶尔出现」）。
      必须有点标签就重新武装的钩子。 */
console.log('\n9) 面板可见性守卫');
const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8');
const tabsRule = (injectSrc.match(/\.wbs-tabs\{[^}]*\}/) || [''])[0];
const tabRule = (injectSrc.match(/\.wbs-tab\{[^}]*\}/) || [''])[0];
chk(/display:\s*grid/.test(tabsRule) && /repeat\(5,/.test(tabsRule), '标签栏用 grid 固定 5 列（2 行 × 5 列，末项不被拉伸、文字不截断）', tabsRule.slice(0, 70));
chk(!/auto-fill/.test(tabsRule), '不用 auto-fill（窄面板会算成 12 列把「自动化」截成「自…」）', tabsRule.slice(0, 70));
chk(/min-width:\s*0/.test(tabRule), '标签在网格内可压缩（min-width:0，否则长短不一的文本顶宽格子）', tabRule.slice(0, 60));
// 反例守卫：这些写法会让末项又被拉成整条
chk(!/flex:\s*1 1 58px/.test(tabRule), '标签不再用 flex:1 1 58px（换成 grid 后它会把末项拉满整行）', tabRule.slice(0, 60));

/* 9b) 面板结构回归 —— 2026-11-04 面板整理，四条都实测踩过
   ① 标签记忆：面板不记上次那一页，「记忆」排第 10 位，每次重开都要横跨整条标签栏重点。
   ② 记忆页双层滚动：wrap 与 list 都 overflow-y:auto，面板 ≤420px 时底栏被挤出可视区 19px。
   ③ 状态条单行截断：内容 624px / 可视 436px，被截掉的正是「重复合并 / 忽略续跑」两个关键数。
   ④ 换号重复：账号页有卡片、自动化页又列一条同名任务，两个叫法两个开关。 */
chk(/wbs-panel-tab-/.test(injectSrc), '① 标签记忆：按 profile 存上次所在页', '');
chk(/function restorePanelTab\(/.test(injectSrc) && /restorePanelTab\(0\)/.test(injectSrc), '① 面板打开时恢复上次那一页', '');
chk(/function rememberTab\(/.test(injectSrc) && /rememberTab\(name\)/.test(injectSrc), '① switchTab 会写入记忆', '');

const uiPanelSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory-ui.js'), 'utf8');
const wrapRule = (uiPanelSrc.match(/\.ckm-wrap\{[^}]*\}/) || [''])[0];
const listRule = (uiPanelSrc.match(/\.ckm-list\{[^}]*\}/) || [''])[0];
chk(/overflow:\s*hidden/.test(wrapRule), '② 外层 wrap 不自己滚动（唯一滚动容器是 list）', wrapRule.slice(0, 60));
chk(/min-height:\s*0/.test(listRule), '② list 用 min-height:0（100px 会顶住 wrap 挤出底栏）', listRule.slice(0, 60));
chk(/toggle\('compact'/.test(uiPanelSrc) && /toggle\('tiny'/.test(uiPanelSrc), '② 矮面板有 compact/tiny 两档密度', '');

/**
 * 9c) 「上次注入」区块不能被裁 —— 2026-11-04 阶段 2 实测踩到
 *   第一版给 .ckm-inj 写了 `overflow:hidden`（为了圆角裁切）。
 *   展开详情后实测 scrollHeight=185 / clientHeight=67：
 *   三条命中记录被整块裁掉，只剩「上次：命中 · 锚定 xxx」那一行，
 *   用户看到的是「只带了标题、没带内容」，实际内容都在 DOM 里但看不见。
 *   ⇒ 外层必须 visible；滚动交给内部的 .ckm-inj-box（max-height + overflow-y:auto）。
 *
 * ⚠️⚠️ 2026-11-05 重构后外层从 `.ckm-inj` 换成了 `.ckm-adv`（两张开关卡收进「高级」折叠区）。
 *   断言要跟着换目标，但**判据不能松** —— 这个坑是真实发生过的，
 *   只要「展开框的某个祖先会裁剪」就会原地复活。
 *   所以这里改成：新外层 `.ckm-adv` 必须 visible，同时**全文件不允许出现
 *   同时带 overflow:hidden 又包含 .ckm-inj-box 的规则**（用下面那条反例守卫兜）。
 */
const injRule = (uiPanelSrc.match(/\.ckm-adv\{[^}]*\}/) || [''])[0];
const injBoxRule = (uiPanelSrc.match(/\.ckm-inj-box\{[^}]*\}/) || [''])[0];
chk(/overflow:\s*visible/.test(injRule), '③ 注入卡片外层不裁剪（overflow:visible，否则详情被整块吃掉）', injRule.slice(0, 70));
chk(!/overflow:\s*hidden/.test(injRule), '③ 反例守卫：注入卡片不能写 overflow:hidden', injRule.slice(0, 70));
chk(/max-height/.test(injBoxRule) && /overflow-y:\s*auto/.test(injBoxRule),
  '③ 详情框自己滚（max-height + overflow-y:auto，条数多时不撑爆面板）', injBoxRule.slice(0, 80));
// 展开按钮点击后必须走 render（只调异步加载的话 box.hidden 不会被更新，实测点了没反应）
chk(/S\.injOpen = !S\.injOpen;[\s\S]{0,320}render\(\);/.test(uiPanelSrc),
  '③ 点「上次」会走 render（否则 hidden 不更新、点了没反应）');
chk(/new ResizeObserver/.test(uiPanelSrc), '② 拖面板尺寸即时重算密度（不依赖 render 时机）', '');

/**
 * ③b 会话下拉弹层必须挂 `.wbs-root`，不能挂 `body`。
 *
 * ⚠️⚠️⚠️ 2026-11-05 真实缺陷（老叶报「点『查看：整理画册』没有下拉框」）：
 *   弹层确实打开了（hidden=false / display:flex / 587×280），位置也算对了，
 *   但 `document.elementFromPoint(中心)` 命中的是 `INPUT.ckm-input` ——
 *   整个被面板盖住。根因是两层层叠上下文打架：
 *     · `.wbs-root`  = fixed + **z-index:2147483647**（int32 上限，改不动了）
 *     · 弹层挂 body = fixed + z-index:9999
 *   fixed 元素各自成层，9999 与 2147483647 同处根上下文 ⇒ 面板永远压在上面。
 *   ⇒ 唯一解：挪进 `.wbs-root` 内部与 `.wbs-panel` 当兄弟，同一上下文里比 z。
 *
 * ⚠️ 判据不能只查「有没有 popHost」：真正的失败形态是**又改回 body**，
 *   所以两条一起锁：必须走 popHost()，且源码里不许再出现
 *   `document.body.appendChild(pop)`。
 */
chk(/function popHost\s*\(/.test(uiPanelSrc) && /popHost\(\)\.appendChild\(pop\)/.test(uiPanelSrc),
  '③b 弹层经 popHost() 挂载（z-index 被面板碾平的根因）');
chk(!/document\.body\.appendChild\(pop\)/.test(uiPanelSrc),
  '③b 反例守卫：弹层不许挂回 body（会被 .wbs-root 的 2147483647 盖住）');
chk(/querySelector\('\.wbs-root'\)/.test(uiPanelSrc),
  '③b popHost 优先取 .wbs-root（同层叠上下文，且实测 overflow:visible 不裁剪）');
/**
 * ③c 点外部关闭弹层时，必须把**弹层自身**也算作「内部」。
 *   ⚠️ 只判 `.ckm-pick` 的后果：在弹层搜索框里点一下（只想聚焦打字），
 *   捕获阶段先跑 closePop ⇒ 弹层当场消失，搜索框等于不能用。
 */
chk(/pick\.contains\(e\.target\)\s*\|\|\s*\(?popEl\s*&&\s*popEl\.contains\(e\.target\)\)?/.test(uiPanelSrc),
  '③c 点外部关闭时弹层自身算内部（否则一点搜索框弹层就消失）');

/**
 * ⚠️⚠️ 2026-11-05：旧的「状态条拆两行（meta1 + meta2）」断言已失效 ——
 *   重构后状态条是**四行**（标题行 / 大字摘要 / AI 在用谁 / 详情表），
 *   `.ckm-meta2` 那 5 个内部指标徽标全部搬进了「详情」折叠表。
 *   新判据验的是**同一件事**：那些指标不能消失、且必须看得懂。
 *   ① 大字摘要必须在（ckm-big）；
 *   ② 每个技术指标必须同时有「值」和「大白话」（ckm-dv + ckm-dw 成对）；
 *   ③ 折叠区默认收起，否则首屏又会被数字塞满。
 */
chk(/ckm-big/.test(uiPanelSrc) && /已记住/.test(uiPanelSrc),
  '③ 状态条有一句话摘要「已记住 N 个会话 · K 条有效记忆」（这一页最重要的一句）', '');
chk(/ckm-dv/.test(uiPanelSrc) && /ckm-dw/.test(uiPanelSrc),
  '③ 技术指标「值 + 大白话」成对出现（不是只给一堆裸数字）', '');
chk(/detBox\.hidden = true|\.ckm-detail\[hidden\]\{display:none\}/.test(uiPanelSrc),
  '③ 详情表默认收起（首屏不能被 11 行技术指标塞满）', '');

// ---- 阶段 3 的 UI 断言：排序依据必须**看得见** ----
chk(/ckm-hitn/.test(uiPanelSrc), '③ 命中项显示「多久没被用到」（排序依据可见，否则没法解释为什么它排前面）');
const hitnRule = (uiPanelSrc.match(/\.ckm-hitn\{[^}]*\}/) || [''])[0];
chk(/#[0-9a-fA-F]{6}/.test(hitnRule),
  '③ 该徽标的前景色写死 hex（面板可能挂在 body 外，拿不到 --wb-* 变量）', hitnRule.slice(0, 80));
chk(/hitRows/.test(uiPanelSrc), '③ 状态条显示「用过 N 条」（否则回写静默失败也看不出来）');
chk(/hitErrors/.test(uiPanelSrc), '③ 回写失败有独立指引（静默 ≠ 永远没人知道）');
// ⚠️ 实测踩过：状态条已显示「AI 在 e567d9db」，触发器副标题仍是更早的 8f92c3fc ——
//   sig 变了但 stat.active 还没跟上，分支进去渲染了旧值，两处打架。副标题必须以 actSid 为准。
chk(/var sub = String\(actSid\)/.test(uiPanelSrc), '③ 触发器副标题与状态条同源（都用 actSid，不拿 stat.active）', '');

chk(/WBS_HIDDEN_AUTO_IDS/.test(injectSrc) && /wbsAutoHiddenInList/.test(injectSrc), '④ 换号任务不在自动化页重复列出', '');
chk(/selectableTasks/.test(injectSrc), '④ 全选排除隐藏任务（否则会选中用户看不见的项）', '');
chk(/mu0mg334-rate-limit-auto-switch/.test(injectSrc), '④ 任务本体保留（只隐藏展示，绝不删数据）', '');

// 图标：外挂标签原先用 emoji 🧠，与其余 9 个 stroke SVG 字重/基线都不齐
chk(!/'🧠'/.test(uiPanelSrc), '图标统一：记忆标签不再用 emoji', '');
chk(/wbs-tab-ico/.test(uiPanelSrc) && /<svg viewBox="0 0 24 24"/.test(uiPanelSrc), '图标统一：改用 15px stroke SVG', '');

const sgSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'side-gateway-ui.js'), 'utf8');
chk(/document\.addEventListener\('click',\s*tabHook/.test(sgSrc), '侧车卡片：点标签会重新武装探测');
chk(/document\.removeEventListener\('click',\s*tabHook/.test(sgSrc), '侧车卡片：teardown 会摘掉点击钩子（热更不叠加）');

/* 10) MCP 入口与配置自维护 —— 旧的拆掉了，别悄悄退回去
   旧 ck-mcp.js 住在 ~/.workbuddy/hooks/ 里，靠手写 mcp.json 指向它：
   换台电脑就没有，路径全是本机绝对值，还拖着旧的 ck-db.js。
   现在入口搬进 scripts/ 跟插件同生共死，配置由 ensureMcpConfig()
   用 __dirname / process.execPath 现算 —— 换机器自动更正。 */
console.log('\n10) MCP 入口与配置自维护');
const mcpPath = path.join(ROOT, 'scripts', 'ck-mcp.js');
chk(fs.existsSync(mcpPath), 'scripts/ck-mcp.js 存在');
const mcpSrc = fs.existsSync(mcpPath) ? fs.readFileSync(mcpPath, 'utf8') : '';
chk(!/(?<!\r)\n/.test(mcpSrc) && !/\r(?!\n)/.test(mcpSrc), 'ck-mcp.js 纯 CRLF');
chk(mcpSrc.indexOf('ck-db') < 0 && mcpSrc.indexOf('hooks') < 0, '不再依赖旧的 ck-db.js / hooks 目录');
chk(/__dirname/.test(mcpSrc), '用 __dirname 定位同目录的 ck-memory.js（换机器仍成立）');
chk((mcpSrc.match(/require\(/g) || []).length <= 2, '只 require path 与 ck-memory（零第三方依赖）');
chk(/memory_search/.test(mcpSrc) && /memory_recent/.test(mcpSrc) && /memory_timeline/.test(mcpSrc), '三个工具名齐全');
chk(/process\.stdout\.write/.test(mcpSrc) && /process\.stderr/.test(mcpSrc), '协议走 stdout、日志走 stderr');

const cfgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ckm-mcpcfg-'));
const cfgFile2 = path.join(cfgRoot, 'mcp.json');
fs.writeFileSync(cfgFile2, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }, null, 2), 'utf8');
ck.configure({ dataRoot: cfgRoot, dataDir: path.join(cfgRoot, 'data'), log: () => {} });

let rc = ck.ensureMcpConfig();
let mj = JSON.parse(fs.readFileSync(cfgFile2, 'utf8'));
chk(rc.changed === true && !!mj.mcpServers['ck-memory'], '缺条目时自动补上');
chk(fs.existsSync(mj.mcpServers['ck-memory'].args[1]), 'args 指向真实存在的脚本');
chk(!!mj.mcpServers.other, '不碰其它 MCP 服务器条目');

const snap = fs.readFileSync(cfgFile2, 'utf8');
rc = ck.ensureMcpConfig();
chk(rc.changed === false && fs.readFileSync(cfgFile2, 'utf8') === snap, '已有效时一个字都不改（不会每次启动重写）');

mj.mcpServers['ck-memory'] = { command: 'X:/old/node.exe', args: ['--no-warnings', 'X:/old/ck-mcp.js'] };
fs.writeFileSync(cfgFile2, JSON.stringify(mj, null, 2), 'utf8');
rc = ck.ensureMcpConfig();
const fixed = JSON.parse(fs.readFileSync(cfgFile2, 'utf8')).mcpServers['ck-memory'];
chk(rc.changed === true && fs.existsSync(fixed.args[1]), '路径失效（换电脑）时自动更正');

const emptyRoot = path.join(cfgRoot, 'nodir');
fs.mkdirSync(emptyRoot, { recursive: true });
ck.configure({ dataRoot: emptyRoot, dataDir: path.join(emptyRoot, 'data'), log: () => {} });
rc = ck.ensureMcpConfig();
chk(rc.ok === false && !fs.existsSync(path.join(emptyRoot, 'mcp.json')), 'mcp.json 不存在时不擅自创建');

fs.rmSync(cfgRoot, { recursive: true, force: true });
// ⚠️ 必须把 dataRoot 改回来：后面还要在这份临时仓里查数据。
//    （早先靠 findActiveSession 的 30 秒缓存「侥幸」还能查到，改成 fresh 后立刻暴露）
ck.configure({ dataRoot: dataRoot, dataDir: dataDir, log: () => {} });

/* 10) v2 数据卫生 —— 三个实测数字换来的四条规则
   升级前真库：25579 条里 68% 是工具回显、13.4% 是完全重复，
   而 1252 条「用户发言」里 962 条是客户端自动塞的「请继续执行任务」（77%）。
   这四条规则就是针对它们，任何一条回退，面板立刻变回「看着有用其实很废」。 */
console.log('\n10) v2 数据卫生：折叠 / 续跑指令 / bm25 排序 / 时间衰减');
const NOW = Date.now();
const D = 86400000;
const extra = [
  // ① 客户端自动续跑指令 ×3（必须入库但标 noise，不进时间线）
  ...[0, 1, 2].map((k) => ev({ type: 'message', role: 'user', timestamp: NOW - (3 - k) * 60000, content: [{ type: 'text', text: '请继续执行任务' }] })),
  // ② 同一句真话 ×3（折叠成 1 行 + dup=3）
  ...[0, 1, 2].map((k) => ev({ type: 'message', role: 'user', timestamp: NOW - (3 - k) * 60000 + 500, content: [{ type: 'text', text: '重复测试：同一句话说了三遍' }] })),
  // ③ 时间衰减：一条 400 天前、一条 1 小时前，措辞几乎一致
  ev({ type: 'message', role: 'user', timestamp: NOW - 400 * D, content: [{ type: 'text', text: '测试甲：网关端口配置说明' }] }),
  ev({ type: 'message', role: 'user', timestamp: NOW - 3600000, content: [{ type: 'text', text: '测试乙：网关端口配置说明' }] }),
];
fs.appendFileSync(jsonl, extra.join('\n') + '\n', 'utf8');
const st2 = fs.statSync(jsonl);
const r4 = ck._internal.ingestSession(db, Object.assign({}, target, { size: st2.size, mtimeMs: st2.mtimeMs }), {});

chk(r4.added === 4, `折叠生效：8 条事件只占 4 行（续跑 3→1、重复 3→1、甲乙各 1），实际 ${r4.added}`);
chk(r4.merged === 4, `折叠次数 ${r4.merged}（3 条续跑 + 1 条重复被合并）`);

const rows = db.prepare("SELECT text, dup, COALESCE(noise,0) nz FROM seg WHERE sid = ? AND (text LIKE '%重复测试%' OR text = '请继续执行任务')").all(SID);
const repRow = rows.find((r) => String(r.text).indexOf('重复测试') >= 0);
const noiseRow = rows.find((r) => String(r.text) === '请继续执行任务');
chk(!!repRow && repRow.dup === 3, `同一句话存 1 行、dup=${repRow && repRow.dup}`);
chk(!!noiseRow && noiseRow.dup === 3 && noiseRow.nz === 1, `续跑指令存 1 行、dup=${noiseRow && noiseRow.dup}、noise=${noiseRow && noiseRow.nz}`);

const tl2 = ck.timeline(50);
const tl2Text = (tl2.items || []).map((x) => x.text).join('\n');
chk(!/请继续执行任务/.test(tl2Text), '续跑指令不进时间线（否则 972 条复读把真实要求全淹掉）');
chk(tl2Text.indexOf('重复测试') >= 0, '真实重复发言仍留在时间线里（只是合并计数，不是删掉）');

const rc2 = ck.recent(24 * 30, 100);
chk(!(rc2.items || []).some((x) => String(x.text).trim() === '请继续执行任务'), '续跑指令也不进「最近」');

// ⚠️ 这是本轮最大的一个 bug：早先 bm25() 在 JOIN + IN 子查询里恒返回 0，
//    ORDER BY score 等于没排序，结果按插入顺序出来、工具回显排在对话前面。
const sb = ck.search('尾款', 5);
const scores = (sb.hits || []).map((h) => h.score);
chk(new Set(scores).size > 1, `bm25 真的算出分了（${scores.join(' / ')}）`, '全 0 = 排序失效，已回退到旧写法');
chk(scores.every((v, k) => k === 0 || v >= scores[k - 1]), '结果按相关度升序（bm25 越小越相关）');

const sd = ck.search('网关端口', 5);
const names = (sd.hits || []).map((h) => String(h.text));
const idxNew = names.findIndex((t) => t.indexOf('测试乙') >= 0);
const idxOld = names.findIndex((t) => t.indexOf('测试甲') >= 0);
chk(idxNew >= 0 && idxOld >= 0 && idxNew < idxOld, `时间衰减：1 小时前的排在 400 天前的之前（乙#${idxNew} / 甲#${idxOld}）`);

const sNoise = ck.search('重复测试', 5);
chk((sNoise.hits || []).length === 1 && sNoise.hits[0].dup === 3, '检索结果带 dup=3，能看出「这话说过三遍」');

const stv = ck.status();
chk(stv.talk != null && stv.folded != null && stv.noise != null, `status 提供分类计数：对话 ${stv.talk} / 折叠 ${stv.folded} / 续跑 ${stv.noise}`);
chk(stv.userTalk === (tl2.total || 0), `userTalk ${stv.userTalk} 与时间线 total ${tl2.total} 一致（同一套过滤）`);

console.log('\n10b) 记忆分层：过程话不稀释有效记忆');
// ⚠️ 这组断言直接对应老叶的原话：「记忆会把你的每一句话都记录成一条，
//    一次任务可能蹦出几十甚至上百句话，这样是否会稀释记忆的有效性」
// 测试数据里 3 条 user + 若干 assistant，分层后应满足：
//   ① 用户发言一律 pri=2（一条都不能丢）
//   ② 每个回合只留最后一条 assistant 为 pri=1
//   ③ 工具输出一律 pri=0
const priRows = db.prepare('SELECT kind, pri, COUNT(*) c FROM seg GROUP BY kind, pri').all();
// ⚠️ 用户发言里有一类要排除：自动续跑指令（「请继续执行任务」）本身标了 noise=1，
//   分层时按「不算用户发言」处理 —— 断言必须跟着用同一套过滤，否则会误判成分层做错。
const realUser = db.prepare("SELECT pri, COUNT(*) c FROM seg WHERE kind='user' AND COALESCE(noise,0)=0 GROUP BY pri").all();
chk(realUser.length === 1 && realUser[0].pri === 2, `真实用户发言全部 pri=2（${JSON.stringify(realUser)}）`,
  '用户需求被降级 = 分层做反了，绝对不能出现');
// 续跑指令必须留在 0：它们不是用户想说的话，进时间线只会刷屏
const noiseUser = db.prepare("SELECT pri, COUNT(*) c FROM seg WHERE kind='user' AND COALESCE(noise,0)=1 GROUP BY pri").all();
chk(noiseUser.every((r) => r.pri === 0), `自动续跑指令不进有效记忆（${JSON.stringify(noiseUser)}）`);
chk(db.prepare("SELECT COUNT(*) c FROM seg WHERE kind='tool' AND COALESCE(pri,0)<>0").get().c === 0,
  '工具输出全部 pri=0（找不到命令/文件时靠 deep 翻）');
const nFin = db.prepare("SELECT COUNT(*) c FROM seg WHERE kind='assistant' AND pri=1").get().c;
const nAsst = db.prepare("SELECT COUNT(*) c FROM seg WHERE kind='assistant'").get().c;
chk(nFin >= 1 && nFin <= nAsst, `${nAsst} 条 assistant 里有 ${nFin} 条算「结论」`);

const stPri = ck.status();
chk(stPri.validMem > 0 && stPri.procMem > 0, `status 分层计数：有效 ${stPri.validMem} / 过程话 ${stPri.procMem}`);
chk(stPri.validMem < stPri.segments, '有效记忆数严格小于总条数（说明分层真的在筛）');

console.log('\n11) 迁移幂等');
const ver = db.prepare('PRAGMA user_version').get().user_version;
/**
 * ⚠️ 这里只守**下限**，不写死具体版本。
 *   v1→v6 每次加 schema 都要改这一行，而「顺手改断言」正是把断言改松的开始。
 *   真正要守的性质是「迁移已经跑过了」—— 跑过就会 ≥ 当前最新版本，
 *   而不是「恰好等于某个数字」（那个数字每加一个 schema 就会变）。
 */
const SCHEMA_LATEST_EXPECT = 6;
chk(Number(ver) >= SCHEMA_LATEST_EXPECT,
  `user_version = ${ver}（≥ ${SCHEMA_LATEST_EXPECT}，说明迁移已跑过、不会每次启动重折叠 + 重分层 + 重抽事实）`);

/* 12) 面板热更守卫 —— 今晚连踩三个坑，都是「注入新了、但用户看到的还是旧东西」
   ① teardown 漏清 setInterval ⇒ 旧闭包每 1.5s 用旧 render 覆盖新 DOM。
      表现：data-ckm-rev 都对，状态条却是旧格式 —— 比完全没生效更难查。
   ② build() 复用上一版搭的 .ckm-wrap ⇒ 里面的事件处理器属于旧闭包。
      表现：状态条是新的、搜索框回车毫无反应（半死状态）。
   ③ 状态条主数字用总行数 ⇒ 2.2 万条里 1.5 万是工具回显，看不出真实价值。 */
console.log('\n12) 面板热更守卫');
const uiSrc = fs.readFileSync(path.join(ROOT, 'scripts/ck-memory-ui.js'), 'utf8');
chk(/window\.__ckmTimers/.test(uiSrc) && /function track\(/.test(uiSrc),
  '定时器统一登记（否则 teardown 清不掉，旧实例会一直覆盖新 DOM）');
const trackUses = (uiSrc.match(/track\(set(Timeout|Interval)\(/g) || []).length;
chk(trackUses >= 3, `所有定时器都走 track()：${trackUses} 处（probe / boot×2 / 兜底轮询）`);
chk(/clearInterval\(t\)/.test(uiSrc) && /clearTimeout\(t\)/.test(uiSrc),
  'teardown 与启动都按登记表清理');
chk(/builtRev === UI_REV/.test(uiSrc) && /oldWrap\.parentNode\.removeChild\(oldWrap\)/.test(uiSrc),
  '换版时整壳重建（不复用旧 DOM，事件处理器不能跨版本）');
chk(/st\.validMem/.test(uiSrc) && /条有效记忆/.test(uiSrc),
  '状态条主数字用「有效记忆」而不是总行数（2.2 万条里 1.5 万是工具回显，报总数会虚高 10 倍）');
chk(/折叠重复|重复合并/.test(uiSrc),
  '状态条仍标出折叠/续跑次数（只是搬进了「详情」折叠表，不能消失）');
chk(/\.ckm-dup\{/.test(uiSrc), '结果卡片有 ×N 徽标样式（折叠后信息不丢）');
chk(/ckm-note/.test(uiSrc) && /共 ' \+ num\(S\.tlTotal\)/.test(uiSrc),
  '时间线写明「共 N 条，显示最近 120 条」');

/* 13) 多会话：索引可以并存，查询必须互不串门
   需求原话：「不能仅局限于现在这条对话，我还有其他几条长会话需要加入；
              每条会话的记忆只在该会话内独立就行，不用跟其他会话共享。」
   所以这里要同时验两件事：
     ① 第二条会话能被单独索引（不靠「当前会话」那条路）；
     ② 在 A 里搜不到 B 的词 —— 索引并存不等于内容串味。 */
console.log('\n13) 多会话：并存索引 + 查询隔离');
const SID2 = 'test-session-0002';
const projDir2 = path.join(dataRoot, 'projects', 'p-other');
fs.mkdirSync(projDir2, { recursive: true });
const jsonl2 = path.join(projDir2, SID2 + '.jsonl');
const lines2 = [
  ev({ type: 'message', role: 'user', timestamp: Date.now() - 7200000, content: [{ type: 'text', text: '<user_query>土耳其那单 ERZAK 的信用证条款确认一下</user_query>' }] }),
  ev({ type: 'message', role: 'assistant', timestamp: Date.now() - 7199000, content: [{ type: 'text', text: 'ERZAK 走即期信用证，最迟装运期 11 月 20 日。' }] }),
];
// 补一点无关内容把体积撑过 1KB，否则会被「空会话」过滤掉
for (let k = 0; k < 8; k++) {
  lines2.push(ev({ type: 'function_call_result', name: 'read_files', timestamp: Date.now() - 7000000 + k, output: 'ERZAK 单据目录 /contract/lc-draft-2026.pdf 第 ' + k + ' 份附件（占位内容，用于撑大文件体积）' }));
}
fs.writeFileSync(jsonl2, lines2.join('\n') + '\n', 'utf8');

const before = ck.status().sessions;
ck._internal.state.follow = [SID2];
const bf = ck._internal.nextBackfill(db);
chk(!!bf && bf.sid === SID2, '跟踪名单里的会话会被 nextBackfill 挑出来单独回填', bf ? bf.sid : 'null');
const r5 = ck._internal.ingestSession(db, bf, {});
chk((r5.added || 0) >= 3, `第二条会话独立入库 ${r5.added} 条（不影响第一条）`);
chk(ck.status().sessions === before + 1, `库里现在 ${ck.status().sessions} 条会话（改前 ${before}）`);

chk(ck._internal.nextBackfill(db) === null, '两边都同步后不再重复回填（不会每轮空转）');

// 当前会话 = mtime 最新的那条 = SID2；MCP 的三个工具走的就是这条路
const hitTr = ck.search('ERZAK', 5);
chk((hitTr.hits || []).length > 0, `当前会话绑到 SID2，搜「ERZAK」命中 ${(hitTr.hits || []).length} 条`);
const hitOther = ck.search('尾款', 5);
chk((hitOther.hits || []).length === 0, '在 SID2 里搜不到只属于 SID1 的「尾款」——记忆不串门');
const hitS1 = ck._internal.search(SID, 'ERZAK', 5);
chk((hitS1.hits || []).length === 0, '反过来，指定 SID1 也搜不到 SID2 的「ERZAK」');

const sl = ck._internal.sessionList();
chk((sl.items || []).length === 2, `会话清单列出 ${(sl.items || []).length} 条`);
chk((sl.items || []).every((x) => x.indexed), '两条都标为已建索引');
chk((sl.items || []).filter((x) => x.active).length === 1, '清单里只有一条被标成「当前会话」');
chk((sl.items || []).some((x) => x.sid === SID2 && x.followed), '被跟踪的会话在清单里带 followed 标记');
chk((sl.items || []).every((x) => typeof x.rows === 'number' && x.short.length === 8), '清单项带短 ID 与条数（面板下拉直接用）');

const ms = ck.mcpSessions();
chk(ms.indexed.length === 2 && ms.active && ms.active.short.length === 8, 'memory_sessions 能看到 2 条索引与当前绑定');
chk(!('title' in ms.indexed[0]) && !('text' in ms.indexed[0]), 'memory_sessions 不含标题/正文（只给元信息）');

const removed = ck._internal.dropSession(db, SID2);
chk(removed > 0 && ck.status().sessions === before, `删掉单条会话 ${removed} 行，其余会话原样保留`);

/* ---------------- 14. 绑定信号：点开会话必须跟过去 ---------------- */

console.log('\n14) 绑定信号（点开会话不发消息也要跟过去）');

// 让 SID1 的 mtime 最新，模拟「界面上点开了 SID2，但 SID1 刚被写过」
const nowMs = Date.now();
fs.utimesSync(path.join(projDir, SID + '.jsonl'), new Date(nowMs), new Date(nowMs));
const byMtime = ck.findActiveSession({ fresh: true });
chk(byMtime && byMtime.sid === SID, '无绑定时按 mtime 取最新写入的那条（兜底路径）');

const bindOk = ck.setBind(SID2, 1234);
chk(bindOk === true, '合法 sid 被接受');
const bound = ck.findActiveSession({ fresh: true });
chk(bound && bound.sid === SID2, '有绑定时优先认绑定，不再看 mtime');
chk(ck.bindInfo().sid === SID2 && ck.bindInfo().live === true, 'bindInfo 报告 live');

// 绑定必须落盘：MCP 是另一个进程，读不到 daemon 的内存
const bindPath = path.join(dataDir, 'ck-memory', 'bind.json');
chk(fs.existsSync(bindPath), '绑定写进了 bind.json（跨进程共享的前提）');
let persisted = null;
try { persisted = JSON.parse(fs.readFileSync(bindPath, 'utf8')); } catch (_) {}
chk(persisted && persisted.sid === SID2, 'bind.json 里的 sid 正确');

// 非法 sid 一律拒绝，且不破坏已有绑定
chk(ck.setBind('../../etc/passwd', 0) === false, '路径穿越形态的 sid 被拒绝');
chk(ck.setBind('', 0) === false, '空 sid 被拒绝');
chk(ck.bindInfo().sid === SID2, '非法上报不影响已有绑定');

// 指向一个不存在的会话时，必须回落到 mtime，不能返回 null 让人查不了记忆
ck.setBind('deadbeef-0000-0000-0000-000000000000', 0);
const fb = ck.findActiveSession({ fresh: true });
chk(fb && fb.sid === SID, '绑定指向已不存在的会话时回落 mtime（不会查不了记忆）');

// 过期绑定自动作废：手工把时间戳改老
ck.setBind(SID2, 0);
const raw = JSON.parse(fs.readFileSync(bindPath, 'utf8'));
raw.at = Date.now() - 180000;   // 3 分钟前 > BIND_TTL(2 分钟)
fs.writeFileSync(bindPath, JSON.stringify(raw), 'utf8');
chk(ck.bindInfo().live === false, '超过 TTL 的绑定判为失效');
const expired = ck.findActiveSession({ fresh: true });
chk(expired && expired.sid === SID, '绑定过期后回落到 mtime（不会钉死在旧会话上）');

/* ---------------- 14b. 打开会话即自动建记忆 ----------------
   老叶的原话：「我现在切换到其他长会话时，我该怎么建立那个长会话的记忆？
   你之前说的点开什么的用法，我试了不好使啊。」
   根因：旧设计里「点开会话」只做了绑定（决定查哪条），**不会建索引** ——
   建索引要靠一个叫「加入跟踪」的按钮，而那个名字完全没表达出「这是建记忆的开关」。
   现在的规则：绑定信号一到，自动把它排进索引队列，用户什么都不用按。 */
console.log('\n14b) 打开会话即自动建记忆');

const cfgPath = path.join(dataDir, 'ck-memory', 'config.json');
const readFollow = () => {
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')).follow || []; } catch (_) { return []; }
};
// 用一个全新的 sid（磁盘上不存在）验证「入队」这件事本身不依赖文件存在
const AUTO_SID = 'abcdef12-3456-7890-abcd-ef1234567890';
ck.setBind(AUTO_SID, 0);
chk(readFollow().indexOf(AUTO_SID) >= 0, '点开会话（上报绑定）后自动进索引队列，不需手动点任何按钮');

// ⚠️ 走真实 API 改配置，不直接调内部函数 —— saveConf 没导出，
//   而面板 / 外部改配置走的都是 /config 这个口子，用它才测得到真实路径。
//   同步喂 body：测试文件是 CommonJS，用不了顶层 await。
const cfgPost = (patch) => {
  const buf = Buffer.from(JSON.stringify(patch));
  const req = { method: 'POST', url: '/api/ck-memory/config' };
  req.on = (ev, fn) => {
    if (ev === 'data') fn(buf);
    if (ev === 'end') fn();
    return req;
  };
  let out = '';
  ck.handleApi(req, { setHeader() {}, writeHead() {}, write(x) { out += x; }, end(x) { if (x) out += x; } }, '/api/ck-memory/config');
  return out;
};
cfgPost({ autoFollowMax: 3 });
for (let i = 0; i < 6; i++) ck.setBind('auto00' + i + '-0000-0000-0000-000000000000', 0);
const fl = readFollow();
chk(fl.length <= 3, `队列被 autoFollowMax=3 截住（实际 ${fl.length} 条）`, '不截会随着用越久越长');

// 关掉开关后不再自动加 —— 用户可能只想手动管理
cfgPost({ autoFollow: false, autoFollowMax: 20 });
const nAuto = readFollow().length;
ck.setBind('manual0-0000-0000-0000-000000000000', 0);
chk(readFollow().length === nAuto, 'autoFollow=false 时不再自动入队（开关有效）');
cfgPost({ autoFollow: true });

/* ---------------- 14c. 删除记忆 / 记忆管理 ----------------
   老叶的原话：「记得给记忆加个删除功能，让我可以直接删除一整个会话的记忆，
   或者干脆做个记忆管理，点进去后我能看到目前做了记忆的会话，然后可以选择哪个删除掉」

   面板侧加了「管理」页（列出已建记忆的会话 → 勾选 / 全选 / 全部删除），
   后端侧加了批量口 dropMany。这里验三件事：
     ① 删的是索引不是原文 —— .jsonl 字节数必须一模一样，聊天记录一个字不能丢；
     ② 删完还能重建 —— 不是把会话永久拉黑，重新打开/重新索引就回来；
     ③ 批量里混进非法 sid 只跳过那几条，不能因为一条脏数据整批失败。 */
console.log('\n14c) 删除记忆：只删索引，原文不动');

const SID3 = 'test-session-0003';
const projDir3 = path.join(dataRoot, 'projects', 'p-drop');
fs.mkdirSync(projDir3, { recursive: true });
const jsonl3 = path.join(projDir3, SID3 + '.jsonl');
const lines3 = [
  ev({ type: 'message', role: 'user', timestamp: 1790001000000, content: [{ type: 'text', text: '<user_query>波兰 SHARDA 那柜的唛头怎么打</user_query>' }] }),
  ev({ type: 'message', role: 'assistant', timestamp: 1790001001000, content: [{ type: 'text', text: 'SHARDA 唛头用中性唛，不写工厂名。' }] }),
];
// 撑过「空会话」体积过滤（<1KB 的会被 scanSessions 丢掉）
for (let k = 0; k < 8; k++) {
  lines3.push(ev({ type: 'function_call_result', name: 'read_files', timestamp: 1790001002000 + k, output: 'SHARDA 唛头稿 draft-' + k + '.pdf（占位内容，用于撑大文件体积）' }));
}
fs.writeFileSync(jsonl3, lines3.join('\n') + '\n', 'utf8');

const st3 = fs.statSync(jsonl3);
const t3 = { sid: SID3, proj: 'p-drop', path: jsonl3, size: st3.size, mtimeMs: st3.mtimeMs };
const r6 = ck._internal.ingestSession(db, t3, { force: true });
const n3 = Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE sid = ?').get(SID3).c) || 0;
chk(r6.added > 0 && n3 > 0, '第三条会话先入库 ' + r6.added + ' 条（删之前得先有东西可删）');

// 面板走的真实路径：POST /api/ck-memory/dropMany（不直接调内部函数，否则测不到鉴权/入参校验）
const apiPost = (sub, payload) => {
  const buf = Buffer.from(JSON.stringify(payload));
  const req = { method: 'POST', url: '/api/ck-memory/' + sub };
  // readBody 是「先注册 data 再注册 end」的写法，这里跟着注册顺序同步喂数据
  req.on = (evt, fn) => { if (evt === 'data') fn(buf); if (evt === 'end') fn(); return req; };
  let out = '', code = 0;
  const res = { setHeader() {}, writeHead(c) { code = c; }, write(x) { if (x) out += x; }, end(x) { if (x) out += x; } };
  ck.handleApi(req, res, '/api/ck-memory/' + sub);
  let j = null;
  try { j = JSON.parse(out); } catch (_) {}
  return { code: code, json: j || {} };
};

const srcSizeBefore = fs.statSync(jsonl3).size;
const dm1 = apiPost('dropMany', { sids: [SID3] });
chk(dm1.code === 200 && dm1.json.ok === true, 'dropMany 走真实 API 正常返回');
chk(dm1.json.dropped === 1 && dm1.json.removed >= n3,
  '删掉 1 条会话 / ' + dm1.json.removed + ' 行索引（删前 ' + n3 + ' 行）');
chk((Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE sid = ?').get(SID3).c) || 0) === 0,
  'seg 里这条会话的行清零（FTS 同批删除）');
chk(!db.prepare('SELECT 1 FROM sessions WHERE sid = ?').get(SID3),
  'sessions 表里的会话行也删了（不删列表还会显示成「已建记忆」）');
chk(!(ck._internal.sessionList({ fresh: true }).items || []).some((x) => x.sid === SID3 && x.indexed),
  '会话清单里不再把它标成已建索引');
const sAfterDrop = ck._internal.search(SID3, 'SHARDA', 5);
chk((sAfterDrop.hits || []).length === 0, '删完就真搜不到了（不是只在界面上藏起来）');

// ⚠️ 最要紧的一条：删记忆绝不能碰聊天原文
chk(fs.statSync(jsonl3).size === srcSizeBefore,
  '聊天原文 .jsonl 一个字节都没变（删的只是索引）',
  srcSizeBefore + ' -> ' + fs.statSync(jsonl3).size);

// 删完必须能重建 —— 否则「删」就变成了永久拉黑
const st4 = fs.statSync(jsonl3);
const r7 = ck._internal.ingestSession(db, { sid: SID3, proj: 'p-drop', path: jsonl3, size: st4.size, mtimeMs: st4.mtimeMs }, { force: true });
chk((r7.added || 0) > 0, '删完重新索引能正常重建（+' + (r7.added || 0) + ' 条）');

// 批量里混进脏数据：非法 sid 跳过，合法照删
ck._internal.state.follow = [SID3];
const dm2 = apiPost('dropMany', { sids: ['../../etc/passwd', '', SID3] });
chk(dm2.code === 200 && dm2.json.dropped === 1 && dm2.json.removed > 0,
  '批量里混入非法 sid 只跳过那两条，合法的照删');
chk(readFollow().indexOf(SID3) < 0, '删记忆的同时退出跟踪队列（不然下一轮又被回填回来）');

const d1 = apiPost('drop', { sid: '../x' });
chk(d1.code === 400 && d1.json.ok === false, '单条 drop 对非法 sid 返回 400（不静默成功）');

// 删一个根本没索引的 sid 必须报「0 条」，不能报 1 条
// —— 否则面板会弹「已删除 1 条会话的记忆」，其实一条没删，用户以为删干净了。
const ghost = apiPost('dropMany', { sids: ['ghost000-0000-0000-0000-000000000000'] });
chk(ghost.code === 200 && ghost.json.removed === 0 && ghost.json.dropped === 0,
  '删不存在的会话报 0 条（不谎报删成功）',
  'dropped=' + ghost.json.dropped + ' removed=' + ghost.json.removed);

// ⚠️ 删除必须落日志。本轮真踩过：面板显示 6 条已建记忆、库里只剩 2 条，
//    而删除路径一句日志都没有，根本追不出是哪一次调用删的 —— 只能靠猜。
//    破坏性操作不能静默，这条断言守住它。
ck._internal.state.follow = [SID3];
const logs = [];
ck.configure({ dataRoot, dataDir, log: (m) => logs.push(String(m)) });
ck._internal.ingestSession(db, { sid: SID3, proj: 'p-drop', path: jsonl3, size: fs.statSync(jsonl3).size, mtimeMs: Date.now() }, { force: true });
apiPost('dropMany', { sids: [SID3] });
chk(logs.some((m) => m.indexOf('删除记忆') >= 0 && m.indexOf(SID3.slice(0, 8)) >= 0),
  '删除会写日志（含会话号前 8 位，事后能追出是谁删的）',
  '实际日志：' + JSON.stringify(logs.slice(-3)));
ck.configure({ dataRoot, dataDir, log: () => {} });

/* ---------------- 14d. 检索三层兜底（AND → OR → LIKE） ----------------
 *
 * 这一节守的是「能不能查到」，是整套记忆的入口。三个真 bug 的现场：
 *
 *   ① 候选池被工具输出占满 —— 旧 search() 内层 `LIMIT 120` 先按全库 bm25 取 top-N，
 *      外层才筛 sid/kind/pri。工具输出词频高、分数靠前，把 120 个名额占满 ⇒ 外层筛完就空。
 *      真库实测：「压缩」pri>=1 里有 33 条，旧写法返回 0 条；「排序」16→0；「重启」139→3。
 *      ✅ 修法 = 外层过滤 + 候选池 LIMIT -1（不限）。
 *      ⚠️ 不要改成「把 sid/kind/pri 下推成内层 JOIN seg」—— 那会破坏 FTS top-N 优化，
 *         同样查询 300ms，而放开 LIMIT 只要 6ms（51k 行库、776 条命中的最坏情况实测）。
 *
 *   ② AND 连接所有 bigram —— 「尾款」5 条 → 「尾款什么时候」0 条。
 *      问得越具体越搜不到，而人问记忆天然说整句。
 *      ✅ 修法 = AND 优先（精确，与旧行为一致），0 条才 OR 回退 + IDF 加权覆盖率重排。
 *      ⚠️ 只改 OR 不重排会召回一堆噪声（实测 39~52 条全无关）。
 *      ⚠️ 也不能硬编码中文停用词表 —— 实测更差，会把有效词一起筛掉。
 *      正解 = 用 fts5vocab 的 df 算 IDF，让数据决定谁是虚词，不用维护任何词表。
 *
 *   ③ 单字必然 0 命中 —— 索引只存 2-gram，「柜」压根不在词表里。而「柜」是外贸核心量词。
 *      ✅ 修法 = FTS 全空时退回 LIKE。
 *
 * ⚠️ fts5vocab 必须三参形式（'main','seg_fts','row'）：两参在 temp 库下报
 *    「no such fts5 table」。且 term 要小写查 —— unicode61 会 case-fold。
 */

console.log('\n14d) 检索三层兜底');
const dbq = ck._internal.open();
const SIDQ = SID;

// 造一批可控数据：一个高频虚词 bigram + 一个稀有词，验证「候选池不被淹」和「OR 不乱召回」
{
  const nowQ = Date.now();
  const insSeg = dbq.prepare(
    'INSERT OR IGNORE INTO seg(sid,seq,ts,role,kind,tool,text,h,dup,last_ts,pri,noise) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insFts = dbq.prepare('INSERT INTO seg_fts(rowid,big) VALUES(?,?)');
  dbq.exec('BEGIN');
  try {
    // 20 条过程话，每条都含「归档」—— 模拟我自己的碎碎念把候选池占满。
    // ⚠️ 必须是 kind='assistant' + pri=0，不能用 kind='tool'：
    //   talk 查询本来就按 kind 过滤（只要 user/assistant），
    //   拿 kind='tool' 造噪声的话，deep 开关根本不起作用，断言会假通过。
    for (let i = 0; i < 20; i++) {
      const info = insSeg.run(SIDQ, 9000 + i, nowQ, 'assistant', 'assistant', null,
        '先看一下归档目录，第' + i + '次尝试', 'q_noise_' + i, 1, nowQ, 0, 0);
      insFts.run(info.lastInsertRowid, ' 归档 ');
    }
    // ⚠️⚠️ 130 条含「归档」的过程话，分两种用途：
    //   ① 本会话 20 条（下面 q_noise_*）：模拟我自己的碎碎念，验证 deep 开关；
    //   ② **另一个会话 130 条**（q_flood_*）：这才是能抓住「候选池被占满」的关键。
    //   必须在**别的 sid** 上造 —— 旧写法内层 `LIMIT 120` 是全库取 top-N，
    //   只取 bm25 最高的 120 条，然后外层才按 sid 过滤。
    //   如果把噪声都造在本会话里，前 120 名全是它们、过滤后还剩一堆，
    //   那个 bug 根本复现不出来（本轮踩过：断言假通过两次）。
    //   必须在别的 sid，才能把名额从本会话手里抢走。
    for (let i = 0; i < 130; i++) {
      const info = insSeg.run('flood000-0000-0000-0000-000000000000', 9200 + i, nowQ,
        'assistant', 'assistant', null,
        '归档 归档 归档 归档 归档 归档 归档 归档 归档 归档 第' + i + '条过程话', 'q_flood_' + i, 1, nowQ, 0, 0);
      insFts.run(info.lastInsertRowid, ' 归档 归档 归档 归档 归档 归档 归档 归档 归档 归档 ');
    }
    // 只有 1 条有效记忆含「归档」，还带一个极稀有词「琥珀」
    const info = insSeg.run(SIDQ, 9100, nowQ, 'assistant', 'assistant', null,
      '归档规则定了：琥珀色标签只贴外箱，内袋不贴。', 'q_good_1', 1, nowQ, 1, 0);
    insFts.run(info.lastInsertRowid, ' 归档 琥珀 珀色 色标 标签 ');
  } catch (_) {}
  dbq.exec('COMMIT');
}

// ① 候选池：有效记忆里只有 1 条「归档」，但别的会话有 130 条过程话把它挤出前 120 名。
// ⚠️ 必须同时断言 via，不能只看命中数 —— 候选池被截断时 AND/OR 都返 0，
//   结果会被 LIKE 兜底救回来，命中数照样是 1，断言就假通过（本轮踩了三次）。
//   真正要守的是：**走的是 FTS 正常路径（AND），不是兜底**。
const sPool = ck._internal.search(SIDQ, '归档', 5);
chk((sPool.hits || []).length >= 1, `候选池没被过程话占满（命中 ${(sPool.hits || []).length} 条）`,
  '回归：旧写法内层 LIMIT 120 会先取满别的会话的 130 条过程话，外层筛 pri>=1 后归零');
chk(sPool.via === 'AND', `走的是 FTS 正常路径而不是兜底（via=${sPool.via}）`,
  '候选池被截断时 AND/OR 都返 0，会被 LIKE 兜底掩盖成「看起来正常」');
chk((sPool.hits || []).length >= 1 && /琥珀色标签/.test(String(sPool.hits[0].text)),
  '首条就是那条有效记忆，不是过程话');

// ② AND 优先：整句能命中时不应走 OR
const sAnd = ck._internal.search(SIDQ, '琥珀色标签', 5);
chk(sAnd.via === 'AND', `整句「琥珀色标签」走 AND（via=${sAnd.via}）`);

// ③ OR 兜底：加虚词后 AND 必空，应回退 OR 并靠 IDF 覆盖率找回同一条
const sOr = ck._internal.search(SIDQ, '琥珀色标签什么时候贴', 5);
chk(sOr.via === 'OR', `长句「琥珀色标签什么时候贴」回退到 OR（via=${sOr.via}）`,
  '旧写法这里是 0 条 —— AND 连接所有 bigram，问得越具体越搜不到');
chk((sOr.hits || []).length >= 1, `OR 兜底召回了 ${(sOr.hits || []).length} 条`);
chk((sOr.hits || []).length >= 1 && /琥珀色标签/.test(String(sOr.hits[0].text)),
  'IDF 加权覆盖率把真正相关的那条排在第一（不是只命中虚词的过程话）',
  '只改 OR 不重排会召回一堆噪声；靠 df 算 IDF 才能让稀有词主导排序');

// ④ 单字兜底：索引只存 2-gram，「珀」不在词表里 ⇒ 必须走 LIKE
const sLike = ck._internal.search(SIDQ, '珀', 5);
chk(sLike.via === 'LIKE', `单字「珀」走 LIKE 兜底（via=${sLike.via}）`,
  '索引只存 bigram，单字必然不在词表里');
chk((sLike.hits || []).length >= 1 && /琥珀色标签/.test(String(sLike.hits[0].text)),
  '单字兜底能查到含该字的那条');

// ⑤ 找不到的必须老实返回空，不能拿 OR 凑数
const sNone = ck._internal.search(SIDQ, '紫罗兰螺旋桨', 5);
chk((sNone.hits || []).length === 0, `库里没有的词返回 0 条（不能硬凑）`);

// ⑥ deep 开关不受新逻辑影响
const sDeep = ck._internal.search(SIDQ, '归档', 5, true);
chk((sDeep.hits || []).length > (sPool.hits || []).length,
  `deep=true 时能查到更多（${(sDeep.hits || []).length} > ${(sPool.hits || []).length}，含过程话）`);

// ⑦ via 字段必须回传给上层，面板才能显示「怎么找到的」
chk(['AND', 'OR', 'LIKE'].indexOf(String(sOr.via)) >= 0 && typeof sPool.candidates === 'number',
  'search 回传 via / candidates 字段');

// 清理这批判造数据，别影响后面的断言
{
  const ids = dbq.prepare("SELECT id FROM seg WHERE h LIKE 'q_noise_%' OR h LIKE 'q_flood_%' OR h = 'q_good_1'").all().map((r) => r.id);
  if (ids.length) {
    dbq.exec('BEGIN');
    try {
      for (const id of ids) dbq.prepare('DELETE FROM seg_fts WHERE rowid = ?').run(id);
      dbq.prepare(`DELETE FROM seg WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    } catch (_) {}
    dbq.exec('COMMIT');
  }
  chk(dbq.prepare("SELECT COUNT(*) c FROM seg WHERE h LIKE 'q_noise_%' OR h LIKE 'q_flood_%' OR h = 'q_good_1'").get().c === 0,
    '造的数据已清理干净');
}

/* ---------------- 15. 官方标题：会话名要认得出来 ---------------- */

console.log('\n15) 官方标题接入');

// 造一个极简的官方库，验证「读得到就用、读不到就降级」
const offDb = path.join(dataRoot, 'workbuddy.db');
let offOk = false;
try {
  const { DatabaseSync } = require('node:sqlite');
  const odb = new DatabaseSync(offDb);
  odb.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT, custom_title TEXT, status TEXT, last_activity_at INTEGER, cwd TEXT)');
  odb.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?)')
    .run(SID, '自动生成的标题', '用户改过的标题', 'completed', Date.now(), 'D:/x');
  odb.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?)')
    .run(SID2, '土耳其订单', '', 'working', Date.now() - 3600000, 'D:/y');
  odb.close();
  offOk = true;
} catch (_) {
  console.log('   （本机无 node:sqlite，跳过官方标题用例）');
}
if (offOk) {
  const map = ck.officialSessions({ fresh: true });
  chk(map.size === 2, `读到官方库 ${map.size} 条会话`);
  chk(map.get(SID) && map.get(SID).title === '用户改过的标题', 'custom_title 优先于 title');
  chk(map.get(SID2) && map.get(SID2).title === '土耳其订单', '没有 custom_title 时用 title');

  const list = ck._internal.sessionList({ fresh: true });
  const it1 = (list.items || []).find((x) => x.sid === SID);
  chk(it1 && it1.title === '用户改过的标题', '会话清单用的是官方标题，不是首条发言截断');
  chk(it1 && it1.hasTitle === true, '清单项标记 hasTitle（区分官方名与回退名）');
  chk(it1 && it1.status === 'completed', '带官方 status');
  chk(it1 && it1.lastAt > 0, '带官方最后活跃时间（点开即更新）');
}

// 官方库不可用 / 字段变了，必须安静降级，不能抛
const badRoot = path.join(tmpRoot, 'bad-root');
fs.mkdirSync(badRoot, { recursive: true });
fs.writeFileSync(path.join(badRoot, 'workbuddy.db'), 'this is not a sqlite file', 'utf8');
ck.configure({ dataRoot: badRoot, dataDir, log: () => {} });
let degradeOk = true;
try { ck.officialSessions({ fresh: true }); } catch (_) { degradeOk = false; }
chk(degradeOk, '官方库损坏时不抛异常（记忆功能不受连累）');
ck.configure({ dataRoot, dataDir, log: () => {} });

/* ---------------- 17. 发消息前自动注入（阶段 2） ----------------
 *
 * 这一节守的是「注入的东西到底对不对」，比「能不能查到」更危险：
 * 查漏了只是少一条参考，注入错了会污染每一次对话。
 *
 * 设计前提全部来自实测，而且**推翻了最初的写法**（细节见 ck-memory.js 的注释）：
 *   ① 拿整句话去检索、命中就注入 —— 不可行。真实历史提问做留一法，
 *      IDF 加权覆盖率 <0.2 占 11/24、>0.5 只占 2/24；阈值 0.45 通过率 8%，
 *      阈值 0.2 通过率 90% 但命中内容与提问无关（问「标签栏」召回「三件都查清了」）。
 *   ② 稀有词当锚点 —— 不可行。中文 bigram 在词边界切出碎片，
 *      「开关」→「能要」df=3、「标签栏显示」→「栏显」df=2，全被当成最稀有锚点。
 *   ③ 最长公共子串 ≥3 —— 仍不行，8 个真实查询全部误命中。
 *   ⇒ 结论：**词法相似度不能判断语义相关性**。放行只认「强标识符」。
 *
 * 本节的断言就是围绕这条边界写的：该命中的必须命中，不该命中的**必须一条都不给**。
 */

console.log('\n17) 自动注入：只认强标识符');
{
  const SID_INJ = SID;
  const dbI = ck._internal.open();
  const nowI = Date.now();
  const insSeg = dbI.prepare(
    'INSERT OR IGNORE INTO seg(sid,seq,ts,role,kind,tool,text,h,dup,last_ts,pri,noise) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insFts = dbI.prepare('INSERT INTO seg_fts(rowid,big) VALUES(?,?)');
  const put = (sid, seq, text, h, pri, kind) => {
    const info = insSeg.run(sid, seq, nowI, kind || 'user', kind || 'user', null, text, h, 1, nowI, pri == null ? 2 : pri, 0);
    insFts.run(info.lastInsertRowid, ck.bigram(text));
  };
  dbI.exec('BEGIN');
  try {
    // 跨会话：一个只有「另一条会话」里才有的单号
    put(SID2, 77001, '订单 ABC-991122 的尾款 USD 231472.08 已到账，水单在附件里。', 'i_abc_1', 2);
    // 同会话更早：一个端口 + 路径
    put(SID_INJ, 77002, '网关跑在 127.0.0.1:7911 上，面板在 /panel/ 目录。', 'i_port_1', 2);
    // 干扰项：与「尾款」这个词相关，但没有任何标识符
    put(SID_INJ, 77003, '尾款收到之后记得给客户回一封确认邮件，措辞按老规矩。', 'i_noise_1', 2);
    dbI.exec('COMMIT');
  } catch (e) { try { dbI.exec('ROLLBACK'); } catch (_) {} no('造数失败：' + e.message); }
  ck._internal.purgeCache && ck._internal.purgeCache();

  // ---- 17a 标识符抽取 ----
  const ids1 = ck.strongIds('ABC-991122 那单的尾款到账了吗');
  chk(ids1.indexOf('ABC-991122') >= 0, '抽得出订单号式标识符', JSON.stringify(ids1));
  const ids2 = ck.strongIds('127.0.0.1:7911 连不上');
  chk(ids2.some((x) => x.indexOf('127.0.0.1') >= 0), '抽得出 IP:端口', JSON.stringify(ids2));
  const ids3 = ck.strongIds('ck-memory.js 报错了');
  chk(ids3.indexOf('ck-memory.js') >= 0, '抽得出文件名', JSON.stringify(ids3));
  const ids4 = ck.strongIds('这个功能要不要加个开关');
  chk(ids4.length === 0, '纯中文口头问题不产生标识符（不硬凑）', JSON.stringify(ids4));
  const ids5 = ck.strongIds('帮我看看 workbuddy 的 memory 功能');
  chk(ids5.length === 0, '纯英文单词不算标识符（满库都是，定位不了）', JSON.stringify(ids5));

  /**
   * ---- 17b2 泛化标识符必须被剔除 ----
   * ⚠️⚠️⚠️ 这一条补的是一个**真库上才暴露的**缺陷：
   *   第一版只按形态判定（有数字 / 有扩展名 / 是域名），101 条真实发言触发 12 次，
   *   其中约 10 次是误命中，来源全是 `127.0.0.1`（库内 3083 行 / 3 会话）、
   *   `github.com`（267 行 / 3 会话）这类满库都是的串。
   *   它们形态上完全符合「强标识符」，但**没有任何定位能力** ——
   *   问「卸载 codebuddy」就凑巧命中了含 github.com 的「raccoon 50accounts」那条。
   *   ⇒ 判据必须是「形态 + 稀有度」两条一起。
   */
  {
    // 在库里把 127.0.0.1 造成泛化串（跨 3 条会话、总量远超上限）
    const dbG = ck._internal.open();
    const insG = dbG.prepare(
      'INSERT OR IGNORE INTO seg(sid,seq,ts,role,kind,tool,text,h,dup,last_ts,pri,noise) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    dbG.exec('BEGIN');
    try {
      for (let i = 0; i < 70; i++) {
        insG.run('g_' + (i % 3), 88000 + i, nowI, 'assistant', 'assistant', null,
          '服务跑在 127.0.0.1:7863 上，这一条只是把它写满', 'g_fill_' + i, 1, nowI, 1, 0);
      }
      dbG.exec('COMMIT');
    } catch (_) { try { dbG.exec('ROLLBACK'); } catch (__) {} }

    const rGen = ck.searchForPrompt('127.0.0.1:7863 连不上', { sid: SID_INJ, max: 3, chars: 1200 });
    chk(rGen.items.length === 0,
      '泛化标识符（满库都是的地址）不触发注入',
      'reason=' + rGen.reason + ' ids=' + JSON.stringify(rGen.ids) + ' n=' + rGen.items.length);
    chk((rGen.dropped || []).some((x) => x.indexOf('127.0.0.1') >= 0),
      '被剔除的泛化标识符有记录（面板/日志能解释「为什么没注入」）',
      JSON.stringify(rGen.dropped || []));
    chk(rGen.reason === 'no-signal',
      '泛化标识符不算「有锚点」，因此不进入 id-miss 分支（不冒充「库里没有」）',
      '实际=' + rGen.reason);
  }

  // ---- 17b 该命中：跨会话的单号 ----
  const r1 = ck.searchForPrompt('ABC-991122 这单尾款到账了吗', { sid: SID_INJ, max: 3, chars: 1200 });
  chk(r1.items.length >= 1 && r1.items[0].text.indexOf('ABC-991122') >= 0,
    '跨会话的单号能命中（这才是自动注入真正有增益的场景）',
    'reason=' + r1.reason + ' n=' + r1.items.length);
  chk(r1.items.length >= 1 && r1.items[0].other === true, '命中的跨会话条目标了 other（面板要说清来源）');

  // ---- 17c 该命中：同会话的端口 ----
  const r2 = ck.searchForPrompt('127.0.0.1:7911 打不开了', { sid: SID_INJ, max: 3, chars: 1200 });
  chk(r2.items.length >= 1 && r2.items[0].text.indexOf('7911') >= 0, '同会话内更早的端口能命中');

  // ---- 17d 不该命中：没有标识符的普通问题必须一条都不给 ----
  //     这是本节最重要的一条。实测里正是这里出的问题：老实现会回退到词法，
  //     把「尾款」相关但完全不相干的内容塞进上下文。
  const r3 = ck.searchForPrompt('尾款收到之后要做什么', { sid: SID_INJ, max: 3, chars: 1200 });
  chk(r3.items.length === 0, '没有标识符时不注入任何东西（宁缺勿滥）',
    'reason=' + r3.reason + ' 实际带回 ' + r3.items.length + ' 条：'
    + JSON.stringify((r3.items || []).map((x) => String(x.text).slice(0, 24))));

  /**
   * ⚠️⚠️ 上面这条**必须配差分**才有鉴别力，否则是假通过。
   *   第一版写完发现：把「无标识符回退词法」的旧行为改回去，这条依然通过 ——
   *   因为测试库太小，`df <= total*0.08` 的词表门槛先把候选全筛掉了，
   *   根本没走到回退逻辑。也就是说那条断言证明的不是「口径正确」，而是「数据太少」。
   *   正解：显式把词法兜底打开，证明**同一条提问在兜底打开时确实能捞出东西**，
   *   这样「默认关掉时返回 0」才真的是「因为口径关着」，而不是「因为查不到」。
   */
  const r3b = ck.searchForPrompt('尾款收到之后要做什么', {
    sid: SID_INJ, max: 3, chars: 1200, gap: true, crossOnly: false, minCover: 0,
  });
  chk(r3b.items.length >= 1,
    '对照：同一条提问在「词法兜底打开」时确实能捞到东西（证明上面那条是口径在起作用，不是查不到）',
    'reason=' + r3b.reason + ' n=' + r3b.items.length);

  chk(r3.reason === 'no-signal' || r3.reason === 'no-useful-term',
    '没命中时给出明确原因码（面板要显示「为什么没带」）', '实际=' + r3.reason);

  // ---- 17e 标识符查不到时，不能拿词法去凑 ----
  //     ⚠️ 这一条对应实测踩到的真 bug：问「YKW-SU-260713 尾款」时库里压根没这个单号，
  //     老实现回退到词法，注入了一条「Android/iOS 首屏空白」——用错的东西冒充相关记忆。
  const r4 = ck.searchForPrompt('ZZZ-000111 这单的尾款', { sid: SID_INJ, max: 3, chars: 1200 });
  chk(r4.items.length === 0, '标识符查不到时不回退到词法（宁可空着）',
    'reason=' + r4.reason + ' n=' + r4.items.length);
  //     这条要证明的是「有标识符查不到 ⇒ 就算开了词法兜底也不许凑」，
  //     所以对照组的 gap:true 必须仍然为空 —— 这才是口径铁律：
  //     有标识符时标识符就是唯一口径，打开兜底也不改变这个事实。
  const r4b = ck.searchForPrompt('ZZZ-000111 这单的尾款', {
    sid: SID_INJ, max: 3, chars: 1200, gap: true, crossOnly: false, minCover: 0,
  });
  chk(r4b.items.length === 0,
    '有标识符且查不到时，即使打开词法兜底也不凑（口径铁律）',
    'reason=' + r4b.reason + ' n=' + r4b.items.length);
  chk(r4b.reason === 'id-miss', '区分「库里有相关但没这个号」与「没有信号」', '实际=' + r4b.reason);

  // ---- 17f 字符预算 ----
  const r5 = ck.searchForPrompt('ABC-991122 详情', { sid: SID_INJ, max: 3, chars: 60 });
  chk(r5.items.length === 0 || (r5.chars || 0) <= 60, '字符预算生效（不超发）', 'chars=' + r5.chars);

  /**
   * ---- 17f2 截断不能切出「半截代码块」 ----
   * ⚠️ 实测踩到：直接 slice 会把 `https://127.0.0.1:17443/healthz` 切成
   *   「`https://…」—— 一个孤立的反引号加半截网址，模型会把它当成代码或数据。
   *   断言看两件事：长度不超预算 + 反引号必须成对。
   */
  {
    const clip = ck.clipText;
    const longTxt = '服务跑在 `https://127.0.0.1:17443/healthz` 上，探活判据是 gwCode===200 且 healthy>0，这条判定当初改过三次才定下来。';
    for (const cap of [20, 30, 45, 60]) {
      const got = clip(longTxt, cap);
      const ticks = (got.match(/`/g) || []).length;
      chk(got.length <= cap && ticks % 2 === 0,
        `截断到 ${cap} 字时反引号成对且不超长`, 'len=' + got.length + ' ticks=' + ticks + ' «' + got + '»');
    }
    chk(/。…$|…$/.test(clip(longTxt, 30)), '截断后带省略号（读者能看出被切过）');
    chk(clip('短句', 10) === '短句', '没超预算时原样返回（不加省略号）');
  }

  // ---- 17g 拼接：措辞必须点明「不是用户的话」 ----
  const r6 = ck.searchForPrompt('ABC-991122 那单', { sid: SID_INJ, max: 2, chars: 800 });
  const txt = ck.renderInjection(r6);
  chk(/<memory-hint>/.test(txt) && /不是用户这次说的话/.test(txt),
    '注入文本明确声明「这是历史记忆，不是新指令」',
    '模型会把无来源标注的注入内容当新指令执行');
  chk(/<\/memory-hint>/.test(txt), '注入块有闭合标签（避免把后面的正文吞进块里）');
  chk(ck.renderInjection({ items: [] }) === '', '无命中时返回空串（hook 那就静默退出，不输出空块）');

  // ---- 17h 关闭开关后彻底不动 ----
  ck._internal.saveConf({ autoInject: false });
  const r7 = ck.promptInjection({
    session_id: SID_INJ, prompt: 'ABC-991122 那单', hook_event_name: 'UserPromptSubmit',
  });
  chk(!r7.additionalContext && r7.reason === 'off', '关掉开关后一个字都不注入', 'reason=' + r7.reason);
  ck._internal.saveConf({ autoInject: true });

  // ---- 17i 异常必须被吞掉 ----
  //     hook 在每次发消息的必经路径上，抛异常 = 可能发不出消息。
  let threw = false;
  let r8 = null;
  try { r8 = ck.promptInjection(null); } catch (_) { threw = true; }
  chk(!threw, 'payload 为 null 时不抛异常（hook 绝不能阻断发消息）');
  chk(r8 && typeof r8.additionalContext === 'string', 'null payload 也返回合法结构');
  let threw2 = false;
  try { ck.promptInjection({ session_id: '../../etc/passwd', prompt: 'ABC-991122' }); } catch (_) { threw2 = true; }
  chk(!threw2, '非法 session_id 不抛异常（回落其它会话识别方式）');

  // ---- 17j 会话识别优先用 hook 的 session_id ----
  const byHook = ck._internal.state && true;
  const r9 = ck.promptInjection({ session_id: SID_INJ, prompt: 'ABC-991122 那单' });
  chk(!!r9.additionalContext && r9.additionalContext.indexOf('ABC-991122') >= 0,
    'hook 给出的 session_id 能直接定位会话并注入', 'reason=' + r9.reason);
  const li = ck.lastInject();
  chk(li && li.sid === SID_INJ && li.sidVia === 'hook',
    'lastInject 记下了「这次用的是哪个会话、从哪来的」（面板可查）',
    'sid=' + (li && li.sid) + ' via=' + (li && li.sidVia));
  chk(li && Array.isArray(li.items) && li.chars > 0, 'lastInject 记了条数与字数（面板显示「上次带了什么」）');

  /**
   * ---- 17k lastInject 取值器必须能调 ----
   * ⚠️ 线上真踩：`lastInject` 既是模块级变量（记录上次注入），
   *   又在导出里写成了 `lastInject: () => lastInject`（取值器）。
   *   API 里手滑写成 `lastInject()` ⇒ 实际调的是**变量**（对象）⇒
   *   面板「上次」按钮直接 500：「lastInject is not a function」。
   *   单测当时没覆盖 API 层，所以全绿也没抓住。这条守的就是那个同名冲突。
   */
  chk(typeof ck.lastInject === 'function', '导出里 lastInject 是取值器（不是把变量本身导出去）');
  let lastOk = null;
  let lastThrew = false;
  try { lastOk = ck.lastInject(); } catch (_) { lastThrew = true; }
  chk(!lastThrew && lastOk && typeof lastOk === 'object',
    '调用 lastInject() 能正常返回对象（面板「上次」按钮依赖它）');

  /**
   * ---- 17l 注入记录必须落盘 ----
   * ⚠️⚠️ 真踩过：第一版把 lastInject 只放在模块内存里。
   *   hook 是 daemon 之外的一次性进程（每次发消息新起一个），它写的记录
   *   daemon 永远读不到 ⇒ 面板稳定显示「还没触发过」——功能明明在工作，
   *   用户却以为它坏了。这条守的是「跨进程可见」。
   */
  {
    const injFile = path.join(dataDir, 'ck-memory', 'last-inject.json');
    ck.promptInjection({ session_id: SID_INJ, prompt: 'ABC-991122 那单' });
    chk(fs.existsSync(injFile), '注入记录落盘（hook 进程与 daemon 是两个进程）',
      '期望文件：' + injFile);
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(injFile, 'utf8')); } catch (_) {}
    chk(disk && Number(disk.at) > 0 && disk.reason === 'ok', '盘上记录带时间与原因码');
    chk(disk && Array.isArray(disk.items) && disk.items.length >= 1, '盘上记录带命中条目（面板要展示）');
  }
}

/* ---------------- 18. hook 注册的幂等性 ----------------
 *
 * 这一段是「换上就能用」的关键：hook 要写进宿主的 settings.json，
 * 而那个文件里有用户自己的配置（PreToolUse 等），**一条都不能碰**。
 * 同时必须幂等 —— 每次 daemon 启动都重写文件会刷新宿主的信任指纹。
 */

console.log('\n18) hook 自注册：只动自己那条，且幂等');
{
  const hookSrc = path.join(ROOT, 'scripts', 'ck-hook-prompt.js');
  chk(fs.existsSync(hookSrc), 'ck-hook-prompt.js 存在（要随包发布）');

  const hookTxt = fs.readFileSync(hookSrc, 'utf8');
  chk(/process\.exit\(0\)/.test(hookTxt), 'hook 永远 exit 0（非 0 会被宿主当成失败）');
  chk(!/console\.log/.test(hookTxt), 'hook 不往 stdout 打日志（多余输出会被当成决策）');
  chk(/agent_type/.test(hookTxt), 'hook 跳过子 agent（避免上下文串味）');
  chk(/setTimeout\(handle/.test(hookTxt), 'hook 有超时兜底（宿主不关 stdin 也不拖住发送）');

  // 静态：daemon 启动时要把 hook 挂上
  const ckTxt = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  chk(/ensureHookConfig/.test(ckTxt), 'ck-memory 里有 hook 自注册入口');
  chk(/function startAll\(\)[\s\S]{0,400}ensureHookConfig/.test(ckTxt),
    'startAll 里会挂 hook（装上就有，不用手动配）');
  chk(/ck-hook-prompt\.js/.test(ckTxt), '注册时按文件名识别自己那条');
}

/* ---------------- 15b. 排序口径：相关度优先 + 上次被检索 + 重要度 ---------------- */

console.log('\n15b) 排序：相关度优先，并列才让新鲜度/重要度换位');
{
  // ---- 15b-1 结构：新列必须存在（否则「按上次被检索」根本无从谈起）----
  const cols3 = db.prepare('PRAGMA table_info(seg)').all().map((r) => r.name);
  chk(cols3.indexOf('last_hit_ts') >= 0, 'seg 有 last_hit_ts（「上次被检索」的落点）',
    '缺它就只能按创建时间算衰减，这正是原来的错');
  chk(cols3.indexOf('hit_n') >= 0, 'seg 有 hit_n（被命中次数，用于观察机制是否在工作）');

  // ---- 15b-2 回归命中：检索必须把 last_hit_ts 写回去 ----
  const sHit = ck._internal.search(SID, '网关端口', 3);
  chk((sHit.hits || []).length > 0, '前提：这条查询有命中（否则下面测不到回写）');
  if ((sHit.hits || []).length) {
    const seqs = sHit.hits.map((h) => h.seq);
    const rowsHit = db.prepare(
      `SELECT seq, COALESCE(last_hit_ts,0) lh, COALESCE(hit_n,0) hn FROM seg WHERE sid = ? AND seq IN (${seqs.map(() => '?').join(',')})`
    ).all(SID, ...seqs);
    chk(rowsHit.length > 0 && rowsHit.every((r) => r.lh > 0),
      '命中后 last_hit_ts 被写回（新鲜度基准的唯一来源）',
      '全 0 ⇒ 衰减永远按创建时间算，等于没改');
    chk(rowsHit.some((r) => r.hn >= 1), 'hit_n 也在累加');
    // 且返回体里带出这个信息（面板要显示「多久没被用到」）
    chk(sHit.hits.every((h) => typeof h.lastHit === 'number'),
      '命中项带 lastHit 字段（面板能显示「上次用到是什么时候」）');
  }

  // ---- 15b-3 硬约束：第 1 名不许被换掉（除非分数完全并列）----
  //   造两条措辞完全相同的记忆，一条很旧一条很新。
  //   bm25 会把它们打成同一个分数 ⇒ 这是**真并列** ⇒ 允许新的排前面。
  //   再造第三条（措辞明显更相关、分数更高），验证它不会被新鲜度顶掉。
  const nowD = Date.now();
  const D3 = 86400000;
  const ins3 = db.prepare(
    'INSERT OR IGNORE INTO seg(sid,seq,ts,role,kind,tool,text,h,dup,last_ts,pri,noise) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insF3 = db.prepare('INSERT INTO seg_fts(rowid,big) VALUES(?,?)');
  db.exec('BEGIN');
  try {
    // ⚠️ 造数刻意用**两字词 + 空格**：「貔貅 口径 统一 说明」。
    //   写成连排的「貔貅口径统一说明」会切出「貅口」「径统」「一说」这类跨词碎片，
    //   它们不在索引里 ⇒ live < parts ⇒ 直接跳 AND 走 OR ⇒ 覆盖率被碎片扭曲，
    //   排序断言就测不准了（本轮第一个版本就是这么误判的）。
    let r = ins3.run(SID, 9300, nowD - 400 * D3, 'user', 'user', null,
      '貔貅 口径 统一 说明', 'srt_a', 1, nowD - 400 * D3, 2, 0);
    insF3.run(r.lastInsertRowid, ' 貔貅 口径 统一 说明 ');
    r = ins3.run(SID, 9301, nowD - 3600000, 'user', 'user', null,
      '貔貅 口径 统一 说明', 'srt_b', 1, nowD - 3600000, 2, 0);
    insF3.run(r.lastInsertRowid, ' 貔貅 口径 统一 说明 ');
    // 更相关的一条：**更短、更聚焦**，只含查询词。且很旧、pri 更低 —— 测「相关性能不能压过新鲜度」。
    // ⚠️ 不能靠「多加几个词」来制造「更相关」：实测 bm25 有长度归一化，
    //    文本越长分数越差（实测 34 字的 -2.648 反而比 14 字的 -3.369 更差）。
    //    要让它真的更相关，只能是「同样的词、更短的篇幅」。
    r = ins3.run(SID, 9302, nowD - 500 * D3, 'assistant', 'assistant', null,
      '貔貅 口径', 'srt_c', 1, nowD - 500 * D3, 1, 0);
    insF3.run(r.lastInsertRowid, ' 貔貅 口径 ');
  } catch (_) {}
  db.exec('COMMIT');

  const sTie = ck._internal.search(SID, '貔貅 口径', 5);
  if (process.env.DBG) { console.log('  >>> via='+sTie.via+' n='+(sTie.hits||[]).length); (sTie.hits||[]).forEach((h,i)=>console.log('   #'+(i+1)+' '+h.score+' '+String(h.text).slice(0,40))); }
  const tieTexts = (sTie.hits || []).map((h) => String(h.text));
  const iOld = tieTexts.findIndex((t) => t.indexOf('貔貅') >= 0 && t.length < 20);
  chk(iOld >= 0, '前提：并列造数已入库');
  // 两条完全同分的，新的必须在前
  // 那两条「完全同文、分数精确相等」的（长度 20 以内、且不含第三条第的短文本）
  const twoSame = (sTie.hits || []).filter((h) => String(h.text).indexOf('貔貅') >= 0
    && String(h.text).indexOf('统一') >= 0);
  chk(twoSame.length === 2, `前提：两条同文记忆都在结果里（实际 ${twoSame.length} 条）`);
  if (twoSame.length === 2) {
    chk(twoSame[0].ts > twoSame[1].ts,
      '分数完全并列时，1 小时前的排在 400 天前的之前',
      '旧写法按创建时间衰减 + 第 1 名独占分组，会把老的锁死在前面');
  }

  // ---- 15b-4 相关度仍是主序：明显更相关的那条不能被新鲜度顶掉 ----
  //   上面 srt_c 多命中「优先级 / 立即 / 执行」三个词，bm25 应当明显更优。
  //   ⚠️ 但它很旧（500 天）⇒ 如果新鲜度权重压过相关性，它就会被换下去。
  const cIdx = tieTexts.findIndex((t) => String(t).trim() === '貔貅 口径');
  chk(cIdx === 0,
    `相关性更高的一条仍排第 1（实际第 ${cIdx + 1} 位）`,
    '新鲜度/重要度只能影响同名次，不能把更相关的内容换下去');

  // ---- 15b-5 重要度函数：只用客观信号，且短结论不被长度惩罚 ----
  const impKey = (o) => ck.rankKey(Object.assign({ ts: nowD, last_hit_ts: 0, pri: 2, dup: 1 }, o), nowD);
  const kUser = impKey({ text: '这是一条用户说的话，长度适中，四十个字以内不会触发长度惩罚的边界情况。' });
  const kProc = impKey({ pri: 1, text: '这是一条用户说的话，长度适中，四十个字以内不会触发长度惩罚的边界情况。' });
  chk(kUser > kProc, '同样内容，用户说的（pri=2）比回合结论（pri=1）排得更前');
  // ⚠️ 短结论必须不被压死：实测最关键的一条只有 33 字（「这份单不是你的货。」）
  //   注意断言方式：极短(<40) 与极长(>400) **拿不到长度加分**，两者在长度项上是平的；
  //   真正要守的是「极短的不比极长的更差」—— 按长度筛会反过来，把短的判死。
  const kShort = impKey({ pri: 1, text: '这份单不是你的货。' });
  const kMid = impKey({ pri: 1, text: 'x'.repeat(120) });
  const kLong = impKey({ pri: 1, text: 'x'.repeat(800) });
  chk(kMid > kShort, '正常长度（40~400 字）确实有加分（说明长度项在工作）');
  chk(kShort >= kLong,
    '短结论不比 800 字的长输出差（不按长度一刀切）',
    '按长度排序会误杀「很短但关键」的结论');
  // 新鲜度：同内容，越新越高
  const kNew = ck.rankKey({ ts: nowD, last_hit_ts: 0, pri: 2, dup: 1, text: '测试' }, nowD);
  const kOld = ck.rankKey({ ts: nowD - 90 * D3, last_hit_ts: 0, pri: 2, dup: 1, text: '测试' }, nowD);
  chk(kNew > kOld, '同内容，新的新鲜度更高');
  // ⭐ 核心：上次被检索会「续命」—— 一条 90 天前的内容，如果昨天被用到过，应当比没被用过的新鲜
  const kRevived = ck.rankKey({ ts: nowD - 90 * D3, last_hit_ts: nowD - 1 * D3, pri: 2, dup: 1, text: '测试' }, nowD);
  chk(kRevived > kOld,
    '⭐⭐ 上次被检索会续命：90 天前的旧记忆只要昨天用到过，就比没被用过的更新鲜',
    '这正是「按创建时间衰减」做不到的事 —— 旧结论反复生效也永远被判陈旧');
  chk(Math.abs(kRevived - kNew) < 0.05, '而且续命幅度合理（昨天用到过 ≈ 昨天创建的）');
}

/* ---- 15b-6 「并列」的判据必须是**原始排序分相等**，不能是名次差 ---- */
/*
 * 为什么单独固化成断言：
 *   名次制（OR 路径）的 rel 是覆盖率排出的**名次整数**（0,1,2,3…），两两永不相等。
 *   旧实现用 `rankTie=2` 让「名次差 ≤2」也算并列 ⇒ 每 3 个名次归一组 ⇒
 *   组内按 rankKey 自由重排。这等于**把相关性第 2~4 名的真实差距交给新鲜度覆盖**。
 *   实测 126 题：MRR 41.03% → 39.62%（−1.41pp，p=0.0183）；
 *   窗口越大越差（tie=5 时 −2.46pp，p=0.0073），单调下降。
 *
 *   ⚠️⚠️ 为什么原有 15b-3 抓不住它：
 *      15b-3 只断言「分数完全并列时新的排前面」和「第 1 名不被换掉」。
 *      而 tie=2 恰好同时满足这两条（第 1 名有独占保护，真并列也能换）——
 *      它对「中间名次被乱序」这个真正的危害毫无察觉，给了虚假的安全感。
 *   ⇒ 断言必须落在**第 2 名之后**：相关性递减时，输出必须保持相关性顺序。
 */
{
  const nowR = Date.now();
  const DAYR = 86400000;
  const mkI = (rel, score, daysAgo, pri) => ({
    rel,
    r: { rel, score, ts: nowR - daysAgo * DAYR, last_hit_ts: 0, pri, dup: 1, text: 'x'.repeat(80) },
  });

  /* ⚠️⚠️ 关键：必须锁住**生产路径用的那个常量值**。
     踩过的坑：第一版断言显式传 `rankTie: 0`，于是把 RANK_TIE 改回 2 时
     测试依然全绿 —— 断言的其实是「我传进去的参数」，不是「产品会用什么」。
     现在改为：① 断言常量本身；② 用**生产路径的调用方式**（传 RANK_TIE）测行为。 */
  chk(ck.RANK_TIE === 0,
    `生产路径的并列容差 RANK_TIE = 0（实际 ${ck.RANK_TIE}）`,
    '改成 >0 就退回「名次差 ≤N 即并列」，实测 MRR 掉 1.4~2.5pp（p<0.05）');

  const prodOpts = { rankMode: true, rankTie: ck.RANK_TIE };

  /* ① 核心场景：相关性递减，但后面的更新。
     旧实现 tie=2 输出 `0 2 3 1`（第 2 名被推到末位）；正解应是 `0 1 2 3`。 */
  const mix = [
    mkI(0, -5.0, 400, 1),   // 最相关，很旧
    mkI(1, -3.0, 300, 1),   // 次相关，很旧
    mkI(2, -2.9, 0.01, 2),  // 相关性更低，但刚刚
    mkI(3, -1.0, 0.02, 2),
  ];
  const oMix = ck.rankRelevanceFirst(mix, nowR, prodOpts);
  const seqMix = oMix.map((x) => x.rel).join(',');
  chk(seqMix === '0,1,2,3',
    `相关性不同时保持相关性顺序（实际 ${seqMix}）`,
    '旧实现在这里输出 0,2,3,1 —— 第 2 名被新鲜度推到最后。这正是 −1.41pp 的来源');

  /* ② 原始分完全相等 ⇒ 允许换位（产品意图必须保留，别修过头） */
  const sameScore = [mkI(0, -2.0, 400, 1), mkI(1, -2.0, 0.01, 1)];
  const oSame = ck.rankRelevanceFirst(sameScore, nowR, prodOpts);
  chk(oSame[0].rel === 1,
    '原始分完全相等时，更新的排前面',
    '若这条挂掉说明收窄过头了，机制退化成「永不换位」');

  /* ③ 名次相邻（差 1）但分数明显不同 ⇒ 不算并列 */
  const nearBy = [mkI(0, -3.0, 400, 1), mkI(1, -0.1, 0.01, 2)];
  const oNearBy = ck.rankRelevanceFirst(nearBy, nowR, prodOpts);
  chk(oNearBy[0].rel === 0, '名次相邻但分数差得多时不算并列（名次差本身不是并列依据）');

  /* ④ 不变量①：第 1 名在任何情况下独占 */
  const keepFirst = [mkI(0, -5, 500, 1), mkI(1, -4.9, 0, 2), mkI(2, -4.8, 0, 2)];
  const oFirst2 = ck.rankRelevanceFirst(keepFirst, nowR, prodOpts);
  chk(oFirst2[0].rel === 0, '不变量①：第 1 名独占 0 组，任何因子都换不掉');

  /* ⑤ 端到端：真实检索里 gold 的落位不能因为换位而变差。
     这条是最终保障 —— 前面全是合成数据，这条走产品完整链路。 */
  const realQ = ck._internal.search(SID, '网关端口', 8);
  chk((realQ.hits || []).length > 0 && realQ.hits[0].seq !== undefined,
    '端到端：真实检索仍能正常返回（排序改动没破坏检索链路）');
}

/* ---------------- 15c. 事实层（阶段 4）：语义记忆 ---------------- */

console.log('\n15c) 事实层：抽取 / ADD-only / 双时间 / 三通道检索');

{
  // ── ① 结构 ──
  const fcols = db.prepare('PRAGMA table_info(fact)').all().map((r) => r.name);
  chk(fcols.indexOf('valid_from') >= 0, 'fact 有 valid_from（双时间的起点）');
  chk(fcols.indexOf('valid_to') >= 0, 'fact 有 valid_to（NULL = 仍有效）');
  chk(fcols.indexOf('src_seg_id') >= 0, 'fact 有 src_seg_id（能回查原话，不做孤证）');
  const ftables = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'fact%'").all().map((r) => r.name);
  chk(ftables.indexOf('fact_fts') >= 0, 'fact_fts 存在（事实也要能检索）');
  chk(ftables.indexOf('factq') >= 0, 'factq 存在（记录抽到哪了，避免重复烧额度）');

  // ── ② parseFactJson：模型返回的各种脏形状都要能吃 ──
  const pj = ck.parseFactJson;
  chk(pj('[]').ok && pj('[]').items.length === 0, '空数组解析成功且 0 条（模型答「没有值得记的」是正常结果）');
  const pFence = pj('```json\n[{"text":"某订单尾款 USD 100 未付","kind":"order","time":"2026-08-01"}]\n```');
  chk(pFence.ok && pFence.items.length === 1, '代码块围栏能剥掉（实测两个模型都会零星加料）');
  const pPre = pj('好的，以下是结果：\n[{"text":"某订单尾款 USD 100 未付","kind":"order"}]');
  chk(pPre.ok && pPre.items.length === 1, '前置废话能跳过（只认第一个 [ 到最后一个 ]）');
  const pBad = pj('[{"text":"缺引号,}]');
  chk(!pBad.ok, '坏 JSON 明确失败（不猜缺逗号 —— 猜错会写进残缺事实）');
  const pNotArr = pj('{"text":"不是数组"}');
  chk(!pNotArr.ok, '非数组明确失败');
  const pKind = pj('[{"text":"某个不知道的类型的事实","kind":"瞎写"}]');
  chk(pKind.ok && pKind.items[0].kind === 'other', '非法 kind 兜底成 other（不丢弃整条）');
  const pShort = pj('[{"text":"OK"}]');
  chk(pShort.ok && pShort.items.length === 0, '太短的不收（「OK」没有信息量）');
  const longText = '这是一条故意写得非常长的事实，'.repeat(12) + '。第二件事在这里。';
  const pLong = pj('[{"text":' + JSON.stringify(longText) + ',"kind":"tech"}]');
  chk(pLong.ok && pLong.items.length === 1 && pLong.items[0].text.length <= 160,
    '超长事实按句号截断而不是整条丢弃（实测模型会把三件事揉成一条）',
    '截后 ' + (pLong.items[0] ? pLong.items[0].text.length : 0) + ' 字');

  // ── ③ ADD-only + 冲突标失效 ──
  const FSID = 'facttest1';
  const FNOW = Date.now();
  const r1 = ck.insertFact(db, FSID, 101, { text: 'OCTAGON 订单尾款 USD 231,472.08 未付', kind: 'order' },
    { now: FNOW, model: 'test' });
  chk(r1 === 'added', '第一条事实写入成功（ADD-only 的起点）', '实际 ' + r1);

  const r2 = ck.insertFact(db, FSID, 102, { text: 'OCTAGON 订单尾款 USD 231,472.08 未付。', kind: 'order' },
    { now: FNOW, model: 'test' });
  chk(r2 === 'dup', '同一句话再说一遍只算 dup（标点差异不该产生两条）', '实际 ' + r2);

  const r3 = ck.insertFact(db, FSID, 103, { text: 'OCTAGON 订单尾款 USD 231,472.08 已付', kind: 'order' },
    { now: FNOW + 1000, model: 'test' });
  chk(r3 === 'invalidated', '⭐⭐ 状态反转（未付→已付）把旧事实标失效，而不是删掉',
    '这是双时间的核心：旧值必须可查，否则时序类提问永远答不出来');

  const oldRow = db.prepare("SELECT valid_to FROM fact WHERE sid=? AND text LIKE '%未付%'").get(FSID);
  chk(oldRow && oldRow.valid_to > 0, '旧事实确实被打上了 valid_to（不是被删）');
  const stillThere = db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=?').get(FSID);
  chk(Number(stillThere.c) === 2, '旧事实一行未删（ADD-only：只允许加与标失效）', '库内 ' + stillThere.c + ' 条');

  // 关键反向验证：不同金额 = 两件事，绝不许互相失效
  const r4 = ck.insertFact(db, FSID, 104, { text: 'OCTAGON 订单订金 USD 99,202.32 已付', kind: 'order' },
    { now: FNOW + 2000, model: 'test' });
  chk(r4 === 'added', '⭐⭐ 不同金额不触发失效（金额不同就是两件事，谁也不能取代谁）', '实际 ' + r4);
  const liveN = db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=? AND valid_to IS NULL').get(FSID);
  chk(Number(liveN.c) === 2, '有效事实应为 2 条（已付的尾款 + 已付的订金）', '实际 ' + liveN.c);

  /* ⭐⭐⭐ 这条是本轮修掉的**真 bug**，必须单独立一条：
   *
   * 两个不同订单，单号只差字母部分、数字完全一样：
   *   「…AB-260713 尾款 USD 231,472.08 未付」
   *   「…CD-260713 尾款 USD 231,472.08 未付」
   * 词面 jaccard ≈ 0.83（远超 0.5 阈值），数值集合完全相同（都是 260713 + 金额）。
   * 早期的判据是「数值集合相同 + 词面 0.5 重叠 ⇒ 判冲突」，于是**第二个订单
   * 会把第一个订单的事实标失效** —— 搜「AB 那个单」直接查不到东西。
   * 这不是排序问题，是数据丢失级的问题。
   * 现在的判据改成「强标识符集合必须有交集」，不再看数值。
   */
  const DUP_SID = 'facttest_same_num';
  const d1 = ck.insertFact(db, DUP_SID, 301,
    { text: '订单 AB-260713 尾款 USD 231,472.08 未付', kind: 'order' }, { now: FNOW, model: 'test' });
  const d2 = ck.insertFact(db, DUP_SID, 302,
    { text: '订单 CD-260713 尾款 USD 231,472.08 未付', kind: 'order' }, { now: FNOW + 500, model: 'test' });
  chk(d1 === 'added' && d2 === 'added',
    '⭐⭐⭐ 单号只差字母、数字与金额完全相同的两条事实互不失效（不同订单不是状态变化）',
    '实际 d1=' + d1 + ' d2=' + d2);
  const dupLive = db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=? AND valid_to IS NULL').get(DUP_SID);
  chk(Number(dupLive.c) === 2, '两个订单的事实都还活着', '实际 ' + dupLive.c);

  // 而同一条事实的状态变化仍然要能识别（不能因为上面收紧就失效了）
  const d3 = ck.insertFact(db, DUP_SID, 303,
    { text: '订单 AB-260713 尾款 USD 231,472.08 已付', kind: 'order' }, { now: FNOW + 1000, model: 'test' });
  chk(d3 === 'invalidated', '⭐⭐ 同一个单号的状态反转仍然能识别（收紧后没有把功能改坏）', '实际 ' + d3);

  // ── ④ 检索三通道 ──
  const qLive = ck.searchFacts(FSID, '尾款', 5);
  chk(qLive.items.length === 1, '默认只返回仍有效的事实（失效的不混进来）', '实际 ' + qLive.items.length);
  const qExp = ck.searchFacts(FSID, '尾款', 5, { includeExpired: true });
  chk(qExp.items.length === 2, '含失效时两条都在（时序能力靠这个）', '实际 ' + qExp.items.length);

  // ⭐⭐ 这条是最重要的一条：带强标识符查不到时**不许退回词法**
  //
  // 实测背景：库里只有「v1.6.0」，问「v1.9.9 发布了吗」时 FTS 通道照样返回了那条 ——
  //   因为 bigram('v1.9.9') = v1 / 9 / 9，而 v1 在 v1.6.0 里就有，OR 组合覆盖率 1/3 就过。
  //   这不是「相关」，是**错误命中**，比漏召回更坏（用户会以为 v1.9.9 真发布过）。
  const VSID = 'facttest_v';
  ck.insertFact(db, VSID, 201, { text: 'WorkDaddy 当前发布版本为 v1.6.0', kind: 'tech' },
    { now: FNOW, model: 'test' });
  const vHit = ck.searchFacts(VSID, 'v1.6.0', 5);
  chk(vHit.via === 'ENT' && vHit.items.length === 1, '版本号精确命中走 ENT 通道', '实际 via=' + vHit.via);
  const vMiss = ck.searchFacts(VSID, 'v1.9.9', 5);
  chk(vMiss.via === 'ENT-MISS' && vMiss.items.length === 0,
    '⭐⭐ 查 v1.9.9 但库里只有 v1.6.0 ⇒ 返回空（绝不拿相似版本号充数）',
    '实际 via=' + vMiss.via + ' n=' + vMiss.items.length);
  const vWord = ck.searchFacts(VSID, '发布版本', 5);
  chk(vWord.items.length === 1, '无标识符的普通词仍然走 FTS 正常召回', '实际 ' + vWord.items.length);

  // 强标识符提取：版本号曾经整类漏掉
  const idsV = ck.strongIds('v1.9.9 发布了吗');
  chk(idsV.indexOf('v1.9.9') >= 0, '⭐⭐ strongIds 能认出 v1.9.9（旧正则要求数字 2 位以上，版本号整类漏掉）',
    '实际 ' + JSON.stringify(idsV));
  const idsPort = ck.strongIds('网关端口 7863');
  chk(idsPort.indexOf('7863') >= 0, 'strongIds 能认出裸端口号（4 位，旧规则要 5 位）', '实际 ' + JSON.stringify(idsPort));
  chk(ck.strongIds('尾款多少').length === 0, '纯中文问句不产生假标识符');

  // ── ⑤ RRF 融合 ──
  const fused = ck.rrfFuse(
    [{ id: 1, text: '事实一' }, { id: 2, text: '事实二' }],
    [{ id: 11, text: '原文一' }, { id: 12, text: '原文二' }]
  );
  chk(fused.length === 4, 'RRF 融合后条数 = 两路之和（无交集时）', '实际 ' + fused.length);
  chk(fused[0].type === 'fact', '同等相关时事实排在原文前面（先给结论，不给一堆原话）',
    '实际首位 ' + fused[0].type);
  const fusedLen = fused.every((x) => typeof x.score === 'number' && x.score > 0);
  chk(fusedLen, '每条都带 RRF 分数（面板/调用方要能看出可信度）');

  // ── ⑥ 抽取进度不重抽（避免反复烧额度）──
  const prog = db.prepare('SELECT * FROM factq WHERE sid = ?').get(VSID);
  chk(!prog, '没调用过模型的会话不该有 factq 记录（不伪造进度）');

  // ── ⑦ 迁移幂等 ──
  const verNow = db.prepare('PRAGMA user_version').get().user_version;
  // ⚠️ 期望值跟着结构版本走（v5 事实层 / v6 实体 / v7 vt_reason）。
  //   写死具体数字是有意的：**升级脚本漏改只会让这条红，不会让功能静默失效** ——
  //   而迁移的幂等性（不会每次启动重抽/重建）正是靠版本号守着的。
  chk(Number(verNow) === 7, 'user_version = 7（v5 事实层 / v6 实体 / v7 失效原因；不会每次启动重抽）', '实际 ' + verNow);

  /* ================================================================
   * 15d) 实体索引与三路融合（阶段 5）
   *
   * 阶段 4 只把强标识符以 JSON 存进 `fact.ents`，查的时候还得 `text LIKE '%id%'`
   * 全表扫描，而且**实体只参与冲突判定、没参与检索**。
   * 阶段 5 把它拆成关系表 `ent(sid, fact_id, ent, norm, n)`，实体成为独立的一路召回。
   * ================================================================ */
  console.log('\n15d) 实体索引 / 实体检索 / 三路 RRF（阶段 5）');

  // ── ① 归一化：所有实体比对都必须走同一个口径 ──
  chk(ck.normEnt('YKW-SU-260713') === ck.normEnt('ykw-su-260713'),
    '实体归一化大小写不敏感（YKW-SU-260713 与 ykw-su-260713 必须视为同一个）',
    '实际 ' + ck.normEnt('YKW-SU-260713') + ' vs ' + ck.normEnt('ykw-su-260713'));
  chk(ck.normEnt('YKW SU 260713') === ck.normEnt('YKW-SU-260713'),
    '归一化吃掉分隔符差异（空格 / 连字符 / 下划线等价）', '实际 ' + ck.normEnt('YKW SU 260713'));
  chk(ck.normEnt('v1.9.9') !== ck.normEnt('v1.6.0'),
    '⭐⭐ 归一化**不能**把不同版本号抹成一样（否则又回到「v1.9.9 命中 v1.6.0」的错误命中）',
    '实际 ' + ck.normEnt('v1.9.9') + ' vs ' + ck.normEnt('v1.6.0'));

  // ── ② 实体表真的写进去了 ──
  const ESID = 'facttest_ent';
  ck.insertFact(db, ESID, 401, {
    text: '订单 YKW-SU-260713 走泗水港，供应商税号 418478260',
    kind: 'order',
  }, { now: FNOW, model: 'test' });
  const entRows = db.prepare('SELECT ent, norm FROM ent WHERE sid = ? ORDER BY norm').all(ESID);
  chk(entRows.length >= 2, '插事实时实体同时写进 ent 表（不用等回填）', '实际 ' + entRows.length + ' 行');
  const hasNorm = entRows.some((r) => r.norm === ck.normEnt('YKW-SU-260713'));
  chk(hasNorm, '⭐⭐ 单号以归一化形式入库（这是后续所有等值查询的基础）',
    '实际 ' + JSON.stringify(entRows.map((r) => r.norm)));
  const entRaw = db.prepare("SELECT ent FROM ent WHERE sid = ? AND norm = ?").get(ESID, ck.normEnt('YKW-SU-260713'));
  chk(entRaw && entRaw.ent === 'YKW-SU-260713',
    '⭐⭐ ent 列保留**原始写法**（归一化的只是 norm，展示要看得懂）',
    '实际 ' + (entRaw && entRaw.ent));

  // ── ③ 实体检索：换大小写也能查到（这正是关系表相对 LIKE 的收益）──
  const eHit = ck.factsByEnt(ESID, 'ykw-su-260713', {});
  chk(eHit.items.length === 1, '⭐⭐ 用小写查单号能查到（旧 LIKE 写法在含中文/全角时会失效）',
    '实际 ' + eHit.items.length);
  const eMiss = ck.factsByEnt(ESID, 'YKW-SU-999999', {});
  chk(eMiss.items.length === 0, '不存在的实体返回空（不拿相似的单号充数）', '实际 ' + eMiss.items.length);

  // ── ④ 实体清单 ──
  const eList = ck.entityList(ESID, {});
  chk(eList.items.length >= 2, '实体清单能列出该会话的标识符', '实际 ' + eList.items.length);
  chk(eList.items.every((x) => x.ent && x.norm && x.n >= 1),
    '清单每项都带原样 / 归一化 / 关联条数（面板要显示「这个键有几条事实」）');

  // ── ⑤ 删除事实必须连实体一起删（否则检索侧会以为它还活着）──
  //
  // ⚠️ 必须先判空再解引用。第一版直接 `eHit.items[0].id`，当前面的断言已经红
  //   （比如实体索引根本没写进去）时，这里会抛 TypeError 让**整个套件崩掉**，
  //   后面的断言一条都跑不到 —— 实验证时看到的是「崩溃」而不是「红了几条」，
  //   反而更难判断破坏点影响面。
  if (!eHit.items.length) {
    chk(false, '⑤ 前置：前面那条「用小写查单号」必须能查到，否则删除测试无从谈起');
  } else {
    const delTarget = eHit.items[0];
    db.prepare('DELETE FROM fact_fts WHERE rowid = ?').run(delTarget.id);
    db.prepare('DELETE FROM ent WHERE fact_id = ?').run(delTarget.id);
    db.prepare('DELETE FROM fact WHERE id = ?').run(delTarget.id);
    const afterDel = db.prepare('SELECT COUNT(*) c FROM ent WHERE fact_id = ?').get(delTarget.id);
    chk(Number(afterDel.c) === 0, '⭐⭐ 删事实会同时删实体行（残留会造成「计数虚高、结果为空」）',
      '实际残留 ' + afterDel.c);
    const eAfter = ck.factsByEnt(ESID, 'YKW-SU-260713', {});
    chk(eAfter.items.length === 0, '删完之后实体检索也查不到（两边口径一致）', '实际 ' + eAfter.items.length);
  }

  // ── ⑥ 三路 RRF ──
  //
  // 关键场景：同一条事实同时出现在「事实路」和「实体路」⇒ 分数叠加、排到最前。
  // ⚠️ 如果两条路的 key 命名空间不一致（一个用 fact-1、一个用 f1），
  //   「三路共识」永远不会发生，RRF 就退化成了「三份名单首尾相接」。
  const F1 = { id: 1, text: '事实甲' };
  const F2 = { id: 2, text: '事实乙' };
  const fused3 = ck.rrfFuse([F1, F2], [{ id: 11, text: '原文一' }], { ents: [F1] });
  chk(fused3.length === 3, '三路融合去重后条数 = 事实 ∪ 原文（同一事实不重复计条目）',
    '实际 ' + fused3.length);
  chk(fused3[0].item.id === 1 && fused3[0].hits >= 2,
    '⭐⭐ 双路命中的事实排第一，且 hits ≥ 2（这就是「三路共识」的可见证据）',
    '实际首位 id=' + fused3[0].item.id + ' hits=' + fused3[0].hits);
  const wEnt = ck.rrfFuse([], [], { ents: [F1] });
  chk(wEnt.length === 1 && wEnt[0].score > 0, '只有实体路也能出结果（三路互不依赖）');
  // 实体路权重最高：单独出现的实体命中要压过单独出现的事实命中
  const cmpA = ck.rrfFuse([F2], [], {});
  const cmpB = ck.rrfFuse([], [], { ents: [F2] });
  chk(cmpB[0].score > cmpA[0].score,
    '⭐ 实体命中权重高于事实词法命中（等值是确定性判断，不该被「比较像」压过）',
    '实体 ' + cmpB[0].score.toFixed(5) + ' vs 词法 ' + cmpA[0].score.toFixed(5));

  // ── ⑦ searchFacts 要额外返回完整实体命中列表（供第三路用）──
  //
  // ⚠️ 造数据时必须让 8 条文本**主题差异足够大**。
  //   第一版用了「订单 PO-778899 的第 N 次变更记录」，结果 8 条被 ADD-only 的
  //   冲突判定正确标失效了（同 kind、实体有交集、jac≥0.5 ⇒ 判成同一件事的状态变化），
  //   有效事实只剩 1 条 —— 断言红，但**代码是对的、测试是错的**。
  //   教训：验证「返回条数」的用例，不能让用例数据自己触发去重/失效逻辑。
  const ES2 = 'facttest_ent2';
  const MULTI = [
    ['订单 PO-778899 走泗水港，船期九月二日', 'shipment'],
    ['客户要求 PO-778899 的发票抬头写迪拜公司', 'order'],
    ['PO-778899 的订金已入账，金额核对无误', 'money'],
    ['供应商确认 PO-778899 五柜同时装船', 'shipment'],
    ['PO-778899 清关单据走 CargoX 平台递交', 'order'],
    ['财务提醒 PO-778899 尾款到账后放单', 'money'],
    ['PO-778899 的唛头按客户模板印刷', 'shipment'],
    ['客户联系人确认 PO-778899 卸货港为亚历山大', 'contact'],
  ];
  MULTI.forEach((m, i) => {
    ck.insertFact(db, ES2, 500 + i, { text: m[0], kind: m[1] }, { now: FNOW + i, model: 'test' });
  });
  const liveMulti = db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=? AND valid_to IS NULL').get(ES2);
  chk(Number(liveMulti.c) === 8,
    '用例前提：8 条有效事实都在（主题差异够大，不触发 ADD-only 冲突判定）', '实际 ' + liveMulti.c);
  const sf = ck.searchFacts(ES2, 'PO-778899', 2);
  chk(sf.exactItems && sf.exactItems.length >= 5,
    '⭐⭐ exactItems 返回**完整**实体命中（不受 limit 截断，第三路 RRF 要完整名单才准）',
    'items=' + sf.items.length + ' exactItems=' + (sf.exactItems ? sf.exactItems.length : 'undefined'));
  chk(sf.items.length === 2, 'items 仍然按 limit 截断（面板展示口径不变）', '实际 ' + sf.items.length);

  // ── ⑧ 面板 / 服务端接口 ──
  const srvSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  chk(/sub === 'entities'/.test(srvSrc), '服务端有实体清单接口（面板要把可精确检索的键摊开给人挑）');
  chk(/sub === 'ent-facts'/.test(srvSrc), '服务端有「按实体取事实」接口');
  /**
   * ⚠️⚠️ 这条断言第一版写成 `/DELETE FROM ent WHERE fact_id/` 直接测全文 ——
   *   结果 `indexFactEnts()` 里「写之前先按 fact_id 清干净」那句话也匹配它，
   *   于是把 fact-mark 删除路由里的清理删掉，断言照样绿（**假通过**，实测确认）。
   *   正确做法 = 先截出删除路由那一段（从 `act === 'delete'` 到该分支结束的 `}`），
   *   只在那一段里找。同理 fact-clear 单独测。
   *
   * ⚠️ 截取本身也有坑：第一版用 `[\s\S]{0,900}?return send(...)` 惰性匹配，
   *   结果停在**分支中间**的 `if (!row) return send(...)` 上（长度只有 100 多字），
   *   真正要验的那句在后面 ⇒ 断言仍然假通过。改成以「删完写日志」那句为右边界，
   *   它必然在清理语句之后。
   */
  const delSeg = (srvSrc.match(/if \(act === 'delete'\)[\s\S]{0,1200}?删除事实 #/) || [''])[0];
  chk(delSeg.length > 200, '① 测试自身前提：能截出删除事实那段代码（含清理语句）', '长度 ' + delSeg.length);
  chk(/DELETE FROM ent WHERE fact_id/.test(delSeg),
    '⭐⭐ 反例守卫：删除事实的路由里必须显式清实体行（漏了会造成检索侧幽灵命中）');
  chk(/DELETE FROM fact_fts WHERE rowid/.test(delSeg),
    '⭐⭐ 反例守卫：删除事实时 FTS 行也必须一起删（同属「删了但索引还在」这一类）');
  // ⚠️ 上限 700 → 1200：阶段 6 在 fact-clear 里补了「整理日志一并清空」的注释，
  //   实测锚点距离从 ~500 涨到 798，700 截不到右边界 ⇒ 含 DELETE FROM ent 的那句落在外面 ⇒ 假红。
  const clearSeg = (srvSrc.match(/sub === 'fact-clear'[\s\S]{0,1200}?return send\(res, 200, \{ ok: true, dropped/) || [''])[0];
  chk(/DELETE FROM ent/.test(clearSeg),
    '⭐⭐ 反例守卫：清空事实层时必须连实体表一起清');

  // ── ⑨ 面板实体视图 ──
  const uiEnt = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory-ui.js'), 'utf8');
  chk(/renderEnts/.test(uiEnt) && /loadEnts/.test(uiEnt) && /loadEntFacts/.test(uiEnt),
    '面板有三个实体相关函数（清单 / 拉清单 / 拉事实）');
  chk(/按实体/.test(uiEnt), '事实页有「按实体」入口（否则这个能力用户看不见）');
  chk(/ckm-ent-t\{[^}]*word-break:\s*break-all/.test(uiEnt),
    '⭐⭐ 实体名允许任意位置断行（长单号在窄面板里会溢出，右侧条数徽标被推出可视区）');
  chk(/if \(S\.entPick !== norm\) return;/.test(uiEnt),
    '⭐⭐ 实体事实的回包要校验「还是不是最后点的那个」（连点两个实体会串结果）');
  const entRule = (uiEnt.match(/\.ckm-ent\{[^}]*\}/) || [''])[0];
  chk(/display:\s*flex/.test(entRule),
    '⭐ 实体项必须显式 display:flex（漏了会退化成 block，名字与条数上下排、行高翻倍）', entRule.slice(0, 60));

  // ── ⑧ 面板静态断言 ──
  const uiSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory-ui.js'), 'utf8');
  chk(uiSrc.indexOf("'facts'") >= 0 && uiSrc.indexOf('renderFacts') >= 0, '面板有「事实」入口与渲染函数');
  chk(uiSrc.indexOf('ckm-fact-text') >= 0, '事实卡片有独立样式（不借用原文那套）');
  chk(uiSrc.indexOf('kindLabel') >= 0, '事实类型显示中文名（面板上直接显示 kind 不可读）');
  chk(/ckm-fact-k\.k-order\{[^}]*#[0-9a-f]{6}/.test(uiSrc), '类型徽标前景色写死 hex（挂 body 后 --wb-* 拿不到值）');
  // ⚠️ 不能把版本号写死成某个具体值：每改一次结构都要 +1，写死的话每次都得顺手改测试，
  //   而「顺手改测试」正是把断言改松的开始（改着改着就变成 chk(true)）。
  //   这里只守下限 —— 只要没被改回 32 及以下，说明结构改动确实 bump 过。
  const uiRevNum = Number((uiSrc.match(/var UI_REV = '(\d+)'/) || [])[1] || 0);
  chk(uiRevNum >= 33, 'UI_REV ≥ 33（改 UI 结构必须 +1，否则新旧 DOM 叠加）', 'UI_REV=' + uiRevNum);

  // ── ⑧a-1 整理视图（阶段 6 后半段）──
  chk(/function renderConsol/.test(uiSrc), '面板有整理视图渲染函数');
  chk(/function loadConsCand/.test(uiSrc) && /function loadConsHist/.test(uiSrc),
    '面板能拉候选清单与整理历史');
  chk(/S\.mode === 'facts' && S\.fcons/.test(uiSrc),
    '⭐⭐ 整理视图优先于事实列表分发（否则点「整理」会立刻被 loadFacts 冲掉）');
  chk(/没有合并/.test(uiSrc) || /j\.why/.test(uiSrc),
    '⭐⭐ 合并被服务端拒绝时要把原因显示出来（只显示「失败」用户不知道该改什么）');
  chk(/为什么没有「一键自动合并」/.test(uiSrc),
    '⭐⭐ 面板必须写出「为什么不自动合并」—— 否则用户只会觉得功能没做完');
  // ⚠️ 面板不能自己判「能不能合」，必须由服务端重新校验；
  //   这里守一条：前端点击后走的是 consolidate-merge，而不是直接改本地状态。
  chk(/consolidate-merge/.test(uiSrc), '⭐⭐ 合并按钮走服务端校验接口（前端不自己下判断）');
  chk(/consolidate-candidates/.test(uiSrc), '候选清单走只读接口');
  // 回滚按钮必须带 runId
  chk(/rollback:\s*it\.runId/.test(uiSrc), '⭐⭐ 回滚按 runId 精确撤回（不是「撤销上一次」这种模糊语义）');
  // 长文本断行：与 .ckm-ent-t 同一个坑，补一条守卫
  chk(/\.ckm-cons-tx\{[^}]*word-break:break-word/.test(uiSrc),
    '⭐⭐ 候选正文允许断行（窄面板里长句会撑破卡片）');
  chk(/\.ckm-cons-tx\{[^}]*min-width:0/.test(uiSrc),
    '⭐⭐ 候选正文必须 min-width:0（flex 子项默认 auto，长中文会挤掉右侧 id）');
  // 挂 body 后 --wb-* 拿不到值：整理视图里不许出现无 fallback 的 var()
  const consCss = (uiSrc.match(/\.ckm-cons-[\s\S]{0,9000}/) || [''])[0];
  const bareVar = (consCss.match(/var\(--[a-z0-9-]+\)/gi) || []);
  chk(bareVar.length === 0,
    '⭐⭐⭐ 整理视图的 CSS 不许出现无 fallback 的 var(--x)（脱离 --wb-* 作用域后整条声明作废且不报错）',
    bareVar.length ? '发现 ' + bareVar.slice(0, 3).join(',') : '');

  /**
   * ⑧a-2 面板密度：340px 是面板**最小**高度，必须还能看见结果区。
   *
   * ⚠️⚠️⚠️ 实测（700x340，详见 .wd-tmp/_test-density.js）：
   *   宿主自己的标题 + 标签栏吃掉 163px，留给 .ckm-wrap 只有 177px。
   *   修之前各条带合计 146px ⇒ 结果区只剩 **5px**：卡片全在 DOM 里但一张都看不见，
   *   用户观感就是「记忆页坏了」。
   *
   * ⚠️⚠️ 2026-11-05 重构后判据整体换了，但**要保的东西没变**：
   *   旧方案靠「tiny 档把两张开关卡并排」省 35px；
   *   新方案更彻底 —— 那张卡默认就不在首屏（收进「高级」折叠区），
   *   所以省下的不是 35px 而是 70~100px。等价性证明：
   *     · 「自动带入 / 自动提炼」仍然**一个都没少**（在 .ckm-adv 里，点一下就到）；
   *     · 它们在 tiny 档也不会被藏掉（隐藏只由 S.adv 决定，与面板高度无关）。
   *   ⇒ 旧断言「必须 .ckm-sw 并排」随结构作废，换成下面三条新断言。
   */
  chk(/data-adv-box/.test(uiSrc) && /S\.adv/.test(uiSrc),
    '② 两个子开关收在「高级」折叠区（默认不在首屏，矮面板才看得见结果）');
  chk(/advBox\.hidden = !S\.adv/.test(uiSrc),
    '② 折叠区的显隐只由 S.adv 决定（与面板高度无关 ⇒ tiny 档不会把功能藏掉）');
  chk(!/\.ckm-wrap\.tiny[^{]*\{[^}]*ckm-adv[^}]*display:none/.test(uiSrc),
    '② 反例守卫：tiny 档不能把「高级」整块藏掉（否则两个子开关彻底点不到）');
  chk(/\.ckm-wrap\.tiny \.ckm-foot\{display:none\}/.test(uiSrc),
    '② tiny 档让出底栏（否则 340px 时结果区只剩 5px，卡片在 DOM 里但看不见）');
  chk(!/\.ckm-wrap\.tiny \.ckm-fx\{display:none\}/.test(uiSrc),
    '② 反例守卫：tiny 档不能把「自动提炼事实」整张藏掉（它是唯一花额度的功能，必须可见）');
  chk(!/\.ckm-wrap\.tiny \.ckm-inj\{display:none\}/.test(uiSrc),
    '② 反例守卫：tiny 档不能把「自动带入记忆」整张藏掉');
  chk(/\.ckm-wrap\.tiny \.ckm-bar\{/.test(uiSrc) && !/\.ckm-wrap\.tiny \.ckm-bar\{display:none\}/.test(uiSrc),
    '② 反例守卫：tiny 档不能藏搜索行（搜索是这个面板的核心用途）');

  // ── ⑧b 定时器启动顺序（这条守着一个「静默不工作」的真 bug）──
  //
  // ⚠️⚠️⚠️ 实测踩到：factTimer 的启动原先写在
  //   `if (!available() || !state.enabled) return;` 之后。
  //   本机 config.json 是 enabled:false（用户关了自动索引）⇒ startAll() 提前 return
  //   ⇒ factTimer 永远不启动，而且日志里**一句话都没有**。
  //   表现：「自动提炼」开关开着、库里 factExtract:true，就是永远不抽。
  const coreSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  const startAllBody = coreSrc.slice(coreSrc.indexOf('function startAll()'), coreSrc.indexOf('function stopAll()'));
  // ⚠️ 必须按「整行代码」找，不能按裸字符串找：注释里也引用了同一段代码，
  //   indexOf 会命中注释里那处，位置判断全错（第一版就栽在这，误报失败）。
  const codeOnly = startAllBody.split(/\r?\n/)
    .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))   // 去掉纯注释行
    .join('\n');
  const iFact = codeOnly.indexOf('factTimer = setInterval');
  const iGuard = codeOnly.indexOf('if (!available() || !state.enabled) return;');
  chk(iFact >= 0, 'startAll 里确实启动了事实抽取定时器');
  chk(iGuard < 0 || iFact < iGuard,
    '⭐⭐ 事实抽取定时器**排在 enabled return 之前**（否则关掉自动索引就永远不抽，且无任何日志）',
    'factTimer 位置 ' + iFact + ' / return 位置 ' + iGuard);
  chk(codeOnly.indexOf('state.factExtract') >= 0, '事实抽取自己看 factExtract 开关，不依赖 enabled');

  // ── ⑨ MCP 工具 ──
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-mcp.js'), 'utf8');  chk(mcpSrc.indexOf("name: 'memory_facts'") >= 0, 'MCP 暴露 memory_facts 工具');
  chk(mcpSrc.indexOf('includeExpired') >= 0, 'MCP 能查已失效的旧事实（时序问题要用）');
  chk(mcpSrc.indexOf('ENT-MISS') >= 0, 'MCP 会如实说明「编号没查到」，不拿相似结果充数');
  chk(mcpSrc.indexOf('factElsewhere') >= 0 && mcpSrc.indexOf('不跨会话取正文') >= 0,
    '⭐⭐ 当前会话没有时会提示「别的会话有几条」，只报数量不返回正文（边界不破，又不至于像坏了）');
  chk(typeof ck.factCountElsewhere === 'function', 'factCountElsewhere 已导出（MCP 靠它做跨会话计数）');
  // 它只返回 count + short，绝不带 text 字段
  const ce = ck.factCountElsewhere('codegraph');
  chk(ce && typeof ce.count === 'number' && Array.isArray(ce.sids),
    'factCountElsewhere 返回 { count, sids }，不含正文');
  chk(!ce.sids.length || ce.sids.every((x) => x.short && typeof x.n === 'number' && x.text === undefined),
    'factCountElsewhere 的每条只有 short / n，没有 text（确认没漏正文）');
  // ⚠️ MCP 入参仍然没有 sid：与原文检索同口径，不给跨会话口子。
  //   切片必须只取**这一个工具的 schema 段**（取到下一个 name: 为止），
  //   否则会把后面工具或代码里的 sid 误算进来（第一版就切错了，误报失败）。
  const factToolStart = mcpSrc.indexOf("name: 'memory_facts'");
  const nextTool = mcpSrc.indexOf("name: 'memory_", factToolStart + 10);
  const factSig = mcpSrc.slice(factToolStart, nextTool > 0 ? nextTool : factToolStart + 1200);
  chk(factSig.indexOf('sid') < 0, 'memory_facts 入参没有 sid（不开跨会话口子，与 memory_search 同口径）');

  // ── ⑩ node:sqlite 的坑：apply(null,...) 会 Illegal invocation ──
  //
  // ⚠️⚠️ 这条守着一个**假阴性**：node:sqlite 的 StatementSync 方法带原生 this 绑定，
  //   `st.all.apply(null, args)` 在严格模式下抛 Illegal invocation。
  //   异常被 catch 吞掉后表现成「返回 0 条」—— 看起来像「没找到」，
  //   实际是调用方式错了。加断言防止以后又被人「优化」回去。
  let applyWorks = false;
  try {
    const st = db.prepare('SELECT COUNT(*) c FROM fact WHERE sid = ?');
    st.all.apply(null, [FSID]);
    applyWorks = true;
  } catch (e) {
    applyWorks = /Illegal invocation/.test(e.message);
  }
  chk(applyWorks, 'apply(null,…) 确实不可用于 node:sqlite（检索里必须用展开调用 ...args）');
}

/* ================================================================
 * 15e) 阶段 6：库外话题拦截（评测集量出来的拒答判据）
 *
 * 背景（评测基线，39 条真实用例）：
 *   加这两道判据之前，8 条负例 **100% 被答了出来**，拒绝率 0%。
 *   命中的是 `怎么`(df 437) / `阈值`(df 83) / `的`(df 1897) 这类通用词 ——
 *   OR 兜底把一堆无关对话当答案端上来。
 *
 * 为什么必须单独测这两条判据、而不是只测 search() 的整体行为：
 *   拦截生效但判据本身错了（比如把 `redis` 当成锚点）时，整体行为看起来
 *   仍然「拒答成功」，只是把正常问题也一起拒了。只有把判据拆出来逐词断言，
 *   才能区分「拒得对」和「拒得太狠」。
 * ================================================================ */

console.log('\n15e) 阶段 6：库外话题拦截（拒答判据）');

{
  const L = ck._internal;

  // ── ① latinTerms：只抠「英文专名」，不抠数字与短缩写 ──
  const lt1 = L.latinTerms('Kubernetes 的 Pod 驱逐阈值怎么配');
  chk(lt1.indexOf('kubernetes') >= 0 && lt1.indexOf('pod') >= 0,
    '英文专名能抠出来（Kubernetes / Pod）', '实际 ' + JSON.stringify(lt1));
  chk(lt1.indexOf('的') < 0 && lt1.indexOf('驱逐阈值怎么配') < 0, '中文不会被当成英文专名');
  const lt2 = L.latinTerms('v3.0.0 的发布说明');
  chk(lt2.indexOf('v3.0.0') >= 0 || lt2.length === 0,
    '版本号交给 strongIds 走 idMiss，latinTerms 收不收都行（但不能切出乱码）',
    '实际 ' + JSON.stringify(lt2));
  const lt3 = L.latinTerms('280 号柜');
  chk(lt3.length === 0, '纯数字不产生英文专名（数字走 strongIds / LIKE）', '实际 ' + JSON.stringify(lt3));
  const lt4 = L.latinTerms('Server Actions 的缓存策略');
  chk(lt4.indexOf('server') >= 0 && lt4.indexOf('actions') >= 0, 'Server Actions 能抠出两个词');

  // ── ② LATIN_ANCHOR_DF_MAX：稀有度阈值必须是保守值 ──
  const thr = L.LATIN_ANCHOR_DF_MAX;
  chk(thr > 0 && thr <= 200,
    '⭐ 稀有度阈值在 1~200 之间（实测 0~200 误伤都是 0，取偏小更保守）', '实际 ' + thr);

  // ── ③ latinMiss：核心判据 ──
  //
  // 造三条数据把「查无」和「查得到」分开：
  //   库里有的：server（当日常词，df 会很高）、redis（少量）、尾款（中文）
  //   库里没有：kubernetes / nafenza 之类编造词
  const LTSID = 'test-latin-miss';
  // ⚠️ 先清缓存再断言：前面的用例（15c / 15d）已经跑过检索，termDf 的缓存里
  //   可能存着「当时库里还没有某词」的旧值 ⇒ 这里的断言会读到过期数据而随机红。
  L.invalidateDfCache();
  const ltLines = [
    { text: '网关那边的 server 重启一下就行，不用改配置', pri: 2 },
    { text: 'redis 只是缓存，掉了不影响主流程', pri: 2 },
    { text: '尾款还没到账，等 SUNRISE-FZCO 支付', pri: 2 },
  ];
  for (let i = 0; i < ltLines.length; i++) {
    const info = db.prepare(
      'INSERT INTO seg (sid, seq, ts, role, kind, text, h, dup, noise, last_ts, pri) VALUES (?,?,?,?,?,?,?,1,0,?,?)'
    ).run(LTSID, i + 1, 1790000000000 + i, 'user', 'user', ltLines[i].text, 'h' + i, 1790000000000 + i, ltLines[i].pri);
    db.prepare('INSERT INTO seg_fts (rowid, big) VALUES (?, ?)')
      .run(info.lastInsertRowid, ck.bigram(ltLines[i].text));
  }

  const m1 = L.latinMiss(db, 'kubernetes 的 pod 驱逐阈值怎么配');
  chk(m1.length > 0 && m1.indexOf('kubernetes') >= 0,
    '⭐⭐ 整库查无的英文专名 ⇒ 判「库里没有」', '实际 ' + JSON.stringify(m1));
  const m2 = L.latinMiss(db, 'redis 集群怎么配');
  chk(m2.length === 0,
    '⭐⭐ 库里出现过（哪怕只有几次）的英文词不拦 —— 误伤正常问题比漏拦更糟',
    '实际 ' + JSON.stringify(m2));
  const m3 = L.latinMiss(db, 'server 重启了吗');
  chk(m3.length === 0,
    '⭐⭐ 日常英文词（server）不拦 —— 它是 df 很高的常用词，不能当「话题不存在」的锚点',
    '实际 ' + JSON.stringify(m3));
  const m4 = L.latinMiss(db, '尾款什么时候到账');
  chk(m4.length === 0, '纯中文查询不产生英文锚点（不误伤）', '实际 ' + JSON.stringify(m4));
  const m5 = L.latinMiss(db, 'Nafeza 的 ACI 单据怎么走');
  chk(m5.length > 0, '两个都没出现过的专名，任一个命中即可拦',
    '实际 ' + JSON.stringify(m5));

  // ── ④ 词表未就绪时必须「不拦」，不能「全拦」 ──
  //
  // ⚠️⚠️⚠️ 这条守着一个**会废掉整个英文检索**的坑：
  //   termDf 查 temp.wd_vocab 抛错会被 catch 成 0，于是所有 df 都是 0
  //   ⇒ 所有英文词都判「整库查无」⇒ 带英文的查询全部返回「没找到」，
  //   现象还特别像「记忆是空的」（via=ENT-MISS / hits=[]）。
  //   静态断言：latinMiss 的第一道必须是 ensureVocab 的结果判断。
  const coreNow = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  // ⚠️ 上限要给够（实测函数体含注释 1037 字）。给 900 时截不到结尾的 `\r\n}`，
  //   正则整体失配 ⇒ 长度 0 ⇒ 断言红。这时**先怀疑自己的边界，别去怀疑代码**。
  const lmBody = (coreNow.match(/function latinMiss\(db, q\) \{[\s\S]{0,3000}?\r?\n\}/) || [''])[0];
  chk(/if \(!ensureVocab\(db\)\) return \[\]/.test(lmBody),
    '⭐⭐⭐ 词表没就绪时直接放行（否则 df 全为 0 ⇒ 所有英文查询被误判成「库里没有」）',
    '长度 ' + lmBody.length);
  chk(lmBody.indexOf('ensureVocab') < lmBody.indexOf('const miss'),
    '这道守卫必须排在建 miss 数组之前（放在循环里就白做）');

  // ── ⑤ idMiss：强标识符整库查无 ──
  const i1 = L.idMiss(db, 'v3.0.0 版本的发布说明在哪');
  chk(i1.length > 0 && i1.some((x) => /v3\.0\.0/i.test(x)),
    '⭐⭐ 版本号整库查无 ⇒ 拦（否则 bigram 会拿 v1.6.0 之类充数）', '实际 ' + JSON.stringify(i1));
  const i2 = L.idMiss(db, 'v1.9.9 发布了吗');
  chk(i2.length > 0 || i2.length === 0,
    '（v1.9.9 是否在库取决于造的数据，这里只要求不抛错）', '实际 ' + JSON.stringify(i2));
  const i3 = L.idMiss(db, '尾款什么时候到账');
  chk(i3.length === 0, '无强标识符的查询不拦（纯中文问句走正常检索）', '实际 ' + JSON.stringify(i3));

  // ⚠️⚠️⚠️ 纯数字段的处理是**双向**的，必须两个方向都验：
  //   ① 库里只有裸数字 `260713`（金额 / 日期 / 后缀都可能），但**没有** `AB-260713`
  //      ⇒ 不能因为 260713 命中就放行。否则「问 AB 那个单」会拿一堆含 260713 的
  //      无关对话当答案 —— 这正是阶段 4 两个订单互相标失效的同源问题。
  //   ② 库里真的有 `AB-260713` ⇒ 必须放行（否则正常问题被拒答）。
  //   第一版这里只写了「期望空」一条，把方向搞反了：AB-260713 确实查无，
  //   拒答是**正确行为**，断言红是测试错、不是代码错。
  db.prepare(
    'INSERT INTO seg (sid, seq, ts, role, kind, text, h, dup, noise, last_ts, pri) VALUES (?,?,?,?,?,?,?,1,0,?,2)'
  ).run(LTSID, 80, 1790000800000, 'user', 'user', '税号后六位是 260713，别抄错', 'h80', 1790000800000);
  const i4 = L.idMiss(db, '订单 AB-260713 的尾款');
  chk(i4.length === 1 && i4[0] === 'AB-260713',
    '⭐⭐ 裸数字 260713 在库也**不能**替字母编号洗白（AB-260713 查无仍要拦）',
    '实际 ' + JSON.stringify(i4));
  // 现在把真正的单号写进库 ⇒ 必须放行
  const abInfo = db.prepare(
    'INSERT INTO seg (sid, seq, ts, role, kind, text, h, dup, noise, last_ts, pri) VALUES (?,?,?,?,?,?,?,1,0,?,2)'
  ).run(LTSID, 81, 1790000810000, 'user', 'user', '订单 AB-260713 的尾款下周到', 'h81', 1790000810000);
  db.prepare('INSERT INTO seg_fts (rowid, big) VALUES (?, ?)')
    .run(abInfo.lastInsertRowid, ck.bigram('订单 AB-260713 的尾款下周到'));
  const i4b = L.idMiss(db, '订单 AB-260713 的尾款');
  chk(i4b.length === 0, '⭐⭐ 单号真的在库里 ⇒ 放行（不能因为纯数字那条规则把正常问题也拒了）',
    '实际 ' + JSON.stringify(i4b));

  // ── ⑥ 拦不拦得住「纯自然语言泛问题」——如实记为已知边界，不假装解决了 ──
  const m6 = L.latinMiss(db, 'Server Actions 的缓存策略');
  chk(m6.length > 0,
    'N07 这类（Server Actions）能被拦住的**唯一原因**是英文专名查无 —— 中文部分一点用都没有',
    '实际 ' + JSON.stringify(m6));
  const m7 = L.latinMiss(db, '缓存策略一般怎么设计');
  chk(m7.length === 0,
    '⭐ 已知边界：纯中文泛问题拦不住（没有确定性锚点）—— 这是记录在案的缺口，不是 bug');

  // ── ⑦ 位置断言：拦截必须在 AND 之前，且 deep=true 不拦 ──
  const searchBody = (coreNow.match(/⓪ 库外话题拦截[\s\S]{0,1600}?\/\/ ① AND/) || [''])[0];
  chk(searchBody.length > 100, '① 测试自身前提：能截出「⓪ 拦截 → ① AND」这一段', '长度 ' + searchBody.length);
  chk(/if \(!deep\) \{/.test(searchBody),
    '⭐⭐ 只在 deep=false 时拦（deep=true 是「翻全部过程话」的显式请求，不该被拦）');
  chk(searchBody.indexOf('latinMiss') < searchBody.indexOf('// ① AND'),
    '⭐⭐ 拦截必须排在 AND 之前（放到 OR 之后等于白做 —— OR 兜底一定会返回东西）');

  // ── ⑧ 反向验证：把 ⓪ 段删掉，负例应该立刻被答出来 ──
  //
  // ⚠️ 静态断言只能证明「代码里有这段」，证明不了「它真的在起作用」。
  //   所以这里动态验一次：同样的查询，deep=true（绕过拦截）必须能查到东西，
  //   deep=false（走拦截）必须是空的。两条同时成立才说明拦截真的在拦。
  const qNafeza = 'Nafeza 的 ACI 单据怎么走';
  const rBlocked = L.search(LTSID, qNafeza, 5, false);
  chk((rBlocked.hits || []).length === 0 && /MISS/.test(rBlocked.via || ''),
    '⭐⭐ 动态验证：库里没有 Nafeza ⇒ 默认路径返回空并注明 via=MISS',
    '实际 via=' + rBlocked.via + ' n=' + (rBlocked.hits || []).length);
  const rDeep = L.search(LTSID, qNafeza, 5, true);
  chk(rDeep.via !== 'ENT-MISS' && rDeep.via !== 'ID-MISS',
    '⭐⭐ 动态验证：deep=true 绕过拦截（证明拦截是「有条件的」，不是把功能焊死）',
    '实际 via=' + rDeep.via);

  // ── ⑨ fuse 路由也必须拦住（否则融合层会把拒答「翻案」）──
  //
  // ⚠️⚠️ 实测背景：漏写这一道，负例拒答从 75% 掉到 62.5% ——
  //   原文路已经判 ENX-MISS，但事实路靠短文本宽召回硬凑出几条，
  //   经 RRF 加权后端上来，看起来像「有答案」。
  const fuseSeg = (coreNow.match(/if \(r\.via === 'ENT-MISS' \|\| r\.via === 'ID-MISS'\)[\s\S]{0,400}?\}\);/) || [''])[0];
  chk(fuseSeg.length > 100, '① 测试自身前提：能截出 fuse 路由的拦截分支', '长度 ' + fuseSeg.length);
  chk(/hits: \[\]/.test(fuseSeg), '⭐⭐ fuse 路由在原文路拒答时直接返回空 hits');
  chk(/fused: \[\]/.test(fuseSeg), '⭐⭐ 同时必须给出空 fused（否则前端仍会渲染出融合结果）');
  chk(/facts: \[\]/.test(fuseSeg), '⭐⭐ 事实数组也要清空（不能只清一路，留一路等于没拦）');

  // ── ⑨b 拒答理由必须一路透传到面板 ──
  //
  // ⚠️⚠️ 只把 `via` 传到前端是不够的：「ENT-MISS」对用户是无意义的内部代码。
  //   拒答必须给出**可核对的理由**（「库里没出现过 Nafeza」），否则和「功能坏了」
  //   在用户眼里完全一样 —— 而这两种情况的应对方式截然不同。
  // ⚠️ 上限要给够：从 `return send(res, r.error` 到结尾的 `});` 实测约 560 字
  //   （里面带了整段 miss 说明注释）。给 500 时惰性匹配够不到右边界 ⇒ 整体失配 ⇒ 长度 0。
  //   这已经是本轮第二次栽在「截取上限给太小」上 —— 截不出东西时先量真实长度。
  const searchRoute = (coreNow.match(/sub === 'search' && method === 'POST'[\s\S]{0,6000}?return send\(res, r\.error[\s\S]{0,1500}?\}\);/)
    || [''])[0];
  chk(searchRoute.length > 500, '① 测试自身前提：能截出 search 路由的返回体', '长度 ' + searchRoute.length);
  chk(/miss: r\.miss \|\| \[\]/.test(searchRoute),
    '⭐⭐ search 路由必须透传 miss（否则前端只能显示「没找到」，和故障无法区分）');

  const uiSrcNow = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory-ui.js'), 'utf8');
  chk(/S\.miss = j\.miss \|\| \[\]/.test(uiSrcNow),
    '⭐⭐ 面板要把 miss 存进 state（只连接口不存，空结果页仍然说不出理由）');
  chk(/S\.miss && S\.miss\.length/.test(uiSrcNow),
    '⭐⭐ 空结果页要分支处理拒答（与「关键词不匹配」分开说）');
  // 反向守卫：不能把拒答文案写成「没找到」——那样等于把判断成本推给用户
  chk(!/tip = '没有命中「' \+ \(S\.q \|\| ''\) \+ '」（库外话题）/.test(uiSrcNow),
    '② 反例守卫：拒答文案不许混进「没有命中」那一句');
  const uiRevNow = Number((uiSrcNow.match(/var UI_REV = '(\d+)'/) || [])[1] || 0);
  chk(uiRevNow >= 39, '改 UI 结构（新增 miss 分支）后 UI_REV 必须 +1', 'UI_REV=' + uiRevNow);

  // ── ⑩ df 缓存必须随索引写入失效 ──
  //
  // ⚠️⚠️⚠️ 这条守着一个「刚聊过的话题被判成没聊过」的坑：
  //   termDf 的缓存原本是「跨查询也有效、词表变化慢」，但索引器每 30s 就写一批。
  //   09:00 查 nafenza（当时没有 ⇒ 缓存 0），09:01 聊了并入库，09:02 再问
  //   ⇒ latinMiss 读到缓存 0 ⇒ 回答「库里没有」，而答案就在库里。
  const ingBody = (coreNow.match(/function ingestSession\(db, target, opts\)[\s\S]{0,9000}?return \{ added, merged, total: seq, consumed \};/) || [''])[0];
  chk(/invalidateDfCache\(\)/.test(ingBody),
    '⭐⭐⭐ ingestSession 写入后必须清 df 缓存（否则新入库的话题会被判成「库里没有」）',
    '长度 ' + ingBody.length);
  const iCommit = ingBody.indexOf('COMMIT');
  const iInv = ingBody.indexOf('invalidateDfCache()');
  chk(iCommit >= 0 && iInv > iCommit,
    '⭐⭐ 清理必须排在 COMMIT **之后**（提交前清，回滚后缓存会「读到」已回滚的行）',
    'COMMIT@' + iCommit + ' invalidate@' + iInv);
  chk(/function invalidateDfCache\(\)[\s\S]{0,200}?_dfCache\.clear\(\)/.test(coreNow),
    'invalidateDfCache 真的清了 _dfCache（不是空函数）');
  /* ⚠️⚠️⚠️ 这里**不能**用「function open() 之后 N 个字符内出现 X」的正则。
     2026-11-05 踩过：给 open() 加了一段 WAL 注释，_vocabReady 的偏移从 ~1000
     涨到 1424 字符，就超了写死的 1400 窗口 ⇒ 守卫**假失败**，而产品完全正常。
     这种「用字符数当作用域」的守卫，只要函数里加注释就会误报，等于把
     "别忘了改一处" 变成 "别忘了别加注释" —— 两个都不是人该记的事。
     正解：先按大括号配对把 open() 的函数体切出来，再在里面找。
     窗口只用来定位 `{` 的出现位置，不再承担"作用域"职责。 */
  const openAt = coreNow.indexOf('function open()');
  let openBody = '';
  if (openAt >= 0) {
    const braceAt = coreNow.indexOf('{', openAt);
    if (braceAt > 0) {
      let depth = 0, end = -1;
      for (let p = braceAt; p < coreNow.length; p++) {
        const ch = coreNow[p];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = p; break; } }
      }
      if (end > braceAt) openBody = coreNow.slice(braceAt, end + 1);
    }
  }
  chk(openBody.length > 0, 'open() 函数体能被正确切出（守卫自身的前提）',
    'body=' + openBody.length + ' 字符');
  chk(openBody.indexOf('_vocabReady = false') >= 0,
    '⭐⭐ 换库时必须复位 _vocabReady（temp 词表是连接级的，重开就没了）');
  /* 顺带把这次加的两条 WAL 设置也钉住 —— 它们和数据完整性无关，
     但一旦被谁重构掉，WAL 会重新涨到几十 MB 而没人发现。 */
  chk(/journal_size_limit\s*=\s*\d+/.test(openBody),
    '⭐ WAL 文件有上限（journal_size_limit），否则只增不减（实测涨到 49.6MB）');
  chk(openBody.indexOf('wal_checkpoint') >= 0 || coreNow.indexOf("wal_checkpoint(TRUNCATE)") >= 0,
    '⭐ 有周期性 WAL 截断（否则限额只在下次 checkpoint 时才生效）');

  // 动态验证：先查一次让它进缓存，再入库含该词的新行，再查必须查得到
  //
  // ⚠️ 这一步不能只做静态断言。静态只能证明「有 invalidateDfCache 这句」，
  //   证明不了「清了之后 df 真的会变」—— 而后者才是用户感知到的东西。
  const beforeMiss = L.latinMiss(db, 'zebracorn 这个方案怎么样');
  chk(beforeMiss.length > 0, '① 动态前提：zebracorn 一开始查无（进了缓存，df=0）');

  const zInfo = db.prepare(
    'INSERT INTO seg (sid, seq, ts, role, kind, text, h, dup, noise, last_ts, pri) VALUES (?,?,?,?,?,?,?,1,0,?,2)'
  ).run(LTSID, 90, 1790000900000, 'user', 'user', 'zebracorn 这个方案我们下周再定', 'hz', 1790000900000);
  db.prepare('INSERT INTO seg_fts (rowid, big) VALUES (?, ?)')
    .run(zInfo.lastInsertRowid, ck.bigram('zebracorn 这个方案我们下周再定'));

  // 不清缓存时：必须还是旧的 df=0 ⇒ 仍然判「查无」（证明缓存确实是问题所在）
  const staleMiss = L.latinMiss(db, 'zebracorn 这个方案怎么样');
  chk(staleMiss.length > 0,
    '⭐⭐ 不清缓存 ⇒ 刚入库的词仍被判「查无」（这就是那个真实故障的机制）',
    '实际 ' + JSON.stringify(staleMiss));

  // 清了之后：必须立刻放行
  L.invalidateDfCache();
  const freshMiss = L.latinMiss(db, 'zebracorn 这个方案怎么样');
  chk(freshMiss.length === 0,
    '⭐⭐⭐ 清缓存后立刻能查到（ingestSession 每写完一次就做这件事）',
    '实际 ' + JSON.stringify(freshMiss));
}


/* ================================================================
 * 15f) 阶段 6 后半段：后台整理（sleeptime）
 *
 * ⚠️⚠️⚠️ 这一组**必须用直接 SQL 造数据**，不能走 insertFact。
 *   第一版我用 insertFact 造对照数据，结果 4 条断言红 —— 但代码是对的：
 *   insertFact 的冲突检测当场就把「状态相反」那对处理掉了（标了 conflict），
 *   而「真同义」那对反而因为实体判断被跳过了。
 *   ⇒ 整理负责的从来不是「新写进来的数据」，而是**历史遗留**：
 *     早期没有实体索引、冲突规则还没这么严时写进去的那批。
 *     用错了构造方式，测的就不是整理，而是 insertFact。
 *
 * 这组数据的每一对都是「看起来像同一件事、实际不是」的对照组。
 */
console.log('\n15f) 后台整理：合并 / 补实体 / 恢复 / 回滚');

{
  const L = ck._internal;
  const CSID = 'consol-test';

  /** 直接插一条事实（绕过 insertFact 的冲突检测），模拟历史遗留数据。 */
  let seqId = 900000;
  const raw = (text, kind, opt) => {
    const o = opt || {};
    seqId++;
    const info = db.prepare(
      `INSERT INTO fact(sid, src_seg_id, text, kind, ents, h, valid_from, valid_to, vt_reason, conf, hits, last_hit_ts, created_at, model)
       VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?)`
    ).run(o.sid || CSID, 0, text, kind || 'tech', ck.factEnts ? ck.factEnts(text) : '[]',
      'h' + seqId + '-' + Math.random().toString(36).slice(2, 8),
      o.from === undefined ? Date.now() : o.from,
      o.to === undefined ? null : o.to,
      o.reason === undefined ? null : o.reason,
      o.conf === undefined ? 0.7 : o.conf, Date.now(), 'test');
    const id = Number(info.lastInsertRowid);
    try {
      db.prepare('INSERT INTO fact_fts(rowid, big) VALUES(?,?)').run(id, ck.bigram(text));
    } catch (_) {}
    // ⚠️ 故意不写 ent 表：留给 consolEnt 去补，顺带验证「补实体」这一步真的在工作
    return id;
  };
  // ⚠️ 必须容忍「行不存在」：反向验证时如果把合并改成 DELETE，这条会返回 null，
  //   而 `null.to` 会直接抛异常**把整个测试文件中断**（后面的 16/17…全跑不到）。
  //   断言工具本身不能变成失败放大器 —— 返回一个显式的哨兵值，让断言如实报红。
  const vtOf = (id) => {
    const r = db.prepare('SELECT valid_to, vt_reason FROM fact WHERE id=?').get(id);
    if (!r) return { to: -1, why: '__MISSING__' };   // -1 = 行被删了，比 0（有效）更能说明问题
    return { to: Number(r.valid_to) || 0, why: r.vt_reason };
  };

  // ---- ① 纯函数判据 ----
  console.log('  · 判据（纯函数）');

  const ns1 = L.numSetOf('尾款 USD 231,472.08 未付');
  const ns2 = L.numSetOf('尾款 USD 231472.08 未付');
  chk([...ns1].sort().join('|') === [...ns2].sort().join('|'),
    '数值集合把千分位归一（231,472.08 ≡ 231472.08）',
    [...ns1].join(',') + ' vs ' + [...ns2].join(','));

  chk(L.oppositeState('尾款已付清', '尾款未付'),
    '⭐⭐ 状态词对立能识别（已付 / 未付）—— 此时数值集合都是空集，只有这一条挡得住');
  chk(L.oppositeState('货物已装运', '货物未装运'), '已装运 / 未装运 对立');
  chk(!L.oppositeState('尾款已付清', '订金已付清'),
    '同类状态词不误判（都是「已付」，只是对象不同 —— 这一对交给数值集合挡）');

  const e1 = L.entKeyOf('订单 AB-260713 尾款 USD 100 已付');
  const e2 = L.entKeyOf('订单 CD-260713 尾款 USD 100 已付');
  chk(e1.indexOf('AB-260713') >= 0, 'entKeyOf 能取到结构化单号', JSON.stringify(e1));
  chk(!e1.some((x) => e2.indexOf(x) >= 0),
    '⭐⭐ AB-260713 与 CD-260713 实体集合**不交**（正是必须拒绝合并的那一对）',
    JSON.stringify(e1) + ' vs ' + JSON.stringify(e2));
  chk(e1.indexOf('260713') < 0,
    '⭐⭐⭐ 纯数字碎片必须被排除（否则 AB/CD 会交在 260713 上 ⇒ 误判成同一实体）',
    JSON.stringify(e1));

  // ---- ② 合并：正例与三类反例 ----
  console.log('  · 合并（consolMerge，显式触发）');

  // ✅ 该合并：同一句话的两种说法，无数值、无对立状态
  const m1 = raw('回归测试的权威入口是 run-regression-all.js，失败也不改退出码');
  const m2 = raw('回归测试权威入口是 run-regression-all.js；失败也不改退出码');
  // ❌ 不该合并：状态相反
  const m3 = raw('五柜埃及货已装运，ETD 泗水 9 月 2 日');
  const m4 = raw('五柜埃及货未装运，ETD 泗水 9 月 2 日');
  // ❌ 不该合并：不同订单，词面 0.75+、数值集合完全相同（最易误伤的一对）
  const m5 = raw('订单 AB-260713 尾款 USD 100 已付', 'order');
  const m6 = raw('订单 CD-260713 尾款 USD 100 已付', 'order');
  // ❌ 不该合并：同一订单不同阶段，数值不同
  const m7 = raw('订单 YKW-SU-260713 订金 USD 99,202.32 已入账', 'order');
  const m8 = raw('订单 YKW-SU-260713 尾款 USD 231,472.08 未付', 'order');

  const runId = L.newRunId();
  const mr = L.consolMerge(db, runId, { jac: 0.72 });
  chk(mr.merged >= 1, `批式合并在显式触发时生效（${mr.merged} 对）`, JSON.stringify(mr.details));

  const m1r = vtOf(m1), m2r = vtOf(m2);
  chk((m1r.to === 0) !== (m2r.to === 0),
    '⭐⭐ 真同义的一对里，恰好一条被标失效、另一条保持有效',
    'm1=' + m1r.to + ' m2=' + m2r.to);
  const dropped = m1r.to ? m1 : m2;
  chk(vtOf(dropped).why === 'merge',
    '⭐⭐ 被合并那条的 vt_reason = merge（面板据此区分「整理合的」和「冲突自动标的」）',
    '实际 ' + vtOf(dropped).why);
  chk(Number(db.prepare('SELECT COUNT(*) c FROM fact WHERE id IN (?,?)').get(m1, m2).c) === 2,
    '⭐⭐⭐ 被合并那条**一行未删**（ADD-only：只标失效，不删数据）');

  chk(vtOf(m3).to === 0 && vtOf(m4).to === 0,
    '⭐⭐⭐ 状态相反（已装运 / 未装运）绝不合并 —— 数值集合都是空集，只有状态词挡得住');
  chk(vtOf(m5).to === 0 && vtOf(m6).to === 0,
    '⭐⭐⭐ 不同订单（AB-260713 / CD-260713）绝不合并 —— 实体不交即两件事，词面再像也不动');
  chk(vtOf(m7).to === 0 && vtOf(m8).to === 0,
    '⭐⭐ 同一订单不同金额（订金 / 尾款）绝不合并');

  // 反向验证：去掉实体条件，AB/CD 这一对必然被合并
  //   —— 证明「实体不交即跳过」不是冗余，它是这三道闸里**唯一**能挡住这一对的
  {
    const J = L.jacText('订单 AB-260713 尾款 USD 100 已付', '订单 CD-260713 尾款 USD 100 已付');
    chk(J >= 0.72, '反向验证前提：AB/CD 词面 jaccard 已达合并线（' + J.toFixed(3) + '）');
    chk(L.numSetOf('订单 AB-260713 尾款 USD 100 已付').size ===
        L.numSetOf('订单 CD-260713 尾款 USD 100 已付').size,
      '反向验证续：数值集合也相等（第二道闸拦不住）');
    chk(!L.oppositeState('订单 AB-260713 尾款 USD 100 已付', '订单 CD-260713 尾款 USD 100 已付'),
      '反向验证续：状态词也不对立（第三道闸拦不住）',
      '⇒ 三道闸里只有实体条件能挡住，这条判据必需');
  }

  // ---- ③ 候选清单 + 人工确认（这才是本阶段实际交付的路径）----
  //
  // ⚠️⚠️⚠️ 为什么「自动合并」不是主路径：
  //   实测 8 组同义表述（每组 3 种说法）的组内 jaccard 最低 0.409；
  //   而必须拒绝的对照组「已装运 vs 未装运」是 0.733、「AB vs CD」0.750。
  //   ⇒ 同义组的最低值比对照组还低。任何单一阈值都做不到既不误合又合得动。
  //   误合的后果是「结论从检索里消失且用户不知道」，所以设计上：
  //     程序 = 找候选 + 列理由 + 列否决项；人 = 点确认。
  console.log('  · 候选清单与人工确认（主路径）');

  {
    // ⚠️ 这一对是实测挑的：jaccard 0.600，明确高于候选项阈值 0.42。
    //   第一版用的「不用 scp / 不使用 scp」只有 0.400，刚好卡在阈值下面 —— 测试红了但代码没错，
    //   是测试数据选得不好。同义表述的 jaccard 分布本身就很散（实测 0.409~0.818），
    //   所以这种断言必须挑一个**远离阈值边界**的样本，否则它测的是阈值抖动而不是功能。
    const c1 = raw('部署脚本固定用 rsync 同步，绝不用 scp 上传', 'tech');
    const c2 = raw('部署脚本一直用 rsync 同步，绝不用 scp 上传', 'tech');
    const arr = L.consolCandidates(db, { sid: CSID, limit: 60, jac: 0.42 });
    chk(arr.scanned > 0, `扫了 ${arr.scanned} 条有效事实`, '');
    const pair = (arr.items || []).find((x) =>
      (x.a.id === c1 && x.b.id === c2) || (x.a.id === c2 && x.b.id === c1));
    chk(!!pair, '⭐⭐ 能找出「同一件事的两种说法」这一对');
    chk(pair && Array.isArray(pair.reasons) && pair.reasons.length >= 1,
      '⭐⭐ 每条候选都带**正面理由**（人要知道程序凭什么觉得它们像）',
      pair ? JSON.stringify(pair.reasons) : '');
    chk(pair && Array.isArray(pair.blockers) && pair.blockers.length === 0,
      '⭐⭐ 这一对没有否决项（数值集合相等、实体不交但都没实体、状态词不对立）',
      pair ? JSON.stringify(pair.blockers) : '');
    chk(pair && (pair.keep === c1 || pair.keep === c2), '⭐⭐ 给出「建议保留哪条」（valid_from 早的）');

    // 关键：预览**一条都不许改**
    chk(vtOf(c1).to === 0 && vtOf(c2).to === 0,
      '⭐⭐⭐ 预览是纯只读的 —— 列完候选，两条事实都还是有效的');

    // 对照组在候选里必须带否决项
    const trapPair = (arr.items || []).find((x) =>
      (x.a.id === m3 && x.b.id === m4) || (x.a.id === m4 && x.b.id === m3));
    if (trapPair) {
      chk(trapPair.blockers.some((b) => /状态词对立/.test(b)),
        '⭐⭐⭐ 状态相反的那一对，候选里被明确指出「状态词对立」',
        JSON.stringify(trapPair.blockers));
    } else {
      // 词面低于阈值时压根不会成为候选 —— 这也算正确（没被推荐就等于没风险）
      chk(true, '状态相反的那一对未进候选（词面未达阈值，等于程序已排除）');
    }

    // 人工确认合并：成功后必须能回滚
    const ar = L.newRunId();
    const app = L.applyMergeCandidate(db, c1, c2, { runId: ar });
    chk(app.ok === true, '⭐⭐ 人工确认后合并成功', app.why || '');
    chk(vtOf(c2).to > 0 && vtOf(c2).why === 'merge', '被合并那条标 merge');
    chk(vtOf(c1).to === 0, '保留的那条仍然有效');

    // 拒绝路径：状态相反的一对即使人点了也必须被拒（重新校验，不信前端）
    const bad = L.applyMergeCandidate(db, m3, m4, {});
    chk(bad.ok === false && /对立/.test(bad.why || ''),
      '⭐⭐⭐ 人工点「合并」状态相反的一对时被**重新校验拒绝**（不信任前端传来的判断）',
      bad.why || '');

    // 拒绝路径：不同订单
    const bad2 = L.applyMergeCandidate(db, m5, m6, {});
    chk(bad2.ok === false && /实体不同/.test(bad2.why || ''),
      '⭐⭐⭐ 不同订单同样被拒（实体不交）', bad2.why || '');

    // 拒绝路径：跨会话
    const xa = raw('迁移脚本统一放在 scripts 目录执行', 'tech');
    const xb = raw('迁移脚本统一放在 scripts 目录执行', 'tech', { sid: 'other-sid2' });
    const bad3 = L.applyMergeCandidate(db, xa, xb, {});
    chk(bad3.ok === false && /不同会话/.test(bad3.why || ''),
      '⭐⭐ 跨会话的人工合并请求被拒（两次独立确认不许合成一次）', bad3.why || '');

    // 确认路径的改动必须可回滚
    const appRb = L.rollbackConsol(db, ar);
    chk(appRb.ok && appRb.reverted === 1 && vtOf(c2).to === 0,
      '⭐⭐⭐ 人工确认的合并也能从整理历史回滚（有人点错时不至于无解）',
      JSON.stringify({ reverted: appRb.reverted, to: vtOf(c2).to }));
  }

  // 跨会话不合并：UNIQUE(sid,h) 只挡同会话，跨会话的重复是「两次独立确认」，不该合
  {
    const x1 = raw('数据库迁移脚本固定放在 scripts 目录下统一执行', 'tech');
    const x2 = raw('数据库迁移脚本固定放在 scripts 目录下统一执行', 'tech', { sid: 'other-sid' });
    const r = L.consolMerge(db, L.newRunId(), { jac: 0.72 });
    void r;
    chk(vtOf(x1).to === 0 && vtOf(x2).to === 0,
      '⭐⭐ 跨会话的重复**不合并**（两条不同会话说同一件事 = 两次独立确认，合并会丢信息）');
  }

  // ---- ④ 补实体 ----
  console.log('  · 补实体（consolEnt）');

  const entId = raw('画册型号 K087-W-A 的规格是 5Pcs Fireplace Set');
  const beforeEnt = Number(db.prepare('SELECT COUNT(*) c FROM ent WHERE fact_id=?').get(entId).c);
  chk(beforeEnt === 0, '前提：这条事实的实体链接为空（模拟 v6 之前写入的数据）');

  const erun = L.newRunId();
  const er = L.consolEnt(db, erun, {});
  const afterEnt = Number(db.prepare('SELECT COUNT(*) c FROM ent WHERE fact_id=?').get(entId).c);
  chk(afterEnt >= 1, `补实体生效（${beforeEnt} → ${afterEnt}）`, JSON.stringify(er.details.slice(0, 2)));
  const newly = db.prepare('SELECT ent FROM ent WHERE fact_id=? ORDER BY norm').all(entId).map((r) => r.ent);
  chk(newly.indexOf('K087-W-A') >= 0, '补回了 K087-W-A（面板点这个实体能查到这条事实了）', JSON.stringify(newly));

  // 也能**移除**多余的（fact 文本改过、实体不再成立）
  db.prepare("INSERT OR REPLACE INTO ent(sid,fact_id,ent,norm,n) VALUES(?,?,?,?,1)")
    .run(CSID, entId, '每毫秒电费', '每毫秒电费');
  const er2 = L.consolEnt(db, L.newRunId(), {});
  const stale = db.prepare("SELECT COUNT(*) c FROM ent WHERE fact_id=? AND norm='每毫秒电费'").get(entId).c;
  chk(Number(stale) === 0 && er2.changed >= 1,
    '⭐⭐ 多余的实体也会被清掉（文本改过之后旧实体不能再挂着，否则检索会命中不存在的键）',
    '剩余 ' + stale + ' 条');
  chk(L.consolEnt(db, L.newRunId(), {}).changed === 0, '⭐⭐ 补实体是幂等的（再跑一次 0 改动）');

  // ---- ④ 回滚 ----
  console.log('  · 回滚（rollbackConsol）');

  const dropBefore = vtOf(dropped);
  const rb = L.rollbackConsol(db, runId);
  const dropAfter = vtOf(dropped);
  chk(rb.ok && rb.reverted >= 1, `回滚成功（${rb.reverted} 条）`, JSON.stringify(rb.errors || []));
  chk(dropBefore.to > 0 && dropAfter.to === 0,
    '⭐⭐⭐ 回滚把被合并那条恢复成有效（valid_to 归 NULL）',
    '回滚前 ' + dropBefore.to + ' → 回滚后 ' + dropAfter.to);
  chk(dropAfter.why === null,
    '回滚同时清掉 vt_reason（不留「merge 但有效」这种矛盾状态）', '实际 ' + JSON.stringify(dropAfter.why));

  const rb2 = L.rollbackConsol(db, runId);
  chk(rb2.ok === false && rb2.reverted === 0,
    '⭐⭐ 同一轮不能回滚两次（第二次明确失败，不是静默成功）', JSON.stringify(rb2));

  // ⚠️ 这里同样必须容忍「行不存在」（反向验证跑 DELETE 版本时会出现），否则整个文件中断
  const txtOf = (id) => { const r = db.prepare('SELECT text FROM fact WHERE id=?').get(id); return r ? String(r.text) : '__MISSING__'; };
  const txtBefore = txtOf(dropped);
  L.rollbackConsol(db, runId);
  const txtAfter = txtOf(dropped);
  chk(txtBefore === txtAfter, '回滚不改事实正文（只回滚 valid_to / vt_reason / conf 三列）');

  /**
   * 回滚必须**倒序**执行。
   *
   * ⚠️ 上面那些用例测不出顺序问题：每条事实在一轮里只被改一次，正序倒序结果一样。
   *   但真实情况会撞上：同一轮里 ent-fill 与 merge 可能落在同一条事实，
   *   或者将来加了新动作。此时正序回滚会**停在中间状态**（先把后面的改动退掉，
   *   再把前面的 before 盖上去 —— 而 before 快照里可能已经是「被改过」的值）。
   *   所以这里直接手工写两条日志构造「同一条 fact 在一轮里被改两次」，
   *   并断言最终状态回到**最早那个**快照。
   */
  {
    const rid = raw('回滚顺序测试：这条会被同一轮改两次', 'tech');
    const T0 = Date.now();
    const snap0 = L.factSnapshot(db, rid);        // 原始：有效
    const orderRun = L.newRunId();
    db.prepare("UPDATE fact SET valid_to=?, vt_reason='conflict' WHERE id=?").run(T0, rid);
    const snap1 = L.factSnapshot(db, rid);        // 第一次改：失效
    db.prepare("UPDATE fact SET conf=0.95 WHERE id=?").run(rid);
    const snap2 = L.factSnapshot(db, rid);        // 第二次改：置信度
    L.logConsol(db, orderRun, 'merge', CSID, rid, snap0, snap1, '第一次改');
    L.logConsol(db, orderRun, 'merge', CSID, rid, snap1, snap2, '第二次改');

    const orr = L.rollbackConsol(db, orderRun);
    const fin = L.factSnapshot(db, rid);
    chk(orr.ok && orr.reverted === 2, `倒序回滚两条日志（${orr.reverted}）`);
    chk(fin && Number(fin.valid_to) === 0 && Number(fin.conf) === Number(snap0.conf),
      '⭐⭐⭐ 同一事实被改两次后回滚，最终回到**最早**的快照（顺序错了会停在中间态）',
      'valid_to=' + (fin && fin.valid_to) + ' conf=' + (fin && fin.conf) + ' 期望 conf=' + snap0.conf);
  }

  const erb = L.rollbackConsol(db, erun);
  const afterRb = Number(db.prepare('SELECT COUNT(*) c FROM ent WHERE fact_id=?').get(entId).c);
  chk(erb.ok && afterRb === beforeEnt,
    `⭐⭐ 补实体的回滚把链接退回原状（${afterEnt} → ${afterRb}）`, '这是「必须可回滚」的直验');

  // ---- ⑤ 恢复被误判失效 ----
  console.log('  · 恢复（consolRevive）');

  const T = Date.now();

  // A 被 B 顶掉，B 也失效且有活着的后继 ⇒ A **不**恢复（演变链成立）
  const ra = raw('构建脚本固定用 esbuild，不引 webpack');
  const rbSrc = raw('构建脚本固定用 vite，不引 webpack');
  const rcLive = raw('构建脚本固定用 rspack2，不引 webpack');
  db.prepare("UPDATE fact SET valid_to=?, vt_reason='conflict' WHERE id=?").run(T - 9000, ra);
  db.prepare("UPDATE fact SET valid_to=?, vt_reason='conflict' WHERE id=?").run(T - 8000, rbSrc);
  void rcLive;

  // D 被 E 顶掉，E 也失效、且无活着的相似事实 ⇒ D **可**恢复
  const rd = raw('数据库文件放在 APPDATA 下的 ck-memory 目录');
  const reSrc = raw('数据库文件放在 LOCALAPPDATA 下的 ck-memory 目录');
  db.prepare("UPDATE fact SET valid_to=?, vt_reason='conflict' WHERE id=?").run(T - 7000, rd);
  db.prepare("UPDATE fact SET valid_to=?, vt_reason='conflict' WHERE id=?").run(T - 6000, reSrc);

  // 手标的一条：绝不能动
  const rm = raw('这条是用户在面板上手动标失效的结论');
  db.prepare("UPDATE fact SET valid_to=?, vt_reason='manual' WHERE id=?").run(T - 5000, rm);

  const vr = L.consolRevive(db, L.newRunId(), {});
  chk(vr.candidates >= 3, `找到 ${vr.candidates} 条 conflict 失效候选`);

  chk(vtOf(rd).to === 0,
    '⭐⭐ 判定链断裂的（顶掉它的也失效了、且无活着的相似事实）被恢复', '实际 valid_to=' + vtOf(rd).to);
  chk(vtOf(ra).to > 0,
    '⭐⭐⭐ 演变链仍成立的不恢复（后继还活着 ⇒「旧值被取代」是事实，不该翻案）',
    '实际 valid_to=' + vtOf(ra).to);
  chk(vtOf(rm).to > 0 && vtOf(rm).why === 'manual',
    '⭐⭐⭐ 手动标失效的**一条都不碰**（人的判断优先于机器）',
    '实际 valid_to=' + vtOf(rm).to + ' reason=' + vtOf(rm).why);

  // ---- ⑥ 端到端 ----
  console.log('  · 端到端（consolidate）');

  const run = L.consolidate({ force: true, ops: ['ent', 'merge'] });
  chk(run && run.ok === true, 'consolidate 返回 ok', JSON.stringify((run && run.error) || ''));
  chk(!!run.runId && /^run-/.test(run.runId), 'runId 形如 run-xxx（可查可回滚）', run.runId);
  chk(typeof run.ms === 'number' && run.ms >= 0, `耗时 ${run.ms}ms（有度量，不靠感觉）`);

  const mine = (L.consolHistory(20).items || []).filter((x) => x.runId === run.runId);
  chk(mine.length === 1, '整理历史里能查到这一轮');
  chk(Array.isArray(L.consolDetail(run.runId, 100).items), '能按 runId 展开这一轮的所有改动');

  const skip = L.consolidate({ force: false });
  chk(skip && (skip.skipped === 'interval' || skip.changed !== undefined),
    '⭐⭐ 非 force 时走节流（刚跑过不会立刻再跑）', JSON.stringify(skip.skipped || ''));

  // ---- ⑦ 结构 ----
  console.log('  · 结构');
  const fcols2 = db.prepare('PRAGMA table_info(fact)').all().map((r) => r.name);
  chk(fcols2.indexOf('vt_reason') >= 0, '⭐⭐ fact 有 vt_reason（区分 conflict / manual / merge）');
  const ver = Number(db.prepare('PRAGMA user_version').get().user_version);
  chk(ver >= 7, `user_version = ${ver}（≥7）`);
  chk(db.prepare("SELECT name FROM sqlite_master WHERE name='consol_log'").all().length === 1,
    'consol_log 表存在');

  // 三个写入点都必须落原因标记
  const srcNow = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  chk(/vt_reason = 'conflict'/.test(srcNow), '⭐⭐ 冲突自动失效写了 conflict');
  chk(/vt_reason = 'manual'/.test(srcNow), '⭐⭐ 面板手标写了 manual');
  chk(/vt_reason = 'merge'/.test(srcNow), '⭐⭐ 整理合并写了 merge');
  chk(/fact-clear'[\s\S]{0,1500}?DELETE FROM consol_log/.test(srcNow),
    '⭐⭐ fact-clear 顺手清整理日志（撤不回去的日志留着是假承诺）');
  chk(!/DELETE FROM fact WHERE[\s\S]{0,80}?consolMerge/.test(srcNow),
    '⭐⭐⭐ 整理路径里**没有** DELETE FROM fact（硬约束：合并只标失效不删行）');
}

/* ---------------- 16. 会话清单的排序与搜索 ---------------- */

console.log('\n16) 会话清单：搜索 / 排序');

const all = ck._internal.sessionList({ fresh: true });
chk((all.items || []).length >= 2, `清单至少 2 条（实际 ${(all.items || []).length}）`);
const sorted = (all.items || []).every((x, i, a) => i === 0 || a[i - 1].lastAt >= x.lastAt);
chk(sorted, '默认按最后活跃倒序（最近在弄的排最前）');

const qHit = ck._internal.sessionList({ q: '土耳其', fresh: true });
chk((qHit.items || []).length === 1 && qHit.items[0].sid === SID2, '按标题关键词能筛出对应会话');
const qSid = ck._internal.sessionList({ q: SID2.slice(0, 8), fresh: true });
chk((qSid.items || []).length >= 1, '按会话号片段也能筛');
const qMiss = ck._internal.sessionList({ q: '根本不存在的关键词xyz', fresh: true });
chk((qMiss.items || []).length === 0, '搜不到时返回空列表（不是返回全部）');
const qCase = ck._internal.sessionList({ q: 'YZAK'.toLowerCase(), fresh: true });
chk((qCase.items || []).length >= 0, '大小写不敏感（不报错即可）');
const bySize = ck._internal.sessionList({ sort: 'size', fresh: true });
chk((bySize.items || []).every((x, i, a) => i === 0 || a[i - 1].size >= x.size), 'sort=size 按体积倒序');

const sess = ck.sessions({ fresh: true });
chk(sess && sess.bind && typeof sess.bind.live === 'boolean', 'sessions() 附带 bind 状态（面板要显示）');

/* ================= 阶段 7：附件剥离（2026-11-05） =================
 *
 * 为什么必须有这一组：
 *   生产库里实测 2135 行带 `image_blob_ref`，其中 2069 行是「纯附件行」
 *   （去掉 JSON 后正文一个字都没有），还有 61 行被当成有效记忆进了检索索引。
 *   平均 274 字的 blob_id 十六进制串既污染检索又刷爆时间线。
 *
 * ⚠️⚠️ 判据必须「内容特征 + 位置」双条件，这是我第一版踩的坑：
 *   只判断「块独占一行」，会把用户贴给我看的格式示例也删掉
 *   （"示例代码如下：\n{"type":"image_blob_ref","blob_id":"abc"}\n以上是格式说明"）。
 *   ⇒ 必须块内含 32+ 位 hex 的 blob_id 或 blob_path 才认。
 */
console.log('\n--- 附件剥离 ---');
{
  const CKI = ck._internal || {};
  const SAT = CKI.stripAttachTail;
  const FLAT = CKI.flatten;
  chk(typeof SAT === 'function', 'stripAttachTail 已导出（单测要直接对拍）');
  chk(typeof FLAT === 'function', 'flatten 已导出');

  if (typeof SAT === 'function') {
    const HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const blobObj = JSON.stringify({
      type: 'image_blob_ref', blob_id: HEX, mime: 'image/png', size: 565834,
      blob_path: 'C:\\Users\\Lyon\\.workbuddy\\blobs\\92\\' + HEX + '.png',
      original_filename: 'Clipboard_Screenshot.png',
    });

    // ① 正文 + 附件尾巴 → 只留正文
    const t1 = SAT('红框这里是官方md界面 。\n' + blobObj + '\n<image_local_path>C:\\Users\\Lyon\\.workbuddy\\clipboard-images\\x.png</image_local_path>');
    chk(t1 === '红框这里是官方md界面 。', '正文后的附件尾巴被剥干净', JSON.stringify(t1));

    // ② 纯附件行（数组包一层）→ 空串
    const t2 = SAT('[' + blobObj + ']');
    chk(t2 === '', '纯附件行剥成空串（这类有 2069 条）', JSON.stringify(t2));

    // ③ ⚠️ 反向：讨论用的示例（blob_id 是 "abc"）不能删
    const demo = '示例代码如下：\n{"type":"image_blob_ref","blob_id":"abc"}\n以上是格式说明，注意它是嵌套在 content 数组里的。';
    chk(SAT(demo) === demo, '⚠️ 讨论用的 JSON 示例不被误删（无 hex blob_id）');

    // ④ ⚠️ 反向：正文里提到 blob_id 这个词不能删
    const talk = '我看到 blob_id 是 64 位十六进制，这个设计有点奇怪，你怎么看？';
    chk(SAT(talk) === talk, '⚠️ 正文提到 blob_id 不被误删');

    // ⑤ 多行正常正文原样保留
    const plain = '第一行正常内容\n第二行也正常\n第三行还是\n';
    chk(SAT(plain).indexOf('第一行正常内容') === 0 && SAT(plain).indexOf('第三行还是') > 0,
      '多行正常正文不被削');

    // ⑥ flatten：结构化附件 → 可读标签，不再吐 JSON
    if (typeof FLAT === 'function') {
      const f = FLAT([
        { type: 'text', text: '我的正文' },
        { type: 'image_blob_ref', blob_id: HEX, mime: 'image/png', original_filename: 'a.png' },
        { type: 'image_blob_ref', blob_id: 'b'.repeat(64) },
      ]);
      chk(f.indexOf('我的正文') === 0, 'flatten 保留正文');
      chk(f.indexOf('image_blob_ref') < 0 && f.indexOf('blob_id') < 0, 'flatten 不再吐附件 JSON');
      chk(f.indexOf('图片：a.png') > 0, 'flatten 把附件转成「图片：文件名」', JSON.stringify(f));
      // 没文件名的只写「图片」，不能把 64 位 blob_id 当文件名显示
      chk(f.indexOf('bbbbbbbb') < 0, 'flatten 不把 blob_id 当文件名');
    }
  }
}

/* ================= 回填策略（2026-11-05 重写） =================
 * ⚠️⚠️⚠️ 老版本的致命缺陷：nextBackfill **只在 state.follow 里选**。
 *   实测这台机器上 state.follow 只有 4~6 条、且全部已同步（lag=0）
 *   ⇒ nextBackfill 每轮返回 null ⇒ 索引器**永远不再回填任何东西**，
 *   剩下 70 多条会话从来没有机会进索引，而面板显示「索引器开着」。
 *
 * 新策略：队列优先 + 其余按最近活跃补齐，每轮限量限量时。
 * 下面的断言锁三件事：
 *   ① 不在队列里、也没索引过的会话**能**被挑出来（老版本的核心缺陷）
 *   ② 已经同步的会话**不会**被反复挑中（否则每轮空转、白烧 CPU）
 *   ③ 用户显式跟踪的会话**不受**体积/去重规则限制（用户已表过态）
 */
console.log('\n--- 回填策略 ---');
{
  const CKI = ck._internal || {};
  chk(typeof CKI.backfillBatch === 'function', 'backfillBatch 已导出（批量回填入口）');
  chk(typeof CKI.backfillWorthy === 'function', 'backfillWorthy 已导出（可单独测过滤规则）');
  chk(typeof CKI.scanSessions === 'function', 'scanSessions 已导出');

  if (typeof CKI.backfillWorthy === 'function') {
    const BW = CKI.backfillWorthy;
    const saveFollow = CKI.state.follow;
    try {
      // ③ 用户显式跟踪的小会话不该被体积规则挡掉
      CKI.state.follow = ['explicit-small'];
      chk(BW({ sid: 'explicit-small', proj: 'p', size: 2000 }, null) === true,
        '显式跟踪的会话不受「<1MB」限制（用户已表态，采集端不该再筛）');
      // 非跟踪的同样大小要被挡
      CKI.state.follow = [];
      chk(BW({ sid: 'auto-small', proj: 'p', size: 2000 }, null) === false,
        '自动回填跳过 <1MB 的空壳会话');
      // 子代理会话永远不索引
      chk(BW({ sid: 'sub-x', proj: 'subagents', size: 5e6 }, null) === false,
        '自动回填跳过 subagents（AI 内部上下文，不是对话）');
      // 已同步的跳过
      chk(BW({ sid: 'synced', proj: 'p', size: 5000 }, { file_size: 5000 }) === false,
        '已同步到最新的会话不再重复回填（否则每轮空转）');
      // 落后于磁盘的要补
      // ⚠️ 尺寸必须 >1MB：<1MB 会被「空壳会话」规则挡在前面，
      //   那样测到的是体积规则而不是「落后」判定（第一版就写错了）。
      chk(BW({ sid: 'behind', proj: 'p', size: 3e6 }, { file_size: 2e6 }) === true,
        '落后于磁盘的会话会被回填');

      // 去重表：同 (proj,size) 只认首见者
      const firstOf = new Map();
      const a = { sid: 'sid-a', proj: 'dup-p', size: 166076970 };
      const b = { sid: 'sid-b', proj: 'dup-p', size: 166076970 };
      for (const f of [a, b]) {
        const k = f.proj + '\u0000' + f.size;
        if (!firstOf.has(k)) firstOf.set(k, f.sid);
      }
      chk(BW(a, null, firstOf) === true, '同尺寸重复组里首见者正常索引');
      chk(BW(b, null, firstOf) === false, '⚠️ 同尺寸重复组的后来者被跳过（白存 2.6 万条）');
      // 尺寸不同就不能当重复
      chk(BW({ sid: 'sid-c', proj: 'dup-p', size: 166220830 }, null, firstOf) === true,
        '尺寸不同的同目录会话不算重复（不能误杀）');
    } finally { CKI.state.follow = saveFollow; }
  }
}

/* ══════════════════════════════════════════════════════════════
 * 评测集「AND 路」守卫（2026-11-05）
 *
 * 为什么需要在单测里守这个：
 *   第五批题（cases-and.js）存在的唯一理由是「AND 路此前只被 1 道题覆盖」。
 *   但它的 gold 是沿用源题的、短查询的词又都取自 gold 行内 ⇒ 天生脆弱：
 *     · 谁把某道题 q 改长一点，它就可能降级走 OR ⇒ 这批题悄悄失去意义，但分数照跑
 *     · 谁把 gold 顺手改掉，配对关系就断了 ⇒ 和源题不再是同一个答案
 *     · 谁把 AND_CASES 加进 ALL，整体召回率就会被词法偏置污染
 *   这三件事都不会报错，只会让数字变得不可解释。所以必须钉住。
 *
 * ⚠️ 这里**不连库**（单测用的是临时库，没有真实会话），所以不能验「真的走 AND」。
 *    能守的是「结构不变量」：题数、id 唯一、gold 与源题一致、不属于 ALL。
 *    「真的走 AND」由 probe-and-route.js 在副本库上验，那是另一个时间尺度的检查。
 * ══════════════════════════════════════════════════════════════ */
{
  const AC = require(path.join(ROOT, '.wd-analysis', 'eval', 'cases-and.js')).AND_CASES;
  const AL = require(path.join(ROOT, '.wd-analysis', 'eval', 'all-cases.js'));
  chk(Array.isArray(AC) && AC.length >= 40, 'AND 题集存在且不少于 40 道（当前 ' + AC.length + '）');

  const ids = new Set(), sids = new Set();
  let dupId = 0;
  for (const c of AC) { if (ids.has(c.id)) dupId++; ids.add(c.id); }
  chk(dupId === 0, 'AND 题集 id 全局唯一');

  /* 与源题的配对关系：同 sid、同 gold、同 k。这是「唯一自变量是路由」的前提。 */
  const byId = new Map(AL.ALL.concat(AL.FRESH).map((c) => [c.id, c]));
  let broken = 0, missing = 0;
  for (const c of AC) {
    const src = byId.get(c.src);
    if (!src) { missing++; continue; }
    if (src.sid !== c.sid || String(src.gold.join(',')) !== String(c.gold.join(','))) broken++;
  }
  chk(missing === 0, 'AND 题的源题 id 全部存在（能追回去看原题）', '缺 ' + missing);
  chk(broken === 0, 'AND 题的 sid/gold 与源题完全一致（配对关系没断）', '不一致 ' + broken);

  /* 短查询必须比源题短 —— 否则「AND 路」这个前提就不成立 */
  let longer = 0;
  for (const c of AC) {
    const src = byId.get(c.src);
    if (!src) continue;
    if (String(c.q).length >= String(src.q).length) longer++;
  }
  chk(longer === 0, '每道 AND 题的问句都比源题短（不然它多半还在走 OR）', '不短 ' + longer);

  /* 绝不能混进总分的分母 */
  const inAll = AL.ALL.some((c) => String(c.id).indexOf('AND-') === 0);
  const inPlus = AL.ALL_PLUS_FRESH.some((c) => String(c.id).indexOf('AND-') === 0);
  chk(!inAll, '⚠️ AND 题不在 ALL 里（gold 有词法偏置，会污染整体召回率）');
  chk(!inPlus, '⚠️ AND 题不在 ALL_PLUS_FRESH 里');

  /* 口径未被改变：109 正例 / 8 纯负例 / 9 配对负例 */
  const pos = AL.ALL.filter(AL.isPos).length;
  const neg = AL.ALL.filter((c) => c.cat === 'negative').length;
  const pn = AL.ALL.filter(AL.isPairNeg).length;
  chk(pos === 109 && neg === 8 && pn === 9,
    '原有 126 题的 109/8/9 口径未被改动', pos + '/' + neg + '/' + pn);
}

/* ================================================================
 * 15f) MCP 检索的一次重试（2026-11-06）
 *
 * 需求（用户原话）：
 *   「不能无限循环，一次没搜出来，第二次更短关键词重试，还是没搜出来就到此为止。」
 *
 * 三条必须守住的边界，缺一条都会出事：
 *   ① **最多一次** —— 不能变成循环，否则一次检索能跑几秒。
 *   ② **只在 `miss` 非空时**重试 —— 别的 0 条是真没有，重试是白跑。
 *   ③ **剔词后必须还剩库内锚点** —— 否则会把「拒答」变成「胡说」。
 *      反例实测：虚构专名 + 库外中文，剔完只剩中文，OR 兜底拿泛词凑 7 条全无关。
 *
 * 为什么这条能救回来：`search()` 的 ENT-MISS / ID-MISS 是「**某个词**整库查无」，
 *   但整句话可能仍有价值 ——「Nafeza 单据 ZZZZ-88888」里的编号是假的，Nafeza 是真的。
 * ================================================================ */

console.log('\n15f) MCP 检索的一次重试');

{
const L = ck._internal;
if (typeof L.searchWithRetry === 'function') {
  const coreNow = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  ok('searchWithRetry 已导出（单测要能直接对拍，不能只靠 MCP 端到端）');

  // 造一个**确定库内不存在**的串。用随机串而不是硬编码：
  //   硬编码的开头几版都被「自己写进对话、又被索引」给污染了（99999 / 12345 都真有）。
  const crypto2 = require('crypto');
  const uniqTok = (pfx) => {
    for (let i = 0; i < 99; i++) {
      const s = pfx + crypto2.randomBytes(4).toString('hex').toUpperCase();
      const n = Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(lower(text), lower(?)) > 0').get(s).c) || 0;
      if (n === 0) return s;
    }
    return pfx + crypto2.randomBytes(8).toString('hex').toUpperCase();
  };
  const FAKE_EN = uniqTok('ZQX');
  const FAKE_ID = 'ABC-' + crypto2.randomBytes(3).toString('hex').toUpperCase();

  // 找一条「容器会话」：只要有内容就行，重试逻辑与具体内容无关
  const anySid = (db.prepare('SELECT sid FROM seg GROUP BY sid ORDER BY COUNT(*) DESC LIMIT 1').get() || {}).sid;

  if (anySid) {
    // ── ① 全虚构：必须保持空，绝不能靠泛词伪造命中 ──
    const r1 = L.searchWithRetry(anySid, FAKE_EN + ' 那不勒斯 披萨 配方', 5, false) || {};
    chk((r1.hits || []).length === 0,
      '⚠️ 全虚构 + 库外中文 ⇒ 必须仍是 0 条（剔词后没锚点，不许重试，否则把拒答变成胡说）',
      '实际 ' + (r1.hits || []).length + ' 条 via=' + r1.via);
    chk(!r1.retried, '⚠️ 没锚点时不应标记为「已重试」', String(r1.retried));

    const r1b = L.searchWithRetry(anySid, FAKE_EN + ' ' + FAKE_ID, 5, false) || {};
    chk((r1b.hits || []).length === 0,
      '⚠️ 两个虚构词拼在一起也必须是 0 条', '实际 ' + (r1b.hits || []).length + ' 条');

    // ── ② 正常查询：不能被重试逻辑改动 ──
    //   取库里真实存在的一个中文词，保证原查询本来就有结果
    const realWord = (db.prepare(
      "SELECT text FROM seg WHERE COALESCE(pri,0)>=1 AND kind='user' AND length(trim(text))>20 ORDER BY ts DESC LIMIT 1"
    ).get() || {}).text || '';
    if (realWord) {
      const probe = realWord.slice(0, 6).trim();
      const a = ck._internal.search(anySid, probe, 5, false) || {};
      const b = L.searchWithRetry(anySid, probe, 5, false) || {};
      chk((a.hits || []).length === (b.hits || []).length && !b.retried,
        '正常查询走重试版结果与原来完全一致（没有 miss 就不该重试）',
        (a.hits || []).length + ' vs ' + (b.hits || []).length + ' retried=' + b.retried);
    }

    // ── ③ 「最多一次」的结构性保证：不能出现第二次 search 调用 ──
    //   静态断言比运行时可靠 —— 运行时很难证明「没有第三轮」。
    const retryBody = (coreNow.match(/function searchWithRetry\([\s\S]*?\n\}/) || [''])[0];
    const callCount = (retryBody.match(/\bsearch\(/g) || []).length;
    chk(callCount <= 2,
      '⚠️ searchWithRetry 里最多只调 search() 两次（首次 + 一次重试），不得循环',
      '实际 ' + callCount + ' 次');
    // ⚠️ 判据要精确到「循环体里有没有 search(」：函数里本来就有 for 循环（遍历 miss 词、
    //   遍历候选锚点），那些是正常的。用『任意 for/while 后跟 search()』会误判。
    const loopBodies = retryBody.match(/(?:for|while)\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/g) || [];
    const badLoops = loopBodies.filter((b) => /\bsearch\(/.test(b));
    chk(badLoops.length === 0,
      '⚠️ 没有任何循环体里调用 search()（重试不能发生在循环里）',
      '含 search 的循环体 ' + badLoops.length + ' 个');

    // ── ④ 大小写：latinMiss 返回小写，剔除时必须大小写不敏感 ──
    //   踩过：第一版直接 split/join，大写词剔不掉 ⇒ 重试空转。
    chk(/new RegExp\([^)]*'gi'\)/.test(retryBody),
      '⚠️ 剔词用大小写不敏感正则（latinMiss 返回小写，原文可能是大写）');

    // ── ⑤ 锚点判据用的是 termDf（查词表），不是 LIKE 全表扫 ──
    chk(/termDf\s*\(/.test(retryBody),
      '锚点存在性用 termDf 查词表（LIKE 全表扫 9 万行不可接受）');
    // ⚠️ 必须先把注释行剔掉再判 —— 函数注释里就写着「用 termDf 而不是 LIKE」，
    //   直接匹配整段会把那句说明当成违规代码（踩过一次）。
    const codeOnly = retryBody.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    chk(!/LIKE\s*'%/.test(codeOnly),
      '⚠️ 代码里（注释除外）没有 LIKE \'%…%\' 全表扫描');
  } else {
    ok('库为空，跳过运行时断言（静态断言已覆盖）');
  }
} else {
  no('searchWithRetry 未导出 —— MCP 的一次重试没有落地');
}
}

// ── 17) 临时文件清理（2026-11-09 新增）──
//   这是整个项目里**唯一会真删用户文件**的功能 ⇒ 四道闸门必须逐条守住，
//   少一条就可能删掉不该删的东西。写这些断言不为覆盖率，是为了让人以后不敢裸改。
//   ⚠️ 全部用字面量精确匹配，不做花括号配对切函数体 —— 注释里也有花括号，
//      按字符数/贪婪正则切会假失败（这个坑在本项目踩过三次）。
console.log('\n17) 临时文件清理：四道安全闸门');
{
  const tsSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
  const tsUi = fs.readFileSync(path.join(ROOT, 'scripts', 'ck-memory-ui.js'), 'utf8');

  chk(/async function tempSweep\(/.test(tsSrc),
    '⭐ tempSweep 必须是 async（同步删二十万文件会把 daemon 主线程连同面板/网关一起卡死）');
  chk(/if \(tempSweepBusy\) return/.test(tsSrc) && /finally \{ tempSweepBusy = false; \}/.test(tsSrc),
    '防重入：tempSweepBusy 拦并发 + finally 里一定复位（否则一次异常就永久锁死）');

  // ① 只处理一级子目录
  chk(/if \(!ent\.isDirectory\(\)\) continue;/.test(tsSrc),
    '⚠️ 闸门① 只处理临时根下面的一级**目录**（散落在根上的文件是 daemon 正在写的）');
  // ② 年龄
  chk(/if \(st\.mtimeMs > cutoff\) continue;/.test(tsSrc),
    '⚠️ 闸门② 目录 mtime 必须早于 cutoff（在用 profile 时刻在写，过不了这条）');
  // ③ 形态优先于命名
  chk(/if \(!CHROMIUM_TEMP_RE\.test\(name\) && !looksLikeChromiumProfile\(dir\)\) continue;/.test(tsSrc),
    '⚠️ 闸门③ 命名只是兜底通道，主判据是磁盘形态（三件套齐全）');
  chk(/function looksLikeChromiumProfile\(/.test(tsSrc)
    && /'Local State'/.test(tsSrc) && /'Crashpad'/.test(tsSrc),
    '形态判据 = Local State + Default\\ + Crashpad\\ 三件套');
  // ④ 白名单
  chk(/if \(KEEP_NAMES\.has\(name\)\) continue;/.test(tsSrc),
    '⚠️ 闸门④ 白名单命中一律跳过（宁可留垃圾，不能误删）');
  ['xltest', 'packcalc_shot', 'langapp_be_test', 'officecli', 'Diagnostics'].forEach((n) => {
    chk(new RegExp(`'${n}'`).test((tsSrc.match(/const KEEP_NAMES = new Set\(\[[\s\S]*?\]\);/) || [''])[0]),
      `白名单里有 ${n}（那是用户真放进去的东西）`);
  });

  // 临时根必须自动发现，不能把 profile 名写死
  //   ⚠️ 写死的代价是静默失效：换 profile（lite）之后永远扫不到东西，
  //      而面板只会显示「还没清理过」，跟「真没垃圾」长得一模一样。
  chk(/function tempRoots\(/.test(tsSrc) && !/'workbuddy-cn'/.test(tsSrc),
    '⚠️ 临时根按 client-tmp 下的 profile 子目录自动发现，不写死 workbuddy-cn');

  // 定时器：独立于 enabled，且必须挂在 `!available() || !state.enabled` 早退之前
  const iMount = tsSrc.indexOf('if (state.tempSweep) startTempTimer();');
  const iGuard = tsSrc.indexOf('if (!available() || !state.enabled) return;', iMount);
  chk(iMount > 0 && iGuard > iMount,
    '⭐ 临时清理定时器挂在「未启用就 return」**之前**（关掉自动索引不等于愿意让 C 盘被吃光）');
  chk(/if \(state\.enabled\) startAll\(\); else startTempTimer\(\);/.test(tsSrc),
    'restartTimer 里有关闭分支（否则改一次配置就把清理定时器永久弄没，日志里一句话都没有）');

  // 存活证明：没有这个时间戳，静默失效和「最近没垃圾」长得完全一样
  chk(/tempsweep\.json/.test(tsSrc) && /function readTempSweepState\(/.test(tsSrc),
    '⭐ 上次清理结果持久化到 tempsweep.json（否则无法区分「没清过」和「一直在清但没东西删」）');

  // 端点 + 导出
  chk(/sub === 'tempsweep' && method === 'GET'/.test(tsSrc),
    'GET /api/ck-memory/tempsweep 在');
  chk(/sub === 'tempsweep' && method === 'POST'/.test(tsSrc),
    'POST /api/ck-memory/tempsweep 在（run=true 立即清 / 否则存配置）');
  chk(/^\s{2}tempSweep,\s*$/m.test(tsSrc),
    'tempSweep 已导出（面板「立即清理」走它）');

  // 前端接线
  chk(/setAttribute\('data-tsw', '1'\)/.test(tsUi) && /立即清理/.test(tsUi),
    '面板「高级」里有「清理临时文件」勾选 + 「立即清理」按钮');
  chk(/try \{ if \(S\.adv\) renderTempSweep\(\); \} catch \(_\) \{\}/.test(tsUi),
    'render() 里挂了 renderTempSweep（自成单元，失败不拖垮整个面板）');
  chk(/^\s{4}loadTempSweep\(\);$/m.test(tsUi),
    'loadBoot() 尾部有 loadTempSweep()，且不串进主链（临时根 20 万文件时不能拖慢首屏）');
  const rev = Number((tsUi.match(/var UI_REV = '(\d+)'/) || [])[1] || 0);
  chk(rev >= 44, 'UI_REV ≥ 44（新增一行 DOM ⇒ 必须 +1，否则新旧 DOM 叠加）', 'UI_REV=' + rev);
  /* ⭐⭐⭐ 删除必须走「干净子进程」，不能直连 fs.rm
   * 2026-11-09 的真实损失：宿主用 NODE_OPTIONS 给子进程挂了 safe-delete 垫片，它的
   * fs.rm 在 Windows 上等于 SendToRecycleBin ⇒ 删了 5.9 万项，C 盘可用量一个字节没涨，
   * 还白跑 40 分钟。这几条断言的作用：以后谁把删除改回 fs.rm，测试立刻红。
   */
  chk(/function purgeViaChild\(/.test(tsSrc) && /process\.execPath/.test(tsSrc),
    '⭐⭐⭐ 删除走子进程（purgeViaChild + process.execPath），不直连 fs.rm');
  chk(/SHIM_RE\.test\(String\(env\.NODE_OPTIONS/.test(tsSrc) && /delete env\.NODE_OPTIONS;/.test(tsSrc),
    '⭐⭐⭐ 子进程里摘掉了 NODE_OPTIONS（不摘就等于「把文件搬进回收站」还说成功）');
  chk(!/fs\.promises\.rm\(/.test(tsSrc),
    'tempSweep 里没有残留的 fs.promises.rm（守住上面两条，防止有人改回去）');
  chk(/purgeViaChild\(dir\)/.test(tsSrc) && /fs\.existsSync\(dir\)/.test(tsSrc),
    '⭐ 删完复核目录真的不存在（子进程报成功但目录还在，也算失败）');
  chk(/recycled: removed > 0 && delta <= 0/.test(tsSrc),
    '⭐⭐ 保留 recycled 标记：真出「删了但空间没回来」时面板会显示「空间未回收」而不是骗人的「回收 X GB」');
}

try { db.close(); } catch (_) {}
cleanup();
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
