@echo off
rem ============================================================
rem  WorkDaddy 一键启动（zip 解压后的顶层入口，双击运行）
rem  作用：确保守护进程运行 + 以调试模式拉起/重启 WorkBuddy + 注入组件。
rem        已在安装后日常只需双击桌面「WorkDaddy」图标。
rem  设计：绝对路径定位 scripts\launcher.cmd，无相对路径歧义。
rem ============================================================
setlocal
chcp 65001 >nul 2>&1
echo WorkDaddy launcher starting...
if not exist "%~dp0scripts\launcher.cmd" (
  echo ERROR: %~dp0scripts\launcher.cmd was not found.
  pause
  exit /b 1
)
call "%~dp0scripts\launcher.cmd"
