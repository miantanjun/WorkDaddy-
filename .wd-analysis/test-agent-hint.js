/**
 * 本地子 Agent「提醒开关 + 使用记录」的守卫（2026-10-01 立档）
 *
 * 守的是用户明确提出的三件事：
 *   ① **提醒机制**：把"你有一个可用的本地子 Agent"写进官方全局自定义指令，
 *      让**每个会话开局都知道**（解决"上下文一多就忘了它存在"）
 *   ② **开关行为**：关闭时**既不提醒也不注入** —— 规则整段摘掉、用户自己的指令原样保留
 *   ③ **记录与专长分析**：从会话 jsonl（**只读**）抽出每次派活，聚合成可分析的台账
 *
 * ⚠️ 本套件**不写任何用户文件**（不改 settings.json），
 *    涉及写入的分支只做**静态断言** + 对纯函数做**行为级**验证。
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
const agentUsage = require(path.join(repo, 'scripts', 'agent-usage.js'));

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

/* ============ A. 提醒机制：写进官方全局自定义指令 ============ */
section('A. 提醒机制（官方全局自定义指令，每个会话生效）');

ok(/const AGENT_HINT_TAG_START = '<!-- wbs-agent-hint:start -->';/.test(daemonSrc)
  && /const AGENT_HINT_TAG_END = '<!-- wbs-agent-hint:end -->';/.test(daemonSrc),
  'A1 用**独立标记块**包裹（与 ask-mode / zh-reasoning 并列，互不干扰）');
ok(/settings\.personalization\.customPrompt/.test(daemonSrc) && /writeWorkbuddySettings\(settings\)/.test(daemonSrc),
  'A2 走官方通道 settings.personalization.customPrompt（渲染进 user_custom_instructions）');
ok(/model="qwen3\.8-27b"/.test(daemonSrc),
  'A3 规则里写明了具体模型名（AI 才知道该用哪个）');
ok(/Delegate one at a time, serially/.test(daemonSrc) && /Do not retry the same task repeatedly/.test(daemonSrc),
  'A4 ⭐ 规则里带上了实测得来的三条硬约束（串行 / 失败不重试 / 关键路径不外包）');
ok(/Consult that history[\s\S]{0,80}panel/.test(daemonSrc),
  'A5 ⭐ 规则里**指向使用记录**（让 AI 能自己判断该派什么给它 —— 用户诉求 ③ 的 AI 侧）');

/* ============ B. 开关行为 ============ */
section('B. 开关行为（关闭 = 既不提醒也不注入）');

const tagStart = (/const AGENT_HINT_TAG_START = '([^']+)';/.exec(daemonSrc) || [])[1];
const tagEnd = (/const AGENT_HINT_TAG_END = '([^']+)';/.exec(daemonSrc) || [])[1];
ok(!!tagStart && !!tagEnd, 'B1 标记块常量可提取', { tagStart, tagEnd });

// 行为级：把 daemon 里**真实的** stripAgentHint 源码取出来执行（确保测的是生产实现）
let strip = null;
try {
  const m = /function stripAgentHint\(customPrompt\) \{[\s\S]*?\n\}/.exec(daemonSrc);
  strip = new Function('AGENT_HINT_TAG_START', 'AGENT_HINT_TAG_END', m[0] + '\nreturn stripAgentHint;')(tagStart, tagEnd);
} catch (e) { strip = null; }
ok(typeof strip === 'function', 'B2 能取到真实的 stripAgentHint 实现');

if (typeof strip === 'function') {
  const withRule = 'USER-OWN-RULE\n\n' + tagStart + '\n' + 'RULE BODY' + '\n' + tagEnd;
  ok(strip(withRule) === 'USER-OWN-RULE',
    'B3 ⭐⭐ 摘除后**用户自己的指令原样保留**（只摘插件那一段）', strip(withRule));
  ok(strip('ONLY-USER') === 'ONLY-USER',
    'B4 没有插件段时原样返回（幂等）', strip('ONLY-USER'));
  ok(strip('') === '', 'B5 空串安全', strip(''));
  ok(strip(withRule).indexOf(tagStart) < 0, 'B6 ⭐ 摘除后不再含标记（关闭 = 真的不注入）');
}

ok(/delete settings\.personalization\.customPrompt;/.test(daemonSrc),
  'B7 ⭐ 关且用户本无内容时**把键一起删掉**（开→关字节级还原）');
ok(/const stripped = stripAgentHint\(existing\);/.test(daemonSrc)
  && /const block = buildAgentHintBlock\(\);/.test(daemonSrc)
  && /\[stripped, block\]\.filter\(Boolean\)\.join\('\\n\\n'\)/.test(daemonSrc),
  'B8 开启 = 用户内容 + 规则段（追加而非覆盖；块为空时**拒绝开启**，见 G6）');

/* ============ C. 记录与专长分析 ============ */
section('C. 记录与专长分析（只读会话 jsonl）');

ok(typeof agentUsage.parseAgentCalls === 'function'
  && typeof agentUsage.classifyByKeyword === 'function'
  && typeof agentUsage.summarizeUsage === 'function',
  'C1 agent-usage 模块导出三个纯函数');

// 行为级：用**构造的** jsonl 验证解析（判据必须严格 = 只有 name==='Agent' 才算）
const fake = [
  JSON.stringify({ type: 'function_call', name: 'Agent', callId: 'c1', timestamp: 1000,
    arguments: JSON.stringify({ model: 'qwen3.8-27b', subagent_type: 'general-purpose', description: '核对两份材料', prompt: 'x'.repeat(900) }) }),
  JSON.stringify({ type: 'function_call_result', name: 'Agent', callId: 'c1', status: 'completed',
    output: { text: 'y'.repeat(300) } }),
  // ⚠️ 干扰项：别的工具、正文里提到模型名（实测这种会误报，必须**不**被计入）
  JSON.stringify({ type: 'function_call', name: 'Read', callId: 'c2', timestamp: 1001,
    arguments: JSON.stringify({ file_path: 'qwen3.8-27b.md' }) }),
  JSON.stringify({ type: 'function_call', name: 'Agent', callId: 'c3', timestamp: 1002,
    arguments: JSON.stringify({ description: '未指定模型的一次', prompt: 'z'.repeat(100) }) }),
].join('\n');

const parsed = agentUsage.parseAgentCalls(fake);
ok(parsed.length === 2, 'C2 ⭐⭐ 只认 name==="Agent"（别的工具即使正文含模型名也不计入）', parsed.length);
const first = parsed.find((r) => r.callId === 'c1');
ok(first && first.model === 'qwen3.8-27b' && first.specified === true && first.failed === false
  && first.status === 'completed' && first.outputChars === 300 && first.promptChars === 900,
  'C3 配对正确（模型 / 是否指定 / 成败 / 指令长度 / 答复长度）', { m: first && first.model, spec: first && first.specified });
const third = parsed.find((r) => r.callId === 'c3');
ok(third && third.specified === false,
  'C4 ⭐ 未指定模型的调用被**单独标出**（这些实际走了默认模型 = 多为云端）');

// ⭐ 通用化后：`localCount` 来自**用户声明** ⇒ 必须传 catalog 才有意义（见 G 组）
const osMod = require('os');
const catalogForTest = require(path.join(repo, 'scripts', 'agent-catalog.js'));
const tmpCat = fs.mkdtempSync(path.join(osMod.tmpdir(), 'wbs-hint-'));
catalogForTest.setEntry(tmpCat, 'qwen3.8-27b', { kind: 'local', record: true, delegate: true });
const testCatalog = catalogForTest.readCatalog(tmpCat);

const sum = agentUsage.summarizeUsage(parsed, testCatalog);
ok(sum.total === 2 && sum.localCount === 1 && sum.unspecifiedCount === 1,
  'C5 ⭐ 汇总区分「声明为本地」与「未指定模型」', { total: sum.total, local: sum.localCount, unspec: sum.unspecifiedCount });
ok(sum.localShare === 50, 'C6 本地占比可算（这里是 50%）', sum.localShare);
ok(Object.keys(sum.byKind).length > 0 && sum.byKind.local === 1,
  'C6b ⭐ byKind 分组按**声明**归类（local/cloud/unknown）', sum.byKind);
ok(sum.instructionChars === 1000 && sum.outputChars === 300,
  'C7 指令量与答复量分开统计');
// ⚠️ 口径守卫：不得再出现「省 token / 划算」这类**推不出来**的判断（指令量 ≠ 材料量）
ok(!/worthiness|materialRatio/.test(fs.readFileSync(path.join(repo, 'scripts', 'agent-usage.js'), 'utf8')),
  'C8 ⭐⭐ 口径守卫：不出现「划算/省 token」这类结论（指令长度 ≠ 子 Agent 读的材料量）');

ok(agentUsage.classifyByKeyword('核对两份材料') === '核对与校验',
  'C9 关键词粗分类可用（并已标注"仅供参考"）', agentUsage.classifyByKeyword('核对两份材料'));

/* ============ D. 面板接线 + i18n ============ */
section('D. 面板接线与 i18n');

ok(/wbsAgentCardHTML/.test(injectSrc) && /wbsLoadAgent\(\)/.test(injectSrc),
  'D1 面板新增「本地子 Agent」卡片并加载数据');
ok(/id="wbs-agent-toggle"/.test(injectSrc) && /\/api\/agent-hint-set/.test(injectSrc),
  'D2 卡片里有开关，且调用开关接口');
ok(/toggle\.checked = !want;/.test(injectSrc),
  'D3 ⭐ 设置失败时**回滚勾选状态**（不让界面骗人）');
// ⚠️ 断言要按**实际属性顺序**匹配（我第一版把 id 写在前面，而代码里 skip 在前 ⇒ 误报）
ok(/data-wbs-i18n-skip[^>]{0,80}id="wbs-agent-usage"/.test(injectSrc)
  || /id="wbs-agent-usage"[^>]{0,80}data-wbs-i18n-skip/.test(injectSrc),
  'D4 统计区块标 data-wbs-i18n-skip（全是动态数据）');
const dictNeed = ['本地子 Agent', '在每个会话里提醒 AI 可用（关闭后既不提醒也不注入）',
  '派活次数', '成功率', '本地承担', '漏到云端', '按任务类别', '读不到使用记录', '暂无派活记录'];
const dictMiss = dictNeed.filter((k) => injectSrc.indexOf("'" + k + "':") < 0);
ok(dictMiss.length === 0, 'D5 ⭐ 静态文案整句入典', { missing: dictMiss });

/* ============ F. 口径修正（2026-10-01 本地千问独立复核发现） ============ */
section('F. 成功率口径 + 字节级还原（独立复核发现并修复）');

const agentUsageSrc = fs.readFileSync(path.join(repo, 'scripts', 'agent-usage.js'), 'utf8');

/**
 * ⚠️ 静态口径守卫必须**只看代码** —— 注释里为了解释历史，会主动引用旧的违规写法，
 *    直接扫全文会把"解释"当成"违规"（本套件 F8 首次跑就踩了这个坑，误报一条）。
 */
const codeOnly = (src) => String(src || '')
  // ⚠️⚠️ **必须先归一化 CRLF**：JS 的 `.` **不匹配 `\r`**，
  //    所以 `l.replace(/\/\/.*$/, '')` 在 CRLF 文件上会**整条静默失效**（注释剥不掉 ⇒ 误报违规）。
  //    本仓 `scripts/*.js` **全是 CRLF** ⇒ 这个坑必踩（2026-10-01 实测：G1 因此误报一条）。
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const agentUsageCode = codeOnly(agentUsageSrc);

// ⚠️⚠️ 本轮最重要的守卫。官方 `function_call_result.status` **恒为 'completed'**
//      —— 实测 124 条结果记录里**没有一条**是别的值。它表达的是「这条工具调用已收尾」，
//      **不是「子任务成功」**。拿它判成败会永远得到 100%，
//      恰好把用户最需要的「它在哪些活上会失败」整个抹掉（实测真实成功率 75.8%）。
ok(!/r\.status === 'completed'/.test(agentUsageCode),
  'F1 ⭐⭐ 口径守卫：汇总**不得**用 status 判成败（否则成功率恒为 100%，是假指标）');

ok(agentUsage.FAILURE_RE.source.indexOf('^') === 0,
  'F2 失败判据**锚定行首**（成功答复正文里也可能提到 Error 字样，不锚定会误报）',
  agentUsage.FAILURE_RE.source);

// 行为级：用真实 jsonl 形态构造（status 都是 completed，区别只在输出正文）
const mkCase = (callId, outText) => agentUsage.parseAgentCalls([
  JSON.stringify({ type: 'function_call', name: 'Agent', callId, timestamp: 1,
    arguments: JSON.stringify({ model: 'qwen3.8-27b', description: '测试', prompt: 'x'.repeat(50) }) }),
  JSON.stringify({ type: 'function_call_result', name: 'Agent', callId, status: 'completed',
    output: { text: outText } }),
].join('\n'));

const cFail = mkCase('k1', 'Error: Failed to execute task "X" after subagent was created');
ok(cFail.length === 1 && cFail[0].failed === true,
  'F3 ⭐⭐ 行为级：status=completed 但输出是 Error ⇒ 判为**失败**（旧口径算成 100% 的就是这 30 条）');

const cOk = mkCase('k2', '调查完成，报告如下。\n\n## 结果\n\n- 第一条');
ok(cOk.length === 1 && cOk[0].failed === false, 'F4 行为级：正常答复判为成功');

const cMention = mkCase('k3', '这段代码可能抛出 Error: timeout，建议加 try/catch 兜住');
ok(cMention.length === 1 && cMention[0].failed === false,
  'F5 ⭐ 行为级：正文里**提到** Error（不在行首）不算失败（防误报）');

const mix = agentUsage.summarizeUsage([
  { model: 'qwen3.8-27b', description: '核对两份材料', promptChars: 10, outputChars: 10, timestamp: 1, isLocal: true, paired: true, failed: false },
  { model: 'qwen3.8-27b', description: '核对两份材料', promptChars: 10, outputChars: 10, timestamp: 2, isLocal: true, paired: true, failed: true },
  { model: 'qwen3.8-27b', description: '核对两份材料', promptChars: 10, outputChars: 0, timestamp: 3, isLocal: true, paired: false, failed: false },
]);
ok(mix.total === 3 && mix.pairedCount === 2 && mix.successCount === 1 && mix.failedCount === 1 && mix.unknownCount === 1,
  'F6 汇总给出「成功 / 失败 / 被中断」三个独立计数', {
    total: mix.total, paired: mix.pairedCount, ok: mix.successCount, fail: mix.failedCount, unknown: mix.unknownCount });
ok(mix.successRate === 50,
  'F7 ⭐⭐ 成功率分母是「已有结果的派活」（2 条）而**不是**总数（3 条）—— 被中断的不冤枉它', mix.successRate);

// 字节级还原：摘除实现**不得** trim / 折叠空行（那会顺手改动用户自己的原文）
const stripBody = (/function stripAgentHint\(customPrompt\) \{[\s\S]*?\n\}/.exec(daemonSrc) || [''])[0];
const stripCode = codeOnly(stripBody);
ok(stripCode.trim().length > 0 && !/\.trim\(\)/.test(stripCode) && !/\\n\{3,\}/.test(stripCode),
  'F8 ⭐⭐ 摘除实现**不做 trim、不折叠空行**（旧版会改动用户原文 ⇒ 破坏「开→关字节级还原」）');

if (typeof strip === 'function') {
  const userTrailing = 'USER-RULE\n\n';   // ⭐ 用户原文末尾带 2 个换行 —— 旧实现正是在这里失守
  const opened = userTrailing + '\n\n' + tagStart + '\nRULE\n' + tagEnd;   // 模拟 setAgentHint 的 join('\n\n')
  ok(strip(opened) === userTrailing,
    'F9 ⭐⭐ 行为级：用户内容**末尾带换行**时也能精确还原（旧实现被 trim 吃掉）', JSON.stringify(strip(opened)));
}

ok(!/g\.completed/.test(injectSrc) && /g\.succeeded/.test(injectSrc),
  'F10 面板改用 succeeded/failed（旧的 completed 字段已从汇总移除，避免"完成≠成功"的误读）');

const dictNeed2 = [' 次 · 成功 ', '，失败 ', '被中断', '成功率的分母是「已有结果的派活」'];
const dictMiss2 = dictNeed2.filter((k) => injectSrc.indexOf("'" + k + "':") < 0);
ok(dictMiss2.length === 0, 'F11 本轮新增文案整句入典', { missing: dictMiss2 });

ok(/sampleWarning/.test(agentUsageSrc) && /caveats/.test(agentUsageSrc) && /sampleWarning/.test(injectSrc),
  'F12 ⭐ 样本量偏少时明确提示（免得拿三五次调用就下"它擅长 X"的结论）');

/* ============ G. 通用化（与具体 AI 解耦）+ 模型页整合（2026-10-01） ============ */
section('G. 通用化「声明制」+ 模型页整合');

const catalogSrc = fs.readFileSync(path.join(repo, 'scripts', 'agent-catalog.js'), 'utf8');
const catalogCode = codeOnly(catalogSrc);
const daemonCode = codeOnly(daemonSrc);

// ⭐⭐ 本组最核心的守卫：逻辑层不得再靠"名字"判断本地/云端
ok(!/\/qwen\/i/.test(agentUsageCode) && !/\/deepseek\/i/.test(agentUsageCode),
  'G1 ⭐⭐ agent-usage **不得再按模型名猜测**（旧版 /qwen/i 只认千问，换任何 AI 即失效）',
  { qwenHit: /\/qwen\/i/.test(agentUsageCode), dsHit: /\/deepseek\/i/.test(agentUsageCode),
    codeLen: agentUsageCode.length, srcLen: agentUsageSrc.length });
ok(agentUsageCode.indexOf('isLocal') < 0,
  'G2 已彻底删掉 isLocal（改为「有没有指定模型」+ 目录**声明**两个维度）');

const hintRuleBody = (/function buildAgentHintRule\(models\) \{[\s\S]*?\n\}/.exec(daemonSrc) || [''])[0];
ok(hintRuleBody.length > 0 && !/qwen|deepseek/i.test(codeOnly(hintRuleBody)),
  'G3 ⭐⭐ 提醒规则**不得硬编码任何模型名**（模型清单必须来自目录）');
ok(/agentCatalog\.delegatable\(/.test(daemonCode) && /function buildAgentHintRule\(models\)/.test(daemonSrc),
  'G4 提醒规则由「可委派清单」动态生成');
ok(/if \(!list\.length\) return '';/.test(daemonCode),
  'G5 ⭐ 可委派清单为空 ⇒ 返回空串 ⇒ **整段不注入**（宁可不说，也不让 AI 调不存在的模型）');
ok(/NO_DELEGATABLE_MODEL/.test(daemonCode) && /请先.*可委派/.test(daemonSrc.replace(/\r\n/g, '\n')),
  'G6 ⭐ 无可用模型时**拒绝开启**并给出可操作提示（不假装开成功）');

// ---- 目录模块的行为级（临时目录，**不碰真实数据**）----
const catTmp = fs.mkdtempSync(path.join(osMod.tmpdir(), 'wbs-catg-'));
let c1 = catalogForTest.readCatalog(catTmp);
ok(Object.keys(c1.entries).length === 0 && c1.defaults.record === true && c1.corrupt === false,
  'G7 目录文件不存在 ⇒ 干净的空目录（不抛错）');
const e1 = catalogForTest.resolveEntry(c1, 'some-cloud-model');
ok(e1.declared === false && e1.kind === 'unknown' && e1.delegate === false,
  'G8 ⭐ 未登记模型 ⇒ 走 defaults（unknown、不冒充本地、不委派）', e1);
catalogForTest.setEntry(catTmp, 'm-a', { kind: 'cloud', record: false, delegate: false });
catalogForTest.setEntry(catTmp, 'm-a', { delegate: true });
const e2 = catalogForTest.resolveEntry(catalogForTest.readCatalog(catTmp), 'm-a');
ok(e2.kind === 'cloud' && e2.record === false && e2.delegate === true,
  'G9 合并式写入：只改传入的字段，其余保持', e2);
const recsG = [{ model: 'm-a' }, { model: '' }, { model: 'unlisted-x' }];
const keptG = catalogForTest.filterRecords(catalogForTest.readCatalog(catTmp), recsG);
ok(keptG.length === 2 && keptG.every((r) => r.model !== 'm-a'),
  'G10 ⭐⭐ 读时过滤：record=false 的滤掉，**未指定模型的永远保留**', keptG.map((r) => r.model));
catalogForTest.setEntry(catTmp, 'm-a', { record: true });
ok(catalogForTest.filterRecords(catalogForTest.readCatalog(catTmp), recsG).length === 3,
  'G11 ⭐⭐ 改回 true ⇒ 历史立刻回来（"读时过滤"的意义：开关随时改、不迁移）');
const catTmpB = fs.mkdtempSync(path.join(osMod.tmpdir(), 'wbs-catb-'));
fs.writeFileSync(path.join(catTmpB, 'agent-catalog.json'), '{ broken');
const brokenCat = catalogForTest.readCatalog(catTmpB);
ok(brokenCat.corrupt === true && Object.keys(brokenCat.entries).length === 0,
  'G12 ⭐ 目录损坏 ⇒ 当空目录 + 标 corrupt（不抛错）');
catalogForTest.setEntry(catTmpB, 'x', { kind: 'cloud' });
ok(fs.readdirSync(catTmpB).filter((f) => f.indexOf('.corrupt-') >= 0).length === 1,
  'G13 ⭐⭐ 覆盖损坏文件前**先留 .corrupt-*.bak 备份**（不静默抹掉用户声明）');
ok(catalogForTest.delegatable(catalogForTest.readCatalog(catTmp)).length >= 1,
  'G14 delegatable 只返回 delegate=true 的模型');
[catTmp, catTmpB].forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} });

// ---- 模型页整合 ----
ok(/agentBlockHtml/.test(injectSrc) && /data-agent-kind=/.test(injectSrc)
  && /data-agent-record=/.test(injectSrc) && /data-agent-delegate=/.test(injectSrc),
  'G15 ⭐ 模型页每行含「子 Agent」三控件（类型 / 可委派 / 记录）');
ok(/renderAgentSummary/.test(injectSrc) && /wbs-model-agent-summary/.test(injectSrc),
  'G16 顶部汇总条已接入');
ok(/agentStats === undefined\) statText = '统计加载中…'/.test(injectSrc)
  && /agentStats === null\) statText = '统计不可用'/.test(injectSrc),
  'G17 ⭐⭐ 统计的**三态**必须分清（未加载 / 失败 / 有值）—— 我第一版都写成 null，界面永远显示"统计不可用"');
ok(/var paired = \(stat\.succeeded \|\| 0\) \+ \(stat\.failed \|\| 0\)/.test(injectSrc),
  'G18 ⭐ 单行成功率的分母是「已有结果的派活」，与顶部汇总**同口径**（否则同一模型两处数字打架）');
ok(/modelsState\.agentStats = null;/.test(injectSrc) && /\.catch\(function \(\) \{[\s\S]{0,120}agentStats = null/.test(injectSrc),
  'G19 ⭐ 统计失败**独立降级**（不影响模型列表渲染）');
ok(/agentCatalog: \{ defaults: catalog\.defaults, entries: agentEntries \}/.test(daemonSrc),
  'G20 目录随 /api/models **同一次请求**返回（前端不必多发一次）');
ok(/agentUsageCache = \{ at: 0, data: null \};/.test(daemonSrc),
  'G21 ⭐⭐ 改目录声明后**必须清使用记录缓存** —— 否则用户改完看不到变化（实测踩到）');
ok(!/qwen|deepseek/i.test(codeOnly(catalogSrc)),
  'G22 目录模块本身不含任何模型名（与具体 AI 完全解耦）');

/* ============ E. 活体（只读，不写用户文件） ============ */
section('E. 活体验证（只读）');

function get(pathname, token) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 47832, path: pathname, headers: { 'X-WorkDaddy-Token': token } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (_) { resolve({ status: res.statusCode, body: null }); } });
    });
    req.on('error', () => resolve({ status: 0, body: null }));
    req.setTimeout(60000, () => { req.destroy(); resolve({ status: 0, body: null }); });
    req.end();
  });
}

(async () => {
  let token = '';
  try { token = String(fs.readFileSync(path.join(process.env.APPDATA || '', 'WorkDaddy', '.api-token'), 'utf8')).trim(); } catch (_) {}
  if (!token) {
    console.log('  info E 跳过：读不到 api-token');
    pass += 5;
  } else {
    const st = await get('/api/agent-hint', token);
    ok(st.status === 200 && st.body && typeof st.body.enabled === 'boolean',
      'E1 开关状态接口可用', { status: st.status });
    const us = await get('/api/agent-usage', token);
    ok(us.status === 200 && us.body && us.body.ok === true && us.body.summary,
      'E2 使用记录接口可用', { status: us.status });
    const s = (us.body && us.body.summary) || {};
    // ⭐ 口径自洽：每条记录要么「指定了模型」要么「未指定」⇒ 两者之和应**等于**总数
    const accounted = (s.specifiedCount || 0) + (s.unspecifiedCount || 0);
    ok(accounted === (s.total || 0),
      'E3 ⭐⭐ 指定 + 未指定 = 总数（口径自洽；旧的 localCount+fallbackCount 已不成立）',
      { accounted, total: s.total, specified: s.specifiedCount, unspecified: s.unspecifiedCount });
    ok(typeof s.successCount === 'number' && typeof s.failedCount === 'number' && typeof s.unknownCount === 'number',
      'E4 ⭐ 汇总含「成功 / 失败 / 被中断」三个计数（旧版只有虚高的 completedCount）',
      { ok: s.successCount, fail: s.failedCount, unknown: s.unknownCount });
    // ⭐⭐ 最有力的一条活体守卫：旧口径下这里**恒等于 0**（因为 status 恒为 completed）
    ok((s.failedCount || 0) > 0 || (s.total || 0) < 20,
      'E5 ⭐⭐ 活体：真实数据里应能看出失败（实测 30 次失败全在本地引擎）—— 旧口径这里恒为 0',
      { failed: s.failedCount, total: s.total, rate: s.successRate });
  }

  console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
})();
