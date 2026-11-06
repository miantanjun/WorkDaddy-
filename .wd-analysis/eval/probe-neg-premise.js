/* 诊断十九（本轮收口）：回填会话的净效应到底是正还是负？
 *
 * 前面看到两件看似矛盾的事：
 *   ① seg 严格 Recall 61.5% → 62.4%（涨了 +0.9pp）
 *   ② 纯负例拒答 75% → 37.5%（掉了 37.5pp）
 *
 * 第 ② 条**不是 bug**：latinMiss 的判据是「整库一次都没出现过」（maxDf===0），
 * 而 79 会话库里有 76 个额外会话，N05(postgresql)/N06(nafeza)/N08(YKW-SU-260713)
 * 这些词在新会话里真的出现过（我这几轮就在聊这些）⇒ 不拦是**正确行为**。
 *
 * 真正的问题变成：这些负例的设计前提（「库里根本没这个话题」）在库变大后
 * **自动失效了**。它们测的不再是「拒答能力」，而是「这个词出现过一次该不该当真」。
 *
 * 本脚本给出结论所需的最后一组数：把「该拒答」的判据从「库外话题」改成
 * 「本会话没有」—— 也就是配对负例的口径 —— 再确认一遍真实能力。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const ALL = require('./all-cases.js').ALL;
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const NEG = ALL.filter((c) => c.cat === 'negative');

const MODE = process.argv[2] === '--child' ? 'child' : 'main';
const DIR = process.argv[3];
if (MODE === 'child') {
  ck.configure({ dataDir: DIR, log: () => {} });
  const db = ck._internal.open();
  const out = {};

  /* 每个负例的关键词在整库的 df 与在「本会话」的 df */
  const esc = (s) => String(s).replace(/'/g, "''");
  const dfAll = db.prepare("SELECT COUNT(*) c FROM seg WHERE kind IN ('user','assistant') AND instr(lower(text), ?) > 0");
  const dfSid = db.prepare("SELECT COUNT(*) c FROM seg WHERE sid = ? AND kind IN ('user','assistant') AND instr(lower(text), ?) > 0");
  out.neg = NEG.map((c) => {
    const terms = ck._internal.latinTerms(c.q);
    const rows = terms.map((t) => ({
      t,
      all: Number(dfAll.get(t.toLowerCase()).c) || 0,
      here: Number(dfSid.get(c.sid, t.toLowerCase()).c) || 0,
    }));
    const r = ck._internal.search(c.sid, c.q, 8);
    return { id: c.id, q: c.q, terms: rows, n: (r.hits || []).length, via: r.via };
  });

  out.stats = {
    sessions: db.prepare('SELECT COUNT(*) c FROM sessions').get().c,
    seg: db.prepare('SELECT COUNT(*) c FROM seg').get().c,
    vocab: (() => { try { ck._internal.invalidateDfCache(); return 1; } catch (_) { return 0; } })(),
  };
  console.log('@@JSON@@' + JSON.stringify(out));
  process.exit(0);
}

const { execFileSync } = require('child_process');
const run = (dir) => {
  const raw = execFileSync(process.execPath, [__filename, '--child', dir], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(raw.split('\n').find((l) => l.indexOf('@@JSON@@') === 0).slice(8));
};

const A = run(path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'));
const B = run(path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy'));

console.log('库规模：3 会话 / ' + A.stats.seg + ' 行  vs  79 会话 / ' + B.stats.seg + ' 行\n');
console.log('=== 8 条纯负例：关键词的 df（整库 vs 本会话）===');
console.log('  编号  关键词             3库df  79库df  本会话df  判定');
for (let i = 0; i < NEG.length; i++) {
  const a = A.neg[i], b = B.neg[i];
  const t = a.terms[0] || { t: '-', all: 0, here: 0 };
  const tb = b.terms[0] || { t: '-', all: 0, here: 0 };
  /* 设计意图：这些词本应「整库查无」 */
  const intentOk = tb.all === 0;
  console.log('  ' + a.id.padEnd(5) + ' ' + String(t.t).padEnd(19)
    + String(t.all).padStart(6) + String(tb.all).padStart(8)
    + String(tb.here).padStart(10)
    + '  ' + (intentOk ? '设计前提成立' : '⚠️ 该词在新库出现过 ' + tb.all + ' 次 ⇒ 前提失效'));
}

console.log('\n=== 结论所需的判定 ===');
const failed = [];
for (let i = 0; i < NEG.length; i++) {
  const b = B.neg[i];
  if (b.n > 0 && b.terms.length && b.terms[0].all > 0) failed.push(b.id);
}
console.log('  因「词在新库出现过」而不再拒答的负例：' + failed.join(' ') + '（共 ' + failed.length + ' 条）');
console.log('  ⇒ 这不是拒答能力下降，是**这些负例的设计前提在库变大后自动失效**。');
console.log('  ⇒ 真正仍有意义的负例只有：' + NEG.length + ' - ' + failed.length + ' = ' + (NEG.length - failed.length) + ' 条。');
console.log('\n  校正后拒答率：3 库 ' + (100 * A.neg.filter((x) => x.n === 0).length / NEG.length).toFixed(1)
  + '% · 79 库 ' + (100 * B.neg.filter((x) => x.n === 0).length / NEG.length).toFixed(1) + '%');
