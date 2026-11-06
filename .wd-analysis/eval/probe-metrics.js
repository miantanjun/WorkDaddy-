/* 抽取可造「时效性题」的指标族
 *
 * 什么样的指标能做时效题：同一件事在会话里被反复记录，且数值随时间变化。
 * 这样就能造一对孪生题：
 *   问「现在/最新」 ⇒ 应命中最新值（检验新鲜度换位的**收益**）
 *   问「最早/当初」 ⇒ 应命中最早值（检验它的**代价**）
 * 只有成对出题，才能判断「拿 9.7pp 召回换新鲜度」到底值不值。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

const SIDS = {
  wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  cat: '96f77df6-452b-4c05-916f-92e30accd72b',
};
const tag = process.argv[2] || 'wd';
const sid = SIDS[tag];
const rows = db.prepare('SELECT seq, kind, ts, text FROM seg WHERE sid=? ORDER BY seq').all(sid);
const one = (s) => String(s).replace(/\s+/g, ' ');

const FAMILIES = [
  { name: '套件/断言', re: /(\d{2,3})\s*(?:个)?套件[^\d]{0,14}?(\d{3,5})\s*(?:项)?断言/g },
  { name: '本地版本号', re: /(?:v|版本\s*)(1\.\d+\.\d+)/g },
  { name: '上游版本号', re: /(?:上游|upstream)[^\d]{0,10}(1\.\d+\.\d+)/gi },
  { name: 'APK 大小', re: /(\d{2,3},\d{3},\d{3})\s*(?:字节|B)/g },
  { name: '文件数', re: /(\d{3,5})\s*(?:个)?文件/g },
];

for (const f of FAMILIES) {
  const buckets = new Map();  // 值 -> [seq]
  let hit = 0;
  for (const r of rows) {
    const t = one(r.text);
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(t))) {
      const v = m[1];
      hit++;
      if (!buckets.has(v)) buckets.set(v, []);
      const arr = buckets.get(v);
      if (arr[arr.length - 1] !== r.seq) arr.push(r.seq);
    }
  }
  const keys = [...buckets.keys()];
  console.log('\n== ' + f.name + ' == 命中' + hit + ' 次 / 不同值 ' + keys.length);
  if (keys.length > 40) { console.log('  （太分散，只列前 40 个）'); }
  let i = 0;
  for (const k of keys) {
    if (i++ >= 40) break;
    const arr = buckets.get(k);
    console.log('  ' + String(k).padStart(12) + '  x' + String(arr.length).padStart(3)
      + '  seq: ' + arr.slice(0, 6).join(',') + (arr.length > 6 ? ' …' : ''));
  }
}
