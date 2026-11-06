# -*- coding: utf-8 -*-
"""
决定性诊断（修正版）：瓶颈是「召回」还是「排序」？
=========================================================
⚠️⚠️⚠️ 上一版测错了：我以为 `total=40` 是候选池大小，其实是
   `search()` 里 `Math.min(limit, 40)` 的**返回上限**。传 5000 也被钳到 40。
   ⇒ 用「返回条数」当「候选池大小」是错的，会把排序问题误判成召回问题。

正确做法：绕开 `search()` 的钳位，直接在 SQL 层量两件事：
  ① **候选池** = FTS 或 LIKE 命中、且通过 sid/kind/pri 过滤的**全部**行 —— 这是召回上限
  ② **名次** = 在候选池里按 bm25 排序后 gold 的位置 —— 这是排序能力

判定：
  gold 不在候选池 ⇒ 信号源没覆盖到（换信号才有用）
  gold 在候选池但名次 200 ⇒ 排序有问题（加向量做 RRF 有可能救）

这两个数分开之后，才能判断「向量路」到底能救哪一部分。
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, ".wd-tmp", "evaldata", "WorkDaddy")


def main():
    js = r"""
const path=require('path');
const ck=require(path.join(process.env.ROOT,'scripts','ck-memory.js'));
ck.configure({dataDir:process.env.DATA, log:()=>{}});
const {CASES}=require(path.join(process.env.ROOT,'.wd-analysis','eval','cases.js'));
const db=ck._internal.open();
const L=ck._internal;

/**
 * 候选池构建 —— 口径照抄 search()，但**不截断**并按 bm25 升序（越小越相关）。
 *
 * ⚠️⚠️⚠️ 不用 L.bigram：它没导出（_internal 里没有）。上一版直接调它，
 *   报 `L.bigram is not a function`，整个脚本挂掉。
 *   这里复刻 bigram 的规则：中文取相邻二字、英文/数字整段保留。
 *   与产品口径一致这件事很重要 —— 口径不同量出来的名次就是假的。
 */
function bigram(text){
  const s=String(text||'');
  const out=[];
  const re=/[A-Za-z0-9][A-Za-z0-9._:\/-]*|[\u4e00-\u9fa5]+/g;
  let m;
  while((m=re.exec(s))){
    const t=m[0];
    if(/[\u4e00-\u9fa5]/.test(t)){
      if(t.length===1) out.push(t);
      else for(let i=0;i<t.length-1;i++) out.push(t.slice(i,i+2));
    } else out.push(t.toLowerCase());
  }
  return out.join(' ');
}

function vocabReady(){
  try{
    // ⚠️⚠️⚠️ 必须**三参**形式 ('main','seg_fts','row')。
    //   两参 ('seg_fts','row') 会报「no such fts5 table: temp.seg_fts」——
    //   fts5vocab 把第一参当库名了。这条坑产品代码里已经踩过，我这里又踩了一次，
    //   后果是 df 恒为 0 ⇒ live 为空 ⇒ 候选池恒为 0 ⇒ 31 题全判「不在池」，
    //   看起来像「检索完全失效」，其实是词表没建。
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')`);
    return true;
  }catch(e){ return false; }
}
let _vr=null;
function df(term){
  if(_vr===null) _vr=vocabReady();
  if(!_vr) return 0;
  try{
    const r=db.prepare('SELECT doc FROM temp.wd_vocab WHERE term=?').get(String(term).toLowerCase());
    return r?Number(r.doc)||0:0;
  }catch(e){ return 0; }
}

function pool(sid, q, deep){
  const raw=String(q||'').trim();
  const parts=[...new Set(bigram(raw).split(/\s+/).filter(Boolean))];
  if(!parts.length) return {rows:[],via:'none'};
  const esc=p=>'"'+String(p).replace(/"/g,'""')+'"';
  const live=parts.filter(p=>df(p)>0);
  const PRI=deep?'':' AND COALESCE(s.pri,0) >= 1';
  const TAIL=`FROM (SELECT rowid AS rid, bm25(seg_fts) AS score
              FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
              JOIN seg s ON s.id=t.rid`;
  const COLS='s.id, s.seq, s.ts, s.text, COALESCE(s.pri,0) pri, t.score';
  const talk=db.prepare(`SELECT ${COLS} ${TAIL}
      WHERE s.sid=? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0${PRI}
      ORDER BY t.score`);
  const any=db.prepare(`SELECT ${COLS} ${TAIL} WHERE s.sid=?${PRI} ORDER BY t.score`);
  let rows=[],via='none';
  if(live.length && live.length===parts.length){
    rows=talk.all(live.length===1?esc(live[0]):live.map(esc).join(' AND '), sid); via='AND';
  }
  if(!rows.length && live.length){
    rows=talk.all(live.map(esc).join(' OR '), sid); via='OR';
    if(!rows.length) rows=any.all(live.map(esc).join(' OR '), sid);
  }
  if(!rows.length){
    const P=deep?'':' AND COALESCE(pri,0) >= 1';
    const like=db.prepare(`SELECT id,seq,ts,text,COALESCE(pri,0) pri,0 score FROM seg
        WHERE sid=? AND kind IN ('user','assistant') AND COALESCE(noise,0)=0${P}
        AND text LIKE ? ORDER BY ts DESC`);
    rows=like.all(sid,'%'+raw+'%');
    if(!rows.length) rows=like.all(sid,'%'+raw.replace(/\s+/g,'')+'%');
    if(rows.length) via='LIKE';
  }
  return {rows,via};
}

const out=[];
for(const c of CASES){
  if(c.cat==='negative') continue;
  const gold=(Array.isArray(c.gold)?c.gold:[c.gold]).map(Number);
  const sid=c.sid;
  const segN=db.prepare('SELECT COUNT(*) n FROM seg WHERE sid=?').get(sid).n;
  const priN=db.prepare('SELECT COUNT(*) n FROM seg WHERE sid=? AND kind IN (\'user\',\'assistant\') AND COALESCE(noise,0)=0 AND COALESCE(pri,0)>=1').get(sid).n;

  // 金标准行本身是否在 pri>=1 里（若不在，默认路径**结构性**看不到它）
  const goldPri=db.prepare(`SELECT seq, COALESCE(pri,0) pri, kind, COALESCE(noise,0) noise
      FROM seg WHERE sid=? AND seq IN (${gold.map(()=>'?').join(',')})`).all(sid,...gold);

  const {rows,via}=pool(sid,c.q,false);   // 走**默认路径**（pri>=1），产品实际就用这个
  let rank=-1;
  for(let i=0;i<rows.length;i++){
    if(gold.indexOf(Number(rows[i].seq))>=0){rank=i+1;break;}
  }
  out.push({id:c.id,cat:c.cat,q:c.q,gold,segN,priN,pool:rows.length,via,rank,
            goldPri:goldPri.map(x=>({seq:Number(x.seq),pri:Number(x.pri),kind:x.kind,noise:Number(x.noise)}))});
}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "ROOT": ROOT, "DATA": DATA})
    if r.returncode != 0:
        print(r.stderr[-2500:])
        raise SystemExit(1)
    rows = json.loads(r.stdout)

    print(f"{'id':6s} {'cat':9s} {'via':5s} {'候选池':>6s} {'名次':>6s} {'gold的pri':>10s}  诊断")
    print("=" * 88)
    b = {"前5": 0, "6-20": 0, "21-50": 0, "51+": 0, "池外": 0, "gold 是过程话": 0}
    for x in rows:
        gp = ",".join(str(g["pri"]) for g in x["goldPri"]) or "缺"
        if x["goldPri"] and all(g["pri"] < 1 for g in x["goldPri"]):
            d = "gold 本身 pri=0（默认路径看不到）"
            b["gold 是过程话"] += 1
        elif x["rank"] < 0:
            d = "不在候选池（信号源没覆盖）"
            b["池外"] += 1
        elif x["rank"] <= 5:
            d = "前5 ✓"
            b["前5"] += 1
        elif x["rank"] <= 20:
            d = "6-20 排序"
            b["6-20"] += 1
        elif x["rank"] <= 50:
            d = "21-50 排序"
            b["21-50"] += 1
        else:
            d = "51+ 排序"
            b["51+"] += 1
        print(f"{x['id']:6s} {x['cat']:9s} {x['via']:5s} {x['pool']:6d} {x['rank']:6d} {gp:>10s}  {d}")

    n = len(rows)
    print("=" * 88)
    print(f"正例 {n} 题（默认路径 pri>=1）：")
    for k in ["前5", "6-20", "21-50", "51+", "池外", "gold 是过程话"]:
        v = b[k]
        print(f"  {k:18s} {v:3d}  ({v/n*100:5.1f}%)  {'█'*v}")
    print()
    print(f"  ⇒ 候选池平均 {sum(x['pool'] for x in rows)/n:.0f} 条，"
          f"最少 {min(x['pool'] for x in rows)}，最多 {max(x['pool'] for x in rows)}")
    print(f"  ⇒ gold 在池内的 {n - b['池外'] - b['gold 是过程话']} 题，"
          f"其中进不了前5 的 {n - b['池外'] - b['gold 是过程话'] - b['前5']} 题（排序问题）")

    with open(os.path.join(HERE, "probe-bottleneck.json"), "w", encoding="utf-8") as f:
        json.dump({"rows": rows, "buckets": b}, f, ensure_ascii=False, indent=2)
    print("\n已存 probe-bottleneck.json")


if __name__ == "__main__":
    main()
