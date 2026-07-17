# Lock-in TODO

Last updated: 2026-07-17

## Completed Gates

- [x] Phase 0 audit and Skill selection approved.
- [x] Phase 1 product specification approved.
- [x] Phase 2 foundation approved.
- [x] Phase 3 authentication/design system approved.
- [x] Phase 4 education/content/discovery/progress approved.

## Phase 5 - Complete; Awaiting Review

- [x] Add stable question identity, immutable versions/options, validation, and workflow.
- [x] Add stable/versioned practice, quiz, and mastery definitions with fixed/pool selection.
- [x] Add immutable randomized attempt snapshots and server-authoritative timing/limits.
- [x] Add monotonic answer autosave, conflict reconciliation, and bounded reconnect recovery.
- [x] Add idempotent transactional submission, grading, receipts, and delayed disclosure.
- [x] Add result review, explanations, evidence-preserving mistake reports, and next actions.
- [x] Add deterministic spaced review state and append-only transition history.
- [x] Add informational anti-cheating extension points without automatic penalties.
- [x] Integrate due review and published quiz/question resources with search/dashboard flows.
- [x] Preserve stable published releases during replacement drafts.
- [x] Keep Focus independent through a typed assessment context only.
- [x] Emit stable assessment events and ranking/achievement eligibility facts only.
- [x] Add responsive accessible English/Arabic student and creator interfaces.
- [x] Pass unit, API, query-count, coverage, PWA build, Axe, RTL, and browser regression gates.
- [x] Update all source-of-truth documentation.
- [ ] Obtain explicit Phase 6 approval.

## Deferred Evidence / Inputs

- [ ] Run the complete suite against PostgreSQL in CI or a local PostgreSQL environment.
- [ ] Add a PostgreSQL concurrent-start/autosave/submit integration test with real row locks.
- [ ] Establish a representative assessment dataset and run the approved load plan in Phase 11.
- [ ] Integrate a malware scanner before production file ingestion; status is `not_configured`.
- [ ] Supply real institutions, curricula, question content, and creator scopes.
- [ ] Select production object storage/CDN and hosting.
- [ ] Approve legal privacy, retention, terms, account-deletion, and report-response policy.

## Later Product Inputs

- [ ] Ranking formula and periods (Phase 7).
- [ ] Achievement catalog and eligibility policy (Phase 7).
- [ ] Any additional anti-cheating idea, with fairness/evidence/appeal review before implementation.
- [ ] Subscription price, currency, grace period, and payment provider.
- [ ] Email and push providers.

## Guardrails

- Never modify `C:\Users\ramih\Desktop\Dentify-Before-Edits`.
- Work one approved phase at a time; do not start Phase 6 without explicit approval.
- Server remains the source of truth for deadlines, attempts, grading, results, and review state.
- Preserve backward-compatible APIs unless a change is intentionally versioned.
- Focus remains an independent product module.
- Add no Redis, Celery, WebSocket, broker, microservice, or AI provider without a proven need and
  prior owner approval.
- Do not claim PostgreSQL concurrency, load, malware scan, or Focus features without evidence.
