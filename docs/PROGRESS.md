# Lock-in Progress

Last updated: 2026-07-18

## Current Status

Phase 8 - Subscription and entitlement platform
State: implementation and local validation complete; awaiting owner review

Do not start Phase 9 until the owner explicitly approves it.

## Phase History

### Phase 0 - Repository and Skill Inspection

Status: approved. Audited the old application, searched built-in/installed/repository/workspace and
user-provided Skills, selected the applicable Skills, and kept the reference project read-only.

### Phase 1 - Product Specification

Status: approved. Documented roles, behavior, permissions, accessibility, performance, security,
architecture, redesign reasons, acceptance criteria, assumptions, and phase boundaries.

### Phase 2 - Foundation

Status: approved. Created the isolated React/TypeScript/Vite/PWA and Django/DRF/PostgreSQL modular
monolith with Focus boundaries, lightweight events, AI-free extension points, and quality gates.

### Phase 3 - Authentication and Design System

Status: approved. Implemented secure session/CSRF accounts, roles, throttling, security records,
English/Arabic RTL, tokens, responsive shell, and truthful account dashboards.

### Phase 4 - Education, Content, Discovery, and Progress

Status: approved. Implemented the generic academic tree, immutable learning objects, private files,
search projection, bookmarks/progress/lesson completion, and next-action dashboard.

### Phase 5 - Assessment Learning Ecosystem

Status: approved. Implemented immutable questions/quizzes/attempts, autosave, server grading/result
disclosure, mistake reports, spaced review, fairness evidence, and Focus/achievement boundaries.

### Phase 6 - Contextual Learning Community and Moderation

Status: approved. Implemented learning-context discussions, creator spaces, central evidence-based
moderation, cursor feeds, permissions, audit, and notification-ready events.

### Phase 7 - Learning Motivation and Notifications

Status: approved.

- Added independent XP, achievement, ranking, streak, and notification domains.
- Added a stateless integration boundary consuming existing after-commit domain events.
- Added idempotent XP/evidence ledgers and rebuildable balances/progress projections.
- Seeded five meaningful versioned achievements without activity-grind rewards.
- Added versioned streak policy/evidence with deterministic out-of-order recomputation.
- Added deterministic ranking snapshots, explicit ties/rules/checksum/failure audit, and privacy.
- Added recipient-owned in-app notifications, safe targets, preferences, deduplication, and counters.
- Added `rebuild_motivation` reconciliation for best-effort event recovery.
- Added accessible English/Arabic progression and notification routes with mobile/tablet layouts.
- Kept Focus independent, AI unimplemented, and infrastructure local to the modular monolith.

### Phase 8 - Subscription and Entitlement Platform

Status: complete; awaiting owner review.

- Added independent catalog, subscription, entitlement, payment, invoice, refund, and provider
  integration domains, with a stateless commerce integration boundary.
- Made server entitlement decisions the single access-control mechanism; no plan-name flags exist.
- Added explicit trial/active/grace/expired/cancelled/suspended/refunded lifecycle transitions.
- Added immutable server-owned price/payment/invoice snapshots and append-only transition evidence.
- Added administrator-authorized, provider-confirmed, reserved, idempotent refund processing.
- Added provider abstraction, signed bounded fake webhook verification for test/development only,
  duplicate/digest protection, verification audit, normalized events, and reconciliation.
- Added the responsive, accessible English/Arabic **Plan & access** experience.
- Kept checkout unavailable until a production provider and real price/currency are approved.
- Preserved backward-compatible feature access; no existing capability was silently made premium.

## Phase 8 Validation

- Backend: 144 tests; 85.78% branch-aware coverage (85% gate passed).
- Ruff, strict mypy across 331 source files, Django check, and migration drift check: passed.
- Frontend: 126 tests; 90.39% statements, 80.16% branches, 87.37% functions, 94.32% lines.
- ESLint, TypeScript, and production PWA build: passed.
- Playwright regression: 25 passed, 1 intentional desktop skip for a mobile-only assertion.
- Phase 8 desktop/mobile flows passed Axe, English/Arabic RTL, focus/landmarks, cancellation,
  currency-exponent, and overflow checks.
- OpenAPI generation completes; inherited and Phase 8 APIView description/auth-extension findings
  remain tracked debt and are not reported as a clean schema-validation pass.

## Workstation Limitation

PostgreSQL-backed concurrency and representative 2,000-active-user load tests were not run locally
because no PostgreSQL/Docker service was available. Local tests explicitly used
`LOCKIN_TEST_USE_SQLITE=true`. No PostgreSQL concurrency or load claim is made.

## Next Gate

Owner reviews Phase 8. Stop here; Phase 9 requires explicit approval.
