// 端到端：走真实 MCP stdio 协议，验三件事
//   ① 工具描述里是否已告知 AI「会重试、别循环」
//   ② 剔词重查命中时，输出是否讲清了剔掉哪个词
//   ③ 未命中时，输出是否说明「已重试过一次，别再循环」
const path = require('path');
const { spawn } = require('child_process');

const MCP = path.resolve(__dirname, '..', '..', 'scripts', 'ck-mcp.js');

const child = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on('data', () => {});

let seq = 1;
function rpc(method, params) {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error('超时: ' + method)), 30000);
  });
}

function textOf(msg) {
  try { return msg.result.content.map((c) => c.text).join('\n'); } catch (_) { return JSON.stringify(msg); }
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'probe', version: '1.0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // ① 工具描述
  const list = await rpc('tools/list', {});
  const tools = (list.result && list.result.tools) || [];
  console.log('===== 工具列表 =====');
  for (const t of tools) console.log('  - ' + t.name);
  const ms = tools.find((t) => t.name === 'memory_search');
  console.log('\n===== memory_search 描述 =====');
  console.log(ms ? ms.description : '(未找到)');

  // ② 剔词重查命中
  const crypto = require('crypto');
  const fake = 'ABC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  console.log('\n===== ② 剔词重查命中（虚构编号 ' + fake + '）=====');
  const r2 = await rpc('tools/call', { name: 'memory_search', arguments: { query: 'WAL 只增不减 ' + fake, limit: 3 } });
  console.log(textOf(r2).slice(0, 700));

  // ③ 完全未命中
  const crypto2 = require('crypto');
  const fake2 = 'ZZQ' + crypto2.randomBytes(3).toString('hex').toUpperCase();
  console.log('\n===== ③ 完全未命中（虚构词 ' + fake2 + '）=====');
  const r3 = await rpc('tools/call', { name: 'memory_search', arguments: { query: fake2 + ' 那不勒斯 披萨 配方', limit: 3 } });
  console.log(textOf(r3));

  child.kill();
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); child.kill(); process.exit(1); });
