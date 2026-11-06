// 探针：验证「一次没搜到 → 换更短关键词再试一次」到底有没有用
// 必须先用数据回答「哪些查询第一次会失败、第二次能救回来」，再决定实现。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const I = ck._internal;
const I2 = ck;

const db = I.open();

function findSession(term) {
  const r = db.prepare(`SELECT sid, COUNT(*) c FROM seg WHERE text LIKE ? GROUP BY sid ORDER BY c DESC`).all('%' + term + '%');
  return r.length ? r[0].sid : '';
}

// bigram 分词（与 search 内部一致）
function parts(q) {
  return [...new Set(String(I.bigram(q) || '').split(/\s+/).filter(Boolean))];
}

// 词在库里的 df（借 _internal 里没有 termDf，用 instr 近似 + FTS 都行，这里用 LIKE 计数）
function df(term) {
  try {
    return Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(text, ?) > 0').get(term).c) || 0;
  } catch (_) { return 0; }
}

/**
 * 候选的重试查询生成策略。
 * 目标：**去掉最没用的部分**，而不是无脑截短。
 */
function makeRetries(q) {
  const ps = parts(q);
  const out = [];

  // 策略 A：按 df 从低到高排序，取最具辨识度的 1 个 / 2 个 bigram
  //   ⚠️ df=0 说明库里没这个词，留着只会让 AND 必然 0 条 ⇒ 优先剔除
  const scored = ps.map((p) => ({ p, d: df(p) })).sort((a, b) => a.d - b.d);
  const alive = scored.filter((x) => x.d > 0);
  if (alive.length >= 1) out.push({ why: '最稀有 1 词', q: alive[0].p });
  if (alive.length >= 2) out.push({ why: '最稀有 2 词', q: alive[0].p + ' ' + alive[1].p });

  // 策略 B：只保留原始查询的「主体词」——去掉疑问/虚词 bigram
  const STOP = new Set(['怎么', '如何', '什么', '为什', '么修', '可以', '是否', '有没', '没有', '这个', '那个', '现在', '然后', '还是', '不是', '一个', '我们', '你们', '他们']);
  const kept = ps.filter((p) => !STOP.has(p) && df(p) > 0);
  if (kept.length && kept.length < ps.length) out.push({ why: '去疑问词', q: kept.join(' ') });

  // 策略 C：截前一半（兜底，最朴素）
  if (ps.length >= 3) out.push({ why: '前一半', q: ps.slice(0, Math.ceil(ps.length / 2)).join(' ') });

  // 去重 + 去掉与原查询相同的
  const seen = new Set([String(q).trim()]);
  return out.filter((x) => {
    const k = x.q.trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const cases = [
  // 真实业务提问（这些是用户真会问的）
  { q: 'WAL 只增不减 怎么修',           anchor: 'WAL' },
  { q: '尾款催收怎么处理',               anchor: '尾款' },
  { q: 'Nafeza 单据怎么提交',            anchor: 'Nafeza' },
  { q: 'SHARDA 波兰 报价',               anchor: 'SHARDA' },
  { q: 'ZeroTier 网段 配置',             anchor: 'ZeroTier' },
  { q: 'REL_TIE 阈值 是多少',            anchor: 'REL_TIE' },
  { q: '共享助手 重命名 bug',            anchor: '共享助手' },
  { q: '本地模型 端口 探活',             anchor: '端口' },
  { q: '索引翻倍了 怎么修',              anchor: '索引' },
  { q: '发票 CAIRO-11371 金额',          anchor: 'CAIRO-11371' },
  // 故意问不到的（应当始终失败，不能靠重试伪造命中）
  { q: '量子纠缠 退相干 时间',           anchor: '', expectFail: true },
  { q: '法式甜点 马卡龙 配方',           anchor: '', expectFail: true },
];

let firstOk = 0, rescued = 0, stillFail = 0, falsePositive = 0;
const rows = [];

for (const c of cases) {
  const sid = c.anchor ? findSession(c.anchor) : (db.prepare('SELECT sid FROM sessions LIMIT 1').get() || {}).sid;
  if (!sid) { console.log('跳过（无会话）：', c.q); continue; }

  const r1 = I.search(sid, c.q, 8) || {};
  const n1 = (r1.hits || []).length;
  const via1 = r1.via;
  let used = '', n2 = 0, via2 = '';

  if (!c.expectFail) {
    if (n1 > 0) { firstOk++; }
    else {
      // 第一次 0 条 ⇒ 按顺序试重试策略，**命中第一个就停**（绝不循环）
      for (const rt of makeRetries(c.q)) {
        const r2 = I.search(sid, rt.q, 8) || {};
        if ((r2.hits || []).length > 0) { used = rt.why + '「' + rt.q + '」'; n2 = r2.hits.length; via2 = r2.via; break; }
      }
      if (used) rescued++; else stillFail++;
    }
  } else {
    // 负例：重试也不该产出有意义的命中
    let any = n1 > 0;
    for (const rt of makeRetries(c.q)) {
      const r2 = I.search(sid, rt.q, 8) || {};
      if ((r2.hits || []).length > 0) { any = true; used = rt.why + '「' + rt.q + '」'; break; }
    }
    if (any && n1 === 0) falsePositive++;
  }

  rows.push({ q: c.q, n1, via1, used, n2, via2, expectFail: !!c.expectFail });
  console.log(
    (c.expectFail ? '[负例] ' : n1 ? '[首查中] ' : used ? '[救回] ' : '[仍空] ').padEnd(9),
    c.q.padEnd(26),
    '首查', String(n1).padStart(2), (via1 || '').padEnd(9),
    used ? ('→ ' + used + ' 得 ' + n2 + ' 条 ' + via2) : ''
  );
}

console.log('\n===== 汇总 =====');
console.log('正例首查就中 :', firstOk);
console.log('重试救回     :', rescued);
console.log('重试仍空     :', stillFail);
console.log('负例被误救   :', falsePositive, '（应为 0：问不到的就是问不到，不能靠缩短关键词伪造命中）');
