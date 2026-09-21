'use strict';
// 登录方式「优缺点悬停提示」的 i18n 回归测试（纯 Node，不需要 WorkBuddy / CDP）。
//
// 为什么必须测：inject.js 的翻译器是「按位置最长匹配」的扫描器（wbsTranslateString），
// 中文串里只要嵌了一个短词典项（比如 '重启'、'下载'），就会被撕成中英混合。
// 所以新增长句必须整句入词典，且翻完不能残留任何 CJK 字符。
//
// 用法: node D:\WorkDaddy\.wd-analysis\test-login-tip-i18n.js
const fs = require('fs');
const path = require('path');

const INJECT = process.argv[2] || 'D:/WorkDaddy/scripts/inject.js';
const src = fs.readFileSync(INJECT, 'utf8').split(/\r?\n/);

function indexOfLine(re, from) {
  for (let i = from || 0; i < src.length; i++) if (re.test(src[i])) return i;
  return -1;
}
const dictStart = indexOfLine(/var WBS_I18N_EN = \{/);
const dictEnd = indexOfLine(/^\s*\};\s*$/, dictStart + 1);
const matcherStart = indexOfLine(/var wbsI18nMatchers = null;/);
const matcherEnd = indexOfLine(/function wbsIsBuiltinAutomation/, matcherStart);

if (dictStart < 0 || dictEnd < 0 || matcherStart < 0 || matcherEnd < 0) {
  console.error('抽取失败: dict=' + dictStart + '..' + dictEnd + ' matcher=' + matcherStart + '..' + matcherEnd);
  process.exit(1);
}

// eslint-disable-next-line no-new-func
const translate = new Function(
  src.slice(dictStart, dictEnd + 1).join('\n') + '\n' +
  src.slice(matcherStart, matcherEnd).join('\n') + '\n' +
  'return wbsTranslateString;'
)();

const CJK = /[\u4e00-\u9fff]/;
let pass = 0, fail = 0;
const check = (name, zh, expect) => {
  const got = translate(zh, 'en');
  const ok = !CJK.test(got) && (expect === undefined || got === expect);
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + '\n      in : ' + JSON.stringify(zh) + '\n      out: ' + JSON.stringify(got) + (expect !== undefined ? '\n      exp: ' + JSON.stringify(expect) : '')); }
  return got;
};

console.log('== 新增：优缺点提示文案（必须整句命中、零 CJK 残留）==');
check('提示语', '把鼠标移到任一方式上，可查看它的优缺点', 'Hover either method to see its pros and cons.');
check('标签 优点', '优点', 'Pros');
check('标签 缺点', '缺点', 'Cons');
check('假退出 · 优点', '无须浏览器授权，旧账号登录身份不过期，之后能随时切回',
  'No browser authorization needed; the old account stays signed in and can be switched back to anytime.');
check('假退出 · 缺点', '要关掉并重开 WorkBuddy，当前会话与正在跑的任务会中断',
  'Closes and reopens WorkBuddy, interrupting the current session and any running task.');
check('无感登录 · 优点', '不用退出或重开应用，授权成功后新账号自动加入列表并切换',
  'WorkBuddy keeps running; once authorized, the new account is added to the list and switched to automatically.');
check('无感登录 · 缺点', '必须在浏览器扫码完成授权，依赖官方接口与网络可用',
  'Requires scanning a code in the browser to authorize; depends on the official API and network being available.');

console.log('== 回归：原有登录弹窗文案不受影响 ==');
check('弹窗标题', '选择登录方式', 'Choose a login method');
check('方式一标题', '假退出', 'Soft logout');
check('方式二标题', '无感登录', 'Seamless login');
check('方式一描述', '以「不让当前账号登录身份过期」的方式切到登录页，可以登录新账号，也可以切回已登录账号',
  'Goes to the login page without letting the current account expire; log in a new account or switch back to an existing one.');
check('方式二描述', '不退出 WorkBuddy，在浏览器完成授权后新账号自动加入列表',
  'Keeps WorkBuddy running; after authorizing in the browser, the new account is added to the list automatically.');

console.log('== 方案 D/D1：会话同步「分叉」与「两边都改过」的文案必须分开 ==');
check('分叉标题', '会话同步完成，有会话分叉', 'Session sync complete with branched sessions');
check('分叉明细片段', ' 个会话两边各自分叉，已保留双方，未覆盖任何一边',
  ' session(s) branched on both sides; both copies were kept and neither was overwritten');
// 实测形态：面板是把 route + ' · N ' + 片段 拼起来再交给翻译器的，所以必须按**拼接后**的样子验
const divergentDetail = 'A → B · 3 个会话两边各自分叉，已保留双方，未覆盖任何一边';
const divergentOut = translate(divergentDetail, 'en');
if (!CJK.test(divergentOut)) { pass++; console.log('  ✔ 分叉明细拼起来零 CJK 残留\n    ' + divergentOut); }
else { fail++; console.log('  ✘ 分叉明细仍有中文: ' + JSON.stringify(divergentOut)); }
// 旧文案不能被新词典项撕坏（最长匹配，长短两条必须同时成立）
const legacyDetail = 'A → B · 2 个会话两边都修改过，未覆盖任何一边';
const legacyOut = translate(legacyDetail, 'en');
if (!CJK.test(legacyOut)) { pass++; console.log('  ✔ 旧「两边都修改过」文案未被新词典项撕坏\n    ' + legacyOut); }
else { fail++; console.log('  ✘ 旧文案被撕坏: ' + JSON.stringify(legacyOut)); }

console.log('== 交叉验证：短词典项不会撕坏新句子 ==');
// 这几句里刻意混入了 '重启'/'下载' 之类短词典项的同形字，验证「最长优先」确实生效
const trap = '不用退出或重开应用，授权成功后新账号自动加入列表并切换';
const out = translate(trap, 'en');
if (out === 'WorkBuddy keeps running; once authorized, the new account is added to the list and switched to automatically.') {
  pass++; console.log('  ✔ 含「重开」的句子未被短词撕开');
} else { fail++; console.log('  ✘ 被撕开: ' + JSON.stringify(out)); }

console.log('== 逐句扫描：把整套提示语拼起来翻译，检查有没有中英混杂 ==');
const joined = ['把鼠标移到任一方式上，可查看它的优缺点', '优点', '无须浏览器授权，旧账号登录身份不过期，之后能随时切回',
  '缺点', '要关掉并重开 WorkBuddy，当前会话与正在跑的任务会中断', '无感登录', '必须在浏览器扫码完成授权，依赖官方接口与网络可用'].join(' ');
const joinedOut = translate(joined, 'en');
if (!CJK.test(joinedOut)) { pass++; console.log('  ✔ 拼接后零 CJK 残留'); console.log('    ' + joinedOut); }
else { fail++; console.log('  ✘ 拼接后仍有中文: ' + JSON.stringify(joinedOut)); }

console.log('\n结果: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
