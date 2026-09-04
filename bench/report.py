#!/usr/bin/env python3
"""Turn a benchmark results directory into the measured sections of the report.

    python3 bench/report.py bench/results/20260903T101500Z --out REPORT.md

It writes only what it measured. Where a metric is absent -- because a
collector could not run, or a stage was not executed -- the cell says
"not measured" rather than being interpolated, so nothing in the output can be
mistaken for an estimate.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

NOT_MEASURED = "not measured"


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    index = max(0, math.ceil(len(values) * fraction) - 1)
    return sorted(values)[index]


def human_bytes(value: float) -> str:
    if not value:
        return "0 B"
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(value) < 1024:
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} PiB"


# ------------------------------------------------------------------ loading


class Level:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.name = directory.name
        self.loadgen: dict = {}
        self.host: list[dict] = []
        self.cgroup: list[dict] = []
        self.postgres: list[dict] = []
        self.containers: list[dict] = []
        self.environment: dict[str, str] = {}
        self.pg_top: str = ""
        self.pg_scans: str = ""
        self._load()

    def _load(self) -> None:
        summary = self.directory / "loadgen.json"
        if summary.exists():
            try:
                self.loadgen = json.loads(summary.read_text(encoding="utf-8"))
            except ValueError:
                self.loadgen = {}

        server = self.directory / "server"
        samples = server / "samples.jsonl"
        if samples.exists():
            for line in samples.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                kind = row.get("kind")
                if kind == "host":
                    self.host.append(row)
                elif kind == "cgroup":
                    self.cgroup.append(row)
                elif kind == "postgres":
                    self.postgres.append(row)
                elif kind == "container":
                    self.containers.append(row)

        env = server / "environment.txt"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                key, _, value = line.partition("=")
                if key:
                    self.environment[key.strip()] = value.strip()

        for attribute, filename in (
            ("pg_top", "pg_top_statements.txt"),
            ("pg_scans", "pg_table_scans.txt"),
        ):
            path = server / filename
            if path.exists():
                setattr(self, attribute, path.read_text(encoding="utf-8").strip())

    # -- derived ----------------------------------------------------------

    @property
    def users(self) -> int:
        return int(self.loadgen.get("concurrent_users") or 0)

    @property
    def steady(self) -> dict:
        return self.loadgen.get("steady_state") or {}

    @property
    def latency(self) -> dict:
        return self.steady.get("latency_ms") or {}

    def host_cpu_percent(self) -> tuple[float, float] | None:
        """Mean and peak host CPU utilisation, from /proc/stat jiffy deltas."""
        if len(self.host) < 2:
            return None
        points: list[float] = []
        for before, after in zip(self.host, self.host[1:]):
            first = before.get("cpu_jiffies") or {}
            second = after.get("cpu_jiffies") or {}
            if not first or not second:
                continue
            total = sum(second.get(k, 0) - first.get(k, 0) for k in second)
            idle = (second.get("idle", 0) - first.get("idle", 0)) + (
                second.get("iowait", 0) - first.get("iowait", 0)
            )
            if total <= 0:
                continue
            points.append(100.0 * (total - idle) / total)
        if not points:
            return None
        return statistics.fmean(points), max(points)

    def host_iowait_percent(self) -> float | None:
        if len(self.host) < 2:
            return None
        points: list[float] = []
        for before, after in zip(self.host, self.host[1:]):
            first = before.get("cpu_jiffies") or {}
            second = after.get("cpu_jiffies") or {}
            total = sum(second.get(k, 0) - first.get(k, 0) for k in second)
            if total <= 0:
                continue
            points.append(100.0 * (second.get("iowait", 0) - first.get("iowait", 0)) / total)
        return statistics.fmean(points) if points else None

    def memory_used_kb(self) -> tuple[float, float] | None:
        values = []
        for row in self.host:
            memory = row.get("memory") or {}
            total = memory.get("mem_total_kb")
            available = memory.get("mem_available_kb")
            if total and available is not None:
                values.append(total - available)
        if not values:
            return None
        return statistics.fmean(values), max(values)

    def swap_used_kb(self) -> float | None:
        values = [
            (row.get("memory") or {}).get("swap_used_kb")
            for row in self.host
            if (row.get("memory") or {}).get("swap_used_kb") is not None
        ]
        return max(values) if values else None

    def swap_activity(self) -> tuple[int, int] | None:
        """Pages swapped in and out across the level, not the standing total.

        Standing swap usage is often harmless -- the kernel parked something
        idle. Paging activity during the run is what actually costs latency.
        """
        ins = [row.get("pswpin") for row in self.host if row.get("pswpin") is not None]
        outs = [row.get("pswpout") for row in self.host if row.get("pswpout") is not None]
        if len(ins) < 2 or len(outs) < 2:
            return None
        return max(0, ins[-1] - ins[0]), max(0, outs[-1] - outs[0])

    def cpu_throttling(self) -> tuple[int, int] | None:
        if len(self.cgroup) < 2:
            return None
        periods = self.cgroup[-1].get("cpu_nr_periods", 0) - self.cgroup[0].get("cpu_nr_periods", 0)
        throttled = self.cgroup[-1].get("cpu_nr_throttled", 0) - self.cgroup[0].get(
            "cpu_nr_throttled", 0
        )
        return max(0, periods), max(0, throttled)

    def oom_kills(self) -> int | None:
        if not self.cgroup:
            return None
        return int(self.cgroup[-1].get("oom_kill", 0)) - int(self.cgroup[0].get("oom_kill", 0))

    def pg_peak(self, key: str) -> float | None:
        values = [row.get(key) for row in self.postgres if row.get(key) is not None]
        return max(float(v) for v in values) if values else None

    def pg_delta(self, key: str) -> float | None:
        values = [row.get(key) for row in self.postgres if row.get(key) is not None]
        if len(values) < 2:
            return None
        return max(0.0, float(values[-1]) - float(values[0]))

    def pg_cache_hit_ratio(self) -> float | None:
        hits = self.pg_delta("blks_hit")
        reads = self.pg_delta("blks_read")
        if hits is None or reads is None or (hits + reads) <= 0:
            return None
        return 100.0 * hits / (hits + reads)

    def container_peaks(self) -> dict[str, dict[str, float]]:
        """Peak CPU% and memory per container, parsed from `docker stats`."""
        peaks: dict[str, dict[str, float]] = {}
        for row in self.containers:
            data = row.get("data") or {}
            name = str(data.get("Name") or data.get("Container") or "").strip()
            if not name:
                continue
            entry = peaks.setdefault(name, {"cpu": 0.0, "mem_bytes": 0.0})
            try:
                entry["cpu"] = max(entry["cpu"], float(str(data.get("CPUPerc", "0")).rstrip("%")))
            except ValueError:
                pass
            usage = str(data.get("MemUsage", "")).split("/")[0].strip()
            entry["mem_bytes"] = max(entry["mem_bytes"], _parse_size(usage))
        return peaks


def _parse_size(text: str) -> float:
    units = {"B": 1, "KIB": 1024, "MIB": 1024**2, "GIB": 1024**3, "KB": 1000, "MB": 1000**2, "GB": 1000**3}
    text = text.strip().upper()
    for unit, factor in sorted(units.items(), key=lambda item: -len(item[0])):
        if text.endswith(unit):
            try:
                return float(text[: -len(unit)].strip()) * factor
            except ValueError:
                return 0.0
    return 0.0


# ------------------------------------------------------------------ writing


def table(rows: list[list[str]], header: list[str]) -> str:
    widths = [len(cell) for cell in header]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    lines = ["| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(header)) + " |"]
    lines.append("|" + "|".join("-" * (width + 2) for width in widths) + "|")
    for row in rows:
        lines.append("| " + " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) + " |")
    return "\n".join(lines)


def fmt(value, suffix: str = "", digits: int = 1) -> str:
    if value is None:
        return NOT_MEASURED
    if isinstance(value, float):
        return f"{value:,.{digits}f}{suffix}"
    return f"{value:,}{suffix}"


def section_results(levels: list[Level]) -> str:
    header = [
        "Level", "Users", "RPS", "Requests", "Errors", "Err %",
        "5xx", "Timeouts", "p50 ms", "p90 ms", "p95 ms", "p99 ms",
    ]
    rows = []
    for level in levels:
        steady = level.steady
        latency = level.latency
        if not steady.get("requests"):
            rows.append([level.name, str(level.users)] + [NOT_MEASURED] * (len(header) - 2))
            continue
        rows.append(
            [
                level.name,
                str(level.users),
                fmt(steady.get("requests_per_second")),
                fmt(steady.get("requests")),
                fmt(steady.get("errors")),
                fmt(steady.get("error_percent"), "%", 2),
                fmt(steady.get("http_5xx")),
                fmt(steady.get("timeouts")),
                fmt(latency.get("p50")),
                fmt(latency.get("p90")),
                fmt(latency.get("p95")),
                fmt(latency.get("p99")),
            ]
        )
    return table(rows, header)


def section_resources(levels: list[Level]) -> str:
    header = [
        "Level", "CPU mean %", "CPU peak %", "iowait %", "RAM mean", "RAM peak",
        "Swap used", "Swap in/out pages", "CPU throttled", "OOM kills",
    ]
    rows = []
    for level in levels:
        cpu = level.host_cpu_percent()
        memory = level.memory_used_kb()
        swap_activity = level.swap_activity()
        throttling = level.cpu_throttling()
        oom = level.oom_kills()
        rows.append(
            [
                level.name,
                fmt(cpu[0] if cpu else None, "%"),
                fmt(cpu[1] if cpu else None, "%"),
                fmt(level.host_iowait_percent(), "%"),
                human_bytes(memory[0] * 1024) if memory else NOT_MEASURED,
                human_bytes(memory[1] * 1024) if memory else NOT_MEASURED,
                human_bytes((level.swap_used_kb() or 0) * 1024)
                if level.swap_used_kb() is not None
                else NOT_MEASURED,
                f"{swap_activity[0]:,} / {swap_activity[1]:,}" if swap_activity else NOT_MEASURED,
                f"{throttling[1]:,} of {throttling[0]:,} periods"
                if throttling
                else NOT_MEASURED,
                fmt(oom) if oom is not None else NOT_MEASURED,
            ]
        )
    return table(rows, header)


def section_postgres(levels: list[Level]) -> str:
    header = [
        "Level", "Conn peak", "Max conn", "Active peak", "Idle in txn peak",
        "Waiting on lock", "Ungranted locks", "Deadlocks", "Cache hit %",
        "Longest query s", "Temp files",
    ]
    rows = []
    for level in levels:
        if not level.postgres:
            rows.append([level.name] + [NOT_MEASURED] * (len(header) - 1))
            continue
        rows.append(
            [
                level.name,
                fmt(level.pg_peak("connections"), digits=0),
                fmt(level.pg_peak("max_connections"), digits=0),
                fmt(level.pg_peak("active"), digits=0),
                fmt(level.pg_peak("idle_in_transaction"), digits=0),
                fmt(level.pg_peak("waiting_on_lock"), digits=0),
                fmt(level.pg_peak("ungranted_locks"), digits=0),
                fmt(level.pg_delta("deadlocks"), digits=0),
                fmt(level.pg_cache_hit_ratio(), "%", 2),
                fmt(level.pg_peak("longest_active_seconds"), digits=2),
                fmt(level.pg_delta("temp_files"), digits=0),
            ]
        )
    return table(rows, header)


def section_containers(levels: list[Level]) -> str:
    names: set[str] = set()
    for level in levels:
        names.update(level.container_peaks())
    if not names:
        return f"_{NOT_MEASURED}: no `docker stats` samples were collected._"
    ordered = sorted(names)
    header = ["Level"] + [f"{n} CPU% / RAM" for n in ordered]
    rows = []
    for level in levels:
        peaks = level.container_peaks()
        row = [level.name]
        for name in ordered:
            entry = peaks.get(name)
            row.append(
                f"{entry['cpu']:.0f}% / {human_bytes(entry['mem_bytes'])}"
                if entry
                else NOT_MEASURED
            )
        rows.append(row)
    return table(rows, header)


def section_endpoints(level: Level) -> str:
    endpoints = level.loadgen.get("by_endpoint") or {}
    if not endpoints:
        return f"_{NOT_MEASURED}._"
    header = ["Scenario : endpoint", "Requests", "Err %", "p50 ms", "p95 ms", "p99 ms", "Mean bytes"]
    rows = [
        [
            key,
            fmt(value.get("requests")),
            fmt(value.get("error_percent"), "%", 2),
            fmt(value.get("p50")),
            fmt(value.get("p95")),
            fmt(value.get("p99")),
            human_bytes(value.get("bytes_mean") or 0),
        ]
        for key, value in sorted(
            endpoints.items(), key=lambda item: -(item[1].get("p95") or 0)
        )
    ]
    return table(rows, header)


def section_series(levels: list[Level]) -> str:
    """A coarse ASCII plot of p95 over time, for burst recovery."""
    blocks = []
    for level in levels:
        series = level.loadgen.get("time_series_10s") or []
        if not series:
            continue
        peak = max((point.get("p95_ms") or 0) for point in series) or 1
        lines = [f"{level.name} — p95 ms over time (peak {peak:,.0f} ms)"]
        for point in series:
            value = point.get("p95_ms") or 0
            bar = "#" * int(40 * value / peak)
            lines.append(
                f"  t+{point.get('t', 0):>4}s {value:>8,.0f} ms "
                f"{bar:<40} {point.get('error_percent', 0):>5.1f}% err"
            )
        blocks.append("```\n" + "\n".join(lines) + "\n```")
    return "\n\n".join(blocks) if blocks else f"_{NOT_MEASURED}._"


def section_environment(levels: list[Level]) -> str:
    for level in levels:
        if level.environment:
            rows = [[key, value] for key, value in sorted(level.environment.items())]
            return table(rows, ["Setting", "Value"])
    return (
        f"_{NOT_MEASURED}: no environment.txt was collected. Without it there is no "
        "evidence that the 2 vCPU / 4 GB envelope was actually enforced, and the "
        "numbers above cannot be attributed to that specification._"
    )


def build(results: Path) -> str:
    directories = sorted(
        (path for path in results.iterdir() if path.is_dir() and (path / "loadgen.json").exists()),
        key=lambda path: path.name,
    )
    if not directories:
        raise SystemExit(f"No level directories with loadgen.json under {results}")

    levels = [Level(path) for path in directories]
    ramp = [level for level in levels if level.name.startswith("ramp-")]
    ramp.sort(key=lambda level: level.users)
    burst = [level for level in levels if level.name.startswith("burst-")]
    soak = [level for level in levels if level.name.startswith("soak-")]
    files = [level for level in levels if level.name.startswith("files-")]
    login = [level for level in levels if level.name.startswith("login-")]
    dbwrite = [level for level in levels if level.name.startswith("dbwrite-")]
    ordered = ramp or levels

    healthy = [
        level
        for level in ramp
        if level.steady.get("requests")
        and (level.steady.get("error_percent") or 0) < 1.0
        and (level.latency.get("p95") or 0) < 500
    ]
    highest_ok = max((level.users for level in healthy), default=None)
    highest_tested = max((level.users for level in ramp if level.steady.get("requests")), default=None)

    parts = [
        "# Lock-in Production Capacity Report — measured sections",
        "",
        f"Generated from `{results}` by `bench/report.py`.",
        "",
        "Every number below was measured. Cells reading "
        f"*{NOT_MEASURED}* were not collected and must not be filled in by "
        "inference.",
        "",
        "## Tested environment",
        "",
        section_environment(levels),
        "",
        "## Results by concurrent users",
        "",
        section_results(ordered),
        "",
        "## CPU, RAM and swap",
        "",
        section_resources(ordered),
        "",
        "## Per-container peaks",
        "",
        section_containers(ordered),
        "",
        "## PostgreSQL",
        "",
        section_postgres(ordered),
        "",
    ]

    if ordered:
        worst = max(
            ordered,
            key=lambda level: (level.latency.get("p95") or 0),
        )
        parts += [
            f"### Slowest endpoints at the worst ramp level ({worst.name})",
            "",
            section_endpoints(worst),
            "",
        ]
        if worst.pg_top:
            parts += [
                f"### Top statements by total execution time ({worst.name})",
                "",
                "```",
                worst.pg_top,
                "```",
                "",
            ]
        if worst.pg_scans:
            parts += [
                f"### Sequential scan pressure ({worst.name})",
                "",
                "```",
                worst.pg_scans,
                "```",
                "",
            ]

    for title, group in (
        ("Burst test", burst),
        ("Sustained load (soak)", soak),
        ("PDF / file delivery", files),
        ("Database write path", dbwrite),
        ("Login storm", login),
    ):
        parts += [f"## {title}", ""]
        if group:
            parts += [section_results(group), "", section_resources(group), ""]
            if title == "Burst test":
                parts += ["### Latency over time", "", section_series(group), ""]
        else:
            parts += [f"_{NOT_MEASURED}: this stage was not run._", ""]

    parts += [
        "## Capacity summary",
        "",
        table(
            [
                [
                    "Highest level meeting the healthy criteria "
                    "(<1% errors and p95 < 500 ms)",
                    f"{highest_ok} concurrent users" if highest_ok else NOT_MEASURED,
                ],
                [
                    "Highest level successfully tested",
                    f"{highest_tested} concurrent users" if highest_tested else NOT_MEASURED,
                ],
                [
                    "Saturation point",
                    "derive from the first level where error rate or p95 breaks the "
                    "criteria above; state the evidence, not a round number",
                ],
            ],
            ["Measure", "Value"],
        ),
        "",
        "The three numbers above are *concurrent active users* in a closed-loop "
        "model: virtual users each holding at most one in-flight request, with "
        "think time between actions. They are not registered users, not daily "
        "active users, and not requests per second. Any conversion between them "
        "is an estimate and must be labelled as one.",
        "",
    ]
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    if not args.results.is_dir():
        raise SystemExit(f"{args.results} is not a directory")
    report = build(args.results)
    if args.out:
        args.out.write_text(report, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
