#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
backup="${1:?Usage: verify-postgres-restore.sh BACKUP [ENV_FILE]}"
env_file="${2:-$root/.env.production}"
compose_file="$root/compose.production.yaml"

if [ ! -f "$backup" ] || [ ! -s "$backup" ]; then
    echo "Backup is missing or empty: $backup" >&2
    exit 2
fi
if [ ! -f "$env_file" ]; then
    echo "Production environment file not found: $env_file" >&2
    exit 2
fi
if [ -f "$backup.sha256" ]; then
    (cd "$(dirname -- "$backup")" && sha256sum -c "$(basename -- "$backup.sha256")")
fi

verify_database="lockin_restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
compose() {
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
}
drop_database() {
    compose exec -T -e VERIFY_DATABASE="$verify_database" db \
        sh -eu -c 'dropdb --if-exists --force --username "$POSTGRES_USER" "$VERIFY_DATABASE"' \
        > /dev/null 2>&1 || true
}
trap drop_database EXIT INT TERM

compose exec -T -e VERIFY_DATABASE="$verify_database" db \
    sh -eu -c 'createdb --username "$POSTGRES_USER" "$VERIFY_DATABASE"'
compose exec -T -e VERIFY_DATABASE="$verify_database" db \
    sh -eu -c 'pg_restore --exit-on-error --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$VERIFY_DATABASE"' \
    < "$backup"
result="$(compose exec -T -e VERIFY_DATABASE="$verify_database" db \
    sh -eu -c 'psql --username "$POSTGRES_USER" --dbname "$VERIFY_DATABASE" --tuples-only --no-align --command "SELECT COUNT(*) FROM django_migrations"')"

case "$result" in
    ''|*[!0-9]*)
        echo "Restore verification could not read migration history." >&2
        exit 1
        ;;
esac
echo "Restore verified with $result migration records."
