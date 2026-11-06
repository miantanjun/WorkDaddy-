/* 诊断九：配对负例的答案，在【别的会话】里到底能不能搜到？
 *
 * 为什么这一步比"加阈值"重要：
 *   前面已经证明「错会话 vs 对会话」的信号严重重叠（covW 间隔 −0.186）⇒
 *   在**单会话检索**这个前提上，无论怎么调阈值都分不开。
 *   但 v3 已经把**全部会话都建了索引**（索引多会话、查询只当前会话）。
 *   ⇒ 真正的产品能力不是"拒答"，而是"这条在另一个会话里"。
 *
 * 要验证两件事：
 *   ① 9 条配对负例的答案，跨会话能否搜到（Recall@3，gold 未知 ⇒ 看文本相关性）
 *   ② 反过来：正例的 gold 会不会在**别的会话**也命中（若大量命中，跨会话提示会噪声化）
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const db = ck._internal.open();

const SIDS = [...new Set(ALL.map((c) => c.sid))];
const NAME = {};
NAME['8f92c3fc-ff73-4db1-b104-eb060127daaf'] = 'WD';
NAME['96f77df6-452b-4c05-916f-92e30accd72b'] = '画册';
NAME['3a1eef3c-382c-4d17-95ae-7b29e230ae68'] = 'APP';

/* 跨会话原始检索：直接查 FTS，不过 sid 过滤（等价于"如果允许跨会话会看到什么"） */
const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 400) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT ?`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';

function crossSearch(q, lim) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  if (!parts.length) return [];
  try { return stmt.all(parts.map(esc).join(' OR '), lim); } catch (_) { return []; }
}

console.log('=== ① 9 条配对负例：跨会话搜到什么 ===');
for (const c of PN) {
  const rows = crossSearch(c.q, 30);
  /* 按会话分组，看"别的会话"命中多少 */
  const byS = {};
  for (const r of rows) byS[r.sid] = (byS[r.sid] || 0) + 1;
  const others = SIDS.filter((s) => s !== c.sid);
  const hitsElse = rows.filter((r) => r.sid !== c.sid);
  console.log('  ' + c.id.padEnd(5) + ' 本会话=' + NAME[c.sid] + ' 跨会话命中 ' + hitsElse.length + '/30'
    + '  分布: ' + Object.keys(byS).map((s) => NAME[s] + '=' + byS[s]).join(' '));
  const topOther = hitsElse[0];
  if (topOther) {
    console.log('        ★ 别的会话最佳（' + NAME[topOther.sid] + ', bm25=' + Number(topOther.score).toFixed(2) + '）: '
      + String(topOther.text || '').replace(/\s+/g, ' ').slice(0, 95));
  }
}

console.log('\n=== ② 正例的 gold 会不会在别的会话也命中（跨会话提示的噪声量）===');
let goldAlsoElsewhere = 0, goldOnlyHere = 0, checked = 0;
for (const c of P) {
  const rows = crossSearch(c.q, 30);
  const goldHitHere = rows.some((r) => r.sid === c.sid && (c.gold || []).indexOf(r.seq) >= 0);
  const goldHitElse = rows.some((r) => r.sid !== c.sid && (c.gold || []).indexOf(r.seq) >= 0);
  /* gold seq 只在本题 sid 内有意义，别的会话 seq 撞号是巧合 —— 用文本近似替代：
     看别的会话的前 3 条是否与 gold 段落文本高度重合（>60% 公共 bigram） */
  const goldTxt = [];
  const g = db.prepare('SELECT text FROM seg WHERE sid=? AND seq=?');
  for (const s of (c.gold || [])) {
    const r = g.get(c.sid, s);
    if (r) goldTxt.push(String(r.text || ''));
  }
  let dup = false;
  if (goldTxt.length) {
    for (const r of rows.filter((x) => x.sid !== c.sid).slice(0, 3)) {
      const t = String(r.text || '');
      for (const gt of goldTxt) {
        const gb = new Set(String(ck.bigram(gt)).split(/\s+/).filter(Boolean));
        const tb = new Set(String(ck.bigram(t)).split(/\s+/).filter(Boolean));
        let inter = 0;
        for (const x of gb) if (tb.has(x)) inter++;
        if (gb.size && inter / gb.size > 0.6) dup = true;
      }
    }
  }
  checked++;
  if (dup) goldAlsoElsewhere++; else goldOnlyHere++;
  if (goldHitHere) { /* 顺带统计：跨会话检索能否仍命中 gold */ }
}
console.log('  检查 ' + checked + ' 条正例：gold 内容在别的会话也出现 ' + goldAlsoElsewhere
  + ' 条（' + (100 * goldAlsoElsewhere / checked).toFixed(0) + '%）· 仅本会话独有 ' + goldOnlyHere);

console.log('\n=== ③ 跨会话检索会不会把 gold 保持在前面（若做跨会话提示，需保证不串门）===');
let inTop3 = 0, inTop8 = 0, n = 0;
for (const c of P) {
  const rows = crossSearch(c.q, 30);
  if (!rows.length) { n++; continue; }
  const seqs = rows.map((r) => (r.sid === c.sid ? r.seq : -1));
  const ranks = (c.gold || []).map((s) => { const i = seqs.indexOf(s); return i < 0 ? 0 : i + 1; });
  const best = ranks.filter((x) => x > 0).sort((a, b) => a - b)[0] || 0;
  n++;
  if (best && best <= 3) inTop3++;
  if (best && best <= 8) inTop8++;
}
console.log('  跨会话检索（不限 sid）Recall@3 = ' + (100 * inTop3 / n).toFixed(1) + '%'
  + ' · Recall@8 = ' + (100 * inTop8 / n).toFixed(1) + '%  （全库 ' + SIDS.length + ' 个会话混合）');
