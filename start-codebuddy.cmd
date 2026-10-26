@echo off
rem WorkDaddy - CodeBuddy CN 独立入口（方案 A：直跑 node 启动器，绕过原生 exe 的 profile 折叠）
rem 与 WorkBuddy 完全隔离：UI 47834 / CDP 9224 / 锁 47934 / 数据目录 %APPDATA%\WorkDaddy\profiles\codebuddy-cn
setlocal
set "WBSWITCH_PROFILE=codebuddy-cn"
set "WBSWITCH_APP_DIR=%~dp0"
rem 必须清掉原生标记：原生入口只认 WorkBuddy 名字，找不到 CodeBuddy。
rem 走 legacy 发现路径才会用「卸载注册表 DisplayIcon」（其中包含 CodeBuddy）。
set "WBSWITCH_NATIVE_LAUNCHER="
rem ⚠️ 必须清掉 Electron 环境毒化：若存在 ELECTRON_RUN_AS_NODE=1，
rem CodeBuddy 会以纯 Node 模式启动并把 --remote-debugging-port 判为 bad option（exit 9）。
rem NODE_OPTIONS 里的 --require shim 同样会注入到客户端主进程。
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
cd /d "%~dp0scripts"

"%~dp0scripts\runtime\node\node.exe" "%~dp0scripts\win-launcher.js"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo [WorkDaddy/CodeBuddy] 启动器退出码 = %RC%
  echo   4=通用失败  5=需提权  9=Node 参数错误  10=在跑但没 CDP  11=权限不对等  12=多同目录进程
  pause
)
exit /b %RC%
