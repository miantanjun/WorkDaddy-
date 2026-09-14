# WorkDaddy Windows 移植 - 环境探测脚本
# 用途：在安装了 WorkBuddy Windows 版的电脑上采集移植所需全部信息，
#       输出日志到桌面 WorkDaddy-Windows-Probe.log
# 兼容：Windows PowerShell 5.1+（Win10/11 自带），无需管理员权限
# 原则：任何一条探测失败都只记 FAIL，绝不中断脚本

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$desktop = [Environment]::GetFolderPath('Desktop')
$logFile = Join-Path $desktop 'WorkDaddy-Windows-Probe.log'

$sb = New-Object System.Text.StringBuilder
function Log([string]$s) { [void]$sb.AppendLine($s); Write-Host $s }
function Section([string]$t) { Log ''; Log ('=' * 64); Log ('== ' + $t); Log ('=' * 64) }
function Probe([string]$label, [scriptblock]$action) {
  try {
    $out = (& $action | Out-String).Trim()
    if ($out) { Log ('[OK]   ' + $label + ' => ' + $out) }
    else      { Log ('[OK]   ' + $label + ' (空)') }
  } catch {
    Log ('[FAIL] ' + $label + ' : ' + $_.Exception.Message)
  }
}
function Test-Port([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400, $false)
    $result = $false
    if ($ok) { $result = $c.Connected }
    $c.Close()
    if ($result) { return 'OPEN' } else { return 'closed' }
  } catch {
    return 'error(' + $_.Exception.Message + ')'
  }
}

Log '=============================================================='
Log 'WorkDaddy Windows 移植 - 环境探测'
Log '=============================================================='
Log ('时间  : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Log ('用户  : ' + $env:USERNAME)
Log ('桌面  : ' + $desktop)

Section '1. 系统信息'
Probe 'OS 版本' {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($os) { $os.Caption + ' | Version ' + $os.Version + ' | ' + $os.OSArchitecture } else { '未知' }
}
Probe '处理器架构' { $env:PROCESSOR_ARCHITECTURE }
Probe 'PowerShell 版本' { $PSVersionTable.PSVersion.ToString() }
Probe '管理员权限' { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
Probe '系统语言' { try { (Get-WinSystemLocale).Name } catch { 'unknown' } }

Section '2. Node.js 可用性'
Probe 'node 命令' {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) {
    $v = (& node -v 2>$null)
    $c.Source + ' v' + $v
  } else { 'NOT_FOUND (PATH 中无 node)' }
}
Probe '常见 node 安装位置' {
  $cands = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:APPDATA\npm\node.exe",
    "$env:USERPROFILE\.workbuddy\binaries\node\versions\*\node.exe"
  )
  foreach ($c in $cands) {
    $hit = Get-Item $c -ErrorAction SilentlyContinue
    if ($hit) { ('{0} => 存在' -f $hit.FullName) } else { ('{0} => 不存在' -f $c) }
  }
}

Section '3. WorkBuddy 进程'
Probe '运行中的相关进程' {
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'WorkBuddy|CodeBuddy|Electron|crashpad' } |
    Select-Object ProcessName, Id, Path | Format-Table -AutoSize | Out-String
  if ($procs.Trim()) { $procs.Trim() } else { '无相关进程在运行' }
}

Section '4. WorkBuddy 安装位置'
Probe '卸载注册表项(DisplayName 匹配)' {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $items = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'WorkBuddy|CodeBuddy' } |
    Select-Object DisplayName, DisplayVersion, InstallLocation, DisplayIcon |
    Format-List | Out-String
  if ($items.Trim()) { $items.Trim() } else { '注册表中未找到' }
}
Probe '常见 exe 候选路径' {
  $cands = @(
    "$env:LOCALAPPDATA\Programs\WorkBuddy\WorkBuddy.exe",
    "$env:LOCALAPPDATA\Programs\WorkBuddy\CodeBuddy.exe",
    "$env:ProgramFiles\WorkBuddy\WorkBuddy.exe",
    "${env:ProgramFiles(x86)}\WorkBuddy\WorkBuddy.exe",
    "$env:LOCALAPPDATA\WorkBuddy\WorkBuddy.exe",
    "$env:APPDATA\WorkBuddy\WorkBuddy.exe",
    "$env:LOCALAPPDATA\CodeBuddy\CodeBuddy.exe",
    "$env:LOCALAPPDATA\Programs\CodeBuddy\CodeBuddy.exe",
    "$env:LOCALAPPDATA\Programs\CodeBuddy\WorkBuddy.exe"
  )
  foreach ($c in $cands) {
    if (Test-Path $c) {
      $vi = (Get-Item $c -ErrorAction SilentlyContinue).VersionInfo
      ('{0}  [存在] FileVersion={1} ProductVersion={2}' -f $c, $vi.FileVersion, $vi.ProductVersion)
    } else {
      ('{0}  [不存在]' -f $c)
    }
  }
}
Probe 'LOCALAPPDATA\Programs 下的应用目录' {
  $dir = "$env:LOCALAPPDATA\Programs"
  if (Test-Path $dir) {
    $names = Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
    if ($names) { ($names -join ', ') } else { '空' }
  } else { '目录不存在' }
}

Section '5. auth 登录文件 (移植关键, 必须确认真实路径)'
Probe 'APPDATA 下相关目录' {
  $d = Get-ChildItem $env:APPDATA -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'CodeBuddy|WorkBuddy|WBWork' } | Select-Object -ExpandProperty FullName
  if ($d) { ($d -join "`n") } else { '无' }
}
Probe 'LOCALAPPDATA 下相关目录' {
  $d = Get-ChildItem $env:LOCALAPPDATA -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'CodeBuddy|WorkBuddy|WBWork' } | Select-Object -ExpandProperty FullName
  if ($d) { ($d -join "`n") } else { '无' }
}
Probe '候选 auth 文件存在性' {
  $cands = @(
    "$env:APPDATA\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info",
    "$env:APPDATA\CodeBuddyExtension\Data\auth\workbuddy-desktop.info",
    "$env:APPDATA\CodeBuddy\Data\Public\auth\workbuddy-desktop.info",
    "$env:LOCALAPPDATA\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info",
    "$env:USERPROFILE\.workbuddy\auth\workbuddy-desktop.info",
    "$env:USERPROFILE\.codebuddy\auth\workbuddy-desktop.info"
  )
  foreach ($c in $cands) { ('{0} => {1}' -f $c, (Test-Path $c)) }
}
Probe '递归搜索 workbuddy-desktop.info (APPDATA + LOCALAPPDATA, 深度12)' {
  $found = @()
  foreach ($r in @($env:APPDATA, $env:LOCALAPPDATA)) {
    if (Test-Path $r) {
      $found += Get-ChildItem $r -Recurse -Depth 12 -Filter 'workbuddy-desktop.info' -File -Force -ErrorAction SilentlyContinue |
        Select-Object -First 5 -ExpandProperty FullName
    }
  }
  if ($found.Count) { ($found -join "`n") } else { '未找到 (可能尚未登录过, 或路径不同)' }
}
Probe '递归搜索其他可能 auth 文件 (目录内找 *.info)' {
  $found = @()
  foreach ($r in @($env:APPDATA, $env:LOCALAPPDATA)) {
    if (Test-Path $r) {
      $found += Get-ChildItem $r -Recurse -Depth 8 -Filter '*.info' -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '^\$' } | Select-Object -First 10 -ExpandProperty FullName
    }
  }
  if ($found.Count) { ($found -join "`n") } else { '无 *.info 文件' }
}
Probe 'CodeBuddyExtension 目录树结构(若存在)' {
  $p = "$env:APPDATA\CodeBuddyExtension"
  $alt = "$env:LOCALAPPDATA\CodeBuddyExtension"
  $root = $null
  if (Test-Path "$p\Data") { $root = $p } elseif (Test-Path "$alt\Data") { $root = $alt }
  if ($root) {
    Get-ChildItem $root -Recurse -Depth 5 -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'auth|Public|Data' } | Select-Object -First 20 -ExpandProperty FullName
  } else { 'CodeBuddyExtension 目录不存在' }
}

Section '6. ~/.workbuddy 数据目录 (会话/设置)'
Probe '.workbuddy 目录' { ('{0} => {1}' -f "$env:USERPROFILE\.workbuddy", (Test-Path "$env:USERPROFILE\.workbuddy")) }
Probe '.workbuddy 顶层内容' {
  $p = "$env:USERPROFILE\.workbuddy"
  if (Test-Path $p) {
    $rows = Get-ChildItem $p -Force -ErrorAction SilentlyContinue | Select-Object Name, Length
    ($rows | Format-Table -AutoSize | Out-String).Trim()
  } else { '无' }
}
Probe 'workbuddy.db (会话库)' {
  $f = "$env:USERPROFILE\.workbuddy\workbuddy.db"
  if (Test-Path $f) { ('{0}  大小={1} bytes' -f $f, (Get-Item $f).Length) } else { '不存在' }
}
Probe '关键配置文件存在性' {
  $base = "$env:USERPROFILE\.workbuddy"
  @('settings.json','MEMORY.md','SOUL.md','USER.md','IDENTITY.md','mcp.json','skills','memory','binaries','automations') | ForEach-Object {
    ('  {0,-14} => {1}' -f $_, (Test-Path (Join-Path $base $_)))
  }
}

Section '7. CDP 调试端口现状'
Probe 'TCP 9222' { Test-Port 9222 }
Probe 'TCP 9223' { Test-Port 9223 }
Probe 'TCP 9333' { Test-Port 9333 }
Probe 'TCP 47832 (若已装 WorkDaddy)' { Test-Port 47832 }
Probe '9222 端点版本信息' {
  if ((Test-Port 9222) -eq 'OPEN') {
    try {
      $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:9222/json/version')
      $req.Timeout = 3000
      $resp = $req.GetResponse()
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $txt = $reader.ReadToEnd()
      $reader.Close()
      $resp.Close()
      $txt
    } catch { 'HTTP 请求失败: ' + $_.Exception.Message }
  } else { '端口未开 (正常, WorkBuddy 需以 --remote-debugging-port 启动)' }
}

Section '8. 其他环境'
Probe 'LOCALAPPDATA 可写性' {
  $t = Join-Path $env:LOCALAPPDATA ('wbd-probe-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try { [IO.File]::WriteAllText($t, 'x'); Remove-Item $t -Force -ErrorAction SilentlyContinue; '可写 OK' }
  catch { 'FAIL: ' + $_.Exception.Message }
}
Probe '用户主目录相关目录' {
  $d = Get-ChildItem $env:USERPROFILE -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'workbuddy|codebuddy|WorkBuddy|CodeBuddy' } | Select-Object -ExpandProperty Name
  if ($d) { ($d -join ', ') } else { '无' }
}
Probe '打开目录/文件命令可用性' {
  $expl = Get-Command explorer.exe -ErrorAction SilentlyContinue
  $rundll = Get-Command rundll32.exe -ErrorAction SilentlyContinue
  $sch = Get-Command schtasks.exe -ErrorAction SilentlyContinue
  $task = Get-Command taskkill.exe -ErrorAction SilentlyContinue
  ('explorer={0} rundll32={1} schtasks={2} taskkill={3}' -f
    ($(if ($expl) { 'yes' } else { 'no' })),
    ($(if ($rundll) { 'yes' } else { 'no' })),
    ($(if ($sch) { 'yes' } else { 'no' })),
    ($(if ($task) { 'yes' } else { 'no' })))
}
Probe 'Windows Defender 实时保护' {
  try { (Get-MpComputerStatus -ErrorAction Stop).RealTimeProtectionEnabled }
  catch { '查询失败(可忽略)' }
}

Log ''
Log ('==============================================================')
Log ('探测完成。日志文件: ' + $logFile)
Log ('==============================================================')

try {
  $utf8bom = New-Object System.Text.UTF8Encoding($true)
  [IO.File]::WriteAllText($logFile, $sb.ToString(), $utf8bom)
} catch {
  Write-Host ('写日志文件失败: ' + $_.Exception.Message)
}