// 验证面板大字摘要的新算法：用真实 stats 跑一遍纯计算部分
// 目的不是测 DOM，是测「73 - 29 = 44 该怎么拆」这段算术在几种边界下是否合理。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

function computeNote(st) {
  const _onDisk = Number(st.onDisk) || 0;
  const _idx = Number(st.sessions) || 0;
  const _rest = Math.max(0, _onDisk - _idx);
  const _pend = Math.min(_rest, Number(st.pending) || 0);
  const _small = Math.max(0, _rest - _pend);
  if (_rest <= 0) return '(不显示)';
  const note = [];
  if (_pend > 0) note.push(_pend + ' 条正在后台补');
  if (_small > 0) note.push(_small + ' 条内容太少，没收录');
  return '另有 ' + note.join('、');
}

(async () => {
  // 真实状态
  ck._internal.open();
  const st = ck.status ? ck.status() : null;
  console.log('===== 真实 stats =====');
  const keys = ['sessions', 'onDisk', 'pending', 'followed', 'validMem', 'userTalk', 'factLive', 'segments', 'procMem'];
  for (const k of keys) console.log(('  ' + k).padEnd(14), st ? st[k] : '(status 不可用)');
  if (st) {
    console.log('\n大字摘要  : 已记住 ' + st.sessions + ' 个会话 · ' + (st.validMem || 0) + ' 条有效记忆'
      + (st.userTalk ? '（其中你说的话 ' + st.userTalk + ' 条）' : '')
      + (st.factLive ? ' · 提炼出 ' + st.factLive + ' 条事实' : ''));
    console.log('下一行小字: ' + computeNote(st));
  }

  console.log('\n===== 边界用例 =====');
  const cases = [
    { name: '本机实测',        st: { onDisk: 73, sessions: 29, pending: 0,  followed: 4 } },
    { name: '全部已索引',      st: { onDisk: 73, sessions: 73, pending: 0,  followed: 4 } },
    { name: '刚回填中(pending 6)', st: { onDisk: 73, sessions: 29, pending: 6,  followed: 4 } },
    { name: '全部都在补',      st: { onDisk: 73, sessions: 0,  pending: 44, followed: 4 } },
    { name: 'pending 异常大于差额', st: { onDisk: 73, sessions: 29, pending: 999, followed: 4 } },
    { name: '磁盘少一条(异常)', st: { onDisk: 20, sessions: 29, pending: 0,  followed: 4 } },
    { name: '空库',            st: { onDisk: 0,  sessions: 0,  pending: 0,  followed: 0 } },
    { name: '只有刚开的短会话', st: { onDisk: 3,  sessions: 0,  pending: 0,  followed: 0 } },
  ];
  for (const c of cases) {
    console.log(('  ' + c.name).padEnd(24), '→', computeNote(c.st));
  }
})();
