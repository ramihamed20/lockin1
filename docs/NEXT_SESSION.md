# Lock-in Next Session

Last updated: 2026-07-19

## Start Here

Phase 10 Focus Workspace is complete and awaiting owner review. Do not begin the next phase unless
the owner explicitly approves it.

Read in order:

1. `PRODUCT.md`
2. `PHASE_10_FOCUS_WORKSPACE.md`
3. `FOCUS_MODE.md`
4. `DECISIONS.md`
5. `ARCHITECTURE.md`
6. `EVENTS.md`
7. `DESIGN.md`
8. `PHASE_9_OPERATIONS.md`
9. `AI_EXTENSION_POINTS.md`
10. `PROGRESS.md`
11. `TODO.md`
12. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 10 isolated validation copy: `C:\tmp\Lockin-Rebuild-Phase10`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-10-focus-workspace`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, PWA, PDF.js 5.7.284.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL default; local test evidence uses opt-in SQLite.
- Focus backend: session/activity/workspace/annotation collection/annotation/sync receipt models,
  strict services/selectors/APIs, generic entitlement boundary, authorized document resolver, and
  started/paused/resumed/completed/abandoned events.
- Focus frontend: dedicated route outside `AppShell`, PDF adapter, virtual pages, navigation,
  gestures, annotation layer/reducer, toolbar, thumbnails/notes, autosave/recovery, shortcuts,
  responsive RTL, mixed-direction content handling, accessibility preferences, and bounded
  extension slots.
- Original PDFs remain immutable. Server owns access, duration, lifecycle, revisions, and sync.
- AI, collaboration, OCR, voice, flashcards, timer, document search, and shared annotations are not
  implemented.
- Redis, Celery, WebSockets, broker, worker, microservice, and new external provider are excluded.

## Validation Snapshot

- Backend: 165 tests passed at 85.37% coverage; Ruff/format, strict mypy, checks, and migration drift
  passed. The final 13-test Focus subset passed independently.
- Frontend: 29 files / 158 tests passed at 90.87% statements, 80.39% branches, 87.21% functions,
  and 95.18% lines; ESLint, TypeScript, lockfile audit, and the production PWA build passed.
- Complete Playwright: 32 passed and 2 intentional desktop skips for mobile-only assertions. Focus
  passed desktop/mobile Axe, Arabic RTL, real PDF render, autosave, notes, and overflow checks.
- Production deployment check exited 0 with no Django security or Focus schema warning. Ninety-six
  inherited drf-spectacular warnings remain tracked and the global schema is not claimed clean.
- Local evidence does not claim PostgreSQL concurrency, real stylus hardware behavior, perfect palm
  rejection, representative large-document memory, or multi-hour session performance.

## Review Focus

1. Confirm Focus business services import no assessment/community/AI/motivation/commerce/
   notification internals.
2. Review content/file and entitlement integration boundaries and no-existence-leak ordering.
3. Review server lifecycle/duration, row locks, workspace revision, annotation collection revision,
   idempotency receipts, page/batch bounds, and owner scoping.
4. Confirm source PDF immutability and normalized renderer-independent annotation records.
5. Review exact-mutation acknowledgement so older requests cannot erase newer local edits.
6. Review deep-validated account/version IndexedDB recovery and honest save state.
7. Review PDF.js isolation, visible-range activation, current-page observer separation, cancellation,
   DPR cap, text extraction, and resource cleanup.
8. Review finger-pan vs pen/mouse writing, pressure/tilt honesty, pinch/double-tap, keyboard, clear
   confirmation, high contrast, reduced motion, responsive overlay, and RTL.
9. Confirm extension slots contain no speculative feature or infrastructure implementation.
10. Confirm the next phase remains blocked pending explicit approval.

## Outstanding Production Evidence

Run PostgreSQL concurrent workspace/annotation/idempotency tests; measure hundred-page/image-heavy
PDFs, hundreds of annotations, long-session memory and reconnect behavior; test iPad/Apple Pencil
and Android stylus browsers; validate production object storage/range/CDN behavior; and maintain the
existing inherited OpenAPI and platform load/security gates.

## Stop Condition

Phase 10 is committed. Wait for owner approval before any next phase.
