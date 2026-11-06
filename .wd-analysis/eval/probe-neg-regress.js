/* 诊断十八：回填会话会不会**削弱「库外话题」拦截**？
 *
 * 上面跑出 seg 负例拒答 75%(3会话) → 37.5%(79会话)，掉了一半。
 * 这个必须查清：如果为真，那「回填全部会话」这个动作本身就带副作用 ——
 * 库越大，越难判定「这个话题库里根本没有」，因为总有某个词碰巧命中。
 *
 * 逐条核对 8 条纯负例在两个库上的表现，并分离出机制：
 *   · FTS 的 IDF 是全库统计 ⇒ 库变大 ⇒ 常见词 DF 上升 ⇒ 锚点词更容易「不够稀有」
 *   · latinMiss / idMiss 两道拦截器的判据依赖 DF 阈值
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const ALL = require('./all-cases.js').ALL;
const NEG = ALL.filter((c) => c.cat === 'negative');

const DIRS = {
  '3会话(evaldata)': path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'),
  '79会话(scaledata)': path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy'),
};

/* ⚠️ 同一个进程里切换 dataDir 会重读配置，但 open() 有缓存。
   为绝对干净，每种库单跑一次子进程 —— 这里用 execFileSync 自调。 */
const { execFileSync } = require('child_process');

if (process.argv[2] === '--child') {
  const dir = process.argv[3];
  ck.configure({ dataDir: dir, log: () => {} });
  const out = [];
  for (const c of NEG) {
    const r = ck._internal.search(c.sid, c.q, 8);
    out.push({
      id: c.id, q: c.q, n: (r.hits || []).length, via: r.via,
      cand: r.candidates || 0,
      top: (r.hits && r.hits[0]) ? String(r.hits[0].text || '').replace(/\s+/g, ' ').slice(0, 70) : '',
      miss: (r.hits || []).length === 0,
    });
  }
  console.log('@@JSON@@' + JSON.stringify(out));
  process.exit(0);
}

const res = {};
for (const [name, dir] of Object.entries(DIRS)) {
  const raw = execFileSync(process.execPath, [__filename, '--child', dir], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const line = raw.split('\n').find((l) => l.indexOf('@@JSON@@') === 0);
  res[name] = JSON.parse(line.slice(8));
}

console.log('=== 8 条纯负例：两个库上的拒答情况 ===');
console.log('  编号  查询                                     3会话      79会话');
let a = 0, b = 0;
for (let i = 0; i < NEG.length; i++) {
  const x = res['3会话(evaldata)'][i];
  const y = res['79会话(scaledata)'][i];
  if (x.miss) a++;
  if (y.miss) b++;
  const mark = (m) => (m ? '拒答✅' : '返回' + (m === false ? '' : ''));
  console.log('  ' + x.id.padEnd(5) + ' ' + x.q.slice(0, 38).padEnd(40)
    + String(x.n).padStart(2) + '条 ' + (x.miss ? '✅' : '❌').padEnd(4)
    + String(y.n).padStart(2) + '条 ' + (y.miss ? '✅' : '❌').padEnd(4)
    + (x.miss !== y.miss ? '  ← 变化' : ''));
}
console.log('\n  拒答率：3会话 ' + a + '/8 (' + (100 * a / 8).toFixed(1) + '%) ⇒ 79会话 ' + b + '/8 (' + (100 * b / 8).toFixed(1) + '%)');

console.log('\n=== 反例细节：79 会话库返回了什么 ===');
for (let i = 0; i < NEG.length; i++) {
  const y = res['79会话(scaledata)'][i];
  if (!y.miss) console.log('  ' + y.id + ' via=' + y.via + ' cand=' + y.cand + '\n     top: ' + y.top);
}

console.log('\n=== 机制：两道拦截器为何在 79 会话下失效 ===');
ck.configure({ dataDir: DIRS['79会话(scaledata)'], log: () => {} });
const db2 = ck._internal.open();
console.log('  LATIN_ANCHOR_DF_MAX =', ck._internal.LATIN_ANCHOR_DF_MAX);
for (const c of NEG) {
  const terms = ck._internal.latinTerms(c.q);
  if (!terms.length) { console.log('  ' + c.id.padEnd(5) + ' 无 latin 锚点'); continue; }
  const miss = ck._internal.latinMiss(db2, c.sid, terms);
  console.log('  ' + c.id.padEnd(5) + ' latinTerms=' + JSON.stringify(terms).slice(0, 60) + ' ⇒ latinMiss=' + JSON.stringify(miss).slice(0, 80));
}
