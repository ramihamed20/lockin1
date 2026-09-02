#!/bin/sh
# Prove the production image actually runs, not just that it builds.
#
# A green unit-test suite says nothing about whether the container starts, drops
# privileges, passes preflight, or serves a request. This brings up PostgreSQL,
# an S3-compatible object store and the image itself on a private Docker
# network, then asserts each of those in turn. It is the gate that makes
# "production-ready" mean something.
#
# Usage: scripts/ci/docker-smoke.sh [IMAGE]
set -eu

image="${1:-${LOCKIN_SMOKE_IMAGE:-lockin-app:ci}}"
network="lockin-smoke-$$"
db_container="lockin-smoke-db-$$"
storage_container="lockin-smoke-storage-$$"
app_container="lockin-smoke-app-$$"
published_port="${LOCKIN_SMOKE_PORT:-18080}"
public_host="lockin.example.test"
bucket="lockin-media"

postgres_image="${LOCKIN_POSTGRES_IMAGE:-postgres:18.4-alpine}"
storage_image="${LOCKIN_STORAGE_IMAGE:-minio/minio:RELEASE.2025-04-22T22-12-26Z}"
storage_client_image="${LOCKIN_STORAGE_CLIENT_IMAGE:-minio/mc:RELEASE.2025-04-16T18-13-26Z}"

# Test-only values. Every one is thrown away with the network at the end.
owner_password="smoke-owner-password"
runtime_password="smoke-runtime-password"
storage_key="smokeaccesskey"
storage_secret="smokesecretkey"

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
failures=0

log() { printf '\n=== %s\n' "$1"; }
pass() { printf 'ok   %s\n' "$1"; }
fail() {
    printf 'FAIL %s\n' "$1" >&2
    failures=$((failures + 1))
}

cleanup() {
    status=$?
    if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
        log "application logs"
        docker logs "$app_container" 2>&1 | tail -n 60 || true
    fi
    docker rm --force "$app_container" "$storage_container" "$db_container" > /dev/null 2>&1 || true
    docker network rm "$network" > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

await() {
    description="$1"
    attempts="$2"
    shift 2
    count=0
    until "$@" > /dev/null 2>&1; do
        count=$((count + 1))
        if [ "$count" -ge "$attempts" ]; then
            fail "$description did not become ready"
            return 1
        fi
        sleep 2
    done
    return 0
}

request() {
    # The edge forwards the client's X-Forwarded-Proto, and production redirects
    # plain HTTP. Send the header the platform would set, and the Host the
    # deployment allows, so this exercises the real proxy contract.
    curl --silent --show-error --max-time 15 \
        --header "Host: $public_host" \
        --header "X-Forwarded-Proto: https" \
        "$@"
}

docker network create "$network" > /dev/null

log "starting PostgreSQL"
docker run --detach --name "$db_container" --network "$network" --network-alias db \
    --env POSTGRES_DB=lockin \
    --env POSTGRES_USER=lockin_owner \
    --env POSTGRES_PASSWORD="$owner_password" \
    --volume "$root/deploy/postgres/create-runtime-role.sql:/tmp/create-runtime-role.sql:ro" \
    "$postgres_image" > /dev/null
await "PostgreSQL" 30 docker exec "$db_container" pg_isready --username lockin_owner --dbname lockin

# This also exercises the managed-provider role bootstrap that Phase 1 depends on.
log "creating the least-privilege runtime role"
docker exec --env PGPASSWORD="$owner_password" "$db_container" \
    psql --username lockin_owner --dbname lockin --set ON_ERROR_STOP=1 \
    --set runtime_role=lockin_app --set runtime_password="$runtime_password" \
    --file /tmp/create-runtime-role.sql > /dev/null
pass "runtime role created"

log "starting S3-compatible object storage"
docker run --detach --name "$storage_container" --network "$network" --network-alias storage \
    --env MINIO_ROOT_USER="$storage_key" \
    --env MINIO_ROOT_PASSWORD="$storage_secret" \
    "$storage_image" server /data > /dev/null
await "object storage" 30 docker run --rm --network "$network" --entrypoint sh \
    "$storage_client_image" -c "mc alias set smoke http://storage:9000 $storage_key $storage_secret"
docker run --rm --network "$network" --entrypoint sh "$storage_client_image" -c \
    "mc alias set smoke http://storage:9000 $storage_key $storage_secret && mc mb --ignore-existing smoke/$bucket" \
    > /dev/null
pass "bucket created"

log "starting the application image"
docker run --detach --name "$app_container" --network "$network" \
    --publish "127.0.0.1:$published_port:10000" \
    --env DJANGO_SETTINGS_MODULE=config.settings.production \
    --env "DJANGO_SECRET_KEY=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
    --env "DJANGO_ALLOWED_HOSTS=$public_host" \
    --env "PUBLIC_APP_URL=https://$public_host" \
    --env "DJANGO_CSRF_TRUSTED_ORIGINS=https://$public_host" \
    --env ACCOUNT_POLICY_VERSION=smoke-policy-v1 \
    --env DJANGO_TRUST_PROXY_SSL_HEADER=true \
    --env DJANGO_TRUSTED_PROXY_CIDRS=127.0.0.1/32 \
    --env "DATABASE_URL=postgresql://lockin_app:$runtime_password@db:5432/lockin?sslmode=disable" \
    --env POSTGRES_TRUSTED_PRIVATE_NETWORK=true \
    --env POSTGRES_OWNER_USER=lockin_owner \
    --env POSTGRES_OWNER_PASSWORD="$owner_password" \
    --env POSTGRES_RUNTIME_ROLE=lockin_app \
    --env STORAGE_BACKEND=s3 \
    --env "STORAGE_BUCKET_NAME=$bucket" \
    --env STORAGE_ENDPOINT_URL=http://storage:9000 \
    --env STORAGE_ALLOW_INSECURE_ENDPOINT=true \
    --env STORAGE_ADDRESSING_STYLE=path \
    --env STORAGE_REGION=auto \
    --env "STORAGE_ACCESS_KEY_ID=$storage_key" \
    --env "STORAGE_SECRET_ACCESS_KEY=$storage_secret" \
    --env FILE_SCAN_HOST=clamav.invalid \
    --env DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend \
    --env "DEFAULT_FROM_EMAIL=Lock-in <no-reply@$public_host>" \
    --env EMAIL_HOST=smtp.example.test \
    --env EMAIL_HOST_USER=lockin-smoke \
    --env EMAIL_HOST_PASSWORD=smoke-smtp-password \
    --env "PAYMENT_CODE_ENCRYPTION_KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
    --env OBSERVABILITY_STATSD_HOST=statsd.invalid \
    --env OBSERVABILITY_ERROR_WEBHOOK_URL=https://monitoring.example.test/v1/errors \
    --env "OBSERVABILITY_ERROR_WEBHOOK_TOKEN=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
    "$image" > /dev/null

# The entry point runs release then preflight before binding, so readiness here
# means the whole production start-up contract completed.
await "the application" 60 curl --silent --fail --max-time 5 "http://127.0.0.1:$published_port/healthz"

log "assertions"

if docker logs "$app_container" 2>&1 | grep -q 'Production release step completed'; then
    pass "release step completed as the owning role"
else
    fail "release step did not complete"
fi

if docker logs "$app_container" 2>&1 | grep -q '"status": "ready"'; then
    pass "production preflight passed and emitted evidence"
else
    fail "production preflight evidence missing"
fi

container_uid="$(docker exec "$app_container" id -u | tr -d '\r')"
if [ "$container_uid" = "10001" ]; then
    pass "container runs as the unprivileged lockin user"
else
    fail "container runs as uid $container_uid, expected 10001"
fi

# python:slim carries no ps, so read the owner of the nginx master from /proc.
nginx_uid="$(docker exec "$app_container" sh -c \
    'awk "/^Uid:/ {print \$2}" /proc/$(cat /tmp/nginx.pid)/status' 2>/dev/null | tr -d '\r')"
if [ "$nginx_uid" = "10001" ]; then
    pass "nginx master runs unprivileged"
else
    fail "nginx master runs as uid '${nginx_uid:-missing}', expected 10001"
fi

if docker logs "$app_container" 2>&1 | grep -q 'starting gunicorn'; then
    pass "gunicorn started"
else
    fail "gunicorn did not start"
fi

if request --fail --output /dev/null "http://127.0.0.1:$published_port/healthz"; then
    pass "edge liveness endpoint serves"
else
    fail "edge liveness endpoint did not serve"
fi

# Reaching this through nginx proves the whole chain: edge, Gunicorn, Django,
# and a real query against the runtime database role.
readiness="$(request "http://127.0.0.1:$published_port/api/v1/health/ready" || true)"
case "$readiness" in
    *'"status": "ready"'*|*'"status":"ready"'*)
        pass "API readiness serves through nginx and the runtime database role"
        ;;
    *)
        fail "API readiness did not report ready: ${readiness:-no response}"
        ;;
esac

# Regression guard: managed files must never be reachable as static content.
media_type="$(request --output /dev/null --write-out '%{content_type}' \
    "http://127.0.0.1:$published_port/media/managed/pdf/probe.pdf" || true)"
case "$media_type" in
    application/pdf*)
        fail "a /media/ route is serving managed files directly"
        ;;
    *)
        pass "no /media/ route exposes managed files"
        ;;
esac

# Exercises the generic S3 backend end to end inside the running container.
if docker exec "$app_container" python manage.py validate_object_storage --skip-anonymous-check; then
    pass "object storage round trip verified from the running container"
else
    fail "object storage validation failed"
fi

log "result"
if [ "$failures" -ne 0 ]; then
    printf '%s check(s) failed.\n' "$failures" >&2
    exit 1
fi
printf 'The production image builds, starts, drops privileges, passes preflight and serves.\n'
