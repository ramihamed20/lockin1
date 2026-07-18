# Lock-in TODO

Last updated: 2026-07-19

## Completed Gates

- [x] Phase 0 audit and Skill selection approved.
- [x] Phase 1 product specification approved.
- [x] Phase 2 foundation approved.
- [x] Phase 3 authentication/design system approved.
- [x] Phase 4 education/content/discovery/progress approved.
- [x] Phase 5 assessment learning ecosystem approved.
- [x] Phase 6 contextual community/moderation approved.
- [x] Phase 7 learning motivation/notifications approved.
- [x] Phase 8 subscription/entitlement platform approved.
- [x] Phase 9 operations platform approved.

## Phase 8 - Approved

- [x] Keep catalog, subscription, entitlement, payment, invoice, refund, and provider domains independent.
- [x] Make entitlement decisions server-authoritative and independent of plan-name flags.
- [x] Implement explicit subscription lifecycle, revision, transition, period, and cancellation state.
- [x] Snapshot server-owned price, amount, currency exponent, payment, invoice, and refund evidence.
- [x] Add administrator-authorized, provider-confirmed, reserved, idempotent refunds.
- [x] Add a provider protocol, secure fake development adapter, bounded verified webhooks, and audit.
- [x] Add commerce event integration and `reconcile_commerce` without external infrastructure.
- [x] Seed the approved trial and capability definitions without inventing paid prices.
- [x] Add accessible responsive English/Arabic plan, access, and billing-history workflows.
- [x] Pass backend/frontend/coverage/PWA/Axe/RTL/full-browser regression gates.
- [x] Update all source-of-truth documentation.
- [x] Obtain explicit Phase 9 approval.

## Phase 9 - Approved

- [x] Keep administration, analytics, audit, reporting, operational actions, and configuration
  independent.
- [x] Add fine-grained operational capabilities/roles and protect the final platform administrator.
- [x] Build idempotent event facts and UTC daily projections instead of live history dashboards.
- [x] Add append-only redacted audit evidence for implemented administrative changes.
- [x] Add bounded preview/confirm/idempotent account status operations with partial summaries.
- [x] Add bounded preview/confirm CSV reports with filter, row-limit, hash, and audit evidence.
- [x] Add allowlisted typed/versioned non-secret system configuration.
- [x] Add provider-neutral request metrics, structured logging, error reporting, and safe health.
- [x] Add dedicated responsive English/Arabic operations workspaces and pass Axe/RTL/overflow.
- [x] Pass backend/frontend/coverage/PWA/full-browser regression gates and update documentation.
- [x] Obtain explicit Phase 10 approval.

## Phase 10 - Complete; Awaiting Review

- [x] Keep Focus independent from assessment, community, AI, motivation, commerce, and notifications.
- [x] Add server-authoritative session lifecycle/history and optimistic workspace snapshots.
- [x] Add version-scoped normalized annotation collections, revisions, idempotency, and recovery.
- [x] Add a dedicated route-split shell and isolate PDF.js behind one renderer adapter.
- [x] Add virtual page activation, cancellation, memory release, navigation, zoom, and gestures.
- [x] Add drawing, markup, shapes, text/sticky notes, undo/redo, and confirmed clearing.
- [x] Add incremental autosave, offline/local/server truth, conflict handling, and PWA guards.
- [x] Add keyboard/screen-reader/high-contrast/reduced-motion/RTL responsive behavior.
- [x] Add bounded future extension slots without speculative features or infrastructure.
- [x] Pass the complete backend/frontend/PWA/browser validation suite and finish evidence docs.
- [ ] Obtain explicit approval before the next phase.

## Deferred Evidence / Inputs

- [ ] Run the complete suite against PostgreSQL in CI or a local PostgreSQL environment.
- [ ] Add PostgreSQL concurrency tests for XP/evidence idempotency, counters, and ranking publication.
- [ ] Establish representative million-row XP/notification and ranking datasets for Phase 11 load work.
- [ ] Run PostgreSQL concurrency tests for payment/refund idempotency, transition locks, webhook
  deduplication, and entitlement resynchronization.
- [ ] Run provider sandbox, reverse-proxy payload-limit, replay, and representative commerce load tests.
- [ ] Run PostgreSQL concurrency tests for analytics fact idempotency, role/action/configuration locks,
  report confirmation, and audit immutability.
- [ ] Run PostgreSQL concurrent Focus session/workspace/annotation revision and idempotency tests.
- [ ] Measure Focus with representative hundred-page/image-heavy PDFs, hundreds of annotations,
  long sessions, offline/reconnect, and bounded browser memory.
- [ ] Validate real iPad/Apple Pencil and Android stylus pressure/tilt, input latency, finger pan, and
  browser-specific palm-rejection limits; do not claim capability before evidence.
- [ ] Build representative projection/report/action datasets and run Phase 11 load tests.
- [ ] Enforce audit update/delete denial with the production PostgreSQL application role.
- [ ] Select and validate metrics/error providers, alerts, dashboards, log retention, and privacy.
- [ ] Schedule analytics/report/reconciliation work only after an approved scheduler/worker design.
- [ ] Resolve inherited DRF Spectacular APIView and operation-id warnings across pre-Phase-9 APIs.
- [ ] Schedule and monitor `rebuild_motivation` only through approved operations infrastructure.
- [ ] Schedule and monitor `reconcile_commerce` only through approved operations infrastructure.
- [ ] Integrate a malware scanner before production file ingestion; status is `not_configured`.
- [ ] Supply real institutions, curricula, learning content, questions, and creator scopes.
- [ ] Select production object storage/CDN and hosting.
- [ ] Approve legal privacy, retention, ranking identity, notification retention, and moderation policy.

## Paid Launch Inputs

- [ ] Approve the production payment provider and legal/merchant configuration.
- [ ] Approve paid prices, currencies/exponents, regional availability, tax behavior, and copy.
- [ ] Approve plan-to-entitlement matrix and any Focus/download/content gates before enforcement.
- [ ] Approve cancellation, renewal, grace, refund, receipt/invoice, and dispute policies.
- [ ] Approve promotion/coupon and family/organization/institution membership behavior before adding it.

## Later Product Inputs

- [ ] Approve a real email or push provider before enabling those notification channels.
- [ ] Approve freeze-token, grace-day, and recovery behavior before changing the streak policy.
- [ ] Approve additional ranking scopes/periods and eligibility rules before seeding them.
- [ ] Review/approve future achievement definitions before catalog publication.
- [ ] Mention syntax/notification policy if mentions are approved later.
- [ ] Any anti-cheating change requires fairness, evidence, appeal, and recalculation design.

## Guardrails

- Never modify `C:\Users\ramih\Desktop\Dentify-Before-Edits`.
- Work one approved phase at a time; do not start the next phase without explicit approval.
- Server remains the source of truth for progression, permissions, moderation, grading, and review.
- Entitlements, not plan flags or client state, remain the source of truth for protected capabilities.
- Never trust client payment/refund success, amount, currency, price, subscription state, or access.
- Rankings reward verified learning evidence, not raw activity or popularity.
- Preserve backward-compatible APIs unless a change is intentionally versioned.
- Focus remains an independent product module; AI remains provider-independent and unimplemented.
- Add no Redis, Celery, WebSocket, broker, microservice, AI, or delivery provider without a proven
  need and prior owner approval.
- Do not claim PostgreSQL concurrency, load, malware scan, email/push delivery, or Focus features
  without evidence.
