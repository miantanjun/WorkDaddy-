# -*- coding: utf-8 -*-
"""
快测：只在最小会话（96f77df6 / 5187 条、10 题）上对比向量 vs 词法基线。
用最少算力先拿信号，再决定要不要花 20 分钟跑全量。
"""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from probe_embed_gate_lib import BgeEncoder  # noqa: E402

SID = "96f77df6-452b-4c05-916f-92e30accd72b"


def main():
    with open(os.path.join(HERE, ".vec-cache", "rows.json"), encoding="utf-8") as f:
        allrows = json.load(f)
    rows = [r for r in allrows if r["sid"].startswith("96f77df6")]
    print(f"本会话 {len(rows)} 条")

    js = r"""
const path=require('path');
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
process.stdout.write(JSON.stringify(CASES.filter(c=>String(c.sid).startsWith('96f77df6'))));
"""
    import subprocess
    ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT})
    cases = json.loads(r.stdout)
    print(f"用例 {len(cases)} 条")

    enc = BgeEncoder(sys.argv[1] if len(sys.argv) > 1 else "onnx/model_quantized.onnx")
    t = time.time()
    V = enc.encode([x["text"] for x in rows], batch=32)
    print(f"编码 {time.time()-t:.1f}s  dim={V.shape[1]}")
    QV = enc.encode([c["q"] for c in cases], batch=16)

    print("\n%-6s %-9s %-5s  %-28s %s" % ("id", "cat", "hit", "query", "got/gold"))
    pos_hit = pos_n = 0
    for i, c in enumerate(cases):
        sims = V @ QV[i]
        k = int(c.get("k") or 5)
        top = np.argsort(-sims)[:k]
        got = [rows[t2]["seq"] for t2 in top]
        gold = c["gold"] if isinstance(c["gold"], list) else [c["gold"]]
        need = int(c.get("minHit") or 1)
        hit = 1 if len(set(gold) & set(got)) >= need else 0
        if c["cat"] != "negative":
            pos_hit += hit
            pos_n += 1
        mark = "✓" if hit else ("—" if c["cat"] == "negative" else "✗")
        print("%-6s %-9s %-5s  %-28s got=%s gold=%s  sims_top=%.3f"
              % (c["id"], c["cat"], mark, c["q"][:26], got, gold, float(sims[top[0]])))

    print(f"\n正例 Recall@{5} = {pos_hit}/{pos_n} = {pos_hit/max(pos_n,1)*100:.1f}%")


if __name__ == "__main__":
    main()
