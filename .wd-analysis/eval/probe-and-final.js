/* AND 路配对题生成 v4 —— 最终产出 cases-and.js 的输入
 *
 * v3 → v4 改了四处，每处都有具体理由：
 *   ① **剔除 fresh 组**。all-cases.js 的头部注释已经写明：fresh 是「新鲜度梯度」的
 *      因果实验组，混进总分会把自变量稀释掉。v3 里 84 道有 17 道是 fresh，
 *      且全是「断言 回归」「回归 套件」这几道题的变体，等于用同一道题重复计 17 次。
 *   ② **剔除纯数字 bigram 组成的查询**。v3 生成了「1 2」「0 v1」这种东西 ——
 *      df 巨大（36525）、池子 208 条，看着像大池子好题，实际是「所有带 1 和 2 的段落」，
 *      语义上是噪声。判据：至少一个 bigram 含中文字符。
 *   ③ **按 (sid, q) 去重**。不同源题落在同一会话时可能浓缩出同一个查询，
 *      比如 NC01/NU09 都是「画册 产品」—— 重复计分等于给这道题加权。
 *   ④ **每个源题只留一条**，优先大池（排序空间大）。
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

const STOP = new Set(('什么 为什 么了 那个 这个 是不 不是 就是 可以 一下 时候 怎么 '
  + '我们 你们 他们 现在 然后 但是 所以 如果 因为 已经 还是 或者 而且 以及 这样 那样 '
  + '没有 一个 两个 有些 有点 这些 那些 的话 了的 了这 了吗 是在 会有 都能 就要 也要 '
  + '你看 我看 让我 给我 帮你 好了 行了 对的 是的 不对 也在 都不 还没 '
  + '个产 个文 么样 哪里 哪些 几个 多少 能不 能看 想看 要说 说到 起来 出来 里面').split(/\s+/).filter(Boolean));

const { ALL, isPos } = require('./all-cases.js');   // ← 不含 FRESH

const out = [];
for (const c of ALL) {
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

  const inGold = live.filter((p) => goldLower.indexOf(p.toLowerCase()) >= 0);
  if (inGold.length < 2) continue;
  inGold.sort((a, b) => df(b) - df(a));

  const combos = [];
  for (const n of [2, 3]) {
    if (inGold.length < n) continue;
    combos.push(inGold.slice(0, n));
    if (inGold.length >= n + 1) combos.push(inGold.slice(1, n + 1));
  }

  for (const set of combos) {
    /* ② 至少一个 bigram 含中文，否则是「1 2」「0 v1」这类纯数字噪声 */
    if (!set.some((p) => /[\u4e00-\u9fa5]/.test(p))) continue;
    const q = set.join(' ');
    const r = ck._internal.search(c.sid, q, c.k);
    if (r.via !== 'AND') continue;
    const cand = Number(r.candidates || 0);
    if (cand < 15 || cand > 3000) continue;
    out.push({
      src: c.id, cat: c.cat, sid: c.sid, k: c.k, gold: c.gold,
      why: c.why,
      q, bg: set.length, cand,
      dfs: set.map((p) => df(p)),
      hit: (r.hits || []).some((h) => c.gold.indexOf(Number(h.seq)) >= 0),
    });
  }
}

/* ④ 每个源题只留一条（池子最大者） */
const bySrc = new Map();
for (const x of out) {
  const prev = bySrc.get(x.src);
  if (!prev || x.cand > prev.cand) bySrc.set(x.src, x);
}
/* ③ 按 (sid,q) 去重 —— 保留池子大的那条 */
const byQuery = new Map();
for (const x of bySrc.values()) {
  const k = x.sid + '|' + x.q;
  const prev = byQuery.get(k);
  if (!prev || x.cand > prev.cand) byQuery.set(k, x);
}
const picked = [...byQuery.values()].sort((a, b) => a.src.localeCompare(b.src));
const gs = picked.map((x) => x.cand).sort((a, b) => a - b);
const q = (p) => gs[Math.min(gs.length - 1, Math.floor(gs.length * p))];
const catCount = {};
for (const x of picked) catCount[x.cat] = (catCount[x.cat] || 0) + 1;

console.log('最终 ' + picked.length + ' 道 AND 路配对题');
console.log('  HIT ' + picked.filter((x) => x.hit).length
  + ' / miss ' + picked.filter((x) => !x.hit).length);
console.log('  池子 p10=' + q(0.1) + ' p50=' + q(0.5) + ' p90=' + q(0.9) + ' max=' + gs[gs.length - 1]);
console.log('  类别 ' + JSON.stringify(catCount));
console.log('');
for (const x of picked) {
  console.log('  ' + x.src.padEnd(6) + String(x.bg) + 'bg cand=' + String(x.cand).padStart(4)
    + ' ' + (x.hit ? 'HIT ' : 'miss') + ' ' + x.q);
}
require('fs').writeFileSync(path.join(__dirname, 'out', 'and-final.json'), JSON.stringify(picked, null, 1));
console.log('\n已写入 out/and-final.json');
