#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
backup="${1:?Usage: verify-postgres-restore.sh BACKUP [ENV_FILE]}"
env_file="${2:-$root/.env.production}"
compose_file="$root/compose.production.yaml"
client_image="${LOCKIN_POSTGRES_IMAGE:-postgres:18.4-alpine}"
# A managed database has no db service to restore into, and creating a scratch
# database on the production instance is not acceptable. Standalone mode
# restores into a disposable local container instead, which also proves the
# dump is portable to a different PostgreSQL server.
standalone="${LOCKIN_VERIFY_STANDALONE:-${LOCKIN_BACKUP_DATABASE_URL:+true}}"

if [ ! -f "$backup" ] || [ ! -s "$backup" ]; then
    echo "Backup is missing or empty: $backup" >&2
    exit 2
fi
if [ "$standalone" != "true" ] && [ ! -f "$env_file" ]; then
    echo "Production environment file not found: $env_file" >&2
    exit 2
fi
if [ -f "$backup.sha256" ]; then
    (cd "$(dirname -- "$backup")" && sha256sum -c "$(basename -- "$backup.sha256")")
fi

if [ "$standalone" = "true" ]; then
    container="lockin-restore-verify-$$"
    # The container is unpublished and lives for seconds, so trust
    # authentication avoids inventing a credential that would have to be
    # handled safely for no benefit.
    docker run --rm --detach --name "$container" \
        --env POSTGRES_HOST_AUTH_METHOD=trust \
        --env POSTGRES_DB=lockin_restore_verify \
        "$client_image" > /dev/null
    # shellcheck disable=SC2064 - the container name is fixed at trap time.
    trap "docker rm --force '$container' > /dev/null 2>&1 || true" EXIT INT TERM

    attempts=0
    until docker exec "$container" \
        pg_isready --username postgres --dbname lockin_restore_verify > /dev/null 2>&1; do
        attempts=$((attempts + 1))
        if [ "$attempts" -ge 60 ]; then
            echo "The verification database did not become ready." >&2
            exit 1
        fi
        sleep 1
    done

    docker exec -i "$container" \
        pg_restore --exit-on-error --no-owner --no-acl \
        --username postgres --dbname lockin_restore_verify < "$backup"
    result="$(docker exec "$container" \
        psql --username postgres --dbname lockin_restore_verify --tuples-only --no-align \
        --command 'SELECT COUNT(*) FROM django_migrations')"
else
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
fi

case "$result" in
    ''|*[!0-9]*)
        echo "Restore verification could not read migration history." >&2
        exit 1
        ;;
esac
echo "Restore verified with $result migration records."
