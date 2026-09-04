#!/usr/bin/env bash
# Drive the whole capacity benchmark: ramp, burst, soak, files, login storm.
#
# Run this ON THE LOAD GENERATOR HOST. It drives the load locally and starts and
# stops the metrics collector on the system under test over SSH, so the two
# never share a CPU.
#
#   export LOCKIN_TARGET=https://lockin.example
#   export LOCKIN_SUT_SSH=root@203.0.113.10        # host running the containers
#   export LOCKIN_SUT_DIR=/srv/lockin              # repo checkout on that host
#   bench/run_suite.sh ramp
#
# Stages:
#   ramp    10 -> 300 concurrent users, aborting on sustained failure
#   burst   100 -> 200 -> 300 step change, to measure recovery
#   soak    a long run at whatever level you pass in
#   files   PDF delivery in isolation
#   login   sign-in storm, to price Django's password hashing
#   all     ramp, then burst, then files, then login
set -euo pipefail

TARGET="${LOCKIN_TARGET:?Set LOCKIN_TARGET, e.g. https://lockin.example}"
SUT_SSH="${LOCKIN_SUT_SSH:-}"
SUT_DIR="${LOCKIN_SUT_DIR:-/srv/lockin}"
RESULTS="${LOCKIN_RESULTS:-bench/results/$(date -u +%Y%m%dT%H%M%SZ)}"
PYTHON="${LOCKIN_PYTHON:-python3}"
SEED="${LOCKIN_PASSWORD_SEED:-lockin-capacity-2026}"
DURATION="${LOCKIN_LEVEL_SECONDS:-300}"
SETTLE="${LOCKIN_SETTLE_SECONDS:-60}"
RAMP_UP="${LOCKIN_RAMP_UP_SECONDS:-30}"
INSECURE="${LOCKIN_INSECURE:-}"
LEVELS="${LOCKIN_LEVELS:-10 25 50 75 100 150 200 250 300}"

# Abort thresholds. The point is to find saturation, not to destroy the host.
MAX_ERROR_PERCENT="${LOCKIN_MAX_ERROR_PERCENT:-5}"
MAX_P95_MS="${LOCKIN_MAX_P95_MS:-3000}"

mkdir -p "${RESULTS}"

log() { printf '\n=== %s ===\n' "$*"; }

insecure_flag() { [ -n "${INSECURE}" ] && echo "--insecure" || true; }

collector() {
  # $1 = start|stop, $2 = level directory name
  local action="$1" name="$2"
  if [ -z "${SUT_SSH}" ]; then
    echo "  (no LOCKIN_SUT_SSH set: skipping ${action} of the server-side collector)"
    return 0
  fi
  ssh -o BatchMode=yes "${SUT_SSH}" \
    "cd ${SUT_DIR} && bench/collect.sh ${action} bench/results/${name}" \
    || echo "  WARNING: collector ${action} failed for ${name}; server metrics will be missing"
}

fetch_collector() {
  local name="$1" dest="$2"
  [ -n "${SUT_SSH}" ] || return 0
  mkdir -p "${dest}"
  scp -q -r "${SUT_SSH}:${SUT_DIR}/bench/results/${name}/." "${dest}/" \
    || echo "  WARNING: could not copy server metrics for ${name}"
}

# Returns 0 while the level is healthy, 1 once it has clearly failed.
level_is_healthy() {
  local summary="$1"
  "${PYTHON}" - "$summary" "$MAX_ERROR_PERCENT" "$MAX_P95_MS" <<'PY'
import json, sys
summary, max_error, max_p95 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
with open(summary, encoding="utf-8") as handle:
    data = json.load(handle)
steady = data.get("steady_state") or {}
if not steady.get("requests"):
    print("  UNHEALTHY: no steady-state requests recorded")
    raise SystemExit(1)
errors = steady.get("error_percent", 0.0)
p95 = (steady.get("latency_ms") or {}).get("p95", 0.0)
print(f"  rps={steady.get('requests_per_second')} "
      f"errors={errors}% p50={(steady.get('latency_ms') or {}).get('p50')}ms "
      f"p95={p95}ms p99={(steady.get('latency_ms') or {}).get('p99')}ms "
      f"timeouts={steady.get('timeouts')}")
if errors > max_error:
    print(f"  UNHEALTHY: error rate {errors}% exceeds {max_error}%")
    raise SystemExit(1)
if p95 > max_p95:
    print(f"  UNHEALTHY: p95 {p95}ms exceeds {max_p95}ms")
    raise SystemExit(1)
raise SystemExit(0)
PY
}

run_level() {
  # $1 = name, $2 = users, $3 = duration, $4.. = extra loadgen flags
  local name="$1" users="$2" duration="$3"
  shift 3
  local dir="${RESULTS}/${name}"
  mkdir -p "${dir}"

  log "level ${name}: ${users} concurrent users for ${duration}s"
  collector start "${name}"

  set +e
  "${PYTHON}" bench/loadgen.py "${TARGET}" \
    --users "${users}" \
    --duration "${duration}" \
    --ramp-up "${RAMP_UP}" \
    --password-seed "${SEED}" \
    --label "${name}" \
    --out "${dir}/loadgen.json" \
    --samples-out "${dir}/samples.jsonl" \
    $(insecure_flag) \
    "$@" > "${dir}/loadgen.stdout" 2> "${dir}/loadgen.stderr"
  local status=$?
  set -e

  collector stop "${name}"
  fetch_collector "${name}" "${dir}/server"

  if [ ${status} -ne 0 ] || [ ! -f "${dir}/loadgen.json" ]; then
    echo "  load generator exited ${status}; see ${dir}/loadgen.stderr"
    tail -5 "${dir}/loadgen.stderr" || true
    return 2
  fi

  if level_is_healthy "${dir}/loadgen.json"; then
    echo "  level ${name}: healthy"
    return 0
  fi
  echo "  level ${name}: DEGRADED"
  return 1
}

stage_ramp() {
  log "STAGE ramp"
  for users in ${LEVELS}; do
    if ! run_level "ramp-${users}u" "${users}" "${DURATION}"; then
      echo
      echo "Stopping the ramp at ${users} users: the level did not meet the health"
      echo "criteria. That is the saturation point to investigate, not a failure"
      echo "of the run. Server metrics for this level are in"
      echo "  ${RESULTS}/ramp-${users}u/server/"
      return 0
    fi
    echo "  settling for ${SETTLE}s"
    sleep "${SETTLE}"
  done
  echo "Every level up to the highest configured (${LEVELS##* }) stayed healthy."
}

stage_burst() {
  log "STAGE burst"
  # Deliberately short and back to back: the question is how the system behaves
  # in the first seconds after the step, and whether it returns to baseline.
  run_level "burst-100u" 100 120 || true
  run_level "burst-200u" 200 120 || true
  run_level "burst-300u" 300 120 || true
  run_level "burst-recovery-100u" 100 180 || true
  echo "Compare time_series_10s across the four burst levels for recovery time."
}

stage_soak() {
  local users="${1:-100}"
  local seconds="${2:-3600}"
  log "STAGE soak (${users} users, ${seconds}s)"
  run_level "soak-${users}u" "${users}" "${seconds}" || true
  echo "Check the soak's server samples for memory growth, connection growth and"
  echo "latency drift. A flat memory.current across an hour is the evidence that"
  echo "there is no leak; a rising one is the evidence that there is."
}

stage_files() {
  log "STAGE files (PDF delivery in isolation)"
  for users in 5 10 20 30 50; do
    run_level "files-${users}u" "${users}" 120 --mode files --think-min 1 --think-max 3 || true
  done
  echo "Gunicorn serves 3 workers x 8 threads = 24 concurrent request slots, and a"
  echo "streamed download holds one for the whole transfer. Look for the level at"
  echo "which throughput stops rising: that is where the thread pool, not the"
  echo "network, became the limit."
}

stage_login() {
  log "STAGE login storm"
  for users in 5 10 25 50; do
    run_level "login-${users}u" "${users}" 90 --mode login-storm --think-min 0.5 --think-max 1.5 || true
  done
  echo "Django verifies passwords with PBKDF2. Each sign-in is deliberate CPU work,"
  echo "so this stage prices a term-start or morning login peak on two cores."
}

stage_dbwrite() {
  log "STAGE database write path"
  for users in 10 25 50 75 100; do
    run_level "dbwrite-${users}u" "${users}" 180 --mode db-write || true
  done
  echo "This is the select_for_update and synchronous-event path. Watch"
  echo "ungranted_locks and waiting_on_lock in the server samples."
}

case "${1:-ramp}" in
  ramp)    stage_ramp ;;
  burst)   stage_burst ;;
  soak)    stage_soak "${2:-100}" "${3:-3600}" ;;
  files)   stage_files ;;
  login)   stage_login ;;
  dbwrite) stage_dbwrite ;;
  all)
    stage_ramp
    sleep "${SETTLE}"
    stage_burst
    sleep "${SETTLE}"
    stage_dbwrite
    sleep "${SETTLE}"
    stage_files
    sleep "${SETTLE}"
    stage_login
    ;;
  *)
    echo "Usage: $0 {ramp|burst|soak [users] [seconds]|files|login|dbwrite|all}" >&2
    exit 1
    ;;
esac

log "results in ${RESULTS}"
echo "Build the report with:"
echo "  ${PYTHON} bench/report.py ${RESULTS} --out ${RESULTS}/REPORT.md"
