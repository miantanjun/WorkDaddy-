param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$LauncherPath
)

$ErrorActionPreference = 'Stop'

function Quote-WindowsArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value.IndexOfAny([char[]]@([char]0, [char]10, [char]13, [char]34)) -ge 0) {
    throw 'Invalid relaunch argument path.'
  }
  return [char]34 + $Value + [char]34
}

$node = [IO.Path]::GetFullPath($NodePath)
$launcher = [IO.Path]::GetFullPath($LauncherPath)
$scriptsRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Node runtime is missing.' }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Windows launcher is missing.' }
if (-not $launcher.StartsWith($scriptsRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Windows launcher is outside the installed scripts directory.'
}

# Ask the out-of-process Explorer desktop for its Application object. Creating
# Shell.Application in-process from an elevated launcher can preserve the
# elevated token instead of performing a real de-elevation.
$shellWindows = New-Object -ComObject Shell.Application
$desktopView = $null
try {
  $desktopLocation = 0
  $desktopRoot = 0
  $desktopHwnd = 0
  # SWC_DESKTOP (8) asks the ShellWindows collection for Explorer's desktop
  # view, whose Application object is owned by the unelevated Explorer process.
  $desktopView = $shellWindows.FindWindowSW([ref]$desktopLocation, [ref]$desktopRoot, 8, [ref]$desktopHwnd, 1)
} catch {}
if (-not $desktopView) {
  # Explorer's MainWindowHandle is not guaranteed to match the HWND exposed
  # by ShellWindows. Match the out-of-process Shell object by executable path.
  $desktopView = $shellWindows.Windows() |
    Where-Object {
      try { [IO.Path]::GetFileName([string]$_.FullName) -ieq 'explorer.exe' } catch { $false }
    } |
    Select-Object -First 1
}
if (-not $desktopView) { throw '无法取得 Explorer 桌面视图，拒绝以管理员权限继续启动。' }
$shell = $desktopView.Document.Application
$arguments = '--experimental-sqlite ' + (Quote-WindowsArgument $launcher) + ' --desktop-shell-relaunch'
$shell.ShellExecute($node, $arguments, (Split-Path -Parent $launcher), 'open', 0)
