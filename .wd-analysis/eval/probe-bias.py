# -*- coding: utf-8 -*-
"""
方法论自查：两处必须排除的偏差
=========================================================
搞科研式的自查 —— 上面那个 +22.6pp 里，至少有两处可能不是向量的功劳：

① **多样性过滤**
   产品 `search()` 在排序后有一步「去重」：
     · 同 `h` 指纹只留一条
     · 序列号相差 ≤2 的只留一条（同一次连续输出被切成多段）
   我上轮的 rrf 结果**没有**这一步。如果这个过滤本身在吃召回，
   那 base 42% 是「被自己的过滤器压低了」，不是向量赢了。

② **负例拦截的位置**
   6/8 的负例是靠 `ENT-MISS` / `ID-MISS` 在**建候选池之前**就返回空的。
   我的探针绕过了拦截器直接建池，所以得出「融合后拒答 0%」——
   这是**假的**：产品里根本走不到建池那一步。
   结论应该是：向量重排只要放在拦截器**之后**，负例拒答率不受影响。

本脚本把这两件事分别量清楚。
"""
import json
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


def build():
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
  const COLS='s.id, s.seq, s.text, s.h, t.score';
  const talk=db.prepare(`SELECT ${COLS} ${TAIL}
      WHERE s.sid=? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0
        AND COALESCE(s.pri,0) >= 1 ORDER BY t.score`);
  let rows=[],via='none';
  if(live.length && live.length===parts.length){ rows=talk.all(live.map(esc).join(' AND '), c.sid); via='AND'; }
  if(!rows.length && live.length){ rows=talk.all(live.map(esc).join(' OR '), c.sid); via='OR'; }

  // 深度检索（40 条，带多样性过滤后的真实产品输出）
  let deep40=[];
  try{ const r=ck._internal.search(c.sid, c.q, 40, false);
       deep40=((r&&r.hits)||[]).map(x=>Number(x.seq!=null?x.seq:x.idx)); }catch(e){}

  out.push({id:c.id, cat:c.cat, q:c.q, via,
            gold:(Array.isArray(c.gold)?c.gold:[]).map(Number), need:c.minHit||1,
            base5:deep40.slice(0,5), base40:deep40,
            pool:rows.map(r=>({id:Number(r.id), seq:Number(r.seq), h:r.h}))});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2500:]); raise SystemExit(1)
    return json.loads(r.stdout)


def dedupe(seqs_h, lim=5):
    """复刻产品 search() 的去重：同 h 只留一条，seq 相差 ≤2 只留一条。"""
    picked, seenH = [], set()
    for seq, h in seqs_h:
        if len(picked) >= lim:
            break
        if h and h in seenH:
            continue
        if any(abs(seq - p) <= 2 for p in picked):
            continue
        picked.append(seq)
        if h:
            seenH.add(h)
    return picked


def rrf(orders, weights, k=10):
    sc = {}
    for order, w in zip(orders, weights):
        for i, it in enumerate(order):
            sc[it] = sc.get(it, 0.0) + w / (k + i + 1)
    return sorted(sc.keys(), key=lambda x: -sc[x])


def hit(got, gold, need, k=5):
    return 1 if len(set(gold) & set(got[:k])) >= need else 0


def main():
    cases = build()
    rows = json.load(open(os.path.join(CACHE, "rows.json"), encoding="utf-8"))
    ids = json.load(open(os.path.join(CACHE, "vec-all-ids.json"), encoding="utf-8"))
    V = np.load(os.path.join(CACHE, "vec-all.npy"))
    pos_of = {rid: i for i, rid in enumerate(ids)}
    enc = BgeEncoder("onnx/model_quantized.onnx")

    pos = [c for c in cases if c["cat"] != "negative"]
    QV = enc.encode([c["q"] for c in pos], batch=16)

    M = {k: [] for k in [
        "产品现状 top5", "产品 deep40 前5（含多样过滤）", "裸bm25 前5（无过滤）",
        "RRF 前5（无过滤）", "RRF + 多样性过滤",
    ]}
    hmap = {}
    for i, p in enumerate(pos):
        if not p["pool"]:
            for m in M:
                M[m].append(0)
            continue
        for x in p["pool"]:
            hmap[x["seq"]] = x["h"]
        idx = [pos_of[x["id"]] for x in p["pool"]]
        sims = V[idx] @ QV[i]
        seqs = [x["seq"] for x in p["pool"]]
        vorder = [seqs[j] for j in np.argsort(-sims)]
        fused = rrf([seqs, vorder], [1, 1], 10)

        M["产品现状 top5"].append(hit(p["base5"], p["gold"], p["need"]))
        M["产品 deep40 前5（含多样过滤）"].append(hit(p["base40"][:5], p["gold"], p["need"]))
        M["裸bm25 前5（无过滤）"].append(hit(seqs, p["gold"], p["need"]))
        M["RRF 前5（无过滤）"].append(hit(fused, p["gold"], p["need"]))
        fd = dedupe([(s, hmap.get(s)) for s in fused], 5)
        M["RRF + 多样性过滤"].append(hit(fd, p["gold"], p["need"]))

    n = len(pos)
    print(f"正例 {n} 题\n" + "=" * 60)
    for m, v in M.items():
        print(f"  {m:30s} {sum(v)/n*100:5.1f}%  ({sum(v):2d}/{n})")
    print("=" * 60)
    a = sum(M["裸bm25 前5（无过滤）"]) / n
    b = sum(M["RRF + 多样性过滤"]) / n
    print(f"\n★ 同口径对比（都加多样性过滤）：裸bm25 {a*100:.1f}% vs RRF+过滤 {b*100:.1f}%")
    print(f"  ⇒ 向量独立贡献 {(b-a)*100:+.1f}pp")
    d1 = sum(M["RRF 前5（无过滤）"]) - sum(M["RRF + 多样性过滤"])
    print(f"  多样性过滤吃掉 {d1} 题（{d1/n*100:.1f}pp）—— 这是**免费**可查的一项")

    res = {m: round(sum(v) / n, 4) for m, v in M.items()}
    res["n"] = n
    json.dump(res, open(os.path.join(HERE, "probe-bias.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
