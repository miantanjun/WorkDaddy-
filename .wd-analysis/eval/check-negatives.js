// 确认「负例」在本库里确实查不到（否则不是负例）
const path = require('path');
const DB = path.join(process.env.APPDATA, 'WorkDaddy', 'ck-memory', 'ck.db');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB, { readOnly: true });
const probes = [
  'Kubernetes 的 Pod 驱逐阈值',
  'PodDisruptionBudget',
  'Redis 集群 slots',
  '尾款 到账',
  'YKW-SU-260713',
  'v3.0.0',
  'Server Actions',
  'PostgreSQL 分区表',
  'EORI',
  'SHARDA',
  'OCTAGON',
  'Nafeza',
];
for (const p of probes) {
  const n = db.prepare('SELECT COUNT(*) c FROM seg WHERE text LIKE ? AND COALESCE(pri,0)>=1').get('%' + p + '%').c;
  const m = db.prepare('SELECT COUNT(*) c FROM seg WHERE text LIKE ?').get('%' + p + '%').c;
  console.log((n === 0 && m === 0 ? 'CLEAN ' : 'HIT   ') + p + '   pri>=1:' + n + '  all:' + m);
}
db.close();
