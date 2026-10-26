#!/usr/bin/env node
/**
 * dsh-ops 集成守卫（WorkDaddy × T-Auto/dsh-ops）
 *
 * 覆盖四层：
 *   A 桥脚本随包完整性 / B daemon 路由与函数 / C inject 面板卡 / D 纯函数真值（vm 切片）/ E mac 白名单
 *
 * ⚠️ D 组用 vm 从 daemon.js 源码**切片**出纯函数跑，**不 require 整份 daemon**
 *    （require 会启动守护进程）。切片按「顶格 function 起、下一个顶格声明止」。
 *
 * 汇总行格式：结果：N 通过 / M 失败
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('✓ ' + label); }
  else { fail += 1; console.log('✗ ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts/daemon.js'), 'utf8');
const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts/inject.js'), 'utf8');
const bridgePath = path.join(ROOT, 'scripts/dsh-ops-bridge.mjs');
const bridgeExists = fs.existsSync(bridgePath);
const bridgeSrc = bridgeExists ? fs.readFileSync(bridgePath, 'utf8') : '';

// ── A. 桥脚本随包完整性 ──
ok(bridgeExists, 'A1 桥脚本 scripts/dsh-ops-bridge.mjs 随包存在');
ok(bridgeSrc.startsWith('#!/usr/bin/env node'), 'A2 桥脚本带 shebang');
ok(/SERVER_VERSION\s*=\s*'[\d.]+-wb\d+'/.test(bridgeSrc), 'A3 桥脚本带 -wb 版本标记（与上游区分）');
[
  ["'tools/list'", 'tools/list 方法'],
  ["'tools/call'", 'tools/call 方法'],
  ["'initialize'", 'initialize 握手'],
  ["path.join(HERE, 'bin', 'dsh-ops-worker.exe')", 'worker 路径基于 HERE（可整体搬迁）'],
  ['DSH_OPS_ROOT', 'DSH_OPS_ROOT 覆盖'],
  ['read_only', 'read_only 只读策略'],
].forEach(([t, label], i) => { ok(bridgeSrc.includes(t), 'A4.' + (i + 1) + ' 桥含 ' + label); });
ok(!bridgeSrc.includes('@modelcontextprotocol/sdk'), 'A5 桥零第三方依赖（不引 MCP SDK）');
{
  const imports = Array.from(bridgeSrc.matchAll(/from\s+'([^']+)'/g)).map((m) => m[1]);
  ok(imports.length > 0 && imports.every((x) => x.startsWith('node:')), 'A5b 桥只依赖 node 内置模块（无第三方 import）', imports.join(' '));
  ok(bridgeSrc.includes('[root, os.tmpdir()]'), 'A5c 桥 write_roots 圈定 root + 临时目录（对齐上游 workspace-write 语义）');
}
ok((bridgeSrc.match(/(?<!\r)\n/g) || []).length === 0, 'A6 桥脚本纯 CRLF', (bridgeSrc.match(/(?<!\r)\n/g) || []).length);

// ── B. daemon 路由与函数 ──
['/api/dsh-ops/status', '/api/dsh-ops/install', '/api/dsh-ops/toggle', '/api/dsh-ops/uninstall'].forEach((r, i) => {
  ok(daemonSrc.includes("p === '" + r + "'"), 'B1.' + (i + 1) + ' 路由 ' + r);
});
['dshOpsStatus', 'dshOpsInstall', 'dshOpsToggle', 'dshOpsUninstall', 'dshOpsRegister', 'dshOpsUntar', 'dshOpsVerifyIntegrity', 'dshOpsHttpGet', 'dshOpsFindNodeExe', 'dshOpsInspectDir', 'dshOpsReadMcp'].forEach((fn, i) => {
  ok(daemonSrc.includes('function ' + fn + '('), 'B2.' + (i + 1) + ' 函数 ' + fn);
});
ok((daemonSrc.match(/sha512-/g) || []).length >= 2, 'B3 固定了两个包的 sha512 integrity');
ok(daemonSrc.includes('dsh-ops-0.3.0.tgz') && daemonSrc.includes('fastctx-win32-x64-0.2.1.tgz'), 'B4 固定上游包版本（可复现）');
ok(daemonSrc.includes('WORKDADDY_DSH_OPS_REGISTRY'), 'B5 支持镜像源环境变量');
ok(daemonSrc.includes("if (!IS_WIN) throw new Error('当前平台不支持"), 'B6 非 Windows 平台显式拒绝');
ok(daemonSrc.includes("path.resolve(managed.dir) === path.resolve(DSH_OPS_DIR)"), 'B7 卸载有「目录精确相等」守卫');
ok(daemonSrc.includes('managed.manifest &&'), 'B7b 卸载要求托管安装（有 manifest）才删目录');
ok(daemonSrc.includes('mcp.json 解析失败（已中止，未改动文件）'), 'B8 mcp.json 损坏时拒绝覆盖');
ok((daemonSrc.match(/(?<!\r)\n/g) || []).length === 0, 'B9 daemon.js 纯 CRLF', (daemonSrc.match(/(?<!\r)\n/g) || []).length);

// ── C. inject 面板卡 ──
['wbs-dshops-card', 'wbs-dshops-body', 'wbs-dshops-status', 'loadDshOps', 'wbs-dshops-btn'].forEach((t, i) => {
  ok(injectSrc.includes(t), 'C1.' + (i + 1) + ' 面板含 ' + t);
});
ok(!injectSrc.includes('wbs-mcp-card') && !injectSrc.includes('loadMcpServers'), 'C2 旧通用 MCP 卡已彻底移除');
['/api/dsh-ops/status', '/api/dsh-ops/install', '/api/dsh-ops/toggle', '/api/dsh-ops/uninstall'].forEach((r, i) => {
  ok(injectSrc.includes("api('" + r + "'"), 'C3.' + (i + 1) + ' 前端调用 ' + r);
});
ok(injectSrc.includes('.wbs-dshops-btn.primary'), 'C4 有主按钮样式');
ok(injectSrc.includes('html[data-theme="dark"] .wbs-dshops-btn'), 'C5 有暗色适配');
ok(injectSrc.includes('data-armed'), 'C6 卸载走二次确认（armed）');
ok(injectSrc.includes('d.supported'), 'C7 前端处理「平台不支持」分支');

// ── D. 纯函数真值（vm 切片）──
function extractTop(src, name) {
  const lines = src.split(/\r?\n/);
  const i = lines.findIndex((x) => x.startsWith('function ' + name + '('));
  if (i < 0) return null;
  let j = lines.length;
  for (let k = i + 1; k < lines.length; k += 1) {
    if (/^(function |const |let |var )/.test(lines[k])) { j = k; break; }
  }
  return lines.slice(i, j).join('\n');
}

const sandbox = { Buffer, require, crypto, console: { log() {} }, module: { exports: {} } };
vm.createContext(sandbox);
const sliceCode = [extractTop(daemonSrc, 'dshOpsUntar'), extractTop(daemonSrc, 'dshOpsVerifyIntegrity')]
  .filter(Boolean)
  .join('\n')
  + '\nmodule.exports = { dshOpsUntar: typeof dshOpsUntar !== "undefined" ? dshOpsUntar : null, dshOpsVerifyIntegrity: typeof dshOpsVerifyIntegrity !== "undefined" ? dshOpsVerifyIntegrity : null };';

let mod = { dshOpsUntar: null, dshOpsVerifyIntegrity: null };
try { vm.runInContext(sliceCode, sandbox); mod = sandbox.module.exports; } catch (e) { console.log('  （vm 切片异常：' + e.message + '）'); }
ok(typeof mod.dshOpsUntar === 'function', 'D0 vm 切片取到 dshOpsUntar');
ok(typeof mod.dshOpsVerifyIntegrity === 'function', 'D0b vm 切片取到 dshOpsVerifyIntegrity');

/** 构造最小 ustar 归档（只填解析器实际读取的字段）。 */
function makeTar(entries) {
  const parts = [];
  entries.forEach((e) => {
    const content = Buffer.from(e.content, 'utf8');
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100, 8);
    h.write('0000000\0', 108, 8);
    h.write('0000000\0', 116, 8);
    h.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    h.write('00000000000\0', 136, 12);
    h.write('        ', 148, 8);
    h.write('0', 156, 1);
    h.write('ustar\0', 257, 6);
    parts.push(h, content, Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length));
  });
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

if (typeof mod.dshOpsUntar === 'function') {
  const tar = makeTar([
    { name: 'package/bin/fastctx.exe', content: 'MZ-fake-fastctx' },
    { name: 'package/LICENSE.txt', content: 'Apache-2.0' },
    { name: 'package/runtime/win32-x64/dsh-ops-worker.exe', content: 'MZ-fake-worker' },
  ]);
  const files = mod.dshOpsUntar(tar);
  ok(files['package/bin/fastctx.exe'] && files['package/bin/fastctx.exe'].toString('utf8') === 'MZ-fake-fastctx', 'D1 tar 解析：首项内容正确');
  ok(files['package/runtime/win32-x64/dsh-ops-worker.exe'] && files['package/runtime/win32-x64/dsh-ops-worker.exe'].toString('utf8') === 'MZ-fake-worker', 'D2 tar 解析：深层路径项正确（worker 在上游包内的真实位置）');
  ok(Object.keys(files).length === 3, 'D3 tar 解析：条目数 = 3', Object.keys(files).length);
  let crashed = false;
  try { mod.dshOpsUntar(tar.subarray(0, 100)); } catch (_) { crashed = true; }
  ok(!crashed, 'D4 tar 解析：截断输入不抛异常');
  crashed = false;
  try { mod.dshOpsUntar(Buffer.alloc(0)); } catch (_) { crashed = true; }
  ok(!crashed, 'D4b tar 解析：空输入不抛异常');
}

if (typeof mod.dshOpsVerifyIntegrity === 'function') {
  const b = Buffer.from('hello-workdaddy', 'utf8');
  const good = 'sha512-' + crypto.createHash('sha512').update(b).digest('base64');
  let threw = false;
  try { mod.dshOpsVerifyIntegrity(b, good); } catch (_) { threw = true; }
  ok(!threw, 'D5 sha512 校验：正确值通过');
  threw = false;
  try { mod.dshOpsVerifyIntegrity(b, 'sha512-' + 'A'.repeat(86) + '=='); } catch (_) { threw = true; }
  ok(threw, 'D6 sha512 校验：错误值被拒');
  threw = false;
  try { mod.dshOpsVerifyIntegrity(b, ''); } catch (_) { threw = true; }
  ok(threw, 'D7 sha512 校验：缺失 integrity 被拒');
  threw = false;
  try { mod.dshOpsVerifyIntegrity(b, 'sha512-'); } catch (_) { threw = true; }
  ok(threw, 'D7b sha512 校验：空摘要被拒');
}

// ── E. mac 打包白名单 ──
const macSh = fs.readFileSync(path.join(ROOT, 'scripts/build-mac-dmg.sh'), 'utf8');
const macHits = (macSh.match(/dsh-ops-bridge\.mjs/g) || []).length;
ok(macHits === 2, 'E1 mac 白名单两处都含 dsh-ops-bridge.mjs（拷贝列表 + chmod 列表）', macHits);

console.log('');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
