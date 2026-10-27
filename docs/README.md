# 文档索引

本目录放**跨版本、长期有效**的说明文档。单版本的改动记录在根目录 [`CHANGELOG.md`](../CHANGELOG.md)。

| 文件 | 内容 | 什么时候看 |
|---|---|---|
| [`DONE-TODO.md`](DONE-TODO.md) | **已办 / 待办总清单**（上游吸纳账、自研修复账、网关账、判定不做账、待办优先级） | 想知道「做到哪了、还剩什么」时 |
| [`gateway-audit-2026-10.md`](gateway-audit-2026-10.md) | **反代网关取证报告**：出站指纹暴露面、实测抓包、多模型一致性对比、结论与残余风险 | 想改网关出站行为、或怀疑被风控时 |
| [`../vendor/wb2api-go/README-WORKDADDY.md`](../vendor/wb2api-go/README-WORKDADDY.md) | 网关源码来源、相对上游的改动、构建方法 | 要编译 / 升级网关时 |

> 本仓库根目录只有两个面向用户的 `.md`：`README.md`（安装使用）与 `CHANGELOG.md`（版本改动）。
> 其余说明一律进 `docs/`，避免根目录堆积。
