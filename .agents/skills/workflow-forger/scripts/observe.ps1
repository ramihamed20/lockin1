param(
  [Parameter(Mandatory=$true)][string]$Signature,
  [string]$Summary = "",
  [ValidateSet("command","test","workflow","review","build","debug","other")][string]$Kind = "other",
  [bool]$Deterministic = $false,
  [bool]$Stable = $false,
  [bool]$HighCost = $false,
  [string]$AutomationPath = "",
  [string]$Root = "."
)

$ErrorActionPreference = "Stop"
$stateDir = Join-Path $Root ".agents\workflow-forger"
$ledgerPath = Join-Path $stateDir "ledger.json"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (Test-Path $ledgerPath) {
  $ledger = Get-Content $ledgerPath -Raw | ConvertFrom-Json
} else {
  $ledger = [pscustomobject]@{ version = 1; entries = @() }
}

$entries = @($ledger.entries)
$now = (Get-Date).ToUniversalTime().ToString("o")
$entry = $entries | Where-Object { $_.signature -eq $Signature } | Select-Object -First 1

if ($null -eq $entry) {
  $entry = [pscustomobject]@{
    signature=$Signature; kind=$Kind; summary=$Summary; count=1;
    first_seen=$now; last_seen=$now; deterministic=$Deterministic;
    stable=$Stable; high_cost=$HighCost; status="observed";
    automation_path=$AutomationPath
  }
  $entries += $entry
} else {
  $entry.count = [int]$entry.count + 1
  $entry.last_seen = $now
  if ($Summary) { $entry.summary = $Summary }
  $entry.kind = $Kind
  $entry.deterministic = $Deterministic
  $entry.stable = $Stable
  $entry.high_cost = $HighCost
  if ($AutomationPath) { $entry.automation_path = $AutomationPath }

  if (([int]$entry.count -ge 3 -and $Stable) -or
      ([int]$entry.count -ge 2 -and $Stable -and $HighCost)) {
    $entry.status = "ready"
  } elseif ([int]$entry.count -ge 2) {
    $entry.status = "candidate"
  }
}

$ledger.entries = @($entries)
$ledger | ConvertTo-Json -Depth 8 | Set-Content $ledgerPath -Encoding UTF8
$entry | Format-List
