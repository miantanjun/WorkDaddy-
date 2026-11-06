/* 记忆检索评测跑分器
 *
 * 用法：
 *   node .wd-analysis/eval/run-eval.js                 # 全部用例，四路对比
 *   node .wd-analysis/eval/run-eval.js --mode=seg      # 只看某一路
 *   node .wd-analysis/eval/run-eval.js --save=base     # 存基线到 eval/baseline-base.json
 *   node .wd-analysis/eval/run-eval.js --diff=base     # 与基线对比
 *
 * ⚠️ 一律跑**数据库副本**（--data 指定），不跑线上库。
 *    原因有两个：① 检索会回写 last_hit_ts / hit_n，跑一轮评测等于给每道题的答案行
 *    人为加一次「刚被用过」= 污染新鲜度信号；② 线上库随时被 daemon 写，结果不可复现。
 *
 * 四条检索路分别量，因为混在一起就定位不到是哪一层坏了：
 *   seg   —— 只有原文 bigram（阶段 1 的成果）
 *   fact  —— 只有事实层词法（阶段 4）
 *   ent   —— 只有实体精确通道（阶段 5）
 *   fuse  —— 三路 RRF（当前实际对外的那条）
 *
 * 指标：
 *   Recall@k —— 金标准行有没有进前 k。多金标准时按 minHit 判（**默认 1，不是全部命中**）
 *               ⚠️ 曾把默认写成「全部命中」⇒ S06 两条 gold 记的是同一件事、
 *                  检索把第二条排第 3，按全中判不算召回，可答案明明找到了。
 *                  只有真多跳（要两个不同事实才能答）才显式写 minHit:2。
 *   RecallT  —— 回合级召回：命中 gold ±2 也算。同一回合相邻行常是「引用/复述同一结论」，
 *              严格口径会把它判成漏。两个指标**并列输出，不合并**（合并就把严格口径藏起来了）。
 *   MRR      —— 第一个金标准行的名次倒数，看「排得够不够前」，不只看有没有
 *   Noise@k  —— **只对负例计算**：这类问题本不该有答案，返回了就算噪声
 *   RejAcc   —— 负例里正确返回空的比例（= 1 − Noise@k）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const { CASES } = require('./cases.js');

/* ---------- 参数 ---------- */
const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}

// 默认数据目录 = 仓库内副本（不碰 %APPDATA%）
const DATA_DIR = argv.data || path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
if (!fs.existsSync(path.join(DATA_DIR, 'ck-memory', 'ck.db'))) {
  console.error('找不到评测库：' + path.join(DATA_DIR, 'ck-memory', 'ck.db'));
  console.error('先复制一份：见 run-eval.js 头部说明，或 --data=<含有 ck-memory/ck.db 的目录>');
  process.exit(2);
}
ck.configure({ dataDir: DATA_DIR, log: () => {} });

const MODES = argv.mode ? [String(argv.mode)] : ['seg', 'fact', 'ent', 'fuse'];
const LIMIT = Number(argv.limit) || 0;   // 0 = 全部用例

/* ---------- 单路检索：统一返回 [{seq, ...}] ---------- */
// ⚠️⚠️ 必须用 `ck._internal.search` / `ck._internal.searchFacts`（带 sid 的实现），
//   不能用导出的 `ck.search` —— 后者的签名是 (q, limit, deep)，**没有 sid**，
//   把 sid 当第一个参数传进去会静默错位：q 变成一串 uuid、limit 变成查询词，
//   返回一堆无关行且不报错。这个坑实测踩过一次，见 ck-memory.js 导出处注释。
const S = ck._internal.search;
const SF = ck._internal.searchFacts;

function runSeg(c) {
  const r = S(c.sid, c.q, c.k);
  return (r.hits || []).map((h) => ({ seq: h.seq, src: 'seg' }));
}
function runFact(c) {
  const r = SF(c.sid, c.q, c.k, {});
  return (r.items || []).map((f) => ({
    seq: f.srcSegId, src: 'fact', via: r.via, text: f.text,
    cover: factToSeqs(c.sid, f.text),
  }));
}
function runEnt(c) {
  const r = SF(c.sid, c.q, c.k, {});
  return (r.exactItems || []).map((f) => ({
    seq: f.srcSegId, src: 'ent', text: f.text,
    cover: factToSeqs(c.sid, f.text),
  }));
}
function runFuse(c) {
  // ⚠️ 必须**逐行**对齐 /api/ck-memory/search?fuse=true 的实现（见 ck-memory.js 路由），
  //   包括「原文路判了 ENX-MISS / ID-MISS 就不许融合层翻案」那一道。
  //   不对齐的话，评测测的是一条产品里根本不存在的路径 —— 这段时间就这么量错过一次。
  const r = S(c.sid, c.q, c.k);
  if (r.via === 'ENT-MISS' || r.via === 'ID-MISS') return [];
  const fr = SF(c.sid, c.q, Math.min(6, c.k), {});
  const facts = fr.items || [];
  const exact = fr.exactItems || [];
  const segs = (r.hits || []).map((h, i) => Object.assign({ id: 'h' + i }, h));
  const fused = ck.rrfFuse(facts, segs, { ents: exact }).slice(0, c.k);
  return fused.map((x) => ({
    seq: x.type === 'fact' ? (x.item.srcSegId || 0) : x.item.seq,
    src: x.type, lanes: x.hits,
    cover: x.type === 'fact' ? factToSeqs(c.sid, x.item.text) : [],
  }));
}

const RUNNERS = { seg: runSeg, fact: runFact, ent: runEnt, fuse: runFuse };

/**
 * 把「一条事实」映射回它对应的原文 seq 区间，用于和 gold seq 对齐。
 *
 * ⚠️⚠️⚠️ 为什么不能直接用 fact.srcSegId：
 *   实测（本机库 16 条事实只有 2 个不同的 src_seg_id）确认，旧实现里
 *   `src_seg_id` = 这批抽取的**对话起点**，不是这条事实的依据句。
 *   （本轮已修：新增 bestSrcSeg() 逐条反查，但**历史数据不会自动重算**，
 *    所以评测不能依赖它，否则量的是历史包袱而不是当前实现。）
 *
 * 现在的口径：拿事实文本的有辨识度片段去该会话里 LIKE 定位，
 *   命中的 seq 就算这条事实覆盖了那里。这也是「事实能不能用来找到答案」
 *   这个问题的实质 —— 它不依赖任何内部账本字段。
 */
const _factMapCache = new Map();
function factToSeqs(sid, text) {
  const key = sid + '|' + text;
  if (_factMapCache.has(key)) return _factMapCache.get(key);
  const db = ck._internal.open();
  // 取事实里最长的 2~3 个连续汉字片段当指纹（短片段会命中上千行）
  const zh = String(text).match(/[\u4e00-\u9fa5]{4,}/g) || [];
  const en = String(text).match(/[A-Za-z0-9][A-Za-z0-9_.\-]{4,}/g) || [];
  const pieces = zh.concat(en).sort((a, b) => b.length - a.length).slice(0, 3);
  const out = [];
  for (const p of pieces) {
    try {
      const rows = db.prepare(
        'SELECT DISTINCT seq FROM seg WHERE sid = ? AND instr(replace(text, char(10), \' \'), ?) > 0'
      ).all(sid, p);
      for (const r of rows) if (out.indexOf(r.seq) < 0) out.push(r.seq);
    } catch (_) {}
  }
  _factMapCache.set(key, out);
  return out;
}

/* ---------- 判分 ---------- */
/**
 * ⚠️ 多金标准时的默认口径是 **minHit = 1**，不是「全中」。
 *   理由来自本轮实测：S06 问「v1.4.0 APK 大小」，gold 写了 [2569, 2571]
 *   （两行都记了这个大小），而检索把 2571 排在第 3 位 ——
 *   按「全中」判是不算召回，可按「有没有找到答案」判它明明找到了。
 *   Recall@k 问的是「答案在不在前 k」，不是「每条等价表述是不是都进来了」。
 *   需要两条都必须出现的（真正的多跳），在用例里显式写 `minHit: 2`。
 */
function scoreCase(c, got, mode) {
  const gold = c.gold || [];
  const want = c.minHit || 1;
  if (!gold.length) {
    // 负例：返回了任何东西都算噪声
    return { recall: 0, mrr: 0, noise: got.length > 0, hits: got.length, rank: 0 };
  }
  // fact / ent / fuse 路：每条结果可能带「覆盖的原文区间」，展开后再比
  const seqs = [];
  for (const g of got) {
    if (Array.isArray(g.cover)) for (const s of g.cover) if (seqs.indexOf(s) < 0) seqs.push(s);
    if (seqs.indexOf(g.seq) < 0) seqs.push(g.seq);
  }
  const ranks = gold.map((s) => {
    const i = seqs.indexOf(s);
    return i < 0 ? 0 : i + 1;
  });
  const found = ranks.filter((x) => x > 0).length;
  // 回合级：命中 gold ±2 也算（同一回合的相邻行常常是「引用/复述」同一结论）
  const near = gold.map((s) => seqs.some((x) => Math.abs(x - s) <= 2));
  const recall = found >= want ? 1 : 0;
  const recallT = near.filter(Boolean).length >= want ? 1 : 0;
  const best = ranks.filter((x) => x > 0).sort((a, b) => a - b)[0] || 0;
  return { recall, recallT, mrr: best ? 1 / best : 0, noise: false, hits: got.length, rank: best, found, want };
}

/* ---------- 主流程 ---------- */
const list = LIMIT ? CASES.slice(0, LIMIT) : CASES;
const cats = ['single', 'multi', 'temporal', 'open', 'negative'];
const report = {};
const detail = [];

console.log('评测库：' + DATA_DIR);
console.log('用例：' + list.length + ' 条（' + cats.map((x) => x + '=' + list.filter((c) => c.cat === x).length).join(' / ') + '）');
console.log('');

for (const mode of MODES) {
  const per = {};
  for (const cat of cats) per[cat] = { n: 0, hit: 0, hitT: 0, mrr: 0, noise: 0 };
  const t0 = Date.now();
  for (const c of list) {
    const got = RUNNERS[mode](c);
    const s = scoreCase(c, got, mode);
    const b = per[c.cat];
    b.n++;
    if (c.cat === 'negative') { if (s.noise) b.noise++; b.hit += s.noise ? 0 : 1; b.hitT += s.noise ? 0 : 1; }
    else { b.hit += s.recall; b.hitT += s.recallT; b.mrr += s.mrr; }
    detail.push({ mode, id: c.id, cat: c.cat, q: c.q, recall: s.recall, recallT: s.recallT,
      mrr: s.mrr, noise: s.noise, hits: s.hits, rank: s.rank, got: got.slice(0, 5).map((g) => g.seq) });
  }
  report[mode] = { per, ms: Date.now() - t0 };
}

/* ---------- 输出 ---------- */
function pct(x) { return (x * 100).toFixed(1).padStart(5) + '%'; }

console.log('类别          n   ' + MODES.map((m) => m.padStart(17)).join('  '));
console.log('-'.repeat(30 + MODES.length * 19));
for (const cat of cats) {
  const cells = MODES.map((m) => {
    const b = report[m].per[cat];
    if (!b.n) return ' '.repeat(17);
    if (cat === 'negative') return ('拒答 ' + pct(b.hit / b.n)).padStart(17);
    return (pct(b.hit / b.n) + ' / MRR ' + (b.mrr / b.n).toFixed(3)).padStart(17);
  });
  console.log(cat.padEnd(12) + String(report[MODES[0]].per[cat].n).padStart(4) + '  ' + cells.join('  '));
}
console.log('-'.repeat(30 + MODES.length * 19));
for (const m of MODES) {
  const pos = cats.filter((c) => c !== 'negative');
  const n = pos.reduce((s, c) => s + report[m].per[c].n, 0);
  const hit = pos.reduce((s, c) => s + report[m].per[c].hit, 0);
  const hitT = pos.reduce((s, c) => s + report[m].per[c].hitT, 0);
  const mrr = pos.reduce((s, c) => s + report[m].per[c].mrr, 0);
  const neg = report[m].per.negative;
  console.log(m.padEnd(5) + ' 严格 Recall ' + pct(hit / n)
    + ' · 回合级 ' + pct(hitT / n)
    + ' · MRR ' + (mrr / n).toFixed(3)
    + ' · 负例拒答 ' + pct(neg.hit / neg.n)
    + ' · ' + report[m].ms + 'ms');
}

/* ---------- 失败明细（最高信噪比的部分）---------- */
if (!argv.quiet) {
  console.log('\n== 未召回 / 噪声 明细 ==');
  for (const d of detail) {
    if (d.cat === 'negative' ? !d.noise : d.recall) continue;
    console.log('  [' + d.mode + '] ' + d.id + ' ' + (d.cat === 'negative' ? '噪声' : '未召回')
      + ' q=' + JSON.stringify(d.q) + ' got=' + JSON.stringify(d.got));
  }
}

/* ---------- 存 / 比 ---------- */
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const snap = {};
for (const m of MODES) {
  const pos = cats.filter((c) => c !== 'negative');
  const n = pos.reduce((s, c) => s + report[m].per[c].n, 0);
  snap[m] = {
    recall: +(pos.reduce((s, c) => s + report[m].per[c].hit, 0) / n).toFixed(4),
    mrr: +(pos.reduce((s, c) => s + report[m].per[c].mrr, 0) / n).toFixed(4),
    rejAcc: +(report[m].per.negative.hit / report[m].per.negative.n).toFixed(4),
    perCat: Object.fromEntries(cats.map((c) => [c, {
      n: report[m].per[c].n, hit: report[m].per[c].hit,
      mrr: +(report[m].per[c].mrr / Math.max(1, report[m].per[c].n)).toFixed(4),
    }])),
  };
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.writeFileSync(path.join(outDir, 'detail-' + stamp + '.json'),
  JSON.stringify({ dataDir: DATA_DIR, at: stamp, summary: snap, detail }, null, 1), 'utf8');

if (argv.save) {
  fs.writeFileSync(path.join(__dirname, 'baseline-' + argv.save + '.json'),
    JSON.stringify({ dataDir: DATA_DIR, at: stamp, summary: snap }, null, 1), 'utf8');
  console.log('\n基线已存：eval/baseline-' + argv.save + '.json');
}
if (argv.diff) {
  const p = path.join(__dirname, 'baseline-' + argv.diff + '.json');
  if (!fs.existsSync(p)) console.log('\n没有基线文件 ' + p);
  else {
    const old = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log('\n== 与基线 ' + argv.diff + '（' + old.at + '）对比 ==');
    for (const m of MODES) {
      if (!old.summary[m]) { console.log('  ' + m + ' 基线里没有'); continue; }
      const d = (k) => {
        const v = snap[m][k] - old.summary[m][k];
        const s = (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + 'pt';
        return (v > 0.00005 ? '↑' : v < -0.00005 ? '↓' : '=') + s;
      };
      console.log('  ' + m.padEnd(5) + ' Recall ' + d('recall') + ' · MRR ' + d('mrr') + ' · 拒答 ' + d('rejAcc'));
    }
  }
}
