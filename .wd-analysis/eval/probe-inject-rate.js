/* probe-inject-rate.js — 自动注入的真实触发率（只读）
 *
 * 做法：从库里取历史 user 原话（pri=2），当作「如果现在又这么问」，
 * 跑 searchForPrompt，统计默认配置下的触发率。
 * 这是最接近生产的数据，不是构造出来的 query。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const CUR = ck.findActiveSession({ fresh: true }).sid;

// 取历史用户原话：去掉极短、去掉贴图/命令占多数的
const rows = db.prepare(`
  SELECT text FROM seg
   WHERE kind='user' AND COALESCE(pri,0)=2 AND COALESCE(noise,0)=0
     AND LENGTH(text) BETWEEN 6 AND 300
   ORDER BY ts DESC LIMIT 150
`).all();

const prompts = rows.map(r => String(r.text).replace(/\s+/g, ' ').trim())
  .filter(t => t && !/^@image#|^@"?[A-Z]:\\|^\/[a-z]/i.test(t));

console.log(`样本：历史用户原话 ${prompts.length} 条\n`);

function run(label, opts) {
  let ok = 0, noSig = 0, hasId = 0, dropOnly = 0;
  const reasons = {};
  let chars = 0;
  for (const p of prompts) {
    let r;
    try { r = ck.searchForPrompt(p, Object.assign({ sid: CUR, max: 3, chars: 1200 }, opts)); }
    catch (e) { continue; }
    const n = (r.items || []).length;
    const why = r.reason || (n ? 'ok' : '-');
    reasons[why] = (reasons[why] || 0) + 1;
    if (n) { ok++; chars += (r.items || []).reduce((s, x) => s + String(x.text || '').length, 0); }
    else if (why === 'no-signal') noSig++;
    if ((r.ids || []).length) hasId++;
    if ((r.dropped || []).length && !(r.ids || []).length) dropOnly++;
  }
  console.log(`【${label}】`);
  console.log(`  触发       ${ok}/${prompts.length} = ${(ok / prompts.length * 100).toFixed(1)}%`);
  console.log(`  no-signal  ${noSig}  （提问里没有可用强标识符）`);
  console.log(`  有可用于查询的标识符 ${hasId} 条`);
  console.log(`  标识符被 IDF 全否掉 ${dropOnly} 条`);
  if (ok) console.log(`  平均注入正文 ${(chars / ok).toFixed(0)} 字符/次`);
  console.log(`  reason 分布 ${JSON.stringify(reasons)}`);
  console.log('');
}

// 生产默认（injectGap=false）
run('生产默认 injectGap=false', {});
// 只开词法兜底
run('仅开 injectGap=true', { gap: true });
