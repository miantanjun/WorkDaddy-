Option Explicit

' Desktop shortcut entry point. wscript.exe starts the Node launcher without a console window.
Dim shell, fso, launcher, launcherJs, nodeBin, command, status, logPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Function FindManagedNode(rootPath)
  Dim rootFolder, folder, candidate, best, bestName
  best = ""
  bestName = ""
  If fso.FolderExists(rootPath) Then
    Set rootFolder = fso.GetFolder(rootPath)
    For Each folder In rootFolder.SubFolders
      candidate = fso.BuildPath(folder.Path, "node.exe")
      If fso.FileExists(candidate) Then
        If best = "" Or folder.Name > bestName Then
          best = candidate
          bestName = folder.Name
        End If
      End If
    Next
  End If
  FindManagedNode = best
End Function

launcher = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launcher.cmd")
If Not fso.FileExists(launcher) Then
  WScript.Quit 1
End If
launcherJs = fso.BuildPath(fso.GetParentFolderName(launcher), "win-launcher.js")
nodeBin = fso.BuildPath(fso.GetParentFolderName(launcher), "runtime\node\node.exe")
If Not fso.FileExists(nodeBin) Then
  nodeBin = FindManagedNode(shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.workbuddy\binaries\node\versions")
End If
If Not fso.FileExists(nodeBin) Then nodeBin = "node.exe"

' Run the Node entry directly. Hidden cmd.exe wrappers can remain alive on some
' Windows builds even after the launcher has completed. WBSWITCH_NO_PAUSE=1 is
' retained for compatibility with older launcher.cmd copies.
shell.CurrentDirectory = fso.GetParentFolderName(launcher)
command = """" & nodeBin & """ --experimental-sqlite """ & launcherJs & """"
status = shell.Run(command, 0, True)
' The Node launcher records failures in %APPDATA%\\WorkDaddy\\launcher.log and
' shows details for uncaught failures. A non-zero status without that dialog means
' Node itself failed before the launcher could report the error.
If status <> 0 And status <> 4 Then
  logPath = shell.ExpandEnvironmentStrings("%APPDATA%") & "\WorkDaddy\launcher.log"
  MsgBox "WorkDaddy launch failed, exit code " & status & "." & vbCrLf & "See " & logPath & ".", 48, "WorkDaddy"
End If
WScript.Quit status
