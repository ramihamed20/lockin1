param([string]$Root=".", [switch]$ReadyOnly)

$path = Join-Path $Root ".agents\workflow-forger\ledger.json"
if (-not (Test-Path $path)) {
  Write-Host "No workflow-forger ledger exists yet."
  exit 0
}

$ledger = Get-Content $path -Raw | ConvertFrom-Json
$entries = @($ledger.entries)
if ($ReadyOnly) { $entries = @($entries | Where-Object { $_.status -eq "ready" }) }

$entries |
  Sort-Object @{Expression="count";Descending=$true}, @{Expression="last_seen";Descending=$true} |
  Select-Object status,count,kind,stable,high_cost,signature,summary,automation_path |
  Format-Table -AutoSize
