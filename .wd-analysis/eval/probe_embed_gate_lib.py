# -*- coding: utf-8 -*-
"""共享的编码器实现（probe 脚本用，不进产品代码）。

⚠️ 不用 fastembed：它写死走 GCS 下 tar.gz，本机不通（实测 offline/LocalEntryNotFound）。
   直接 onnxruntime + tokenizers，模型文件用 hf_hub_download(local_dir=...) 落成实体文件
   （huggingface_hub 默认用软链接，Windows 上读出来是 0 字节，local_dir 才落实体）。
"""
import os

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
FLAT = os.path.join(HERE, ".onnx-flat")


class BgeEncoder:
    def __init__(self, onnx_file="onnx/model_quantized.onnx"):
        self.tok = Tokenizer.from_file(os.path.join(FLAT, "tokenizer.json"))
        self.tok.enable_truncation(max_length=512)
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
            #   手工右填充最稳。
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
            m = mask[..., None].astype(np.float64)
            pooled = (v * m).sum(1) / np.maximum(m.sum(1), 1e-9)
            pooled = pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9)
            outs.append(pooled)
            self.dim = pooled.shape[1]
        return np.vstack(outs)
