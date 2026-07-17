# Lock-in Next Session

Last updated: 2026-07-17

## Start Here

Phase 5 is implemented and locally validated. Do not begin Phase 6 unless the owner explicitly
approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `PHASE_5_ASSESSMENTS.md`
3. `DECISIONS.md`
4. `ARCHITECTURE.md`
5. `DESIGN.md`
6. `FOCUS_MODE.md`
7. `EVENTS.md`
8. `AI_EXTENSION_POINTS.md`
9. `PROGRESS.md`
10. `TODO.md`
11. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 5 isolated validation copy: `C:\tmp\Lockin-Rebuild-Phase5`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-5-assessments`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, static-only PWA cache.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL default; SQLite only behind `LOCKIN_TEST_USE_SQLITE=1` for local tests.
- Domains: Accounts, Focus foundation, Education, Content, Files, Discovery, Progress, Questions,
  Assessments.
- Student assessment routes: catalog/review, quiz overview, dedicated attempt, released/delayed result.
- Creator route: Assessment Studio with question and quiz workflow.
- Assessment behavior: stable releases, immutable attempt snapshots, server deadlines, revisioned
  autosave, idempotent submission, transactional grading, delayed disclosure, reports, spaced review.
- Events: lightweight synchronous after-commit bus; no broker or worker.
- Focus: independent module; assessment exposes typed context only.
- AI: no package/provider/endpoint; extension ports only.
- Excluded: achievements/rankings implementation, punitive proctoring, Redis, Celery, WebSockets,
  broker, microservices.

## Validation Snapshot

- Backend: 91 tests, 85.30% coverage; Ruff/format/mypy/Django/migration checks passed.
- Frontend: 82 tests; 89.92% statements, 80.39% branches, 87.91% functions, 93.81% lines.
- Browser: 13 Playwright passes and 1 intentional device skip; Phase 5 4/4; Axe and RTL clear.
- PWA: 24 static precache entries, no API runtime cache, main JS 96.41 KB gzip.
- PostgreSQL concurrency/load: not run locally; no evidence claim.

## Review Focus

1. Confirm question/quiz authoring and publication rules match academic operations.
2. Review the focused attempt flow, autosave/conflict recovery, deadline, and final confirmation.
3. Review immediate versus after-close result disclosure and mistake reporting.
4. Confirm spaced review is explainable and the dashboard gives a useful next action.
5. Confirm integrity signals are informational and cannot penalize automatically.
6. Confirm Focus, achievements, rankings, and AI boundaries remain intact.

## Stop Condition

Stop after the Phase 5 commit and wait for owner approval.
