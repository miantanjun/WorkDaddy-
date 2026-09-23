'use strict';
// 回归测试：会话排行标题的多源解析（scripts/session-titles.js）
//
// 现场（2026-09-23）：看板「会话排行」前 15 名里 12 条显示成「未命名会话」。根因不是编码，
// 而是**两套 id 对不上**——排行的 id 取自官方 trace 的 sessionId（会话**原始 id**），
// 而 workbuddy.db 的 sessions 表存的是切号自动复制出来的**各账号副本 id**。
//
// 本套件锁死四件事：
//   A. 解析优先级：db → 血缘 → 快照 → 正文 aiTitle → 客户端缓存 → 首条提问；不许乱序。
//   B. 桥接：副本 jsonl「文件名是副本 id、内容里 sessionId 是原始 id」必须互为别名。
//   C. 脱敏：标题是最容易被截图外传的字段，派生标题里的 AK/SK 与手机号一律打码。
//   D. 纪律：全都查不到就返回空（界面显示占位），**不编造**；快照只增不减。
// 跑法：node .wd-analysis/test-session-titles.js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const st = require(path.join(__dirname, '..', 'scripts', 'session-titles.js'));
const { createSessionTitleResolver, mergeTitleSnapshot, sanitizeTitle, isUsablePrompt } = st;

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-titles-'));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-titles-data-'));
const U1 = '028cbdf0-a0b5-4b45-ad68-8681d5314736';
const U2 = '827977d7-77ca-437e-9602-159fdc11fe7d';
const LIN = 'aaaaaaaa-1111-4111-8111-111111111111'; // 血缘 id
const M1 = 'bbbb1111-0000-4000-8000-000000000001'; // 账号 U1 的成员（库里有标题）
const M2 = 'bbbb2222-0000-4000-8000-000000000002'; // 账号 U2 的成员（库里没标题）
const SRC = 'cccc3333-0000-4000-8000-000000000003'; // 源会话（库里已无此行）
const COPY = 'dddd4444-0000-4000-8000-000000000004'; // 副本文件（库里有标题）
const ORIG = 'eeee5555-0000-4000-8000-000000000005'; // 原始 id，只在副本正文里出现
const SELF = 'ffff6666-0000-4000-8000-000000000006'; // 文件名==内嵌 id，库里无行，正文有 aiTitle
const SNAP = 'aaaa7777-0000-4000-8000-000000000007'; // 只存在于 WorkDaddy 标题快照
const CACHE = 'bbbb8888-0000-4000-8000-000000000008'; // 只存在于客户端缓存快照
const LOGID = 'cccc9999-0000-4000-8000-000000000009'; // 只能靠 SDK 日志的首条提问派生
const PHONE = 'dddd0a0a-0000-4000-8000-00000000000a'; // 库标题里带手机号 → 必须打码
const UNKNOWN = 'eeee0b0b-0000-4000-8000-00000000000b'; // 哪儿都没有

const PJ = 'projects/d-WorkBuddy date-2026-09-01-11-01-13';
fs.mkdirSync(path.join(ROOT, PJ), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'logs', '2026-09-01', 'sdk', 'conversations'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'app', 'session', 'Cache', 'Cache_Data'), { recursive: true });

// ② 血缘：meta.json（autoCopy.sessions[].members / sessionIndex / copies[].targetId）
fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({
  autoCopy: {
    version: 2,
    sessions: { [LIN]: { enabled: true, members: [{ uid: U1, id: M1 }, { uid: U2, id: M2 }] } },
    sessionIndex: { [U1]: { [SRC]: LIN } },
    copies: { [JSON.stringify([LIN, U2])]: { targetId: M2, status: 'copied' } },
  },
}), 'utf8');

// ③ jsonl 桥：文件名是副本 id，内容里的 sessionId 是原始 id；带 aiTitle 的用自己的 id
fs.writeFileSync(path.join(ROOT, PJ, COPY + '.jsonl'),
  JSON.stringify({ id: 'r1', sessionId: ORIG, aiTitle: '正文里的旧标题' }) + '\n'
  + JSON.stringify({ id: 'r2', sessionId: ORIG, aiTitle: '正文里的新标题' }) + '\n', 'utf8');
fs.writeFileSync(path.join(ROOT, PJ, SELF + '.jsonl'),
  JSON.stringify({ id: 'r3', sessionId: SELF, aiTitle: '自述正文标题' }) + '\n', 'utf8');

// ⑤ 客户端缓存快照（WorkDaddy 自己 /api/sessions 的旧响应）
fs.writeFileSync(path.join(ROOT, 'app', 'session', 'Cache', 'Cache_Data', 'data_0'),
  'junk{"id":"' + CACHE + '","cwd":"D:\\\\x","title":"","custom_title":"缓存里的标题","status":"completed"}tail', 'utf8');

// ⑥ SDK 日志：首条提问带凭据与手机号，必须脱敏
fs.writeFileSync(path.join(ROOT, 'logs', '2026-09-01', 'sdk', 'conversations', LOGID + '.log'),
  '2026-09-01T00:00:00.000Z method:requests:result ' + JSON.stringify({
    instanceId: 'ci-1',
    state: [{ id: 'req-1', userContent: [{ type: 'text', text: '帮我改按钮颜色，SecretId:AKIDabcdefgh12345678，手机 13800138000' }] }],
  }) + '\n', 'utf8');

// ③ 归档 + WorkDaddy 快照
fs.mkdirSync(path.join(ROOT, 'usage-archive'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'usage-archive', 'sessions.json'), JSON.stringify({ [SNAP]: { title: '' } }), 'utf8');
mergeTitleSnapshot(DATA, new Map([[SNAP, '快照里的标题']]));

const dbTitles = new Map([
  [M1, { title: '血缘组里的标题', customTitle: '' }],
  [COPY, { title: '副本行标题', customTitle: '' }],
  [PHONE, { title: '联系我 13912345678 处理', customTitle: '' }],
]);

const resolver = createSessionTitleResolver({ root: ROOT, dataDir: DATA, dbTitles });
const r = (id) => resolver.resolve(id);

let passed = 0, failed = 0;
const log = [];
function check(label, fn) {
  try { fn(); log.push('  PASS  ' + label); passed++; }
  catch (e) { log.push('  FAIL  ' + label + '\n        ' + e.message); failed++; }
}

log.push('fixture: ' + ROOT);
log.push('');
log.push('[A] 解析优先级');

check('① 会话表直查：库里那一行就是插件会话页显示的名字', () => {
  const hit = r(M1);
  assert.strictEqual(hit.title, '血缘组里的标题');
  assert.strictEqual(hit.source, 'db');
});

check('② 血缘：源会话 id 已不在库里，靠 lineage 成员接回标题', () => {
  const hit = r(SRC);
  assert.strictEqual(hit.title, '血缘组里的标题', `实得 ${JSON.stringify(hit)}`);
  assert.strictEqual(hit.source, 'lineage');
});

check('③ 快照优先于正文 aiTitle（保存下来的真标题比正文里的更可信）', () => {
  const hit = r(SNAP);
  assert.strictEqual(hit.source, 'saved', `实得 ${JSON.stringify(hit)}`);
  assert.strictEqual(hit.title, '快照里的标题');
});

check('③′ 无库行、无快照时用正文 aiTitle，且取**最后一条**（最新标题）', () => {
  const hit = r(SELF);
  assert.strictEqual(hit.source, 'jsonl', `实得 ${JSON.stringify(hit)}`);
  assert.strictEqual(hit.title, '自述正文标题');
});

check('⑤ 客户端缓存快照只在前面全落空时兜底', () => {
  const hit = r(CACHE);
  assert.strictEqual(hit.source, 'client-cache', `实得 ${JSON.stringify(hit)}`);
  assert.strictEqual(hit.title, '缓存里的标题');
});

check('⑥ 最后才用首条提问派生', () => {
  const hit = r(LOGID);
  assert.strictEqual(hit.source, 'first-prompt', `实得 ${JSON.stringify(hit)}`);
  assert.ok(hit.title.indexOf('帮我改按钮颜色') === 0, `实得 ${JSON.stringify(hit.title)}`);
});

check('⑦ 哪儿都没有 → 空标题 + source=none（不编造）', () => {
  const hit = r(UNKNOWN);
  assert.strictEqual(hit.title, '');
  assert.strictEqual(hit.source, 'none');
});

check('空 id / undefined 不抛，直接 none', () => {
  assert.strictEqual(r('').source, 'none');
  assert.strictEqual(r(undefined).source, 'none');
  assert.strictEqual(r(null).title, '');
});

log.push('');
log.push('[B] jsonl 桥：文件名(副本 id) ↔ 内容 sessionId(原始 id)');

check('原始 id 能顺着副本文件名接回库里的标题', () => {
  const hit = r(ORIG);
  assert.strictEqual(hit.title, '副本行标题', `实得 ${JSON.stringify(hit)}`);
  assert.ok(hit.source === 'lineage' || hit.source === 'jsonl', `实得 source=${hit.source}`);
});

check('反向也成立：副本文件名自己能解析出标题', () => {
  assert.strictEqual(r(COPY).title, '副本行标题');
});

log.push('');
log.push('[C] 脱敏：标题一律不得输出凭据/手机号');

check('派生标题里的 AK 与手机号被打码', () => {
  const t = r(LOGID).title;
  assert.ok(t.indexOf('AKID') === -1, `仍含 AKID：${t}`);
  assert.ok(t.indexOf('13800138000') === -1, `仍含手机号：${t}`);
  assert.ok(t.indexOf('1**********') >= 0, `缺打码痕迹：${t}`);
});

check('库里的官方标题同样过脱敏（官方自动标题就是首条提问截断的）', () => {
  const t = r(PHONE).title;
  assert.ok(t.indexOf('13912345678') === -1, `仍含手机号：${t}`);
});

check('sanitizeTitle 不误伤普通中文标题', () => {
  assert.strictEqual(sanitizeTitle('  雅祺PDF编辑工具  '), '雅祺PDF编辑工具');
  assert.strictEqual(sanitizeTitle('把按钮蓝色改为毛玻璃质感'), '把按钮蓝色改为毛玻璃质感');
});

check('isUsablePrompt 拒绝系统注入/任务通知类首条', () => {
  assert.strictEqual(isUsablePrompt('<task-notification> 后台任务完成'), false);
  assert.strictEqual(isUsablePrompt('# AGENTS.md 指令'), false);
  assert.strictEqual(isUsablePrompt('{"a":1}'), false);
  assert.strictEqual(isUsablePrompt(''), false);
  assert.strictEqual(isUsablePrompt('帮我看看这个去码软件'), true);
});

log.push('');
log.push('[D] 快照只增不减 + 容错');

check('mergeTitleSnapshot 只补不覆盖：已有条目与空串都不动', () => {
  mergeTitleSnapshot(DATA, new Map([[SNAP, '后来者不该覆盖'], ['', '空 id 忽略'], [UNKNOWN, '']]));
  const j = JSON.parse(fs.readFileSync(path.join(DATA, 'usage-board', 'session-title-snapshot.json'), 'utf8'));
  assert.strictEqual(j.titles[SNAP], '快照里的标题', `实得 ${j.titles[SNAP]}`);
  assert.strictEqual(j.titles[UNKNOWN], undefined, '空标题不该写进去');
});

check('无 dataDir / 目录不存在时不抛，返回写入统计', () => {
  const res = mergeTitleSnapshot('', new Map([['x', 'y']]));
  assert.strictEqual(res.written, 0);
  const res2 = mergeTitleSnapshot(path.join(ROOT, 'nope', 'deep'), new Map([['x', 'y']]));
  assert.ok(res2.total >= 1, `实得 ${JSON.stringify(res2)}`);
});

check('root 缺失只砍掉正文桥接；库/血缘/快照照样可用，且不抛', () => {
  const bare = createSessionTitleResolver({ root: path.join(ROOT, 'missing'), dataDir: DATA, dbTitles });
  assert.strictEqual(bare.resolve(M1).title, '血缘组里的标题', '库直查与 root 无关');
  assert.strictEqual(bare.resolve(SRC).title, '血缘组里的标题', '血缘来自 dataDir，与 root 无关');
  assert.strictEqual(bare.resolve(SNAP).title, '快照里的标题', '快照来自 dataDir，与 root 无关');
  assert.strictEqual(bare.resolve(ORIG).source, 'none', 'root 缺失时 jsonl 桥接自然失效');
  assert.strictEqual(bare.resolve(UNKNOWN).source, 'none');
});

check('describe() 给出各源条数（界面口径说明要用）', () => {
  const d = resolver.describe();
  assert.ok(d.dbTitles >= 3, JSON.stringify(d));
  assert.ok(d.jsonlTitles >= 2, JSON.stringify(d));
  assert.ok(d.aliases >= 3, JSON.stringify(d));
});

fs.rmSync(ROOT, { recursive: true, force: true });
fs.rmSync(DATA, { recursive: true, force: true });
log.push('');
log.push(`结果：passed=${passed} failed=${failed}`);
fs.writeFileSync(path.join(__dirname, 'test-session-titles.out.txt'), log.join('\n') + '\n', 'utf8');
console.log(log.join('\n'));
console.log(`passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
