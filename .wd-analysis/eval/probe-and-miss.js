/* AND 路 miss 归因探针 —— 到底是"排序没排进来"还是"题本身有多答案"
 *
 * 为什么必须先做这一步再定稿题集：
 *   自动生成的短查询「全 bigram 都在 gold 行里」，理论上 gold 应该强相关。
 *   如果 28/50 都 miss，有两种完全不同的解释：
 *     ① 排序坏了 —— gold 在池里排到 30 名开外（真问题，正是要测的东西）
 *     ② 题坏了 —— gold 排第 6~8 名，只是 k=5 差一点；或同会话里有别的段落
 *        也完整回答了这个问题（原题 gold 是人工挑的"最典型那条"，不代表唯一）
 *   用名次分布就能把两者分开：如果 miss 大量集中在名次 6~10，那是 k 太紧；
 *   如果散在几十名，那是排序信号弱。
 *
 * 同时输出「同会话里还有几条也含全部 bigram 且更长/更像答案」——
 * 帮助判断是否该放宽 gold（多答案题）。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({
  dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'),
  log: () => {},
});

const final = require('./out/and-final.json');

const rows = [];
for (const x of final) {
  /* 用大 limit 把整个池子按产品排序拿一遍，看 gold 的真实名次。
     ⚠️ 产品 limit 上限 40，所以分两次不行 —— 直接调 _internal.search 传 40，
        名次超过 40 的记为 ">40"。这已经足够区分归因。 */
  const r = ck._internal.search(x.sid, x.q, 40);
  const seqs = (r.hits || []).map((h) => Number(h.seq));
  let best = -1;
  for (const g of x.gold) {
    const i = seqs.indexOf(Number(g));
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  rows.push({
    ...x,
    rank: best < 0 ? 999 : best + 1,
    cand: Number(r.candidates || 0),
    via: r.via,
  });
}

const hit = rows.filter((r) => r.rank <= r.k);
const miss = rows.filter((r) => r.rank > r.k);
console.log('总 ' + rows.length + ' 道：k 内命中 ' + hit.length + ' / 未命中 ' + miss.length);
console.log('');

function dist(list, label) {
  const b = { '1': 0, '2-3': 0, '4-5': 0, '6-10': 0, '11-20': 0, '21-40': 0, '>40': 0 };
  for (const r of list) {
    if (r.rank === 1) b['1']++;
    else if (r.rank <= 3) b['2-3']++;
    else if (r.rank <= 5) b['4-5']++;
    else if (r.rank <= 10) b['6-10']++;
    else if (r.rank <= 20) b['11-20']++;
    else if (r.rank <= 40) b['21-40']++;
    else b['>40']++;
  }
  console.log(label + '：' + JSON.stringify(b));
}
dist(rows, 'gold 名次分布');

console.log('');
console.log('未命中的题，逐条看名次（判断是"差一点"还是"排丢了"）：');
for (const r of miss.sort((a, b) => a.rank - b.rank)) {
  console.log('  ' + r.src.padEnd(6) + 'k=' + r.k + ' rank=' + (r.rank > 40 ? '>40' : r.rank)
    + ' cand=' + r.cand + '  ' + r.q);
}

const near = miss.filter((r) => r.rank <= 10).length;
const far = miss.filter((r) => r.rank > 10 && r.rank <= 40).length;
const lost = miss.filter((r) => r.rank > 40).length;
console.log('');
console.log('归因：名次 6~10（差一点，k 太紧）' + near
  + ' · 11~40（排序信号弱）' + far
  + ' · >40（基本排丢）' + lost);
