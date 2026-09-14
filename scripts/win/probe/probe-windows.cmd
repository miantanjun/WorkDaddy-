@echo off
rem WorkDaddy Windows 移植 - 环境探测入口
rem 用法：把 probe-windows.cmd 和 probe-windows.ps1 放在同一目录，双击本文件即可
rem 输出：桌面上的 WorkDaddy-Windows-Probe.log
setlocal
chcp 65001 >nul

if not exist "%~dp0probe-windows.ps1" (
  echo 错误：找不到 probe-windows.ps1，请把两个文件放在同一目录后重试。
  pause
  exit /b 1
)

echo ==============================================================
echo  WorkDaddy Windows 环境探测
echo  正在采集信息，可能需要几秒到一分钟，请勿关闭窗口...
echo ==============================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0probe-windows.ps1"

echo.
echo 完成！日志已写入桌面：WorkDaddy-Windows-Probe.log
pause