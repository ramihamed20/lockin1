# Lock-in Next Session

Last updated: 2026-07-18

## Start Here

Phase 9 is implemented and locally validated. Do not begin Phase 10 unless the owner explicitly
approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `PHASE_9_OPERATIONS.md`
3. `DECISIONS.md`
4. `ARCHITECTURE.md`
5. `EVENTS.md`
6. `OPERATIONS.md`
7. `DESIGN.md`
8. `PHASE_8_SUBSCRIPTIONS.md`
9. `PHASE_7_MOTIVATION.md`
10. `FOCUS_MODE.md`
11. `AI_EXTENSION_POINTS.md`
12. `PROGRESS.md`
13. `TODO.md`
14. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 9 isolated validation copy: `C:\tmp\Lockin-Rebuild-Phase9`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-9-operations`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, static-only PWA cache.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL default; SQLite only behind `LOCKIN_TEST_USE_SQLITE=true` for local tests.
- Administration: operational capabilities/roles/assignments, session/resources, three focused
  dashboards, system health, and paginated user management.
- Analytics: idempotent durable facts plus UTC daily metrics/distinct active learners and bounded
  projection rebuild/API.
- Audit: append-only recursively redacted administrative evidence.
- Reporting/actions: bounded preview/confirm/execute with expiring tokens, idempotency, audit, and
  result evidence; only `users.set_status` exists as an operational mutation.
- Configuration: typed allowlisted optimistic versions; secrets prohibited.
- Observability: normalized structured request telemetry, slow-request logging, provider-neutral
  metric/error protocols, and honest no-op providers.
- Frontend: lazy `/operations` shell with separate overview/content/support/users/audit/reports/
  configuration routes in English/Arabic responsive RTL.
- Django Admin: internal maintenance only, not daily operations.
- Focus: independent; only completed-session facts feed analytics.
- AI: unimplemented and provider-independent.
- Excluded: Redis, Celery, WebSockets, broker, microservices, scheduler/worker, BI/monitoring vendor,
  arbitrary bulk actions, scheduled reports, and real provider integrations.

## Validation Snapshot

- Backend: 157 tests, 85.64% branch-aware coverage; Ruff lint/format, mypy (403 files), migration
  drift, and production deployment checks passed.
- Frontend: 153 tests; 90.87% statements, 80.08% branches, 87.48% functions, 95.16% lines;
  TypeScript, ESLint, npm lockfile audit, and PWA build passed.
- Browser: 29 Playwright passes and 1 intentional desktop skip; Phase 9 desktop/mobile passed Axe,
  Arabic RTL, landmarks, preview/confirmation, and overflow. Screenshots visually reviewed.
- OpenAPI generation completes; no Phase 9 view warning. Ninety-six inherited APIView/operation-id
  warnings remain tracked, so the global schema is not claimed clean.
- PostgreSQL concurrency/representative load/external observability: not run locally; no claim.

## Review Focus

1. Confirm six domain boundaries and that `operations_integrations` owns no business state.
2. Confirm operational roles are capability-based and separate from product roles.
3. Review final-platform-admin protection and reason/audit requirements for role changes.
4. Review event-fact idempotency, UTC projections, freshness, finance visibility, and rebuild bounds.
5. Review audit append-only/redaction contracts and the database-grant production gate.
6. Review action/report preview TTL, confirmation, idempotency, bounds, partial summaries, and audit.
7. Review typed configuration, optimistic versions, secret prohibition, and safe defaults.
8. Review provider-neutral telemetry/health and absence of vendor/infrastructure coupling.
9. Review task-specific responsive operations UI, accessibility, and RTL behavior.
10. Confirm Focus, AI, entitlement, API compatibility, and Phase 10 boundaries remain intact.

## Outstanding Production Evidence

Run PostgreSQL concurrency and representative projection/action/export/load tests; enforce audit
immutability with the database application role; select/validate metric/error providers and alerts;
approve log/audit/report retention; resolve inherited OpenAPI warnings; and design scheduling only if
an approved report/reconciliation requirement proves it necessary.

## Stop Condition

Stop after the Phase 9 commit and wait for owner approval before Phase 10.
