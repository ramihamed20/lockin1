#!/bin/sh
# Download a release's images ahead of the deployment, and nothing else.
#
# Pulling touches no container: the running release keeps serving while this
# downloads, and a pull that fails leaves the host exactly as it was. Run it
# before the deployment window, repeat it as often as needed, and start the
# switch-over only once it has exited 0.
#
# A slow or interrupted pull is retried. Docker keeps every layer that finished
# downloading, so each attempt resumes with the layers still missing rather
# than starting again, and layers the host already holds from earlier releases
# are never downloaded at all.
#
#   LOCKIN_IMAGE_TAG=<sha> scripts/production/pull-release.sh [env-file]
#
# Optional, to prove the pulled images are the ones CI published (the publish
# job lists each digest in its summary):
#   LOCKIN_EXPECT_BACKEND_DIGEST=sha256:...  LOCKIN_EXPECT_EDGE_DIGEST=sha256:...
#   LOCKIN_EXPECT_CLAMAV_DIGEST=sha256:...
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
env_file="${1:-$root/.env.production}"
compose_file="$root/compose.production.yaml"
attempts="${LOCKIN_PULL_ATTEMPTS:-5}"

if [ ! -f "$env_file" ]; then
    echo "Production environment file not found: $env_file" >&2
    exit 2
fi
configured_tag="$(sed -n 's/^[[:space:]]*LOCKIN_IMAGE_TAG=//p' "$env_file" | tail -n 1)"
tag="${LOCKIN_IMAGE_TAG:-$configured_tag}"
case "$tag" in
    ''|latest|*[!0-9a-f]*)
        echo "LOCKIN_IMAGE_TAG must be the full commit SHA the CI publish job printed, not '${tag}'." >&2
        exit 2
        ;;
esac
case "$attempts" in
    ''|*[!0-9]*|0)
        echo "LOCKIN_PULL_ATTEMPTS must be a positive integer." >&2
        exit 2
        ;;
esac

compose() {
    LOCKIN_IMAGE_TAG="$tag" docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

attempt=1
until compose pull; do
    if [ "$attempt" -ge "$attempts" ]; then
        echo "Pull failed ${attempts} times. Nothing was changed; the running release is untouched." >&2
        exit 1
    fi
    delay=$((attempt * 20))
    echo "Pull attempt ${attempt} of ${attempts} failed; completed layers are kept. Retrying in ${delay}s." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
done

# Every application image must now be present at the requested tag. Record the
# digests: they are what a rollback redeploys.
status=0
for image in $(compose config --images | sort -u); do
    case "$image" in
        *-backend:"$tag") expected="${LOCKIN_EXPECT_BACKEND_DIGEST:-}" ;;
        *-edge:"$tag") expected="${LOCKIN_EXPECT_EDGE_DIGEST:-}" ;;
        *-clamav:"$tag") expected="${LOCKIN_EXPECT_CLAMAV_DIGEST:-}" ;;
        *) continue ;;
    esac
    digest="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" 2>/dev/null | sed -n 's/.*@//p' | head -n 1)"
    if [ -z "$digest" ]; then
        echo "MISSING  $image" >&2
        status=1
    elif [ -n "$expected" ] && [ "$digest" != "$expected" ]; then
        echo "MISMATCH $image is $digest, expected $expected" >&2
        status=1
    else
        echo "ready    $image@$digest"
    fi
done
exit "$status"
