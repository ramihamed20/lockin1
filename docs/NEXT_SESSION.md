# Lock-in Next Session

Last updated: 2026-07-17

## Start Here

Phase 6 is implemented and locally validated. Do not begin Phase 7 unless the owner explicitly
approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `PHASE_6_COMMUNITY.md`
3. `PHASE_5_ASSESSMENTS.md`
4. `DECISIONS.md`
5. `ARCHITECTURE.md`
6. `DESIGN.md`
7. `EVENTS.md`
8. `FOCUS_MODE.md`
9. `AI_EXTENSION_POINTS.md`
10. `PROGRESS.md`
11. `TODO.md`
12. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 6 isolated validation copy: `C:\tmp\Lockin-Rebuild-Phase6`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-6-contextual-community`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, static-only PWA cache.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL default; SQLite only behind `LOCKIN_TEST_USE_SQLITE=1` for local tests.
- Domains: Accounts, Focus foundation, Education, Content, Files, Discovery, Progress, Questions,
  Assessments, Community, and Moderation.
- Public community: contextual feed/discussions for lesson, learning object, question, and quiz.
- Replies: one level, revisioned/idempotent, duplicate/rate controlled, soft-delete tombstones.
- Creator spaces: one context, invitation membership, member/moderator roles, immediate revocation.
- Moderation: immutable evidence, report queue, assignment, transitions, duplicates, content actions,
  conflict-of-interest rules, private-space isolation, and append-only audit.
- Assessment API: existing question issue reports remain compatible and ingest moderation records.
- Events: lightweight synchronous after-commit bus; community/moderation emit notification-ready facts.
- Focus: independent module; community stores learning context only.
- AI: no package/provider/endpoint; extension ports only.
- Excluded: generic social mechanics, notification center, achievements/rankings, Redis, Celery,
  WebSockets, broker, microservices, and background workers.

## Validation Snapshot

- Backend: 119 tests, 85.62% branch-aware coverage; Ruff/format/mypy/Django/migration checks passed.
- Frontend: 106 tests; 89.71% statements, 80.07% branches, 86.40% functions, 93.72% lines.
- Browser: 19 Playwright passes and 1 intentional desktop skip; Phase 6 desktop/mobile slice passed
  Axe, Arabic RTL, landmark/focus, and overflow checks.
- PWA: 32 static precache entries, no API runtime cache; main JS 100.36 KB gzip, CSS 9.96 KB gzip.
- PostgreSQL concurrency/load: not run locally; no evidence claim.

## Review Focus

1. Confirm the absence of global posting keeps community useful rather than restrictive.
2. Review discussion/reply context, edit/delete tombstones, and report flow.
3. Review creator-space invitation, scope, revocation, and private evidence boundaries.
4. Review moderation assignment, evidence, conflict-of-interest, reversible actions, and audit history.
5. Confirm future notifications can subscribe to events without a community dependency.
6. Confirm Focus, AI, achievements/rankings, and infrastructure boundaries remain intact.

## Stop Condition

Stop after the Phase 6 commit and wait for owner approval.
