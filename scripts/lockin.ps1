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

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

switch ($Action) {
    "start" {
        Invoke-CheckedCommand { docker compose --project-directory $Root up --build } "Docker Compose start"
    }
    "stop" {
        Invoke-CheckedCommand { docker compose --project-directory $Root down } "Docker Compose stop"
    }
    "test" {
        if (-not (Test-Path $Python)) {
            throw "Create backend/.venv and install the backend dev dependencies first."
        }
        Push-Location $Backend
        try {
            Invoke-CheckedCommand { & $Python -m pip_audit . --strict } "Backend dependency audit"
            Invoke-CheckedCommand { & $Python -m ruff check . } "Backend lint"
            Invoke-CheckedCommand { & $Python -m ruff format --check . } "Backend formatting"
            Invoke-CheckedCommand { & $Python -m mypy . } "Backend type check"
            Invoke-CheckedCommand { & $Python manage.py makemigrations --check --dry-run } "Migration drift check"
            Invoke-CheckedCommand { & $Python -m pytest } "Backend tests"
        } finally {
            Pop-Location
        }
        Push-Location $Frontend
        try {
            Invoke-CheckedCommand { pnpm install --frozen-lockfile } "Frontend install"
            Invoke-CheckedCommand { pnpm audit --prod --audit-level=high } "Frontend dependency audit"
            Invoke-CheckedCommand { pnpm run lint } "Frontend lint"
            Invoke-CheckedCommand { pnpm run typecheck } "Frontend type check"
            Invoke-CheckedCommand { pnpm test } "Frontend tests"
            Invoke-CheckedCommand { pnpm run build } "Frontend build"
            Invoke-CheckedCommand { pnpm run check:bundle } "Frontend bundle budget"
            Invoke-CheckedCommand { pnpm run test:e2e } "Browser tests"
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
            Invoke-CheckedCommand { & $Python -m pytest } "Backend tests"
        } finally {
            Pop-Location
        }
        Push-Location $Frontend
        try {
            Invoke-CheckedCommand { pnpm test } "Frontend tests"
        } finally {
            Pop-Location
        }
    }
}
