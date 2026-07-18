# Lock-in TODO

Last updated: 2026-07-18

## Completed Gates

- [x] Phase 0 audit and Skill selection approved.
- [x] Phase 1 product specification approved.
- [x] Phase 2 foundation approved.
- [x] Phase 3 authentication/design system approved.
- [x] Phase 4 education/content/discovery/progress approved.
- [x] Phase 5 assessment learning ecosystem approved.
- [x] Phase 6 contextual community/moderation approved.

## Phase 7 - Complete; Awaiting Review

- [x] Keep achievement, XP, ranking, streak, and notification domains independent.
- [x] Consume source-domain events through a stateless integration boundary.
- [x] Make all progression server-authoritative, idempotent, auditable, and rebuildable.
- [x] Reward bounded meaningful study and exclude raw engagement grinding.
- [x] Add versioned achievement definitions/evidence/progress/earned records.
- [x] Add versioned streak policy and deterministic daily recomputation.
- [x] Add deterministic ranking facts/snapshots, tie rules, audit/checksum, and privacy.
- [x] Add recipient-owned notifications, counters, safe targets, deduplication, and preferences.
- [x] Keep email/push modeled but unavailable; add no provider or delivery worker.
- [x] Add reconciliation for best-effort event recovery.
- [x] Add accessible, responsive English/Arabic progression and notification workflows.
- [x] Pass unit/API/coverage/PWA/Axe/RTL/full-browser regression gates.
- [x] Update all source-of-truth documentation.
- [ ] Obtain explicit Phase 8 approval.

## Deferred Evidence / Inputs

- [ ] Run the complete suite against PostgreSQL in CI or a local PostgreSQL environment.
- [ ] Add PostgreSQL concurrency tests for XP/evidence idempotency, counters, and ranking publication.
- [ ] Establish representative million-row XP/notification and ranking datasets for Phase 11 load work.
- [ ] Schedule and monitor `rebuild_motivation` only through approved operations infrastructure.
- [ ] Integrate a malware scanner before production file ingestion; status is `not_configured`.
- [ ] Supply real institutions, curricula, learning content, questions, and creator scopes.
- [ ] Select production object storage/CDN and hosting.
- [ ] Approve legal privacy, retention, ranking identity, notification retention, and moderation policy.

## Later Product Inputs

- [ ] Phase 8 subscription price, currency, access/grace policy, and provider interface.
- [ ] Approve a real email or push provider before enabling those notification channels.
- [ ] Approve freeze-token, grace-day, and recovery behavior before changing the streak policy.
- [ ] Approve additional ranking scopes/periods and eligibility rules before seeding them.
- [ ] Review/approve future achievement definitions before catalog publication.
- [ ] Mention syntax/notification policy if mentions are approved later.
- [ ] Any anti-cheating change requires fairness, evidence, appeal, and recalculation design.

## Guardrails

- Never modify `C:\Users\ramih\Desktop\Dentify-Before-Edits`.
- Work one approved phase at a time; do not start Phase 8 without explicit approval.
- Server remains the source of truth for progression, permissions, moderation, grading, and review.
- Rankings reward verified learning evidence, not raw activity or popularity.
- Preserve backward-compatible APIs unless a change is intentionally versioned.
- Focus remains an independent product module; AI remains provider-independent and unimplemented.
- Add no Redis, Celery, WebSocket, broker, microservice, AI, or delivery provider without a proven
  need and prior owner approval.
- Do not claim PostgreSQL concurrency, load, malware scan, email/push delivery, or Focus features
  without evidence.
