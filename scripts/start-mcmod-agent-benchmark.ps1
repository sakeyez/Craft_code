[CmdletBinding()]
param(
  [string]$Fixture,
  [string]$AgentLabel,
  [string[]]$AgentPatch = @(),
  [string]$Prices,
  [Nullable[double]]$ActualCost,
  [string]$Currency,
  [int]$RuntimeTimeoutMinutes = 10,
  [int]$Runs = 3,
  [string]$OutputPath,
  [switch]$ResetSettings,
  [switch]$SetupOnly,
  [switch]$NoOpenReport
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $PSScriptRoot 'mcmod-agent-benchmark.local.json'

if ($ResetSettings -and (Test-Path -LiteralPath $settingsPath)) {
  Remove-Item -LiteralPath $settingsPath
}

$settings = if (Test-Path -LiteralPath $settingsPath) {
  Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
} else {
  $null
}

if ([string]::IsNullOrWhiteSpace($Fixture) -and $null -ne $settings) {
  $Fixture = [string]$settings.fixture
}
if ([string]::IsNullOrWhiteSpace($Fixture)) {
  $Fixture = Read-Host 'Pristine NeoForge 1.21.1 MDK directory'
}
if ([string]::IsNullOrWhiteSpace($AgentLabel) -and $null -ne $settings) {
  $AgentLabel = [string]$settings.agentLabel
}
if ([string]::IsNullOrWhiteSpace($AgentLabel)) {
  $AgentLabel = Read-Host 'Agent version label (for example deepseek-v4-2026-08-25)'
}
if ($AgentPatch.Count -eq 0 -and $null -ne $settings -and $null -ne $settings.agentPatches) {
  $AgentPatch = @($settings.agentPatches | ForEach-Object { [string]$_ })
}
if ([string]::IsNullOrWhiteSpace($Prices) -and $null -ne $settings -and $null -ne $settings.prices) {
  $Prices = [string]$settings.prices
}
if (-not $PSBoundParameters.ContainsKey('Runs') -and $null -ne $settings -and $null -ne $settings.runs) {
  $Runs = [int]$settings.runs
}

if ([string]::IsNullOrWhiteSpace($Fixture) -or -not (Test-Path -LiteralPath $Fixture -PathType Container)) {
  throw "MDK directory does not exist: $Fixture"
}
if (-not (Test-Path -LiteralPath (Join-Path $Fixture 'gradlew.bat')) -and -not (Test-Path -LiteralPath (Join-Path $Fixture 'gradlew'))) {
  throw "MDK directory has no Gradle wrapper: $Fixture"
}
if ([string]::IsNullOrWhiteSpace($AgentLabel)) {
  throw 'Agent version label must not be empty.'
}
if ($Runs -lt 3) {
  throw 'Runs must be at least 3.'
}
foreach ($patchPath in $AgentPatch) {
  if (-not (Test-Path -LiteralPath $patchPath -PathType Leaf)) {
    throw "Agent patch does not exist: $patchPath"
  }
}
if (-not [string]::IsNullOrWhiteSpace($Prices) -and -not (Test-Path -LiteralPath $Prices -PathType Leaf)) {
  throw "Price table does not exist: $Prices"
}
if ($RuntimeTimeoutMinutes -lt 1) {
  throw 'RuntimeTimeoutMinutes must be at least 1.'
}
if ($null -ne $ActualCost -and ($ActualCost -lt 0)) {
  throw 'ActualCost must be non-negative.'
}

$savedSettings = [ordered]@{
  fixture = (Resolve-Path -LiteralPath $Fixture).Path
  agentLabel = $AgentLabel
  runs = $Runs
  agentPatches = @($AgentPatch)
  prices = if ([string]::IsNullOrWhiteSpace($Prices)) { $null } else { (Resolve-Path -LiteralPath $Prices).Path }
}
$savedSettings | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

Write-Host "Benchmark settings: $settingsPath"
if ($SetupOnly) {
  Write-Host 'Settings validated. The live benchmark was not started.'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss-fff'
  $OutputPath = Join-Path $repoRoot ".artifacts\mcmod-agent-benchmark\$stamp"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
}
$pnpmArguments = @(
  'run', 'benchmark:mcmod-agent', '--',
  '--fixture', $savedSettings.fixture,
  '--runs', [string]$Runs,
  '--agent-label', $AgentLabel,
  '--output', $OutputPath
)
foreach ($patchPath in $savedSettings.agentPatches) {
  $pnpmArguments += @('--agent-patch', [string]$patchPath)
}
if ($null -ne $savedSettings.prices) {
  $pnpmArguments += @('--prices', [string]$savedSettings.prices)
}
if ($null -ne $ActualCost) {
  $pnpmArguments += @('--actual-cost', [string]$ActualCost)
}
if (-not [string]::IsNullOrWhiteSpace($Currency)) {
  $pnpmArguments += @('--currency', $Currency)
}
$pnpmArguments += @('--runtime-timeout-minutes', [string]$RuntimeTimeoutMinutes)

Push-Location $repoRoot
try {
  $dirty = -not [string]::IsNullOrWhiteSpace((& git status --porcelain -- . ':(exclude)vendor/**' | Out-String))
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the harness Git worktree.'
  }
  if ($dirty) {
    $pnpmArguments += '--allow-dirty'
  }
  & pnpm @pnpmArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Benchmark failed with exit code $LASTEXITCODE. Inspect $OutputPath for retained evidence."
  }
} finally {
  Pop-Location
}

$reportPath = Join-Path $OutputPath 'report.md'
Write-Host "Benchmark report: $reportPath"
if ($NoOpenReport) {
  exit 0
}
$codeCommand = Get-Command code -ErrorAction SilentlyContinue
if ($null -ne $codeCommand) {
  & $codeCommand.Source --reuse-window $reportPath
} else {
  Invoke-Item -LiteralPath $reportPath
}
