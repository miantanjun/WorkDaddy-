/* probe-memory-inject.js — 真实用途端到端实测（只读）
 *
 * 这套记忆系统真正的生产入口不是「我主动查」，而是 promptInjection：
 * 用户发消息 → 自动从【别的会话】捞相关历史 → 拼进上下文。
 * 这里拿真实提问跑一遍，看它捞回了什么、捞对没有。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const act = ck.findActiveSession({ fresh: true });
const CUR = act ? act.sid : null;
console.log('当前会话:', CUR ? CUR.slice(0, 8) : '(无)');
console.log('库内会话: 29 个 / 98591 条\n');

// 模拟老叶真实会问的话（每句都指向以前某个会话里发生过的事）
const prompts = [
  'WAL 文件只增不减，库体积越来越大，怎么修',
  '重复会话怎么判断哪个是正品',
  'SUNRISE 那边 70% 尾款还没付，帮我催一下',
  '埃及那 5 个柜的 CargoX 单据要准备什么',
  '波兰 SHARDA 首单的 PI 签了没有',
  'OfficeTool 加彩色打印机那部分怎么写的',
  'ZeroTier 的网段是多少，别动它',
  '喜马拉雅音频助手现在什么进度',
  'REL_TIE 阈值能不能往上调',
  '本地模型 qwen 的思考预算怎么调',
];

let hitN = 0, emptyN = 0;
for (const p of prompts) {
  const t0 = Date.now();
  let r;
  try {
    r = ck.searchForPrompt(p, { sid: CUR, max: 3, chars: 1200 });
  } catch (e) {
    console.log(`\n▸ "${p}"\n  [ERR] ${e.message}`);
    continue;
  }
  const ms = Date.now() - t0;
  const items = r.items || [];
  if (items.length) hitN++; else emptyN++;
  console.log(`\n▸ "${p}"`);
  console.log(`  注入 ${items.length} 条  reason=${r.reason || '-'}  强标识符=[${(r.ids || []).join(',')}]  ${ms}ms`);
  items.slice(0, 3).forEach((x, i) => {
    const t = String(x.text || '').replace(/\s+/g, ' ');
    console.log(`   ${i + 1}. [${x.time || '-'}] ${t.slice(0, 90)}${t.length > 90 ? '…' : ''}`);
  });
}
console.log(`\n===== 小结：${prompts.length} 句真实提问 → 捞到历史 ${hitN} 句 / 空 ${emptyN} 句 =====`);

// 再看一眼注入后的实际拼接效果（最容易出问题的地方：token 爆炸 / 串台）
console.log('\n======= 注入文本实际长相（取一例）=======');
try {
  const r = ck.searchForPrompt(prompts[2], { sid: CUR, max: 2, chars: 600 });
  const txt = ck.renderInjection ? ck.renderInjection(r) : '(无 renderInjection)';
  console.log(String(txt).slice(0, 1000));
} catch (e) {
  console.log('[ERR]', e.message);
}
