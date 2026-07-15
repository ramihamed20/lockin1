# Lock-in Architecture

Status: Approved direction; implementation begins only after Phase 2 approval  
Last updated: 2026-07-15

## Goals

The architecture must support a production-quality university learning platform while remaining understandable and maintainable for a small team and a non-technical owner.

Primary constraints:

- React, TypeScript, Vite, and PWA frontend.
- Django and Django REST Framework backend.
- PostgreSQL for primary development and production.
- Stable API suitable for a future native mobile application.
- Initial target of 5,000 registered students and measured testing toward 2,000 active users.
- Mobile-first and tablet-friendly.
- No Redis, Celery, WebSockets, microservices, or equivalent infrastructure without a defined need, evidence, explanation, and owner approval.
- The old project remains untouched and is not imported as an application dependency.

## Architectural Style

Lock-in will begin as a modular monolith:

- one Django deployment containing separated domain applications;
- one PostgreSQL database with clear ownership and constraints;
- one React frontend consuming a versioned REST API;
- one file-storage abstraction with local and S3-compatible implementations;
- one deployment boundary unless measurement later proves a reason to split it.

This style keeps transactions and permissions understandable, avoids network complexity between internal modules, and is sufficient for the stated scale when database queries, workers, caching, and file delivery are configured correctly.

## System Context

Browser/PWA and a future native app use the same versioned API. The React application calls the Django/DRF modular monolith over HTTPS. Django owns authorization and business rules, stores relational state in PostgreSQL, and reaches files only through a storage abstraction backed by local development files or S3-compatible production storage.

## Proposed Project Layout

    Dentify-Rebuild/
    ├── backend/
    │   ├── config/
    │   ├── apps/
    │   │   ├── accounts/
    │   │   ├── education/
    │   │   ├── content/
    │   │   ├── files/
    │   │   ├── questions/
    │   │   ├── quizzes/
    │   │   ├── progress/
    │   │   ├── community/
    │   │   ├── moderation/
    │   │   ├── rankings/
    │   │   ├── notifications/
    │   │   ├── subscriptions/
    │   │   ├── analytics/
    │   │   └── audit/
    │   └── tests/
    ├── frontend/
    │   ├── src/
    │   │   ├── app/
    │   │   ├── api/
    │   │   ├── components/
    │   │   ├── design-system/
    │   │   ├── features/
    │   │   ├── i18n/
    │   │   ├── pwa/
    │   │   └── test/
    │   └── e2e/
    ├── docs/
    ├── load-tests/
    ├── infra/
    ├── compose.yaml
    └── README.md

The exact scaffold and names will be confirmed during Phase 2. Empty domains should not be generated merely to make the tree look complete.

## Backend Domain Boundaries

| Domain | Responsibility |
|---|---|
| Accounts | User model, profiles, sessions, verification, password reset, account status |
| Education | Institution hierarchy, academic placement, ordering and discovery structure |
| Content | Content records, lifecycle, ownership, publication, lesson associations |
| Files | Storage metadata, upload validation, access decisions, download/view delivery |
| Questions | Versioned question bank and authoring validation |
| Quizzes | Quiz definitions, attempt state, timing, autosave, submission, grading |
| Progress | Resume state, completion, review, study activity |
| Community | Public and creator-space discussions |
| Moderation | Reports, assignments, moderation actions and correction workflows |
| Rankings | Metric definitions, snapshots, achievements and earned records |
| Notifications | In-platform notifications and preferences; future channel contract |
| Subscriptions | Trial, access state, overrides, provider interface |
| Analytics | Product aggregates and administrator-facing metrics |
| Audit | Append-oriented privileged-action evidence |

Domain modules may call explicit application services in another domain. They must not reach into another module’s internals or duplicate the same business rule.

## Frontend Structure

The frontend will use:

- feature modules for user workflows rather than folders organized only by file type;
- a small reusable design system for tokens, components, states, and layout primitives;
- one typed API client with a fixed same-origin/versioned base path;
- generated or hand-maintained API types that are checked against backend schemas;
- application-level routing, authentication state, locale, and error boundaries;
- route-level code splitting;
- English and Arabic translation catalogs;
- server state kept separate from short-lived local UI state.

Auth/session identifiers will not be stored in localStorage or sessionStorage. Client storage is allowed only for non-secret preferences and carefully scoped recovery state that is validated as untrusted and cleared at account boundaries.

## Authentication and Authorization

Initial web authentication direction:

- Django server-managed sessions.
- HttpOnly session cookie.
- CSRF token required on cookie-authenticated state changes.
- Same-origin deployment preferred to reduce CORS and cookie complexity.
- Production Secure cookie behavior enabled only under HTTPS.
- Email verification and time-limited single-use reset flows.

Authorization:

- Django permissions/groups for global capabilities.
- Explicit domain policy functions/services for object-level checks.
- Student as baseline; moderator and creator as additive roles.
- Account state and subscription access are separate policy inputs.
- Frontend gating improves UX but never grants authority.
- Direct API permission tests are required for every privileged operation.

Future mobile authentication will reuse the domain and API boundaries but may require a separate short-lived token flow. It will not weaken the web session model preemptively.

## API Contract

- Base path: /api/v1/.
- JSON for normal application resources.
- Consistent pagination, filtering, sorting, search, and error envelopes.
- Stable machine-readable error code plus localized client message mapping.
- OpenAPI schema generated from the implementation.
- UUID-style non-guessable public identifiers for exposed resources where appropriate.
- Idempotency keys for start/submit/payment-event or other duplicate-sensitive operations.
- Explicit timezone-aware ISO timestamps.
- No answer keys or unauthorized existence hints in student responses.

API version 2 is introduced only for incompatible contract changes; normal additive fields remain backward compatible.

## PostgreSQL and Data Integrity

- PostgreSQL is used in local reproducible development and production to reduce environment drift.
- Foreign keys, unique constraints, check constraints, and indexes enforce invariants close to the data.
- Timezone-aware timestamps and audit fields are standard.
- Unbounded collections require pagination.
- Query plans and query counts are reviewed for high-traffic endpoints.
- Select-related/prefetch-related or equivalent optimized loading prevents N+1 behavior.
- Historical quiz attempts refer to immutable/versioned snapshots.
- Final quiz submission uses a database transaction and uniqueness/idempotency constraints.
- Soft deletion is used only when conversation history, audit, or historical attempts require it.

Database connections are bounded through production server/connection configuration. Two thousand active users do not imply two thousand direct database connections.

## File and Object Storage

Large files are not stored in PostgreSQL.

The storage contract separates:

- application metadata and permission in PostgreSQL;
- file bytes in local development or S3-compatible production storage;
- upload validation and processing status;
- mediated or short-lived authorized delivery;
- checksums and safe generated object names.

Files are considered untrusted. The design includes size/type validation, storage outside executable/static code paths, quarantine/scanning integration status, and explicit view/download rules.

## PWA and Offline Safety

The service worker will:

- precache versioned application assets within a measured size budget;
- provide a safe offline fallback;
- avoid shared long-lived caching of private API responses, authenticated HTML, answer keys, and submissions;
- remove obsolete caches during controlled activation;
- avoid forcing an update during an active quiz.

Quiz recovery is an application-level attempt feature, not a generic service-worker cache replay. The UI distinguishes server-acknowledged answers from offline pending changes.

## Background Work Policy

No queue or new service is planned in Phase 2.

Work will initially use:

- normal request transactions for short bounded actions;
- database records for durable work/state where appropriate;
- explicit management commands for operator-triggered or scheduled batch calculations;
- the hosting scheduler/cron only when a later implemented feature needs periodic execution.

Before adding a queue such as Celery/Redis, the proposal must identify:

1. the implemented feature that cannot safely complete in request or scheduled-command form;
2. required retry/delivery guarantees;
3. measured latency or throughput evidence;
4. deployment, monitoring, and owner-maintenance cost;
5. the simpler alternatives considered.

## Performance and Scaling Direction

- Keep Django stateless apart from database/session state so multiple application workers/instances can be added.
- Serve large files directly through object storage or a managed proxy path rather than Django workers.
- Use pagination and indexed queries.
- Store ranking snapshots/aggregates instead of calculating a global leaderboard per request.
- Avoid loading full quiz banks when only one attempt snapshot is needed.
- Use route-level frontend splitting and keep the initial authenticated bundle within the product budget.
- Add caching only for measured repeated work with defined invalidation.
- Validate capacity with realistic Locust or k6 scenarios in Phase 11.

## Accessibility and Design Architecture

- Product register: product.
- WCAG 2.2 AA target.
- Dark theme is the identity default, not an excuse for low contrast.
- Design tokens use semantic roles; implementation color format will be selected in Phase 3.
- Components expose default, hover, focus, active, disabled, loading, error, and success states where relevant.
- Motion normally lasts 150–250 ms, communicates state, and has reduced-motion behavior.
- Responsive behavior changes structure rather than merely shrinking desktop layouts.
- Arabic changes document direction and component flow, while educational content keeps its own language direction where needed.

The visual system will be documented in a future DESIGN.md during Phase 3 after the design tokens and component foundations exist. No speculative DESIGN.md is created in Phase 1.

## Testing Architecture

Planned layers:

- Django unit tests for domain rules and validation.
- API tests for contracts, permissions, transactions, and errors.
- PostgreSQL integration tests for constraints, concurrency, and query behavior.
- React unit/component tests for state and accessible behavior.
- Playwright E2E for critical user and role workflows.
- Load tests for realistic high-traffic scenarios.
- Deployment/security checks, dependency audits, and backup restore tests.

Phase 2 must establish runnable test commands and a minimal test at each foundation layer before feature work.

## Observability and Reliability

Phase 2 foundation will provide:

- structured application logs with sensitive-data redaction;
- health and readiness endpoints;
- safe error responses with correlation identifiers;
- environment-separated settings;
- migration and startup checks.

Later production planning adds the selected error monitoring, metrics, backups, restore procedure, and alerts. Tool/provider selection is deferred until deployment options are compared.

## Security Baseline

The rebuild follows Django and React secure defaults:

- no secrets in frontend bundles or repository files;
- DEBUG is false, hosts are strict, and deploy checks run in production;
- CSRF middleware and an explicit cookie strategy;
- ORM-first database access and parameterized raw SQL only when unavoidable;
- no arbitrary HTML rendering;
- strict upload and path handling;
- security headers/CSP at application or edge;
- safe redirects and fixed/allowlisted API destinations;
- audit and rate limits around high-risk actions;
- no frontend-only authorization.

## Phase 2 Boundary

Phase 2 may create the runnable foundation, database configuration, environment templates, test/lint/typecheck setup, container/development commands, health endpoints, CI baseline, and documentation.

Phase 2 must not implement the full authentication, education, quiz, community, ranking, subscription, or management features. Those remain in their approved phases.

## Phase 2 Realized Architecture

The confirmed repository structure is:

```text
Lock-in/
├── backend/
│   ├── apps/accounts/
│   ├── apps/focus/
│   ├── config/settings/
│   └── platform_core/{api,events,logging}/
├── frontend/
│   ├── src/{api,app,pwa}/
│   └── src/features/focus/
├── docs/
├── scripts/
├── .github/workflows/ci.yml
└── compose.yaml
```

Only Accounts and Focus exist as Django domains in Phase 2. Empty future apps were not generated.
`platform_core` contains domain-neutral transport, event, and observability primitives; it is not a
miscellaneous business-logic folder.

### Focus as a first-class bounded domain

Focus owns sessions, ordered session history, completion summaries, and its started/completed
events. Quiz and Study integrations use a typed context reference and application-service
validation rather than Focus importing future domain internals. Annotation persistence waits for
real Document and DocumentVersion foreign keys. The frontend Focus module publishes independent
ports for renderer, annotation repository, workspace recovery, gestures, keyboard commands,
sessions, and tool registration. See `FOCUS_MODE.md`.

### Internal event flow

Domain services commit authoritative PostgreSQL state, then publish immutable typed events through
`transaction.on_commit`. The in-process bus is synchronous and not durable. A transactional outbox
or queue requires a later approved subscriber with explicit delivery/retry needs. See `EVENTS.md`.

### AI-free extension boundary

No AI domain or dependency exists. Future intelligence reads permission-filtered selectors and
subscribes to domain events through provider-independent ports. It cannot write authoritative
grades, progress, Focus history, subscriptions, or moderation decisions. See
`AI_EXTENSION_POINTS.md`.

### PWA boundary

The generated worker precaches only versioned static shell assets. It has no runtime cache for API
responses and denies `/api/` from navigation fallback. Updates are prompted and can be deferred by
future active-quiz/Focus guards.

### Database and test boundary

PostgreSQL 18.4 is the default in local, test, Compose, and CI settings. SQLite exists only behind
the explicit `LOCKIN_TEST_USE_SQLITE=true` workstation fast-test switch. It is not a supported
production or normal development database and does not replace PostgreSQL integration evidence.

### Security and observability

Production settings fail closed on secret, database password, and explicit hosts. Secure cookies
and SSL redirect are production defaults; proxy-header trust is opt-in. Session auth and CSRF
remain enabled. A validated UUID request ID flows through JSON logs and response headers. Liveness
does not touch the database; readiness runs `SELECT 1` and returns no database detail on failure.
