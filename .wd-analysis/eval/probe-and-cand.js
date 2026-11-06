/* 短查询（AND 路）配对题生成器 —— 只做生成与筛选，不改评测集
 *
 * 设计要点（为什么这样做）：
 *   ① gold 全部沿用长查询的，**不重新标注**。gold 已被 109 题反复验证；
 *      重新标 gold 会把「路由差异」和「题目差异」混在一起，分数变化无法归因。
 *   ② 短查询取长查询 bigram 的**子集**，且必须满足两条硬条件：
 *      · 每个 bigram 的 df > 0（否则产品自动降级到 OR，白测）；
 *      · 子集必须至少有一个 bigram 出现在 gold 原文里（否则必然全 miss，
 *        测出来的是「不可能题」，不是排序）。
 *   ③ 子集大小只取 2 或 3。「2 个 bigram」对应最短的真实查询（如「插件卡顿」= 卡顿/插件），
 *      「3 个」是稍微长一点的（如「飞鸽短信余额」）。
 *      1 个不取：产品对单 bigram 走的是 `live.length===1` 分支，与多 bigram 的 AND 不是同一段代码。
 *
 * ⚠️ 候选会去重：同一道题可能生成多个子集，只保留「命中 gold 且候选池规模适中」的，
 *    太小的池（1~2 条）测不出排序，太大的池（>500）排序噪声压过信号。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({
  dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'),
  log: () => {},
});

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy', 'ck-memory', 'ck.db'));
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wv USING fts5vocab('main','seg_fts','row')");
const dfOf = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
const df = (p) => { const r = dfOf.get(String(p).toLowerCase()); return r ? Number(r.cnt) : 0; };
const segText = db.prepare('SELECT text FROM seg WHERE sid=? AND seq=?');

const { ALL, FRESH, isPos } = require('./all-cases.js');

const out = [];
for (const c of ALL.concat(FRESH)) {
  if (!isPos(c)) continue;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  if (parts.length < 4) continue;
  const live = parts.filter((p) => df(p) > 0);
  if (live.length < 2) continue;

  /* gold 原文（合并多答案）—— 用来挑「出现在答案里的 bigram」 */
  let goldText = '';
  for (const g of c.gold) {
    const r = segText.get(c.sid, Number(g));
    if (r) goldText += ' ' + String(r.text || '');
  }
  if (!goldText) continue;
  const goldLower = goldText.toLowerCase();

  /* 候选优先：在 gold 里出现的 bigram（answer-bearing），按 df 升序（越稀有越有区分度） */
  const inGold = live.filter((p) => goldLower.indexOf(p.toLowerCase()) >= 0);
  if (!inGold.length) continue;
  inGold.sort((a, b) => df(a) - df(b));

  const trySizes = [2, 3];
  for (const n of trySizes) {
    if (inGold.length < n) continue;
    /* 取 df 最低的 n 个 + 兜底补一些常用组合，看候选池规模是否合理 */
    const sets = [];
    sets.push(inGold.slice(0, n));
    /* 再加一组「最稀有 + 最常用」的混搭，避免全是极稀有词导致池太小 */
    if (inGold.length > n) {
      const rare = inGold[0];
      const common = inGold[inGold.length - 1];
      const mix = [rare, common, ...inGold.slice(1, n - 1)];
      sets.push([...new Set(mix)].slice(0, n));
    }
    for (const set of sets) {
      if (set.length !== n) continue;
      if (set.some((p) => df(p) === 0)) continue;
      const q = set.join(' ');
      const r = ck._internal.search(c.sid, q, c.k);
      const cand = Number(r.candidates || (r.hits || []).length);
      out.push({
        src: c.id, cat: c.cat, sid: c.sid, k: c.k, gold: c.gold, minHit: c.minHit,
        q, bg: n, cand, via: r.via, got: (r.hits || []).length,
        hit: (r.hits || []).some((h) => c.gold.indexOf(Number(h.seq)) >= 0),
      });
    }
  }
}

/* 只看真走 AND 的 */
const ands = out.filter((x) => x.via === 'AND');
console.log('生成候选 ' + out.length + ' 条，其中走 AND 的 ' + ands.length + ' 条');

const buckets = { tiny: 0, ok: 0, big: 0 };
for (const x of ands) {
  if (x.got < 3) buckets.tiny++; else if (x.got > 400) buckets.big++; else buckets.ok++;
}
console.log('返回条数分布：<3 条 ' + buckets.tiny + ' · 3~400 条 ' + buckets.ok + ' · >400 条 ' + buckets.big);
console.log('');

const good = ands.filter((x) => x.got >= 3 && x.got <= 400);
console.log('可用候选（3~400 条）' + good.length + ' 条，命中 gold 的 '
  + good.filter((x) => x.hit).length + ' 条 / 未命中 ' + good.filter((x) => !x.hit).length + ' 条');
console.log('');
console.log('样例（前 25 条）：');
for (const x of good.slice(0, 25)) {
  console.log('  ' + x.src + ' ' + x.bg + 'bg  got=' + String(x.got).padStart(4)
    + '  ' + (x.hit ? 'HIT ' : 'miss') + '  ' + x.q);
}
require('fs').writeFileSync(path.join(__dirname, 'out', 'and-cand.json'),
  JSON.stringify(good, null, 1));
console.log('');
console.log('已写入 out/and-cand.json');
