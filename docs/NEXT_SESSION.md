# Lock-in Next Session

Last updated: 2026-07-17

## Start Here

Phase 4 is implemented, validated locally, and awaiting owner review. Do not begin Phase 5 unless
the owner explicitly approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `PHASE_4_EDUCATION_CONTENT.md`
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
- Phase 4 working copy used for validation: `C:\tmp\Lockin-Rebuild-Phase4`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-4-education-content`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, static-only PWA cache.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL 18.4 default; SQLite only behind `LOCKIN_TEST_USE_SQLITE=1` for local tests.
- Domains: Accounts, Focus session foundation, Education, Content, Files, Discovery, Progress.
- Routes: student Learn/path/object, creator Content Studio, administrator Learning Structure.
- Events: lightweight synchronous after-commit bus; real account, Focus, content publication, and
  lesson-completion emissions.
- Focus: standalone product boundary; no Phase 4 PDF/annotation engine claim.
- AI: no package/provider/endpoint; extension ports only.
- Excluded: Redis, Celery, WebSockets, broker, microservices.

## Validation Snapshot

- Backend: 71 tests, 85.75% coverage; Ruff/mypy/Django/migration checks passed.
- Frontend: 55 tests; 91.35% statements and 82.04% branches; ESLint/TypeScript/build passed.
- Browser: 9 Playwright passes and 1 intentional device skip on Desktop Chrome/Pixel 7; Axe clear.
- PWA: 18 static precache entries, no API runtime caching, main JS 91.34 KB gzip.
- PostgreSQL/load: not run locally; no evidence claim.

## Review Focus

1. Confirm the generic academic hierarchy and scoped creator model match expected operations.
2. Review the learning-object version and publication workflow.
3. Review private file/view/download behavior and the truthful absent malware scanner.
4. Review the Learn journey and command-center dashboard on phone/tablet/desktop.
5. Confirm Focus remains independent and only receives a versioned context contract.

## Stop Condition

Stop after the Phase 4 commit and wait for owner approval.
