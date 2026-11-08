#!/bin/sh
# Controls only the isolated staging Compose project, never production.
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$root"
[ -f .env.staging ] || { echo "Run sudo python3 scripts/staging/prepare.py first." >&2; exit 2; }
compose() {
    if [ -f .runtime/staging/dev-enabled ]; then
        set -- -f compose.production.yaml -f compose.staging.yaml -f compose.staging-dev.yaml "$@"
    else
        set -- -f compose.production.yaml -f compose.staging.yaml "$@"
    fi
    # A production variable exported in the operator's shell must not win over
    # .env.staging. Keep Docker credentials, clear all Compose/application env.
    env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="${DOCKER_CONFIG:-$HOME/.docker}" \
      docker --context default compose -p lockin-staging --env-file .env.staging \
      "$@"
}
# Validate before any operation which can change a container.
compose config --format json | python3 scripts/staging/validate.py
case "${1:-status}" in
    start)
        [ "$(id -u)" -eq 0 ] || { echo "Run this command with sudo." >&2; exit 2; }
        available=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
        [ "$available" -ge 1800 ] || { echo "Staging needs at least 1800 MiB free; use a separate host or free capacity first." >&2; exit 2; }
        compose config --quiet
        compose pull db mailpit backend release preflight edge
        edge_image=$(compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["edge"]["image"])')
        expected_key=$(sed -n 's/^LOCKIN_OFFLINE_LEASE_PUBLIC_KEY=//p' .env.staging)
        built_key=$(docker --context default image inspect --format '{{index .Config.Labels "io.lockin.staging.offline-public-key"}}' "$edge_image")
        [ "$built_key" = "$expected_key" ] || { echo "The staging build uses a different Offline public key. Rebuild it with this host staging key." >&2; exit 2; }
        compose up -d db mailpit
        compose run --rm -T --interactive=false --no-deps release
        compose run --rm -T --interactive=false --no-deps preflight
        compose up -d --no-deps backend edge
        echo "Staging containers started. Check: sudo sh scripts/staging/control.sh status"
        ;;
    connect)
        backend_id=$(compose ps -q backend)
        [ -n "$backend_id" ] || { echo "Start the staging backend first." >&2; exit 2; }
        health=$(docker --context default inspect --format '{{.State.Health.Status}}' "$backend_id")
        [ "$health" = "healthy" ] || { echo "Wait for the staging backend to become healthy before connecting the tunnel." >&2; exit 2; }
        [ -s .runtime/staging/tunnel_token ] || { echo "Save the Cloudflare Tunnel token locally first; see docs/STAGING_AR.md." >&2; exit 2; }
        compose --profile staging-tunnel pull tunnel
        compose --profile staging-tunnel up -d --no-deps tunnel
        ;;
    preview) python3 scripts/staging/preview.py ;;
    dev) python3 scripts/staging/preview.py --dev ;;
    dev-off)
        if [ -f .runtime/staging/dev-enabled ]; then
            compose stop frontend-dev
            rm .runtime/staging/dev-enabled
            compose up -d --no-deps --pull never --force-recreate edge
        fi
        ;;
    admin) compose exec backend python manage.py createsuperuser ;;
    status) compose --profile staging-tunnel --profile staging-quick ps -a ;;
    stop) compose --profile staging-tunnel --profile staging-quick stop ;;
    logs) compose logs --tail 80 backend edge ;;
    *) echo "Usage: $0 {start|connect|preview|dev|dev-off|admin|status|stop|logs}" >&2; exit 2 ;;
esac
