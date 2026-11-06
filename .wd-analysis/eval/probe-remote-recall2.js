/* probe-remote-recall2.js — 换说法问旧事（只读）
 *
 * 第一个测试用原话当查询，AND 必然命中，是「自证」而非「验证」。
 * 这里换成：人为改写的口语问句（不同于原文用词），看能不能布朗到几十天前的记录。
 * 判定方式：命中条目里是否出现该会话「前半段」（时间上更早一半）的内容。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const fd = (ms) => { const d = new Date(Number(ms)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 选几个跨时长的会话，用「改写问句」去查它早期说过的事
const probes = [
  { sid: 'cd5f08de', q: '清关的时候商业发票和装箱单到底要不要加那些内容', note: '原话是「印尼的商业发票和装箱单，最终不会用于清关」' },
  { sid: 'e567d9db', q: '工厂的收款信息在哪，定金该付多少', note: '原话「国内工厂这边收款信息和我要付多少定金」' },
  { sid: '405fa88e', q: '搞不清楚的地方要标红留给我', note: '原话「没有的或者你搞不清楚的你就不动并且标红」' },
  { sid: '639ebe4c', q: '界面上找不到开始处理和保存按钮', note: '原话「软件界面中并没有开始处理和保存这两个按钮」' },
  { sid: 'aee0f9ca', q: '给我留一个能让AI接管操作软件的接口', note: '原话「写一个可以让你（ai）接管软件的接口」' },
  { sid: '39229fed', q: '在每个按钮上加说明解释它是干什么的', note: '原话「加个功能，解释每个按钮的作用」' },
  { sid: 'f101d16f', q: '文件共享软件叫什么名字，窗口要像资源管理器', note: '原话「软件叫共享助手…最好就跟win本身的文件夹一样」' },
  { sid: '314f7500', q: 'HS编码帮我核对，还要算退税', note: '原话「两个HS号你帮我核实一下对不对。利润测算那里需要算13%的退税」' },
];

for (const p of probes) {
  const s = db.prepare('SELECT first_ts,last_ts FROM sessions WHERE sid LIKE ?').get(p.sid + '%');
  if (!s) { console.log(p.sid, '会话不存在'); continue; }
  const mid = (Number(s.first_ts) + Number(s.last_ts)) / 2;
  const r = ck._internal.search(p.sid + '-', p.q, 8, false);
  const hits = r.hits || [];
  // seg 里有 ts，判定命中属于前半段还是后半段
  console.log(`\n会话 ${p.sid}  ${fd(s.first_ts)}→${fd(s.last_ts)}（中位 ${fd(mid)}）`);
  console.log(`  问「${p.q}」`);
  console.log(`  ${p.note}`);
  console.log(`  → ${hits.length} 命中  via=${r.via}`);
  let early = 0, late = 0;
  hits.slice(0, 5).forEach((h, i) => {
    const t = Number(h.ts) || 0;
    const isEarly = t < mid;
    if (isEarly) early++; else late++;
    console.log(`    ${i + 1}. ${isEarly ? '【前段】' : '【后段】'} ${fd(t)}  ${String(h.text || '').replace(/\s+/g, ' ').slice(0, 56)}`);
  });
  console.log(`  前段命中 ${early} / 后段命中 ${late}`);
}
