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
            npm run test
            npm run build
            npm run test:e2e
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
            npm run test
        } finally {
            Pop-Location
        }
    }
}
