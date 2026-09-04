#!/usr/bin/env bash
# Create the cgroup v2 slice that enforces the VPS envelope on a larger host.
#
# Use this ONLY when the benchmark runs on a machine bigger than the target
# VPS. On a real 2 vCPU / 4 GB VPS the hardware is the limit and this script is
# unnecessary -- run `verify` there to record the machine's own numbers.
#
# The slice is an AGGREGATE limit over every Lock-in container, which is what
# the target VPS actually imposes. Per-service `cpus:`/`mem_limit:` values in
# Compose cannot express that: three services each capped at 2 CPUs can still
# use 6.
set -euo pipefail

SLICE="${LOCKIN_BENCH_SLICE:-lockin-bench.slice}"
CPUS="${LOCKIN_BENCH_CPUS:-2}"
MEMORY="${LOCKIN_BENCH_MEMORY:-4G}"
SWAP="${LOCKIN_BENCH_SWAP:-2G}"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root (sudo)." >&2
    exit 1
  fi
}

cgroup_path() {
  echo "/sys/fs/cgroup/${SLICE}"
}

cmd_create() {
  require_root
  if [ ! -f /sys/fs/cgroup/cgroup.controllers ]; then
    echo "cgroup v2 is not mounted at /sys/fs/cgroup. This host cannot enforce the limit." >&2
    exit 1
  fi

  # MemoryMax is the RAM ceiling. MemorySwapMax is swap ON TOP of it in cgroup
  # v2 -- it is not a combined total, which is the usual misreading.
  mkdir -p "/etc/systemd/system/${SLICE}.d"
  cat > "/etc/systemd/system/${SLICE}" <<SLICE_UNIT
[Unit]
Description=Lock-in benchmark VPS envelope
Before=slices.target

[Slice]
CPUAccounting=yes
MemoryAccounting=yes
IOAccounting=yes
CPUQuota=$((CPUS * 100))%
MemoryMax=${MEMORY}
MemorySwapMax=${SWAP}
SLICE_UNIT

  systemctl daemon-reload
  systemctl start "${SLICE}"
  echo "Created ${SLICE}: CPUQuota=$((CPUS * 100))% MemoryMax=${MEMORY} MemorySwapMax=${SWAP}"
  cmd_verify
}

cmd_verify() {
  local path
  path="$(cgroup_path)"
  echo "=== Enforcement evidence ==="
  if [ -d "${path}" ]; then
    echo "slice.cpu.max          $(cat "${path}/cpu.max" 2>/dev/null || echo 'n/a')"
    echo "slice.memory.max       $(cat "${path}/memory.max" 2>/dev/null || echo 'n/a')"
    echo "slice.memory.swap.max  $(cat "${path}/memory.swap.max" 2>/dev/null || echo 'n/a')"
  else
    echo "slice ${SLICE} not present (expected on a real VPS where hardware is the limit)"
  fi
  echo "host.nproc             $(nproc)"
  echo "host.MemTotal          $(awk '/MemTotal/{print $2" kB"}' /proc/meminfo)"
  echo "host.SwapTotal         $(awk '/SwapTotal/{print $2" kB"}' /proc/meminfo)"
  echo "host.swappiness        $(cat /proc/sys/vm/swappiness)"
}

cmd_destroy() {
  require_root
  systemctl stop "${SLICE}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SLICE}"
  rm -rf "/etc/systemd/system/${SLICE}.d"
  systemctl daemon-reload
  echo "Removed ${SLICE}"
}

case "${1:-verify}" in
  create) cmd_create ;;
  verify) cmd_verify ;;
  destroy) cmd_destroy ;;
  *) echo "Usage: $0 {create|verify|destroy}" >&2; exit 1 ;;
esac
