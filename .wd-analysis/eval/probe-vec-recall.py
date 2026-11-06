# -*- coding: utf-8 -*-
"""
阶段 7 主实验：向量路能提升检索召回吗
=========================================================
这是决定「向量路值不值得做」的唯一判据。

口径必须与 run-eval.js 完全一致（否则测的不是同一个东西）：
  · 同一批 39 条用例、同一份 gold（seq）
  · 只在**该用例自己的 sid** 内检索（产品就是这样，绝不跨会话）
  · Recall@k 严格口径 = gold 有没有进前 k
  · 只算 single/multi/temporal/open 四类（negative 单独看噪声）

对比对象：
  seg 基线 41.9%（严格）—— 这是阶段 1 的成果，向量必须超过它才有意义。

⚠️ 产物缓存成 .npy，第二次跑不重复编码（51k 条编码约 100 秒）。
"""
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from probe_embed_gate_lib import BgeEncoder  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, ".wd-tmp", "evaldata", "WorkDaddy")
CACHE = os.path.join(HERE, ".vec-cache")
os.makedirs(CACHE, exist_ok=True)


def dump_rows():
    """用 node 把 seg 行导成 json（避免 python 读 sqlite 的兼容问题）。"""
    dst = os.path.join(CACHE, "rows.json")
    if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(
            os.path.join(DATA, "ck-memory", "ck.db")):
        with open(dst, encoding="utf-8") as f:
            return json.load(f)
    js = r"""
const path=require('path');
const ck=require(path.join(process.env.ROOT,'scripts','ck-memory.js'));
ck.configure({dataDir:process.env.DATA, log:()=>{}});
const db=ck._internal.open();
const rows=db.prepare('SELECT id,sid,seq,text,kind,COALESCE(pri,0) pri FROM seg').all();
process.stdout.write(JSON.stringify(rows.map(r=>({id:Number(r.id),sid:String(r.sid),
  seq:Number(r.seq),text:String(r.text||''),pri:Number(r.pri)||0}))));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print("导出失败:", r.stderr[-800:])
        sys.exit(1)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(r.stdout)
    return json.loads(r.stdout)


def load_cases():
    """用 node 直接 require cases.js，避免手工解析。"""
    js = r"""
const path=require('path');
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
process.stdout.write(JSON.stringify(CASES));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT})
    if r.returncode != 0:
        print("读用例失败:", r.stderr[-800:])
        sys.exit(1)
    return json.loads(r.stdout)


def main():
    model_file = sys.argv[1] if len(sys.argv) > 1 else "onnx/model.onnx"
    tag = os.path.basename(model_file).replace(".onnx", "")
    t0 = time.time()
    rows = dump_rows()
    cases = load_cases()
    print(f"seg {len(rows)} 条 / 用例 {len(cases)} 条  (导出 {time.time()-t0:.1f}s)")

    enc = BgeEncoder(model_file)
    print(f"模型 {tag} 加载完成")

    vec_file = os.path.join(CACHE, f"seg-{tag}.npy")
    id_file = os.path.join(CACHE, f"seg-{tag}-ids.npy")
    if os.path.exists(vec_file) and os.path.exists(id_file):
        V = np.load(vec_file)
        idx = np.load(id_file).tolist()
        print(f"复用缓存 {V.shape}")
    else:
        t1 = time.time()
        texts = [r["text"] for r in rows]
        V = enc.encode(texts, batch=32)
        idx = [r["id"] for r in rows]
        np.save(vec_file, V)
        np.save(id_file, np.array(idx, dtype=np.int64))
        print(f"编码完成 {V.shape}  用时 {time.time()-t1:.1f}s"
              f"（{(time.time()-t1)/len(texts)*1000:.2f}ms/条）")

    # 按 sid 建索引范围
    by_sid = {}
    for i, r in enumerate(rows):
        by_sid.setdefault(r["sid"], []).append(i)

    # 用例问题编码
    qs = [c["q"] for c in cases]
    QV = enc.encode(qs, batch=32)

    results = []
    cats = {}
    for ci, c in enumerate(cases):
        sid = c["sid"]
        if sid not in by_sid:
            results.append({"id": c["id"], "cat": c["cat"], "hit": 0, "rr": 0.0, "note": "sid 不在库"})
            continue
        pool = by_sid[sid]          # 只在本会话内检索
        PV = V[pool]
        sims = PV @ QV[ci]
        k = int(c.get("k") or 5)
        top = np.argsort(-sims)[:k]
        got = [rows[pool[t]]["seq"] for t in top]
        gold = c["gold"] if isinstance(c["gold"], list) else [c["gold"]]
        need = int(c.get("minHit") or 1)
        hitn = len(set(gold) & set(got))
        hit = 1 if hitn >= need else 0
        rr = 0.0
        for rank, s in enumerate(got):
            if s in gold:
                rr = 1.0 / (rank + 1)
                break
        results.append({"id": c["id"], "cat": c["cat"], "hit": hit, "rr": rr,
                        "got": got, "gold": gold, "q": c["q"]})
        if c["cat"] != "negative":
            d = cats.setdefault(c["cat"], [0, 0, 0.0])
            d[0] += hit
            d[1] += 1
            d[2] += rr

    pos = [r for r in results if r.get("cat") != "negative"]
    neg = [r for r in results if r.get("cat") == "negative"]
    rec = sum(r["hit"] for r in pos) / max(len(pos), 1)
    mrr = sum(r["rr"] for r in pos) / max(len(pos), 1)

    print("\n" + "=" * 62)
    print(f"向量路（{tag}） standalone")
    print("=" * 62)
    for cat in ["single", "multi", "temporal", "open"]:
        if cat in cats:
            h, n, rr = cats[cat]
            print(f"  {cat:10s} {n:3d} 题   {h/n*100:5.1f}% / MRR {rr/n:.3f}")
    print(f"  {'合计':10s} {len(pos):3d} 题   {rec*100:5.1f}% / MRR {mrr:.3f}   （seg 基线 41.9% / 0.500）")
    if neg:
        # 负例：向量路会返回 top-k 吗？返回了就说明它没有「拒答」能力
        print(f"  负例 {len(neg)} 题：向量路**永远返回 k 条**（无拒答能力），"
              f"噪声率 100% —— 必须靠 kNN 距离阈值或标识符兜底")

    print("\n未召回明细：")
    for r in pos:
        if not r["hit"]:
            print(f"  [{r['cat']}] {r['id']}: {r['q'][:40]}  got={r.get('got')} gold={r.get('gold')}")

    out = {"model": tag, "pos": len(pos), "recall": round(rec, 4), "mrr": round(mrr, 4),
           "byCat": {k: {"n": v[1], "recall": round(v[0] / v[1], 4), "mrr": round(v[2] / v[1], 4)}
                     for k, v in cats.items()},
           "detail": [{k: r[k] for k in ("id", "cat", "hit", "rr") if k in r} for r in results]}
    dst = os.path.join(HERE, f"probe-vec-recall-{tag}.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n明细已存:", os.path.basename(dst))


if __name__ == "__main__":
    main()
