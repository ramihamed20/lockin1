param(
    [ValidateSet("start", "stop")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendRoot = Join-Path $ProjectRoot "backend"
$FrontendRoot = Join-Path $ProjectRoot "frontend"
$PythonPath = Join-Path $BackendRoot ".venv\Scripts\python.exe"
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
$LogRoot = Join-Path $BackendRoot ".local-logs"
$BackendPidFile = Join-Path $LogRoot "local-phone-backend.pid"
$FrontendPidFile = Join-Path $LogRoot "local-phone-frontend.pid"

function Stop-OwnedProcess {
    param([string]$PidFile, [string]$Label)
    if (-not (Test-Path -LiteralPath $PidFile)) {
        Write-Host "$Label is not owned by this launcher."
        return
    }
    $OwnedPid = [int](Get-Content -LiteralPath $PidFile -Raw)
    $Process = Get-Process -Id $OwnedPid -ErrorAction SilentlyContinue
    if ($Process) {
        Stop-Process -Id $OwnedPid -Force
        Write-Host "Stopped $Label."
    }
    Remove-Item -LiteralPath $PidFile -Force
}

function Get-ListeningProcessId {
    param([int]$Port)
    $Match = netstat -ano -p tcp |
        Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" |
        Select-Object -First 1
    if (-not $Match) { return $null }
    return [int]$Match.Matches[0].Groups[1].Value
}

function Wait-ForListeningProcessId {
    param([int]$Port)
    for ($Attempt = 0; $Attempt -lt 20; $Attempt += 1) {
        $ListeningPid = Get-ListeningProcessId -Port $Port
        if ($ListeningPid) { return $ListeningPid }
        Start-Sleep -Milliseconds 250
    }
    throw "The local server did not start on port $Port."
}

if ($Action -eq "stop") {
    Stop-OwnedProcess -PidFile $FrontendPidFile -Label "Vite"
    Stop-OwnedProcess -PidFile $BackendPidFile -Label "Django"
    exit 0
}

if (-not (Test-Path -LiteralPath $PythonPath)) {
    throw "Missing backend Python environment: $PythonPath"
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$env:DJANGO_SETTINGS_MODULE = "config.settings.e2e"
$env:LOCKIN_E2E_DB = ".lockin-demo.sqlite3"

Push-Location $BackendRoot
try {
    & $PythonPath manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) { throw "Django migration failed." }
} finally {
    Pop-Location
}

if (-not (Get-ListeningProcessId -Port 8000)) {
    Start-Process -FilePath $PythonPath -ArgumentList "manage.py runserver 127.0.0.1:8000 --noreload" -WorkingDirectory $BackendRoot -WindowStyle Hidden | Out-Null
    Set-Content -LiteralPath $BackendPidFile -Value (Wait-ForListeningProcessId -Port 8000)
}

if (-not (Get-ListeningProcessId -Port 5050)) {
    Start-Process -FilePath $NodePath -ArgumentList ".\node_modules\vite\bin\vite.js --host 0.0.0.0 --port 5050 --strictPort" -WorkingDirectory $FrontendRoot -WindowStyle Hidden | Out-Null
    Set-Content -LiteralPath $FrontendPidFile -Value (Wait-ForListeningProcessId -Port 5050)
}

Start-Sleep -Seconds 2
$LocalAddress = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
    Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.ToString() -notlike "127.*" -and $_.ToString() -notlike "169.254.*" } |
    Select-Object -First 1 |
    ForEach-Object ToString
if (-not $LocalAddress) { $LocalAddress = "YOUR-COMPUTER-IP" }

Write-Host "Study Plan is ready."
Write-Host "Computer: http://127.0.0.1:5050/#/study-plan"
Write-Host "Phone:    http://${LocalAddress}:5050/#/study-plan"
Write-Host "Stop:     .\scripts\local-phone.ps1 stop"
