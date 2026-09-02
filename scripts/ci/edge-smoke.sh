#!/bin/sh
# Prove the edge container starts under the production security settings.
#
# The edge runs read-only, with every Linux capability dropped, and with its
# only writable path an explicit tmpfs. Those are exactly the settings a
# `docker build` and an `nginx -t` cannot exercise: nginx creates its
# temporary-path directories at start-up, and a root master would then chown
# them, which needs the CAP_CHOWN that production drops. That failure lands on
# first boot, when a deployment is least able to absorb it.
#
# So this brings the real image up the way production does, against a stub
# upstream, and asserts that it starts unprivileged and serves. Run it before a
# first deployment; CI runs it on every change.
#
# Usage: scripts/ci/edge-smoke.sh [IMAGE]
set -eu

image="${1:-${LOCKIN_EDGE_IMAGE:-lockin-edge:ci}}"
network="lockin-edge-$$"
edge_container="lockin-edge-smoke-$$"
stub_container="lockin-edge-stub-$$"
http_port="${LOCKIN_EDGE_HTTP_PORT:-18081}"
https_port="${LOCKIN_EDGE_HTTPS_PORT:-18443}"
public_host="lockin.example.test"
# The uid the edge image runs as. Kept in step with frontend/Dockerfile.
expected_uid=10001

workdir="$(mktemp -d)"
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
        log "edge logs"
        docker logs "$edge_container" 2>&1 | tail -n 40 || true
    fi
    docker rm --force "$edge_container" "$stub_container" > /dev/null 2>&1 || true
    docker network rm "$network" > /dev/null 2>&1 || true
    rm -rf "$workdir"
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
        sleep 1
    done
    return 0
}

status_of() {
    curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
        --header "Host: $public_host" "$@"
}

log "preparing TLS material owned by the runtime user"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj "/CN=$public_host" \
    -keyout "$workdir/privatekey.pem" -out "$workdir/fullchain.pem" > /dev/null 2>&1

# Production keeps the private key unreadable to other accounts, so the runtime
# uid has to own it. Exercising that here is the point: a key the container
# cannot read is the other way this deployment fails on first boot.
chmod 0640 "$workdir/privatekey.pem"
chmod 0644 "$workdir/fullchain.pem"
key_ownership="enforced"
if [ "$(id -u)" = "0" ]; then
    chown "$expected_uid:$expected_uid" "$workdir/privatekey.pem" "$workdir/fullchain.pem"
elif sudo -n chown "$expected_uid:$expected_uid" \
        "$workdir/privatekey.pem" "$workdir/fullchain.pem" 2> /dev/null; then
    :
else
    # Without the privilege to chown, fall back to a readable key so the rest of
    # the run still executes, and say so rather than reporting a pass that did
    # not actually test the permission contract.
    chmod 0644 "$workdir/privatekey.pem"
    key_ownership="not exercised (no privilege to chown)"
fi
printf 'private key ownership: %s\n' "$key_ownership"

docker network create "$network" > /dev/null

log "starting a stub API upstream"
# The contract under test is edge start-up and proxying, not the application, so
# the upstream is a stub. scripts/ci/docker-smoke.sh covers the real API.
printf '%s\n' \
    'import http.server' \
    'import json' \
    '' \
    '' \
    'class Handler(http.server.BaseHTTPRequestHandler):' \
    '    def do_GET(self):' \
    '        body = json.dumps({"status": "ready"}).encode()' \
    '        self.send_response(200)' \
    '        self.send_header("Content-Type", "application/json")' \
    '        self.send_header("Content-Length", str(len(body)))' \
    '        self.end_headers()' \
    '        self.wfile.write(body)' \
    '' \
    '    def log_message(self, *arguments):' \
    '        return' \
    '' \
    '' \
    'http.server.HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()' \
    > "$workdir/stub.py"

docker run --detach --name "$stub_container" --network "$network" --network-alias backend \
    --volume "$workdir/stub.py:/srv/stub.py:ro" \
    python:3.13.14-slim python /srv/stub.py > /dev/null
await "the stub upstream" 30 docker run --rm --network "$network" \
    curlimages/curl:8.11.1 --silent --fail --max-time 3 http://backend:8000/api/v1/health/ready

log "starting the edge with the production security settings"
# Every option below mirrors compose.production.yaml. If the edge cannot start
# this way, it cannot start in production.
docker run --detach --name "$edge_container" --network "$network" \
    --publish "127.0.0.1:$http_port:8080" \
    --publish "127.0.0.1:$https_port:8443" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:size=67108864,mode=1777 \
    --volume "$workdir/fullchain.pem:/run/tls/fullchain.pem:ro" \
    --volume "$workdir/privatekey.pem:/run/tls/privatekey.pem:ro" \
    "$image" > /dev/null

await "the edge" 30 curl --silent --fail --max-time 3 "http://127.0.0.1:$http_port/healthz"

log "assertions"

if [ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = "true" ]; then
    pass "edge container is running under read-only root and cap_drop ALL"
else
    fail "edge container is not running"
fi

edge_logs="$(docker logs "$edge_container" 2>&1)"
case "$edge_logs" in
    *chown*)
        fail "nginx attempted a chown at start-up"
        ;;
    *)
        pass "no chown attempted at start-up"
        ;;
esac
case "$edge_logs" in
    *"[emerg]"*)
        fail "nginx logged an emergency"
        ;;
    *)
        pass "nginx logged no emergency"
        ;;
esac

container_uid="$(docker exec "$edge_container" id -u | tr -d '\r')"
if [ "$container_uid" = "$expected_uid" ]; then
    pass "edge runs as the unprivileged uid $expected_uid"
else
    fail "edge runs as uid $container_uid, expected $expected_uid"
fi

master_uid="$(docker exec "$edge_container" sh -c \
    'read pid < /tmp/nginx.pid; awk "/^Uid:/ {print \$2}" /proc/$pid/status' | tr -d '\r')"
if [ "$master_uid" = "$expected_uid" ]; then
    pass "nginx master runs unprivileged"
else
    fail "nginx master runs as uid ${master_uid:-missing}, expected $expected_uid"
fi

# The temporary paths must exist and be writable: a streamed request body still
# needs somewhere to go even with response buffering off.
if docker exec "$edge_container" sh -c 'touch /tmp/client_temp/.probe && rm /tmp/client_temp/.probe'; then
    pass "nginx temporary paths are writable on the tmpfs"
else
    fail "nginx temporary paths are not writable"
fi

if [ "$(status_of "http://127.0.0.1:$http_port/healthz")" = "200" ]; then
    pass "HTTP liveness serves"
else
    fail "HTTP liveness did not serve"
fi

redirect="$(status_of "http://127.0.0.1:$http_port/")"
if [ "$redirect" = "308" ]; then
    pass "plain HTTP redirects to HTTPS"
else
    fail "plain HTTP returned $redirect, expected 308"
fi

if [ "$(status_of --insecure "https://127.0.0.1:$https_port/healthz")" = "200" ]; then
    pass "HTTPS liveness serves, so the runtime user read the private key"
else
    fail "HTTPS liveness did not serve"
fi

# The whole point of the edge: a request reaching the API through nginx.
readiness="$(curl --silent --insecure --max-time 5 --header "Host: $public_host" \
    "https://127.0.0.1:$https_port/api/v1/health/ready" || true)"
case "$readiness" in
    *"ready"*)
        pass "API readiness proxies through nginx"
        ;;
    *)
        fail "API readiness did not proxy: ${readiness:-no response}"
        ;;
esac

if [ "$(status_of --insecure "https://127.0.0.1:$https_port/")" = "200" ]; then
    pass "the SPA is served over HTTPS"
else
    fail "the SPA was not served"
fi

if [ "$(status_of --insecure "https://127.0.0.1:$https_port/admin/")" = "404" ]; then
    pass "Django admin stays closed at the edge"
else
    fail "the /admin/ route is not closed"
fi

headers="$(curl --silent --insecure --head --max-time 5 --header "Host: $public_host" \
    "https://127.0.0.1:$https_port/" || true)"
case "$headers" in
    *"Content-Security-Policy"*) pass "security headers are applied" ;;
    *) fail "security headers are missing" ;;
esac

log "result"
if [ "$failures" -ne 0 ]; then
    printf '%s check(s) failed.\n' "$failures" >&2
    exit 1
fi
if [ "$key_ownership" != "enforced" ]; then
    printf 'Note: the private-key ownership contract was not exercised on this host.\n'
fi
printf 'The edge starts read-only, unprivileged, with no capabilities, and serves.\n'
