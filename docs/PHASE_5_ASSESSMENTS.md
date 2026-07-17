# Phase 5 - Assessment Learning Ecosystem

Last updated: 2026-07-17

## Outcome

Phase 5 implements questions, quizzes, practice, mastery checks, attempts, autosave, grading,
results, mistake reports, and deterministic spaced review as one server-authoritative learning
ecosystem. It does not implement the Phase 7 achievement catalog or rankings; it emits stable
eligibility facts that those later domains can consume.

## Domain Boundaries

- `apps.questions` owns stable question identity, immutable versions/options, validation, scoped
  authoring, review, publication, retirement, and search projection.
- `apps.assessments` owns stable/versioned quizzes, fixed and pool selection, attempt snapshots,
  answer revisions, server deadlines, idempotent finalization, result-release policy, integrity
  signals, and question reports.
- `apps.progress` owns per-user question review state and append-only scheduling logs.
- Focus stays independent. Assessments expose only `{ context_type: "quiz", context_id }`; they do
  not create or own Focus sessions.

## Correctness and Fairness Invariants

1. The server selects and snapshots questions/options before an attempt begins.
2. The snapshot retains the exact question version, option order, explanation, and answer key used
   for grading; later content edits cannot change a submitted score.
3. Server time and the stored deadline are authoritative. A late write finalizes the attempt and is
   rejected rather than extending time from the browser.
4. Start and submit commands use UUID idempotency keys. Reuse for another quiz/attempt is a conflict.
5. Autosave accepts a strictly increasing client revision and returns a server revision. A stale
   conflict returns the authoritative stored answer.
6. Grading, result creation, review scheduling, receipt creation, and event registration occur
   transactionally. Repeated submission returns the same result.
7. Answer keys, explanations, scores, and pass state are withheld until configured release.
8. Integrity events are informational evidence only and never alter score, deadline, or status.
9. A published question or quiz remains available while a private replacement draft is prepared.
10. Retirement removes future availability without rewriting prior attempt evidence.

## Spaced Review

The first algorithm is deterministic and intentionally small: a correct outcome advances through
1 day, 6 days, then the prior interval multiplied by bounded ease; an incorrect outcome resets to
1 day and increments lapses. Every transition records previous/new state, result, and exact question
version. The implementation is replaceable later, but current behavior is explainable and testable.

## Frontend Product Design

- The assessment home leads with due review, then practice/quiz/mastery filters. This is better than
  a quiz menu because it gives the student a useful next action.
- A focused attempt has its own shell, one question at a time, a question map, visible save state,
  server-synchronized timer, keyboard shortcuts, explicit final confirmation, and connection
  recovery. This reduces cognitive load and accidental submission.
- The result page continues the learning loop with answer review, explanations, mistake reporting,
  and Study/Practice actions. Delayed results show only receipt and release time.
- Creator tooling separates question composition from quiz configuration and uses the existing
  draft/review/publish lifecycle.
- English/Arabic share one component tree and logical CSS. Desktop/mobile passed Axe and overflow
  checks.

## Security Review

- Student endpoints inherit authenticated, CSRF-enforced same-origin sessions.
- Attempt/result/report selectors scope records to the authenticated user.
- Management requires creator/administrator entry plus subtree capabilities in services.
- Student attempt serializers omit answer keys and explanations; delayed results also null official
  score, pass, and count fields.
- Report evidence contains the private key for reviewer investigation but is not serialized by the
  student API.
- Recovery stores validated attempt/question/option UUIDs, revision, and timestamp only. It stores no
  answer text, answer key, session, CSRF token, or result.
- PWA runtime API caching remains empty, so attempts/submissions are not cached or replayed.

## Validation Evidence

- Backend: 91 tests passed; branch-aware coverage 85.30%.
- Backend gates: Ruff check/format, strict mypy across 152 source files, Django system check, and
  migration drift passed.
- Frontend: 82 tests passed; 89.92% statements, 80.39% branches, 87.91% functions, 93.81% lines.
- Frontend gates: ESLint, TypeScript production build, and generated PWA passed.
- Browser regression: 13 passed and 1 intentional device skip across Desktop Chrome and Pixel 7.
- Phase 5 browser slice: 4/4 passed with Axe, LTR/RTL, autosave, submission, result release, and no
  horizontal overflow.
- Production build: 24 static precache entries; no API runtime cache; main JS 96.41 KB gzip;
  assessment pages are route-split.

## Honest Limitations

- Local tests used the explicit SQLite fallback because PostgreSQL/Docker was unavailable.
  PostgreSQL row-lock and concurrent-submit behavior still requires CI/integration evidence.
- No 2,000-user load claim is made. Load testing remains Phase 11 with representative data.
- No achievements, rankings, proctoring penalties, AI, Redis, Celery, broker, WebSocket, or
  microservice was added.
- Focus PDF rendering/annotation remains a separate later product phase.

## Stop Condition

Phase 5 was approved by the owner. Phase 6 implementation and evidence are recorded separately in
`PHASE_6_COMMUNITY.md`.
