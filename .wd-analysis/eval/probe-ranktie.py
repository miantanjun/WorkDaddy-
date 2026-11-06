# -*- coding: utf-8 -*-
"""
参数扫描：新鲜度换位的作用域多大才不会伤召回
=========================================================
12.5 的发现：产品的「并列组内新鲜度换位」让 Recall@5 从 48.4% 掉到 41.9%（31 题 2 题）。

`RANK_TIE = 2` 意味着「名次差 ≤2 视为并列，组内可按新鲜度换位」。
这个阈值当初是照着「bm25 相邻差 0.01~0.03」定的，没有对召回做过验证。

本脚本扫描 RANK_TIE ∈ {0, 1, 2, 3, 5}，看召回怎么变，同时**必须**看另一个指标：
    新鲜度换位原本是为了「同一结论说了好几遍，取最新的那条」。
    把这个目标量出来（gold 有多新 vs 被换上去的有多新），才不会「修好召回、弄坏新鲜度」。

⚠️ 只读线上评测库副本，不动产品代码。
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
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
const L=ck._internal;

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
  const scored=rows.map(r=>{
    const t=String(r.text||''); let got=0;
    for(const p of live) if(t.indexOf(p)>=0) got+=w.get(p);
    return {r, cov:got/wSum};
  }).filter(x=>x.cov>0);
  const order=scored.slice().sort((a,b)=> b.cov-a.cov || a.r.score-b.r.score);

  out.push({id:c.id, cat:c.cat,
            gold:(Array.isArray(c.gold)?c.gold:[]).map(Number), need:c.minHit||1,
            row: order.map((x,i)=>({rank:i, seq:Number(x.r.seq), h:x.r.h,
                 ts:Number(x.r.ts), pri:Number(x.r.pri), dup:Number(x.r.dup)||1,
                 last_hit_ts:Number(x.r.last_hit_ts), score:Number(x.r.score),
                 // ⚠️ text 必须一起带出来算 hasId：产品 importanceOf 用 ID_SHAPE 判强标识符（权重 0.20）。
                 //   第一版我拿 text_of[seq] 去查，而 text_of 是按 **row id** 索引的，
                 //   seq ≠ id ⇒ hasId 基本是错的 ⇒ rankKey 偏 ±0.08 ⇒ 阈值扫描的数字不可信。
                 text:String(x.r.text||'')}))});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2500:]); raise SystemExit(1)
    return json.loads(r.stdout)


# ---- 复刻产品的两步排序（照抄 ck-memory.js 的 rankRelevanceFirst 与 rankKey）----
RECENCY_HALF_LIFE_DAYS = 30


def recency(ts, last_hit, now):
    ref = max(ts or 0, last_hit or 0)
    if not ref:
        return 0.0
    days = max(0.0, (now - ref) / 86400000)
    return 0.5 ** (days / RECENCY_HALF_LIFE_DAYS)


ID_SHAPE = None


def importance(row):
    s = 0.40 if row["pri"] == 2 else 0.20
    if row.get("hasId"):
        s += 0.20
    dup = row.get("dup") or 1
    if dup > 1:
        s += min(0.15, 0.05 * np.log2(dup + 1))
    # ⚠️ 产品里还有「长度 40~400 字 +0.10」这一项，第一版漏了 ⇒ rankKey 偏 0~0.04
    L = row.get("len") or 0
    if 40 <= L <= 400:
        s += 0.10
    return min(1.0, s)


def rank_key(row, now):
    return 0.6 * recency(row["ts"], row["last_hit_ts"], now) + 0.4 * importance(row)


def rerank(rows, now, rank_tie=2, enable=True):
    """rankMode=true 路径：rel 是名次。第 1 名独占 0 组（除非真并列）。"""
    if not rows:
        return rows
    arr = [{"x": r, "i": i, "g": 0} for i, r in enumerate(rows)]
    tie = rank_tie
    truly_tied = len(arr) > 1 and arr[1]["x"]["rank"] == arr[0]["x"]["rank"]
    arr[0]["g"] = 0
    g = 0 if truly_tied else 1
    anchor = arr[1]["x"]["rank"] if len(arr) > 1 else arr[0]["x"]["rank"]
    for k in range(2, len(arr)):
        if arr[k]["x"]["rank"] - anchor > tie:
            g += 1
            anchor = arr[k]["x"]["rank"]
        arr[k]["g"] = g
    if len(arr) > 1:
        arr[1]["g"] = 0 if truly_tied else g
    if not enable:
        return rows
    arr.sort(key=lambda a: (a["g"], -rank_key(a["x"], now), a["i"]))
    return [a["x"] for a in arr]


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


def main():
    cases = build()
    now = int(__import__("time").time() * 1000)

    # 给每行补 hasId：直接用行自带的 text 判，**不再**去 rows.json 里按 seq 反查
    import re
    ID_RE = re.compile(r"[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}")
    for c in cases:
        for r in c["row"]:
            r["hasId"] = bool(ID_RE.search(r.get("text", "")))
            r["len"] = len(r.get("text", ""))

    variants = {"不换位(RANK_TIE 关)": 0, "RANK_TIE=1": 1, "RANK_TIE=2(现状)": 2,
                "RANK_TIE=3": 3, "RANK_TIE=5": 5}
    res = {}
    for name, tie in variants.items():
        ok = 0
        fresh = []
        newshare = []
        for c in cases:
            if not c["row"]:
                continue
            rows = rerank(c["row"], now, rank_tie=tie, enable=(tie > 0))
            picked = dedupe(rows, 5)
            seqs = [p["seq"] for p in picked]
            if len(set(c["gold"]) & set(seqs)) >= c["need"]:
                ok += 1
            # 新鲜度目标：前5 的平均「新鲜度」，越高说明越倾向新内容
            fresh.append(sum(recency(p["ts"], p["last_hit_ts"], now) for p in picked) / max(len(picked), 1))
            # ⚠️ 辅助指标：前5 里「不是纯 bm25 前5」的有几条 —— 这才是换位真正动了多少
            base5 = {p["seq"] for p in c["row"][:5]}
            newshare.append(sum(1 for s in seqs if s not in base5) / max(len(seqs), 1))
        res[name] = {"recall": ok / len(cases), "ok": ok,
                     "fresh": float(np.mean(fresh)),
                     "newShare": float(np.mean(newshare))}

    n = len(cases)
    print(f"正例 {n} 题 · RANK_TIE 扫描\n" + "=" * 74)
    print(f"  {'设置':24s} {'Recall@5':>10s} {'前5平均新鲜度':>14s} {'被换进来的比例':>14s}")
    for k, v in res.items():
        print(f"  {k:24s} {v['recall']*100:9.1f}% {v['fresh']:14.3f} {v['newShare']*100:13.1f}%")
    print("=" * 74)
    best = max(res.items(), key=lambda kv: kv[1]["recall"])
    print(f"  召回最高：{best[0]} = {best[1]['recall']*100:.1f}%")
    print("  判读：若「新鲜度」几乎不动而召回下降，说明换位**没有换来任何新鲜度收益**，只是纯损耗。")

    json.dump({"n": n, "res": res}, open(os.path.join(HERE, "probe-ranktie.json"),
                                         "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
