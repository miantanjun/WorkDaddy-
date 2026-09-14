@echo off
rem WorkDaddy Windows 启动器（双击入口）
rem 需要：launcher.cmd 与 win-launcher.js / watchdog.js / daemon.js 在同一目录
setlocal EnableExtensions
rem Hidden shortcut launches have no console; chcp can block while cmd creates
rem a hidden console host, so keep the inherited code page in that mode.
if /i not "%WBSWITCH_NO_PAUSE%"=="1" chcp 65001 >nul 2>&1
cd /d "%~dp0" >nul 2>&1

rem 先输出一行 ASCII 状态，便于区分“正在启动”和“入口没有执行”。
echo WorkDaddy launcher starting...

rem 定位 node：优先安装包内置运行时，其次 WorkBuddy 托管运行时，最后 PATH。
set "NODE="
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if not defined NODE if exist "%%d\node.exe" set "NODE=%%d\node.exe"
)
if not defined NODE set "NODE=node"

if not exist "%~dp0win-launcher.js" (
  echo ERROR: win-launcher.js was not found in the launcher directory.
  pause
  exit /b 1
)

echo Checking the WorkDaddy Node runtime...
"%NODE%" --experimental-sqlite "%~dp0win-launcher.js" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Done: WorkDaddy is ready.
  exit /b 0
) else (
  echo ERROR: launcher exited with code %EXIT_CODE%.
  echo Log: %APPDATA%\WorkDaddy\launcher.log
)
if /i "%WBSWITCH_NO_PAUSE%"=="1" exit /b %EXIT_CODE%
pause
