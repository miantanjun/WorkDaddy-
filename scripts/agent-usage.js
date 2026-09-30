/**
 * agent-usage.js —— 本地子 Agent 的「使用记录 + 专长分析」（纯函数，可单测）
 *
 * 为什么需要它（2026-10-01 用户需求）：
 *   主 AI 能调用本地子 Agent（`qwen3.8-27b`）协同干活，但**调用全凭感觉** ——
 *   没有任何人知道它到底擅长哪一类活。这个模块把「派了什么活、什么结果」从会话记录里抽出来，
 *   累积成可分析的台账，供用户与 AI 判断「该把什么派给它」。
 *
 * ⚠️ **只读**：只解析会话 jsonl，不写任何官方文件。
 * ⚠️ **判据必须严格**：`type === 'function_call' && name === 'Agent'`。
 *    **不能**用「文本里出现模型名」来判定 —— 实测 `Read` / `Bash` 的记录正文里也会提到模型名，
 *    那样会大量误报（实测命中 4 条全是误报）。
 */

/** 会话记录里的派活判据：工具名必须是 `Agent`（**不能**用"文本含模型名"判定，会大量误报）。 */
const AGENT_TOOL_NAME = 'Agent';

// ⚠️ 与 `agent-catalog.js` 是**单向依赖**（catalog 不反过来 require 本模块）——
//    只借它的 `resolveEntry` / `filterRecords`，用来实现「按模型记录」的读时过滤。
const catalogModule = require('./agent-catalog');

/**
 * ⚠️⚠️ **失败判据必须看输出正文，不能看 `status`** —— 这是 2026-10-01 实测踩到的坑：
 *
 *   官方 `function_call_result.status` **恒为 `'completed'`**。实测 124 条结果记录里
 *   **没有一条**是别的值 —— 它表达的是「这条**工具调用**已收尾」，**不是「子任务成功」**。
 *   若按 `status === 'completed'` 计成功率，会永远得到 100%，
 *   恰好把用户最需要的信息（它在哪些活上会失败）抹掉。
 *
 * 真实形态（实测 124 条里 30 条，占 24.2%）：
 *   `Error: Failed to execute task "<描述>" after subagent was created`
 *   ⇒ 真实成功率 **75.8%**，而按 status 算是 100%。
 *
 * ⚠️ 必须**锚定行首** —— 成功的答复正文里也可能提到 "Error" 字样（讲代码时会引用报错），
 *    不锚定会误报。
 */
const FAILURE_RE = /^\s*Error[:\s]/i;

function isAgentFailure(text) {
  return FAILURE_RE.test(String(text || ''));
}

/**
 * 从一段 jsonl 文本里抽出所有「派给子 Agent」的调用。
 *
 * 记录形态（实测）：
 *   · `function_call`        —— 带 `name:'Agent'` + `callId` + `arguments`(JSON 字符串)
 *   · `function_call_result` —— 带 `callId` + `status` + `output.text`
 * ⇒ 用 `callId` 把两者配对，才能算出「回传了多长」「成功没有」。
 *
 * @param {string} jsonlText 会话 jsonl 的原始文本
 * @param {object} [options]  { sessionId }
 * @returns {Array<object>} 派活记录
 */
function parseAgentCalls(jsonlText, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const calls = new Map();     // callId -> call
  const results = new Map();   // callId -> result
  const lines = String(jsonlText || '').split('\n');

  for (const line of lines) {
    if (!line || line.indexOf('"Agent"') < 0) continue;   // 快速跳过（绝大多数行不含）
    let record = null;
    try { record = JSON.parse(line); } catch (_) { continue; }
    if (!record || record.name !== 'Agent') continue;

    const callId = String(record.callId || record.id || '');
    if (!callId) continue;

    if (record.type === 'function_call') {
      let args = {};
      try { args = JSON.parse(record.arguments || '{}'); } catch (_) { args = {}; }
      const prompt = String(args.prompt || '');
      calls.set(callId, {
        callId,
        timestamp: Number(record.timestamp) || 0,
        sessionId: String(record.sessionId || opts.sessionId || ''),
        model: String(args.model || '').trim(),            // 空 = 未指定 ⇒ 走了默认模型（多为云端）
        subagentType: String(args.subagent_type || args.subagentType || '').trim(),
        description: String(args.description || '').trim(),
        promptChars: prompt.length,
        promptHead: prompt.replace(/\s+/g, ' ').slice(0, 200),
      });
      continue;
    }

    if (record.type === 'function_call_result') {
      const output = record.output && typeof record.output === 'object' ? record.output : {};
      const text = typeof output.text === 'string' ? output.text : '';
      results.set(callId, {
        status: String(record.status || '').trim(),   // 原样保留（⚠️ 恒为 'completed'，别拿它判成败）
        failed: isAgentFailure(text),                 // ⭐ 真判据：看输出正文
        outputChars: text.length,
        outputHead: text.replace(/\s+/g, ' ').slice(0, 200),
      });
    }
  }

  const out = [];
  for (const [callId, call] of calls) {
    const result = results.get(callId) || null;
    out.push(Object.assign({}, call, {
      status: result ? result.status : 'unknown',     // 没有配对结果 = 调用后被中断
      // ⚠️ 没有配对结果时**不算失败**（那是调用被中断，不是它干砸了）—— 单列为 unknown
      failed: result ? !!result.failed : false,
      outputChars: result ? result.outputChars : 0,
      outputHead: result ? result.outputHead : '',
      paired: !!result,
      paired: !!result,
      // ⚠️ 2026-10-01：**删掉了原来的 `/qwen/i.test(call.model)` 名字猜测** ——
      //    它只认千问，换任何别的 AI（云端 / 第三方 / 另一个本地模型）立刻失效；
      //    实测你机器上第二个模型 `deepseek-flash` 就已经被它判错了。
      //    现在这里只记一个**事实**：「有没有指定模型」。
      //    "本地还是云端"改由用户在模型页**声明**（见 `agent-catalog.js` 与下方 byKind）。
      specified: !!String(call.model || '').trim(),
    }));
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/**
 * 任务类型的**粗分类**（启发式，仅供分组参考，不要当成结论）。
 *
 * 如实说明：这是按 `description` 里的关键词硬分，**判得未必准** ——
 * 所以界面上永远同时给出「原始任务描述」，让用户能自己看出规律。
 */
const KEYWORD_GROUPS = [
  ['读取与盘点', ['读', '通读', '盘点', '提取', '摘录', '扫描', '列出', '清单', '统计']],
  ['核对与校验', ['核对', '比对', '校验', '复核', '验证', '检查', '确认', '交叉']],
  ['归纳与总结', ['归纳', '总结', '汇总', '分类', '摘要', '整理', '提取要点']],
  ['生成与改写', ['写', '生成', '改写', '翻译', '润色']],
  ['检索与调研', ['检索', '调研', '查找', '搜索', '资料']],
];

function classifyByKeyword(description) {
  const text = String(description || '');
  if (!text) return '未填描述';
  for (const [group, words] of KEYWORD_GROUPS) {
    for (const word of words) if (text.indexOf(word) >= 0) return group;
  }
  return '其它';
}

/**
 * 把派活记录聚合成「专长分析」。
 *
 * ⚠️⚠️ **口径说明（很重要，别误读）**：
 *   `promptChars` **只是「派活指令」的长度，不含子 Agent 自己读的那些文件** ——
 *   那些读取发生在子 Agent 一侧，**不会出现在本会话的记录里**。
 *   所以这里**不能**据此算「省了多少 token」或「划不划算」（第一版就是这么误算的）。
 *
 *   ⭐ **「本地 / 云端」不再靠名字猜**（2026-10-01 通用化）：
 *      旧版用 `/qwen/i.test(model)` ⇒ 换任何别的 AI 立刻失效（`deepseek-flash` 就被判错了）。
 *      现在 `localCount` 来自**用户在模型页的声明**（`agent-catalog.js`）——
 *      未声明的一律算 `unknown`，**既不冒充本地、也不冒充云端**。
 *      `unspecifiedCount` 是**没指定模型**的那些：实际走了默认（多为云端）
 *      ⇒ **这些才是"漏到云端"的**，值得用户注意。
 *
 * 输出刻意只放**可从记录直接算出**的东西（次数 / 成败 / 本地占比 / 指令与答复长度），
 * **不做"它适合做 X"这类因果判断** —— 那是用户与主 AI 要自己下的结论，工具只负责把事实摆齐。
 *
 * @param {Array} records `parseAgentCalls` 的产出
 * @param {object} [catalog] 模型目录；**给了就按 `record` 开关做「读时过滤」**
 *   —— 这是"开关随时改、历史可重算"的关键（见 agent-catalog.js 的设计说明）。
 */
function summarizeUsage(records, catalog) {
  const all = Array.isArray(records) ? records : [];
  // ⭐ **读时过滤**：record=false 的模型不进台账；**未指定模型的永远保留**
  //   （它们正是"漏到云端"的证据，不该因为"没登记"被藏起来）
  const list = catalog ? catalogModule.filterRecords(catalog, all) : all;
  const filteredOut = all.length - list.length;
  const byModel = {};
  const byGroup = {};
  const byKind = { local: 0, cloud: 0, unknown: 0 };
  let localCount = 0;         // ⭐ 由**声明**得来（kind=local），不再靠名字猜
  let cloudCount = 0;         // 声明为云端的
  let unknownKindCount = 0;   // 指定了模型但**没声明**性质
  let specifiedCount = 0;     // 指定了模型的总数
  let unspecifiedCount = 0;   // 没指定模型（旧的 fallbackCount 语义）
  let pairedCount = 0;
  let successCount = 0;       // 有结果，且输出**不是**错误
  let failedCount = 0;        // 有结果，但输出是错误（⭐ 判据看正文，不看 status）
  let unknownCount = 0;       // 没有配对结果 = 调用被中断（**不算它的锅**）
  let promptChars = 0;
  let outputChars = 0;
  let firstTs = 0;
  let lastTs = 0;

  for (const r of list) {
    const modelId = String(r.model || '').trim();
    const entry = catalog ? catalogModule.resolveEntry(catalog, modelId) : { kind: 'unknown' };
    const kind = modelId ? (entry.kind || 'unknown') : 'unknown';
    if (modelId) {
      specifiedCount += 1;
      if (kind === 'local') localCount += 1;
      else if (kind === 'cloud') cloudCount += 1;
      else unknownKindCount += 1;
    } else {
      unspecifiedCount += 1;
    }
    byKind[kind] = (byKind[kind] || 0) + 1;

    const modelKey = modelId || '(未指定 → 默认模型)';
    if (!byModel[modelKey]) {
      byModel[modelKey] = { count: 0, succeeded: 0, failed: 0, promptChars: 0, outputChars: 0, kind };
    }
    const m = byModel[modelKey];
    m.count += 1;
    if (r.paired) { if (r.failed) m.failed += 1; else m.succeeded += 1; }
    m.promptChars += r.promptChars;
    m.outputChars += r.outputChars;

    const group = classifyByKeyword(r.description);
    if (!byGroup[group]) byGroup[group] = { count: 0, succeeded: 0, failed: 0, promptChars: 0, outputChars: 0, samples: [] };
    const g = byGroup[group];
    g.count += 1;
    if (r.paired) { if (r.failed) g.failed += 1; else g.succeeded += 1; }
    g.promptChars += r.promptChars;
    g.outputChars += r.outputChars;
    if (g.samples.length < 5 && r.description) g.samples.push(r.description.slice(0, 60));

    if (r.paired) {
      pairedCount += 1;
      if (r.failed) failedCount += 1; else successCount += 1;
    } else {
      unknownCount += 1;
    }
    promptChars += r.promptChars;
    outputChars += r.outputChars;
    if (r.timestamp) {
      if (!firstTs || r.timestamp < firstTs) firstTs = r.timestamp;
      if (r.timestamp > lastTs) lastTs = r.timestamp;
    }
  }

  const ratio = outputChars ? Number((promptChars / outputChars).toFixed(2)) : 0;
  return {
    total: list.length,
    // 被「按模型记录」开关滤掉的数量 —— 让用户知道有多少被屏蔽（避免"数字怎么变小了"的困惑）
    filteredOut,
    specifiedCount,
    unspecifiedCount,      // 旧的 `fallbackCount` 语义：没指定模型 ⇒ 实际走默认（多为云端）
    // ⭐ 下面三个由**用户声明**得来（不再靠名字猜，见文件头与 agent-catalog.js）
    localCount,
    cloudCount,
    unknownKindCount,
    // ⚠️ 口径：分母是**过滤后的总数**（不是"指定的"）—— 面板上会标注这一点
    localShare: list.length ? Number(((localCount / list.length) * 100).toFixed(1)) : 0,
    pairedCount,
    successCount,
    failedCount,
    unknownCount,
    // ⭐⭐ 成功率口径：**分母是「已有结果的派活」**（`pairedCount`），**不是** `total` ——
    //      没有结果的那些是调用被中断，不是它干砸了，算进去会冤枉它。
    //      ⚠️ 分子**绝不能**用 `status === 'completed'` 来算（那个恒为真，见文件头说明）。
    successRate: pairedCount ? Number(((successCount / pairedCount) * 100).toFixed(1)) : 0,
    // ⚠️ 下面两个是「派活指令」与「答复」的长度，**不是**材料量 vs 产出的省 token 账（见上方口径说明）
    instructionChars: promptChars,
    outputChars,
    instructionRatio: ratio,
    firstAt: firstTs ? new Date(firstTs).toISOString() : '',
    lastAt: lastTs ? new Date(lastTs).toISOString() : '',
    // 样本太少时明确提示 —— 免得拿三五次调用就下"它擅长 X"的结论
    sampleWarning: list.length < 20 ? '样本量偏少（不足 20 次），结论仅供参考' : '',
    caveats: [
      '「本地 / 云端」按你在模型页的**声明**归类，未声明的不计两边',
      '指令长度不含子 Agent 自己读取的材料 ⇒ 不能当省 token 账',
      '成功率的分母是「已有结果的派活」，被中断的不计入',
      '任务类别是按描述关键词粗分的，仅供参考',
    ],
    byModel,
    byGroup,
    byKind,
  };
}

module.exports = {
  AGENT_TOOL_NAME,
  FAILURE_RE,
  isAgentFailure,
  KEYWORD_GROUPS,
  parseAgentCalls,
  classifyByKeyword,
  summarizeUsage,
};
