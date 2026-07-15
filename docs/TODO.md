# Lock-in TODO

Last updated: 2026-07-15

## Phase 1

- [x] Complete product specification and acceptance criteria.
- [x] Obtain explicit Phase 2 approval.

## Phase 2

- [x] Select and document supported runtime/package versions.
- [x] Create isolated backend and frontend foundation.
- [x] Configure PostgreSQL as the default local/test/CI database.
- [x] Add safe environment settings and `.env.example`.
- [x] Create custom UUID/email user model before initial migrations.
- [x] Add versioned API, OpenAPI, stable error envelope, health, readiness, and JSON logs.
- [x] Add Focus session/history/statistics/event foundation.
- [x] Add Focus frontend renderer/storage/gesture/tool/session extension contracts.
- [x] Add in-process after-commit domain event architecture.
- [x] Document AI-free extension points.
- [x] Add Docker development workflow and owner operations guide.
- [x] Add Ruff, mypy, pytest, ESLint, TypeScript, Vitest, build, and Playwright commands.
- [x] Add PostgreSQL CI workflow.
- [x] Run available local tests, security checks, PWA inspection, and browser validation.
- [x] Update all source-of-truth documentation.
- [ ] Run PostgreSQL suite in CI or local Docker when that environment becomes available.
- [x] Obtain explicit Phase 3 approval.

## Phase 3 — Complete; Awaiting Review

- [x] Create three-layer design tokens/components and `DESIGN.md`.
- [x] Implement registration, verification, login, logout, session, CSRF, and account flows.
- [x] Implement password reset, password/email changes, and active-session management.
- [x] Implement roles, permissions, final-administrator protection, and basic dashboards.
- [x] Implement English/Arabic catalogs, real RTL, responsive navigation, and states.
- [x] Add database-backed account throttling and append-oriented security records.
- [x] Add authentication/permission API, unit, accessibility, and E2E tests.
- [x] Preserve the Phase 2 Focus/event/AI boundaries.
- [x] Update all source-of-truth documentation.
- [ ] Obtain explicit Phase 4 approval.

## Phase 4 — Not Started

Do not execute before owner approval. Re-read the Phase 4 scope in `PRODUCT.md` before creating
education hierarchy, managed content, or file workflows.

## Later Product Inputs

- [ ] Real institution/faculty/curriculum data.
- [ ] Subscription price, currency, grace period, and payment provider.
- [ ] Legal privacy, retention, terms, and deletion policy.
- [ ] Email and push providers.
- [ ] Ranking formula and achievement catalog.
- [ ] Additional approved anti-cheating ideas.
- [ ] Production hosting choice.

## Guardrails

- Never modify `C:\Users\ramih\Desktop\Dentify-Before-Edits`.
- Work one phase at a time.
- No Redis, Celery, WebSockets, broker, microservice, or AI provider without approved need.
- Do not claim PostgreSQL or concurrency evidence that was not executed.
- Keep all source-of-truth documents current after every phase.
