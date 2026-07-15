# Lock-in Changelog

All notable rebuild changes are documented here.

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

