# -*- coding: utf-8 -*-
"""
拆解产品排序的每一层：到底哪一层在伤召回
=========================================================
产品 OR 路径的排序是三段式：

  ① 覆盖率排序：`order = sort(cov desc, bm25 asc)`   —— 定名次
  ② rankRelevanceFirst(order, rankMode=true)          —— 「并列组内」让新鲜度/重要度换位
  ③ 多样性过滤                                        —— 同 h / 邻近 seq 去重

而我上一轮量出：
    裸 bm25 前5          48.4%
    覆盖率排序前5        48.4%   ← 巧了，一样
    产品实际前5          41.9%   ← 少了 2 题

⇒ 差距出在 **② 或 ③**，不是 ①。

这值得单独拆开，因为：
  · 若是 ②（新鲜度换位）在伤召回，那是**阶段 3 的成果带来的副作用**，
    属于「修 A 弄坏 B」，而且改起来零成本；
  · 若是 ③（多样性过滤）在伤，那是设计取舍，要重新评估。

本脚本把每一段单独跑一遍，包含与不包含。
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
    """把候选池**连同排序所需的全部字段**一起取出来，在 py 侧复刻每一层。"""
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
const L=ck._internal;

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
  const COLS='s.id, s.seq, s.ts, s.text, s.h, COALESCE(s.dup,1) dup, COALESCE(s.pri,0) pri,'
           + ' COALESCE(s.last_hit_ts,0) last_hit_ts, t.score';
  const talk=db.prepare(`SELECT ${COLS} ${TAIL}
      WHERE s.sid=? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0
        AND COALESCE(s.pri,0) >= 1 ORDER BY t.score`);
  let rows=[];
  if(live.length && live.length===parts.length) rows=talk.all(live.map(esc).join(' AND '), c.sid);
  if(!rows.length && live.length) rows=talk.all(live.map(esc).join(' OR '), c.sid);

  const w=new Map(live.map(p=>[p, idf(df(p))]));
  const wSum=live.reduce((s,p)=>s+w.get(p),0)||1;
  const arr=rows.map(r=>{
    const t=String(r.text||''); let got=0;
    for(const p of live) if(t.indexOf(p)>=0) got+=w.get(p);
    return {seq:Number(r.seq), h:r.h, score:Number(r.score), cov:got/wSum,
            ts:Number(r.ts), pri:Number(r.pri), dup:Number(r.dup)||1,
            last_hit_ts:Number(r.last_hit_ts)};
  });

  // 产品最终输出（作为真值对照，验证我的复刻是否准确）
  let prod5=[];
  try{ const r=ck._internal.search(c.sid, c.q, 5, false);
       prod5=((r&&r.hits)||[]).map(x=>Number(x.seq!=null?x.seq:x.idx)); }catch(e){}

  out.push({id:c.id, cat:c.cat, q:c.q,
            gold:(Array.isArray(c.gold)?c.gold:[]).map(Number), need:c.minHit||1,
            prod5, arr});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2500:]); raise SystemExit(1)
    return json.loads(r.stdout)


def dedupe(items, lim=5):
    picked, seenH = [], set()
    for it in items:
        if len(picked) >= lim:
            break
        if it["h"] and it["h"] in seenH:
            continue
        if any(abs(it["seq"] - p["seq"]) <= 2 for p in picked):
            continue
        picked.append(it)
        if it["h"]:
            seenH.add(it["h"])
    return picked


def hit(got, gold, need, k=5):
    return 1 if len(set(gold) & set(x["seq"] if isinstance(x, dict) else x for x in got[:k])) >= need else 0


def main():
    cases = build()
    rows = json.load(open(os.path.join(CACHE, "rows.json"), encoding="utf-8"))
    ids = json.load(open(os.path.join(CACHE, "vec-all-ids.json"), encoding="utf-8"))
    V = np.load(os.path.join(CACHE, "vec-all.npy"))
    pos_of = {rid: i for i, rid in enumerate(ids)}
    enc = BgeEncoder("onnx/model_quantized.onnx")
    QV = enc.encode([c["q"] for c in cases], batch=16)

    M = {k: [] for k in [
        "① 裸bm25 序",
        "①+② 覆盖率定名次(不换位)",
        "①+② 覆盖率+新鲜度换位(=产品)",
        "①+②+③ 再多样性过滤",
        "产品真实输出(真值校验)",
        "RRF(覆盖率序,向量)+③",
    ]}

    for i, p in enumerate(cases):
        arr, gold, need = p["arr"], p["gold"], p["need"]
        if not arr:
            for m in M:
                M[m].append(0)
            continue
        bm = sorted(arr, key=lambda x: x["score"])
        cov = sorted(arr, key=lambda x: (-x["cov"], x["score"]))

        # ② 用产品自己的 rankRelevanceFirst 无法在 py 侧调用，这里用等价近似：
        #    覆盖率定名次后**不换位**就是 cov；产品会做并列组内换位 ——
        #    换位效果无法精确复刻，所以用产品真实输出当那一行的真值。
        seqs_cov = [x["seq"] for x in cov]

        M["① 裸bm25 序"].append(hit(bm, gold, need))
        M["①+② 覆盖率定名次(不换位)"].append(hit(cov, gold, need))
        M["①+② 覆盖率+新鲜度换位(=产品)"].append(hit(p["prod5"], gold, need))
        M["①+②+③ 再多样性过滤"].append(hit(dedupe(cov), gold, need))
        M["产品真实输出(真值校验)"].append(hit(p["prod5"], gold, need))

        # RRF：覆盖率序 + 向量序，再走多样性过滤
        sc = {}
        for r, x in enumerate(cov):
            sc[x["seq"]] = sc.get(x["seq"], 0) + 1 / (10 + r + 1)
        # 向量序
        pool = p["arr"]
        idx = [pos_of.get(x["seq"]) for x in pool]
        sims = np.array([(V[j] @ QV[i]) if j is not None else -1 for j in idx])
        vo = [pool[j]["seq"] for j in np.argsort(-sims)]
        for r, s in enumerate(vo):
            sc[s] = sc.get(s, 0) + 1 / (10 + r + 1)
        fused = sorted(sc.keys(), key=lambda x: -sc[x])
        byseq = {x["seq"]: x for x in pool}
        M["RRF(覆盖率序,向量)+③"].append(hit(dedupe([byseq[s] for s in fused]), gold, need))

    n = len(cases)
    print(f"正例 {n} 题 · 逐层拆解\n" + "=" * 66)
    for m, v in M.items():
        print(f"  {m:34s} {sum(v)/n*100:5.1f}%  ({sum(v):2d}/{n})")
    print("=" * 66)

    res = {m: round(sum(v) / n, 4) for m, v in M.items()}
    res["n"] = n
    json.dump(res, open(os.path.join(HERE, "probe-orderlayers.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
