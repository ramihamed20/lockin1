#!/usr/bin/env python3
import argparse
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from urllib.parse import urljoin, urlparse


@dataclass(frozen=True, slots=True)
class Sample:
    status: int
    duration_ms: float
    bytes_read: int
    error: str = ""


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    index = max(0, math.ceil(len(values) * fraction) - 1)
    return sorted(values)[index]


def request_once(url: str, timeout: float) -> Sample:
    started = time.perf_counter()
    try:
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            status = response.status
        error = ""
    except urllib.error.HTTPError as exception:
        body = exception.read()
        status = exception.code
        error = f"http_{exception.code}"
    except (OSError, TimeoutError) as exception:
        body = b""
        status = 0
        error = type(exception).__name__
    return Sample(
        status=status,
        duration_ms=(time.perf_counter() - started) * 1000,
        bytes_read=len(body),
        error=error,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bounded HTTPS smoke/load probe for Lock-in.")
    parser.add_argument("base_url")
    parser.add_argument("--path", default="/api/v1/health/ready")
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--max-p95-ms", type=float, default=0.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base = urlparse(args.base_url)
    if base.scheme != "https" and base.hostname not in {"127.0.0.1", "localhost"}:
        raise SystemExit("Remote probes require HTTPS.")
    if not 1 <= args.requests <= 100_000 or not 1 <= args.concurrency <= 500:
        raise SystemExit("Requests must be 1..100000 and concurrency must be 1..500.")
    url = urljoin(args.base_url.rstrip("/") + "/", args.path.lstrip("/"))
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        samples = list(
            executor.map(
                lambda _: request_once(url, args.timeout),
                range(args.requests),
            )
        )
    elapsed = time.perf_counter() - started
    durations = [sample.duration_ms for sample in samples]
    successful = [sample for sample in samples if 200 <= sample.status < 400]
    evidence = {
        "url": url,
        "requests": len(samples),
        "concurrency": args.concurrency,
        "successful": len(successful),
        "errors": len(samples) - len(successful),
        "elapsed_seconds": round(elapsed, 3),
        "requests_per_second": round(len(samples) / elapsed, 2),
        "latency_ms": {
            "mean": round(statistics.fmean(durations), 2),
            "p50": round(percentile(durations, 0.50), 2),
            "p95": round(percentile(durations, 0.95), 2),
            "p99": round(percentile(durations, 0.99), 2),
            "max": round(max(durations), 2),
        },
        "failures": [asdict(sample) for sample in samples if sample.error][:10],
    }
    print(json.dumps(evidence, indent=2, sort_keys=True))
    if len(successful) != len(samples):
        return 1
    if args.max_p95_ms and percentile(durations, 0.95) > args.max_p95_ms:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
