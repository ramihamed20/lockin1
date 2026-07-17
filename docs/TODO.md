# Lock-in TODO

Last updated: 2026-07-17

## Completed Gates

- [x] Phase 0 audit and Skill selection approved.
- [x] Phase 1 product specification approved.
- [x] Phase 2 foundation approved.
- [x] Phase 3 authentication/design system approved.
- [x] Phase 4 education/content/discovery/progress approved.
- [x] Phase 5 assessment learning ecosystem approved.

## Phase 6 - Complete; Awaiting Review

- [x] Require a valid lesson/content/question/quiz context for every public discussion.
- [x] Add one-level replies, revisions, idempotency, duplicate/rate controls, and tombstones.
- [x] Add stable cursor pagination and bounded relation/query behavior.
- [x] Add context-bound creator spaces, invite roles, revocation, and membership history.
- [x] Add central reports for community, question, answer, explanation, and learning-object targets.
- [x] Capture immutable evidence and enforce private-space evidence isolation.
- [x] Add assignment, workflow transitions, duplicate linking, fairness conflicts, and audit history.
- [x] Add reversible moderator remove/restore and discussion lock/unlock actions.
- [x] Preserve the backward-compatible assessment mistake-report API.
- [x] Emit community/moderation events without implementing notification delivery.
- [x] Add contextual learning/result links and accessible English/Arabic responsive workflows.
- [x] Pass unit/API/query-budget/coverage/PWA/Axe/RTL/full-browser regression gates.
- [x] Update all source-of-truth documentation.
- [ ] Obtain explicit Phase 7 approval.

## Deferred Evidence / Inputs

- [ ] Run the complete suite against PostgreSQL in CI or a local PostgreSQL environment.
- [ ] Add PostgreSQL concurrency tests for community idempotency, rate buckets, and moderation revisions.
- [ ] Establish representative discussion/comment/report datasets for the approved Phase 11 load plan.
- [ ] Integrate a malware scanner before production file ingestion; status is `not_configured`.
- [ ] Supply real institutions, curricula, learning content, questions, and creator scopes.
- [ ] Select production object storage/CDN and hosting.
- [ ] Approve legal privacy, retention, terms, account-deletion, evidence-retention, and report SLA policy.

## Later Product Inputs

- [ ] Phase 7 achievement catalog, eligibility policy, ranking formula, and periods.
- [ ] Phase 7 notification-center behavior/preferences using Phase 6 events.
- [ ] Mention syntax/notification policy if mentions are approved later.
- [ ] Study-group learning purpose and moderation model before implementation.
- [ ] Any additional anti-cheating idea, with fairness/evidence/appeal review before implementation.
- [ ] Subscription price, currency, grace period, and payment provider.
- [ ] Email and push providers.

## Guardrails

- Never modify `C:\Users\ramih\Desktop\Dentify-Before-Edits`.
- Work one approved phase at a time; do not start Phase 7 without explicit approval.
- Community remains contextual to learning; do not add generic engagement mechanics speculatively.
- Server remains the source of truth for permissions, revisions, moderation, grading, and review state.
- Preserve backward-compatible APIs unless a change is intentionally versioned.
- Focus remains an independent product module; AI remains provider-independent and unimplemented.
- Add no Redis, Celery, WebSocket, broker, microservice, or AI provider without a proven need and
  prior owner approval.
- Do not claim PostgreSQL concurrency, load, malware scan, notification delivery, or Focus features
  without evidence.
