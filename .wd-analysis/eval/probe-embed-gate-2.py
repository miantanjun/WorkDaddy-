# -*- coding: utf-8 -*-
"""
第二阶段取证：把第一阶段的反常点钉死
=========================================================
第一阶段的异常（必须复现确认，不能当偶然）：
    T2「订单 AB-260713 尾款 USD 100 已付」vs「订单 CD-260713 尾款 USD 100 已付」
    ⇒ 向量相似度 **精确等于 1.0000**

这条如果成立，说明向量在「仅差一两个字符的编号」上完全失明，
比词面 jaccard（0.750）还危险 —— 用于合并判定会直接造成数据丢失。

本脚本做三组验证：
  A. 编号扰动序列：AB→CD / AB→AB1 / 7863→7866，逐字符改，看相似度怎么走
  B. 同义 vs 对照的分布（扩大样本，每组 12 对）
  C. 换个模型（fp32 已跑；再试 multilingual-e5-small 若可下载）看是否模型特异
"""
import json
import os

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

import numpy as np

from probe_embed_gate_lib import BgeEncoder  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def cos(a, b):
    return float(a.dot(b))


def section(t):
    print("\n" + "=" * 70)
    print(t)
    print("=" * 70)


def main():
    enc = BgeEncoder("onnx/model.onnx")   # fp32，避免量化噪声干扰结论
    print("模型 bge-small-zh-v1.5 fp32, dim =", enc.dim)

    # ---------- A. 编号扰动 ----------
    section("A. 编号只差一两个字符时，向量还能分得开吗")
    base = "订单 {} 尾款 USD 100 已付"
    ids = ["AB-260713", "CD-260713", "AB-260714", "AB-2607131", "XY-260713"]
    texts = [base.format(i) for i in ids]
    V = enc.encode(texts)
    print(f"{'':14s}" + "".join(f"{i:>13s}" for i in ids))
    for i, a in enumerate(ids):
        row = "".join(f"{cos(V[i], V[j]):13.4f}" for j in range(len(ids)))
        print(f"{a:14s}{row}")

    section("A2. 端口号只差一位")
    pts = ["7863", "7866", "7867", "7861"]
    texts2 = [f"{p} 端口跑控制台，前端页面走同端口" for p in pts]
    V2 = enc.encode(texts2)
    print(f"{'':8s}" + "".join(f"{p:>10s}" for p in pts))
    for i, a in enumerate(pts):
        print(f"{a:8s}" + "".join(f"{cos(V2[i], V2[j]):10.4f}" for j in range(len(pts))))

    section("A3. 完全不同的两句话（对照组，作为下界参考）")
    pairs = [
        ("五柜埃及货已装运，ETD 泗水 9 月 2 日", "今天天气不错，适合出门散步"),
        ("7863 端口跑控制台", "记忆分层按回合划分"),
        ("尾款已到账", "scripts 目录必须纯 CRLF"),
    ]
    va = enc.encode([p[0] for p in pairs])
    vb = enc.encode([p[1] for p in pairs])
    for i, (a, b) in enumerate(pairs):
        print(f"  {cos(va[i], vb[i]):.4f}   {a[:24]}  ||  {b[:24]}")

    # ---------- B. 扩大分布 ----------
    section("B. 同义（应合）vs 状态对立（禁合）的分布，扩大样本")
    SYN = [
        ("记忆库文件在 APPDATA 下的 WorkDaddy ck-memory 目录里，文件名 ck.db",
         "记忆库文件放在 APPDATA 下的 WorkDaddy ck-memory 目录，文件名是 ck.db"),
        ("7863 端口是控制台，绝不能上 frp，免口令但必须保留 Origin 校验",
         "控制台固定在 7863 端口，免口令，但 Origin 校验必须保留，绝不能上 frp"),
        ("网关版本是 1.13.1-panel-wd9，发版时必须 bump 到 wd10",
         "网关当前版本 1.13.1-panel-wd9，发版要 bump 到 wd10"),
        ("scripts 目录下的 js 文件必须保持纯 CRLF，改完要复查 bareLF 等于 0",
         "scripts 下的 js 必须纯 CRLF，改完复查 bareLF 为 0"),
        ("记忆分层按回合划分：用户发言 pri 为 2，回合末条 assistant 为 1，过程话为 0",
         "记忆分层规则是按回合，用户发言 pri 2、回合末条 assistant pri 1、过程话 pri 0"),
        ("实体归一化只去分隔符和大小写，绝不动数字字母，v1.9.9 与 v1.6.0 必须区分",
         "实体归一化仅去分隔符、大小写，绝不动数字字母，所以 v1.9.9 与 v1.6.0 不相等"),
        ("评测集 39 条，分布是 single 16、multi 5、temporal 5、open 5、negative 8",
         "评测集有 39 条，其中 single 16、multi 5、temporal 5、open 5、negative 8"),
        ("三路 RRF 的权重是实体 1.5、事实 1.2、原文 1.0，第三路必须喂 exactItems",
         "RRF 三路权重：实体 1.5、事实 1.2、原文 1.0；第三路要喂 exactItems 不是 items"),
        ("尾款 USD 231,472.08 未付，发票号 CAIRO-11371 随单",
         "尾款 231,472.08 美元还没付，发票 CAIRO-11371 跟着一起走"),
        ("老叶要求交付物一律给 Markdown，因为他要能复制粘贴去制单",
         "交付格式老叶只要 md，理由是要复制去制单"),
        ("订金 30% 已经到账，剩下 70% 等 SUNRISE 打款",
         "30% 订金已入账，70% 尾款由 SUNRISE 支付"),
        ("ETD 泗水 2026-09-02，5 个柜走 Maersk",
         "五个柜给 Maersk，9 月 2 号从泗水开船"),
    ]
    OPP = [
        ("五柜埃及货已装运", "五柜埃及货未装运"),
        ("尾款已到账，可以安排装运", "尾款未到账，暂缓装运"),
        ("这个开关默认开启", "这个开关默认关闭"),
        ("实测通过，可以发版", "实测未通过，不能发版"),
        ("scripts 必须纯 CRLF", "scripts 不能用 CRLF"),
        ("7863 端口是控制台", "7863 端口不是控制台"),
        ("已确认合并，保留第一条", "已撤销合并，两条都保留"),
        ("订金已付，工厂开始排产", "订金未付，工厂无法排产"),
        ("这条规则永远生效", "这条规则已废止"),
        ("允许跨会话查询", "禁止跨会话查询"),
        ("默认只查 pri>=1", "默认不查 pri>=1"),
        ("回滚按倒序执行", "回滚按正序执行"),
    ]
    va = enc.encode([a for a, _ in SYN] + [a for a, _ in OPP])
    vb = enc.encode([b for _, b in SYN] + [b for _, b in OPP])
    syn = [cos(va[i], vb[i]) for i in range(len(SYN))]
    opp = [cos(va[i], vb[i]) for i in range(len(SYN), len(SYN) + len(OPP))]

    def stat(name, xs):
        xs = sorted(xs)
        print(f"  {name} n={len(xs)} min={xs[0]:.4f} p25={xs[len(xs)//4]:.4f} "
              f"med={xs[len(xs)//2]:.4f} max={xs[-1]:.4f}")

    stat("同义(应合)  ", syn)
    print("     ", [round(x, 3) for x in sorted(syn)])
    stat("对立(禁合)  ", opp)
    print("     ", [round(x, 3) for x in sorted(opp)])
    gap = min(syn) - max(opp)
    print(f"\n  间隙 = min(同义) - max(对立) = {min(syn):.4f} - {max(opp):.4f} = {gap:.4f}")
    if gap > 0:
        print(f"  ✅ 可分，安全阈值 ({max(opp):.4f}, {min(syn):.4f})")
    else:
        n_bad = sum(1 for x in syn if x <= max(opp))
        print(f"  ⛔ 不可分；有 {n_bad}/{len(SYN)} 条同义对被压在对立组最大值之下")

    out = {
        "model": "bge-small-zh-v1.5-fp32",
        "idPerturb": {"ids": ids, "matrix": [[round(cos(V[i], V[j]), 4) for j in range(len(ids))] for i in range(len(ids))]},
        "syn": [round(x, 4) for x in syn],
        "opp": [round(x, 4) for x in opp],
        "gap": round(gap, 4),
    }
    with open(os.path.join(HERE, "probe-embed-gate-2.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n明细已存 probe-embed-gate-2.json")


if __name__ == "__main__":
    main()
