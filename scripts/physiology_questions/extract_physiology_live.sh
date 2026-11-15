#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/inspect_and_export_physiology.py"
DEST_DIR="${1:-/home/lockin/production_pdfs/physiology_year1}"
COMPOSE_FILE="/home/lockin/lockin1/compose.production.yaml"
ENV_FILE="/home/lockin/lockin1/.env.production"

mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"

echo "==> Inspecting live Dentistry Year-1 Physiology settings & extracting verified PDFs..."
echo "    Target directory: $DEST_DIR"

sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T backend python - < "$PY_SCRIPT" \
  | tar -x --no-same-owner -C "$DEST_DIR"

chmod 600 "$DEST_DIR"/* 2>/dev/null || true

echo "==> Extraction complete. Files in $DEST_DIR:"
ls -lh "$DEST_DIR"
