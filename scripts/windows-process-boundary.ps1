function ConvertTo-WindowsCommandLineArgs {
  param([Parameter(Mandatory = $true)][string]$CommandLine)
  if ([string]::IsNullOrWhiteSpace($CommandLine) -or
      $CommandLine.IndexOfAny([char[]]@([char]0, [char]10, [char]13)) -ge 0) {
    throw '进程命令行为空或包含非法字符'
  }

  $arguments = [System.Collections.Generic.List[string]]::new()
  $index = 0
  while ($index -lt $CommandLine.Length) {
    while ($index -lt $CommandLine.Length -and [char]::IsWhiteSpace($CommandLine[$index])) { $index++ }
    if ($index -ge $CommandLine.Length) { break }
    $argument = New-Object Text.StringBuilder
    $inQuotes = $false
    $tokenStarted = $false
    while ($index -lt $CommandLine.Length) {
      $character = $CommandLine[$index]
      if (-not $inQuotes -and [char]::IsWhiteSpace($character)) { break }

      if ($character -eq [char]92) {
        $slashStart = $index
        while ($index -lt $CommandLine.Length -and $CommandLine[$index] -eq [char]92) { $index++ }
        $slashCount = $index - $slashStart
        if ($index -lt $CommandLine.Length -and $CommandLine[$index] -eq [char]34) {
          [void]$argument.Append(('\' * [int][Math]::Floor($slashCount / 2)))
          if (($slashCount % 2) -eq 1) {
            [void]$argument.Append([char]34)
          } else {
            $inQuotes = -not $inQuotes
          }
          $index++
        } else {
          [void]$argument.Append(('\' * $slashCount))
        }
        $tokenStarted = $true
        continue
      }

      if ($character -eq [char]34) {
        $inQuotes = -not $inQuotes
        $tokenStarted = $true
        $index++
        continue
      }
      [void]$argument.Append($character)
      $tokenStarted = $true
      $index++
    }
    if ($inQuotes) { throw '进程命令行包含未闭合引号' }
    if (-not $tokenStarted -or $argument.Length -eq 0) { throw '进程命令行包含空参数' }
    $arguments.Add($argument.ToString())
  }
  if ($arguments.Count -eq 0) { throw '进程命令行没有参数' }
  return $arguments.ToArray()
}

function Resolve-StrictWindowsPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [scriptblock]$PathResolver
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
    throw "路径不是绝对路径: $Path"
  }
  $resolved = if ($PathResolver) {
    & $PathResolver $Path
  } else {
    (Resolve-Path -LiteralPath $Path -ErrorAction Stop).ProviderPath
  }
  if ([string]::IsNullOrWhiteSpace([string]$resolved) -or -not [IO.Path]::IsPathRooted([string]$resolved)) {
    throw "无法解析绝对路径: $Path"
  }
  return [IO.Path]::GetFullPath([string]$resolved).TrimEnd('\', '/')
}

function Test-SameWindowsPath {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right,
    [scriptblock]$PathResolver
  )
  try {
    $leftPath = Resolve-StrictWindowsPath -Path $Left -PathResolver $PathResolver
    $rightPath = Resolve-StrictWindowsPath -Path $Right -PathResolver $PathResolver
    return [StringComparer]::OrdinalIgnoreCase.Equals($leftPath, $rightPath)
  } catch {
    return $false
  }
}

function Test-StrictCommandTokenPath {
  param(
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$ExpectedPath,
    [scriptblock]$PathResolver
  )
  if ([string]::IsNullOrEmpty($Token) -or $Token -cne $Token.Trim() -or
      $Token.IndexOfAny([char[]]@([char]0, [char]10, [char]13)) -ge 0) { return $false }
  return Test-SameWindowsPath -Left $Token -Right $ExpectedPath -PathResolver $PathResolver
}

function ConvertTo-WorkDaddyProcessRecord {
  param([Parameter(Mandatory = $true)]$Process)
  $processId = 0
  if (-not [int]::TryParse([string]$Process.ProcessId, [ref]$processId) -or $processId -le 0 -or
      [string]::IsNullOrWhiteSpace([string]$Process.Name) -or
      [string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath) -or
      [string]::IsNullOrWhiteSpace([string]$Process.CommandLine)) { throw 'CIM 进程身份字段不完整' }
  try {
    $ownerResult = Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop
  } catch {
    if (Test-CimProcessDisappearedError $_) { return $null }
    throw
  }
  if ($ownerResult.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace([string]$ownerResult.User)) {
    throw "无法确认 PID $processId 的进程所有者"
  }
  $owner = if ([string]::IsNullOrWhiteSpace([string]$ownerResult.Domain)) {
    [string]$ownerResult.User
  } else { ([string]$ownerResult.Domain + '\' + [string]$ownerResult.User) }
  $arguments = [string[]]@(ConvertTo-WindowsCommandLineArgs -CommandLine ([string]$Process.CommandLine))
  if ($arguments.Count -eq 0 -or @($arguments | Where-Object { $null -eq $_ }).Count -ne 0) {
    throw "PID $processId 的原生 Arguments 无效"
  }
  $currentOwner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  return [pscustomobject]@{
    ProcessId = $processId
    ParentProcessId = [int]$Process.ParentProcessId
    Name = [string]$Process.Name
    ExecutablePath = Resolve-StrictWindowsPath -Path ([string]$Process.ExecutablePath)
    CommandLine = [string]$Process.CommandLine
    ArgumentsSource = 'CommandLineToArgvW'
    Arguments = $arguments
    Owner = $owner
    OwnerIsCurrent = [StringComparer]::OrdinalIgnoreCase.Equals($owner, $currentOwner)
  }
}

function Test-CimProcessDisappearedError {
  param([Parameter(Mandatory = $true)]$ErrorRecord)
  $text = [string]$ErrorRecord.Exception + ' ' + [string]$ErrorRecord
  return $text -match '(?i)(0x80041002|ObjectNotFound|not found|不存在)'
}

function ConvertTo-WorkDaddyProcessRecordIfPresent {
  param([Parameter(Mandatory = $true)]$Process)
  try { return ConvertTo-WorkDaddyProcessRecord -Process $Process }
  catch {
    if (Test-CimProcessDisappearedError $_) { return $null }
    throw
  }
}

function Test-ExactNodeEntryCommandLine {
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$ExpectedScript,
    [string]$ExpectedNode = '',
    [scriptblock]$PathResolver
  )
  try {
    $arguments = @(ConvertTo-WindowsCommandLineArgs -CommandLine $CommandLine)
    if ($arguments.Count -lt 2) { return $false }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedNode) -and
        -not (Test-StrictCommandTokenPath -Token $arguments[0] -ExpectedPath $ExpectedNode -PathResolver $PathResolver)) {
      return $false
    }
    $entryIndex = 1
    if ($arguments[$entryIndex] -ceq '--experimental-sqlite') { $entryIndex++ }
    if ($entryIndex -ge $arguments.Count) { return $false }
    if ($arguments.Count -ne ($entryIndex + 1)) { return $false }
    return Test-StrictCommandTokenPath -Token $arguments[$entryIndex] -ExpectedPath $ExpectedScript -PathResolver $PathResolver
  } catch {
    return $false
  }
}

function Test-ExactCmdLauncherCommandLine {
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$ExpectedLauncher,
    [string]$ExpectedCmd = '',
    [scriptblock]$PathResolver
  )
  try {
    $arguments = @(ConvertTo-WindowsCommandLineArgs -CommandLine $CommandLine)
    if ($arguments.Count -lt 1 -or
        (-not [string]::IsNullOrWhiteSpace($ExpectedCmd) -and
         -not (Test-StrictCommandTokenPath -Token $arguments[0] -ExpectedPath $ExpectedCmd -PathResolver $PathResolver))) {
      return $false
    }
    if ($arguments.Count -eq 5 -and
        $arguments[1] -ieq '/d' -and $arguments[2] -ieq '/c' -and
        $arguments[3] -ieq 'call') {
      return Test-StrictCommandTokenPath -Token $arguments[4] -ExpectedPath $ExpectedLauncher -PathResolver $PathResolver
    }
    if ($arguments.Count -eq 3 -and $arguments[1] -ieq '/c') {
      return Test-StrictCommandTokenPath -Token $arguments[2] -ExpectedPath $ExpectedLauncher -PathResolver $PathResolver
    }
    return $false
  } catch {
    return $false
  }
}

function Get-StrictProcessRecord {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  if ($ProcessId -le 0) { throw "无效 PID: $ProcessId" }
  $rows = @(Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction Stop)
  if ($rows.Count -eq 0) { return $null }
  if ($rows.Count -ne 1) { throw "PID $ProcessId 的 CIM 记录不唯一" }
  $record = ConvertTo-WorkDaddyProcessRecord -Process $rows[0]
  if ($null -eq $record) { return $null }
  if ([int]$record.ProcessId -ne $ProcessId) { throw "PID $ProcessId 的 CIM 记录不匹配" }
  return $record
}

function Assert-SameProcessOwner {
  param([Parameter(Mandatory = $true)]$Process)
  $currentOwner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$Process.Owner, $currentOwner)) {
    throw "PID $($Process.ProcessId) 不属于当前用户"
  }
}

function Assert-NodeProcessIdentity {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][int]$ExpectedPid,
    [Parameter(Mandatory = $true)][string]$ExpectedScript
  )
  if ([int]$Process.ProcessId -ne $ExpectedPid -or [string]$Process.Name -ine 'node.exe') {
    throw "PID $ExpectedPid 不是目标 Node 进程"
  }
  Assert-SameProcessOwner -Process $Process
  $executable = Resolve-StrictWindowsPath -Path ([string]$Process.ExecutablePath)
  if ([IO.Path]::GetFileName($executable) -ine 'node.exe') {
    throw "PID $ExpectedPid 的可执行文件不是 node.exe"
  }
  if (-not (Test-ExactNodeEntryCommandLine -CommandLine ([string]$Process.CommandLine) -ExpectedScript $ExpectedScript -ExpectedNode $executable)) {
    throw "PID $ExpectedPid 的 Node 入口脚本不匹配"
  }
  return $Process
}

function Assert-CmdLauncherIdentity {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedLauncher
  )
  if ([string]$Process.Name -ine 'cmd.exe') { throw "PID $($Process.ProcessId) 不是 cmd.exe" }
  Assert-SameProcessOwner -Process $Process
  $systemCmd = Join-Path ([Environment]::SystemDirectory) 'cmd.exe'
  if (-not (Test-SameWindowsPath -Left ([string]$Process.ExecutablePath) -Right $systemCmd)) {
    throw "PID $($Process.ProcessId) 的 cmd.exe 路径不匹配"
  }
  if (-not (Test-ExactCmdLauncherCommandLine -CommandLine ([string]$Process.CommandLine) -ExpectedLauncher $ExpectedLauncher -ExpectedCmd $systemCmd)) {
    throw "PID $($Process.ProcessId) 的 launcher.cmd 入口不匹配"
  }
  return $Process
}

function Get-UniqueNodeProcessForScript {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedScript,
    [int]$ExpectedParentProcessId = 0
  )
  $matches = @(Get-VerifiedNodeProcessesForScript -ExpectedScript $ExpectedScript -ExpectedParentProcessId $ExpectedParentProcessId)
  if ($matches.Count -gt 1) { throw "目标 Node 入口存在多个进程: $ExpectedScript" }
  if ($matches.Count -eq 0) { return $null }
  return $matches[0]
}

function Get-VerifiedNodeProcessesForScript {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedScript,
    [int]$ExpectedParentProcessId = 0
  )
  $matches = @()
  $scriptName = [IO.Path]::GetFileName($ExpectedScript)
  if ([string]::IsNullOrWhiteSpace($scriptName) -or
      $scriptName.IndexOfAny([char[]]@([char]0, [char]10, [char]13, [char]39)) -ge 0) {
    throw '目标 Node 入口脚本名称无效'
  }
  $scriptName = $scriptName.Replace("'", "''")
  $currentSessionId = [int](Get-Process -Id $PID -ErrorAction Stop).SessionId
  # 先让 CIM 在服务端按可信脚本名筛选，避免同会话中无关的受保护 Node
  # 进程（命令行/路径不可读）阻断当前 profile 的精确身份验证。
  $commandHint = " AND CommandLine LIKE '%$scriptName%'"
  $filter = if ($ExpectedParentProcessId -gt 0) {
    "Name = 'node.exe' AND SessionId = $currentSessionId AND ParentProcessId = $ExpectedParentProcessId$commandHint"
  } else { "Name = 'node.exe' AND SessionId = $currentSessionId$commandHint" }
  $rows = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop)
  foreach ($row in $rows) {
    if ([string]$row.Name -ine 'node.exe' -or
        [string]::IsNullOrWhiteSpace([string]$row.CommandLine)) {
      throw 'Node 进程身份字段不完整，无法证明目标进程不存在'
    }
    if (-not (Test-ExactNodeEntryCommandLine -CommandLine ([string]$row.CommandLine) -ExpectedScript $ExpectedScript)) {
      continue
    }
    $processId = 0
    if (-not [int]::TryParse([string]$row.ProcessId, [ref]$processId) -or $processId -le 0) {
      throw '目标 Node 进程 PID 无效'
    }
    $record = Get-StrictProcessRecord -ProcessId $processId
    if ($null -eq $record) { throw "目标 Node 进程 PID=$processId 在身份验证期间消失" }
    $matches += ,(Assert-NodeProcessIdentity -Process $record -ExpectedPid $processId -ExpectedScript $ExpectedScript)
  }
  return $matches
}

function Get-ListeningProcessIdsFromLines {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Lines
  )
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($line in $Lines) {
    $parts = ([string]$line).Trim() -split '\s+'
    if ($parts.Count -lt 5 -or $parts[3] -notmatch '^LISTENING$') { continue }
    if ($parts[1] -notmatch (':' + [regex]::Escape([string]$Port) + '$')) { continue }
    $parsed = 0
    if (-not [int]::TryParse($parts[$parts.Count - 1], [ref]$parsed) -or $parsed -le 0) {
      throw "端口 $Port 的监听 PID 无效"
    }
    [void]$ids.Add($parsed)
  }
  return @($ids)
}

function Get-UniqueListeningProcessId {
  param([Parameter(Mandatory = $true)][int]$Port)
  $netstat = Join-Path ([Environment]::SystemDirectory) 'netstat.exe'
  $lines = @(& $netstat -ano -p tcp 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "无法查询端口 $Port 的监听进程" }
  $ids = @(Get-ListeningProcessIdsFromLines -Port $Port -Lines $lines)
  if ($ids.Count -gt 1) { throw "端口 $Port 的监听 PID 不唯一" }
  if ($ids.Count -eq 0) { return $null }
  return [int]$ids[0]
}

function Get-AuthenticatedWorkDaddyStatus {
  param(
    [Parameter(Mandatory = $true)][string]$DataDir,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$ExpectedProfile,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [switch]$AllowVersionMismatch
  )
  $tokenFile = Join-Path $DataDir '.api-token'
  if (-not (Test-Path -LiteralPath $tokenFile -PathType Leaf)) {
    throw '当前 profile 缺少本地 API 身份凭证'
  }
  $token = (Get-Content -LiteralPath $tokenFile -Raw -ErrorAction Stop).Trim()
  if ($token -notmatch '^[A-Fa-f0-9]{64}$') { throw '当前 profile 的本地 API 身份凭证无效' }
  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri ("http://127.0.0.1:$Port/api/status") `
      -Headers @{ 'X-WorkDaddy-Token' = $token } `
      -TimeoutSec 3 `
      -ErrorAction Stop
    $status = $response.Content | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw ('无法通过本地身份凭证确认正在运行的 WorkDaddy: ' + $_.Exception.Message)
  }
  $statusPid = 0
  if ($null -eq $status -or $status.ok -ne $true -or
      -not [int]::TryParse([string]$status.pid, [ref]$statusPid) -or $statusPid -le 0) {
    throw '本地 WorkDaddy 状态中的 PID 无效'
  }
  if ([string]$status.profile.id -cne $ExpectedProfile) { throw '本地 WorkDaddy profile 不匹配' }
  if (-not $AllowVersionMismatch -and [string]$status.version -cne $ExpectedVersion) {
    throw '本地 WorkDaddy version 不匹配'
  }
  if ([string]$status.privilege -cne 'elevated') { throw '本地 WorkDaddy 不是管理员权限进程' }
  if ([string]::IsNullOrWhiteSpace([string]$status.dataDir)) {
    throw '本地 WorkDaddy 未接受当前 profile 身份凭证'
  }
  $expectedDataDir = [IO.Path]::GetFullPath($DataDir).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $actualDataDir = [IO.Path]::GetFullPath([string]$status.dataDir).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals($expectedDataDir, $actualDataDir)) {
    throw '本地 WorkDaddy 数据目录不匹配'
  }
  $listenerPid = Get-UniqueListeningProcessId -Port $Port
  if ($null -eq $listenerPid -or $listenerPid -ne $statusPid) {
    throw '本地 WorkDaddy 状态 PID 与监听 PID 不匹配'
  }
  return $status
}

function Stop-VerifiedProcess {
  param([Parameter(Mandatory = $true)]$Process)
  $targetPid = [int]$Process.ProcessId
  $current = Get-StrictProcessRecord -ProcessId $targetPid
  if ($null -eq $current) { return }
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$current.Name, [string]$Process.Name) -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$current.ExecutablePath, [string]$Process.ExecutablePath) -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$current.Owner, [string]$Process.Owner) -or
      -not [StringComparer]::Ordinal.Equals([string]$current.CommandLine, [string]$Process.CommandLine)) {
    throw "PID $targetPid 在终止前发生身份变化"
  }
  $taskkill = Join-Path ([Environment]::SystemDirectory) 'taskkill.exe'
  & $taskkill /F /PID $targetPid 2>$null | Out-Null
  $taskkillFailed = $LASTEXITCODE -ne 0
  $lastReadError = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      if ($null -eq (Get-StrictProcessRecord -ProcessId $targetPid)) { return }
      $lastReadError = $null
    } catch {
      # A terminated process can remain in CIM briefly without path/command-line
      # fields. Retry within the bounded exit window instead of treating that
      # transient record as a new process or as proof of successful exit.
      $lastReadError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 200
  }
  if ($null -ne $lastReadError) {
    throw "无法确认已验证进程 PID=$targetPid 是否退出: $lastReadError"
  }
  if ($taskkillFailed) { throw "taskkill 无法结束已验证进程 PID=$targetPid" }
  throw "已验证进程 PID=$targetPid 未退出"
}

function Stop-VerifiedWorkDaddyLifecycle {
  param(
    [Parameter(Mandatory = $true)][string]$DataDir,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$ExpectedWatchdogScript,
    [Parameter(Mandatory = $true)][string]$ExpectedDaemonScript
  )
  $scriptsDir = Split-Path -Parent $ExpectedDaemonScript
  $expectedLauncherScript = Join-Path $scriptsDir 'win-launcher.js'
  # The launcher itself runs from the packaged Node runtime and can keep
  # runtime\node\node.exe locked while it waits for CDP or a retry window.
  # Stop only exact launcher entries under this profile's installation path.
  $launchers = @(Get-VerifiedNodeProcessesForScript -ExpectedScript $expectedLauncherScript)
  foreach ($launcher in $launchers) { Stop-VerifiedProcess -Process $launcher }

  $pidFile = Join-Path $DataDir 'watchdog.pid'
  $pidFileExists = Test-Path -LiteralPath $pidFile
  $watchdogPid = $null
  $staleWatchdogPidFile = $false
  if ($pidFileExists) {
    $pidText = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction Stop).Trim()
    $parsedWatchdogPid = 0
    if ($pidText -notmatch '^[1-9][0-9]*$' -or
        -not [int]::TryParse($pidText, [ref]$parsedWatchdogPid) -or $parsedWatchdogPid -le 0) {
      throw 'watchdog.pid 内容无效'
    }
    $watchdogPid = $parsedWatchdogPid
  }

  # 有 PID 文件时先验证该精确进程。验证通过后只检查它的直接 daemon
  # 子进程，避免无关或其他会话中不可读取命令行的 Node 阻断当前 profile。
  # PID 文件缺失或 stale 时仍扫描完整 Node 列表，证明没有未跟踪实例。
  $watchdog = $null
  $pidFilePid = $watchdogPid
  if ($pidFileExists) {
    $pidCandidate = $null
    $pidProbeError = $null
    try {
      $pidCandidate = Get-StrictProcessRecord -ProcessId $watchdogPid
    } catch {
      # A stale PID can be reused by an unrelated/protected process whose CIM
      # identity is incomplete. Recover only when a separately enumerated,
      # exact watchdog proves the current profile still owns the lifecycle.
      $pidProbeError = $_
    }
    if ($null -ne $pidCandidate) {
      $watchdog = Assert-NodeProcessIdentity -Process $pidCandidate -ExpectedPid $watchdogPid -ExpectedScript $ExpectedWatchdogScript
    } else {
      $replacementWatchdog = Get-UniqueNodeProcessForScript -ExpectedScript $ExpectedWatchdogScript
      if ($null -ne $replacementWatchdog) {
        $currentPidText = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction Stop).Trim()
        if ($currentPidText -cne [string]$pidFilePid) {
          throw 'watchdog.pid 在修复前发生变化'
        }
        [IO.File]::WriteAllText(
          $pidFile,
          [string]$replacementWatchdog.ProcessId,
          (New-Object Text.UTF8Encoding($false)))
        $watchdogPid = [int]$replacementWatchdog.ProcessId
        $watchdog = $replacementWatchdog
      } elseif ($null -ne $pidProbeError) {
        throw $pidProbeError
      }
      if ($null -ne $watchdog) {
        # The PID file was stale/reused; the exact replacement above is now
        # the only lifecycle candidate and has been persisted atomically enough
        # for the subsequent identity re-checks.
      } elseif ($null -eq $pidCandidate) {
        $staleWatchdogPidFile = $true
      }
    }
  } else {
    $watchdog = Get-UniqueNodeProcessForScript -ExpectedScript $ExpectedWatchdogScript
  }

  # Stop the verified watchdog before taking the daemon/listener snapshot. This
  # prevents its restart loop from changing the listener PID mid-validation.
  if ($null -ne $watchdog) { Stop-VerifiedProcess -Process $watchdog }

  $listenerPid = Get-UniqueListeningProcessId -Port $Port
  $daemon = if ($null -ne $watchdog) {
    Get-UniqueNodeProcessForScript -ExpectedScript $ExpectedDaemonScript -ExpectedParentProcessId ([int]$watchdog.ProcessId)
  } else {
    Get-UniqueNodeProcessForScript -ExpectedScript $ExpectedDaemonScript
  }
  if ($null -ne $listenerPid) {
    $listener = Get-StrictProcessRecord -ProcessId $listenerPid
    if ($null -eq $listener) { throw "端口 $Port 的监听 PID 在验证期间消失" }
    [void](Assert-NodeProcessIdentity -Process $listener -ExpectedPid $listenerPid -ExpectedScript $ExpectedDaemonScript)
    if ($null -eq $daemon -or [int]$daemon.ProcessId -ne $listenerPid) {
      throw "端口 $Port 的监听 PID 与枚举到的精确 daemon 进程不一致"
    }
  }

  # 所有候选先完成身份验证；外来监听进程不会导致任何 WorkDaddy 进程被提前终止。
  if ($null -ne $daemon) {
    $currentListenerPid = Get-UniqueListeningProcessId -Port $Port
    # watchdog 退出后 daemon 可能自行退出并先释放端口；只有被其他 PID
    # 接管才是身份变化。Stop-VerifiedProcess 会再次校验仍存活的 daemon。
    if ($null -ne $currentListenerPid -and $currentListenerPid -ne $listenerPid) {
      throw "端口 $Port 的监听 PID 在终止前发生变化"
    }
    Stop-VerifiedProcess -Process $daemon
  }
  if ($null -ne (Get-UniqueListeningProcessId -Port $Port)) {
    throw "端口 $Port 未释放"
  }
  if ($staleWatchdogPidFile) {
    if (-not (Test-Path -LiteralPath $pidFile)) { return }
    $currentPidText = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction Stop).Trim()
    if ($currentPidText -cne [string]$watchdogPid) {
      throw 'watchdog.pid 在清理前发生变化'
    }
    if ($null -ne (Get-StrictProcessRecord -ProcessId $watchdogPid) -or
        $null -ne (Get-UniqueNodeProcessForScript -ExpectedScript $ExpectedWatchdogScript)) {
      throw 'watchdog.pid 在清理前不再能证明为 stale 状态'
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction Stop
  }
  [void](Wait-VerifiedFileUnlocked -Path (Join-Path $scriptsDir 'runtime\node\node.exe'))
}

function Assert-DaemonStatusIdentity {
  param(
    [Parameter(Mandatory = $true)]$Status,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$ExpectedProfile,
    [Parameter(Mandatory = $true)][ValidateScript({ -not [string]::IsNullOrWhiteSpace($_) })][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedDaemonScript,
    [string]$ExpectedBuildId = ''
  )
  $statusPid = 0
  if ($null -eq $Status -or
      (($Status.pid -isnot [int]) -and ($Status.pid -isnot [long])) -or
      [int64]$Status.pid -le 0 -or [int64]$Status.pid -gt [int]::MaxValue -or
      [string]$Status.privilege -cne 'standard' -or
      [string]$Status.profile.id -cne $ExpectedProfile) {
    throw 'daemon 状态身份字段无效'
  }
  $statusPid = [int]$Status.pid
  if ([string]$Status.version -cne $ExpectedVersion) {
    throw 'daemon version 不匹配'
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedBuildId) -and [string]$Status.buildId -cne $ExpectedBuildId) {
    throw 'daemon buildId 不匹配'
  }
  $listenerPid = Get-UniqueListeningProcessId -Port $Port
  if ($null -eq $listenerPid -or $listenerPid -ne $statusPid) {
    throw 'daemon 状态 PID 与监听 PID 不一致'
  }
  $daemon = Get-StrictProcessRecord -ProcessId $listenerPid
  if ($null -eq $daemon) { throw 'daemon 监听进程在身份验证期间消失' }
  return Assert-NodeProcessIdentity -Process $daemon -ExpectedPid $listenerPid -ExpectedScript $ExpectedDaemonScript
}

function Test-ExclusiveFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  $stream = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    return $true
  } catch {
    return $false
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

function Wait-VerifiedFileUnlocked {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $true }
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-ExclusiveFile -Path $Path) { return $true }
    Start-Sleep -Milliseconds 200
  }
  throw "文件锁未释放: $Path"
}

function Release-VerifiedLauncherLock {
  param([Parameter(Mandatory = $true)][string]$LauncherPath)
  if (Test-ExclusiveFile -Path $LauncherPath) { return $true }
  $matches = @()
  $systemCmd = Join-Path ([Environment]::SystemDirectory) 'cmd.exe'
  $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction Stop)
  foreach ($row in $rows) {
    if ([string]::IsNullOrWhiteSpace([string]$row.CommandLine)) {
      throw '存在无法验证命令行的 cmd.exe，拒绝释放 launcher 锁'
    }
    if (Test-ExactCmdLauncherCommandLine -CommandLine ([string]$row.CommandLine) -ExpectedLauncher $LauncherPath -ExpectedCmd $systemCmd) {
      $record = Get-StrictProcessRecord -ProcessId ([int]$row.ProcessId)
      if ($null -eq $record) { throw 'launcher cmd.exe 在身份验证期间消失' }
      $matches += ,(Assert-CmdLauncherIdentity -Process $record -ExpectedLauncher $LauncherPath)
    }
  }
  if ($matches.Count -eq 0) { throw '无法验证 launcher.cmd 文件锁的持有进程' }
  # Multiple clicks can leave several identical launcher.cmd instances alive
  # while an earlier hidden launch is waiting. Every member has already passed
  # exact command-line and current-owner checks, so release each verified lock.
  foreach ($match in $matches) {
    Stop-VerifiedProcess -Process $match
  }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-ExclusiveFile -Path $LauncherPath) { return $true }
    Start-Sleep -Milliseconds 200
  }
  throw "launcher.cmd 文件锁未释放: $LauncherPath"
}

function Stop-VerifiedWorkBuddyProcesses {
  param([Parameter(Mandatory = $true)][string]$ProcessName)
  if ($ProcessName -notmatch '^(?i:WorkBuddy|WorkBuddyAI)\.exe$') {
    throw "不允许的 WorkBuddy profile 进程名: $ProcessName"
  }
  $rows = @(Get-CimInstance Win32_Process -Filter ("Name = '{0}'" -f $ProcessName) -ErrorAction Stop)
  $records = @()
  foreach ($row in $rows) {
    $record = Get-StrictProcessRecord -ProcessId ([int]$row.ProcessId)
    if ($null -eq $record) { throw "WorkBuddy PID=$($row.ProcessId) 在身份验证期间消失" }
    if ([string]$record.Name -ine $ProcessName) { throw "WorkBuddy PID=$($record.ProcessId) 镜像名不匹配" }
    Assert-SameProcessOwner -Process $record
    $records += ,$record
  }
  if ($records.Count -eq 0) { return 0 }
  $paths = @($records | ForEach-Object { (Resolve-StrictWindowsPath -Path ([string]$_.ExecutablePath)).ToLowerInvariant() } | Sort-Object -Unique)
  if ($paths.Count -ne 1) {
    throw "检测到当前 profile 的多个 WorkBuddy 安装正在运行，拒绝自动停止"
  }
  foreach ($record in $records) {
    Stop-VerifiedProcess -Process $record
  }
  return $records.Count
}
