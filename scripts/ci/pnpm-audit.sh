#!/bin/sh
# Run the production dependency audit, retrying only when the advisory service
# failed to answer.
#
# `pnpm audit` fails for two unrelated reasons and the exit code alone cannot
# tell them apart: a dependency carries a high-severity advisory, or npm's
# advisory service did not respond. The first must fail the build immediately.
# The second is someone else's outage -- it took this pipeline down once with
# the endpoint timing out on roughly three requests in four -- and retrying is
# the correct response to it.
#
# `--json` separates them structurally, which is why it is used here rather
# than matching error text that npm is free to reword:
#
#   completed  {"advisories":{...},"metadata":{"vulnerabilities":{...}}}
#   failed     {"error":{"code":"pnpm","message":"fetch failed"}}
#
# A payload carrying metadata.vulnerabilities is a verdict, and this script
# then propagates pnpm's own exit code untouched. It is therefore exactly as
# strict as running `pnpm audit` directly, never weaker: no severity threshold
# is lowered, no finding is suppressed, and a reachable service that reports a
# vulnerability fails on the first attempt with no retry. Only the absence of a
# verdict is retried, and exhausting the retries still fails the build.
#
# Usage: scripts/ci/pnpm-audit.sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
pnpm_bin="${LOCKIN_PNPM:-pnpm}"
attempts="${LOCKIN_AUDIT_ATTEMPTS:-3}"
# pnpm retries the advisory request internally before it gives up, so each
# attempt here already spans several minutes of an outage. These delays sit on
# top of that; the job's timeout-minutes is the outer bound.
delay="${LOCKIN_AUDIT_BACKOFF_SECONDS:-15}"
max_delay="${LOCKIN_AUDIT_BACKOFF_MAX_SECONDS:-60}"

report="$(mktemp)"
diagnostics="$(mktemp)"
cleanup() { rm -f "$report" "$diagnostics"; }
trap cleanup EXIT INT TERM

cd "$root/frontend"

attempt=1
while :; do
    if "$pnpm_bin" audit --prod --audit-level=high --json > "$report" 2> "$diagnostics"; then
        status=0
    else
        status=$?
    fi

    # Did the audit reach a verdict, whatever that verdict is?
    if node -e '
const fs = require("fs");
let report;
try { report = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch { process.exit(1); }
process.exit(report && report.metadata && report.metadata.vulnerabilities ? 0 : 1);
' "$report"; then
        cat "$report"
        if [ "$status" -eq 0 ]; then
            echo "Dependency audit passed at --audit-level=high."
            exit 0
        fi
        cat "$diagnostics" >&2
        echo "Dependency audit reported vulnerabilities at --audit-level=high." >&2
        exit "$status"
    fi

    cat "$diagnostics" >&2
    if [ "$attempt" -ge "$attempts" ]; then
        echo "The npm advisory service did not return an audit verdict in $attempts attempts." >&2
        echo "This is an advisory-service availability failure, not a clean audit: the" >&2
        echo "dependencies were never assessed, so the build fails closed." >&2
        exit 1
    fi

    echo "No audit verdict from the advisory service (attempt $attempt of $attempts). Retrying in ${delay}s." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
    [ "$delay" -gt "$max_delay" ] && delay="$max_delay"
done
