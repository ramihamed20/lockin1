# Lock-in Progress

Last updated: 2026-07-15

## Current Status

Phase 3 — Authentication and design system
State: Implementation and local validation complete; awaiting owner approval

Do not start Phase 4 until the owner explicitly approves it.

## Phase History

### Phase 0 — Repository and Skill Inspection

Status: Approved by owner.

- Existing pages, features, data, dependencies, responsive behavior, and risks audited.
- Relevant Skills selected and documented.
- Old project kept read-only.

### Phase 1 — Product Specification and Acceptance Criteria

Status: Approved by owner.

- Product register, roles, permissions, feature specifications, acceptance criteria, assumptions,
  architecture direction, and phase plan documented.

### Phase 2 — Project Foundation

Status: Approved by owner.

Completed:

- separate runnable React/TypeScript/Vite/PWA and Django/DRF project foundation;
- PostgreSQL 18.4 as default local/test/CI database;
- environment-separated settings and safe example configuration;
- custom UUID/email User model and initial migrations;
- versioned API, OpenAPI, JSON logs, request IDs, liveness, and readiness;
- exact direct dependency pins and npm lockfile;
- Docker development workflow and PostgreSQL CI job;
- Focus first-class backend domain and frontend subsystem contracts;
- explicit internal after-commit domain events;
- AI-free extension architecture;
- continuous documentation and owner operations guide;
- security, accessibility, responsive, PWA, unit, type, build, and browser checks.

### Phase 3 — Authentication and Design System

Status: Complete; awaiting owner approval.

Completed:

- secure session/CSRF registration, verification, login, reset, email, password, and session flows;
- additive backend-enforced roles with final-administrator protection;
- database-backed throttling and append-oriented account security records;
- English/Arabic catalogs, real document RTL, responsive navigation, and route states;
- three-layer design tokens, accessible components, branded PWA icons, and design rationale;
- truthful role-aware account dashboards with no invented study data;
- implemented account domain events after commit while retaining the lightweight internal bus;
- preserved independent Focus and AI-free boundaries.

## Phase 3 Validation

- Backend Ruff, strict mypy, Django check, and migration drift: passed.
- Backend suite: 36 passed; 88.93% coverage.
- Frontend ESLint and TypeScript: passed.
- Frontend suite: 30 passed; 91.75% statements and 83.39% branch coverage.
- Production PWA build: passed; 12 static precache entries; main JS 85.22 KB gzip.
- Playwright: 5 passed and 1 intentional device-specific skip across desktop and Pixel 7.
- Axe: no violations in authenticated and Arabic mobile scenarios.
- Visual and overflow QA: passed for desktop login/dashboard and phone EN/AR registration.

## Workstation Limitation

PostgreSQL-backed CI is configured but not executed on this workstation because Docker,
PostgreSQL, and `psql` are not installed. SQLite was used only through the explicit fast-test flag.

## Next Gate

Owner reviews Phase 3. If approved, Phase 4 may begin only under its approved education/content
scope. Until then, stop.
