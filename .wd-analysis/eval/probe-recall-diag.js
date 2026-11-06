/* probe-recall-diag.js — 区分「召回失败」与「排序失败」
 *
 * 关键问题：seg 严格 Recall 61.5%，失败的那 42 条到底是
 *   R1 候选池里根本没有 gold（真·召回问题，要改检索式/分词/索引）
 *   R2 候选池里有 gold，但排在 k 名之外（排序问题）
 *   R3 有 gold 且在前 k，但被 noise/pri 过滤掉了（索引期过滤问题）
 *
 * 做法：把 search() 的内部候选池（candidates）与最终 hits 分开看。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const A = require('./all-cases.js');
const ALL = A.ALL;
const cases = ALL.filter((c) => (c.gold || []).length > 0);

/* 用 ck 内部的 seg 表直查：gold seq 在候选池里排第几 */
const db = ck._internal.open();

function goldIn(sid, seqs) {
  return db.prepare(`SELECT seq, pri, COALESCE(noise,0) nz, kind, LENGTH(text) len FROM seg WHERE sid = ? AND seq IN (${seqs.map(() => '?').join(',')})`).all(sid, ...seqs);
}

const stat = { total: 0, hit5: 0, inPoolNoRank: 0, notInPool: 0, filtered: 0 };

console.log('=== 逐题诊断（只列失败题）===');
for (const c of cases) {
  const k = c.k || 8;
  const r = ck._internal.search(c.sid, c.q, k);
  const hits = (r.hits || []).map((h) => h.seq);
  const gold = c.gold;
  const top5 = hits.slice(0, 5);
  stat.total++;
  if (gold.some((g) => top5.includes(g))) { stat.hit5++; continue; }

  /* 失败题：查 gold 是否在候选池 / 是否被过滤 */
  const g = goldIn(c.sid, gold);
  const passedFilter = g.filter((x) => Number(x.pri) >= 1 && Number(x.nz) === 0 && (x.kind === 'user' || x.kind === 'assistant'));
  const inHits = gold.some((x) => hits.includes(x));
  let kind;
  if (!g.length) kind = 'MISSING(库里没有该 seq)';
  else if (!passedFilter.length) { kind = 'FILTERED'; stat.filtered++; }
  else if (inHits) { kind = 'RANKED_OUT(在 hits 但>5)'; stat.inPoolNoRank++; }
  else { kind = 'NOT_IN_POOL'; stat.notInPool++; }
  console.log(`  ${c.id.padEnd(6)} ${kind.padEnd(26)} gold=${JSON.stringify(gold)} hits5=${JSON.stringify(top5)} via=${r.via} cands=${r.candidates}`);
  if (g.length) console.log(`         gold 行: ${g.map((x) => `seq${x.seq}(pri${x.pri},nz${x.nz},${x.kind},${x.len}字)`).join(' ')}`);
}

console.log('\n=== 汇总 ===');
console.log('  正例', stat.total, '| 前5命中', stat.hit5, `(${(stat.hit5 / stat.total * 100).toFixed(1)}%)`);
console.log('  失败中：被过滤', stat.filtered, '| 在池但排外', stat.inPoolNoRank, '| 不在池', stat.notInPool);
