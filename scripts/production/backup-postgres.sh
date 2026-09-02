#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
env_file="${1:-$root/.env.production}"
output_dir="${2:-$root/backups}"
compose_file="$root/compose.production.yaml"
# A managed database has no db service to exec into. Set this to its owner
# connection URL and the dump runs in a throwaway client container instead.
# The value is passed by name so it never reaches the host process list.
database_url="${LOCKIN_BACKUP_DATABASE_URL:-}"
client_image="${LOCKIN_POSTGRES_IMAGE:-postgres:18.4-alpine}"

if [ ! -f "$env_file" ]; then
    echo "Production environment file not found: $env_file" >&2
    exit 2
fi

# The deployment file is not sourced because it contains Compose syntax and
# secret paths. Read only this numeric, non-secret operator setting.
configured_retention="$(sed -n 's/^[[:space:]]*BACKUP_RETENTION_DAYS=//p' "$env_file" | tail -n 1)"
retention_days="${BACKUP_RETENTION_DAYS:-${configured_retention:-30}}"

umask 077
mkdir -p "$output_dir"
output_dir="$(CDPATH= cd -- "$output_dir" && pwd -P)"
if [ "$output_dir" = "/" ]; then
    echo "Refusing to use the filesystem root as a backup directory." >&2
    exit 2
fi
case "$retention_days" in
    ''|*[!0-9]*)
        echo "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
        exit 2
        ;;
esac
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$output_dir/lockin-$timestamp.dump.partial"
backup="$output_dir/lockin-$timestamp.dump"

cleanup() {
    rm -f "$temporary"
}
trap cleanup EXIT INT TERM

dump_database() {
    if [ -n "$database_url" ]; then
        LOCKIN_DUMP_URL="$database_url" docker run --rm --env LOCKIN_DUMP_URL "$client_image" \
            sh -eu -c 'pg_dump --dbname "$LOCKIN_DUMP_URL" --format=custom --compress=9 --no-owner --no-acl'
    else
        docker compose --env-file "$env_file" -f "$compose_file" exec -T db \
            sh -eu -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-acl'
    fi
}

read_catalog() {
    if [ -n "$database_url" ]; then
        docker run --rm -i "$client_image" pg_restore --list
    else
        docker compose --env-file "$env_file" -f "$compose_file" exec -T db pg_restore --list
    fi
}

dump_database > "$temporary"

test -s "$temporary"
read_catalog < "$temporary" > /dev/null
mv "$temporary" "$backup"
sha256sum "$backup" > "$backup.sha256"
trap - EXIT INT TERM

# Retention runs only after a new dump and its catalog/hash have succeeded. It
# is deliberately confined to completed Lock-in dumps in this exact directory.
if [ "$retention_days" -gt 0 ]; then
    find "$output_dir" -maxdepth 1 -type f -name 'lockin-*.dump' -mtime "+$retention_days" \
        | while IFS= read -r expired_backup; do
            rm -f -- "$expired_backup" "$expired_backup.sha256"
        done
fi

echo "$backup"
