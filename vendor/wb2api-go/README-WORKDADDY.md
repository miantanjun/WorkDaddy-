# vendor/wb2api-go —— 自维护的 Go 反代网关

这个目录是 **WorkDaddy 反代网关（sidecar）的源码**，我们自己在维护。

## 来源

- 上游仓库：`linguo2625469/workbuddy2api-panel`（MIT）
- 基线版本：`1.13.0-panel`（`cmd/server/main.go` 里的 `appVersion`）
- 该分支派生于更早的 `Sliverkiss/workbuddy2api`（**原仓库已被删除**）
- 上游 README 原话：「上游仓库此后已删除…本分支已完整继承，此后演进以本仓库为准」

## 为什么我们自己维护

正式上游已停止演进；另一条 Python 分支（`xiaofan6ya/wb2api`）是**另一门语言的重写**，代码无法移植。
但这一支有完整 Go 源码、能编译，所以采用**按功能对账、择项自补**的方式演进，而不是整体切换。

对账结论见工作区文档 `WorkDaddy-两版功能对账-最终-2026-10-27.md`。

## 编译

```bash
bash vendor/wb2api-go/build.sh
# 产物：vendor/wb2api-go/dist/wb2api.exe
```

工具链是便携版（`%APPDATA%\WorkDaddy\golang\go`），不依赖系统 PATH。
首次编译会下载依赖（约几分钟），之后增量编译约 30 秒。

## 我们的改动（相对 1.13.0 基线）

### 1. 账号权威健康检查（新增）

| 文件 | 改动 |
|---|---|
| `internal/panel/health.go` | **新增**。`POST /panel/api/accounts/{uid}/health` 三步验证：积分 → 模型目录 → 一次最小真实对话 |
| `internal/panel/panel.go` | 路由注册 1 行 |

设计要点：

- **只诊断，不改账号状态** —— 任一步失败都不 disable / 不冷却 / 不熔断。一次接口异常不足以判定账号失效。
- 真实对话会消耗极少量积分，因此前两步不过就不做第三步；另支持 `?chat=0` 只读探测。
- 探测模型优先取上游标记的 `isDefault`，否则取列表第一个。

来源参照：Python 版 `admin/account_health.py` 的语义（三步都过才算健康），实现是 Go 侧独立重写。

## 注意

- 这是**完整源码快照**，不是补丁。改动请直接在这里改，改完用 `build.sh` 出包。
- `config.json` 的格式与本仓 `scripts/api-gateway.js` 的模板驱动完全兼容，面板集成无需改动。
- 升级基线（如果上游哪天复活）要重新做一次三方合并，参考本仓 `scripts/session-sync.js` 的三方合并流程。
