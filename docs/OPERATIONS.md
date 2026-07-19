# Lock-in Operations

Last updated: 2026-07-19

## Owner workflow

With Docker Desktop installed:

1. copy `.env.example` to `.env`;
2. replace the example local database password and Django secret;
3. run `docker compose up --build`;
4. open `http://localhost:5173`;
5. stop with `docker compose down`.

The default Compose file is a local development workflow. Its Django `runserver` command is not the
production entrypoint. Phase 11 adds a separate `compose.production.yaml`; never mix its secrets,
volumes, or commands with local development.

## Production owner workflow

Use `.env.production.example` only as a field inventory. Put real secret values in restrictive
files/secret-manager mounts and reference their paths from `.env.production`.

The production order is database health -> owner `release` -> runtime `preflight` -> backend
readiness -> edge. Release applies migrations/static/grants; preflight verifies PostgreSQL version,
runtime privileges, migration drift, clean published files, and collected static assets. Never run
the long-running backend with owner credentials or bypass failed preflight.

Use `DEPLOYMENT_CHECKLIST.md` for every release, `BACKUP_RECOVERY.md` for backup/restore, and
`SECURITY_REVIEW.md` for open launch blockers. The scanner and monitoring/error providers are not
configured; production file ingestion and launch remain blocked until those controls are proven.

The first production baseline is single-host Compose. PostgreSQL is internal-only; Nginx is the only
public service; private media is delivered through Django authorization. No Redis, Celery, broker,
WebSocket, scheduler, or microservice is part of operations.

## Services

| Service | Local address | Purpose |
|---|---|---|
| Frontend | http://localhost:5173 | Vite/PWA application shell |
| Backend | http://localhost:8000 | Django API |
| PostgreSQL | localhost:5432 | Primary application database |

No Redis, task queue, broker, WebSocket service, or microservice is part of this foundation.

## Account configuration

- Set `ACCOUNT_POLICY_VERSION` to the approved terms/privacy version before accepting registrations.
- Set `PUBLIC_APP_URL` to the HTTPS frontend origin used in verification/reset links.
- Set `DEFAULT_FROM_EMAIL` and a real `DJANGO_EMAIL_BACKEND`; production rejects console/locmem
  email backends.
- Review account link TTLs and scoped throttle windows/limits in `.env.example`.
- Bootstrap and retain at least one active administrator; the API prevents removal of the last one.
- Auth throttle rows are operational data. Define retention cleanup and monitoring before launch.

## Health checks

- `/api/v1/health/live`: proves the Django process can answer without touching the database.
- `/api/v1/health/ready`: performs `SELECT 1` and returns 503 without exposing database detail when
  PostgreSQL is unavailable.
- Both responses include `X-Request-ID` for support correlation.

## Test commands

`scripts/lockin.ps1 test` runs the full local quality command set after the backend environment and
frontend dependencies exist. It expects PostgreSQL through the default test settings.

`scripts/lockin.ps1 test-fast` explicitly sets `LOCKIN_TEST_USE_SQLITE=true`. This is only a fast
workstation unit fallback. It does not replace the PostgreSQL CI job and cannot approve
PostgreSQL-specific constraints, transactions, indexes, or concurrency behavior.

## Environment separation

- `config.settings.local`: developer settings, HTTP cookies, PostgreSQL by default.
- `config.settings.test`: PostgreSQL by default; SQLite only through the explicit fast-test flag.
- `config.settings.production`: DEBUG false, explicit hosts, required secret/database password,
  HTTPS cookies, SSL redirect by default, and opt-in trusted proxy header.

HSTS defaults to zero until the real TLS owner and deployment domain are confirmed. Enabling HSTS
without that deployment knowledge can cause a long outage and is not a safe foundation default.

## Motivation reconciliation and ranking publication

`python manage.py rebuild_motivation` idempotently reconciles committed account, learning, Focus,
assessment, community, moderation, and achievement records into Phase 7 evidence and projections.
It rebuilds XP balances, streaks, achievement progress, ranking facts, and unread counters; it does
not regrade attempts or overwrite source-domain history. Run it after restoring a database or when
monitoring identifies a missed best-effort subscriber effect. Review its output before publishing a
new ranking snapshot.

Ranking publication is an explicit server operation, not a request-time client calculation. Keep
the resulting snapshot status/checksum/error audit. No scheduler or worker is installed in Phase 7;
production scheduling requires an approved operations/deployment decision.

## Commerce configuration and reconciliation

- Keep `PAYMENT_PROVIDER=none` until an implemented, approved production adapter exists.
- `fake` is test/development only; production settings reject it.
- Set a random `PAYMENT_FAKE_WEBHOOK_SECRET` of at least 24 characters only in local/test secret
  storage. Never commit it or expose it through a `VITE_` variable.
- Keep webhook timestamp tolerance and maximum payload settings bounded. Enforce the same or a
  tighter request-body limit at the production reverse proxy.
- Configure `DEFAULT_TRIAL_PLAN_CODE` only to an active published trial plan.
- Run `python manage.py reconcile_commerce` after database restoration or when monitoring shows a
  failed/missed normalized provider-event effect. Review failed events before retrying.
- All commerce Django admin views are read-only. Use domain services or approved operational
  commands; never patch payment/subscription/entitlement rows manually.

Before paid launch, validate the real provider sandbox, webhook secret rotation/replay behavior,
refund/dispute flows, amount/currency/exponent matching, tax/receipt/invoice policy, edge payload
limits, retention, alerts, reconciliation cadence, and PostgreSQL concurrency. No commerce scheduler
or worker exists in Phase 8.

## Secrets and logs

- Commit `.env.example`; never commit `.env`.
- Never place secrets in `VITE_` variables because those values are public in browser bundles.
- Logs are JSON and include request ID, but code must never log passwords, cookies, tokens, reset
  links, answer keys, webhook/raw request bodies, provider secrets, full financial payloads, or full
  personal records.
- Production hosts cannot contain `*`.
- Proxy SSL headers are trusted only when explicitly enabled behind a proxy known to strip spoofed
  inbound headers.

## Current workstation limitation

The Phase 9 workstation has Python 3.11 and Node 24 but no Docker, PostgreSQL server, or `psql`.
Backend unit/integration behavior was verified with the explicit SQLite fast-test switch. The CI
workflow is configured to run the same migrations and suite against PostgreSQL 18.4. A successful
remote CI run or a future local Docker run remains required evidence before claiming PostgreSQL
execution on this workstation.

The signed fake provider validates deterministic local behavior only. It is not evidence for a real
provider, reverse proxy, network retry, dispute, settlement, or production webhook environment.

## Phase 9 operations platform

Daily staff workflows use `/operations`, not Django Admin. Assign the smallest seeded operational
role required: Platform Administrator, Support, Content Manager, Moderator, Finance, or Analytics
Viewer. Role changes, account status changes, report exports, and configuration updates require a
reason and are recorded in the append-only audit domain.

- Use `/api/v1/operations/system-health` for authorized normalized status. Public liveness/readiness
  remain minimal and disclose no internal detail.
- Configure `OBSERVABILITY_SLOW_REQUEST_MS` to the approved slow-request threshold. Default metric
  and error providers are no-ops and intentionally report `not_configured` until a provider is
  approved.
- Run `python manage.py rebuild_operational_analytics --from YYYY-MM-DD --to YYYY-MM-DD` to rebuild
  UTC daily projections from durable analytics facts. The range is capped at 367 days.
- Reports are synchronous and bounded by `reporting.max_export_rows`; preview before execution.
  Scheduling/export delivery requires a later approved worker/scheduler design.
- Configuration contains only allowlisted typed non-secret values. Deployment secrets remain in the
  platform secret store/environment, never in operational configuration or `VITE_` variables.
- Keep audit tables append-only at application and database-role layers. Phase 9 enforces
  application-level immutability; production database grants remain a deployment gate.

The only implemented operational action is `users.set_status`. Preview target/consequence, provide
a reason, confirm, and inspect the result summary/audit. The service blocks self-suspension and loss
of the final administrator, and suspension terminates active sessions.

No Redis, Celery, WebSocket, broker, microservice, BI provider, monitoring provider, scheduler, or
background worker is installed. PostgreSQL concurrency, representative projection/export/action
load, alerts, retention, and database grants must be validated before production launch.
