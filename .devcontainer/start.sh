#!/usr/bin/env bash
# Start isolated demo services and load a real, disposable student syllabus.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then bash .devcontainer/bootstrap.sh; fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable. Rebuild the Codespace's dev container and retry." >&2
  exit 1
fi
echo "Starting Lockin demo containers (PostgreSQL + Django + React)..."
docker compose up -d --build
echo "Seeding disposable demo accounts and sheets..."
if ! docker compose exec -T backend python manage.py seed_demo >/tmp/lockin-codespace-seed.log 2>&1; then
  tail -n 45 /tmp/lockin-codespace-seed.log >&2
  exit 1
fi
docker compose exec -T backend python manage.py seed_codespace_exam
docker compose ps
name="${CODESPACE_NAME:-}"
if [[ -n "$name" ]]; then
  echo "LOCKIN PREVIEW: https://${name}-5173.app.github.dev/#/study-plan"
else
  echo "LOCKIN PREVIEW: http://localhost:5173/#/study-plan"
fi
echo "PRIVATE DEMO login: student@lockin.local / Student123!"
echo "Preview port 5173 must remain PRIVATE. Never enter production credentials."
