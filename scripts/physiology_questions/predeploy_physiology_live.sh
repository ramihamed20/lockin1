#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE_ROOT="/home/lockin/lockin1"
COMPOSE_FILE="$LIVE_ROOT/compose.production.yaml"
ENV_FILE="$LIVE_ROOT/.env.production"

BACKUP_DIR="${1:-/home/lockin/production_backups/physiology_predeploy_$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$BACKUP_DIR"

echo "==> [Layer 1/2] Full PostgreSQL logical backup (no writes to production DB)..."
PG_DUMP_FILE="$(sudo bash "$LIVE_ROOT/scripts/production/backup-postgres.sh" "$ENV_FILE" "$BACKUP_DIR")"
echo "    Created dump: $PG_DUMP_FILE"

echo "==> Verifying PostgreSQL dump SHA-256 & restore integrity in isolated container..."
sudo env LOCKIN_VERIFY_STANDALONE=true \
  bash "$LIVE_ROOT/scripts/production/verify-postgres-restore.sh" "$PG_DUMP_FILE" "$ENV_FILE"

echo "==> [Layer 2/2] Collecting read-only Physiology pre-deploy state & JSON rollback snapshot..."
SNAPSHOT_FILE="$BACKUP_DIR/physiology_predeploy_snapshot.json"
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T backend python - < "$SCRIPT_DIR/predeploy_check_and_backup_physiology.py" \
  > "$SNAPSHOT_FILE"
sha256sum "$SNAPSHOT_FILE" > "$SNAPSHOT_FILE.sha256"

echo "==> Pre-deployment backup & read-only check completed cleanly."
ls -lh "$BACKUP_DIR"
