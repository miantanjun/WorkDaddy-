# -*- coding: utf-8 -*-
"""
向量路可行性判定实验（阶段 7 前置）
=========================================================
要回答的唯一问题：
    **向量能不能分开「同一件事的不同说法」和「看起来像但意思相反/不同」？**

为什么必须先做这一步：
    阶段 6 后半段已经用词面 jaccard 测过同一个问题，结论是
    「同义组最低 0.409 < 对照组 0.733」⇒ 词面这条路**结构性地**不可用。
    如果向量也是同样的分布（两组重叠），那么加向量只是白费算力，
    必须先把结论拿出来再谈工程化 —— 否则又是写完才发现阈值不可用。

判据（不预设阈值，直接看两组分布的**可分性**）：
    · min(同义对) vs max(对照对)
    · min(同义) > max(对照) ⇒ 存在安全阈值区间，向量路成立
    · min(同义) <= max(对照) ⇒ 不可分，与词面同命，此路不通

⚠️ 实现上不用 fastembed：它写死走 GCS 下 tar.gz，本机不通（已实测）。
   直接 onnxruntime + tokenizers 跑，用 hf_hub_download 拿到的实体文件。
"""
import json
import os
import sys
import time

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
FLAT = os.path.join(HERE, ".onnx-flat")


# ---------- 语料：直接复用阶段 6 那组的同义语料（口径一致才能对比） ----------
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
]

# 对照组：必须拒绝。每条注明「靠什么区分」。
TRAP = [
    ("五柜埃及货已装运，ETD 泗水 9 月 2 日",
     "五柜埃及货未装运，ETD 泗水 9 月 2 日", "状态词对立"),
    ("订单 AB-260713 尾款 USD 100 已付",
     "订单 CD-260713 尾款 USD 100 已付", "实体不交"),
    ("订单 YKW-SU-260713 订金 USD 99,202.32 已入账",
     "订单 YKW-SU-260713 尾款 USD 231,472.08 未付", "数值不同"),
    ("7863 端口跑控制台，前端页面走同端口",
     "7866 端口跑网关面板，前端页面走同端口", "实体不交"),
    ("记忆分层按回合划分，用户发言 pri 为 2",
     "记忆分层按长度划分，用户发言 pri 为 2", "方法不同（回合 vs 长度）"),
    ("尾款已到账，可以安排装运",
     "尾款未到账，暂缓装运", "状态词对立"),
]


class BgeEncoder:
    def __init__(self, onnx_file="onnx/model_quantized.onnx"):
        self.tok = Tokenizer.from_file(os.path.join(FLAT, "tokenizer.json"))
        self.tok.enable_truncation(max_length=512)
        self.tok.enable_padding(pad_id=0, pad_token="[PAD]")
        p = os.path.join(FLAT, onnx_file)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        self.sess = ort.InferenceSession(p, sess_options=opts, providers=["CPUExecutionProvider"])
        self.names = [i.name for i in self.sess.get_inputs()]
        self.dim = None

    def encode(self, texts, batch=16):
        outs = []
        for i in range(0, len(texts), batch):
            chunk = texts[i:i + batch]
            encs = [self.tok.encode(t) for t in chunk]
            # ⚠️ 不用 tokenizer 自带 padding：`[PAD]` 不一定在词表里，
            #   enable_padding 会静默不生效 ⇒ 变长数组 ⇒ numpy 报 inhomogeneous shape。
            #   这里手工右填充，最稳。
            L = max(len(e.ids) for e in encs)
            ids = np.zeros((len(encs), L), dtype=np.int64)
            mask = np.zeros((len(encs), L), dtype=np.int64)
            for k, e in enumerate(encs):
                n = len(e.ids)
                ids[k, :n] = e.ids
                mask[k, :n] = 1
            feed = {}
            for nm in self.names:
                if nm == "input_ids":
                    feed[nm] = ids
                elif nm == "attention_mask":
                    feed[nm] = mask
                elif nm == "token_type_ids":
                    feed[nm] = np.zeros_like(ids)
            v = self.sess.run(None, feed)[0]
            # mean pooling with mask
            m = mask[..., None].astype(np.float64)
            pooled = (v * m).sum(1) / np.maximum(m.sum(1), 1e-9)
            # L2 normalize
            pooled = pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9)
            outs.append(pooled)
            self.dim = pooled.shape[1]
        return np.vstack(outs)


def run(onnx_file="onnx/model_quantized.onnx", label=None):
    t0 = time.time()
    enc = BgeEncoder(onnx_file)
    load_ms = int((time.time() - t0) * 1000)

    texts = [a for a, b in SYN] + [b for a, b in SYN] + [a for a, b, _ in TRAP] + [b for a, b, _ in TRAP]
    t1 = time.time()
    V = enc.encode(texts)
    emb_ms = int((time.time() - t1) * 1000)

    n = len(SYN)
    syn_scores = [float(V[i].dot(V[n + i])) for i in range(n)]
    m = len(TRAP)
    trap_scores = [float(V[2 * n + i].dot(V[2 * n + m + i])) for i in range(m)]

    mn_syn, mx_trap = min(syn_scores), max(trap_scores)
    gap = mn_syn - mx_trap
    return {
        "model": label or onnx_file, "dim": enc.dim, "loadMs": load_ms,
        "embMs": emb_ms, "perTextMs": round(emb_ms / len(texts), 1),
        "syn": [round(x, 4) for x in syn_scores],
        "trap": [round(x, 4) for x in trap_scores],
        "synMin": round(mn_syn, 4), "synMax": round(max(syn_scores), 4),
        "trapMin": round(min(trap_scores), 4), "trapMax": round(mx_trap, 4),
        "gap": round(gap, 4), "separable": gap > 0,
    }


def main():
    targets = [
        ("onnx/model_quantized.onnx", "bge-small-zh-v1.5 · int8"),
        ("onnx/model.onnx", "bge-small-zh-v1.5 · fp32"),
    ]
    if len(sys.argv) > 1:
        targets = [(sys.argv[1], sys.argv[1])]

    out = []
    for f, label in targets:
        print("=" * 70)
        print("模型:", label)
        if not os.path.exists(os.path.join(FLAT, f)):
            print("  缺文件:", f)
            continue
        try:
            r = run(f, label)
        except Exception as e:  # noqa: BLE001
            print("  失败:", repr(e)[:400])
            continue
        out.append(r)
        print(f"  dim={r['dim']}  加载 {r['loadMs']}ms  编码 {r['embMs']}ms（{r['perTextMs']}ms/条）")
        print(f"  同义对（应合）{len(r['syn'])}条  min={r['synMin']}  max={r['synMax']}")
        for i, x in enumerate(r["syn"]):
            print(f"      S{i+1}: {x}")
        print(f"  对照对（禁合）{len(r['trap'])}条  min={r['trapMin']}  max={r['trapMax']}")
        for i, x in enumerate(r["trap"]):
            print(f"      T{i+1} [{TRAP[i][2]}]: {x}")
        print(f"  ⇒ 间隙 = min(同义) − max(对照) = {r['synMin']} − {r['trapMax']} = {r['gap']}")
        if r["separable"]:
            print(f"  ✅ 可分：安全阈值区间 ({r['trapMax']}, {r['synMin']})")
        else:
            print("  ⛔ 不可分：同义组最低值不高于对照组最高值")

    dst = os.path.join(HERE, "probe-embed-gate.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n明细已存:", dst)


if __name__ == "__main__":
    main()
