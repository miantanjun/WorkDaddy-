/* 记忆检索评测跑分器 v2 —— 支持扩充后的题集与显著性检验
 *
 * 用法：
 *   node run-eval2.js                      # 全量（86 条），四路对比
 *   node run-eval2.js --set=base           # 只跑原 39 条（与历史基线可比）
 *   node run-eval2.js --set=extra          # 只跑新增 47 条
 *   node run-eval2.js --mode=seg           # 只看某一路
 *   node run-eval2.js --save=v2            # 存基线
 *   node run-eval2.js --diff=stage6        # 与旧基线比（只对同 id 的题有意义）
 *   node run-eval2.js --pair               # 输出每题的逐条结果 json（供 McNemar）
 *
 * 与 run-eval.js 的差别，只有三处必要改动：
 *   ① 题集换成 all-cases.js（含新增的 numeric / coref / cross 三类）
 *   ② 类别列表从 data-driven 生成，不再写死五类
 *   ③ 多出 --pair：把「每题命中与否」按 id 导出，这是做显著性检验的唯一输入
 *
 * ⚠️ 其余口径**一行都没动** —— 尤其这几条不能改，改了历史基线就不可比：
 *   · 默认数据目录仍是 .wd-tmp/evaldata（副本库，不碰线上）
 *   · 必须用 ck._internal.search（带 sid），不能用导出的 ck.search
 *   · minHit 默认 1；严格 Recall 与回合级 RecallT 并列输出，不合并
 *   · 融合路必须逐行对齐产品路由（含 ENX/ID-MISS 拦截）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}

const DATA_DIR = argv.data || path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
if (!fs.existsSync(path.join(DATA_DIR, 'ck-memory', 'ck.db'))) {
  console.error('找不到评测库：' + path.join(DATA_DIR, 'ck-memory', 'ck.db'));
  process.exit(2);
}
ck.configure({ dataDir: DATA_DIR, log: () => {} });

const { ALL, BASE, EXTRA, BATCH3 } = require('./all-cases.js');
const SETS = { all: ALL, base: BASE, extra: EXTRA, b3: BATCH3 };
const setName = argv.set || 'all';
const list = SETS[setName];
if (!list) { console.error('未知 --set=' + setName + '（可选 all/base/extra/b3）'); process.exit(2); }

const MODES = argv.mode ? [String(argv.mode)] : ['seg', 'fact', 'ent', 'fuse'];

/* 类别从数据里推出来，不再写死 —— 新增 numeric/coref/cross 时不用改这里 */
const CAT_ORDER = ['single', 'multi', 'temporal', 'numeric', 'coref', 'cross', 'open', 'negative'];
const cats = CAT_ORDER.filter((c) => list.some((x) => x.cat === c));
for (const c of list) if (cats.indexOf(c.cat) < 0) cats.push(c.cat);

const S = ck._internal.search;
const SF = ck._internal.searchFacts;

function runSeg(c) {
  const r = S(c.sid, c.q, c.k);
  return (r.hits || []).map((h) => ({ seq: h.seq, src: 'seg' }));
}
function runFact(c) {
  const r = SF(c.sid, c.q, c.k, {});
  return (r.items || []).map((f) => ({
    seq: f.srcSegId, src: 'fact', cover: factToSeqs(c.sid, f.text),
  }));
}
function runEnt(c) {
  const r = SF(c.sid, c.q, c.k, {});
  return (r.exactItems || []).map((f) => ({
    seq: f.srcSegId, src: 'ent', cover: factToSeqs(c.sid, f.text),
  }));
}
function runFuse(c) {
  const r = S(c.sid, c.q, c.k);
  if (r.via === 'ENT-MISS' || r.via === 'ID-MISS') return [];
  const fr = SF(c.sid, c.q, Math.min(6, c.k), {});
  const facts = fr.items || [];
  const exact = fr.exactItems || [];
  const segs = (r.hits || []).map((h, i) => Object.assign({ id: 'h' + i }, h));
  const fused = ck.rrfFuse(facts, segs, { ents: exact }).slice(0, c.k);
  return fused.map((x) => ({
    seq: x.type === 'fact' ? (x.item.srcSegId || 0) : x.item.seq,
    src: x.type,
    cover: x.type === 'fact' ? factToSeqs(c.sid, x.item.text) : [],
  }));
}
const RUNNERS = { seg: runSeg, fact: runFact, ent: runEnt, fuse: runFuse };

const _factMapCache = new Map();
function factToSeqs(sid, text) {
  const key = sid + '|' + text;
  if (_factMapCache.has(key)) return _factMapCache.get(key);
  const db = ck._internal.open();
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

function scoreCase(c, got) {
  const gold = c.gold || [];
  const want = c.minHit || 1;
  if (!gold.length) return { recall: 0, recallT: 0, mrr: 0, noise: got.length > 0, hits: got.length, rank: 0 };
  const seqs = [];
  for (const g of got) {
    if (Array.isArray(g.cover)) for (const s of g.cover) if (seqs.indexOf(s) < 0) seqs.push(s);
    if (seqs.indexOf(g.seq) < 0) seqs.push(g.seq);
  }
  const ranks = gold.map((s) => { const i = seqs.indexOf(s); return i < 0 ? 0 : i + 1; });
  const found = ranks.filter((x) => x > 0).length;
  const near = gold.map((s) => seqs.some((x) => Math.abs(x - s) <= 2));
  const best = ranks.filter((x) => x > 0).sort((a, b) => a - b)[0] || 0;
  return {
    recall: found >= want ? 1 : 0,
    recallT: near.filter(Boolean).length >= want ? 1 : 0,
    mrr: best ? 1 / best : 0,
    noise: false, hits: got.length, rank: best, found, want,
  };
}

/* ---------- 主流程 ---------- */
const report = {};
const detail = [];
console.log('评测库：' + DATA_DIR);
console.log('题集：' + setName + ' · ' + list.length + ' 条（'
  + cats.map((x) => x + '=' + list.filter((c) => c.cat === x).length).join(' / ') + '）\n');

for (const mode of MODES) {
  if (!RUNNERS[mode]) { console.log('跳过未知 mode: ' + mode); continue; }
  const per = {};
  for (const cat of cats) per[cat] = { n: 0, hit: 0, hitT: 0, mrr: 0, noise: 0, vac: 0 };
  const t0 = Date.now();
  for (const c of list) {
    const got = RUNNERS[mode](c);
    const s = scoreCase(c, got);
    const b = per[c.cat];
    /* ⚠️ gold=[] 且 cat!=='negative' 的题是「配对负例」（cross 类里那 5 道同主题跨会话题），
     *   它考的是「答不出才对」，不属于召回分母。以前把它算进正例 n ⇒ 正例数虚高 5 条
     *   （显示 78 实为 73），任何 recall 都被稀释 6%。单独计 vac，不进 n。 */
    if (c.cat !== 'negative' && !(c.gold || []).length) {
      b.vac++;
      detail.push({
        mode, id: c.id, cat: c.cat, q: c.q, recall: s.recall, recallT: s.recallT,
        mrr: s.mrr, noise: s.noise, hits: s.hits, rank: s.rank, vac: true,
        got: got.slice(0, 5).map((g) => g.seq),
      });
      continue;
    }
    b.n++;
    if (c.cat === 'negative') { if (s.noise) b.noise++; b.hit += s.noise ? 0 : 1; b.hitT += s.noise ? 0 : 1; }
    else { b.hit += s.recall; b.hitT += s.recallT; b.mrr += s.mrr; }
    detail.push({
      mode, id: c.id, cat: c.cat, q: c.q, recall: s.recall, recallT: s.recallT,
      mrr: s.mrr, noise: s.noise, hits: s.hits, rank: s.rank, vac: false,
      got: got.slice(0, 5).map((g) => g.seq),
    });
  }
  report[mode] = { per, ms: Date.now() - t0 };
}

function pct(x) { return (x * 100).toFixed(1).padStart(5) + '%'; }

const W = 19;
console.log('类别          n   ' + MODES.map((m) => m.padStart(W)).join('  '));
console.log('-'.repeat(24 + MODES.length * (W + 2)));
for (const cat of cats) {
  const cells = MODES.map((m) => {
    const b = report[m] && report[m].per[cat];
    if (!b || !b.n) return ' '.repeat(W);
    if (cat === 'negative') return ('拒答 ' + pct(b.hit / b.n)).padStart(W);
    return (pct(b.hit / b.n) + ' / MRR ' + (b.mrr / b.n).toFixed(3)).padStart(W);
  });
  console.log(cat.padEnd(12) + String((report[MODES[0]] || {}).per ? report[MODES[0]].per[cat].n : 0).padStart(4) + '  ' + cells.join('  '));
}
console.log('-'.repeat(24 + MODES.length * (W + 2)));

const summ = {};
for (const m of MODES) {
  if (!report[m]) continue;
  const pos = cats.filter((c) => c !== 'negative');
  const n = pos.reduce((s, c) => s + report[m].per[c].n, 0);
  const hit = pos.reduce((s, c) => s + report[m].per[c].hit, 0);
  const hitT = pos.reduce((s, c) => s + report[m].per[c].hitT, 0);
  const mrr = pos.reduce((s, c) => s + report[m].per[c].mrr, 0);
  const neg = report[m].per.negative || { n: 1, hit: 0 };
  /* 配对负例（gold=[] 非 negative）单列：它们判断的是「拒答」，与召回不同口径 */
  const vacN = cats.filter((c) => c !== 'negative').reduce((s, c) => s + (report[m].per[c].vac || 0), 0);
  summ[m] = {
    n, recall: +(hit / n).toFixed(4), recallT: +(hitT / n).toFixed(4),
    mrr: +(mrr / n).toFixed(4), rejAcc: +(neg.hit / neg.n).toFixed(4), ms: report[m].ms, vacN,
  };
  console.log(m.padEnd(5) + ' 严格 Recall ' + pct(hit / n)
    + ' · 回合级 ' + pct(hitT / n)
    + ' · MRR ' + (mrr / n).toFixed(3)
    + ' · 负例拒答 ' + pct(neg.hit / neg.n)
    + ' · ' + report[m].ms + 'ms');
}
{
  /* 配对负例的拒答率单独打一行 —— 这是 cross 类 5 道题的真正指标 */
  const vd = detail.filter((d) => d.vac && d.mode === MODES[0]);
  if (vd.length) {
    const ok = vd.filter((d) => !d.noise).length;
    console.log('  配对负例（gold 空·跨会话）' + vd.length + ' 条 · 正确不答 ' + ok
      + ' (' + pct(ok / vd.length) + ')');
  }
}
console.log('  正例 ' + summ[MODES[0]].n + ' 条 / 负例 ' + (report[MODES[0]].per.negative || { n: 0 }).n + ' 条'
  + (summ[MODES[0]].vacN ? ' / 配对负例 ' + summ[MODES[0]].vacN + ' 条（不计入召回分母）' : ''));

if (!argv.quiet) {
  console.log('\n== 未召回 / 噪声 明细 ==');
  for (const d of detail) {
    if (d.vac) continue;   // 配对负例不算「未召回」，它考的是拒答
    if (d.cat === 'negative' ? !d.noise : d.recall) continue;
    console.log('  [' + d.mode + '] ' + d.id + ' ' + (d.cat === 'negative' ? '噪声' : '未召回')
      + ' q=' + JSON.stringify(d.q) + ' got=' + JSON.stringify(d.got));
  }
}

/* ---------- 落盘 ---------- */
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const snap = {};
for (const m of Object.keys(summ)) {
  const pos = cats.filter((c) => c !== 'negative');
  snap[m] = {
    recall: summ[m].recall, recallT: summ[m].recallT, mrr: summ[m].mrr, rejAcc: summ[m].rejAcc,
    perCat: Object.fromEntries(cats.map((c) => [c, {
      n: report[m].per[c].n, hit: report[m].per[c].hit,
      mrr: +(report[m].per[c].mrr / Math.max(1, report[m].per[c].n)).toFixed(4),
    }])),
  };
  void pos;
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const payload = { dataDir: DATA_DIR, at: stamp, set: setName, cases: list.length, summary: snap, detail };
fs.writeFileSync(path.join(outDir, 'v2-detail-' + stamp + '.json'), JSON.stringify(payload, null, 1), 'utf8');

/* --pair：只导出「每题命中与否」，这是 McNemar 检验的唯一输入。
 * ⚠️ 必须按 id 对齐，不能按顺序对齐 —— 两次跑的题集顺序可能不同。 */
if (argv.pair) {
  const pairs = {};
  for (const d of detail) {
    if (!pairs[d.mode]) pairs[d.mode] = {};
    pairs[d.mode][d.id] = d.cat === 'negative' ? (d.noise ? 0 : 1) : d.recall;
  }
  fs.writeFileSync(path.join(__dirname, 'pairs-' + setName + '-' + stamp + '.json'),
    JSON.stringify({ set: setName, at: stamp, pairs }, null, 1), 'utf8');
  console.log('\n逐题结果已存：eval/pairs-' + setName + '-' + stamp + '.json');
}
if (argv.save) {
  fs.writeFileSync(path.join(__dirname, 'baseline-' + argv.save + '.json'),
    JSON.stringify({ dataDir: DATA_DIR, at: stamp, set: setName, cases: list.length, summary: snap }, null, 1), 'utf8');
  console.log('\n基线已存：eval/baseline-' + argv.save + '.json');
}
if (argv.diff) {
  const p = path.join(__dirname, 'baseline-' + argv.diff + '.json');
  if (!fs.existsSync(p)) console.log('\n没有基线文件 ' + p);
  else {
    const old = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log('\n== 与基线 ' + argv.diff + '（' + old.at + ' · ' + (old.cases || '?') + ' 题）对比 ==');
    for (const m of Object.keys(snap)) {
      if (!old.summary[m]) { console.log('  ' + m + ' 基线里没有'); continue; }
      const d = (k) => {
        const v = snap[m][k] - old.summary[m][k];
        return (v > 0.00005 ? '↑' : v < -0.00005 ? '↓' : '=') + (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + 'pt';
      };
      console.log('  ' + m.padEnd(5) + ' Recall ' + d('recall') + ' · MRR ' + d('mrr') + ' · 拒答 ' + d('rejAcc'));
    }
  }
}
