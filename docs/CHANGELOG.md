# Lock-in Changelog

All notable rebuild changes are documented here.

## 2026-07-19 - Phase 11

### Added

- Strict production settings, file-mounted secret handling, deploy checks, release/preflight commands,
  PostgreSQL owner/runtime grant enforcement, and readiness evidence.
- Hardened multi-stage backend/edge images, Gunicorn contract, Nginx TLS/reverse proxy/security
  headers/rate/body limits, PostgreSQL initialization, and production Compose topology.
- PostgreSQL dump/hash/catalog validation, isolated restore verification, bounded HTTP probe, query
  budgets, gzip bundle budgets, and PostgreSQL readiness regressions.
- Required PostgreSQL/release/preflight, dependency audit, full Playwright, image, Nginx, Compose,
  and final aggregate CI gates.
- Production security review, deployment checklist, backup/recovery runbook, performance baseline,
  and Phase 11 implementation record.

### Security and correctness

- Made clean malware-scan evidence mandatory for production upload delivery/publication/startup.
- Made duplicate registration non-enumerating across model-validation and uniqueness-race paths.
- Closed provider webhook routes when no matching provider is configured.
- Added secure `__Host-` cookies, strict HTTPS origins/proxy contract, private API docs, bounded upload
  memory/request sizes, non-root read-only containers, and least-privilege audit-safe database roles.
- Preserved visible OpenAPI/HSTS-preload warnings as documented debt/accepted risk instead of
  globally silencing them.

### Validation

- 180 backend tests passed (2 PostgreSQL-only local skips), 85.14% coverage, and all Ruff/format/
  strict-mypy/Django/migration/compile gates passed.
- 158 frontend tests passed with 95.18% line coverage; production build and corrected gzip budgets
  passed.
- 32 Playwright tests passed with 2 intentional project skips after explicit preview startup wait.
- Local Docker/PostgreSQL/network-audit execution remains honestly deferred to mandatory CI/staging.

## 2026-07-19 - Phase 10

### Added

- Independent Focus workspace/session/annotation persistence with optimistic revisions, idempotent
  sync receipts, bounded page loads, owner history, and lifecycle actions.
- Dedicated lazy Focus shell, private same-origin PDF.js renderer/worker, virtual page activation,
  render cancellation, extracted text, page navigation, zoom, pan, pinch, double-tap, and fullscreen.
- Renderer-independent normalized pen/pencil/highlighter/shape/text/sticky-note annotations,
  erasing, colors, thickness, undo/redo, note editing, and confirmed page clearing.
- Incremental autosave, schema-versioned account/document IndexedDB recovery, PWA/unload guards,
  offline/local/server/conflict/failure states, and reconnect retry.
- Adaptive thumbnails/notes panels, keyboard shortcuts/help, high contrast, reduced motion,
  screen-reader status/text, and English/Arabic RTL layouts.
- Duplicate-safe bounded future extension slots and `PHASE_10_FOCUS_WORKSPACE.md`.

### Security and Correctness

- Enforced authentication, generic server entitlement, current content access, ownership, page
  bounds, strict mutation schemas, batch limits, revisions, and idempotency digest integrity.
- Kept the PDF immutable and verified its checksum is unchanged by annotation sync.
- Accepted only same-origin private file view URLs in the PDF adapter and kept authenticated files
  out of Workbox runtime cache.
- Deep-validated IndexedDB records as untrusted input and stored no credentials, CSRF value, source
  PDF, assessment answer, or unrestricted payload.
- Derived active duration from the server activity timeline and rejected client duration.
- Preserved newer local edits when older sync acknowledgements arrive; supported same-ID undo
  restoration after soft deletion.

### Product and Accessibility

- Replaced the embedded browser PDF object as the primary study path with an immersive document-
  first workspace outside global navigation.
- Kept optional panels bounded/closed and used a mobile overlay so controls do not consume most of
  the page.
- Exposed exact save durability states and disabled completion until server acknowledgement.
- Reserved finger input for pan/gestures, retained browser-reported pen pressure/tilt, and made no
  perfect palm-rejection claim.
- Added named native controls, 44px targets, live status, keyboard equivalents, extracted PDF text
  where available, confirmed clearing, high contrast, reduced motion, and logical RTL.
- Browser validation corrected responsive controls whose CSS glyphs polluted accessible names,
  made the PDF scroll region keyboard-focusable, and preserved LTR/RTL content direction inside the
  surrounding localized interface.

### Validation

- Backend: 165 tests, 85.37% coverage, Ruff/format, strict mypy, Django/migration checks, and 13
  final Focus regressions passed.
- Frontend: 158 tests, 90.87% statement and 80.39% branch coverage, ESLint, TypeScript, zero lockfile
  vulnerabilities, and production PWA build passed.
- Playwright: 32 passed and 2 intentional desktop skips for mobile-only checks; desktop/mobile Axe,
  Arabic RTL, real-PDF rendering, annotation autosave, visual review, and overflow passed.
- Production deployment check exited 0 with no Django security or Focus schema warning; 96 inherited
  drf-spectacular findings remain tracked.

### Boundaries

- Focus does not import assessment, community, AI, motivation, commerce, payment, or notification
  domains; content/file and entitlement checks are API integration boundaries only.
- No AI, collaboration, OCR, voice, flashcards, timer, document search, Redis, Celery, WebSocket,
  broker, worker, microservice, or speculative infrastructure was added.
- PostgreSQL concurrency, representative large-document/load/memory evidence, and real stylus
  device evidence remain explicit production gates.

## 2026-07-18 - Phase 9

### Added

- Independent administration, analytics, audit, reporting, operational-action, and system-
  configuration domains plus stateless operational event integration.
- Operational capability/role catalog, assignments, session/resource discovery, dedicated
  overview/content/support dashboards, system health, and paginated user directory.
- Durable idempotent analytics facts, UTC daily metrics/distinct learners, freshness, bounded API,
  and `rebuild_operational_analytics`.
- Append-only recursively redacted audit records with actor/action/target/reason/source/correlation/
  before/after/related evidence.
- Previewed, confirmed, idempotent account status actions with protection, session termination, and
  partial-result summaries.
- Previewed bounded CSV report exports with expiring confirmations, row limits, and row/hash audit.
- Typed versioned allowlisted non-secret configuration with optimistic concurrency and reason/audit.
- Provider-neutral metrics/error contracts, structured normalized telemetry, and safe authorized
  component health.
- Lazy accessible English/Arabic operations routes for overview, content, support, users, audit,
  reports, and configuration.
- `PHASE_9_OPERATIONS.md` with architecture, APIs, security, operations, UX, validation, limitations,
  and exclusions.

### Security and Correctness

- Required server capabilities on every operational API; product roles cannot self-authorize.
- Protected the final effective platform administrator and blocked operator self-suspension.
- Delegated account mutations to the accounts domain and invalidated suspended sessions.
- Redacted secret-like audit/error context and excluded secrets from system configuration/health.
- Bounded action targets, report rows/date ranges, preview TTLs, analytics rebuild range, user search,
  and payload schemas.
- Rejected unknown report filters and neutralized spreadsheet formula prefixes in CSV exports.
- Preserved CSRF/session enforcement and added secure same-origin CSV download handling.
- Production deployment security check passed with strict HTTPS/HSTS test configuration.

### Product and Accessibility

- Split operations into task-specific overview/content/support workspaces rather than one dashboard.
- Replaced wide user tables with a responsive list/detail workspace and inline confirmations.
- Exposed analytics period/timezone/freshness and honest `not_configured` provider health.
- Added skeleton/empty/error/retry/result states, semantic lists/description lists/forms, logical RTL,
  reduced motion, touch sizing, and labeled landmarks.
- Browser review found and fixed a duplicate heading and unnamed complementary landmarks.

### Validation

- Backend: 157 passed; 85.64% branch-aware coverage; Ruff lint/format, strict mypy (403 files),
  migration drift, and production deployment checks passed.
- OpenAPI generation completed with no Phase 9 view warnings; 96 inherited APIView/operation-id
  warnings remain tracked and the global schema is not claimed clean.
- Frontend: 153 passed; 90.87% statements, 80.08% branches, 87.48% functions, 95.16% lines;
  TypeScript, ESLint, lockfile installation/audit, and production PWA build passed.
- Browser: 29 passed and 1 intentional desktop skip; Phase 9 desktop/mobile passed Axe, RTL,
  landmarks, preview/confirmation, and overflow. Screenshots were visually reviewed.

### Boundaries

- Focus remains independent and AI remains unimplemented/provider-independent.
- No Redis, Celery, WebSocket, broker, microservice, scheduler, worker, BI vendor, or monitoring
  vendor was added.
- PostgreSQL concurrency, representative load, production database audit grants, scheduled reports,
  alerts/providers, and inherited schema warnings remain evidence/debt gates.

## 2026-07-18 - Phase 8

### Added

- Independent product catalog, subscription, entitlement, payment, invoice, refund, and provider
  integration domains plus a stateless commerce event boundary.
- Immutable plan versions, regional/versioned prices, integer minor-unit amounts, and currency
  exponents.
- Explicit subscription accounts, lifecycle periods, cancellation, revisions, and append-only
  idempotent transitions.
- Capability definitions/rules/grants/audit and centralized entitlement decision/service/DRF mixin.
- Server-owned payment and invoice snapshots with append-only transition evidence.
- Administrator-authorized, reserved, provider-confirmed, idempotent partial/full refunds.
- Provider protocol, safe disabled adapter, signed fake development adapter, bounded verified
  webhook ingestion, deduplication/audit, and `reconcile_commerce`.
- Required billing notification category and event-driven commerce notifications.
- Lazy accessible English/Arabic `/subscription` **Plan & access** route and Phase 8 tests.
- `PHASE_8_SUBSCRIPTIONS.md` with architecture, security, UX reasons, evidence, exclusions, and
  launch inputs.

### Security and Correctness

- Rejected client-owned amount, currency, success, access, and unexpected financial fields.
- Required stable idempotency for payment/refund operations and exact provider amount/currency match.
- Bounded webhook payloads, verified timestamp/HMAC/exact schema, avoided raw-payload storage, and
  rejected provider-ID digest conflicts.
- Preserved failed provider processing audit and made repeated success/refund delivery harmless.
- Prevented over-refund with pending reservations and made all commerce admin records read-only.
- Made production fail closed for fake/unknown provider configuration.
- Corrected a DRF Spectacular `action` attribute collision discovered by OpenAPI validation.

### Product and Accessibility

- Explained current plan, lifecycle date, and active capabilities before financial history.
- Kept checkout visibly unavailable rather than inventing a provider, paid price, or currency.
- Added inline cancellation confirmation, skeleton/empty/error/retry states, semantic history,
  logical RTL layout, reduced motion, touch sizing, and mobile/tablet responsiveness.
- Preserved existing feature access until an owner-approved entitlement matrix exists.

### Validation

- Backend: 144 passed; 85.78% branch-aware coverage; Ruff, strict mypy (331 files), Django check,
  and migration drift passed. OpenAPI generation completed after fixing its crash; inherited
  APIView schema-description debt remains tracked.
- Frontend: 126 passed; 90.39% statements, 80.16% branches, 87.37% functions, 94.32% lines;
  TypeScript, ESLint, and production PWA build passed.
- Browser: 25 passed and 1 intentional desktop skip; Phase 8 desktop/mobile passed Axe, RTL,
  focus/landmarks, cancellation, currency exponent, and overflow checks.

### Boundaries

- No real provider/price/checkout, promotion/coupon, organization/family/institution behavior, AI,
  or Focus internal change.
- No Redis, Celery, WebSocket, broker, microservice, or background worker.
- PostgreSQL concurrency, provider sandbox/edge, and representative load remain evidence gates.

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
