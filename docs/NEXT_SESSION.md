# Lock-in Next Session

Last updated: 2026-07-18

## Start Here

Phase 8 is implemented and locally validated. Do not begin Phase 9 unless the owner explicitly
approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `PHASE_8_SUBSCRIPTIONS.md`
3. `DECISIONS.md`
4. `ARCHITECTURE.md`
5. `EVENTS.md`
6. `OPERATIONS.md`
7. `DESIGN.md`
8. `PHASE_7_MOTIVATION.md`
9. `FOCUS_MODE.md`
10. `AI_EXTENSION_POINTS.md`
11. `PROGRESS.md`
12. `TODO.md`
13. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 8 isolated validation copy: `C:\tmp\Lockin-Rebuild-Phase8`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-8-entitlements`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, static-only PWA cache.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL default; SQLite only behind `LOCKIN_TEST_USE_SQLITE=true` for local tests.
- Commerce: independent product catalog, subscription, entitlement, payment, invoice, refund, and
  provider-integration domains plus stateless event integration.
- Access: capability-code decisions/grants are authoritative; no premium/pro/plan flag gating.
- Lifecycle: pending, trialing, active, grace, expired, cancelled, suspended, and refunded with
  append-only idempotent transitions.
- Money: integer minor units plus currency exponent; immutable price/payment/invoice snapshots.
- Providers: disabled safely by default; signed fake adapter only for test/development; production
  rejects fake/unsupported providers.
- Webhooks: size/timestamp/HMAC/schema checks, digest deduplication, audit without raw payload, and
  normalized event processing.
- Recovery: `reconcile_commerce`; no queue or background worker.
- Frontend: lazy `/subscription` **Plan & access** route with honest offers, entitlements, current
  lifecycle/date, cancellation confirmation, and payment/invoice/refund history.
- Focus: independent; no renderer, annotation, gesture, storage, or workspace change.
- AI: unimplemented; `ai.assistance` is defined but not granted.
- Excluded: real provider, real paid price, checkout, promotions/coupons, membership/seats, Redis,
  Celery, WebSockets, broker, microservices, and background workers.

## Validation Snapshot

- Backend: 144 tests, 85.78% branch-aware coverage; Ruff, mypy (331 files), Django check, and
  migration drift passed.
- Frontend: 126 tests; 90.39% statements, 80.16% branches, 87.37% functions, 94.32% lines;
  TypeScript, ESLint, and PWA build passed.
- Browser: 25 Playwright passes and 1 intentional desktop skip; Phase 8 desktop/mobile passed Axe,
  Arabic RTL, focus/landmarks, cancellation, currency exponent, and overflow checks.
- OpenAPI generation completes; inherited and Phase 8 serializer-description/auth-extension findings
  remain tracked and the schema is not yet claimed clean.
- PostgreSQL/provider sandbox/concurrency/load: not run locally; no evidence claim.

## Review Focus

1. Confirm seven domain boundaries and that `commerce_integrations` owns no state.
2. Confirm every access decision uses capability entitlements, never plan-name or client flags.
3. Review lifecycle transition graph, idempotency, revisions, cancellation, and period semantics.
4. Review immutable price/payment/invoice/refund evidence and currency-exponent handling.
5. Review strict server-owned payment inputs, refund reservation, and provider confirmation.
6. Review webhook bounds, HMAC, replay/digest handling, raw-payload avoidance, and failure audit.
7. Confirm the UI is truthful while no provider or paid price exists.
8. Confirm Focus, AI, infrastructure, backward compatibility, and Phase 9 boundaries remain intact.

## Required Paid-Launch Decisions

Approve provider/merchant/legal setup, prices/currencies/tax, regional availability, entitlement
matrix, refund/cancellation/grace policy, receipts/invoices, disputes, privacy/retention, and
checkout copy before enabling real paid commerce.

## Stop Condition

Stop after the Phase 8 commit and wait for owner approval.
