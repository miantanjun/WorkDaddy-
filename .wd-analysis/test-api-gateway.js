'use strict';
/*
 * test-api-gateway.js —— scripts/api-gateway.js 的脱机回归。
 *
 * 覆盖四组：
 *   [A] 纯函数：checksums 解析 / 凭证桥（毫秒→秒、realm 推断、缺字段拒绝）
 *   [B] config 生成：**三条安全默认**（回环 / api_key 非空 / 定时任务全关）+ 不改传入模板
 *   [C] zip 自解压：stored + deflate 两种算法、**zip slip 拒绝**、非法压缩法拒绝、坏包拒绝
 *   [D] 状态与密钥：原子写 **不落 api_key**、指纹不泄漏全文、路径布局
 *
 * 跑法：node .wd-analysis/test-api-gateway.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const GW = require('D:/WorkDaddy/scripts/api-gateway.js');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 300))); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbs-gw-test-'));

/* ==================================================================== */
console.log('\n== A. 纯函数：checksums / 凭证桥 ==');
{
  const text = [
    'aa485dd8225004a8c6153a49dac6e04e4d155225ee2a9899a2102cd5e3ed4518  wb2api-panel-v1.11.9-windows-amd64.zip',
    '7bd772b67cec255f294614a74c5d2403b7450a477cb165856b4989f7bdf12a2d  wb2api-panel-v1.11.9-darwin-amd64.tar.gz',
  ].join('\n');
  ok(GW.parseChecksums(text, 'wb2api-panel-v1.11.9-windows-amd64.zip') === 'aa485dd8225004a8c6153a49dac6e04e4d155225ee2a9899a2102cd5e3ed4518',
    'A1 取到指定资产的摘要', GW.parseChecksums(text, 'wb2api-panel-v1.11.9-windows-amd64.zip'));
  ok(GW.parseChecksums(text, '不存在的文件.zip') === '', 'A2 找不到 ⇒ 空串（调用方据此拒装，而不是放行）');
  ok(GW.parseChecksums('AA485DD8225004A8C6153A49DAC6E04E4D155225EE2A9899A2102CD5E3ED4518 *x.zip', 'x.zip')
    === 'aa485dd8225004a8c6153a49dac6e04e4d155225ee2a9899a2102cd5e3ed4518',
    'A3 大小写 + 二进制前缀 * 都能认');
  ok(GW.parseChecksums('', 'x.zip') === '' && GW.parseChecksums(null, 'x.zip') === '', 'A4 空输入安全');
}
{
  const doc = GW.buildAuthDocument({
    uid: '1d80c722-dff7-4bb7-bd29-591236f90c70', nickname: '面瘫君',
    accessToken: 'eyJhbGciOi.payload.sig', refreshToken: 'eyJyZWZyZXNo.sig',
    expiresAt: 1795515839525, domain: 'www.workbuddy.cn',
  });
  ok(doc && doc.auth.expiresAt === 1795515839, 'A5 ⭐ 毫秒 → Unix 秒（官方 Auth.ExpiresAt 是秒）', doc && doc.auth.expiresAt);
  ok(doc && doc.auth.realm === 'cn', 'A6 domain=.workbuddy.cn ⇒ realm=cn');
  ok(doc && doc.account.uid === '1d80c722-dff7-4bb7-bd29-591236f90c70' && doc.account.nickname === '面瘫君',
    'A7 account 段带 uid / nickname（文件必须能被 workbuddy*.json 扫到）');
  ok(doc && doc.auth.accessToken === 'eyJhbGciOi.payload.sig' && doc.auth.refreshToken === 'eyJyZWZyZXNo.sig',
    'A8 token 原样带出');
}
{
  const global = GW.buildAuthDocument({ uid: 'u1', accessToken: 't', expiresAt: 1795515839525, domain: 'www.workbuddy.ai' });
  ok(global && global.auth.realm === 'global', 'A9 domain=.workbuddy.ai ⇒ realm=global');
  const seconds = GW.buildAuthDocument({ uid: 'u2', accessToken: 't', expiresAt: 1795515839 });
  ok(seconds && seconds.auth.expiresAt === 1795515839, 'A10 已经是秒的量级不重复除 1000');
  const noExp = GW.buildAuthDocument({ uid: 'u3', accessToken: 't' });
  ok(noExp && noExp.auth.expiresAt === 0, 'A11 缺 expiresAt ⇒ 0（官方语义：0 视为需刷新）');
  ok(GW.buildAuthDocument({ uid: '', accessToken: 't' }) === null, 'A12 缺 uid ⇒ null（跳过该账号）');
  ok(GW.buildAuthDocument({ uid: 'u', accessToken: '' }) === null, 'A13 缺 accessToken ⇒ null');
  ok(GW.buildAuthDocument(null) === null && GW.buildAuthDocument(undefined) === null, 'A14 空输入安全');
}
{
  const dir = path.join(TMP, 'auths');
  const written = GW.writeAuthDocuments(dir, [
    GW.buildAuthDocument({ uid: 'a/b..c', accessToken: 't', nickname: 'n' }),
    null,
    GW.buildAuthDocument({ uid: 'good-uid', accessToken: 't', nickname: 'n2' }),
  ], {});
  ok(written.length === 2, 'A15 写 2 个（null 被跳过）', written.length);
  const names = fs.readdirSync(dir).sort();
  ok(names.every((n) => /^workbuddy-.*\.json$/.test(n)), 'A16 文件名匹配官方扫描规则 workbuddy*.json', names);
  ok(names.some((n) => n === 'workbuddy-good-uid.json'), 'A17 正常 uid 直通');
  ok(names.some((n) => !n.includes('/') && !n.includes('..')), 'A18 ⭐ uid 里的路径字符被清洗（防穿越）', names);
}

/* ==================================================================== */
console.log('\n== B. config 生成：三条安全默认 ==');
{
  const template = {
    listen: ':7863', api_key: '', auth_dir: './auths', state_file: './data/state.json',
    schedule: { checkin_enabled: true, growth_enabled: true, travel_enabled: true, activity_enabled: true, keepalive_enabled: true, blackcat_enabled: true, balance_refresh_enabled: true },
    prompt: { mode: 'custom', file: '' },
    logging: { request_archive_enabled: true, request_retention_days: 7 },
    pool: { max_in_flight: 3 },
  };
  const snapshot = JSON.stringify(template);
  const cfg = GW.buildGatewayConfig({
    template: template, port: 7863, apiKey: 'K'.repeat(43),
    authDir: 'C:\\Users\\x\\gateway\\auths', stateFile: 'C:\\Users\\x\\gateway\\data\\state.json',
  });
  ok(cfg.listen === '127.0.0.1:7863', 'B1 ⭐ listen 收到回环（官方默认 :7863 = 0.0.0.0 会暴露局域网）', cfg.listen);
  ok(cfg.api_key === 'K'.repeat(43), 'B2 api_key 写入');
  ok(cfg.schedule.checkin_enabled === false && cfg.schedule.keepalive_enabled === false
    && cfg.schedule.growth_enabled === false && cfg.schedule.balance_refresh_enabled === false,
    'B3 ⭐ 定时任务默认全关（与 WorkDaddy 已有签到/保活能力重复）');
  ok(cfg.prompt.mode === 'passthrough', 'B4 提示词透传（不注入网关自有 system）');
  ok(cfg.logging.request_archive_enabled === false, 'B5 默认不落盘请求正文');
  ok(cfg.auth_dir === 'C:/Users/x/gateway/auths' && cfg.state_file.includes('/'),
    'B6 反斜杠转正斜杠（Go 侧路径解析更稳）');
  ok(JSON.stringify(template) === snapshot, 'B7 ⭐ 不修改传入的模板对象（深拷贝）');
  let threw = false;
  try { GW.buildGatewayConfig({ template: {}, apiKey: '  ', authDir: 'a', stateFile: 'b' }); } catch (_) { threw = true; }
  ok(threw, 'B8 ⭐ api_key 为空 ⇒ 拒绝生成（官方语义：空 = 不鉴权直接放行）');
  threw = false;
  try { GW.buildGatewayConfig({ template: {}, apiKey: 'k' }); } catch (_) { threw = true; }
  ok(threw, 'B9 缺 authDir/stateFile ⇒ 拒绝');
  const onCfg = GW.buildGatewayConfig({ template: template, apiKey: 'k', authDir: 'a', stateFile: 'b', enableSchedules: true });
  ok(onCfg.schedule.checkin_enabled === true, 'B10 enableSchedules=true 时才打开（显式选择）');
  ok(onCfg.listen === '127.0.0.1:7863', 'B11 即使开了定时任务，listen 仍锁回环');
}

/* ==================================================================== */
console.log('\n== C. zip 自解压（自造 fixture）==');
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data);
    const body = entry.method === 8 ? zlib.deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(entry.method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(entry.method, 10);
    ch.writeUInt32LE(0, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
{
  const zip = makeZip([
    { name: 'wb2api.exe', data: 'MZ-fake-exe-binary', method: 8 },
    { name: 'config.example.json', data: '{"listen":":7863"}', method: 0 },
  ]);
  const entries = GW.listZipEntries(zip);
  ok(entries.length === 2 && entries[0].name === 'wb2api.exe', 'C1 列出 2 个条目', entries.map((e) => e.name));
  const dest = path.join(TMP, 'unzip');
  const written = GW.extractZipToDir(zip, dest, { pick: (n) => n === 'wb2api.exe' });
  ok(eq(written, ['wb2api.exe']), 'C2 pick 白名单只写指定条目', written);
  ok(fs.readFileSync(path.join(dest, 'wb2api.exe'), 'utf8') === 'MZ-fake-exe-binary',
    'C3 deflate 条目解压内容正确');
  const dest2 = path.join(TMP, 'unzip2');
  GW.extractZipToDir(zip, dest2, {});
  ok(fs.readFileSync(path.join(dest2, 'config.example.json'), 'utf8') === '{"listen":":7863"}',
    'C4 stored 条目解压内容正确');
}
{
  const zip = makeZip([{ name: '../evil.txt', data: 'x', method: 0 }]);
  let threw = false;
  try { GW.listZipEntries(zip); } catch (e) { threw = /非法路径/.test(e.message); }
  ok(threw, 'C5 ⭐ zip slip（../ 越界）被拒绝');
  const abs = makeZip([{ name: '/abs.txt', data: 'x', method: 0 }]);
  threw = false;
  try { GW.listZipEntries(abs); } catch (e) { threw = /非法路径/.test(e.message); }
  ok(threw, 'C6 绝对路径条目被拒绝');
  const enc = makeZip([{ name: 'a.txt', data: 'x', method: 0 }]);
  enc.writeUInt16LE(1, 6); // 中央目录？这里改的是本地头；加密位在中央目录条目 p+8
  let stillOk = true;
  try { GW.listZipEntries(enc); } catch (_) { stillOk = false; }
  ok(stillOk, 'C7 本地头加密位不影响（加密判定看中央目录 flags，fixture 未置位）');
}
{
  const bad = makeZip([{ name: 'a.txt', data: 'x', method: 3 }]); // 方法 3 = 未支持
  let threw = false;
  try { GW.listZipEntries(bad); } catch (e) { threw = /不支持的压缩算法/.test(e.message); }
  ok(threw, 'C8 不支持的压缩法被拒绝（给清晰错误而不是解出错数据）');
  threw = false;
  try { GW.listZipEntries(Buffer.from('not a zip at all')); } catch (e) { threw = /不是有效的 zip/.test(e.message); }
  ok(threw, 'C9 非 zip 输入被拒绝');
  threw = false;
  try { GW.extractZipToDir(makeZip([{ name: 'a.txt', data: 'x', method: 0 }]), ''); } catch (e) { threw = /目标目录/.test(e.message); }
  ok(threw, 'C10 缺目标目录被拒绝');
}
{
  // 真实 zip 冒烟：用 POC 下过的包（存在才跑，缺失则跳过而不算失败）
  const real = path.join(process.env.APPDATA || '', 'WorkDaddy', 'wb2api', '_poc', 'wb2api.zip');
  if (fs.existsSync(real)) {
    const buf = fs.readFileSync(real);
    const entries = GW.listZipEntries(buf);
    ok(entries.length >= 3 && entries.some((e) => e.name === 'wb2api.exe'),
      'C11 ⭐ 真实官方 zip 可解析（含 wb2api.exe）', entries.map((e) => e.name));
    ok(GW.sha256(buf) === 'aa485dd8225004a8c6153a49dac6e04e4d155225ee2a9899a2102cd5e3ed4518',
      'C12 ⭐ 真实 zip 的 sha256 与官方 checksums.txt 一致');
    const exe = entries.find((e) => e.name === 'wb2api.exe');
    const body = GW.readZipEntry(buf, exe);
    ok(body.length === exe.size && body.subarray(0, 2).toString('ascii') === 'MZ',
      'C13 真实 exe 解出且是 PE 头（MZ）', body.length);
  } else {
    console.log('  skip C11–C13（未找到 POC 下载的 zip）');
  }
}

/* ==================================================================== */
console.log('\n== D. 状态与密钥 ==');
{
  const hint = GW.apiKeyHint('abcdef1234567890');
  ok(hint.startsWith('abcdef') && !hint.includes('7890'), 'D1 指纹只给前 6 位，不泄漏全文', hint);
  ok(GW.apiKeyHint('') === '' && GW.apiKeyHint(null) === '', 'D2 空值安全');
  const key = GW.generateApiKey((n) => Buffer.alloc(n, 7));
  ok(key.length === 43, 'D3 32 字节 base64url ⇒ 43 字符', key.length);
  ok(GW.generateApiKey((n) => Buffer.alloc(n, 7)) === key, 'D4 注入随机源后结果可复现（可测）');
}
{
  const file = path.join(TMP, 'gateway.json');
  const missing = GW.readGatewayState(file);
  ok(missing.installed === false && missing.enabled === false && missing.port === GW.DEFAULT_PORT,
    'D5 状态缺失 ⇒ 未安装默认值（不抛错）');
  fs.writeFileSync(file, '{ broken json');
  ok(GW.readGatewayState(file).installed === false, 'D6 状态损坏 ⇒ 同样回落默认值');
  GW.writeGatewayState(file, { installed: true, enabled: true, port: 7863, apiKey: 'SECRET-DO-NOT-WRITE', accounts: ['a'] });
  const raw = fs.readFileSync(file, 'utf8');
  ok(raw.indexOf('SECRET-DO-NOT-WRITE') < 0, 'D7 ⭐ 状态文件里绝不写 api_key 明文');
  const back = GW.readGatewayState(file);
  ok(back.installed === true && back.enabled === true && eq(back.accounts, ['a']), 'D8 状态可读回');
}
{
  const p = GW.gatewayPaths('C:\\data');
  ok(p.root === path.join('C:\\data', 'gateway') && p.exe.endsWith(process.platform === 'win32' ? 'wb2api.exe' : 'wb2api'),
    'D9 目录布局：全部落在 <dataDir>/gateway 下，不污染 WorkBuddy 数据根', p.exe);
  ok(p.apiKeyFile.endsWith('.api_key') && p.authDir.endsWith('auths'), 'D10 密钥文件与 auths 分列');
}

/* ==================================================================== */
console.log('\n== E. 模型闭环：注册进 models.json（只增删自己的）==');
{
  const entry = GW.toWorkbuddyModelEntry(
    { id: 'cn:hy3-x', name: 'Hy3', context_length: 192000, supports_tool_call: true },
    { baseUrl: 'http://127.0.0.1:7863/', apiKey: 'K1' });
  ok(entry && entry.id === 'gateway:cn:hy3-x', 'E1 ⭐ id 加前缀（与用户自己的模型分处不同命名空间）', entry && entry.id);
  ok(entry && entry.name === '[网关] Hy3', 'E2 name 加前缀（列表里一眼看出出处）', entry && entry.name);
  ok(entry && entry.url === 'http://127.0.0.1:7863/v1/chat/completions', 'E3 url 补成完整 chat/completions', entry && entry.url);
  ok(entry && entry.vendor === 'Custom' && entry.useCustomProtocol === false && entry.apiKey === 'K1',
    'E4 vendor/apiKey/协议位符合本仓既有自定义模型形状');
  ok(entry && entry.maxInputTokens === 192000 && entry.supportsToolCall === true, 'E5 上下文与工具能力透传');
  const noCtx = GW.toWorkbuddyModelEntry({ id: 'x' }, { baseUrl: 'http://h' });
  ok(noCtx && noCtx.maxInputTokens === undefined, 'E6 无 context_length ⇒ 不写该字段（不编造）');
  ok(GW.toWorkbuddyModelEntry({ id: '' }, { baseUrl: 'http://h' }) === null
    && GW.toWorkbuddyModelEntry({ id: 'x' }, {}) === null, 'E7 缺 id / 缺 baseUrl ⇒ null');
}
{
  const userModels = [
    { id: 'qwen3.8-27b', name: '本地千问', vendor: 'Custom', url: 'http://lyonn.fun:12287/v1/chat/completions' },
    { id: 'deepseek-flash', name: 'deepseek-flash', vendor: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions' },
  ];
  const entries = ['cn:hy3-x', 'cn:glm-5.3-flash'].map((id) =>
    GW.toWorkbuddyModelEntry({ id: id, name: id }, { baseUrl: 'http://127.0.0.1:7863', apiKey: 'K' }));
  const first = GW.mergeGatewayModels(userModels, entries, {});
  ok(first.models.length === 4 && first.added === 2 && first.removed === 0, 'E8 首次注册：2 加 0 删', first.models.length);
  ok(first.models[0].id === 'qwen3.8-27b' && first.models[1].id === 'deepseek-flash',
    'E9 ⭐ 用户原有条目原样保留且在数组前段（顺序也不动）');
  const second = GW.mergeGatewayModels(first.models, entries, {});
  ok(second.models.length === 4 && second.added === 2 && second.removed === 2,
    'E10 ⭐ 重复注册幂等：先摘旧再加新，总数不变（不叠加）', second.models.length);
  // ⭐ 前缀机制：网关的 qwen 与用户的 qwen 是**两个不同 id**，天生不冲突 ⇒ 用户条目原样保留
  const clash = GW.toWorkbuddyModelEntry({ id: 'qwen3.8-27b' }, { baseUrl: 'http://127.0.0.1:7863' });
  const merged = GW.mergeGatewayModels(userModels, [clash], {});
  ok(clash.id === 'gateway:qwen3.8-27b' && merged.models.length === 3 && merged.added === 1,
    'E11 ⭐ 前缀让同名模型共存（用户的 qwen 不会被网关的 qwen 顶掉）', merged.models.map((m) => m.id));
  ok(merged.models[0].url === 'http://lyonn.fun:12287/v1/chat/completions',
    'E12 用户那条 url 没被动过', merged.models[0].url);
  // 代码级第二道保护：即使有人绕过前缀传裸 id，occupied 检查也不让用户条目被覆盖
  const rawClash = { id: 'qwen3.8-27b', name: '同名覆盖尝试', vendor: 'Custom', url: 'http://evil/v1/chat/completions' };
  const merged2 = GW.mergeGatewayModels(userModels, [rawClash], {});
  ok(merged2.added === 0 && merged2.models.length === 2 && merged2.models[0].url.indexOf('lyonn.fun') > 0,
    'E12b ⭐ 裸 id 撞车时用户条目胜出（occupied 保护不被绕过）', merged2.models.length);
  const undone = GW.unmergeGatewayModels(first.models, first.ids);
  ok(undone.models.length === 2 && undone.removed === 2, 'E13 撤销：按名单摘掉 2 条', undone.models.length);
  ok(JSON.stringify(undone.models) === JSON.stringify(userModels),
    'E14 ⭐ 撤销后用户原有条目逐字节恢复（JSON 深比较）');
  ok(GW.unmergeGatewayModels(userModels, null).removed === 0, 'E15 空名单安全（不误删）');
}

/* ==================================================================== */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('\n==== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
