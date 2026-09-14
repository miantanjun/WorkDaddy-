@echo off
rem WorkDaddy Windows 双版本发布打包入口
rem 双击运行会提示输入版本号；命令行可追加 -Version 1.1.1 等参数。
setlocal
chcp 65001 >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-win-release.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo 双版本安装包已生成。
) else (
  echo 打包失败，退出码 %EXIT_CODE%。
)
pause
exit /b %EXIT_CODE%
