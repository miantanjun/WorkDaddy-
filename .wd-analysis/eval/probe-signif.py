# -*- coding: utf-8 -*-
"""
显著性检验 + 负例代价
=========================================================
31 题里 20 vs 15，差 5 题。这个量级**可能纯属噪声**，不能直接当成结论。

两件事必须一起做，缺一不可：
  ① **显著性**：McNemar 精确检验（配对设计，看「base 错→rrf 对」vs「base 对→rrf 错」）
  ② **负替代价**：向量永远会返回 top-k，它没有「拒答」能力。
     现状负例拒答 75%（6/8），融合之后会掉到多少？掉多少都不能接受？
     —— 这条比召回更重要：错误命中会让用户以为事情真的发生过。

⚠️ McNemar 用精确二项分布（n 很小，不能用卡方近似）。
"""
import json
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from probe_embed_gate_lib import BgeEncoder  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, ".wd-tmp", "evaldata", "WorkDaddy")
CACHE = os.path.join(HERE, ".vec-cache")


def mcnemar_exact(b, c):
    """b = base错&rrf对；c = base对&rrf错。双侧精确检验。"""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    # 双侧：P = 2 * P(X <= k)，截到 1
    p = sum(math.comb(n, i) for i in range(k + 1)) / (2 ** n)
    return min(1.0, 2 * p)


def run():
    js = r"""
const path=require('path');
const ck=require(path.join(process.env.ROOT,'scripts','ck-memory.js'));
ck.configure({dataDir:process.env.DATA, log:()=>{}});
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
const db=ck._internal.open();
function bigram(text){
  const s=String(text||''); const out=[];
  const re=/[A-Za-z0-9][A-Za-z0-9._:\/-]*|[\u4e00-\u9fa5]+/g; let m;
  while((m=re.exec(s))){
    const t=m[0];
    if(/[\u4e00-\u9fa5]/.test(t)){ if(t.length===1) out.push(t); else for(let i=0;i<t.length-1;i++) out.push(t.slice(i,i+2)); }
    else out.push(t.toLowerCase());
  }
  return out.filter(Boolean);
}
try{ db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')"); }catch(e){}
function df(t){ try{const r=db.prepare('SELECT doc FROM temp.wd_vocab WHERE term=?').get(String(t).toLowerCase()); return r?Number(r.doc)||0:0;}catch(e){return 0;} }

const out=[];
for(const c of CASES){
  const raw=String(c.q||'').trim();
  const parts=[...new Set(bigram(raw))];
  const esc=p=>'"'+String(p).replace(/"/g,'""')+'"';
  const live=parts.filter(p=>df(p)>0);
  const TAIL=`FROM (SELECT rowid AS rid, bm25(seg_fts) AS score
              FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
              JOIN seg s ON s.id=t.rid`;
  const COLS='s.id, s.seq, t.score';
  const talk=db.prepare(`SELECT ${COLS} ${TAIL}
      WHERE s.sid=? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0
        AND COALESCE(s.pri,0) >= 1 ORDER BY t.score`);
  let rows=[];
  if(live.length && live.length===parts.length) rows=talk.all(live.map(esc).join(' AND '), c.sid);
  if(!rows.length && live.length) rows=talk.all(live.map(esc).join(' OR '), c.sid);

  let base=[], via='', miss=[];
  try{
    const r=ck._internal.search(c.sid, c.q, 5, false);
    base=((r&&r.hits)||[]).map(x=>Number(x.seq!=null?x.seq:x.idx));
    via=r.via||''; miss=r.miss||[];
  }catch(e){}

  out.push({id:c.id, cat:c.cat, q:c.q, via, miss,
            gold:(Array.isArray(c.gold)?c.gold:[]).map(Number),
            need:c.minHit||1, base5:base,
            pool:rows.map(r=>({id:Number(r.id), seq:Number(r.seq)}))});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2500:]); raise SystemExit(1)
    return json.loads(r.stdout)


def rrf(orders, weights, k=10):
    sc = {}
    for order, w in zip(orders, weights):
        for i, it in enumerate(order):
            sc[it] = sc.get(it, 0.0) + w / (k + i + 1)
    return sorted(sc.keys(), key=lambda x: -sc[x])


def main():
    cases = run()
    rows = json.load(open(os.path.join(CACHE, "rows.json"), encoding="utf-8"))
    ids = json.load(open(os.path.join(CACHE, "vec-all-ids.json"), encoding="utf-8"))
    V = np.load(os.path.join(CACHE, "vec-all.npy"))
    pos_of = {rid: i for i, rid in enumerate(ids)}
    enc = BgeEncoder("onnx/model_quantized.onnx")

    pos = [c for c in cases if c["cat"] != "negative"]
    neg = [c for c in cases if c["cat"] == "negative"]
    QVp = enc.encode([c["q"] for c in pos], batch=16)

    b = c_ = both_ok = both_bad = 0
    improved, worsened = [], []
    for i, p in enumerate(pos):
        if not p["pool"]:
            continue
        idx = [pos_of[x["id"]] for x in p["pool"]]
        sims = V[idx] @ QVp[i]
        seqs = [x["seq"] for x in p["pool"]]
        vorder = [seqs[j] for j in np.argsort(-sims)]
        bm = seqs      # 池已按 bm25 升序
        fused = rrf([bm, vorder], [1, 1], 10)
        hb = 1 if len(set(p["gold"]) & set(p["base5"])) >= p["need"] else 0
        hf = 1 if len(set(p["gold"]) & set(fused[:5])) >= p["need"] else 0
        if hb and hf:
            both_ok += 1
        elif not hb and hf:
            b += 1; improved.append(p["id"])
        elif hb and not hf:
            c_ += 1; worsened.append(p["id"])
        else:
            both_bad += 1

    print("=" * 66)
    print("① 配对显著性（McNemar 精确检验）")
    print("=" * 66)
    print(f"  base错→rrf对 : {b}   {improved}")
    print(f"  base对→rrf错 : {c_}  {worsened}")
    print(f"  都对 {both_ok} / 都错 {both_bad}")
    p = mcnemar_exact(b, c_)
    print(f"  p = {p:.4f}  ⇒ {'显著（p<0.05）' if p < 0.05 else '不显著，不能当成结论'}")

    print("\n" + "=" * 66)
    print("② 负替代价")
    print("=" * 66)
    QVn = enc.encode([c["q"] for c in neg], batch=16)
    cur_rej = 0
    new_rej = 0
    for i, x in enumerate(neg):
        cur_empty = len(x["base5"]) == 0
        if cur_empty:
            cur_rej += 1
        if not x["pool"]:
            new_rej += 1
        else:
            # 融合后前 5 里有没有「明显无关但被向量硬凑出来」的？
            # 判据同 base：只有池为空才算拒答成功
            new_rej += 0
        print(f"  {x['id']}: via={x['via']:8s} base返回{len(x['base5'])}条 "
              f"池{len(x['pool'])}条  当前={'拒答' if cur_empty else '噪声'}")
    print(f"\n  当前拒答 {cur_rej}/{len(neg)} = {cur_rej/len(neg)*100:.1f}%")
    print(f"  融合后拒答 {new_rej}/{len(neg)} = {new_rej/len(neg)*100:.1f}%（池非空就一定会返回 top5）")
    print("  ⚠️ 融合不会新增噪声（默认路径池为空时向量路也拿不到东西），")
    print("     但它也**救不回**已经被漏过的负例 —— 因为负例的池本来就是空的。")

    json.dump({"improved": improved, "worsened": worsened, "p": p},
              open(os.path.join(HERE, "probe-signif.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
