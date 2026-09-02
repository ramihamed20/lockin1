# Production readiness history

Last updated: 2026-09-02

A record of the defects found while making this repository's CI pipeline pass
end to end for the first time, and of the safeguards that now hold each one
closed. It exists so that a future change does not quietly reintroduce them.

## Why so much was hidden

The pipeline had never been green on this branch. Every job stopped at its first
failing step, and **every step after that point had never executed**. So each fix
did not merely resolve one defect; it ran a stretch of infrastructure for the
first time and revealed the next.

That is the single most useful thing to understand here. Ten of the eighteen
issues below were invisible for exactly this reason, not because they were
subtle. Their fixes are small. Finding them required getting the barrier in
front of them out of the way.

A note on counting: an interim summary during this work said "13 issues". That
was a coarser grouping of the CI and test findings. Counted as distinct defects
with distinct fixes, it is **18**. None of them were introduced by this work;
all predate it.

### Verified vs assumed

Everything below is stated as one or the other, deliberately.

- **Verified** means reproduced locally, or observed directly in a CI log, or
  read out of the source of the tool concerned.
- **Assumed** means a plausible explanation that was *not* confirmed. There is
  exactly one such item, in Known Limitations.

---

# Production and runtime defects

These would have failed in production. Four of the five prevented a container
from building or starting at all.

## 1. The edge container could not start with capabilities dropped

**Root cause.** nginx creates its temporary-path directories at start-up and, if
the master runs as root with a `user` directive set, chowns each one to that
user. The edge service runs with `cap_drop: ALL`, which removes `CAP_CHOWN`, and
its `/tmp` is a fresh tmpfs on every boot, so the directories never already
exist and the chown always runs. It fails with `EPERM` and nginx exits before
binding a port.

**Verified** against nginx's own source rather than inferred: `ngx_create_paths()`
skips the chown entirely when the configured user is unset (`src/core/ngx_file.c`),
and nginx leaves it unset whenever the master is not root (`src/core/nginx.c`).

**Why it was hidden.** Neither `docker build` nor `nginx -t` exercises a
read-only root filesystem with dropped capabilities. Nothing in CI had ever
started this container.

**Production impact.** The edge would have failed on its first boot on the
deployment host — the worst possible moment to discover it.

**Fix.** Run the master unprivileged: the image creates a `lockin` user at
uid/gid 10001 and sets `USER 10001:10001`, and the `user` directive is removed
from `nginx.conf`. This removes the operation rather than relaxing the
restriction.

**Capabilities were deliberately not added back.** Granting `CAP_CHOWN` would
have made the container start while leaving a root nginx master inside a
hardened container — trading a real security property for a workaround. The
unprivileged master needs no capability at all: both listeners are above 1024,
so binding needs none either. The read-only root, `cap_drop: ALL`,
`no-new-privileges`, and the single declared tmpfs are all unchanged.

**Consequence to remember.** The TLS certificate and key must be readable by
uid 10001. A root-owned `0600` key cannot be read and the edge will not start.
This is documented in `docs/DEPLOYMENT.md` and must be repeated in any
certificate renewal hook.

**Protected by.** `scripts/ci/edge-smoke.sh`, run by the `edge-runtime` CI job.
It starts the real image with the production security options and asserts the
container stays up, runs as uid 10001, **attempts no chown**, keeps its
temporary paths writable, reads the private key, serves `/healthz` on both
listeners, proxies the API, serves the SPA, and keeps the admin route closed.
The script is also runnable on a deployment host before a first boot.

## 2. PostgreSQL rejected the row locks in 27 queries

The most serious defect found. Covered in depth below under
[The PostgreSQL locking incident](#the-postgresql-locking-incident).

## 3. A status field could not hold its own default value

**Root cause.** `NotificationCampaignDelivery.in_app_status` and `.email_status`
were `CharField(max_length=12)` with `default="not_requested"` — a 13-character
string. The field could never store its own default.

**Why it was hidden.** SQLite ignores a declared `VARCHAR` length and accepts the
value. PostgreSQL raises `DataError`. The PostgreSQL suite had never run.

**Production impact.** Real. Every campaign delivery row failed to insert, which
closed the notification campaign dispatch path entirely — including the
scheduled job that runs on the operations scheduler.

**Fix.** Widened both fields to `max_length=20`, clearing the longest value in
use, with migration `0003_alter_notificationcampaigndelivery_email_status_and_more`.
Widening a `varchar` is a metadata-only change in PostgreSQL: no table rewrite,
no long lock.

**Protected by.** The `backend` job's PostgreSQL suite, which now runs.

## 4. The single-image build referenced a directory Debian never creates

**Root cause.** The image chowned `/var/cache/nginx`, which is the Alpine and
official-nginx-image convention. That stage is Debian-based with nginx from
`apt`, and Debian's package compiles its temporary paths under `/var/lib/nginx`
and creates no cache directory.

**Why it was hidden.** The job that builds this image had never run to
completion in CI.

**Production impact.** The container-host image could not be built at all.

**Fix.** Removed the path from the chown list rather than creating it. It
appears nowhere else in the repository, and the configuration sets no
`proxy_cache_path` and overrides no `*_temp_path`, so `/var/lib/nginx` covers
what nginx actually writes.

**Protected by.** The `container-runtime` job, which builds the image.

## 5. The single-image entry point set a duplicate nginx directive

**Root cause.** The entry point redirected the pid file with
`nginx -g "pid /tmp/nginx.pid;"`, because `/run` is not writable by the
unprivileged master. Debian's `nginx.conf` already declares a `pid` directive,
and nginx rejects a duplicate `pid` outright rather than letting the later one
win. (`error_log` survived only because nginx does permit repeats of that one.)

**Why it was hidden.** Same as issue 4 — the image had never started in CI.

**Production impact.** The container-host image failed its configuration test
and exited on start-up.

**Fix.** The override now replaces the declaration instead of standing beside
it: the image rewrites the pid path in `nginx.conf`, and the entry point stops
injecting it. Debian's `user` directive is removed at the same point, which also
clears the warning it emitted. Both edits are guarded by `grep`, so a future
base-image change that breaks the assumption fails the **build** rather than the
container.

**Protected by.** `scripts/ci/docker-smoke.sh`, run by `container-runtime`,
which starts the image and reads the nginx master's uid from the pid file.

---

# Security issues

## 6. Known vulnerabilities in a pinned dependency

**Root cause.** `djangorestframework` was pinned to 3.17.1, against which
`pip-audit` reports CVE-2026-73228 and CVE-2026-73229. Both are fixed in 3.17.2.

**Why it was hidden.** The `backend` job's static-analysis step, which runs
`pip-audit --strict`, was failing and had not been read closely.

**Production impact.** Two published advisories against a dependency in the
serving path.

**Fix.** Took the patch release, 3.17.2.

**Protected by.** `pip-audit . --strict` in the `backend` job, which fails the
build on any known advisory. This gate works and should not be relaxed.

---

# The PostgreSQL locking incident

Recorded separately because it is the most instructive failure here, and the
easiest to reintroduce.

## What happened

Twenty-seven queries combined `select_for_update()` with `select_related()`
across a **nullable** foreign key. Django compiles a nullable relation to a
`LEFT OUTER JOIN`, and PostgreSQL refuses to lock the nullable side:

```
NotSupportedError: FOR UPDATE cannot be applied to the nullable side of an outer join
```

The first PostgreSQL run of the suite produced **123 failures**, spread across
moderation, progress, questions, review, study plans, payments and a search
performance test. Most traced to a single line in
`sync_subscription_entitlements`, which the shared test helper for creating a
user with a trial calls, so nearly every test hit it.

The sites spanned eight modules: questions, content, assessments, community,
entitlements, education and plan lifecycle.

## Why SQLite did not detect it

This is the part worth internalising.

**SQLite reports `has_select_for_update = False`, so Django discards every
`select_for_update()` instead of emitting it.** The lock is not weakened on
SQLite; it is not there at all. A green SQLite run therefore carries *no
information whatsoever* about row locking, and cannot detect a query that
PostgreSQL rejects outright.

The local suite passed **383 of 383** with all 27 defects present. That number
was real and completely uninformative about this class of defect.

## Production impact

Not a test problem. Production runs PostgreSQL, so these paths raised at
runtime: creating a trial subscription, publishing content, questions or
quizzes, moderating a discussion, moving an education node, and plan lifecycle
changes.

## The fix, and why it is not a weakening

Each of the 27 sites was reviewed individually rather than rewritten
mechanically. In every one, the transaction mutates only the primary row: the
joined row is a version, a space, a parent or a primary user, read for a
permission check or to copy a field. Revision rows written alongside are newly
created, so there is no pre-existing row to hold. Where a related row *is*
read-modify-written — `EntitlementGrant` in `sync_subscription_entitlements` —
it already carries its own separate `select_for_update()`, which was left
untouched.

So `select_for_update(of=("self",))` names exactly the row each transaction
modifies. No `select_for_update()` was removed and nothing that was protected
lost protection.

**Nothing was weakened relative to real behaviour**, because these queries never
executed on PostgreSQL at all — they raised. On SQLite the lock was always
discarded.

**SQLite compatibility is preserved, and this was verified in Django's source
rather than assumed.** In `django/db/models/sql/compiler.py` the `of` validation
is nested inside the `has_select_for_update` guard, which SQLite fails first, so
`of=` never reaches validation there. PostgreSQL sets
`has_select_for_update_of = True`, so it compiles to `FOR UPDATE OF <table>`.

## The rule for future work

**PostgreSQL CI is the authoritative test environment for database locking
behaviour.** A SQLite run is a fast syntax and business-logic check and nothing
more.

- Any change touching `select_for_update()`, `select_related()` over a nullable
  foreign key, or transaction boundaries is **unverified** until the `backend`
  job is green.
- Combining the two across a nullable relation needs `of=("self",)`.
- If a related row is genuinely read-modify-written, lock it explicitly rather
  than widening the join.

This is recorded in three places so it is hard to miss:
`backend/config/settings/test.py` at the SQLite branch,
`backend/README.md` under "Running the tests", and
`docs/PERFORMANCE_BASELINE.md`.

---

# CI and infrastructure issues

None of these are product defects. All of them prevented the pipeline from
telling the truth about the product.

## 7. The nginx configuration lint could not resolve its upstream

**Root cause.** nginx resolves a literal `proxy_pass` hostname while parsing the
configuration, not per request. The lint runs `nginx -t` in an isolated
container with no upstream and no Docker network, so the name did not resolve
and a pure syntax check failed.

**Why it was hidden.** The job failed one step earlier, at the image build.

**Fix.** `--add-host` maps the upstream name to the loopback address so
resolution succeeds. Nothing meaningful is faked: this step lints configuration,
and `edge-runtime` is what proves the proxy carries a real request.

## 8. The release and preflight gates declared no storage contract

**Root cause.** Both gates set the database, mail, payment and observability
contracts but no storage values, so the backend fell back to a filesystem media
backend, which production settings refuse without an explicit exception.

**Why it was hidden.** The `backend` job had never reached these steps.

**Fix.** The gates now declare object storage with well-formed placeholder
values, so they validate the storage shape production uses, including the
querystring-auth check. No bucket is contacted: `release` runs check, migrate
and collectstatic (which writes through the staticfiles backend, not the default
one), and `preflight` reads database evidence, the migration plan and a
scan-state count.

## 9. The smoke test waited for the server, not the database

**Root cause.** `pg_isready` reports success as soon as the postmaster answers,
and "database does not exist" is a normal answer. The PostgreSQL image serves
its socket during the phase *before* it creates the configured database, so the
gate passed inside that window and the next step found no database.

**Why it was hidden.** The script had never executed — the job failed earlier at
the image build.

**Fix.** Wait on a query against the target database, which is the condition the
next step actually depends on.

## 10. The smoke test waited for nginx answering itself, not the API

**Root cause.** The readiness gate polled a health endpoint that nginx answers
from its own configuration. The entry point starts nginx and only *then* execs
the application server, so the endpoint goes up while the application is still
starting. The API assertions raced a socket that was not yet bound — the CI log
showed the connection refused one second before the server bound.

**Why it was hidden.** Same as issue 9.

**Fix.** Wait on both conditions separately, because they are different facts:
the edge serving, then a request that has to reach the application.

**Pattern worth naming.** Issues 9 and 10 are the same mistake: *waiting on
something adjacent to the condition rather than on the condition*. Both let a
gate pass early, and both surfaced later disguised as a different fault.

## 11. A CI script was committed non-executable

**Root cause.** `scripts/ci/docker-smoke.sh` was committed `0644` while the
workflow invokes it directly, which fails with "Permission denied" on a Linux
runner.

**Fix.** Both CI scripts are now `0755` in the index.

## 12. The Playwright browser install hung, and the CI image was changed

**Root cause.** `playwright install --with-deps chromium` installed the font
packages, pulled the browser to a reported 100% of its 167 MB, and then sat on
that step until the job's 30-minute timeout. Twice in a row, with an identical
signature. The step completes in roughly three minutes when healthy.

**Verified**, not assumed, in the sense that it reproduced twice with the same
signature and the same stall point. The precise cause of the stall — a stalled
connection for a subsequent artefact, or extraction — was **not** determined.

**Why it was hidden.** Earlier runs cancelled this job before it could finish,
because the workflow cancels in-progress runs and pushes were frequent. The
first run allowed to sit uninterrupted revealed it. GitHub records a job timeout
as "cancelled", which made it look like something was stopping the run.

**Why caching was rejected.** The stall happens *after* the download completes,
so a browser cache would not have helped: a cold cache still has to make the
call that hangs.

**Fix.** The job runs in the official Playwright container image, which ships
the browser and its system dependencies. Both the download and the apt phase
disappear rather than being retried or waited on. The job now completes in about
3.5 minutes.

**Constraint that must be respected.** The image tag tracks the pinned
`@playwright/test` version exactly. The library refuses browsers it did not
expect, and the image is what supplies them now. **Bump both together, never one
alone.**

---

# Test-only issues

Real defects in the tests, with no production impact. Two of them were actively
concealing product behaviour.

## 13. Closing a streamed response dropped the test's database connection

**Root cause.** Django's test client disconnects `close_old_connections` around
an ordinary response's `close()`, but not around a streamed one — the stream is
closed by the caller, after the handler has restored that receiver. Inside a
test's atomic block the receiver sees autocommit disabled, judges the connection
unusable and closes it. Because the close happens in an atomic block, Django
keeps the closed connection object rather than clearing it, so every later query
in that test fails with "the connection is closed".

**Why it was hidden.** SQLite's backend ignores `close()` for an in-memory
database, which is exactly what the SQLite test path uses.

**Production impact.** None. A real request has no outer atomic block, so
autocommit matches and nothing is closed.

**Fix.** A helper in `backend/apps/files/tests/helpers.py` brackets `close()` the
way Django brackets its own, used at all six streamed closes — rather than
reordering assertions around the hazard.

## 14. The dashboard stylesheet drifted from the layout the tests require

**Root cause.** The scene card's width had drifted at four breakpoints. The unit
test and the stylesheet arrived in the same commit with different numbers.

**Why it was hidden.** The frontend job was failing earlier, so these tests had
never run in CI.

**Worth recording honestly:** this was first fixed in the wrong direction. The
assertions were moved to match the stylesheet, on the reasoning that the
stylesheet was what shipped. When the browser suite ran for the first time it
measured the rendered layout in a real browser and demanded the original
values at every breakpoint, so the change was reversed and the stylesheet
corrected.

**The rule that follows:** where a unit test and an end-to-end test disagree
about rendered geometry, **the end-to-end test is the arbiter.** It measures
`getBoundingClientRect` in a browser; a unit test can only pattern-match source.

## 15. Assertions could not distinguish `height` from `min-height`

**Root cause.** Two assertions read as claims about `height` but matched the
substring inside `min-height`, so the rule could switch between the two without
failing. That is precisely how a fixed height became a minimum unnoticed.

**Fix.** The assertions now name `min-height` explicitly, which is what the
stylesheet declares.

**Note on the layout itself.** The continue card is content-driven by design.
Measured from 320 to 1920 it renders 164 on phones and 196 from tablet upward,
with content at 162 and 194 — so it never overflows, the gap to the list below
is a constant 12px, the columns align at every desktop width, and there is no
horizontal overflow. This was **verified by measurement**, and the end-to-end
expectations were updated to the heights it actually renders rather than
imposing a fixed size. Linux CI and Windows produce the same values.

## 16. A link assertion was ambiguous in production-shaped builds

**Root cause.** A test asked for a link named "Support" while the support
address is itself a link, and the locator matches names by substring, so any
address beginning `support@` also answers to it.

**Why it was hidden.** CI builds the frontend without a support address, so only
the navigation link exists there and the ambiguity never appears. **A build
configured like production does hit it.** It surfaced only because the suite was
run locally against a production-shaped build.

**Fix.** Made the match exact, as the assertion on the following line already
was.

## 17. A CSS-slicing assertion broke on CRLF checkouts

**Root cause.** An assertion sliced the stylesheet using a marker spanning a
newline. On a CRLF checkout the lookup missed, the slice ran to the end of the
file, and the rule matched an unrelated declaration.

**Why it was hidden.** CI checks out LF. It fails only on a Windows working
copy.

**Fix.** Line endings are normalised before slicing. The assertion was sound;
only its input handling was not.

## 18. Three specs drive a storefront that is deliberately withheld

**Root cause.** The storefront is intentionally not shipped: the store page
renders an empty state and the application passes commerce-disabled flags. The
badge and category-strip selectors those specs wait for exist in the stylesheet
and nowhere else.

**Fix.** Skipped behind one documented switch, `STOREFRONT_SHIPPED` in
`frontend/e2e/helpers/storefront.js` — **not deleted**. They encode real
requirements that apply the day the storefront lands: badge contrast at AA in
every theme, and a category strip that moves focus and selection together. Flip
that constant in the same change that ships the storefront and they run as
written.

---

# Current production readiness status

The pipeline is green end to end. Verified on CI run `33670752150`, commit
`ebe154d`.

| Job | Result |
| --- | --- |
| `backend` | success |
| `frontend` | success |
| `browser` | success |
| `containers` | success |
| `container-runtime` | success |
| `edge-runtime` | success |
| `quality-gate` | success |
| `publish` | skipped — it runs only on the default branch, which is correct |

## What the green pipeline actually proves

Stated precisely, because "tests pass" would overstate it:

- **The application runs on PostgreSQL.** The suite executes against a real
  PostgreSQL 18 service, not SQLite, so row locking, column constraints and
  transaction behaviour are exercised.
- **The production start-up contract completes.** The `release` gate runs checks,
  migrations and static collection as the owning database role; the `preflight`
  gate then passes under a least-privilege runtime role that is verified to hold
  no schema-creation privilege and no ability to mutate audit records.
- **The production image starts, not merely builds.** `container-runtime` boots
  the image, confirms it drops privileges, passes preflight, serves a real
  request through nginx, keeps private media off any static route, and completes
  an object-storage round trip.
- **The edge starts under its real security settings.** `edge-runtime` runs the
  edge image with a read-only root, all capabilities dropped, no-new-privileges
  and a single tmpfs, and confirms it attempts no chown, reads its TLS key,
  serves both listeners and proxies the API.
- **Both malware-scanning modes boot.** Preflight passes with clean-scan
  enforcement on and explicitly off, so neither is discovered broken on the host.
- **The interface works in a real browser.** The `browser` job is green. The
  suite was measured at 177 passed and 8 skipped when run locally against the
  same pinned Chromium; the CI job's own counts were not read directly.

## What it does not prove

- Nothing about capacity, throughput or behaviour under load. No load test was
  run.
- Nothing about a live deployment. CI verifies the contract; it does not verify
  a running host.
- The `publish` job has not executed, because it runs only on the default
  branch. Its first run is untested.

---

# Known limitations and things to monitor

## A single observed browser-test timeout

`focus-workspace.spec.js` — the PDF view preferences test — timed out at 30
seconds in one CI run. It **passes locally in about 8 seconds**, and passed in
the green run.

**This is an assumption, not a verified cause:** the most likely explanation is
contention in the container under parallel load. That was not confirmed.

**Do not change it unless it reproduces.** One data point does not justify
raising a timeout or reducing parallelism, and both would mask a real
regression if the cause is something else. If it recurs, diagnose it from the
actual failure rather than adjusting the budget.

## Standing constraints

These are not defects. They are properties that must be preserved.

- **The Playwright image tag and the pinned library version move together.**
  Bumping one alone breaks the browser job.
- **The TLS certificate and key must be readable by uid 10001**, including after
  every renewal.
- **SQLite is not a substitute for PostgreSQL** on anything involving locking,
  column limits or transactions.
- **`pip-audit --strict` is a real gate.** A failing audit means a published
  advisory against a dependency in the serving path.
- **Malware scanning is a stated decision, not a constant.** Production reads it
  from the environment and defaults to enforcing it. Running without a scanner
  is defensible only while managed-file uploads are restricted to trusted
  operators, which the upload permission enforces. Enforcement and the scanning
  profile must be turned on together; see `docs/DEPLOYMENT.md`.
- **CI images are built in CI, never on the deployment host.** The host pulls an
  immutable tag.

## Where the safeguards live

| Safeguard | Location |
| --- | --- |
| Edge starts under production security settings | `scripts/ci/edge-smoke.sh`, `edge-runtime` job |
| Production image starts and serves | `scripts/ci/docker-smoke.sh`, `container-runtime` job |
| PostgreSQL behaviour, release and preflight gates | `backend` job |
| Dependency advisories | `pip-audit --strict`, `backend` job |
| Both scan-enforcement modes boot | `backend` job preflight step |
| Compose contract and scanner profile isolation | `containers` job |
| Rendered layout geometry | `browser` job |
| SQLite's locking blind spot | `backend/config/settings/test.py`, `backend/README.md`, `docs/PERFORMANCE_BASELINE.md` |
