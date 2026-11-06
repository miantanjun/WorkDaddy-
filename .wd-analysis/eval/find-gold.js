// 辅助：按关键词在指定会话里定位金标准行（输出 id + seq + 摘要），用于人工出题时抄 seq
const path = require('path');
const DB = path.join(process.env.APPDATA, 'WorkDaddy', 'ck-memory', 'ck.db');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB, { readOnly: true });

const specs = [
  ['8f92c3fc', '证书 过期 9 月 11'],
  ['3a1eef3c', '证书 过期'],
  ['8f92c3fc', '先烧快过期的'],
  ['8f92c3fc', 'prefer_expiring'],
  ['8f92c3fc', '未命名会话'],
  ['8f92c3fc', '乱码'],
  ['96f77df6', '247 个产品位'],
  ['96f77df6', '6928 个文件'],
  ['96f77df6', '31.9%'],
  ['3a1eef3c', '15,372,572'],
  ['3a1eef3c', 'v1.4.0'],
  ['8f92c3fc', '42 套件'],
  ['8f92c3fc', '2999'],
  ['8f92c3fc', '1.2.7'],
  ['8f92c3fc', 'BLUF'],
  ['96f77df6', '45-B'],
  ['96f77df6', '408'],
  ['3a1eef3c', '9891'],
  ['3a1eef3c', '飞鸽'],
  ['8f92c3fc', '429'],
];
for (const [sid, kw] of specs) {
  const rows = db.prepare(
    `SELECT id, seq, pri, substr(replace(text,char(10),' '),1,120) t FROM seg
      WHERE sid LIKE ? AND COALESCE(pri,0)>=1 AND text LIKE ?
      ORDER BY seq LIMIT 4`
  ).all(sid + '%', '%' + kw + '%');
  console.log('## ' + sid.slice(0, 8) + '  「' + kw + '」  ' + rows.length);
  for (const r of rows) console.log('   id=' + r.id + ' seq=' + r.seq + ' p' + r.pri + ' | ' + r.t);
}
db.close();
