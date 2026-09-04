#!/usr/bin/env bash
# Sample host, container, cgroup and PostgreSQL state during a load level.
#
# Run this ON THE SYSTEM UNDER TEST, not on the load generator.
#
#   bench/collect.sh start bench/results/100u      # begins sampling
#   ... run the load ...
#   bench/collect.sh stop  bench/results/100u      # ends sampling, writes summary
#
# Everything it records is read-only: /proc, /sys/fs/cgroup, `docker stats`, and
# PostgreSQL's own statistics views. It changes nothing about the deployment.
set -euo pipefail

INTERVAL="${LOCKIN_BENCH_INTERVAL:-5}"
SLICE="${LOCKIN_BENCH_SLICE:-lockin-bench.slice}"
# compose.production.yaml requires ~20 variables and fails closed on each, so the
# deployment environment file is part of the invocation, not an optional extra.
# psql_q() swallows errors by design, so omitting it would turn every PostgreSQL
# row into a silent "not measured" rather than a visible failure.
ENV_FILE="${LOCKIN_ENV_FILE:-.env.production}"
COMPOSE_FILES="${LOCKIN_COMPOSE_FILES:---env-file ${ENV_FILE} -f compose.production.yaml -f bench/compose.bench.yaml}"
PG_USER="${POSTGRES_OWNER_USER:-lockin_owner}"
PG_DB="${POSTGRES_DB:-lockin}"

dc() {
  # shellcheck disable=SC2086
  docker compose ${COMPOSE_FILES} "$@"
}

psql_q() {
  dc exec -T db psql -U "${PG_USER}" -d "${PG_DB}" -At -F'|' -c "$1" 2>/dev/null || true
}

# ------------------------------------------------------------------ samplers

sample_containers() {
  local out="$1"
  docker stats --no-stream --format '{{json .}}' 2>/dev/null \
    | while IFS= read -r line; do
        printf '{"ts":%s,"kind":"container","data":%s}\n' "$(date +%s)" "${line}"
      done >> "${out}"
}

sample_host() {
  local out="$1"
  local ts mem swap_in swap_out
  ts="$(date +%s)"

  mem="$(awk '
    /^MemTotal:/     {t=$2}
    /^MemAvailable:/ {a=$2}
    /^SwapTotal:/    {st=$2}
    /^SwapFree:/     {sf=$2}
    /^Cached:/       {c=$2}
    /^Dirty:/        {d=$2}
    END {printf "{\"mem_total_kb\":%d,\"mem_available_kb\":%d,\"swap_total_kb\":%d,\"swap_used_kb\":%d,\"cached_kb\":%d,\"dirty_kb\":%d}", t, a, st, st-sf, c, d}
  ' /proc/meminfo)"

  swap_in="$(awk '/^pswpin/{print $2}' /proc/vmstat)"
  swap_out="$(awk '/^pswpout/{print $2}' /proc/vmstat)"

  # /proc/stat jiffies are cumulative; the report differentiates them.
  local cpu_line
  cpu_line="$(awk '/^cpu /{printf "{\"user\":%d,\"nice\":%d,\"system\":%d,\"idle\":%d,\"iowait\":%d,\"irq\":%d,\"softirq\":%d,\"steal\":%d}", $2,$3,$4,$5,$6,$7,$8,$9}' /proc/stat)"

  local psi_cpu psi_mem psi_io
  psi_cpu="$(awk '/^some/{print $5}' /proc/pressure/cpu 2>/dev/null | head -1 | cut -d= -f2)"
  psi_mem="$(awk '/^some/{print $5}' /proc/pressure/memory 2>/dev/null | head -1 | cut -d= -f2)"
  psi_io="$(awk '/^some/{print $5}' /proc/pressure/io 2>/dev/null | head -1 | cut -d= -f2)"

  local net
  net="$(awk 'NR>2 && $1 !~ /^lo:/ {gsub(":","",$1); rx+=$2; tx+=$10} END {printf "{\"rx_bytes\":%d,\"tx_bytes\":%d}", rx, tx}' /proc/net/dev)"

  printf '{"ts":%s,"kind":"host","cpu_jiffies":%s,"memory":%s,"pswpin":%s,"pswpout":%s,"psi_cpu_total":%s,"psi_memory_total":%s,"psi_io_total":%s,"net":%s}\n' \
    "${ts}" "${cpu_line}" "${mem}" "${swap_in:-0}" "${swap_out:-0}" \
    "${psi_cpu:-0}" "${psi_mem:-0}" "${psi_io:-0}" "${net}" >> "${out}"
}

sample_cgroup() {
  local out="$1"
  local base="/sys/fs/cgroup/${SLICE}"
  [ -d "${base}" ] || return 0
  local ts throttled periods mem_cur mem_max swap_cur oom
  ts="$(date +%s)"
  periods="$(awk '/^nr_periods/{print $2}' "${base}/cpu.stat" 2>/dev/null || echo 0)"
  throttled="$(awk '/^nr_throttled/{print $2}' "${base}/cpu.stat" 2>/dev/null || echo 0)"
  mem_cur="$(cat "${base}/memory.current" 2>/dev/null || echo 0)"
  mem_max="$(cat "${base}/memory.peak" 2>/dev/null || echo 0)"
  swap_cur="$(cat "${base}/memory.swap.current" 2>/dev/null || echo 0)"
  oom="$(awk '/^oom_kill /{print $2}' "${base}/memory.events" 2>/dev/null || echo 0)"
  printf '{"ts":%s,"kind":"cgroup","cpu_nr_periods":%s,"cpu_nr_throttled":%s,"memory_current":%s,"memory_peak":%s,"swap_current":%s,"oom_kill":%s}\n' \
    "${ts}" "${periods}" "${throttled}" "${mem_cur}" "${mem_max}" "${swap_cur}" "${oom}" >> "${out}"
}

sample_postgres() {
  local out="$1"
  local ts row
  ts="$(date +%s)"

  # Connections by state, plus the longest-running statement.
  row="$(psql_q "
    SELECT
      count(*) FILTER (WHERE state = 'active'),
      count(*) FILTER (WHERE state = 'idle'),
      count(*) FILTER (WHERE state = 'idle in transaction'),
      count(*) FILTER (WHERE wait_event_type = 'Lock'),
      count(*),
      current_setting('max_connections'),
      coalesce(max(extract(epoch from (now() - query_start))) FILTER (WHERE state = 'active'), 0)
    FROM pg_stat_activity WHERE datname = current_database();")"
  [ -n "${row}" ] || return 0

  IFS='|' read -r active idle idle_tx waiting total maxconn longest <<< "${row}"

  # Blocked/blocking pairs: the direct evidence of row-lock contention.
  local blocked
  blocked="$(psql_q "SELECT count(*) FROM pg_locks WHERE NOT granted;")"

  local dbrow
  dbrow="$(psql_q "
    SELECT xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched,
           deadlocks, temp_files, temp_bytes, blk_read_time, blk_write_time
    FROM pg_stat_database WHERE datname = current_database();")"
  IFS='|' read -r commits rollbacks blks_read blks_hit tup_ret tup_fetch deadlocks temp_files temp_bytes read_ms write_ms <<< "${dbrow:-0|0|0|0|0|0|0|0|0|0|0}"

  local dbsize
  dbsize="$(psql_q "SELECT pg_database_size(current_database());")"

  printf '{"ts":%s,"kind":"postgres","active":%s,"idle":%s,"idle_in_transaction":%s,"waiting_on_lock":%s,"connections":%s,"max_connections":%s,"longest_active_seconds":%s,"ungranted_locks":%s,"xact_commit":%s,"xact_rollback":%s,"blks_read":%s,"blks_hit":%s,"tup_returned":%s,"tup_fetched":%s,"deadlocks":%s,"temp_files":%s,"temp_bytes":%s,"blk_read_ms":%s,"blk_write_ms":%s,"database_bytes":%s}\n' \
    "${ts}" "${active:-0}" "${idle:-0}" "${idle_tx:-0}" "${waiting:-0}" "${total:-0}" \
    "${maxconn:-0}" "${longest:-0}" "${blocked:-0}" "${commits:-0}" "${rollbacks:-0}" \
    "${blks_read:-0}" "${blks_hit:-0}" "${tup_ret:-0}" "${tup_fetch:-0}" "${deadlocks:-0}" \
    "${temp_files:-0}" "${temp_bytes:-0}" "${read_ms:-0}" "${write_ms:-0}" "${dbsize:-0}" >> "${out}"
}

sample_disk() {
  local out="$1"
  command -v iostat >/dev/null 2>&1 || return 0
  iostat -x -o JSON 1 1 2>/dev/null \
    | tr -d '\n' \
    | sed "s/^/{\"ts\":$(date +%s),\"kind\":\"disk\",\"data\":/;s/$/}/" >> "${out}" 2>/dev/null || true
  printf '\n' >> "${out}"
}

# --------------------------------------------------------------------- loop

loop() {
  local dir="$1"
  local out="${dir}/samples.jsonl"
  while true; do
    sample_host "${out}"
    sample_cgroup "${out}"
    sample_containers "${out}"
    sample_postgres "${out}"
    sample_disk "${out}"
    sleep "${INTERVAL}"
  done
}

cmd_start() {
  local dir="$1"
  mkdir -p "${dir}"
  if [ -f "${dir}/collector.pid" ] && kill -0 "$(cat "${dir}/collector.pid")" 2>/dev/null; then
    echo "A collector is already running for ${dir}." >&2
    exit 1
  fi
  : > "${dir}/samples.jsonl"

  # Reset the cumulative query statistics so this level's numbers describe this
  # level only. Without this, level 300 inherits everything levels 10..250 did.
  psql_q "SELECT pg_stat_statements_reset();" > /dev/null
  psql_q "SELECT pg_stat_reset();" > /dev/null

  {
    echo "interval_seconds=${INTERVAL}"
    echo "started_epoch=$(date +%s)"
    echo "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "kernel=$(uname -r)"
    echo "nproc=$(nproc)"
    echo "mem_total_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)"
    echo "swap_total_kb=$(awk '/SwapTotal/{print $2}' /proc/meminfo)"
    echo "swappiness=$(cat /proc/sys/vm/swappiness)"
    echo "slice_cpu_max=$(cat "/sys/fs/cgroup/${SLICE}/cpu.max" 2>/dev/null || echo 'none')"
    echo "slice_memory_max=$(cat "/sys/fs/cgroup/${SLICE}/memory.max" 2>/dev/null || echo 'none')"
    echo "slice_swap_max=$(cat "/sys/fs/cgroup/${SLICE}/memory.swap.max" 2>/dev/null || echo 'none')"
  } > "${dir}/environment.txt"

  loop "${dir}" &
  echo $! > "${dir}/collector.pid"
  echo "collector started (pid $(cat "${dir}/collector.pid")) -> ${dir}/samples.jsonl"
}

cmd_stop() {
  local dir="$1"
  if [ -f "${dir}/collector.pid" ]; then
    kill "$(cat "${dir}/collector.pid")" 2>/dev/null || true
    rm -f "${dir}/collector.pid"
  fi
  # One last sample so the tail of the run is not missing.
  sample_host "${dir}/samples.jsonl"
  sample_cgroup "${dir}/samples.jsonl"
  sample_postgres "${dir}/samples.jsonl"

  echo "stopped_epoch=$(date +%s)" >> "${dir}/environment.txt"

  # The twenty statements that consumed the most database time during this
  # level. This is what turns "the database was busy" into a named query.
  psql_q "
    SELECT round(total_exec_time)::text || ' ms | ' ||
           calls::text || ' calls | ' ||
           round(mean_exec_time, 2)::text || ' ms mean | ' ||
           round(rows / GREATEST(calls, 1)) || ' rows/call | ' ||
           regexp_replace(left(query, 240), '\s+', ' ', 'g')
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY total_exec_time DESC
    LIMIT 20;" > "${dir}/pg_top_statements.txt"

  psql_q "
    SELECT relname || ' | seq_scan=' || seq_scan || ' | seq_tup_read=' || seq_tup_read ||
           ' | idx_scan=' || coalesce(idx_scan, 0) || ' | n_live_tup=' || n_live_tup
    FROM pg_stat_user_tables
    ORDER BY seq_tup_read DESC
    LIMIT 20;" > "${dir}/pg_table_scans.txt"

  dc logs --no-color --tail 400 backend > "${dir}/backend.log" 2>&1 || true
  dc logs --no-color --tail 400 db > "${dir}/db.log" 2>&1 || true
  dc logs --no-color --tail 200 edge > "${dir}/edge.log" 2>&1 || true
  dc ps --format json > "${dir}/containers.json" 2>/dev/null || true

  echo "collector stopped; artefacts in ${dir}"
  echo "  samples:    $(wc -l < "${dir}/samples.jsonl") lines"
  echo "  restarts:   $(grep -ci 'restart\|OOM\|Killed' "${dir}/backend.log" 2>/dev/null || echo 0) suspicious log lines"
}

case "${1:-}" in
  start) cmd_start "${2:?Usage: $0 start <dir>}" ;;
  stop)  cmd_stop  "${2:?Usage: $0 stop <dir>}" ;;
  *) echo "Usage: $0 {start|stop} <results-dir>" >&2; exit 1 ;;
esac
