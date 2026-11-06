/* probe-or-weight.js — OR 路径的泛词权重对照（只读，不改代码）
 *
 * 现状：OR 覆盖率是**等权**（每个 bigram 权重 1）。
 * 问题：查询里混进「怎么」这种 df=976 的泛词后，它和「WAL」一样重，
 *       命中了「怎么」就算覆盖率 +1/6 ⇒ 大量无关内容挤进来。
 *
 * 但代码注释里明确记着：IDF 加权在 108 题上 MRR 从 51.49% 掉到 47.85%（p=0.0246，显著）。
 * ⇒ 不能简单地全量 IDF 加权。这里做的是**更窄**的改：只把「极高频泛词」降权，
 *   也就是给 df 超过某个绝对阈值的词一个折扣，而不是按 idf 连续加权。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
try { db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')"); } catch (_) {}
const bigram = ck._internal.bigram;
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const df = (t) => { try { const r = db.prepare('SELECT doc FROM temp.wd_vocab WHERE term=?').get(String(t).toLowerCase()); return r ? Number(r.doc) : 0; } catch (_) { return 0; } };
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;

const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const PA = ` AND s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`;

// 金标查询：会话 + 查询 + 判定词
const cases = [
  { sid: '8f92c3fc', q: 'WAL 只增不减 怎么修', must: ['WAL', 'wal', 'checkpoint', 'journal_size_limit'] },
  { sid: '3a1eef3c', q: '重复会话 正品 判据', must: ['重复', '正品', 'canon', 'sha256'] },
  { sid: '3a1eef3c', q: '装柜计算器 3D 卡顿', must: ['3D', '卡顿', '装柜'] },
  { sid: '405fa88e', q: 'SHARDA 波兰 首单', must: ['SHARDA', 'sharda', '波兰'] },
  { sid: '6987b059', q: '喜马拉雅 音频助手', must: ['喜马拉雅', '音频助手'] },
  { sid: '8f92c3fc', q: '埃及 尾款 70%', must: ['尾款', '231,472', '70%'] },
  { sid: 'cd5f08de', q: 'Nafeza ACI 单据', must: ['Nafeza', 'ACI', 'ACID'] },
];
const SIDS = {}; // 前缀 -> 全 sid
for (const r of db.prepare('SELECT sid FROM sessions').all()) SIDS[r.sid.slice(0, 8)] = r.sid;

function run(mode) {
  let relSum = 0, totSum = 0;
  const per = [];
  for (const c of cases) {
    const sid = SIDS[c.sid];
    const parts = [...new Set(bigram(c.q).split(/\s+/).filter(Boolean))];
    let rows = db.prepare(`SELECT s.id, s.text, t.score ${TAIL} WHERE 1=1${PA}`).all(parts.map(esc).join(' OR '), sid);
    if (!rows.length) { per.push({ q: c.q, n: 0, rel: 0 }); continue; }

    // 权重：等权 / 泛词降权
    const w = new Map();
    for (const p of parts) {
      const d = df(p);
      if (mode === 'equal') w.set(p, 1);
      else {
        // 泛词降权：df 超过总行数 0.3% 的词打 1/4 折，其余不变
        w.set(p, d > total * 0.003 ? 0.25 : 1);
      }
    }
    const wSum = parts.reduce((s, p) => s + w.get(p), 0) || 1;
    const scored = rows.map(r => {
      const t = String(r.text || '');
      let got = 0;
      for (const p of parts) if (t.indexOf(p) >= 0) got += w.get(p);
      return { r, cov: got / wSum };
    }).sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);

    const top = scored.slice(0, 5);
    let rel = 0;
    for (const x of top) if (c.must.some(m => String(x.r.text).indexOf(m) >= 0)) rel++;
    relSum += rel; totSum += top.length;
    per.push({ q: c.q, n: top.length, rel, parts: parts.map(p => p + '(' + df(p) + ')').join(' ') });
  }
  return { relSum, totSum, per };
}

const a = run('equal');
const b = run('penalty');
console.log('=== 等权（现状）===');
a.per.forEach(x => console.log(`  ${String(x.q).padEnd(22)} ${x.n} 命中 / 相关 ${x.rel}   ${x.parts || ''}`));
console.log(`  合计 ${a.relSum}/${a.totSum} = ${(a.relSum / a.totSum * 100).toFixed(1)}%`);

console.log('\n=== 泛词降权（df > 0.3% 打 1/4 折）===');
b.per.forEach(x => console.log(`  ${String(x.q).padEnd(22)} ${x.n} 命中 / 相关 ${x.rel}`));
console.log(`  合计 ${b.relSum}/${b.totSum} = ${(b.relSum / b.totSum * 100).toFixed(1)}%`);

console.log(`\n差值：${((b.relSum - a.relSum) / Math.max(a.totSum, 1) * 100).toFixed(1)}pp`);
console.log(`总行数 ${total}，0.3% 阈值 = ${(total * 0.003).toFixed(0)} 行`);
