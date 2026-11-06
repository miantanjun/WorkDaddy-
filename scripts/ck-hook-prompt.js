#!/usr/bin/env node
'use strict';
/**
 * ck-hook-prompt.js —— 发消息前自动注入记忆（UserPromptSubmit hook）
 * =====================================================================
 * 由 WorkBuddy 在「用户提交提示词后、模型处理前」调用，stdin 收到一份 JSON，
 * 本脚本检索本机记忆库，把用得上的旧记忆拼成 additionalContext 交回宿主。
 *
 * 为什么是独立进程而不是 daemon 里的定时器：
 *   · hook 由宿主在**每次发消息**时同步调用，天然拿到 session_id + prompt；
 *   · daemon 里的定时器不知道用户何时开口，只会定期扫库，还得靠 mtime 猜会话。
 *   代价是每次要新起一个 node 进程（实测 require + 检索约 36ms），可接受。
 *
 * ⚠️⚠️⚠️ 三条铁律：
 *   1. **永远 exit 0**。除 0 以外的退出码会被宿主当成 hook 失败，
 *      最坏情况会让用户的消息发不出去 —— 记忆插件没有资格阻断主流程。
 *   2. **stdout 只能输出那一个 JSON 对象**。多余输出会被当成决策回给宿主。
 *   3. **不写任何用户内容到日志**。只记长度、原因码、命中条数。
 *
 * 输出格式（宿主接受的形式）：
 *   { continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '...' } }
 * 没有可注入内容时**直接静默退出**（不输出任何东西），避免干扰。
 */

const path = require('path');

/** 出任何问题都要静默退出：这是每次发消息的必经路径。 */
function bail() {
  try { process.exit(0); } catch (_) {}
}

let raw = '';
let closed = false;

function handle() {
  if (closed) return;
  closed = true;
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = {}; }

  // 子 agent（Agent 工具派生的）不注入：它们的上下文独立，注入会造成重复与串味
  try {
    const at = String((payload && payload.agent_type) || '');
    if (at && at !== 'main' && at !== 'cli') bail();
  } catch (_) {}

  let ctx = '';
  try {
    // ⚠️ 必须用绝对路径 require：hook 的 cwd 是用户工作目录，不是脚本目录。
    const ck = require(path.join(__dirname, 'ck-memory.js'));
    // ⚠️ daemon 的 configure 在别的进程里，这里必须自己配一次，
    //   否则 baseDir() 会退回到默认 %APPDATA%\WorkDaddy，与真实数据目录不一致时读不到库。
    const os = require('os');
    const dataDir = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'WorkDaddy')
      : path.join(os.homedir(), 'AppData', 'Roaming', 'WorkDaddy');
    ck.configure({
      dataRoot: path.join(os.homedir(), '.workbuddy'),
      dataDir: dataDir,
      log: () => {},   // hook 进程不写日志文件：生命周期太短，写日志纯属浪费
    });
    const r = ck.promptInjection(payload);
    ctx = String((r && r.additionalContext) || '');
  } catch (_) {
    ctx = '';
  }

  if (!ctx) bail();

  try {
    process.stdout.write(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: ctx,
      },
    }));
  } catch (_) {}
  try { process.exit(0); } catch (_) {}
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; if (raw.length > 4e6) raw = raw.slice(0, 4e6); });
process.stdin.on('end', handle);
process.stdin.on('error', bail);
// 宿主万一不写 stdin 或不关流：1.2 秒后自己走完，绝不拖住发送
setTimeout(handle, 1200).unref();
