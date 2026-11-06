/* probe-dup-impact.js — 量化重复会话对索引的影响
 * 目的：验证「同一份会话被索引 3 遍」是否真的污染 DF / 稀释 IDF / 抢排名。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const DATA = path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });
const db = ck._internal.open();

const DUP = ['4bae518c-4b0d-4389-a3ad-682d565dd6d7', '2a616066-b61f-480b-93d1-5642d50a1620', '882c357a-6b2a-403b-b66e-43039e07c230'];

console.log('=== 三条重复会话在库里的规模 ===');
let tot = 0;
for (const sid of DUP) {
  const r = db.prepare('SELECT sid, proj, title, n_seg FROM sessions WHERE sid = ?').get(sid);
  if (!r) { console.log(sid.slice(0, 8), 'MISSING'); continue; }
  const s = db.prepare('SELECT COUNT(*) c, SUM(LENGTH(text)) tl FROM seg WHERE sid = ?').get(sid);
  tot += s.c;
  console.log(sid.slice(0, 8), '| n_seg', r.n_seg, '| 实存', s.c, '| 字符', s.tl, '| proj', r.proj.slice(0, 30));
}
const all = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
console.log('三条合计', tot, '/ 全库', all, '=', (tot / all * 100).toFixed(1) + '%');

console.log('\n=== 同一文本出现次数（跨这三条）===');
const probe = db.prepare('SELECT text, COUNT(DISTINCT sid) ns, COUNT(*) n FROM seg WHERE sid IN (?,?,?) GROUP BY text HAVING ns > 1 ORDER BY LENGTH(text) DESC LIMIT 3').all(...DUP);
probe.forEach((p) => console.log('  ns=' + p.ns, 'n=' + p.n, '|', p.text.replace(/\s+/g, ' ').slice(0, 70)));

console.log('\n=== 内容是否逐字相同（抽样 6 条对齐 seq）===');
const pick = db.prepare("SELECT seq, substr(text,1,60) t FROM seg WHERE sid = ? AND pri >= 1 ORDER BY seq LIMIT 6").all(DUP[0]);
for (const p of pick) {
  const row = [DUP[1], DUP[2]].map((s) => {
    const x = db.prepare('SELECT substr(text,1,60) t FROM seg WHERE sid = ? AND seq = ?').get(s, p.seq);
    return x ? (x.t === p.t ? 'SAME' : 'DIFF') : 'none';
  });
  console.log('  seq', String(p.seq).padStart(6), row.join('/'), '|', p.t.replace(/\s+/g, ' ').slice(0, 50));
}

console.log('\n=== DF 污染：高频词在全库 vs 去掉两条重复后 ===');
const words = ['ck-memory', 'rankRelevanceFirst', 'bm25', 'RANK_TIE', 'FTS5', 'last_hit_ts'];
for (const w of words) {
  /* 用 LIKE 统计含该词的行数（跨会话，粗口径但足够看量级） */
  const a = db.prepare('SELECT COUNT(*) c FROM seg WHERE text LIKE ?').get('%' + w + '%').c;
  const b = db.prepare('SELECT COUNT(*) c FROM seg WHERE text LIKE ? AND sid NOT IN (?,?)').get('%' + w + '%', DUP[1], DUP[2]).c;
  console.log(' ', w.padEnd(20), '全库', String(a).padStart(6), '→ 去重后', String(b).padStart(6), '| 虚增', (a - b));
}
