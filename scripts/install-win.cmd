@echo off
rem WorkDaddy Windows 安装核心（由 Install-WorkDaddy.cmd 或安装目录调用）
rem 仅用 %~dp0 绝对路径定位 install-win.ps1，杜绝 scripts\scripts 嵌套导致的相对路径歧义
setlocal
chcp 65001 >nul 2>&1

where powershell >nul 2>nul
if errorlevel 1 (
  echo ERROR: PowerShell was not found.
  pause
  exit /b 1
)

if not exist "%~dp0install-win.ps1" (
  echo ERROR: install-win.ps1 was not found beside this file.
  pause
  exit /b 3
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-win.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  powershell -NoProfile -Command "$b='5a6J6KOF5a6M5oiQ44CCV29ya0J1ZGR5IOWNs+WwhuS7peiwg+ivleaooeW8j+mHjeWQr++8jOivt+eojeetieeJh+WIu+OAgg=='; [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)))"
  powershell -NoProfile -Command "$b='6K+35omL5Yqo5YWz6Zet5b2T5YmN56qX5Y+j77yM5bm25YmN5b6A5qGM6Z2i5Y+z6ZSuIFdvcmtEYWRkeSDlv6vmjbfmlrnlvI/vvIzngrnlh7vku6XnrqHnkIblkZjouqvku73ov5DooYzvvIzmhJ/osKLkvb/nlKjvvZ4='; [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)))"
) else (
  echo ERROR: installation failed with code %EXIT_CODE%. See the output above.
)
pause
