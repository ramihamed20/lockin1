# Phase 4 — Education, Content, Discovery, and Progress

Last updated: 2026-07-17

## Outcome

Phase 4 turns Lock-in from an account shell into a guided learning product. Students enter through
one Learn destination, follow a discipline-neutral academic hierarchy, search published learning
objects, open permission-mediated resources, bookmark them, save version-aware progress, complete
lessons, and receive a deterministic next-study projection on the dashboard.

This phase does not implement quizzes, flashcards, review scheduling, AI, or the full Focus Mode PDF
and annotation workspace. It establishes honest extension boundaries for those later phases.

## Skills Applied

| Skill | Phase 4 use |
|---|---|
| `impeccable` | Learning journey, command-center dashboard, empty/error/loading states, responsive layouts, RTL, and accessibility review. |
| `design-system` | Existing three-layer tokens and component contracts were extended without raw feature-local theming. |
| `security-best-practices` | Private file delivery, upload validation, backend permissions, CSRF/session boundary, content lifecycle, and PWA cache review. |
| `playwright` | Desktop Chrome and Pixel 7 learning/search/resource flows, Axe checks, RTL regression, and overflow checks. |

No dedicated installed Skill was available for Django architecture, DRF, PostgreSQL, PWA,
unit/integration testing, or load testing. No unannounced Skill was used.

## Domain Ownership

| Domain | Authoritative responsibility |
|---|---|
| `education` | Generic academic tree, publication/discoverability, materialized paths, and scoped creator capabilities. |
| `content` | Stable learning-object identity, immutable versions/assets, review/publication lifecycle, and current/published version pointers. |
| `files` | Private managed files, type/size/signature validation, digest, scan-state truth, Range delivery, and download policy. |
| `discovery` | Rebuildable search projection and normalized terms for published, permission-eligible resources. |
| `progress` | Bookmarks, version-bound learning progress, lesson completion, resume list, and deterministic dashboard projection. |

Views validate transport input and return stable DRF envelopes. Domain services own state changes,
transactions, optimistic revisions, authorization invariants, projection updates, and after-commit
events. Selectors own permission-filtered, paginated read queries.

## Flexible Academic Hierarchy

`EducationNode` supports institution, college, department, academic year, semester, subject, unit,
and lesson nodes. UUID materialized paths make subtree filtering and scoped authority checks cheap
without hardcoding dentistry or a fixed depth. Parent-kind rules prevent invalid relationships,
unique constraints prevent sibling slug/order ambiguity, and moves reject cycles while updating
descendant paths transactionally.

This is multi-institution content modeling, not a claim of tenant isolation. A future tenant model
would still require explicit data-isolation, administration, and operational policy.

## Learning Objects and Publication

A `LearningObject` is a stable learning identity. `LearningObjectVersion` is an immutable snapshot
of academic placement, type, title, summary, language, availability, policy, metadata, and assets.
The current draft may advance independently while the last published version remains available.

Lifecycle:

```text
draft → in review → published → archived
             ↘ rejected → new immutable revision → in review
```

PDF and audio are implemented. Video metadata is structurally anticipated but publication is
explicitly blocked until a secure delivery product is implemented. Future content types can add
version serializers/renderers without changing the academic tree or progress identity.

## Private File Boundary

- Originals remain outside public static/media routing.
- Uploads require an allowed extension, declared MIME, matching magic bytes, bounded size, and a
  SHA-256 digest.
- Scan state is explicit; the current local state is `not_configured`, never falsely “clean”.
- View/download requests re-evaluate authentication, publication/ownership, availability, and
  per-version download policy.
- Byte Range responses support efficient audio/PDF delivery without exposing a public filesystem
  URL.
- The original PDF is never mutated; annotations remain a separate later Focus subsystem.

## Discovery and Query Design

Search does not scan every domain table on every request. `SearchEntry` and normalized `SearchTerm`
form a small rebuildable projection populated by authoritative education/content services. Results
support resource kind, content type, academic path, language, publication, stable ordering, and DRF
pagination. Unicode NFKC/casefold normalization provides deterministic English/Arabic term matching.

Indexes cover published hierarchy traversal, materialized paths, creator scope, public content,
version ordering, file owner/validation state, search kind/type/time, normalized terms, bookmarks,
resume status, and lesson completion history. The public content list has an automated bounded-query
regression test: four listed objects must remain at or below ten SQL queries.

PostgreSQL full-text search is a future measured migration path. The projection boundary permits it
without changing public API or authoritative content models.

## Guided Student Experience

The dashboard is now a command center, not a menu. Its first region shows a deterministic next
action from saved progress/bookmarks or an honest “choose a path” state. Learn combines search,
published paths, progress signals, empty states, and direct resource links. Academic pages show the
next hierarchy level and related learning objects together, so students follow a journey instead of
browsing folders.

The learning-object page provides a permission-mediated resource surface, bookmark control, and
version-aware progress. Its `focus_context` is a small integration contract only. The professional
PDF renderer, annotation engine, gestures, toolbar, storage, and autosave remain in the standalone
Focus product and were not partially embedded here.

## Material Redesign Reasons

| Redesign | Usability reason |
|---|---|
| Dashboard menu/card grid → one next-study action plus progress/recent signals | Answers “what should I do now?” before presenting secondary choices. |
| Folder-style document navigation → academic path with related learning objects | Keeps subject context and progress visible instead of making the PDF the product. |
| Global creator authority → explicit academic subtree capabilities | Reduces accidental overreach and maps management tools to real responsibility. |
| Public media URL → authenticated view/download actions | Preserves access policy without making normal study feel like a file manager. |
| Monolithic content form → draft/review/publication actions with clear states | Makes ownership, review responsibility, and stable publication understandable. |
| Desktop-only management density → responsive lists and progressive editing | Keeps creator/admin work usable on tablet and phone without hiding authority state. |

## Validation

- Backend: 71 tests passed; 85.75% branch-aware coverage.
- Backend quality: Ruff, strict mypy (123 files), Django system check, and migration drift passed.
- Frontend: 55 tests passed; 91.35% statements, 82.04% branches, 89.58% functions, and 94.41% lines.
- Frontend quality: ESLint, TypeScript, and production PWA build passed.
- Browser: 9 Playwright scenarios passed with one intentional desktop skip for a mobile-only RTL
  scenario; Desktop Chrome and Pixel 7 were exercised.
- Accessibility: Axe found no violations in the exercised authenticated, learning, resource, and
  Arabic mobile flows; horizontal overflow assertions passed.
- PWA: 18 static precache entries; no runtime API cache; `/api/` denied from SPA navigation fallback.
- Production bundle: main JavaScript 289.20 KB / 91.34 KB gzip; CSS 31.07 KB / 6.31 KB gzip; Phase 4
  student and management pages remain route-split.
- Dependency audit: the Phase 4 npm install reported zero vulnerabilities.

## Honest Limits

PostgreSQL remains the required development/CI/production database, but no local PostgreSQL service
or Docker engine was available. The final local suite used only the explicit
`LOCKIN_TEST_USE_SQLITE=1` test fallback. PostgreSQL integration and the 2,000-user concurrency/load
target are not claimed as executed evidence and remain required in an environment that provides
PostgreSQL and load infrastructure.

No Redis, Celery, WebSocket, broker, microservice, AI provider, or speculative background worker was
added.
