# WorkBuddy 助手

WorkBuddy 桌面端的多账号 · 会话同步 · 主题增强工具集。基于 Chrome DevTools Protocol (CDP) 注入，零侵入、不改官方安装包。

> **本项目是 [babygoton/WorkDaddy](https://github.com/babygoton/WorkDaddy) 的个人维护分支。**
> 原项目作者：babygoton 与 WorkDaddy Contributors。原始代码以 **AGPL-3.0-or-later** 授权（见 `LICENSE`）。
> 本分支在原版基础上修复了若干缺陷并追加了部分功能，仅供维护者个人在自有设备上使用。

---

## 与上游的差异

在 **WorkDaddy 1.2.2** 基础上做了以下改动：

| 类别 | 内容 |
|---|---|
| 缺陷修复 | 「假退出」流程中断（`taskkill` 优雅失败被当成致命错误），导致登录文件未删、应用未重启 |
| 缺陷修复 | 删除账号备份后重新登录，会因幂等登记丢失而**重复复制**已有会话 |
| 缺陷修复 | `daemon` 在原生启动器模式下权限检测失败导致崩溃重启循环（加了 PowerShell 回落） |
| 功能改进 | 会话自动复制拆成两阶段（正文先落盘、产物后搬），并按体积**升序**排队，避免巨型会话堵塞整条队列 |
| 功能新增 | 会话页常驻**复制进度条**：当前会话标题、`已复制/总数` 计数、文件级进度、已省空间 |
| 功能新增 | 产物目录改用**硬链接**去重（冻结文件三分支增量链接，失败回落复制），省下数百 MB 磁盘 |
| 显示名 | 界面与安装程序显示名改为「WorkBuddy 助手」（内部标识与上游保持一致，便于合并上游更新） |
| 发行 | 自动更新指向本仓库的 GitHub Release；由 GitHub Actions 构建安装包 |

完整维护记录见仓库维护者本地的 `workdaddy-maintain` 手册。

---

## 安装

### Windows

1. 打开本仓库的 [Releases](../../releases) 页面，下载最新的 `WorkDaddy-Setup-<版本>.exe`
2. 直接双击安装（**无需管理员权限**，也**不要**选「以管理员身份运行」）
3. 安装程序会自动识别本机的 WorkBuddy 客户端；如未识别到，手动选择 `WorkBuddy.exe`
4. 装完双击桌面快捷方式即可

> 前置条件：本机需已安装 **WorkBuddy** 桌面客户端。本工具是它的增强插件，不含 WorkBuddy 本体。

### 更新

打开面板 → **关于** → 点「立即更新」。程序会自动下载新版本并安装。

> ⚠️ 更新过程会**先关闭 WorkBuddy**（安装器要求客户端完全退出），装完后自动重新拉起。请先保存好正在进行的工作。

---

## 构建（GitHub Actions）

推一个 `v*` 标签，或在 Actions 页面手动触发 `Build & Verify Windows Setup`：

```
Go 1.27 编译 Windows 原生启动器
   ↓
scripts/build-win-zip.sh        打暂存包（含 Node 运行时、内置壁纸）
   ↓
Inno Setup 6.7.1                生成 WorkDaddy-Setup-<版本>.exe
   ↓
scripts/verify-win.cmd          自检（关键文件 / JS 语法 / PS1 语法）
   ↓
发布到 GitHub Release
```

产物同时作为 Actions artifact 保留。

---

## 目录说明

| 路径 | 说明 |
|---|---|
| `scripts/daemon.js` | 后台守护进程：本地 HTTP API、账号切换、会话复制、自动更新 |
| `scripts/inject.js` | 注入 WorkBuddy 页面的前端组件（面板、进度条、主题） |
| `scripts/lib.js` | 共享库：账号元数据、自动复制规则、会话索引 |
| `scripts/win-launcher.js` | Windows 启动器逻辑（进程检测、权限边界、daemon 生命周期） |
| `scripts/watchdog.js` | 守护进程看门狗：daemon 退出后自动用磁盘上的新代码重启 |
| `scripts/win/workdaddy.iss` | Inno Setup 安装器定义 |
| `scripts/windows-native/` | Windows 原生启动器（Go 源码） |
| `.github/workflows/` | GitHub Actions 构建流程 |

数据目录：`%APPDATA%\WorkDaddy`（账号备份、日志、自动复制规则）。

---

## 许可

**GNU Affero General Public License v3.0 or later** —— 见 [LICENSE](LICENSE)。

本分支的修改同样以 AGPL-3.0-or-later 授权。若你分发本软件（含通过网络提供服务），须一并提供完整源代码并保留原作者的版权声明。
