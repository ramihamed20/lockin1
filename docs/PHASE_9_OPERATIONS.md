# Phase 9 — Operations Platform

Last updated: 2026-07-18

## Outcome

Phase 9 establishes Lock-in's operational backbone without turning Django Admin into the daily
product and without adding asynchronous infrastructure. Administration, analytics, audit,
reporting, operational actions, and system configuration are independent backend domains. A
dedicated, role-aware `/operations` frontend provides task-specific overview, content, support,
user, audit, report, and configuration workspaces.

Django Admin remains an internal maintenance surface. Business mutations continue through domain
services and auditable APIs.

## Domain ownership

| Domain | Owns | Does not own |
|---|---|---|
| `administration` | Operational capabilities, roles, assignments, session/resource discovery, dashboards, user directory | Product roles, account state transitions, financial state |
| `analytics` | Durable event facts, UTC daily metrics, distinct active learners, projection rebuilds | Source-domain records, BI vendor integration |
| `audit` | Append-only redacted administrative evidence | Domain business state or editable notes |
| `reporting` | Report catalog, bounded previews, expiring confirmations, CSV generation evidence | Scheduling, email delivery, unbounded extracts |
| `operational_actions` | Preview/confirm/idempotency/result summaries for approved actions | Direct account-table mutation or speculative bulk actions |
| `system_configuration` | Typed allowlisted values, validation, optimistic versions, change audit | Secrets or arbitrary settings |
| `operations_integrations` | Stateless event subscriptions into analytics facts | Business state |
| `platform_core.observability` | Provider-neutral metric/error contracts, normalized request telemetry, safe health projection | A monitoring vendor or external collector |

## Operational authorization

Operational access is capability-based and separate from student/creator/moderator product roles.
Seeded roles are Platform Administrator, Support, Content Manager, Moderator, Finance, and
Analytics Viewer. APIs check the smallest required capability. Existing active product
administrators retain all operational capabilities as a backward-compatible bootstrap path.

Role assignments require an explicit reason and generate audit evidence. Before a role removal or
account suspension can affect this invariant, the service locks the effective administrator user
rows in stable identifier order and then prevents removing or suspending the final effective
platform administrator. Clients receive only their server-authorized roles, capabilities,
dashboards, and resource links.

## Event-driven analytics

`operations_integrations` consumes committed account, lesson, Focus, assessment, community,
subscription, and payment events. Each `(event_id, metric)` becomes at most one durable
`AnalyticsFact`. UTC `DailyMetric` and `DailyActiveLearner` projections serve dashboards without
expensive history scans.

Current metrics include registrations, active learners, lesson completion, Focus sessions/minutes,
quiz completion, mastery, contextual community contributions, subscription starts, successful
payments, and gross server-confirmed revenue. Finance metrics remain hidden without finance
capability.

`python manage.py rebuild_operational_analytics --from YYYY-MM-DD --to YYYY-MM-DD` rebuilds daily
projections from durable facts. The range is bounded to 367 days. It does not invent facts or
replace source-domain authority.

## Audit integrity

Every implemented administrative mutation records actor, action, domain, target, reason, source,
correlation identifier, previous/new redacted state, related entities, and timestamp. Secret-like
keys are recursively redacted. Application model/queryset update and delete paths reject mutation,
so audit rows are append-only through supported code paths. Production database permissions should
also deny update/delete to the application role before launch.

## Safe actions, reports, and configuration

- The only Phase 9 operational action is `users.set_status`; no speculative action catalog was
  added. Preview and execution use an expiring confirmation token, idempotency, bounded targets,
  partial-result summaries, account-domain services, self-suspension protection, last-admin
  protection, and session termination on suspension.
- Reports expose a small catalog, validate filters, cap rows, preview estimated/truncated output,
  require an expiring confirmation, reject unknown filters, and generate CSV with formula-injection
  protection and immutable row/hash evidence. Synchronous generation is deliberately bounded;
  scheduling requires later
  approved infrastructure.
- Configuration accepts only seeded typed definitions. Integer ranges and optimistic versions are
  enforced, every change requires a reason, and keys beginning with `secret.` are rejected. Secrets
  stay in deployment secret storage.

## Observability

Request middleware records normalized route, method, status, and duration, logs slow requests as
structured data, and sends redacted error context to a provider-neutral protocol. Default metric
and error providers are honest no-ops with `not_configured` health state. The authorized system
health API reports application/database/projection/provider status without hosts, credentials,
stack traces, or infrastructure identifiers.

`OBSERVABILITY_SLOW_REQUEST_MS` controls the slow-request threshold. A future metrics or error
provider implements the protocol; existing domains do not import a vendor SDK.

## Dedicated operations experience

The operations UI is intentionally not one giant dashboard or a grid of generic cards:

| Redesign | Usability reason |
|---|---|
| One admin dashboard → overview/content/support workspaces | Keeps each role focused on its current operational question |
| Wide management tables → mobile list/detail workspace | Preserves readable actions and state on phones/tablets without horizontal table dependence |
| Immediate dangerous button → inline preview and explicit confirmation | Makes target, consequence, and reason reviewable before mutation |
| Live source-history queries → period/freshness projections | Makes analytics fast and honest about recency |
| Provider-specific health → safe normalized component status | Supports future vendors without exposing infrastructure detail |
| Editable settings blob → typed versioned settings | Prevents secret leakage and stale overwrites |

The shared component tree supports English/Arabic, logical RTL properties, semantic landmarks,
keyboard navigation, visible focus, reduced motion, loading/empty/error/retry states, and narrow
layouts. Browser validation found and fixed a duplicate heading and two unnamed complementary
landmarks before completion.

## API surface

All endpoints are under `/api/v1/operations`:

- `GET /session`, `/resources`, `/system-health`;
- `GET /dashboards/overview`, `/dashboards/content`, `/dashboards/support`;
- `GET /users`; `PUT /users/{id}/roles`;
- `GET /analytics`, `/audit`, `/configuration`, `/reports`;
- `PUT /configuration/{key}`;
- `POST /reports/previews`; `POST /reports/{id}/execute`;
- `POST /actions/previews`; `POST /actions/{id}/execute`.

Responses use existing versioned same-origin session/CSRF and stable error contracts. Paginated
lists remain bounded.

## Validation evidence

- Backend: 157 tests passed; 85.64% branch-aware coverage; Ruff lint/format, strict mypy across 403
  source files, migration drift, and production deployment security checks passed.
- OpenAPI generation completed. No Phase 9 operational view produced a schema warning. Ninety-six
  inherited APIView description/operation-id warnings remain from earlier domains and are tracked;
  this is not represented as a globally clean schema.
- Frontend: 153 tests passed; 90.87% statements, 80.08% branches, 87.48% functions, and 95.16%
  lines; ESLint, TypeScript, lockfile install/audit, and production PWA build passed.
- Browser: 29 Playwright tests passed with one intentional desktop skip for a mobile-only case.
  Phase 9 desktop and Pixel 7 flows passed Axe, RTL, keyboard/landmark, confirmation, and horizontal
  overflow checks. Desktop and RTL mobile screenshots were visually reviewed.

Local backend tests used the explicit SQLite fallback. PostgreSQL concurrency and representative
load were not available on this workstation and are not claimed.

## Preserved boundaries and exclusions

- Focus remains an independent product module; only its completed-session event contributes a
  bounded analytics fact.
- AI remains unimplemented and provider-independent.
- No Redis, Celery, WebSockets, broker, microservice, BI vendor, monitoring vendor, scheduler, or
  background worker was added.
- No arbitrary bulk action, scheduled report, production telemetry provider, or Django Admin
  replacement for unsupported domains was invented.
- PostgreSQL projection/action/report concurrency, representative export/load tests, database-level
  audit immutability, and real provider alerts remain production evidence gates.

## Skills used

- `impeccable`: operations information architecture, responsive/RTL/accessibility review, and
  browser-driven UI correction.
- `design-system`: shared token hierarchy, status patterns, list/detail layout, and consistent
  operational states.
- `security-best-practices`: least privilege, CSRF/session boundaries, audit redaction, safe actions,
  CSV/configuration hardening, provider-neutral error handling, and production checks.
- `playwright`: full desktop/mobile flows, Axe, RTL, overflow, screenshots, and regression suite.

No additional applicable Skill was discovered during Phase 9.
