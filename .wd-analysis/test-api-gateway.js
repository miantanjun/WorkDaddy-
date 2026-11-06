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
  const second = GW.mergeGatewayModels(first.models, entries, { baseUrl: 'http://127.0.0.1:7863' });
  ok(second.models.length === 4 && second.added === 0 && second.removed === 0 && second.rewritten === 2,
    'E10 ⭐ 重复注册幂等：原地认领更新（added/removed 都是 0，重写单列 rewritten）', { added: second.added, rewritten: second.rewritten });
  // 用户诉求「在自定义模型里去掉某个」= 取消勾选 → 应用；被取消的那个才算 removed
  const partial = GW.mergeGatewayModels(first.models, [entries[0]], { baseUrl: 'http://127.0.0.1:7863' });
  ok(partial.removed === 1 && partial.rewritten === 1
    && !partial.models.some((m) => m.id === 'cn:glm-5.3-flash')
    && partial.models.some((m) => m.id === 'cn:hy3-x'),
    'E10c 取消勾选一个 ⇒ 它被移除（保留那个只算重写）', { removed: partial.removed, rewritten: partial.rewritten });
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
  ok(merged2.added === 1 && merged2.models.length === 3 && merged2.models[0].url.indexOf('lyonn.fun') > 0
    && merged2.models.some((m) => m.id === 'gateway:qwen3.8-27b'),
    'E12b ⭐ 裸 id 撞名但不同源 ⇒ 绝不覆盖用户条目，改用前缀共存', merged2.models.map((m) => m.id));
  const undone = GW.unmergeGatewayModels(first.models, first.ids);
  ok(undone.models.length === 2 && undone.removed === 2, 'E13 撤销：按名单摘掉 2 条', undone.models.length);
  ok(JSON.stringify(undone.models) === JSON.stringify(userModels),
    'E14 ⭐ 撤销后用户原有条目逐字节恢复（JSON 深比较）');
  ok(GW.unmergeGatewayModels(userModels, null).removed === 0, 'E15 空名单安全（不误删）');
}

/* ===== F 组：字段映射补全（2026-10-15）===== */
{
  const full = GW.toWorkbuddyModelEntry({
    id: 'cn:hy3-x', name: 'Hy3', credits: 'x0.05',
    context_length: 192000, max_output_tokens: 64000, max_allowed_size: 192000,
    supports_tool_call: true, supports_images: true, supports_reasoning: true,
    only_reasoning: true,
    reasoning_supported_efforts: ['low', 'high'],
    reasoning_default_effort: 'high', reasoning_summary: 'auto',
  }, { baseUrl: 'http://127.0.0.1:7863', apiKey: 'K' });
  ok(full.supportsReasoning === true, 'F1 supports_reasoning → supportsReasoning');
  ok(full.onlyReasoning === true, 'F2 only_reasoning → onlyReasoning');
  ok(full.supportsImages === true, 'F3 supports_images → supportsImages');
  ok(full.maxInputTokens === 192000 && full.maxOutputTokens === 64000, 'F4 上下文 / 输出上限都透传');
  ok(full.reasoning && full.reasoning.supportedEfforts.join(',') === 'low,high', 'F5 思考档位清单透传');
  ok(full.reasoning.defaultEffort === 'high', 'F6 默认档位透传');
  ok(full.reasoning.canDisableThinking === false, 'F7 ⭐ only_reasoning ⇒ 不能关思考（与官方判据一致）');
  ok(full.reasoning.summary === 'auto', 'F8 摘要模式透传');
  ok(full.name.indexOf('x0.05') > 0, 'F9 倍率进名称');
  ok(full.supportedContextWindows === undefined && full.defaultContextWindow === undefined,
    'F10 ⭐ 绝不产出上下文档位（asar 里是死字段，编出来只会骗 UI）');

  const dirty = GW.toWorkbuddyModelEntry({
    id: 'x', supports_reasoning: true, only_reasoning: false,
    reasoning_supported_efforts: ['low', 'ULTRA', '', null, 'high'],
    reasoning_default_effort: 'nonsense',
  }, { baseUrl: 'http://h' });
  ok(dirty.reasoning.supportedEfforts.join(',') === 'low,high', 'F11 ⭐ 非法档位被过滤（不编造）');
  ok(dirty.reasoning.defaultEffort === undefined, 'F12 非法默认档位 ⇒ 不写');
  ok(dirty.reasoning.canDisableThinking === true, 'F13 非 only_reasoning ⇒ 可关思考');
  ok(dirty.onlyReasoning === undefined, 'F14 非 only_reasoning ⇒ 不写该字段');

  const plain = GW.toWorkbuddyModelEntry({ id: 'y', supports_tool_call: true }, { baseUrl: 'http://h' });
  ok(plain.reasoning === undefined && plain.supportsReasoning === undefined, 'F15 非思考模型不产出 reasoning');
  ok(GW.THINKING_LEVELS.join(',') === 'off,minimal,low,medium,high,xhigh,max', 'F16 档位枚举与客户端 asar 一致');
}

/* ===== G 组：注册状态识别与防重复（2026-10-15）===== */
{
  const GWURL = 'http://127.0.0.1:7863';
  const existing = [
    { id: 'gateway:cn:a', name: '[网关] A', url: GWURL + '/v1/chat/completions' },
    { id: 'cn:b', name: '手工配的 B', url: GWURL + '/v1/chat/completions' },
    { id: 'cn:c', name: '别的端点同名', url: 'http://other:9999/v1/chat/completions' },
  ];
  ok(GW.gatewayModelState(existing, 'cn:a', { baseUrl: GWURL }) === 'registered', 'G1 本插件写过 ⇒ registered');
  ok(GW.gatewayModelState(existing, 'cn:b', { baseUrl: GWURL }) === 'external', 'G2 手工配的（同网关）⇒ external');
  ok(GW.gatewayModelState(existing, 'cn:c', { baseUrl: GWURL }) === 'absent', 'G3 ⭐ 同名但指向别的端点 ⇒ 不算重复');
  ok(GW.gatewayModelState(existing, 'cn:d', { baseUrl: GWURL }) === 'absent', 'G4 完全没有 ⇒ absent');

  const entries = ['cn:a', 'cn:b', 'cn:d'].map((id) => GW.toWorkbuddyModelEntry({ id: id }, { baseUrl: GWURL, apiKey: 'K' }));
  const r1 = GW.mergeGatewayModels(existing, entries, { baseUrl: GWURL });
  ok(r1.skipped.length === 0, 'G5 ⭐ 同源手工条目不再「跳过」，而是被认领（原地更新）', r1.skipped);
  ok(r1.models.filter((m) => m.id === 'gateway:cn:a').length === 1, 'G6 已注册条目整条替换而非叠加');
  ok(r1.models.some((m) => m.id === 'cn:b') && !r1.models.some((m) => m.id === 'gateway:cn:b'),
    'G7 ⭐ 认领后保留原 id（手工的 cn:b 不会变身 gateway:cn:b）', r1.models.map((m) => m.id));
  ok(r1.models.find((m) => m.id === 'cn:b').name === '手工配的 B', 'G7b ⭐ 认领同时保留用户起的名字（不被 [网关] 前缀改写）');
  ok(r1.models.some((m) => m.id === 'cn:d'), 'G8 未注册的正常写入');
  ok(r1.rewritten === 2 && r1.added === 1, 'G9 认领 cn:a / cn:b 共 2 条重写 + 新建 1 条', { rewritten: r1.rewritten, added: r1.added });
  ok(r1.models.some((m) => m.id === 'cn:c') && r1.models.find((m) => m.id === 'cn:c').url.indexOf('other:9999') > 0,
    'G10 别的端点那条不受影响');

  const r3 = GW.mergeGatewayModels(r1.models, [], { baseUrl: GWURL });
  ok(!r3.models.some((m) => m.id.startsWith('gateway:')) && !r3.models.some((m) => m.id === 'cn:b'),
    'G11 ⭐ 传空数组 ⇒ 本网关条目全摘（含被认领的手工条目）', r3.removed);
  ok(r3.models.some((m) => m.id === 'cn:c'), 'G11c ⭐ 别的端点那条原封不动');
  ok(r3.removed === 3 && r3.rewritten === 0, 'G11b 全摘报的是 removed（数量 = 摘掉前本网关条目数）而非 rewritten', { removed: r3.removed, rewritten: r3.rewritten });
}

/* ===== H 组：url 被中间代理包裹之后，注册状态与增删必须仍然自洽 =====
 * 事故：接线后 url 外层变成代理端口，origin 比的是代理 vs 网关 ⇒ 5 条已注册全判成
 * absent；勾选后「应用」不认领原条目，而是新加 gateway:cn:xxx ⇒ 同一模型两份、接线被冲。
 * 修法：比较前先剥代理包裹前缀（unwrapProxyUrl）。下面每条都是当时真实翻车的形态。 */
{
  const GWBASE = 'http://127.0.0.1:7863';
  const BILI = 'http://127.0.0.1:8790';
  const wrap = (u) => BILI + '/bili/' + u;
  const wrapped = [
    { id: 'cn:glm-5.3', name: 'GLM 手工名', url: wrap(GWBASE + '/v1/chat/completions') },
    { id: 'cn:space-bunny', name: 'Space', url: wrap(GWBASE + '/v1/chat/completions') },
    { id: 'qwen3.8-27b', name: '本地', url: 'http://lyonn.fun:12288/v1/chat/completions' },
  ];

  ok(GW.unwrapProxyUrl(wrap(GWBASE + '/v1/x')) === GWBASE + '/v1/x',
    'H1 ⭐ 能剥掉 bili 包裹前缀（http://127.0.0.1:8790/bili/http://… ⇒ http://…）');
  ok(GW.unwrapProxyUrl(GWBASE + '/v1/x') === GWBASE + '/v1/x', 'H2 非包裹形态原样返回');
  ok(GW.unwrapProxyUrl('https://api.deepseek.com/chat/completions') === 'https://api.deepseek.com/chat/completions',
    'H3 普通外网 url 不被动到');
  ok(GW.unwrapProxyUrl(wrap(wrap(GWBASE + '/v1/x'))) === GWBASE + '/v1/x', 'H4 嵌套两级也能剥到底');
  ok(GW.unwrapProxyUrl('') === '', 'H5 空串不炸');

  ok(GW.gatewayModelState(wrapped, 'cn:glm-5.3', { baseUrl: GWBASE }) !== 'absent',
    'H6 ⭐⭐ 包裹后的条目不能再被判成 absent（本次事故的直接症状：5 条全 absent）');
  ok(GW.gatewayModelState(wrapped, 'cn:glm-5.3', { baseUrl: GWBASE }) === 'external',
    'H7 尚未登记的包裹条目 ⇒ external（可勾选、可保留）');
  ok(GW.gatewayModelState(wrapped, 'cn:glm-5.3', { baseUrl: GWBASE, registeredIds: ['cn:glm-5.3'] }) === 'registered',
    'H8 ⭐ 登记过（无 gateway: 前缀）⇒ registered，靠 registeredIds 而不是前缀');
  ok(GW.gatewayModelState(wrapped, 'qwen3.8-27b', { baseUrl: GWBASE, registeredIds: ['qwen3.8-27b'] }) === 'absent',
    'H9 ⭐ registeredIds 也要过同源校验：url 若已改指别处，就不再算本插件的条目');

  const entry = GW.toWorkbuddyModelEntry({ id: 'cn:glm-5.3', name: 'GLM' }, { baseUrl: GWBASE, apiKey: 'K' });
  entry.url = wrap(entry.url);
  const m1 = GW.mergeGatewayModels(wrapped, [entry], { baseUrl: GWBASE });
  ok(m1.models.filter((m) => m.id === 'cn:glm-5.3').length === 1 && !m1.models.some((m) => m.id === 'gateway:cn:glm-5.3'),
    'H10 ⭐⭐ 接线状态下「应用」是认领原条目，不再凭空多出一条 gateway:cn:xxx（同一模型两份 = 一条走 bili 一条不走）',
    m1.models.map((m) => m.id));
  ok(m1.added === 0 && m1.rewritten === 1, 'H11 认领记 rewritten 而非 added', { added: m1.added, rewritten: m1.rewritten });
  ok(m1.models.find((m) => m.id === 'cn:glm-5.3').name === 'GLM 手工名',
    'H12 认领后保留用户起的名字（不被 [网关] 前缀改写）');

  const m2 = GW.mergeGatewayModels(wrapped, [], { baseUrl: GWBASE });
  ok(m2.removed === 2 && !m2.models.some((m) => m.id === 'cn:glm-5.3') && !m2.models.some((m) => m.id === 'cn:space-bunny'),
    'H13 ⭐ 取消勾选能真的摘掉包裹条目（旧逻辑判定不同源 ⇒ 一条都摘不掉，等于「撤销注册」失效）',
    { removed: m2.removed, left: m2.models.map((m) => m.id) });
  ok(m2.models.some((m) => m.id === 'qwen3.8-27b'), 'H14 指向别处的模型永不被清理');
}

/* ==================================================================== */
console.log('\n== I. 网关发布源：单一版本号（主 Release 资产）==');
{
  // 2026-11-02 事故：GATEWAY_REPO 指着上游 linguo2625469，面板「更新网关」下载的是**上游原版**，
  // 把本仓 wd1~wd8 的改动全盖掉了；同时 CI 还在发 gateway-v* 孤儿 Release 污染 /releases/latest。
  // 这一组是守门：再有人把源改回上游、或版本号与二进制脱节，立刻红。
  ok(GW.GATEWAY_REPO === 'miantanjun/WorkDaddy-',
    'I1 ⭐ 网关源必须指向自家仓库（不是上游 linguo2625469）', GW.GATEWAY_REPO);
  ok(GW.ASSET_NAME === 'wb2api-windows-amd64.zip',
    'I2 资产名固定不带版本号（版本看 Release tag）', GW.ASSET_NAME);

  const cands = GW.gatewayDownloadCandidates('v1.9.9');
  ok(cands.length === 1, 'I3 ⭐ fork 版只有自家一个源（不再带上游兜底）', cands.map((c) => c.repo));
  ok(cands[0].repo === 'miantanjun/WorkDaddy-' && cands[0].tag === 'v1.9.9' && cands[0].asset === GW.ASSET_NAME && cands[0].legacy === false,
    'I4 ⭐ 唯一源 = 自家主 Release 的该 tag', cands[0]);
  ok(cands.every((c) => c.legacy === false),
    'I5 ⭐⭐ fork 版绝不返回上游原版（装了会抹掉 tunnelGuard，面板重新暴露公网）', cands.map((c) => c.repo));
  ok(GW.isForkedGateway() === true, 'I10 版本号带 -panel-wd<n> ⇒ 判定为 fork 版');

  ok(GW.gatewayDownloadCandidates('').length === 0,
    'I6 没给主 tag ⇒ 零候选（调用方报「没有可用下载源」，而不是拼出 download// 这种坏 URL）');
  ok(GW.gatewayDownloadCandidates(undefined).length === 0, 'I7 undefined 也不炸');

  const base = GW.gatewayDownloadBase(cands[0]);
  ok(base.endsWith('/releases/download/v1.9.9/') && base.startsWith('https://gh-proxy.com/https://github.com/'),
    'I8 下载前缀 = gh-proxy 镜像 + 标准 release 路径', base);

  // 集成层的 GATEWAY_VERSION 必须等于二进制自报的 appVersion，否则面板永久「版本漂移」。
  const mainGo = fs.readFileSync('D:/WorkDaddy/vendor/wb2api-go/cmd/server/main.go', 'utf8');
  const m = /appVersion\s*=\s*"([^"]+)"/.exec(mainGo);
  ok(!!m && m[1] === GW.GATEWAY_VERSION,
    'I9 ⭐ GATEWAY_VERSION 必须等于 cmd/server/main.go 的 appVersion', { binary: m && m[1], integration: GW.GATEWAY_VERSION });
}

/* ==================================================================== */
console.log('\n== J. 面板收口：公网只当 API 入口（隧道流量看不到面板）==');
{
  // 2026-11-02：frpc 的 https2http 只能整端口转发（官方只有 crtPath / keyPath /
  // hostHeaderRewrite / requestHeaders.set 四项，没有 locations 白名单），所以 7863 上的
  // /panel/* 会跟着 /v1/* 一起暴露到公网（实测 /panel/ 返回 200）。收口方式 = frpc 转发时
  // 覆盖写一个标记头，网关见到它就拒 /panel/*。这一组守三件事：接线没被摘掉、头名与
  // frpc.toml 一致、以及 /v1 千万别被一起包进去（包了就是公网 API 全挂）。
  const handlerGo = fs.readFileSync('D:/WorkDaddy/vendor/wb2api-go/internal/server/handler.go', 'utf8');
  const noComment = handlerGo.replace(/\/\/[^\n]*/g, '');

  ok(/h\.mux\.Handle\("\/panel\/",\s*tunnelGuard\(cfg\.Panel\)\)/.test(noComment),
    'J1 ⭐⭐ /panel/ 必须挂 tunnelGuard（挂回裸 cfg.Panel = 公网又能打开面板）');
  ok(!/h\.mux\.Handle\("\/panel\/",\s*cfg\.Panel\)/.test(noComment),
    'J2 不能同时保留裸挂载（语义自相矛盾，重复 Handle 还会 panic）');
  ok(/const tunnelHeader = "X-Workdaddy-Tunnel"/.test(handlerGo),
    'J3 头名固定 = X-Workdaddy-Tunnel（必须与 frpc.toml 的 requestHeaders.set 键一致）');

  const guard = noComment.slice(noComment.indexOf('func tunnelGuard'));
  const iGet = guard.indexOf('r.Header.Get(tunnelHeader)');
  const iForbid = guard.indexOf('http.StatusForbidden');
  ok(iGet > -1 && iForbid > -1 && iGet < iForbid,
    'J4 ⭐ 先判标记头再返回 403（顺序反了等于永远放行）', { header: iGet, forbid: iForbid });
  ok(guard.includes('next.ServeHTTP(w, r)'), 'J5 放行分支必须真的转给下游');

  // 公网 API 不能被牵连：/v1、/status、/healthz 的注册行里不许出现 tunnelGuard。
  const apiLines = noComment.split('\n').filter((l) => /Handle(Func)?\("(?:POST|GET) \/(?:v1|status|healthz)/.test(l));
  ok(apiLines.length >= 5 && apiLines.every((l) => !l.includes('tunnelGuard')),
    'J6 ⭐⭐ /v1/* 与 /healthz 一律不挂 tunnelGuard（挂了公网 API 全 403）', apiLines.length);

  // 与真实 frpc.toml 对账：文件不在就跳过（换机器时不误红），在就必须真的下发。
  const tomlPath = 'C:/Users/Lyon/AppData/Roaming/WorkDaddy/tunnel/frpc.toml';
  if (fs.existsSync(tomlPath)) {
    const toml = fs.readFileSync(tomlPath, 'utf8');
    ok(/requestHeaders\.set\.x-workdaddy-tunnel\s*=\s*"1"/i.test(toml),
      'J7 ⭐ frpc.toml 必须真的下发这个标记头（漏了 ⇒ 网关收不到 ⇒ 面板仍在公网）');
  } else {
    console.log('  SKIP J7 本机没有 frpc.toml（跳过头注入校验）');
  }
}

/* ==================================================================== */
console.log('\n== K. 面板 XSS 防线：账号昵称是不可信输入 ==');
{
  // 2026-11-02：上游作者在群里通报「wb 存在账号名称注入，攻击者通过 wb 平台 XSS 注入到
  // 系统里，已经有不少反代被影响」。机制 = 账号昵称由上游账号持有人自定，反代面板把它
  // 原样当 HTML 渲染 ⇒ 脚本在管理员浏览器里跑 ⇒ 读走 localStorage 里的 api_key ⇒ 面板
  // 全权（含改 upstream.chat_base，把带 Bearer token 的请求引到攻击者服务器 = 全部账号
  // 凭证外泄）。Go 版本地实测：昵称 4 种 payload 全被 esc 成文本，人为注入未转义 HTML
  // 也全被 CSP 拦死（inline script / inline handler / fetch 外带 / img 外带四条全禁）。
  // 这一组把这两个前提锁进回归：任何一个被上游同步冲掉，都必须立刻红。
  const P = 'D:/WorkDaddy/vendor/wb2api-go/internal/panel/';
  const idx = fs.readFileSync(P + 'index.go', 'utf8');
  const app = fs.readFileSync(P + 'app.js', 'utf8');
  // 剥注释后再判：注释里解释了 style-src 为什么允许 unsafe-inline，不能让它污染 script-src 的判定。
  const idxCode = idx.replace(/\/\/[^\n]*/g, '');
  const scriptDir = (idxCode.match(/script-src[^;]*/) || [''])[0];

  ok(/default-src 'none'/.test(idxCode), "K1 ⭐ CSP 必须 default-src 'none'（默认全禁、逐个开口）");
  ok(scriptDir !== '' && !/unsafe-inline/.test(scriptDir),
    "K2 ⭐⭐ script-src 绝不能含 unsafe-inline（含了 ⇒ 内联事件处理器可执行 ⇒ 昵称注入直接变 XSS）", scriptDir.trim());
  ok(/connect-src 'self'/.test(idxCode), "K3 connect-src 必须限定 'self'（XSS 即使执行也带不走数据）");
  ok(/img-src 'self' data:/.test(idxCode), "K4 img-src 必须限定 'self' data:（堵 img 外带通道）");
  ok(/base-uri 'none'/.test(idxCode) && /frame-ancestors 'none'/.test(idxCode),
    "K5 base-uri / frame-ancestors 必须都是 'none'");

  const escBody = /function esc\(s\)\s*\{([\s\S]*?)\n\}/.exec(app);
  ok(!!escBody && ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'].every((e) => escBody[1].includes(e)),
    'K6 esc() 必须同时转义 & < > " \'（少转一个引号 = 属性逃逸）', escBody ? escBody[1].replace(/\s+/g, ' ').slice(0, 120) : 'not found');

  const bad = app.split('\n')
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter(({ l }) => /nickname/.test(l) && /['"`]\s*</.test(l) && !/esc\(/.test(l) && !/textContent/.test(l));
  ok(bad.length === 0,
    'K7 ⭐⭐ 含 nickname 且拼 HTML 的行必须走 esc()/textContent（昵称由上游账号持有人自定）',
    bad.map((x) => x.n + ': ' + x.l.slice(0, 70)));
}

/* ==================================================================== */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('\n==== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
