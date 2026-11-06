/* AND 路配对题生成 v3 —— 定稿版
 *
 * 相比 v1/v2 的两处关键修正：
 *   ① **池子看 `candidates`，不是 `hits.length`**（v1/v2 都踩了这个坑）。
 *      hits 只有 k 条，把它当池子会让全部候选掉进"3~5 条"被误判成不可用。
 *   ② **所有 bigram 必须都出现在 gold 原文里**。
 *      这样做不是为了让题"好过"，恰恰相反 —— 它把「能不能召回」这个变量彻底钉死：
 *      gold 一定在候选池内，所以 Top-k 命中与否**只取决于排序**。
 *      如果要测的是排序，却让 gold 有时候根本不在池里，量出来的就是召回率，不是排序质量。
 *
 * 另外过滤掉虚词 bigram：v2 生成了「什么 为什」「面板 那个」这种，
 * 池子是够大（50 条）但语义上是噪声，不像真实查询，而且这类词在 gold 行里出现
 * 只是巧合。判据用「停用 bigram 表 + 该 bigram 的 df 上限」。
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

/* 虚词 bigram：跨在常见虚词上的两字窗口。手工列，宁可少列也别漏了导致题面难看。 */
const STOP = new Set(('什么 为什 么了 那个 这个 是不 不是 就是 可以 一下 时候 怎么 '
  + '我们 你们 他们 现在 然后 但是 所以 如果 因为 已经 还是 或者 而且 以及 这样 那样 '
  + '没有 一个 两个 有些 有点 这些 那些 的话 了的 了这 了吗 是在 会有 都能 就要 也要 '
  + '你看 我看 你看 让我 给我 帮你 帮你 好了 行了 对的 是的 不对 也在 都不 还没 '
  + '个产 个文 么样 哪里 哪些 几个 多少 是不 能不 能看 想看 要说 说到 起来 出来').split(/\s+/).filter(Boolean));

const { ALL, FRESH, isPos } = require('./all-cases.js');

const out = [];
for (const c of ALL.concat(FRESH)) {
  if (!isPos(c)) continue;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => df(p) > 0 && !STOP.has(p));
  if (live.length < 2) continue;

  let goldText = '';
  for (const g of c.gold) {
    const r = segText.get(c.sid, Number(g));
    if (r) goldText += '\n' + String(r.text || '');
  }
  if (!goldText) continue;
  const goldLower = goldText.toLowerCase();

  /* ★ 全部 bigram 都必须在 gold 原文里 ⇒ gold 必然进池 ⇒ 只测排序 */
  const inGold = live.filter((p) => goldLower.indexOf(p.toLowerCase()) >= 0);
  if (inGold.length < 2) continue;
  /* 按 df 降序：大池才谈得上"组"，才谈得上并列判定 */
  inGold.sort((a, b) => df(b) - df(a));

  const combos = [];
  for (const n of [2, 3]) {
    if (inGold.length < n) continue;
    combos.push(inGold.slice(0, n));
    if (inGold.length >= n + 1) combos.push(inGold.slice(1, n + 1));
  }

  for (const set of combos) {
    const q = set.join(' ');
    const r = ck._internal.search(c.sid, q, c.k);
    if (r.via !== 'AND') continue;
    const cand = Number(r.candidates || 0);
    if (cand < 15 || cand > 3000) continue;
    const ok = (r.hits || []).some((h) => c.gold.indexOf(Number(h.seq)) >= 0);
    out.push({
      src: c.id, cat: c.cat, sid: c.sid, k: c.k, gold: c.gold,
      q, bg: set.length, cand,
      dfs: set.map((p) => df(p)),
      hit: ok,
    });
  }
}

console.log('合格候选（AND + 全词在 gold 内 + 池 15~3000）' + out.length + ' 条');
console.log('  HIT ' + out.filter((x) => x.hit).length + ' / miss ' + out.filter((x) => !x.hit).length);

/* 每个源题只留一条：优先「池子最大」（大池才有排序空间），同池大取 bg=2 */
const best = new Map();
for (const x of out) {
  const prev = best.get(x.src);
  if (!prev || x.cand > prev.cand) best.set(x.src, x);
}
const picked = [...best.values()].sort((a, b) => a.src.localeCompare(b.src));
const gs = picked.map((x) => x.cand).sort((a, b) => a - b);
const q = (p) => gs[Math.min(gs.length - 1, Math.floor(gs.length * p))];

console.log('\n按源题去重后 ' + picked.length + ' 道：HIT '
  + picked.filter((x) => x.hit).length + ' / miss ' + picked.filter((x) => !x.hit).length);
console.log('  池子 p10=' + q(0.1) + ' p50=' + q(0.5) + ' p90=' + q(0.9) + ' max=' + gs[gs.length - 1]);
const catCount = {};
for (const x of picked) catCount[x.cat] = (catCount[x.cat] || 0) + 1;
console.log('  类别：' + JSON.stringify(catCount));
console.log('');
for (const x of picked) {
  console.log('  ' + x.src.padEnd(6) + String(x.bg) + 'bg cand=' + String(x.cand).padStart(5)
    + ' df=[' + x.dfs.join(',') + '] ' + (x.hit ? 'HIT ' : 'miss') + ' ' + x.q);
}
require('fs').writeFileSync(path.join(__dirname, 'out', 'and-cand3.json'), JSON.stringify(picked, null, 1));
console.log('\n已写入 out/and-cand3.json');
