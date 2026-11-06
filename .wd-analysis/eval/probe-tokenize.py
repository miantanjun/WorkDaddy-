# -*- coding: utf-8 -*-
"""诊断：分词是否保留了字母编号；CLS 池化与 mean 池化的区别。"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from probe_embed_gate_lib import FLAT, BgeEncoder  # noqa: E402
from tokenizers import Tokenizer  # noqa: E402

t = Tokenizer.from_file(os.path.join(FLAT, "tokenizer.json"))
for s in ["订单 AB-260713 尾款 USD 100 已付",
          "订单 CD-260713 尾款 USD 100 已付",
          "订单 XY-260713 尾款 USD 100 已付"]:
    e = t.encode(s)
    print(repr(s))
    print("  tokens:", e.tokens)
    print("  ids   :", e.ids)
    print()

print("=" * 60)
print("池化方式对比（BGE 官方是 CLS 池化，不是 mean）")
enc = BgeEncoder("onnx/model.onnx")


class C:
    def __init__(self, enc):
        self.enc = enc
        self.dim = None

    def run(self, texts, pooling):
        import onnxruntime as ort
        tok = self.enc.tok
        outs = []
        encs = [tok.encode(x) for x in texts]
        L = max(len(e.ids) for e in encs)
        ids = np.zeros((len(encs), L), dtype=np.int64)
        mask = np.zeros((len(encs), L), dtype=np.int64)
        for k, e in enumerate(encs):
            n = len(e.ids)
            ids[k, :n] = e.ids
            mask[k, :n] = 1
        feed = {}
        for nm in self.enc.names:
            if nm == "input_ids":
                feed[nm] = ids
            elif nm == "attention_mask":
                feed[nm] = mask
            else:
                feed[nm] = np.zeros_like(ids)
        v = self.enc.sess.run(None, feed)[0]
        if pooling == "cls":
            p = v[:, 0, :]
        else:
            m = mask[..., None].astype(np.float64)
            p = (v * m).sum(1) / np.maximum(m.sum(1), 1e-9)
        p = p / np.maximum(np.linalg.norm(p, axis=1, keepdims=True), 1e-9)
        self.dim = p.shape[1]
        return p


cc = C(enc)
pairs = [
    ("同义", "7863 端口是控制台，绝不能上 frp", "控制台固定在 7863 端口，绝不能上 frp"),
    ("同义", "记忆库文件在 APPDATA 下的 ck-memory 目录，文件名 ck.db",
             "记忆库文件放在 APPDATA 下的 ck-memory 目录，文件名是 ck.db"),
    ("对立", "五柜埃及货已装运", "五柜埃及货未装运"),
    ("对立", "尾款已到账，可以安排装运", "尾款未到账，暂缓装运"),
    ("编号", "订单 AB-260713 尾款 USD 100 已付", "订单 CD-260713 尾款 USD 100 已付"),
    ("编号", "订单 AB-260713 尾款 USD 100 已付", "订单 XY-260713 尾款 USD 100 已付"),
    ("无关", "五柜埃及货已装运", "今天天气不错，适合出门散步"),
]
print(f"{'类型':6s} {'CLS':>8s} {'mean':>8s}   文本")
for kind, a, b in pairs:
    vc = cc.run([a, b], "cls")
    vm = cc.run([a, b], "mean")
    print(f"{kind:6s} {float(vc[0].dot(vc[1])):8.4f} {float(vm[0].dot(vm[1])):8.4f}   {a[:26]} || {b[:26]}")
