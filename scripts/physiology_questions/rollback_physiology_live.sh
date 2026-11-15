#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path/to/physiology_predeploy_snapshot.json> [--apply]" >&2
  exit 2
fi

SNAPSHOT_FILE="$1"
APPLY_FLAG="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE_ROOT="/home/lockin/lockin1"
COMPOSE_FILE="$LIVE_ROOT/compose.production.yaml"
ENV_FILE="$LIVE_ROOT/.env.production"

if [[ -f "$SNAPSHOT_FILE.sha256" ]]; then
  (cd "$(dirname "$SNAPSHOT_FILE")" && sha256sum -c "$(basename "$SNAPSHOT_FILE.sha256")")
fi

# Stream rollback_physiology_import.py via base64 so stdin remains free for the snapshot JSON.
B64_ROLLBACK="$(base64 -w0 "$SCRIPT_DIR/rollback_physiology_import.py")"

echo "==> Running Physiology sheet-level rollback (mode: ${APPLY_FLAG:---dry-run})..."
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T backend python -c "
import base64, json, os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
import django
django.setup()
ns = {}
exec(base64.b64decode('$B64_ROLLBACK').decode('utf-8'), ns)
envelope = json.load(sys.stdin)
report = ns['rollback_from_snapshot'](envelope, apply=('$APPLY_FLAG' == '--apply'))
print(json.dumps(report, indent=2, ensure_ascii=False))
" < "$SNAPSHOT_FILE"
