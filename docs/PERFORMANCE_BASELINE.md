# Production Performance Baseline

Last updated: 2026-07-19

## Measured local evidence

| Measure | Result | Gate |
|---|---:|---:|
| Frontend production build | 5.73 s isolated; 3.73 s final warm check | informational baseline |
| Initial JavaScript gzip | 110,041 B | <= 184,320 B |
| Largest lazy JavaScript gzip | 133,564 B | <= 204,800 B |
| PDF worker gzip | 364,728 B | <= 512,000 B |
| CSS gzip | 15,625 B | <= 81,920 B |
| Live health query count | 0 | exactly 0 |
| Ready health query count | 1 | exactly 1 |
| 100-entry search response | <= 3 queries | <= 3 |
| Frontend tests | 158 passed | all pass |
| Backend tests | 180 passed, 2 PostgreSQL-only local skips | all runnable pass |
| Browser tests | 32 passed, 2 intentional project skips | no failures |

The PDF worker was initially missed by a `.js`-only measurement. Phase 11 corrected the budget
script to measure `.mjs` and fail if a worker is absent. The number above is the corrected evidence.

## Runtime controls

- Gunicorn uses bounded `gthread` workers/threads, timeouts, keepalive, graceful timeout, and
  jittered request recycling. Defaults are starting values, not final capacity sizing.
- PostgreSQL connections use health checks, bounded age, statement/lock/idle-transaction timeouts,
  aligned indexes, constraints, and explicit runtime privileges.
- Nginx provides keepalive, gzip, bounded timeouts/body sizes, private API proxying, and immutable
  caching for hashed assets.
- Focus PDF rendering stays lazy/virtualized and the worker remains a separate non-preloaded asset.
- PWA caches public shell assets only, never private API responses.

## Load probe

`scripts/performance/http_probe.py` is a bounded HTTPS/localhost probe that reports success/error
counts, throughput, and mean/p50/p95/p99/max latency. Example:

```sh
python scripts/performance/http_probe.py https://staging.lockin.example \
  --path /api/v1/health/ready --requests 500 --concurrency 25 --max-p95-ms 250
```

Use health only to validate edge/application overhead. It is not representative learning traffic.
Authenticated search, dashboard, Focus autosave, quiz autosave/submit, community, notification, and
operations/report workloads require seeded staging scenarios and explicit test accounts.

## Missing capacity evidence

This workstation has no Docker/PostgreSQL service. No 2,000-concurrent-active-user claim is made.
Container/backend cold start is therefore not measured locally; frontend build time is not a cold
service-start substitute.
Before launch, run production-equivalent PostgreSQL and edge tests with representative data and
workload mix, collect API p50/p95/p99, query counts/plans, DB locks/connections/CPU/IO, Gunicorn
queue/worker memory, container memory/cold-start, frontend Web Vitals, PDF memory, error rate, and
recovery behavior. Size workers/pools only from those measurements.

Suggested sequence: single-user correctness baseline, read-heavy ramp, authenticated mixed ramp,
write/idempotency concurrency, soak, spike, dependency degradation, recovery. Stop on correctness,
data-integrity, or error-budget failure; never trade grading/payment/progression correctness for RPS.
