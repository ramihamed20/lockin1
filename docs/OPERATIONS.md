# Lock-in Operations

Last updated: 2026-07-15

## Owner workflow

With Docker Desktop installed:

1. copy `.env.example` to `.env`;
2. replace the example local database password and Django secret;
3. run `docker compose up --build`;
4. open `http://localhost:5173`;
5. stop with `docker compose down`.

Compose is a local development workflow. Its Django `runserver` command is not the production
entrypoint. The backend image defaults to Gunicorn and production deployment will be completed in
the approved deployment phase.

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

## Secrets and logs

- Commit `.env.example`; never commit `.env`.
- Never place secrets in `VITE_` variables because those values are public in browser bundles.
- Logs are JSON and include request ID, but code must never log passwords, cookies, tokens, reset
  links, answer keys, request bodies, or full personal records.
- Production hosts cannot contain `*`.
- Proxy SSL headers are trusted only when explicitly enabled behind a proxy known to strip spoofed
  inbound headers.

## Current workstation limitation

The Phase 3 workstation has Python 3.11 and Node 24 but no Docker, PostgreSQL server, or `psql`.
Backend unit/integration behavior was verified with the explicit SQLite fast-test switch. The CI
workflow is configured to run the same migrations and suite against PostgreSQL 18.4. A successful
remote CI run or a future local Docker run remains required evidence before claiming PostgreSQL
execution on this workstation.
