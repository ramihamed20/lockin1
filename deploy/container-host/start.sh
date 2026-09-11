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
# nginx runs unprivileged, so its pid and temp paths must be writable. The pid
# path is set in the image instead of here: nginx rejects a duplicate `pid`
# directive, and Debian's nginx.conf already declares one. error_log may be
# repeated, so this one still stands beside the file's own.
NGINX_DIRECTIVES="error_log /dev/stderr warn;"
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

# Two processes, one container, and neither may outlive the other.
#
# This used to daemonize nginx and then `exec gunicorn`. Gunicorn became PID 1
# and nginx was reparented to it, so if nginx died the container carried on
# looking healthy while nothing answered on $PORT -- the platform saw a live
# main process and never restarted it. Gunicorn does not supervise nginx and
# cannot be made to.
#
# So run nginx in the foreground, run Gunicorn beside it, and have this shell
# wait on both. `wait -n` returns as soon as *either* exits; whichever it was,
# the other is stopped and the container exits non-zero so the platform
# restarts it. `set -e` is already on, and the trap covers a platform SIGTERM.
log "starting nginx"
nginx -g "daemon off; $NGINX_DIRECTIVES" &
nginx_pid=$!
log "starting gunicorn"
gunicorn --config config/gunicorn.py config.wsgi:application &
gunicorn_pid=$!

stop() {
    trap - TERM INT
    kill "$nginx_pid" "$gunicorn_pid" 2>/dev/null || true
    wait "$nginx_pid" "$gunicorn_pid" 2>/dev/null || true
}
trap 'stop; exit 0' TERM INT

# POSIX sh has no `wait -n`; poll instead, which also keeps this readable.
while kill -0 "$nginx_pid" 2>/dev/null && kill -0 "$gunicorn_pid" 2>/dev/null; do
    sleep 1
done

if kill -0 "$nginx_pid" 2>/dev/null; then
    log "gunicorn exited; stopping nginx so the container is replaced"
else
    log "nginx exited; stopping gunicorn so the container is replaced"
fi
stop
exit 1
