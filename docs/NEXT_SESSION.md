# Lock-in Next Session

Last updated: 2026-07-19

## Start Here

Phase 11 Production Readiness is complete and awaiting owner review. Do not begin final UI/UX Polish
unless the owner explicitly approves it.

Read in order:

1. `PHASE_11_PRODUCTION_READINESS.md`
2. `SECURITY_REVIEW.md`
3. `DEPLOYMENT_CHECKLIST.md`
4. `BACKUP_RECOVERY.md`
5. `PERFORMANCE_BASELINE.md`
6. `PRODUCT.md`
7. `ARCHITECTURE.md`
8. `DECISIONS.md`
9. `OPERATIONS.md`
10. `PROGRESS.md`
11. `TODO.md`
12. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 11 isolated validation copy:
  `C:\Users\ramih\.codex\visualizations\2026\07\15\019f6358-a52e-7560-8654-fba70686b18a\phase11-work`

Never modify the reference project.

## Current Implementation

- Branch: `codex/phase-11-production-readiness`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, PWA, PDF.js 5.7.284.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, Gunicorn, modular monolith.
- Production: Nginx 1.28, PostgreSQL 18.4, non-root/read-only containers, internal DB network,
  file-mounted secrets, TLS edge, bounded rates/bodies/timeouts.
- Database: distinct migration owner/runtime roles, explicit release, runtime preflight, audit
  mutation denial, PostgreSQL CI.
- Recovery: hashed PostgreSQL backup, isolated restore verification, coordinated media backup
  runbook, image-first rollback checklist.
- Security: fail-closed file scan evidence, generic duplicate registration, disabled-provider
  webhook closure, secure cookies/origins/proxy/docs, and numbered review.
- Performance: query regressions, gzip budgets, bounded HTTPS probe; no unmeasured capacity claim.
- Focus, AI, payment, notification, and observability provider boundaries remain independent.
- No Redis, Celery, WebSocket, broker, scheduler, worker, or microservice was introduced.

## Validation Snapshot

- Backend: 180 passed, 2 PostgreSQL-only skipped locally, 85.14% coverage.
- Ruff/format, strict mypy across 424 files, Django checks, migration drift, and compile checks passed.
- Production deploy check exited 0 at Error gate; 96 inherited OpenAPI warnings and intentional
  HSTS-preload warning remain visible/tracked.
- Frontend: 29 files / 158 tests passed at 90.87% statements, 80.39% branches, 87.21% functions,
  and 95.18% lines.
- Production PWA build: 5.73s isolated and 3.73s final warm check. Gzip: initial JS 110,041 B, lazy
  JS 133,564 B, PDF worker 364,728 B, CSS 15,625 B; all budgets passed.
- Playwright: preview HTTP 200 after startup wait; 32 passed, 2 intentional project skips, no failures.
- Docker/PostgreSQL/psql/npm network audit are unavailable locally; CI/staging evidence is required.

## Review Focus

1. Verify production settings cannot start with weak/missing secrets, wildcard/HTTP origins,
   untrusted proxy headers, non-PostgreSQL engine, fake provider, or fail-open scan policy.
2. Review Nginx TLS/header/CSP/rate/body/static/API/Admin/private-media boundaries.
3. Review distinct release/runtime credentials, grants, audit denial, release ordering, and preflight.
4. Review fail-closed upload/publish/delivery behavior and scanner launch blocker.
5. Review backup-set coordination, restore verification, migration rollback, and deployment checklist.
6. Review security findings SEC-001..SEC-010 and do not treat accepted/open findings as closed.
7. Confirm CI requires every backend/frontend/browser/container result.
8. Confirm measured local results do not imply PostgreSQL/container/load/RPO/RTO/provider evidence.
9. Confirm no product features or distributed infrastructure slipped into Phase 11.
10. Confirm final UI/UX Polish remains blocked pending explicit approval.

## Outstanding Launch Evidence

- Green remote CI for the exact commit, including PostgreSQL release/preflight and images.
- Production-equivalent staging deploy and TLS/proxy/header/body/replay verification.
- Approved malware scanner and backlog/error alerts before file ingestion.
- Approved metrics/error/log providers, retention/privacy, alerts, and paging drill.
- Coordinated database/media restore drill with measured RPO/RTO.
- Representative authenticated/write-heavy/concurrency/soak and Focus memory tests.
- Hosting, object storage/CDN, registry, secret manager, certificate renewal, and rollback ownership.
- Inherited OpenAPI warning remediation before external schema/SDK publication.

## Stop Condition

Phase 11 is complete. Wait for owner approval before final UI/UX Polish.
