param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "test", "test-fast")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

switch ($Action) {
    "start" {
        docker compose --project-directory $Root up --build
    }
    "stop" {
        docker compose --project-directory $Root down
    }
    "test" {
        if (-not (Test-Path $Python)) {
            throw "Create backend/.venv and install the backend dev dependencies first."
        }
        Push-Location $Backend
        try {
            & $Python -m ruff check .
            & $Python -m ruff format --check .
            & $Python -m mypy .
            & $Python manage.py makemigrations --check --dry-run
            & $Python -m pytest
        } finally {
            Pop-Location
        }
        Push-Location $Frontend
        try {
            npm ci
            npm run lint
            npm run typecheck
            npm run test:coverage
            npm run build
            $Output = Join-Path $Frontend "output\playwright\server"
            New-Item -ItemType Directory -Force -Path $Output | Out-Null
            $Node = (Get-Command node).Source
            $PathKeys = [Environment]::GetEnvironmentVariables().Keys | Where-Object { $_ -ieq "path" }
            if ($PathKeys.Count -gt 1) {
                [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
            }
            $Server = Start-Process -FilePath $Node `
                -ArgumentList @(".\node_modules\vite\bin\vite.js", "preview", "--configLoader", "runner", "--host", "127.0.0.1", "--port", "5173", "--strictPort") `
                -WorkingDirectory $Frontend `
                -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $Output "stdout.log") `
                -RedirectStandardError (Join-Path $Output "stderr.log") `
                -PassThru
            try {
                $Ready = $false
                foreach ($Attempt in 1..30) {
                    try {
                        $Response = Invoke-WebRequest -Uri "http://127.0.0.1:5173/login" -UseBasicParsing -TimeoutSec 2
                        if ($Response.StatusCode -eq 200) {
                            $Ready = $true
                            break
                        }
                    } catch {
                        Start-Sleep -Milliseconds 250
                    }
                }
                if (-not $Ready) {
                    throw "The frontend preview server did not become ready."
                }
                $env:PLAYWRIGHT_EXTERNAL_SERVER = "true"
                & $Node ".\node_modules\@playwright\test\cli.js" test
                if ($LASTEXITCODE -ne 0) {
                    throw "Playwright tests failed."
                }
            } finally {
                Remove-Item Env:PLAYWRIGHT_EXTERNAL_SERVER -ErrorAction SilentlyContinue
                Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
            }
        } finally {
            Pop-Location
        }
    }
    "test-fast" {
        if (-not (Test-Path $Python)) {
            throw "Create backend/.venv and install the backend dev dependencies first."
        }
        $env:LOCKIN_TEST_USE_SQLITE = "true"
        Push-Location $Backend
        try {
            & $Python -m pytest
        } finally {
            Pop-Location
        }
        Push-Location $Frontend
        try {
            npm run test:coverage
        } finally {
            Pop-Location
        }
    }
}
