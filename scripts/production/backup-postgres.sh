#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
env_file="${1:-$root/.env.production}"
output_dir="${2:-$root/backups}"
compose_file="$root/compose.production.yaml"

if [ ! -f "$env_file" ]; then
    echo "Production environment file not found: $env_file" >&2
    exit 2
fi

umask 077
mkdir -p "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$output_dir/lockin-$timestamp.dump.partial"
backup="$output_dir/lockin-$timestamp.dump"

cleanup() {
    rm -f "$temporary"
}
trap cleanup EXIT INT TERM

docker compose --env-file "$env_file" -f "$compose_file" exec -T db \
    sh -eu -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-acl' \
    > "$temporary"

test -s "$temporary"
docker compose --env-file "$env_file" -f "$compose_file" exec -T db \
    pg_restore --list < "$temporary" > /dev/null
mv "$temporary" "$backup"
sha256sum "$backup" > "$backup.sha256"
trap - EXIT INT TERM

echo "$backup"
