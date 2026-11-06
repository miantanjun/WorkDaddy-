#!/usr/bin/env node
/**
 * ck-mcp —— 当前会话记忆的查询入口（MCP stdio）
 *
 * 定位：只服务「当前这条会话」，不跨会话、不跨项目。
 *   长会话被压缩多次后，早期内容从上下文里消失了 —— 但 transcript 还在写。
 *   插件（scripts/ck-memory.js）把当前会话变成可毫秒级检索的索引，
 *   这里把它包成 MCP 工具，让助手能主动回查。
 *
 * 暴露五个工具：
 *   memory_search    在本次会话里搜具体内容（关键词、数字、路径、决定）
 *   memory_recent    本次会话最近 N 小时的脉络
 *   memory_timeline  本次会话里用户提过的每条要求
 *   memory_sessions  当前绑定到哪条会话 + 库里有几条已建索引（只看元信息，不含正文）
 *   memory_facts     查「提炼出来的事实」（语义记忆）—— 一句话结论，换个说法也能命中
 *
 * ⚠️⚠️ 多会话规则：索引可以同时覆盖多条会话（面板里勾「跟踪」），
 *   但**查询永远只查「当前会话」**。工具的入参里没有 sid，故意不给跨会话查询的口子。
 *
 * ⚠️⚠️⚠️ 「当前会话」怎么定（这里最容易搞错）：
 *   ① 首选面板上报的绑定（bind.json）—— 用户在侧栏点开哪条就是哪条，
 *      即使一条消息都没发、文件一点没写。这是他真正「眼前在看的那条」。
 *   ② 没有绑定（面板没开 / 心跳过期 / 指向已删会话）才回落到 mtime 最新。
 *   注意绑定是**读磁盘**的：MCP 与 daemon 是两个进程，内存变量不共享。
 *
 * ⚠️ 这里**不 configure**：ck-memory 自己推导路径
 *     库   = %APPDATA%\WorkDaddy\ck-memory\ck.db
 *     会话 = %USERPROFILE%\.workbuddy\projects\**\*.jsonl
 *   所以换电脑装上插件、配好这条 MCP 命令就能用，不需要任何额外参数。
 *
 * 协议：JSON-RPC 2.0 over stdio，一行一条消息。
 * 规矩：stdout 只放协议消息，任何日志走 stderr（否则客户端解析失败）。
 */

'use strict';

const path = require('path');

const ck = require(path.join(__dirname, 'ck-memory.js'));

const SERVER_INFO = { name: 'ck-memory', version: '2.0.0' };
const DEFAULT_PROTOCOL = '2024-11-05';

/* ================= 工具定义 ================= */

const TOOLS = [
  {
    name: 'memory_search',
    description:
      '在本条会话的历史里做全文检索，找回已经不在当前上下文中的细节。' +
      '适合：早前定过的数字/金额/单号、说过的文件名与路径、某个决定及其理由、' +
      '曾经踩过并修掉的坑。中文按两字切分，两个字的词（尾款、提单、税号）也能命中。' +
      '⚠️ 若查询里有「整库从未出现过的专名/编号」，系统会自动剔掉那个词再查一次（**只一次**）。' +
      '所以：① 返回里若写「明知 XX 从未出现过」，说明那个编号确实不在记忆里，别据此推断；' +
      '② 若返回「仍没有找到」，说明已经重试过了，**不要再用同一组关键词反复调用**，' +
      '应换更短或更常见的关键词，或改用 memory_facts 查结论。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词。中文词、英文词、数字、文件名、订单号都行' },
        limit: { type: 'number', description: '最多返回几条，默认 8，上限 30' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_recent',
    description:
      '按时间倒序取本条会话最近若干小时的记录，用来快速恢复「刚刚在做什么」。' +
      '不知道搜什么关键词时先用这个。',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: '往回看多少小时，默认 6' },
        limit: { type: 'number', description: '最多返回几条，默认 30，上限 100' },
      },
    },
  },
  {
    name: 'memory_timeline',
    description:
      '列出本条会话里用户提过的要求（按时间顺序，取最近 N 条），用来确认需求演变的脉络。' +
      '只看用户发言，不含助手回复和工具输出。会话很长时只回最近的一批，表头会写明总条数。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多返回几条，默认 80，上限 300' },
      },
    },
  },
  {
    name: 'memory_sessions',
    description:
      '查看「当前绑定到哪条会话」以及库里一共给几条会话建了索引（只给会话短 ID、条数、时间，' +
      '不含任何正文）。用来判断索引有没有绑错会话、某条长会话是否已经建好索引。' +
      '检索本身永远只查当前会话，不会跨会话。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_facts',
    description:
      '查「提炼出来的事实」（语义记忆）—— 每条是一句自包含的结论，' +
      '比如「OCTAGON 订单 YKW-SU-260713 尾款 USD 231,472.08 未付」。\n' +
      '与 memory_search 的分工：\n' +
      '  · memory_search 找**原话**（要恰好命中当时的用词）\n' +
      '  · memory_facts 找**结论**（换个说法也能命中，因为事实本身重写过）\n' +
      '问「现在是什么状态 / 金额多少 / 定过什么」这类问题优先用它；\n' +
      '要查「当时具体怎么说的」用 memory_search。\n' +
      '⚠️ 默认只返回**仍然有效**的事实。加 includeExpired 可看到被新结论取代的旧事实（时序问题用）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词。中文词、编号、版本号、金额都行' },
        limit: { type: 'number', description: '最多返回几条，默认 8，上限 20' },
        includeExpired: { type: 'boolean', description: '是否包含已失效的旧事实（默认否）' },
      },
      required: ['query'],
    },
  },
];

/* ================= 输出格式化 ================= */

function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\r/g, '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 单行化：把内部换行压成空格，用于非命中的上下文 */
function flat(s, n) {
  return clip(s, n).replace(/\s*\n\s*/g, ' ');
}

function fmtSearch(res, bind) {
  const hits = (res && res.hits) || [];
  const who = bind ? '会话 ' + bind + ' ' : '本次会话';
  if (!hits.length) {
    return [
      who + '里没有找到相关内容。',
      // ⚠️ 这里已经是「查过两次」之后的结论：第一次原查询，第二次剔掉查无词重查。
      //   必须写明，否则 AI 会反复用同一组词再试 —— 系统不会自动循环。
      '（已自动重试过一次：剔掉库里查无的词后重查，仍然没有。不要再用同一组关键词反复试。）',
      '提示：换更短的关键词，中文两个字也可以（尾款 / 提单 / 税号）；',
      '如果是刚发生的内容，索引有最多 30 秒延迟，稍等再试或让面板点「索引一次」。',
      '注意：客户端自动塞的「请继续执行任务」这类续跑指令不算对话，默认不返回。',
      '另外：记忆只索引当前这一条会话，别的会话不会出现在这里（用 memory_sessions 看绑定对不对）。',
    ].join('\n');
  }
  const out = [who + '命中 ' + hits.length + ' 处', ''];
  // ⚠️ 用了「剔词重查」才中的，必须说明白 —— 否则 AI 会把结果当成「查询原样命中」，
  //   进而错误地认为那个被剔掉的词（单号/版本号）也在库里。
  if (res && res.retried) {
    const _dropped = Array.isArray(res.dropped) ? res.dropped.join('、') : '';
    out.splice(1, 0,
      '明知「' + _dropped + '」在记忆里从未出现过（已从查询里剔掉），' +
      '下面是改用「' + String(res.retryQuery || '') + '」重查的结果。',
    );
  }
  hits.forEach(function (h, i) {
    out.push('### ' + (i + 1) + '. ' + h.time + '　' + h.role + (h.tool ? ' · ' + h.tool : '')
      + (h.dup > 1 ? '　×' + h.dup + '（同样内容出现过 ' + h.dup + ' 次）' : ''));
    out.push('');
    const ctx = h.context || [];
    ctx.forEach(function (c) {
      // 命中那段留全文轮廓；上下文压成一行；工具命令原文只留开头
      const text = c.self ? clip(c.text, 900) : flat(c.text, c.role === 'tool' ? 160 : 260);
      out.push((c.self ? '▶ ' : '  ') + c.role + (c.tool ? '/' + c.tool : '') + '：' + text);
    });
    out.push('');
  });
  return out.join('\n');
}

function fmtRecent(res, bind) {
  const items = (res && res.items) || [];
  const hours = (res && res.hours) || 6;
  const who = bind ? '会话 ' + bind + ' ' : '';
  if (!items.length) return who + '近 ' + hours + ' 小时内没有记录。';
  const out = [who + '最近 ' + items.length + ' 条（近 ' + hours + ' 小时）', ''];
  for (const it of items) {
    out.push('- ' + it.time + '　' + it.role + '：' + flat(it.text, 300));
  }
  return out.join('\n');
}

function fmtTimeline(res, st) {
  const items = (res && res.items) || [];
  const total = Number(res && res.total) || items.length;
  const act = (st && st.active) || {};
  const head = [];
  if (act.sid) head.push('会话 ' + String(act.sid).slice(0, 8));
  if (st && st.from) head.push(st.from + ' ~ ' + st.to);
  if (st && st.segments) head.push('共 ' + st.segments + ' 条记录');
  const out = [head.join('　') || '当前会话', ''];
  if (!items.length) {
    out.push('（还没取到用户发言，可能索引刚建立）');
    return out.join('\n');
  }
  // 长会话里 80 条只是尾巴，必须写明总条数，否则会被误读成「只提过这么点要求」
  out.push(res && res.truncated
    ? '用户发言共 ' + total + ' 条，下面是最新的 ' + items.length + ' 条（更早的请调大 limit 或改用 memory_search）：'
    : '用户发言 ' + total + ' 条：');
  items.forEach(function (m, i) {
    out.push(i + 1 + '. [' + m.time + '] ' + flat(m.text, 380));
  });
  return out.join('\n');
}

/**
 * 事实检索结果的输出格式。
 *
 * ⚠️ 为什么单独写一份而不复用 fmtSearch：两者回答的问题不同。
 *   原文检索要带「前后文」，因为一条原话脱离上下文可能读不懂；
 *   事实本身就是自包含的一句话，再贴上下文纯属噪声。
 *   混用会把最有价值的「一句话答案」淹没在上下文里。
 */
/**
 * 「别的会话里有这条事实」的提示。
 *
 * ⚠️⚠️ 为什么要加这一段：事实层是**按会话隔离**的（与原文检索同口径）。
 *   实测（本机）：当前绑定的是「整理画册」，8 条事实全在「workbuddy助手」里，
 *   于是 memory_facts('codegraph') 老老实实回答「没找到」——
 *   **答案是对的，但会让人以为功能坏了**。
 *   这里只报「别的会话里有几条」，**不返回内容** —— 不给跨会话取正文的口子，
 *   与 memory_search 的边界保持一致；但至少让调用方知道该去翻哪儿。
 */
function factElsewhere(q) {
  try {
    // ⚠️ 用顶部已经加载过的 ck，不要再二次引入 ck-memory 模块 ——
    //   重复加载会让「零第三方依赖」那条断言（模块引入次数 ≤ 2）变红，
    //   而且同一个模块引两次虽然命中缓存，语义上也没必要。
    if (typeof ck.factCountElsewhere !== 'function') return '';
    const n = ck.factCountElsewhere(q);
    if (!n || !n.count) return '';
    const who = (n.sids || []).slice(0, 3).map((s) => s.short + '(' + s.n + ')').join('、');
    return '⚠️ 别的会话里有 ' + n.count + ' 条相关事实（' + who + ' 条），' +
      '但记忆按会话隔离，这里不跨会话取正文。\n' +
      '要用的话，去面板「记忆 → 事实」页把会话切过去。\n';
  } catch (_) { return ''; }
}

function fmtFacts(res, bind, q) {
  const items = (res && res.items) || [];
  const who = bind ? '会话 ' + bind + ' ' : '本次会话';
  if (!items.length) {
    const via = (res && res.via) || '';
    if (via === 'ENT-MISS') {
      // 这条要明说：查询里带了具体编号，但库里确实没有 —— 绝不能编一个"差不多"的答案
      return who + '的事实库里没有「' + q + '」这个编号 / 版本号。\n' +
        '（带具体标识符的查询只认字面命中，不会拿相似但不同的事实充数 —— ' +
        '如果这里给了「差不多」的结果，那就是在编。）';
    }
    return who + '没有匹配的事实。\n' + factElsewhere(q) +
      '可以换关键词再试；或用 memory_search 查原话（事实可能还没提炼出来）。';
  }
  const out = [];
  const live = items.filter((x) => !x.expired).length;
  out.push(who + '的事实：命中 ' + items.length + ' 条' +
    (live !== items.length ? '（其中 ' + (items.length - live) + ' 条已失效）' : ''));
  out.push('');
  for (const it of items) {
    const when = it.validFrom ? new Date(Number(it.validFrom)).toISOString().slice(0, 10) : '';
    const flag = it.expired
      ? '〔已于 ' + (it.validTo ? new Date(Number(it.validTo)).toISOString().slice(0, 10) : '?') + ' 失效〕'
      : '';
    out.push('· ' + it.text);
    const meta = [it.kind || 'other', when, flag].filter(Boolean).join(' · ');
    if (meta) out.push('  ' + meta);
  }
  out.push('');
  out.push('（事实是从对话里提炼的一句话结论。要核对原话请用 memory_search。）');
  return out.join('\n');
}

function fmtSessions(res) {
  const act = (res && res.active) || null;
  const list = (res && res.indexed) || [];
  const out = [];
  out.push('当前绑定：' + (act
    ? '会话 ' + act.short + '（该文件最近写入 ' + act.mtime + '）'
    : '没找到任何会话文件'));
  out.push('已建索引：' + list.length + ' 条会话（跟踪 ' + (res.followed || 0) +
    ' 条，磁盘上共 ' + (res.onDisk || 0) + ' 条）');
  out.push('');
  if (!list.length) {
    out.push('（还没有任何索引，面板「记忆」页点「索引一次」）');
  } else {
    for (const s of list) {
      const cur = act && s.short === act.short ? '← 当前' : '';
      out.push('  ' + s.short + '　' + String(s.rows).padStart(6) + ' 条　' + (s.lastTs || '') + '　' + cur);
    }
  }
  out.push('');
  out.push('说明：检索永远只查「当前绑定」这一条会话，不会跨会话取内容。');
  out.push('如果绑定不对，去面板「记忆」页看会话列表，确认哪条是当前会话。');
  return out.join('\n');
}

/* ================= 工具执行 ================= */

function callTool(name, args) {
  args = args || {};
  try {
    // 绑定信息统一在这里取一次：三个查询工具都在同一份快照上工作
    const bind = (() => {
      try {
        const a = ck.findActiveSession({ fresh: true });
        return a ? a.sid.slice(0, 8) : '';
      } catch (_) { return ''; }
    })();
    if (name === 'memory_search') {
      if (!args.query) return fail('缺少 query 参数');
      const q = String(args.query);
      const res = ck.search(q, Math.min(Number(args.limit) || 8, 30));
      return ok(fmtSearch(res, bind));
    }
    if (name === 'memory_recent') {
      const hours = Number(args.hours) || 6;
      const res = ck.recent(hours, Math.min(Number(args.limit) || 30, 100));
      return ok(fmtRecent(res, bind));
    }
    if (name === 'memory_timeline') {
      // ⚠️ timeline() 内部已只取「最近 N 条」并翻成正序，别在这里再排序。
      const res = ck.timeline(Math.min(Number(args.limit) || 80, 300));
      return ok(fmtTimeline(res || {}, ck.status()));
    }
    if (name === 'memory_sessions') {
      return ok(fmtSessions(ck.mcpSessions()));
    }
    if (name === 'memory_facts') {
      if (!args.query) return fail('缺少 query 参数');
      if (typeof ck.facts !== 'function') {
        return fail('这条记忆模块版本还不支持事实层（是不是没重启 daemon？）');
      }
      const q = String(args.query);
      const res = ck.facts(q, Math.min(Number(args.limit) || 8, 20), !!args.includeExpired);
      return ok(fmtFacts(res, bind, q));
    }
    return fail('未知工具：' + name);
  } catch (e) {
    return fail('执行出错：' + (e && e.message ? e.message : String(e)));
  }
}

function ok(text) { return { content: [{ type: 'text', text: text }] }; }
function fail(text) { return { content: [{ type: 'text', text: text }], isError: true }; }

/* ================= JSON-RPC ================= */

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id: id, result: result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }); }

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const id = msg.id;
  const method = msg.method;
  // 通知（没有 id）不需要回包
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    const pv = (msg.params && msg.params.protocolVersion) || DEFAULT_PROTOCOL;
    return reply(id, {
      protocolVersion: pv,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') return;

  if (method === 'ping') return reply(id, {});

  if (method === 'tools/list') return reply(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const p = msg.params || {};
    const name = p.name;
    const args = p.arguments || p.args || {};
    return reply(id, callTool(name, args));
  }

  // resources / prompts 一律当作不支持
  if (isNotification) return;
  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });
  return replyErr(id, -32601, 'Method not found: ' + method);
}

/* ================= 主循环 ================= */

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    try { handle(msg); } catch (e) {
      if (msg && msg.id !== undefined) replyErr(msg.id, -32603, String((e && e.message) || e));
    }
  }
});

process.stdin.on('end', function () {
  try { if (ck && ck.stopAll) ck.stopAll(); } catch (_) { }
  process.exit(0);
});

process.on('uncaughtException', function (e) {
  process.stderr.write('[ck-mcp] uncaught: ' + ((e && e.stack) || e) + '\n');
});
