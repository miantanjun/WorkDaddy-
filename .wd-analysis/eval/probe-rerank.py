# -*- coding: utf-8 -*-
"""
决定性实验：向量做「重排」而不是「新一路召回」
=========================================================
上一轮的诊断改变了问题：
  · 候选池覆盖 29/31 = **93.5%**，召回几乎不是瓶颈；
  · 但只有 19 题进前 5，**10 题的 gold 明明在池里却排到 6~112 名**。
  ⇒ 真正的瓶颈是**排序**，不是召回。

所以「向量作为第四个 RRF 召回源」这个设计前提就是偏的 —— 池里本来就有，
多一路召回只是把同样的东西再捞一遍。正确用法是：**在已有候选池内用向量重排**。

本实验只做一件事，且可逆可量化：
  在 search() 的候选池上，把现有的「IDF 加权覆盖率 / bm25」名次与「向量余弦」名次
  做 RRF 融合，比较 Recall@5。

对比三档：
  base  —— 现状（产品当前排序）
  vec   —— 纯向量重排
  fuse  —— 名次级 RRF 融合（w 可调）
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
  let rows=[];
  if(live.length && live.length===parts.length) rows=talk.all(live.map(esc).join(' AND '), c.sid);
  if(!rows.length && live.length) rows=talk.all(live.map(esc).join(' OR '), c.sid);
  // 产品当前的前5（作为 base 对照）
  let base5=[];
  try{
    const r=ck._internal.search(c.sid, c.q, 5, false);
    base5=((r&&r.hits)||[]).map(x=>Number(x.seq!=null?x.seq:x.idx));
  }catch(e){}
  out.push({id:c.id, cat:c.cat, q:c.q, gold:(Array.isArray(c.gold)?c.gold:[c.gold]).map(Number),
            need:c.minHit||1, base5,
            pool:rows.map(r=>({id:Number(r.id), seq:Number(r.seq)}))});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2000:]); raise SystemExit(1)
    return json.loads(r.stdout)


def main():
    pools = build_pools()
    rows = json.load(open(os.path.join(CACHE, "rows.json"), encoding="utf-8"))
    ids = json.load(open(os.path.join(CACHE, "vec-all-ids.json"), encoding="utf-8"))
    V = np.load(os.path.join(CACHE, "vec-all.npy"))
    pos_of = {rid: i for i, rid in enumerate(ids)}

    enc = BgeEncoder("onnx/model_quantized.onnx")
    QV = enc.encode([p["q"] for p in pools], batch=16)

    def rrf(rank_a, rank_b, wa, wb, k=60):
        """名次级 RRF：只吃名次，不吃量纲。"""
        sc = {}
        for r, (item,) in enumerate([(x,) for x in rank_a]):
            sc[item] = sc.get(item, 0) + wa / (k + r + 1)
        for r, (item,) in enumerate([(x,) for x in rank_b]):
            sc[item] = sc.get(item, 0) + wb / (k + r + 1)
        return sorted(sc.keys(), key=lambda x: -sc[x])

    def eval_top(items, gold, need, k=5):
        return 1 if len(set(gold) & set(items[:k])) >= need else 0

    modes = {
        "base(产品现状)": [],
        "纯向量": [],
        "RRF 1:1": [],
        "RRF 名次3:向量1": [],
        "RRF 名次1:向量1(k=10)": [],
    }
    detail = []

    for i, p in enumerate(pools):
        pool = p["pool"]
        gold = p["gold"]
        need = p["need"]
        if not pool:
            for m in modes:
                modes[m].append(0)
            continue
        idx = [pos_of[x["id"]] for x in pool]
        sims = V[idx] @ QV[i]
        seqs = [x["seq"] for x in pool]

        # 纯向量重排
        vorder = [seqs[j] for j in np.argsort(-sims)]
        # 原有名次（池已经是按 bm25 / 覆盖率排序的近似，产品最终还会重排，
        # 这里用产品真实输出做 base，用池顺序做融合基准）
        lexorder = seqs

        r_11 = rrf(lexorder, vorder, 1, 1)
        r_31 = rrf(lexorder, vorder, 3, 1)
        r_11k = rrf(lexorder, vorder, 1, 1, k=10)

        modes["base(产品现状)"].append(eval_top(p["base5"], gold, need))
        modes["纯向量"].append(eval_top(vorder, gold, need))
        modes["RRF 1:1"].append(eval_top(r_11, gold, need))
        modes["RRF 名次3:向量1"].append(eval_top(r_31, gold, need))
        modes["RRF 名次1:向量1(k=10)"].append(eval_top(r_11k, gold, need))
        detail.append({"id": p["id"], "cat": p["cat"], "gold": gold,
                       "base5": p["base5"], "vec5": vorder[:5], "r11_5": r_11[:5],
                       "poolN": len(pool)})

    n = len(pools)
    print(f"正例 {n} 题 · Recall@5 对比\n" + "=" * 62)
    base = None
    for m, v in modes.items():
        r = sum(v) / n
        if base is None:
            base = r
        d = (r - base) * 100
        print(f"  {m:22s} {r*100:5.1f}%   ({sum(v):2d}/{n})  {d:+5.1f}pp" if base is not None else "")

    print("\n逐题（只列有变化的）：")
    for i, d in enumerate(detail):
        b = modes["base(产品现状)"][i]
        r = modes["RRF 名次1:向量1(k=10)"][i]
        if b != r:
            print(f"  {d['id']:5s} {d['cat']:9s} base={'✓' if b else '·'} → rrf={'✓' if r else '·'}  "
                  f"gold={d['gold']} poolN={d['poolN']}")

    out = {m: round(sum(v) / n, 4) for m, v in modes.items()}
    out["n"] = n
    out["detail"] = detail
    json.dump(out, open(os.path.join(HERE, "probe-rerank.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("\n已存 probe-rerank.json")


if __name__ == "__main__":
    main()
