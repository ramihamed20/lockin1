# Lock-in Next Session

Last updated: 2026-07-15

## Start Here

Phase 2 implementation is complete and awaiting owner approval. Do not begin Phase 3 unless the
owner explicitly approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `DECISIONS.md`
3. `ARCHITECTURE.md`
4. `FOCUS_MODE.md`
5. `EVENTS.md`
6. `AI_EXTENSION_POINTS.md`
7. `PHASE_2_FOUNDATION.md`
8. `PROGRESS.md`
9. `TODO.md`
10. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`

Never modify the read-only reference.

## Current implementation

- Branch: `codex/phase-2-foundation`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, PWA.
- Backend: Python 3.13 target, Django 5.2.16 LTS, DRF 3.17.1.
- Database: PostgreSQL 18.4 default; explicit SQLite fast-test fallback only.
- Domains implemented: Accounts model foundation and Focus session foundation.
- Cross-cutting: versioned API, OpenAPI, JSON logs, request IDs, liveness/readiness, internal
  after-commit events.
- AI: no implementation; extension contract only.
- Infrastructure excluded: Redis, Celery, broker, WebSockets, microservices.

## Validation snapshot

- Backend: Ruff/mypy/Django/migration checks passed; 15 tests passed at 89.69% coverage using the
  explicit workstation fast-test fallback.
- Frontend: ESLint/TypeScript/Vitest/build passed; 4 unit tests.
- Browser: Playwright desktop + Pixel 7 passed; direct CLI snapshot showed no console errors or
  warnings.
- PWA: static-only precache, `/api/` denied from navigation fallback, main JS 62.91 KB gzip.
- PostgreSQL CI: configured, not run locally because Docker/PostgreSQL are absent.

## If Phase 3 is approved

1. Re-read and announce the applicable selected Skills.
2. Run Impeccable context from the rebuild root; `docs/PRODUCT.md` is the product context.
3. Create the real design foundation and `DESIGN.md` during Phase 3, not before.
4. Implement authentication/account/API work only within the approved Phase 3 scope.
5. Keep Focus as a first-class domain and do not place PDF/annotation work into auth components.
6. Use internal events for completed authoritative state changes, after commit.
7. Keep AI provider code absent.
8. Run PostgreSQL-backed tests if Docker/CI becomes available.
9. Update all source-of-truth documents, test, commit, and stop.

## Stop Condition

Stop after the Phase 2 commit and wait for owner review.
