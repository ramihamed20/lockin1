#!/bin/sh
# Entry point for the single-image deployment on a managed container host.
#
# It runs the same release/preflight contract as the VPS Compose deployment, so
# moving between the two is a configuration change. Passing a command turns the
# container into a worker (scheduler, file scanner) running the same image with
# no web server; see docs/DEPLOYMENT.md.
set -eu

: "${PORT:=10000}"
: "${DJANGO_SETTINGS_MODULE:=config.settings.production}"
: "${LOCKIN_MAX_BODY_SIZE:=92m}"
# nginx runs unprivileged, so its pid and temp paths must be writable.
NGINX_DIRECTIVES="pid /tmp/nginx.pid; error_log /dev/stderr warn;"
export PORT DJANGO_SETTINGS_MODULE LOCKIN_MAX_BODY_SIZE

if [ "$#" -gt 0 ]; then
    role="worker"
else
    role="web"
fi
# Exactly one instance per deploy may run the release step, and a worker never
# should: concurrent migrations against one database are not safe.
if [ "$role" = "worker" ]; then
    : "${LOCKIN_RUN_RELEASE:=false}"
    : "${LOCKIN_RUN_PREFLIGHT:=false}"
else
    : "${LOCKIN_RUN_RELEASE:=true}"
    : "${LOCKIN_RUN_PREFLIGHT:=true}"
fi

log() {
    printf '{"level":"INFO","logger":"lockin.start","message":"%s"}\n' "$1"
}

is_production() {
    case "$DJANGO_SETTINGS_MODULE" in
        *production) return 0 ;;
        *) return 1 ;;
    esac
}

if [ "$role" = "web" ]; then
    envsubst '${PORT} ${LOCKIN_MAX_BODY_SIZE}' \
        < /etc/nginx/templates/default.conf.template \
        > /etc/nginx/conf.d/default.conf
    nginx -t -g "$NGINX_DIRECTIVES"
fi

if is_production; then
    if [ "$LOCKIN_RUN_RELEASE" = "true" ]; then
        # Migrations run as the owning role. Everything afterwards connects with
        # the least-privilege runtime credentials from DATABASE_URL.
        : "${POSTGRES_OWNER_USER:?Set POSTGRES_OWNER_USER for the migration role}"
        : "${POSTGRES_OWNER_PASSWORD:?Set POSTGRES_OWNER_PASSWORD for the migration role}"
        log "running release as ${POSTGRES_OWNER_USER}"
        POSTGRES_USER="$POSTGRES_OWNER_USER" \
        POSTGRES_PASSWORD="$POSTGRES_OWNER_PASSWORD" \
        POSTGRES_STATEMENT_TIMEOUT_MS=0 \
        POSTGRES_LOCK_TIMEOUT_MS=0 \
            python manage.py release
    elif [ "$role" = "web" ]; then
        # Preflight requires collected static assets even when another instance
        # owns the release step.
        python manage.py collectstatic --noinput --verbosity 0
    fi
    if [ "$LOCKIN_RUN_PREFLIGHT" = "true" ]; then
        log "running production preflight"
        python manage.py production_preflight
    fi
else
    python manage.py migrate --noinput
    if [ "$role" = "web" ]; then
        python manage.py collectstatic --noinput --verbosity 0
    fi
    if [ "${LOCKIN_DEMO_SEED:-false}" = "true" ] && [ "$role" = "web" ]; then
        log "preparing demo data in the background"
        python manage.py seed_demo &
    fi
fi

if [ "$role" = "worker" ]; then
    log "starting worker: $*"
    exec "$@"
fi

nginx -g "$NGINX_DIRECTIVES"
log "starting gunicorn"
exec gunicorn --config config/gunicorn.py config.wsgi:application
