# Phase 11 - Production Readiness

Last updated: 2026-07-19

Status: implementation complete; awaiting owner review

## Outcome

Phase 11 supplies a repeatable single-host production baseline without adding product features or
distributed infrastructure. The deployment is a modular-monolith topology: Nginx serves the PWA
and terminates TLS, Gunicorn serves Django/DRF, and PostgreSQL is reachable only on an internal
network. Static files and media remain separate private volumes; Nginx never serves private media.

The implementation is production-prepared, not a claim that the current workstation has executed
the container/PostgreSQL gates. Docker, PostgreSQL, and `psql` are unavailable locally. The CI
workflow now executes the PostgreSQL 18.4 release/preflight path and builds/validates both images.
A successful CI run and staging restore/load exercise remain launch gates.

## Production topology

- `edge`: non-root Nginx, TLS 1.2/1.3, strict response headers, bounded bodies/rates, SPA/PWA assets,
  `/api/` proxy, and no public Django Admin route.
- `backend`: non-root, read-only Gunicorn container with bounded workers, threads, timeouts, and
  request recycling. It receives only trusted proxy traffic.
- `release`: one-shot migration-owner task that runs deploy checks, migrations, static collection,
  and least-privilege grants.
- `preflight`: one-shot runtime-role task that rejects elevated roles, schema creation, mutable audit
  records, unapplied migrations, unsafe published files, or missing collected static assets.
- `db`: PostgreSQL 18.4 with checksums and SCRAM; no host port; separate owner/runtime credentials.
- persistent volumes: PostgreSQL data, collected static assets, and private media.

No Redis, Celery, WebSockets, broker, scheduler, microservice, or background worker was introduced.

## Configuration and secret contract

- Development, test, and production settings have explicit environment identities.
- Production starts only with an explicit HTTPS origin/hosts, policy version, SMTP configuration,
  PostgreSQL connection, runtime role, trusted proxy contract, and strong secret.
- Secret values support `NAME_FILE` mounts and cannot be supplied both directly and by file.
- Committed `.env.production.example` contains paths and non-secret examples only.
- PostgreSQL TLS may be disabled only for the declared private Compose network. External databases
  must use verified TLS and an approved CA root.
- Production uses secure `__Host-` session/CSRF cookies. CSRF is HttpOnly; the same-origin client
  obtains its token through the explicit CSRF endpoint.
- API schema/docs are disabled in production. Payment remains fail-closed with
  `PAYMENT_PROVIDER=none` until an approved production adapter exists.

## Security changes

- Uploads enter `pending` when clean-scan evidence is mandatory. Pending, failed, and quarantined
  files cannot be published or delivered.
- Duplicate registration returns the same accepted response without disclosing whether an email is
  already registered, including the model-validation and database-race paths.
- The provider webhook endpoint is absent when no provider is configured and rejects mismatched
  provider paths.
- Nginx enforces CSP, clickjacking protection, MIME sniffing protection, a strict referrer policy,
  capability restrictions, TLS, body limits, and edge throttles.
- Runtime PostgreSQL grants exclude schema creation and audit mutation. Release and runtime
  credentials are never interchangeable.

See `SECURITY_REVIEW.md` for the repository-grounded review and accepted/open launch gates.

## Database readiness

- Production settings require PostgreSQL and configure health checks, connection lifetime,
  statement/lock/idle-transaction timeouts, and TLS policy.
- `release` owns DDL and static collection. The application role owns ordinary CRUD only.
- Preflight captures PostgreSQL version/current-role/privilege evidence and requires PostgreSQL 16+.
- Existing constraints/indexes have PostgreSQL-only readiness tests, including row-lock behavior.
- Query regressions bound live health to zero queries, readiness to one query, and a 100-entry search
  response to at most three queries.
- CI runs migrations and the complete test suite on PostgreSQL 18.4, then release as owner and
  preflight as runtime.

## Reliability and recovery

- Health is split into minimal liveness and database-aware readiness.
- Containers are non-root, capability-free, read-only where possible, health-checked, and given
  bounded graceful shutdown intervals.
- `backup-postgres.sh` creates a restrictive custom-format dump, validates its catalog, and writes a
  SHA-256 sidecar.
- `verify-postgres-restore.sh` verifies the checksum and restores into a disposable database before
  checking migration history.
- Media require a coordinated encrypted volume/object snapshot; database and media restore points
  must share a recorded backup-set identifier.
- Rollback is image-first. Schema rollback requires an explicitly reviewed reverse migration or a
  verified restore; production must never use ad-hoc destructive rollback commands.

See `BACKUP_RECOVERY.md` and `DEPLOYMENT_CHECKLIST.md`.

## CI/CD safety

The single quality gate requires all of these jobs:

1. backend lint, formatting, strict typing, migration drift, PostgreSQL tests, release, and preflight;
2. frontend lockfile install, production dependency audit, lint, typecheck, coverage, build, and
   bundle budgets;
3. full desktop/mobile Chromium Playwright regression;
4. backend/edge image builds, Nginx configuration validation, and Compose contract validation.

A failed or cancelled dependency makes the final gate fail. Deployment is intentionally outside CI
until the hosting target, registry, secret manager, monitoring provider, and rollback authority are
approved.

## Measured validation

- Backend: 180 passed, 2 PostgreSQL-only skipped locally, 85.14% branch-aware coverage.
- Frontend: 29 files / 158 tests passed; 90.87% statements, 80.39% branches, 87.21% functions,
  95.18% lines.
- PWA production build: 5.73 seconds isolated and 3.73 seconds on the final warm rebuild check;
  container cold start remains unmeasured locally.
- Gzip budgets: initial JS 110,041 B / 184,320 B; largest lazy JS 133,564 B / 204,800 B;
  PDF worker 364,728 B / 512,000 B; CSS 15,625 B / 81,920 B.
- Playwright: HTTP 200 after the required startup wait; 32 passed and 2 intentional project skips
  across desktop/mobile Chromium, including Axe, responsive, RTL, Focus, assessment, and operations.
- Ruff, format, strict mypy (424 source files), Django checks, migration drift, compile checks, YAML
  parsing, and production deploy checks passed.
- Production deploy check reports 96 inherited OpenAPI schema warnings plus the deliberately
  accepted HSTS-preload warning; no Lock-in production check Error was present.

## Skills used

- `security-best-practices`: supplied the Django/Python and React/TypeScript secure-default review
  criteria and the numbered `SECURITY_REVIEW.md` format.
- `playwright`: supplied the production-bundle browser verification workflow, desktop/mobile
  execution, and observable startup/teardown discipline.

No newly discovered Skill was used without notice. There remains no installed dedicated Skill for
Django architecture, DRF, PostgreSQL, PWA architecture, or load testing.

## Honest launch gates

- Obtain a green remote CI run, including PostgreSQL and container jobs.
- Run staging release/preflight with production-equivalent TLS, SMTP, secrets, and storage.
- Integrate and validate malware scanning before enabling file ingestion.
- Select provider-neutral metrics/error destinations and verify alerts, retention, and privacy.
- Verify database and coordinated media restore; record observed RPO/RTO.
- Run representative authenticated and write-heavy load scenarios and size Gunicorn/PostgreSQL from
  evidence. The bounded HTTP probe is tooling, not a 2,000-concurrent-user claim.
- Select durable media/object storage and CDN strategy before multi-host scale-out.
- Resolve or formally accept the inherited OpenAPI warning backlog before publishing external SDKs.

## Stop condition

Phase 11 stops here. Do not begin the final UI/UX Polish phase without explicit owner approval.
