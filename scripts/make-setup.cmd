@echo off
rem ============================================================
rem  WorkDaddy Windows 自解压安装包生成脚本
rem  用法：在仓库根目录双击 / 运行本脚本，产出 release\WorkDaddy-Setup.exe
rem  产物：双击运行即可自动安装 + 创建桌面图标（无需任何编译器，仅用系统自带 IExpress）
rem ============================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0..\.."             rem 定位到仓库根目录

set "SCRIPTS_DIR=%~dp0"        rem scripts\ 的绝对路径（带尾部反斜杠）
set "SED_TEMPLATE=%~dp0win\setup.sed"
set "SED_TMP=%TEMP%\workdaddy-setup.sed"
set "OUT=release\WorkDaddy-Setup.exe"
set "VERSION="

rem ---- 读取 daemon.js 里的版本号（DAEMON_VERSION = 'x.y.z'）
for /f "usebackq tokens=2 delims='" %%v in (`findstr /c:"DAEMON_VERSION = '" "%~dp0daemon.js"`) do set "VERSION=%%v"
if not defined VERSION set "VERSION=0.0.0"
echo 版本: %VERSION%

rem ---- 校验源目录与 iexpress
if not exist "%SCRIPTS_DIR%install-win.cmd" (
  echo 错误：找不到 install-win.cmd，请从仓库 scripts 同级目录运行。
  exit /b 1
)
if not exist "%SystemRoot%\System32\iexpress.exe" (
  echo 错误：系统缺少 iexpress.exe（Windows 10/11 均自带，但可能被精简）。
  exit /b 2
)

rem ---- 用真实路径填充 SED 模板
(
  for /f "usebackq delims=" %%L in ("%SED_TEMPLATE%") do (
    set "LINE=%%L"
    setlocal enabledelayedexpansion
    set "LINE=!LINE:__SCRIPTS_DIR__=%SCRIPTS_DIR%!"
    set "LINE=!LINE:__VERSION__=%VERSION%!"
    echo !LINE!
    endlocal
  )
) > "%SED_TMP%"

rem ---- 调用 IExpress 生成自解压安装包
echo 正在打包为 Setup.exe ...
set "OUT_FULL=%CD%\%OUT%"
if exist "%OUT_FULL%" del /q "%OUT_FULL%"
iexpress /N /Q "%SED_TMP%"
if not exist "%OUT_FULL%" (
  echo 错误：未生成安装包，请确认 IExpress 运行成功。
  exit /b 3
)

echo.
echo ============================================================
echo  生成完成：%OUT_FULL%
echo  用法：发给用户双击 WorkDaddy-Setup.exe，即自动安装并创建桌面图标。
echo  卸载：运行 %LOCALAPPDATA%\Programs\WorkDaddy\scripts\uninstall-win.ps1
echo ============================================================
pause
