#!/usr/bin/env python3
"""Closed-loop, session-authenticated load generator for Lock-in.

Run this on a SEPARATE machine from the system under test. On a 2 vCPU VPS the
generator and the application would fight for the same two cores and every
latency number would be contaminated.

Model
-----
Each virtual user is one asyncio task holding its own cookie jar and its own
account. It signs in once during warm-up, then loops: pick a weighted scenario,
walk that scenario's real request sequence, sleep for a think time, repeat.
That is a closed-loop model, so "concurrent users" here means what it says --
N users each with at most one request in flight -- rather than N requests per
second aimed at the server regardless of whether it is coping.

Warm-up requests (CSRF + login) are recorded but tagged ``warmup`` and excluded
from the steady-state percentiles, because a login storm is a different
workload from steady browsing. ``--mode login-storm`` measures that separately:
Django's PBKDF2 hasher makes every sign-in cost real CPU, and on two shared
cores that cost is worth its own number.

Every scenario uses routes verified against the application's own urls.py. No
endpoint is assumed.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import random
import statistics
import sys
import time
import uuid
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field

try:
    import aiohttp
except ImportError:  # pragma: no cover - operator-facing message
    sys.exit(
        "aiohttp is required.\n"
        "  python3 -m venv .venv && . .venv/bin/activate\n"
        "  pip install -r bench/requirements.txt"
    )

BENCH_DOMAIN = "@bench.invalid"
API = "/api/v1"

SEARCH_TERMS = [
    "oral",
    "dental",
    "anatomy",
    "materials",
    "pathology",
    "periodont",
    "endodont",
    "clinical",
    "guide",
    "chapter",
    "assessment",
    "radiology",
    "implant",
    "anaesthesia",
]


# --------------------------------------------------------------- identities


def bench_email(index: int) -> str:
    return f"bench-{index:06d}{BENCH_DOMAIN}"


def bench_password(seed: str) -> str:
    digest = hashlib.sha256(f"lockin-bench-password::{seed}".encode()).hexdigest()
    return f"Lk{digest[:16]}Qz!7"


# ----------------------------------------------------------------- sampling


@dataclass(slots=True)
class Sample:
    t: float
    scenario: str
    label: str
    method: str
    status: int
    ms: float
    bytes: int
    phase: str
    error: str = ""


@dataclass
class Recorder:
    samples: list[Sample] = field(default_factory=list)

    def add(self, sample: Sample) -> None:
        self.samples.append(sample)


def percentile(values: list[float], fraction: float) -> float:
    """Nearest-rank, matching scripts/performance/http_probe.py.

    Using the same definition keeps these numbers directly comparable with the
    probe already in the repository.
    """
    if not values:
        return 0.0
    index = max(0, math.ceil(len(values) * fraction) - 1)
    return sorted(values)[index]


# --------------------------------------------------------------- HTTP layer


class Client:
    """One virtual user's HTTP session."""

    def __init__(
        self,
        *,
        base_url: str,
        session: aiohttp.ClientSession,
        recorder: Recorder,
        started: float,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = session
        self.recorder = recorder
        self.started = started
        self.csrf_token = ""
        self.phase = "warmup"

    async def request(
        self,
        method: str,
        path: str,
        *,
        scenario: str,
        label: str,
        json_body: dict | None = None,
        expect_json: bool = True,
    ) -> tuple[int, object]:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        headers = {"Accept": "application/json"}
        if method not in {"GET", "HEAD", "OPTIONS"}:
            # Django's default header name; the project does not override
            # CSRF_HEADER_NAME.
            headers["X-CSRFToken"] = self.csrf_token
            headers["Referer"] = f"{self.base_url}/"
        begin = time.perf_counter()
        status = 0
        payload: object = None
        error = ""
        size = 0
        try:
            async with self.session.request(
                method, url, headers=headers, json=json_body
            ) as response:
                status = response.status
                raw = await response.read()
                size = len(raw)
                if expect_json and raw:
                    try:
                        payload = json.loads(raw)
                    except (ValueError, UnicodeDecodeError):
                        payload = None
                if status >= 500:
                    error = f"http_{status}"
                elif status >= 400:
                    error = f"http_{status}"
        except asyncio.TimeoutError:
            error = "timeout"
        except aiohttp.ClientError as exception:
            error = f"conn_{type(exception).__name__}"
        except OSError as exception:
            error = f"os_{type(exception).__name__}"

        self.recorder.add(
            Sample(
                t=time.perf_counter() - self.started,
                scenario=scenario,
                label=label,
                method=method,
                status=status,
                ms=(time.perf_counter() - begin) * 1000,
                bytes=size,
                phase=self.phase,
                error=error,
            )
        )
        self._refresh_csrf()
        return status, payload

    def _refresh_csrf(self) -> None:
        for cookie in self.session.cookie_jar:
            if cookie.key in {"__Host-lockin_csrf", "csrftoken"}:
                self.csrf_token = cookie.value

    async def login(self, email: str, password: str, *, scenario: str = "auth") -> bool:
        await self.request("GET", f"{API}/auth/csrf", scenario=scenario, label="csrf")
        status, _ = await self.request(
            "POST",
            f"{API}/auth/login",
            scenario=scenario,
            label="login",
            json_body={"email": email, "password": password, "remember_me": False},
        )
        return 200 <= status < 300


# ---------------------------------------------------------------- catalogue


@dataclass
class Catalogue:
    """Content ids discovered from the running application, not assumed."""

    quiz_ids: list[str] = field(default_factory=list)
    learning_object_ids: list[str] = field(default_factory=list)
    document_version_ids: list[str] = field(default_factory=list)
    file_view_urls: list[str] = field(default_factory=list)

    def ok(self) -> bool:
        return bool(self.quiz_ids or self.learning_object_ids or self.file_view_urls)

    def describe(self) -> str:
        return (
            f"quizzes={len(self.quiz_ids)} learning_objects={len(self.learning_object_ids)} "
            f"documents={len(self.document_version_ids)} files={len(self.file_view_urls)}"
        )


async def discover(client: Client) -> Catalogue:
    catalogue = Catalogue()

    _, quizzes = await client.request(
        "GET", f"{API}/quizzes?page_size=100", scenario="setup", label="discover-quizzes"
    )
    if isinstance(quizzes, dict):
        for row in quizzes.get("results") or []:
            if isinstance(row, dict) and row.get("id"):
                catalogue.quiz_ids.append(str(row["id"]))

    _, objects = await client.request(
        "GET",
        f"{API}/learning-objects?page_size=100",
        scenario="setup",
        label="discover-content",
    )
    if isinstance(objects, dict):
        for row in objects.get("results") or []:
            if isinstance(row, dict) and row.get("id"):
                catalogue.learning_object_ids.append(str(row["id"]))

    _, lockin = await client.request(
        "GET", f"{API}/focus/lock-in", scenario="setup", label="discover-materials"
    )
    if isinstance(lockin, dict):
        for row in lockin.get("materials") or []:
            if not isinstance(row, dict):
                continue
            if row.get("document_version_id"):
                catalogue.document_version_ids.append(str(row["document_version_id"]))
            view_url = row.get("view_url")
            if view_url:
                catalogue.file_view_urls.append(str(view_url))
            elif row.get("file_id"):
                catalogue.file_view_urls.append(f"{API}/files/{row['file_id']}/view")

    return catalogue


# ---------------------------------------------------------------- scenarios


async def scenario_browsing(client: Client, cat: Catalogue, rng: random.Random) -> None:
    """A — session validation and navigation. The cheapest authenticated path."""
    name = "A_browsing"
    await client.request("GET", f"{API}/auth/session", scenario=name, label="session")
    await client.request("GET", f"{API}/dashboard", scenario=name, label="dashboard")
    await client.request("GET", f"{API}/education/nodes", scenario=name, label="nodes")
    await client.request(
        "GET", f"{API}/learning-objects?page_size=25", scenario=name, label="content-list"
    )
    await client.request(
        "GET", f"{API}/notifications/summary", scenario=name, label="notification-summary"
    )


async def scenario_content(client: Client, cat: Catalogue, rng: random.Random) -> None:
    """B — opening study material. The path most learners spend their time on."""
    name = "B_content"
    await client.request(
        "GET", f"{API}/learning/dashboard", scenario=name, label="learning-dashboard"
    )
    if cat.learning_object_ids:
        object_id = rng.choice(cat.learning_object_ids)
        await client.request(
            "GET", f"{API}/learning-objects/{object_id}", scenario=name, label="content-detail"
        )
    if cat.document_version_ids:
        document_id = rng.choice(cat.document_version_ids)
        await client.request(
            "GET", f"{API}/focus/documents/{document_id}", scenario=name, label="focus-document"
        )
    await client.request("GET", f"{API}/progress/resume", scenario=name, label="resume")
    await client.request("GET", f"{API}/bookmarks", scenario=name, label="bookmarks")


async def scenario_assessment(client: Client, cat: Catalogue, rng: random.Random) -> None:
    """C — the write path: row locks, transactions and synchronous event fan-out.

    Start an attempt, answer its questions, submit, read the result. Submission
    is the operation that takes select_for_update locks and then dispatches XP,
    streak, achievement, ranking and notification handlers in-process before
    the response is returned.
    """
    name = "C_assessment"
    await client.request("GET", f"{API}/quizzes?page_size=25", scenario=name, label="quiz-list")
    if not cat.quiz_ids:
        return
    quiz_id = rng.choice(cat.quiz_ids)
    await client.request("GET", f"{API}/quizzes/{quiz_id}", scenario=name, label="quiz-detail")

    status, attempt = await client.request(
        "POST",
        f"{API}/quizzes/{quiz_id}/attempts",
        scenario=name,
        label="attempt-start",
        json_body={"idempotency_key": str(uuid.uuid4()), "question_count": 5},
    )
    if not (200 <= status < 300) or not isinstance(attempt, dict):
        return
    attempt_id = attempt.get("id")
    if not attempt_id:
        return

    for question in (attempt.get("questions") or [])[:5]:
        if not isinstance(question, dict):
            continue
        options = question.get("option_snapshot") or []
        chosen = [str(options[0]["id"])] if options and isinstance(options[0], dict) else []
        await client.request(
            "PUT",
            f"{API}/attempts/{attempt_id}/questions/{question.get('id')}/answer",
            scenario=name,
            label="answer-save",
            json_body={"selected_option_ids": chosen, "client_revision": 1},
        )

    status, result = await client.request(
        "POST",
        f"{API}/attempts/{attempt_id}/submit",
        scenario=name,
        label="attempt-submit",
        json_body={"idempotency_key": str(uuid.uuid4())},
    )
    if isinstance(result, dict):
        result_id = result.get("id") or result.get("result_id")
        if result_id:
            await client.request(
                "GET",
                f"{API}/assessment-results/{result_id}",
                scenario=name,
                label="result",
            )


async def scenario_search(client: Client, cat: Catalogue, rng: random.Random) -> None:
    """D — the discovery index and the user-scoped review queries."""
    name = "D_search"
    term = rng.choice(SEARCH_TERMS)
    await client.request(
        "GET", f"{API}/search?q={term}&limit=12", scenario=name, label="search"
    )
    if rng.random() < 0.5:
        second = f"{rng.choice(SEARCH_TERMS)}%20{rng.choice(SEARCH_TERMS)}"
        await client.request(
            "GET", f"{API}/search?q={second}&limit=12", scenario=name, label="search-multiterm"
        )
    await client.request("GET", f"{API}/review-queue", scenario=name, label="review-queue")
    await client.request("GET", f"{API}/review-bank", scenario=name, label="review-bank")


async def scenario_files(client: Client, cat: Catalogue, rng: random.Random) -> None:
    """E — private PDF delivery.

    These stream through Gunicorn rather than being handed to nginx or
    redirected to object storage, so each one occupies a worker thread for the
    whole transfer. This scenario exists to find out what that costs.
    """
    name = "E_files"
    if not cat.file_view_urls:
        return
    await client.request(
        "GET",
        rng.choice(cat.file_view_urls),
        scenario=name,
        label="file-view",
        expect_json=False,
    )


SCENARIOS = {
    "A_browsing": scenario_browsing,
    "B_content": scenario_content,
    "C_assessment": scenario_assessment,
    "D_search": scenario_search,
    "E_files": scenario_files,
}

DEFAULT_WEIGHTS = {
    "A_browsing": 35,
    "B_content": 25,
    "C_assessment": 20,
    "D_search": 10,
    "E_files": 10,
}


# ------------------------------------------------------------ virtual users


async def virtual_user(
    *,
    index: int,
    args: argparse.Namespace,
    recorder: Recorder,
    catalogue: Catalogue,
    connector_ssl: object,
    deadline: float,
    started: float,
    failures: Counter,
) -> None:
    rng = random.Random(f"{args.password_seed}:vu:{index}")
    account_index = (index % args.account_pool) + 1
    email = bench_email(account_index)
    password = bench_password(args.password_seed)

    timeout = aiohttp.ClientTimeout(total=args.timeout)
    jar = aiohttp.CookieJar(unsafe=True)
    connector = aiohttp.TCPConnector(ssl=connector_ssl, limit=0, force_close=False)

    async with aiohttp.ClientSession(
        timeout=timeout, cookie_jar=jar, connector=connector
    ) as session:
        client = Client(
            base_url=args.base_url, session=session, recorder=recorder, started=started
        )

        # Stagger sign-in across the ramp window so 300 users do not all hash a
        # password in the same second unless that is what is being measured.
        if args.ramp_up > 0:
            await asyncio.sleep(args.ramp_up * (index / max(1, args.users)))

        if args.mode == "login-storm":
            client.phase = "steady"
            while time.perf_counter() < deadline:
                ok = await client.login(email, password, scenario="login_storm")
                if not ok:
                    failures["login"] += 1
                session.cookie_jar.clear()
                await asyncio.sleep(rng.uniform(args.think_min, args.think_max))
            return

        if not await client.login(email, password):
            failures["login"] += 1
            return
        client.phase = "steady"

        if args.mode == "files":
            weights = {"E_files": 1}
        elif args.mode == "db-write":
            weights = {"C_assessment": 1}
        else:
            weights = args.weights

        names = list(weights)
        relative = list(weights.values())

        while time.perf_counter() < deadline:
            choice = rng.choices(names, weights=relative, k=1)[0]
            try:
                await SCENARIOS[choice](client, catalogue, rng)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - counted, never hidden
                failures[f"scenario_{type(error).__name__}"] += 1
            await asyncio.sleep(rng.uniform(args.think_min, args.think_max))


# ------------------------------------------------------------------ summary


def summarise(
    *, args: argparse.Namespace, recorder: Recorder, wall_seconds: float, failures: Counter
) -> dict:
    steady = [s for s in recorder.samples if s.phase == "steady"]
    warmup = [s for s in recorder.samples if s.phase == "warmup"]

    def block(samples: list[Sample]) -> dict:
        if not samples:
            return {"requests": 0}
        durations = [s.ms for s in samples]
        ok = [s for s in samples if 200 <= s.status < 400]
        timeouts = [s for s in samples if s.error == "timeout"]
        conn = [s for s in samples if s.error.startswith(("conn_", "os_"))]
        server = [s for s in samples if 500 <= s.status < 600]
        client_err = [s for s in samples if 400 <= s.status < 500]
        span = max((s.t for s in samples), default=0) - min((s.t for s in samples), default=0)
        span = span or wall_seconds or 1.0
        return {
            "requests": len(samples),
            "successful": len(ok),
            "errors": len(samples) - len(ok),
            "error_percent": round(100 * (len(samples) - len(ok)) / len(samples), 3),
            "http_5xx": len(server),
            "http_4xx": len(client_err),
            "timeouts": len(timeouts),
            "connection_errors": len(conn),
            "requests_per_second": round(len(samples) / span, 2),
            "bytes_total": sum(s.bytes for s in samples),
            "throughput_mbit_per_second": round(
                (sum(s.bytes for s in samples) * 8) / span / 1_000_000, 3
            ),
            "latency_ms": {
                "mean": round(statistics.fmean(durations), 2),
                "p50": round(percentile(durations, 0.50), 2),
                "p90": round(percentile(durations, 0.90), 2),
                "p95": round(percentile(durations, 0.95), 2),
                "p99": round(percentile(durations, 0.99), 2),
                "max": round(max(durations), 2),
            },
        }

    by_label: dict[str, dict] = {}
    grouped: dict[str, list[Sample]] = defaultdict(list)
    for sample in steady:
        grouped[f"{sample.scenario}:{sample.label}"].append(sample)
    for key, samples in sorted(grouped.items()):
        durations = [s.ms for s in samples]
        ok = sum(1 for s in samples if 200 <= s.status < 400)
        by_label[key] = {
            "requests": len(samples),
            "error_percent": round(100 * (len(samples) - ok) / len(samples), 3),
            "p50": round(percentile(durations, 0.50), 2),
            "p95": round(percentile(durations, 0.95), 2),
            "p99": round(percentile(durations, 0.99), 2),
            "bytes_mean": round(statistics.fmean([s.bytes for s in samples]), 1),
        }

    # Ten-second buckets, so burst recovery is visible rather than averaged out.
    buckets: dict[int, list[Sample]] = defaultdict(list)
    for sample in steady:
        buckets[int(sample.t // 10) * 10].append(sample)
    series = []
    for second in sorted(buckets):
        rows = buckets[second]
        durations = [s.ms for s in rows]
        ok = sum(1 for s in rows if 200 <= s.status < 400)
        series.append(
            {
                "t": second,
                "requests": len(rows),
                "rps": round(len(rows) / 10, 2),
                "error_percent": round(100 * (len(rows) - ok) / len(rows), 3),
                "p95_ms": round(percentile(durations, 0.95), 2),
            }
        )

    status_counts = Counter(s.status for s in recorder.samples)
    error_counts = Counter(s.error for s in recorder.samples if s.error)

    return {
        "label": args.label,
        "mode": args.mode,
        "concurrent_users": args.users,
        "duration_seconds": args.duration,
        "ramp_up_seconds": args.ramp_up,
        "think_seconds": [args.think_min, args.think_max],
        "wall_seconds": round(wall_seconds, 2),
        "base_url": args.base_url,
        "steady_state": block(steady),
        "warmup_including_login": block(warmup),
        "by_endpoint": by_label,
        "time_series_10s": series,
        "status_counts": {str(k): v for k, v in sorted(status_counts.items())},
        "error_counts": dict(error_counts.most_common()),
        "harness_failures": dict(failures),
    }


# --------------------------------------------------------------------- main


async def run(args: argparse.Namespace) -> int:
    connector_ssl: object = False if args.insecure else None

    started = time.perf_counter()
    recorder = Recorder()
    failures: Counter = Counter()

    # One probe session discovers the content ids every virtual user will use.
    probe_jar = aiohttp.CookieJar(unsafe=True)
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=args.timeout),
        cookie_jar=probe_jar,
        connector=aiohttp.TCPConnector(ssl=connector_ssl),
    ) as session:
        probe = Client(
            base_url=args.base_url, session=session, recorder=Recorder(), started=started
        )
        if not await probe.login(bench_email(1), bench_password(args.password_seed)):
            print(
                "FATAL: could not sign in as "
                f"{bench_email(1)}. Has bench/seed_bench_data.py run against this "
                "deployment, and does --password-seed match?",
                file=sys.stderr,
            )
            return 2
        catalogue = await discover(probe)

    print(f"catalogue: {catalogue.describe()}", flush=True)
    if not catalogue.ok():
        print(
            "FATAL: the deployment returned no quizzes, learning objects or files. "
            "Load the benchmark dataset before measuring; an empty database "
            "measures nothing.",
            file=sys.stderr,
        )
        return 2
    if args.mode == "files" and not catalogue.file_view_urls:
        print("FATAL: --mode files needs deliverable files; none were found.", file=sys.stderr)
        return 2

    deadline = time.perf_counter() + args.duration + args.ramp_up
    tasks = [
        asyncio.create_task(
            virtual_user(
                index=index,
                args=args,
                recorder=recorder,
                catalogue=catalogue,
                connector_ssl=connector_ssl,
                deadline=deadline,
                started=started,
                failures=failures,
            )
        )
        for index in range(args.users)
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    wall = time.perf_counter() - started

    summary = summarise(args=args, recorder=recorder, wall_seconds=wall, failures=failures)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2, sort_keys=True)
        if args.samples_out:
            with open(args.samples_out, "w", encoding="utf-8") as handle:
                for sample in recorder.samples:
                    handle.write(json.dumps(asdict(sample)) + "\n")

    print(json.dumps(summary, indent=2, sort_keys=True))

    steady = summary["steady_state"]
    if not steady.get("requests"):
        print("FATAL: no steady-state requests were recorded.", file=sys.stderr)
        return 2
    return 0


def parse_weights(raw: str) -> dict[str, int]:
    if not raw:
        return dict(DEFAULT_WEIGHTS)
    weights: dict[str, int] = {}
    for part in raw.split(","):
        name, _, value = part.partition("=")
        name = name.strip()
        if name not in SCENARIOS:
            raise SystemExit(f"Unknown scenario '{name}'. Known: {', '.join(SCENARIOS)}")
        weights[name] = int(value)
    if not weights or sum(weights.values()) <= 0:
        raise SystemExit("Scenario weights must sum to a positive number.")
    return weights


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lock-in closed-loop load generator.")
    parser.add_argument("base_url", help="e.g. https://lockin.example")
    parser.add_argument("--users", type=int, default=25, help="Concurrent virtual users.")
    parser.add_argument("--duration", type=int, default=300, help="Steady-state seconds.")
    parser.add_argument("--ramp-up", type=int, default=30, help="Seconds to stagger sign-in over.")
    parser.add_argument("--think-min", type=float, default=2.0)
    parser.add_argument("--think-max", type=float, default=6.0)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--account-pool", type=int, default=2000)
    parser.add_argument("--password-seed", default="lockin-capacity-2026")
    parser.add_argument(
        "--mode",
        choices=("mixed", "files", "db-write", "login-storm"),
        default="mixed",
    )
    parser.add_argument(
        "--weights",
        default="",
        help="Override scenario mix, e.g. A_browsing=40,B_content=30,C_assessment=20,D_search=10",
    )
    parser.add_argument("--label", default="")
    parser.add_argument("--out", default="", help="Write the summary JSON here.")
    parser.add_argument("--samples-out", default="", help="Write per-request JSONL here.")
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Skip TLS verification. Needed for a self-signed staging certificate.",
    )
    args = parser.parse_args()
    args.weights = parse_weights(args.weights)
    if not args.label:
        args.label = f"{args.mode}-{args.users}u"
    if args.users < 1:
        raise SystemExit("--users must be at least 1.")
    if args.think_min < 0 or args.think_max < args.think_min:
        raise SystemExit("--think-min/--think-max must describe a valid range.")
    return args


def main() -> int:
    args = parse_args()
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or newer is required.")
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
