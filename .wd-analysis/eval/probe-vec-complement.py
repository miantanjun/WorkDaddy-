# -*- coding: utf-8 -*-
"""
互补性分析：向量路与词法路的命中是否重叠
=========================================================
向量单独 22.2% 不如词法，但这**不能**直接否掉它。
RRF 融合的收益来自「不同路命中不同答案」：
  · 若两路命中高度重叠 ⇒ 加一路只是重复计票，白搭算力；
  · 若几乎不重叠 ⇒ 融合的并集覆盖率提升，值得加。

所以真正要看的是**并集覆盖率**，不是单路准确率。

⚠️ 两处踩过的坑（都已修）：
  ① `ck.search()` 返回的是 `{hits, via, ...}`，不是 `{items}` —— 写成 items 会
     `undefined.map` 直接崩，而且崩在 **20 分钟向量编码之后**，白等。
  ② 向量编码必须存盘：全量 51k 条约 20 分钟，不缓存则每次重跑都得重来。
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
os.makedirs(CACHE, exist_ok=True)


def lex_hits():
    """用产品自己的 seg 检索路拿结果（口径与 run-eval 完全一致）。"""
    js = r"""
const path=require('path');
const ck=require(path.join(process.env.ROOT,'scripts','ck-memory.js'));
ck.configure({dataDir:process.env.DATA, log:()=>{}});
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
const out=[];
for(const c of CASES){
  let got=[];
  try{
    const r=ck._internal.search(c.sid, c.q, c.k||5, true);
    const hs=(r && r.hits) || [];
    got=hs.map(x=>Number(x.seq!=null?x.seq:x.idx));
  }catch(e){ got=[]; }
  out.push({id:c.id, cat:c.cat, gold:c.gold, need:c.minHit||1, got});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print("词法路失败:", r.stderr[-1200:])
        sys.exit(1)
    return json.loads(r.stdout)


def vec_scores():
    """返回 {caseId: [按相似度降序的 seq 列表]}；向量算一次就缓存。"""
    vec_file = os.path.join(CACHE, "vec-all.npy")
    ids_file = os.path.join(CACHE, "vec-all-ids.json")
    with open(os.path.join(CACHE, "rows.json"), encoding="utf-8") as f:
        rows = json.load(f)

    if os.path.exists(vec_file) and os.path.exists(ids_file):
        V = np.load(vec_file)
        order = json.load(open(ids_file, encoding="utf-8"))
        print(f"复用向量缓存 {V.shape}")
    else:
        enc = BgeEncoder("onnx/model_quantized.onnx")
        V = enc.encode([x["text"] for x in rows], batch=32)
        order = [x["id"] for x in rows]
        np.save(vec_file, V)
        json.dump(order, open(ids_file, "w", encoding="utf-8"))
        print(f"向量已编码并缓存 {V.shape}")

    js = r"""
const path=require('path');
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
process.stdout.write(JSON.stringify(CASES));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT})
    cases = json.loads(r.stdout)

    enc = BgeEncoder("onnx/model_quantized.onnx")
    QV = enc.encode([c["q"] for c in cases], batch=16)

    by_sid = {}
    for i, x in enumerate(rows):
        by_sid.setdefault(x["sid"], []).append(i)

    out = {}
    for ci, c in enumerate(cases):
        pool = by_sid.get(c["sid"])
        if not pool:
            out[c["id"]] = []
            continue
        sims = V[pool] @ QV[ci]
        k = int(c.get("k") or 5)
        top = np.argsort(-sims)[:k]
        out[c["id"]] = [rows[pool[t]]["seq"] for t in top]
    return out


def main():
    lex = {x["id"]: x for x in lex_hits()}
    vtop = vec_scores()

    js = r"""
const path=require('path');
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
process.stdout.write(JSON.stringify(CASES));
"""
    cases = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True,
                                      encoding="utf-8",
                                      env={**os.environ, "ROOT": ROOT}).stdout)

    print("\n" + "=" * 90)
    print(f"{'id':6s} {'cat':9s} {'lex':4s} {'vec':4s} {'并集':5s}  gold / got")
    print("=" * 90)
    both = onlylex = onlyvec = neither = 0
    pos = []
    for c in cases:
        if c["cat"] == "negative":
            continue
        gold = c["gold"] if isinstance(c["gold"], list) else [c["gold"]]
        need = int(c.get("minHit") or 1)
        lg = lex.get(c["id"], {}).get("got", [])
        vg = vtop.get(c["id"], [])
        hl = len(set(gold) & set(lg)) >= need
        hv = len(set(gold) & set(vg)) >= need
        hu = len(set(gold) & (set(lg) | set(vg))) >= need
        if hl and hv:
            both += 1
        elif hl:
            onlylex += 1
        elif hv:
            onlyvec += 1
        else:
            neither += 1
        pos.append(c["id"])
        print(f"{c['id']:6s} {c['cat']:9s} {'✓' if hl else '·':4s} {'✓' if hv else '·':4s} "
              f"{'✓' if hu else '·':5s}  gold={gold} lex={lg} vec={vg}")

    n = len(pos)
    print("=" * 90)
    print(f"正例 {n} 题")
    print(f"  只有词法命中 : {onlylex:2d}  ({onlylex/n*100:.1f}%)")
    print(f"  只有向量命中 : {onlyvec:2d}  ({onlyvec/n*100:.1f}%)   ← 向量路的**净增益**")
    print(f"  两路都命中   : {both:2d}")
    print(f"  都没命中     : {neither:2d}")
    print(f"  词法单独     : {(onlylex+both)/n*100:.1f}%")
    print(f"  向量单独     : {(onlyvec+both)/n*100:.1f}%")
    print(f"  并集（上界） : {(onlylex+both+onlyvec)/n*100:.1f}%")

    out = {"n": n, "onlylex": onlylex, "onlyvec": onlyvec, "both": both,
           "neither": neither, "lexOnly": round((onlylex + both) / n, 4),
           "vecOnly": round((onlyvec + both) / n, 4),
           "union": round((onlylex + both + onlyvec) / n, 4)}
    with open(os.path.join(HERE, "probe-vec-complement.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n已存 probe-vec-complement.json")


if __name__ == "__main__":
    main()
