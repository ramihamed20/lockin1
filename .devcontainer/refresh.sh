#!/usr/bin/env bash
# Refresh the private Codespaces demo without discarding any local edits.
set -euo pipefail
cd "$(dirname "$0")/.."
branch="codex/lockin0.1.5"
current="$(git branch --show-current)"
if [[ "$current" != "$branch" ]]; then
  echo "Wrong branch. Switch to codex/lockin0.1.5 first." >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Local modifications detected. Commit or stash them before updating." >&2
  exit 3
fi
git fetch origin "$branch"
git merge --ff-only "origin/$branch"
bash .devcontainer/start.sh
printf '\nGitHub revision: '
git rev-parse --short HEAD
echo "Open Materials > Intro Histology and open the PDF in Focus Workspace."
echo "The animated study companion has 12 published demo ideas."
