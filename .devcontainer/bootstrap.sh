#!/usr/bin/env bash
# Local Codespaces configuration; no production secrets or data.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  cp .env.example .env
  python3 - <<'PY'
from pathlib import Path
import os
import secrets

path = Path(".env")
content = path.read_text()
name = os.environ.get("CODESPACE_NAME", "").strip()
origin = f"https://{name}-5173.app.github.dev" if name else "http://localhost:5173"
values = {
    "COMPOSE_PROJECT_NAME": "lockin-codespace",
    "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
    "PAYMENT_CODE_ENCRYPTION_KEY": secrets.token_urlsafe(48),
    "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1,backend",
    "DJANGO_CSRF_TRUSTED_ORIGINS": origin,
    "PUBLIC_APP_URL": origin,
    "ACCOUNT_POLICY_VERSION": "demo-v1",
    "STUDY_PLAN_V2_ENABLED": "true",
    "STUDY_PLAN_V2_USER_IDS": "",
}
lines = content.splitlines()
for key, value in values.items():
    prefix = key + "="
    matches = [index for index, line in enumerate(lines) if line.startswith(prefix)]
    if len(matches) != 1:
        raise SystemExit(f"Missing/duplicate .env entry: {key}")
    lines[matches[0]] = prefix + value
path.write_text("\n".join(lines) + "\n")
path.chmod(0o600)
PY
  echo "Created private Codespace-only configuration."
else
  echo "Reusing the Codespace's existing local .env (not overwriting user settings)."
fi
