# Phase 8 - Subscription and Entitlement Platform

Last updated: 2026-07-18

## Outcome

Phase 8 establishes a server-authoritative commerce and access platform. It does not pretend that a
production payment provider, a paid price, or a checkout experience has been approved. The platform
can issue the approved trial, explain current access, preserve financial evidence, and integrate a
future provider without moving subscription or entitlement rules into that adapter.

## Domain Ownership

| Domain | Owns | Does not own |
|---|---|---|
| Product Catalog | products, plans, immutable plan versions, regional/versioned prices | user access or provider calls |
| Subscriptions | account scope, lifecycle, periods, cancellation, append-only transitions | feature authorization or payment verification |
| Entitlements | definitions, plan rules, grants, decisions, manual-grant audit | plan marketing or provider state |
| Payments | server price snapshots, status projection, immutable transitions | invoice presentation or refund workflow |
| Invoices | immutable invoice/line snapshots and refund projection | charging or entitlement decisions |
| Refunds | authorized requests, reservations, result transitions | client-declared success or subscription mutation |
| Provider Integration | adapter contract, checkout/refund calls, webhook verification/deduplication/audit | catalog, lifecycle, or access policy |

`apps.commerce_integrations` is a stateless composition boundary. It consumes typed after-commit
events and calls public domain services. It owns no commerce state.

## Entitlement Decision Contract

Protected server capabilities must call `entitlement_decision` or `require_entitlement` with a
stable capability code. `EntitlementRequiredMixin` is available for DRF views. A decision contains
the capability code, allowed state, reason, expiry, optional quantity limit, and configuration.

The seeded definitions are:

- `focus.workspace`
- `content.premium`
- `files.download`
- `ai.assistance`

The approved trial grants the first three only. `ai.assistance` is deliberately ungranted and no AI
runtime exists. No existing feature was retroactively gated in Phase 8 because no owner-approved
premium matrix exists yet. A later feature gate must use this one mechanism, not plan codes or
client flags such as `isPremium`.

## Subscription Lifecycle

The lifecycle supports `pending`, `trialing`, `active`, `grace`, `expired`, `cancelled`, `suspended`,
and `refunded`. Every status change locks the subscription, validates a transition, increments its
revision, and appends a uniquely idempotent transition record. Period, grace, cancellation, and end
timestamps stay explicit. Verified users receive the approved default trial through the account
event boundary; old verified accounts are backfilled and already elapsed trials become expired.

`SubscriptionAccount` separates the individual user from future family, organization, and
institution ownership. Those account types are schema extension points only; membership, seat, and
license behavior was not speculatively implemented.

## Financial Integrity

- The client sends only a catalog `price_id` plus a stable `Idempotency-Key` when starting payment.
- Amount, currency, currency exponent, tax behavior, plan/version, and price details are snapshotted
  by the server. Unexpected client financial fields are rejected.
- Payment and invoice history are immutable evidence plus append-only status transitions.
- Refund requests require administrator authorization, reserve pending amounts against over-refund,
  reject server-owned fields, and become successful only after a verified provider event.
- Provider success must exactly match the server-owned amount and currency.
- All commerce Django admin registrations are read-only so operators cannot bypass services.
- Repeated provider events and repeated success/refund delivery are idempotent.

Amounts are stored as integer minor units with a snapshotted currency exponent. This supports
zero-, two-, three-, and four-decimal currencies without floating-point arithmetic or assuming a
single region.

## Provider Boundary and Webhooks

The provider protocol exposes checkout creation, refund request, and webhook verification. The
disabled adapter is the safe default. A signed fake adapter exists only for deterministic tests and
local development; production settings reject it and reject unsupported provider names.

Webhook ingestion:

1. rejects unsupported providers and oversized payloads before reading the body;
2. validates timestamp tolerance and HMAC-SHA256 over `timestamp.raw_body`;
3. parses an exact allowlisted schema and does not store the raw body;
4. stores a digest and verification attempt audit;
5. deduplicates provider event identifiers and rejects identifier reuse with a different digest;
6. normalizes the event before publishing it after commit;
7. records processing failure rather than erasing its audit trail.

`reconcile_commerce` reprocesses verified or failed normalized events and repairs subscription
entitlement projections. This is the recovery path for the current lightweight in-process event
bus. No queue, broker, or background worker was added.

## Billing Experience and Redesign Reasons

The lazy `/subscription` route is named **Plan & access**, not Checkout. It presents the current
plan/lifecycle and relevant date first, then active entitlements, available offers, and immutable
payment/invoice/refund history. Cancellation uses an inline explicit confirmation.

| Redesign | Usability reason |
|---|---|
| Plan and access before transactions | Answers what the student currently has before asking them to buy anything |
| Entitlements shown separately from plan name | Explains actual capabilities as plans evolve |
| Honest unavailable-checkout state | Prevents a false purchase path while no provider or paid price is approved |
| One combined chronological billing history | Makes payment, invoice, and refund evidence easier to reconcile |
| Inline cancellation confirmation | Prevents accidental lifecycle changes without an inaccessible modal |

The page has skeleton, empty, failure, retry, cancellation, English/Arabic RTL, keyboard, reduced
motion, mobile/tablet, and narrow-history-table behavior. It uses existing design tokens and adds no
frontend runtime dependency.

## Events and Notifications

Account verification can create a trial. Provider verification leads to payment/refund processing.
Successful payment activates or renews the subscription and creates the invoice; a full successful
refund moves it to refunded and removes subscription-derived grants. Subscription changes resync
entitlements. Billing notifications subscribe through the integration boundary and are required
account records that cannot be disabled.

## Security Review

The `security-best-practices` Skill guided server-owned money, strict serializers, HMAC timing and
size bounds, raw-payload avoidance, idempotency, immutable ledgers, read-only admin, and fail-closed
production provider settings. No credentials are committed. The fake secret must be at least 24
characters and is blank in the environment example.

## Validation Evidence

- Focused Phase 8 backend: 13 passed.
- Complete backend: 144 passed; 85.78% branch-aware coverage; 85% gate passed.
- Ruff: passed. Strict mypy: 331 source files, no issues.
- Django system check and migration drift check: passed.
- OpenAPI generation completes after correcting the action-name collision discovered by the check.
  The generated schema still reports inherited and Phase 8 APIView description/auth-extension debt;
  this is documented rather than misreported as a clean schema-validation pass.
- Frontend: 126 tests; 90.39% statements, 80.16% branches, 87.37% functions, 94.32% lines.
- TypeScript, ESLint, and production PWA build: passed.
- Browser regression: 25 passed and 1 intentional desktop skip; the Phase 8 desktop/mobile slices
  passed Axe, English/Arabic RTL, focus/landmark, cancellation, currency-exponent, and overflow checks.

Local backend validation explicitly used SQLite because PostgreSQL/Docker was not available. This
phase does not claim PostgreSQL locking/concurrency, provider sandbox, webhook edge/CDN behavior,
or representative load evidence.

## Explicit Exclusions and Launch Inputs

- No production provider, paid price/currency, coupon, promotion, institutional seat, family seat,
  regional tax engine, or checkout UI is invented.
- No existing capability is silently made premium.
- No Redis, Celery, WebSocket, broker, microservice, background worker, AI runtime, or Focus internal
  change is added.
- Before paid launch, the owner must approve provider, legal entity, prices/currencies/exponents,
  tax treatment, refund/cancellation/grace policy, entitlement matrix, receipts/invoice rules,
  regional/legal copy, and provider webhook/operations runbook.

Phase 9 has not started.
