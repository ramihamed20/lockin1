# Lock-in Changelog

All notable rebuild changes are documented here.

## 2026-07-18 - Phase 7

### Added

- Independent XP, achievement, ranking, streak, and notification domains.
- Idempotent XP transaction ledger, balance projection, eligibility metadata, and rebuild service.
- Versioned achievement definitions/evidence/progress/earned records with five meaningful seeds.
- Versioned streak policy, qualifying activity evidence, and out-of-order daily recomputation.
- Ranking facts, privacy profiles, deterministic audited snapshots, tie strategies, checksums, and
  persisted failed-calculation audit state.
- Recipient-owned in-app notifications, deduplication, unread counters, safe target resolution,
  preferences, delivery records, and bounded administrative platform notices.
- Stateless motivation event integration for accounts, learning, Focus, assessment, community, and
  moderation facts.
- `rebuild_motivation` reconciliation command for missed best-effort subscriber effects.
- Server-authoritative progression/ranking/streak/achievement/notification API routes.
- Lazy accessible English/Arabic `/progression` and `/notifications` routes with mobile/tablet UI.
- Phase 7 API/domain/unit tests, frontend tests, and desktop/mobile Playwright coverage.
- `PHASE_7_MOTIVATION.md` with rules, boundaries, security, design reasons, evidence, and exclusions.

### Security and Correctness

- Exposed no client mutation path for XP, rank, streak evidence, or achievement awards.
- Deduplicated every durable event effect by authoritative source identity.
- Bounded Focus/assessment awards and excluded raw engagement-volume rewards.
- Rechecked current permissions before opening contextual notification targets and rejected unsafe
  routes.
- Serialized notification counter updates under a consistent lock order.
- Preserved ranking calculation failures as audit snapshots and kept public views snapshot-only.
- Kept required account/security notifications enabled and future email/push channels unavailable.

### Product and Accessibility

- Reframed gamification as calm learning momentum with visible qualifying rules.
- Placed meaningful milestone progress before competitive ranking information.
- Added ranking freshness, rule disclosure, own position, inclusion, and display-name privacy.
- Added useful loading, empty, failure, recovery, read, and unavailable-destination states.
- Corrected muted notification metadata contrast found during browser accessibility review.
- Preserved one logical-property English/Arabic component tree, reduced motion, keyboard controls,
  semantic progress/tables/forms, and responsive no-overflow layouts.

### Validation

- Backend: 131 passed; 85.90% branch-aware coverage; Ruff, strict mypy (234 files), and migration
  drift checks passed.
- Frontend: 116 passed; 90.19% statements, 80.10% branches, 87.14% functions, 94.13% lines; ESLint,
  TypeScript, and production PWA build passed.
- Browser: 23 passed and 1 intentional desktop skip across desktop/mobile Chromium; Axe, RTL,
  landmarks/focus, and overflow checks passed.
- PWA: 34 static precache entries; no private API runtime cache; main JS 102.67 KB gzip.

### Boundaries

- No subscription/payment, real email/push delivery, freeze/grace behavior, AI, or Focus workspace
  change.
- No Redis, Celery, WebSocket, broker, microservice, background worker, or new frontend dependency.
- PostgreSQL concurrency and representative load remain unclaimed local evidence gates.

## 2026-07-17 - Phase 6

### Added

- Contextual public discussions for lessons, learning objects, questions, and quizzes.
- One-level replies, revisions, idempotency, duplicate/rate controls, soft-delete tombstones, and
  stable cursor pagination.
- Context-bound private creator spaces with email invitations, member/moderator roles, revocation,
  and append-only membership history.
- Central moderation reports for discussions, comments, questions, answer keys, explanations, and
  learning objects with immutable evidence snapshots.
- Server-authoritative assignment, triage/investigation/final transitions, duplicate linking,
  conflict-of-interest checks, reversible content actions, and append-only audit history.
- Backward-compatible assessment issue-report ingestion into the moderation domain.
- Typed after-commit community and moderation events for later notification subscribers.
- Contextual community entry points in lesson, learning-object, quiz, result, and result-question UI.
- Responsive English/Arabic community, discussion, creator-space, and moderation routes.
- `PHASE_6_COMMUNITY.md` with boundaries, security/fairness invariants, evidence, and exclusions.

### Fixed

- Prevented global moderators from seeing private creator-space report evidence without space scope.
- Prevented member-invite user lookup before space-management authorization, avoiding enumeration.
- Made reports and community revision/history records read-only in Django Admin so staff cannot
  bypass domain revisions, immutable evidence, or audit history.
- Removed nested main landmarks from community pages and preserved an accessible single-page main.
- Cached role facts during moderation serialization and preloaded relations to prevent feed N+1s.
- Kept API cursor links same-origin before the frontend follows them.

### Validated

- Backend: Ruff format/check, strict mypy (176 files), migrations, Django check, and 119 tests passed.
- Backend branch-aware coverage: 85.62%, above the required 85% gate.
- Frontend: ESLint, TypeScript, 106 tests, and production PWA build passed.
- Frontend coverage: 89.71% statements, 80.07% branches, 86.40% functions, 93.72% lines.
- Browser: 19 passed and 1 intentional desktop skip across Desktop Chrome and Pixel 7; Phase 6
  community/discussion/moderation flows passed Axe, Arabic RTL, and overflow checks.
- PWA: 32 static precache entries, no API runtime cache; main JS 100.36 KB gzip, CSS 9.96 KB gzip.

### Not Added

- No generic posts, reactions, followers, direct messages, popularity feed, or study groups.
- No notification center/delivery, achievements, rankings, subscriptions, or payments.
- No Focus renderer/annotation implementation and no AI provider/feature.
- No Redis, Celery, WebSockets, broker, microservice, or background worker.
- No PostgreSQL concurrency/load claim; local functional validation used explicit SQLite fallback.

## 2026-07-17 - Phase 5

### Added

- Versioned question bank with single-choice, true/false, completion-choice, difficulty, language,
  explanations, options, scoped authoring, review, publication, retirement, and search projection.
- Versioned practice/quiz/mastery definitions with fixed/pool selection, server timing, retry and
  availability rules, randomization, result release, pass marks, and eligibility facts.
- Immutable attempt snapshots, monotonic autosave revisions, bounded reconnect recovery, server
  deadlines, start/submission idempotency, transactional grading, and submission receipts.
- Immediate/delayed results, answer review, explanations, evidence-preserving mistake reports, and
  informational integrity signals without automatic penalties.
- Deterministic spaced review state/logs and due-review integration into the learning command center.
- Focused attempt shell, assessment catalog, quiz overview, result journey, and creator assessment
  studio in responsive English/Arabic UI.
- Assessment events for publication, start, autosave, submission, and report creation.
- `PHASE_5_ASSESSMENTS.md`, unit/API/query/accessibility/RTL/browser regression coverage.

### Fixed

- Published question and quiz releases remain student-visible while a replacement draft is edited.
- Due review remains attached to the published question release while a private draft exists.
- Search routes quiz results correctly and avoids a standalone student question/key surface.
- Focused attempt now has a semantic level-one heading discovered by real Axe browser testing.

### Validated

- Backend: 91 tests, 85.30% branch-aware coverage; Ruff, format, strict mypy, Django check, and
  migration drift passed.
- Frontend: 82 tests; 89.92% statements, 80.39% branches, 87.91% functions, 93.81% lines; ESLint,
  TypeScript, and production PWA build passed.
- Browser: 13 passed and 1 intentional device skip across Desktop Chrome and Pixel 7; Phase 5 was
  4/4 with Axe, RTL, autosave, submission, disclosure, and overflow assertions.
- PWA: 24 static precache entries, no API runtime cache; main bundle 96.41 KB gzip.

### Not Added

- No rankings or achievement implementation; only stable eligibility facts for Phase 7.
- No automated proctoring penalty, webcam, biometric, or invasive anti-cheating behavior.
- No Focus PDF/annotation implementation and no assessment ownership of Focus sessions.
- No AI, Redis, Celery, WebSocket, broker, microservice, or speculative worker.
- No PostgreSQL concurrency or 2,000-user load claim from this workstation.

## 2026-07-17 — Phase 4

### Added

- Generic institution-to-lesson academic tree with materialized paths, lifecycle, move protection,
  and subtree-scoped creator capabilities.
- Stable learning objects, immutable versions/assets, review/publication/archive, owner transfer,
  scheduled availability, and stable last-published delivery during later drafts.
- Private managed PDF/audio upload, MIME/signature/size validation, SHA-256 digest, explicit scan
  status, Range delivery, and per-version download policy.
- Rebuildable Unicode-normalized search projection with resource/content filters and pagination.
- Bookmarks, version-aware progress, lesson completion, resume list, and deterministic next-study
  dashboard projection.
- Student Learn/path/object routes, creator Content Studio, administrator Learning Structure, and a
  next-action command-center dashboard in English/Arabic responsive UI.
- Real `content.content_published` and `education.lesson_completed` after-commit domain events.
- `PHASE_4_EDUCATION_CONTENT.md`, query-count regression test, expanded unit/API suites, and Phase 4
  desktop/mobile browser flows.

### Validated

- Backend: Ruff, strict mypy, Django checks, migrations, and 71 tests at 85.75% coverage.
- Frontend: ESLint, TypeScript, 55 tests at 91.35% statements/82.04% branches, and PWA build.
- Playwright: 9 passed and 1 intentional device skip; Axe and no-horizontal-overflow assertions
  passed on Desktop Chrome and Pixel 7.
- Static-only PWA cache: 18 entries, no API runtime cache; main JavaScript 91.34 KB gzip.
- Phase 4 npm installation audit reported zero vulnerabilities.

### Not Added

- No quiz, flashcard, review scheduling, community, ranking, achievement, subscription, or payment.
- No full Focus PDF renderer, annotation engine, toolbar, gesture, autosave, or storage feature.
- No AI provider, AI endpoint, vector database, or AI-generated recommendation.
- No Redis, Celery, WebSocket, broker, microservice, or speculative worker.
- No local PostgreSQL/load-test claim; the workstation used the explicit SQLite test fallback.

## 2026-07-15 — Phase 3

### Added

- Responsive three-layer design system, accessible primitives, Lock-in monogram, mascot study
  scene, and production raster PWA icons.
- English/Arabic catalogs, real `lang`/`dir`, RTL layout, desktop rail, tablet drawer, and mobile nav.
- Registration, verification, login/logout, recovery, profile, password/email, and session UI/API.
- Hashed expiring single-use account tokens and database-backed scoped account throttles.
- Additive student/moderator/creator/administrator roles with backend enforcement and last-admin guard.
- Truthful role-aware account dashboard and real administrator account totals.
- Append-oriented account security records and account after-commit domain events.
- `DESIGN.md` and `PHASE_3_AUTH_DESIGN.md`.
- Unit/API/browser/accessibility tests for Phase 3 flows.

### Validated

- Backend lint, strict typing, Django checks, migration drift, and 36 tests at 88.93% coverage.
- Frontend lint, typing, 30 tests at 91.75% statement/83.39% branch coverage, and PWA build.
- Five Playwright checks passed with one intentional device skip; Axe found no violations.
- Desktop/mobile/Arabic screenshots and no-horizontal-overflow assertions passed.

### Not Added

- No education/content hierarchy, quiz, community, ranking, subscription, or payment feature.
- No PDF renderer or annotation engine implementation; Focus remains an independent foundation.
- No AI provider or AI feature.
- No Redis, Celery, WebSockets, broker, or microservice.
- No PostgreSQL or concurrency result beyond configured CI; workstation testing used explicit SQLite.

## 2026-07-15 — Phase 2

### Added

- Runnable React/TypeScript/Vite/PWA and Django/DRF foundation.
- PostgreSQL 18.4 development/CI configuration and initial migrations.
- Custom UUID/email User model.
- Focus session, timeline, selectors, services, and typed domain events.
- Focus frontend contracts and extensible tool registry.
- Internal after-commit event bus.
- AI extension boundary without AI implementation.
- Environment-separated secure settings, versioned API, OpenAPI, JSON logs, request IDs, and
  health/readiness endpoints.
- Exact direct package pins, npm lockfile, Docker development workflow, CI, and owner operations
  guide.
- pytest, Vitest, and Playwright foundation tests.

### Validated

- Backend lint, format, strict type check, Django checks, migrations, and 14 tests.
- Frontend lint, type check, 4 unit tests, production PWA build, desktop/mobile E2E, and direct
  Playwright CLI snapshot.
- No runtime API cache in the generated service worker and zero npm audit findings at install.

### Not Added

- No authentication UI or registration endpoint.
- No PDF renderer/annotation UI despite establishing Focus extension points.
- No AI provider or AI feature.
- No Redis, Celery, WebSockets, broker, or microservice.
- No production deployment or concurrency claim.

## 2026-07-15 — Phase 1

### Added

- Initial product specification for Lock-in.
- Role and permission baseline for student, moderator, content creator, and administrator.
- Twenty-two feature specifications with edge cases, acceptance criteria, and required tests.
- Accessibility, performance, scalability, security, reliability, and PWA requirements.
- Usability reasons for major redesign directions.
- Modular-monolith architecture direction.
- Product and architecture decision log.
- Progress, TODO, audit, and session-handoff documentation.

### Decisions

- Confirmed React/TypeScript/Vite/PWA, Django/DRF, and PostgreSQL.
- Confirmed separate rebuild directory and read-only reference project.
- Excluded Redis, Celery, WebSockets, and microservices until justified.
- Selected server-managed web sessions with CSRF as the initial auth direction.
- Selected WCAG 2.2 AA as the provisional measurable accessibility target.
- Selected asynchronous creator spaces for version 1.

### Not Added

- No frontend or backend code.
- No project dependencies.
- No database schema or migrations.
- No Docker/CI/runtime configuration.
- No real payment, email, push, or storage provider.

## Phase 0

- Existing reference application audited.
- Skills inventoried and selected.
- Runtime and responsive behavior inspected.
- Current architecture, security, performance, accessibility, dependency, and testing risks documented.
