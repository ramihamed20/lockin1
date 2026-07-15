# Lock-in Next Session

Last updated: 2026-07-15

## Start Here

Phase 3 implementation is complete and awaiting owner approval. Do not begin Phase 4 unless the
owner explicitly approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `DECISIONS.md`
3. `ARCHITECTURE.md`
4. `DESIGN.md`
5. `PHASE_3_AUTH_DESIGN.md`
6. `FOCUS_MODE.md`
7. `EVENTS.md`
8. `AI_EXTENSION_POINTS.md`
9. `PROGRESS.md`
10. `TODO.md`
11. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`

Never modify the read-only reference.

## Current implementation

- Branch: `codex/phase-3-auth-design`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, PWA.
- Backend: Python 3.13 target, Django 5.2.16 LTS, DRF 3.17.1.
- Database: PostgreSQL 18.4 default; explicit SQLite fast-test fallback only.
- Domains implemented: secure Accounts flows/roles and Focus session foundation.
- Frontend implemented: design system, English/Arabic RTL shell, auth/account/security/admin role
  screens, and truthful role-aware account dashboard.
- Cross-cutting: versioned API, OpenAPI, JSON logs, request IDs, liveness/readiness, internal
  after-commit events.
- AI: no implementation; extension contract only.
- Infrastructure excluded: Redis, Celery, broker, WebSockets, microservices.

## Validation snapshot

- Backend: Ruff/mypy/Django/migration checks passed; 36 tests passed at 88.93% coverage using the
  explicit workstation fast-test fallback.
- Frontend: ESLint/TypeScript/build passed; 30 tests, 91.75% statements and 83.39% branches.
- Browser: 5 Playwright scenarios passed, 1 device-specific skip; Axe reported no violations.
- PWA: 12-entry static-only precache, `/api/` denied from navigation fallback, main JS 85.22 KB gzip.
- PostgreSQL CI: configured, not run locally because Docker/PostgreSQL are absent.

## If Phase 4 is approved

1. Re-read and announce the applicable selected Skills.
2. Re-read the exact Phase 4 scope in `PRODUCT.md` and do not infer later quiz/community work.
3. Preserve the Phase 3 account/permission API contracts and reuse `DESIGN.md` tokens/components.
4. Keep Focus as a standalone product domain; do not move PDF/annotation work into content pages.
5. Keep internal events lightweight and after-commit; add a domain event only with its real state change.
6. Keep AI provider code absent.
7. Run PostgreSQL-backed tests if Docker/CI becomes available.
8. Update all source-of-truth documents, test, commit, and stop.

## Stop Condition

Stop after the Phase 3 commit and wait for owner review.
