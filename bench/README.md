# Lock-in capacity benchmark harness

Benchmark tooling for answering one question with measurements rather than
reasoning: **how many concurrent active users does Lock-in support on a
2 vCPU / 4 GB / 2 GB swap / 40 GB VPS?**

Nothing here modifies the application. The harness adds files under `bench/`
only. It runs the real production images, the real `compose.production.yaml`,
the real Gunicorn sizing and the real nginx edge. The only deviations from a
production deployment are listed under [What this changes](#what-this-changes),
and all three are measurement instruments rather than behaviour changes.

---

## What you need

Two Linux hosts. This matters more than anything else in this document.

| Host | Role | Spec |
| --- | --- | --- |
| **SUT** (system under test) | Runs the Lock-in containers | Exactly the VPS you are evaluating: 2 vCPU, 4 GB RAM, 2 GB swap, 40 GB SSD |
| **LOAD** | Runs the load generator | Anything with ≥2 cores and good network to the SUT. A second cheap VPS in the same region is ideal |

**Do not run the load generator on the SUT.** Driving 300 virtual users costs
real CPU. On two shared cores the generator would starve the application, and
every latency number you collected would be measuring your own test harness.
If you have no choice, the harness still runs, but the report must say the
results are contaminated and are a lower bound only.

Both hosts need Python 3.10+. The SUT needs Docker and Docker Compose. Install
`sysstat` on the SUT for disk metrics (`apt install sysstat`); without it the
disk rows say `not measured` rather than guessing.

---

## Files

| File | Runs on | Purpose |
| --- | --- | --- |
| `setup-limits.sh` | SUT | Creates a cgroup v2 slice enforcing 2 vCPU / 4 GB / 2 GB swap **in aggregate**, for when the test host is larger than the target VPS. Also prints the enforcement evidence the report needs. |
| `compose.bench.yaml` | SUT | Overlay on `compose.production.yaml`: PostgreSQL tuning, measurement instruments, and the one-shot data loader service. |
| `seed_bench_data.py` | SUT (in a container) | Loads a realistically populated dataset under production settings. |
| `collect.sh` | SUT | Samples host, cgroup, container and PostgreSQL state during a run. |
| `loadgen.py` | LOAD | Closed-loop, session-authenticated, weighted-scenario load generator. |
| `run_suite.sh` | LOAD | Orchestrates ramp / burst / soak / files / login / dbwrite stages. |
| `report.py` | either | Turns a results directory into the measured sections of the report. |

---

## Procedure

### 1. Bring up production on the SUT

Follow `docs/DEPLOYMENT.md` "Phase 2 — deploy to a VPS" exactly, including the
2 GB swapfile and `vm.swappiness=10`. Use `COMPOSE_PROFILES=bundled-db` — the
launch shape. Leave the `file-scanning` profile **off**; ClamAV needs more
memory than everything else combined and is not part of the launch.

```bash
cd /srv/lockin
export COMPOSE_PROFILES=bundled-db
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml up -d
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml ps
```

The `db` service must come up with the overlay's `command:`. Confirm the tuning
actually applied — an untuned 128 MB `shared_buffers` would make every
subsequent number wrong:

```bash
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml exec db \
  psql -U lockin_owner -d lockin -c \
  "SELECT name, setting FROM pg_settings WHERE name IN
   ('shared_buffers','effective_cache_size','work_mem','max_connections',
    'shared_preload_libraries','track_io_timing');"
```

Then create the statistics extension once:

```bash
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml exec db \
  psql -U lockin_owner -d lockin -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

### 2. Enforce the envelope (only if the SUT is bigger than the target)

On a real 2 vCPU / 4 GB VPS, skip the `create` and just record the evidence:

```bash
sudo bench/setup-limits.sh verify
```

On a larger machine, create the slice first, then restart so the containers
join it:

```bash
sudo bench/setup-limits.sh create
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml up -d --force-recreate
sudo bench/setup-limits.sh verify
```

`verify` prints `cpu.max`, `memory.max` and `memory.swap.max`. Those three
lines are the proof that the constraint bound. Put them in the report. During
the run, `cpu.nr_throttled` in the collected samples shows whether the CPU
ceiling was actually being hit — a nonzero and rising count is direct evidence
of CPU saturation, not an inference from a percentage.

### 3. Load the dataset

```bash
export LOCKIN_BENCH_ALLOW=yes
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml \
  --profile bench run --rm seed-bench \
  --users 2000 --active-learners 500 --pdf-kb 1024
```

Defaults produce roughly: 2,000 verified accounts each with a real trial and
entitlement grants, 192 lessons, 192 published PDF learning objects of ~1 MiB
each, ~1,536 questions, 60 quizzes, and progress / bookmark / review /
notification / XP history for the first 500 accounts, plus a fully populated
`SearchEntry` + `SearchTerm` index.

The loader refuses to run without `LOCKIN_BENCH_ALLOW=yes`, and refuses again
if the database holds any account that is not a `@bench.invalid` benchmark
account. Read its final summary: if it prints `WARNINGS`, the dataset is not
what was asked for and the results will not mean what you think.

Then update the planner statistics — a benchmark against unanalysed tables
measures the planner guessing:

```bash
docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml exec db \
  psql -U lockin_owner -d lockin -c 'ANALYZE;'
```

### 4. Sanity-check before loading it up

From the LOAD host, prove one user can do one of everything:

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r bench/requirements.txt
python3 bench/loadgen.py https://lockin.example --users 1 --duration 60 --ramp-up 0
```

Read the `by_endpoint` block. Every scenario should appear with a low
`error_percent`. If `C_assessment:attempt-submit` is missing, or anything shows
403, stop — a broken scenario measured at 300 users is 300 users of noise.

Common causes:

- **403 everywhere** — the accounts have no entitlement. Re-check the seeder's
  `trials_created` count.
- **Nothing but `A_browsing`** — the catalogue came back empty. The dataset did
  not load.
- **TLS errors** — pass `--insecure` for a self-signed staging certificate.
- **`DisallowedHost`** — the hostname you are testing is not in
  `DJANGO_ALLOWED_HOSTS`.

### 5. Run the suite

From the LOAD host:

```bash
export LOCKIN_TARGET=https://lockin.example
export LOCKIN_SUT_SSH=root@203.0.113.10
export LOCKIN_SUT_DIR=/srv/lockin
export LOCKIN_RESULTS=bench/results/$(date -u +%Y%m%dT%H%M%SZ)

bench/run_suite.sh ramp      # 10 → 300 users, stops at saturation
bench/run_suite.sh burst     # 100 → 200 → 300 step, then recovery
bench/run_suite.sh dbwrite   # lock and event-fanout path in isolation
bench/run_suite.sh files     # PDF delivery in isolation
bench/run_suite.sh login     # sign-in storm
bench/run_suite.sh soak 100 3600   # one hour at the highest healthy level
```

`ramp` stops climbing when a level exceeds 5% errors or 3 s p95. That is the
saturation point to investigate, not a failed run. Run `soak` at the highest
level that stayed *healthy* (<1% errors, p95 < 500 ms), which is usually one or
two steps below where the ramp stopped.

Passwordless SSH from LOAD to SUT is required for the server-side collector.
Without `LOCKIN_SUT_SSH` the suite still runs, but every CPU, RAM, swap and
PostgreSQL column comes out as `not measured`, which makes the bottleneck
question unanswerable.

### 6. Build the report

```bash
python3 bench/report.py "$LOCKIN_RESULTS" --out "$LOCKIN_RESULTS/REPORT.md"
```

---

## Workload

Five scenarios, every route verified against the application's own `urls.py`.

| Scenario | Weight | What it does |
| --- | ---: | --- |
| `A_browsing` | 35% | `auth/session`, `dashboard`, `education/nodes`, `learning-objects`, `notifications/summary` |
| `B_content` | 25% | `learning/dashboard`, `learning-objects/<id>`, `focus/documents/<id>`, `progress/resume`, `bookmarks` |
| `C_assessment` | 20% | Start attempt → save 5 answers → submit → read result |
| `D_search` | 10% | `search` (single and multi-term), `review-queue`, `review-bank` |
| `E_files` | 10% | `files/<id>/view` — a real ~1 MiB PDF streamed through Gunicorn |

Why this mix: B and C are what a study platform is *for*, and C is the only
path that takes `select_for_update` locks and then dispatches XP, streak,
achievement, ranking and notification handlers synchronously before responding.
E gets 10% despite being rarer per user because of how it is served (see
below) — it is the scenario most likely to fall over first, so it also gets its
own isolated stage.

Override with `--weights A_browsing=40,B_content=30,C_assessment=20,D_search=10`.

### Modes

- `--mode mixed` (default) — the weighted mix above.
- `--mode files` — PDF delivery only.
- `--mode db-write` — the assessment write path only.
- `--mode login-storm` — repeated sign-in. Django verifies passwords with
  PBKDF2, so each sign-in is deliberate CPU work. On two shared cores a term-start
  login peak is a genuinely different workload from steady browsing and deserves
  its own number.

---

## What to look at first

Five things the code says will decide the answer. Each has a specific metric.

1. **Gunicorn has 24 request slots total.** `GUNICORN_WORKERS=3 ×
   GUNICORN_THREADS=8`. Request 25 queues in the kernel backlog.
   *Look at:* the level where p95 rises while host CPU is still below ~70%.
   That gap is queueing, not compute.

2. **PDFs stream through Django, not nginx.** `ManagedFileDeliveryView` returns
   a `StreamingHttpResponse` and the edge sets `proxy_buffering off`. There is
   no `X-Accel-Redirect` and no presigned-URL redirect, so a download holds one
   of those 24 slots for the entire client transfer.
   *Look at:* the `files` stage. The level where throughput stops rising is
   where the thread pool became the limit.

3. **Sessions are database-backed and there is no cache.** No `SESSION_ENGINE`
   override and no `CACHES` block exists in `config/settings/`, so Django uses
   `sessions.backends.db` and a per-process `LocMemCache`. Every authenticated
   request is a PostgreSQL request.
   *Look at:* `pg_top_statements.txt` — a `django_session` SELECT near the top
   by total time confirms it.

4. **Every study request re-checks entitlement.** `SubscriptionProtectedPermission`
   runs `entitlement_decision` for focus, content, files, discovery, progress,
   review, study_plans, questions and assessments — with no cache.
   *Look at:* `entitlements_entitlementgrant` in the top statements.

5. **135 `select_for_update()` sites across 29 apps**, against a 3 s
   `lock_timeout` and a 15 s `statement_timeout`. Those timeouts turn contention
   into HTTP 500s rather than slow pages.
   *Look at:* `waiting_on_lock` and `ungranted_locks` in the PostgreSQL table,
   and any 5xx in the `dbwrite` stage. **Treat sustained timeout-class errors as
   critical even below the 2% band** — a 500 on `attempt-submit` means a
   learner's quiz submission was lost, not merely delayed.

---

## What this changes

Three deviations from a production deployment, all measurement:

1. **PostgreSQL tuning** from `docs/DEPLOYMENT.md` §1c is applied via
   `command:`. This is not a change — it is the documented configuration for a
   4 GB host, which the plain image does not apply by itself.
2. **Measurement is switched on**: `pg_stat_statements`, `track_io_timing`,
   `log_min_duration_statement=500`, `log_lock_waits`. These cost a few percent
   of throughput. Disclose that in the report; do not subtract it.
3. **A one-shot `seed-bench` service** exists in the `bench` profile. Nothing
   depends on it and it never starts on its own.

Application logic, models, APIs, authentication, frontend behaviour, Gunicorn
sizing, worker counts and nginx configuration are untouched.

---

## Honest reporting

The harness is built so a failure cannot quietly become a good-looking number.

- `report.py` writes `not measured` where a collector produced nothing. It never
  interpolates.
- `loadgen.py` exits non-zero and prints `FATAL` if it cannot sign in, if the
  catalogue is empty, or if no steady-state request was recorded — rather than
  reporting a fast, empty run.
- Warm-up and login are recorded but excluded from steady-state percentiles, and
  reported separately as `warmup_including_login`.
- 4xx and 5xx are counted separately, and timeouts and connection errors are
  counted separately again, so "errors" never hides what kind.
- `collect.sh` resets `pg_stat_statements` at the start of each level, so level
  300's query profile describes level 300 and not the whole session.

If a stage fails, record the failure, find the cause, and re-run. Do not tune
the harness until the number looks better.

---

## Terminology

The report must not blur these.

- **Concurrent active users** — what this harness measures. Virtual users each
  holding at most one in-flight request, with think time between actions.
- **Requests per second** — throughput, reported alongside. Not a user count.
- **Daily active users** — how many distinct people use the product in a day.
  Converting from concurrent users requires a peak-concurrency ratio that only
  real traffic can supply.
- **Registered users** — how many accounts exist. Unrelated to load.

Any conversion between them is an estimate and must be labelled as one in the
final report.
