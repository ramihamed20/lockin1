#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path/to/physiology_predeploy_snapshot.json> [post_import_manifest.json] [--apply]" >&2
  exit 2
fi

SNAPSHOT_FILE="$1"
shift
POST_MANIFEST_FILE=""
APPLY_FLAG=""
for arg in "$@"; do
  if [[ "$arg" == "--apply" ]]; then
    APPLY_FLAG="--apply"
  elif [[ -z "$POST_MANIFEST_FILE" ]]; then
    POST_MANIFEST_FILE="$arg"
  else
    echo "Unexpected argument: $arg" >&2
    exit 2
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE_ROOT="/home/lockin/lockin1"
COMPOSE_FILE="$LIVE_ROOT/compose.production.yaml"
ENV_FILE="$LIVE_ROOT/.env.production"

if [[ -f "$SNAPSHOT_FILE.sha256" ]]; then
  (cd "$(dirname "$SNAPSHOT_FILE")" && sha256sum -c "$(basename "$SNAPSHOT_FILE.sha256")")
fi
if [[ -n "$POST_MANIFEST_FILE" && -f "$POST_MANIFEST_FILE.sha256" ]]; then
  (cd "$(dirname "$POST_MANIFEST_FILE")" && sha256sum -c "$(basename "$POST_MANIFEST_FILE.sha256")")
fi

# Stream rollback_physiology_import.py via base64 and feed snapshot/manifest bundle via stdin.
B64_ROLLBACK="$(base64 -w0 "$SCRIPT_DIR/rollback_physiology_import.py")"

echo "==> Running Physiology sheet-level rollback (mode: ${APPLY_FLAG:---dry-run})..."
python3 - "$SNAPSHOT_FILE" "$POST_MANIFEST_FILE" <<'PY' | sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T backend python -c "
import base64, json, os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
import django
django.setup()
ns = {}
exec(base64.b64decode('$B64_ROLLBACK').decode('utf-8'), ns)
bundle = json.load(sys.stdin)
report = ns['rollback_from_snapshot'](
    bundle['snapshot_envelope'],
    apply=('$APPLY_FLAG' == '--apply'),
    post_import_manifest=bundle['post_import_manifest'],
)
print(json.dumps(report, indent=2, ensure_ascii=False))
"
import json, sys
from pathlib import Path
snap = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
manifest = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')) if sys.argv[2] else None
print(json.dumps({'snapshot_envelope': snap, 'post_import_manifest': manifest}))
PY
