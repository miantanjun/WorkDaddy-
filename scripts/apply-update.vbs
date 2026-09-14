Option Explicit

' WorkDaddy 自动更新中介脚本（Windows）。
'
' 为什么需要它：
'   Node 在 Windows 上 spawn 的子进程会被放进 Job Object，父进程（daemon）退出时 job 关闭，
'   子进程会被 KILL_ON_JOB_CLOSE 连带杀死；而 detached:true 虽能解耦，但 PowerShell 5.1 / cmd.exe
'   是 console 程序，在 detached（无控制台）环境下宿主初始化会静默退出、-File 脚本根本不执行。
'   wscript.exe 是 GUI 子系统进程（不依赖控制台），其 WScript.Shell.Run 通过 ShellExecute 创建
'   完全独立的进程树，父进程死活都不影响更新脚本继续执行。这就是 Windows 上唯一可靠的
'   "父进程退出后子进程仍继续" 通道。
'
' 【ShellExecute 的坑】sh.Run 的命令行第一个 token 必须是"可解析的可执行文件"：
'   带双引号包裹的完整路径（"C:\...\powershell.exe"）或裸名（powershell.exe）才可靠——
'   实测"完整路径不带引号"(V2) 与"引号路径"(V1) 都可能静默失败；裸名 100% 可靠。
'   因此这里固定写死 powershell.exe 裸名（System32 恒在 PATH），后续所有参数一律加双引号。
'
' 用法（由 daemon.js applyUpdate() 调用）：
'   wscript.exe //nologo apply-update.vbs <apply-update.ps1> <srcPackage> <appDir> <port> <applyLog> <attemptId>

Dim shell, i, cmd
Set shell = CreateObject("WScript.Shell")

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File "
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
If WScript.Arguments.Count = 0 Then WScript.Quit 1

' 0 = 隐藏窗口；False = 不等待（本脚本立即退出，powershell 继续在独立进程树中执行）
shell.Run cmd, 0, False
