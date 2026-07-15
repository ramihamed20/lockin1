# Lock-in Changelog

All notable rebuild changes are documented here.

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
