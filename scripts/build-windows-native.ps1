[CmdletBinding()]
param(
  [string]$OutputPath = '',
  [string]$GoPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$scriptsRoot = $PSScriptRoot
$source = Join-Path $scriptsRoot 'windows-native\main.go'
if (-not $OutputPath) { $OutputPath = Join-Path $scriptsRoot 'WorkDaddyLauncher.exe' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)

if (-not $GoPath) {
  $command = Get-Command go.exe -ErrorAction SilentlyContinue
  if ($command) { $GoPath = $command.Source }
}
if (-not $GoPath) {
  $userToolchain = Join-Path $env:USERPROFILE '.workdaddy-toolchains\go1.27.0\bin\go.exe'
  if (Test-Path -LiteralPath $userToolchain -PathType Leaf) { $GoPath = $userToolchain }
}
if (-not $GoPath -or -not (Test-Path -LiteralPath $GoPath -PathType Leaf)) {
  throw 'Go 1.27+ was not found. Install Go or pass -GoPath.'
}

$versionOutput = & $GoPath version
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch 'go version go(?<major>\d+)\.(?<minor>\d+)') {
  throw 'Unable to read the Go version.'
}
if ([int]$matches.major -lt 1 -or ([int]$matches.major -eq 1 -and [int]$matches.minor -lt 24)) {
  throw "Go version is too old: $versionOutput"
}

$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$env:CGO_ENABLED = '0'
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
& $GoPath build -trimpath -ldflags '-s -w -H=windowsgui' -o $OutputPath $source
if ($LASTEXITCODE -ne 0) { throw "Native launcher build failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf) -or (Get-Item -LiteralPath $OutputPath).Length -le 0) {
  throw "Native launcher output is missing: $OutputPath"
}
Write-Host "Created $OutputPath"
