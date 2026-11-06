# -*- coding: utf-8 -*-
"""
对照实验：把「向量的功劳」和「换了排序口径的功劳」拆开
=========================================================
上一轮结果：RRF(名次, 向量) 从 41.9% → 64.5%（+22.6pp）。
**但这里有一个必须排除的混淆变量**：

    RRF 的分量是「候选池顺序」和「向量顺序」。
    候选池顺序 = **裸 bm25 顺序**，而产品现状用的是「IDF 加权覆盖率」排序。
    所以涨幅可能来自「裸 bm25 比覆盖率排序好」，跟向量一点关系都没有。

判断方法：把三者单独都测一遍。
    · 裸 bm25 单独       —— 若 ≈64%，则是排序口径的功劳，向量无用
    · 覆盖率单独(=产品)   —— 基线 41.9%
    · 向量单独
    · RRF(裸bm25, 向量)  —— 只有显著高于「裸 bm25 单独」才证明向量有独立贡献
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


def build_pools():
    """候选池**带 bm25 分数**，且同时记录覆盖率排序（产品口径）与 bm25 排序。"""
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
const total=db.prepare('SELECT COUNT(*) c FROM seg').get().c;
function idf(d){ return Math.log(1 + (total - d + 0.5)/(d + 0.5)); }

const out=[];
for(const c of CASES){
  if(c.cat==='negative') continue;
  const raw=String(c.q||'').trim();
  const parts=[...new Set(bigram(raw))];
  const esc=p=>'"'+String(p).replace(/"/g,'""')+'"';
  const live=parts.filter(p=>df(p)>0);
  const TAIL=`FROM (SELECT rowid AS rid, bm25(seg_fts) AS score
              FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
              JOIN seg s ON s.id=t.rid`;
  const COLS='s.id, s.seq, s.text, COALESCE(s.pri,0) pri, t.score';
  const talk=db.prepare(`SELECT ${COLS} ${TAIL}
      WHERE s.sid=? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0
        AND COALESCE(s.pri,0) >= 1 ORDER BY t.score`);
  let rows=[], via='';
  if(live.length && live.length===parts.length){ rows=talk.all(live.map(esc).join(' AND '), c.sid); via='AND'; }
  if(!rows.length && live.length){ rows=talk.all(live.map(esc).join(' OR '), c.sid); via='OR'; }

  // 覆盖率（产品 OR 路径的主排序键）：命中 bigram 的 IDF 之和 / 全部之和
  const w=new Map(live.map(p=>[p, idf(df(p))]));
  const wSum=live.reduce((s,p)=>s+w.get(p),0)||1;
  const withCov=rows.map(r=>{
    const t=String(r.text||''); let got=0;
    for(const p of live) if(t.indexOf(p)>=0) got+=w.get(p);
    return { id:Number(r.id), seq:Number(r.seq), score:Number(r.score), cov:got/wSum };
  });

  let base5=[];
  try{
    const r=ck._internal.search(c.sid, c.q, 5, false);
    base5=((r&&r.hits)||[]).map(x=>Number(x.seq!=null?x.seq:x.idx));
  }catch(e){}

  out.push({id:c.id, cat:c.cat, q:c.q, via,
            gold:(Array.isArray(c.gold)?c.gold:[c.gold]).map(Number),
            need:c.minHit||1, base5,
            // 按覆盖率降序、同覆盖按 bm25 升序（= 产品口径）
            covOrder:withCov.slice().sort((a,b)=> b.cov-a.cov || a.score-b.score).map(x=>x.seq),
            // 裸 bm25 升序（越小越相关）
            bm25Order:withCov.slice().sort((a,b)=> a.score-b.score).map(x=>x.seq),
            pool:withCov.map(x=>({id:x.id, seq:x.seq}))});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2500:]); raise SystemExit(1)
    return json.loads(r.stdout)


def rrf(orders, weights, k=60):
    sc = {}
    for order, w in zip(orders, weights):
        for i, it in enumerate(order):
            sc[it] = sc.get(it, 0.0) + w / (k + i + 1)
    return sorted(sc.keys(), key=lambda x: -sc[x])


def top(order, gold, need, k=5):
    return 1 if len(set(gold) & set(order[:k])) >= need else 0


def main():
    pools = build_pools()
    rows = json.load(open(os.path.join(CACHE, "rows.json"), encoding="utf-8"))
    ids = json.load(open(os.path.join(CACHE, "vec-all-ids.json"), encoding="utf-8"))
    V = np.load(os.path.join(CACHE, "vec-all.npy"))
    pos_of = {rid: i for i, rid in enumerate(ids)}
    enc = BgeEncoder("onnx/model_quantized.onnx")
    QV = enc.encode([p["q"] for p in pools], batch=16)

    modes = {k: [] for k in [
        "产品现状(ck.search)", "覆盖率排序", "裸bm25排序", "向量排序",
        "RRF(覆盖率,向量) k=60", "RRF(裸bm25,向量) k=60", "RRF(裸bm25,向量) k=10",
    ]}
    per = []

    for i, p in enumerate(pools):
        gold, need = p["gold"], p["need"]
        if not p["pool"]:
            for m in modes:
                modes[m].append(0)
            continue
        idx = [pos_of[x["id"]] for x in p["pool"]]
        sims = V[idx] @ QV[i]
        seqs = [x["seq"] for x in p["pool"]]
        vorder = [seqs[j] for j in np.argsort(-sims)]

        modes["产品现状(ck.search)"].append(top(p["base5"], gold, need))
        modes["覆盖率排序"].append(top(p["covOrder"], gold, need))
        modes["裸bm25排序"].append(top(p["bm25Order"], gold, need))
        modes["向量排序"].append(top(vorder, gold, need))
        modes["RRF(覆盖率,向量) k=60"].append(top(rrf([p["covOrder"], vorder], [1, 1], 60), gold, need))
        modes["RRF(裸bm25,向量) k=60"].append(top(rrf([p["bm25Order"], vorder], [1, 1], 60), gold, need))
        modes["RRF(裸bm25,向量) k=10"].append(top(rrf([p["bm25Order"], vorder], [1, 1], 10), gold, need))
        per.append({"id": p["id"], "cat": p["cat"], "gold": gold,
                    "cov5": p["covOrder"][:5], "bm5": p["bm25Order"][:5],
                    "vec5": vorder[:5], "base5": p["base5"], "via": p["via"]})

    n = len(pools)
    print(f"正例 {n} 题 · Recall@5 对照\n" + "=" * 68)
    base = sum(modes["产品现状(ck.search)"]) / n
    for m, v in modes.items():
        r = sum(v) / n
        print(f"  {m:26s} {r*100:5.1f}%  ({sum(v):2d}/{n})  {(r-base)*100:+5.1f}pp")
    print("=" * 68)
    b = sum(modes["裸bm25排序"]) / n
    f = sum(modes["RRF(裸bm25,向量) k=10"]) / n
    print(f"\n★ 关键判断：向量在「裸bm25」之上还有多少独立贡献？")
    print(f"    裸bm25 单独       {b*100:.1f}%")
    print(f"    + 向量 (RRF k=10) {f*100:.1f}%")
    print(f"    ⇒ 向量独立贡献    {(f-b)*100:+.1f}pp")
    if f - b < 0.03:
        print("    ⛔ 增益很小 ⇒ 上一轮的涨幅主要是**排序口径**的功劳，不是向量")
    else:
        print("    ✅ 有独立贡献")

    res = {"n": n}
    for m, v in modes.items():
        res[m] = round(sum(v) / n, 4)
    res["per"] = per
    json.dump(res, open(os.path.join(HERE, "probe-rerank-control.json"),
                        "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\n已存 probe-rerank-control.json")


if __name__ == "__main__":
    main()
