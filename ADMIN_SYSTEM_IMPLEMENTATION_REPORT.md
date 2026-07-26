# Admin System Implementation Report

## Delivered administration capabilities

- Purchases: paginated search/filtering, detailed payment/provider/invoice/refund history, internal notes, provider-backed refund requests, and a dual-control payment-status reconciliation workflow. A requester cannot approve their own correction; all requests require a provider reference, reason, idempotency key, and audit entry.
- Subscriptions and entitlements: paginated subscriptions (including users without one), lifecycle actions, plan changes, expiry changes, immutable administrative events, entitlement inspection, and manual time-bounded access grants/revocations. Focus access is determined only by the entitlement engine and its returned reason.
- Plans: versioned plan and price creation APIs, entitlement rules, publication, retirement, and restoration. Existing replacement UI lists the real plan catalogue; lifecycle and creation endpoints are available for the next UI increment.
- Users and access: paginated account lookup, profile/session/learning/subscription/activity history, suspend/reactivate/deactivate, verify/unverify, force logout, password-reset trigger, product-role management, operational-role bundles, and exceptional direct capability grants. The final effective platform administrator is protected under concurrent mutations.
- Role bundles: Super Admin (`platform_administrator`), Content Admin (`content_manager`), Finance Admin (`finance`), Support, Moderator, and Analytics Viewer. Product roles remain separate from operational capabilities. Direct `content.manage` and `assessments.manage` grants are enforced independently.
- Content administration: the existing visual Creator Studio is also available to authorized Content Admins. Django authorizes content, hierarchy, files, questions, and quizzes by the relevant operational capability; a direct content grant cannot access assessment routes, and vice versa.
- Moderation: operational moderation view/manage capabilities, queue access, revision-safe state transitions, and global audit records.
- Notifications: real audience selection (one user, selected users, all active users, subscribers, trials, expired accounts, creators, or plan users), in-app delivery, optional configured-email delivery, schedule persistence, delivery/failure rows, recipient limit, and a dispatch command.
- Analytics: database aggregation endpoint for account, subscription, revenue, learning, Focus, assessment, and creator measures. No browser-calculated authoritative metric is used.
- Reporting and exports: permission-filtered report catalogue, strict server filters, expiring confirmation previews, audited CSV/XLSX downloads, formula-injection protection, row limits, and reports for users, payments, subscriptions, Focus, assessments, moderation, analytics, and audit records.
- Platform controls: typed/versioned non-secret configuration updates, maintenance mode enforcement, registration toggle, configuration audit history, redacted health data, audit-log access, and safe error envelopes.
- Audit: immutable records now retain actor, action, target, before/after state, reason, correlation ID, and the request IP when available. Secret-like fields are redacted before storage.

## Backend additions

### Apps, data, and migrations

- `apps.admin_control`: internal notes, immutable subscription events, notification campaigns/deliveries, payment correction requests, selectors, serializers, services, views, URLs, tests, and scheduled campaign command.
- `apps.administration`: direct operational capability assignments and updated role display names.
- `apps.audit`: request IP address field and request context integration.
- `apps.reporting`: XLSX output format and expanded operational report catalogue.
- Migrations: `administration.0003`, `administration.0004`, `audit.0002`, `reporting.0002`, `admin_control.0001`, and `admin_control.0002`.

### Principal API surfaces

- `/api/v1/operations/admin/purchases`, `/purchases/<id>`, `/refunds`, and controlled `/corrections` + review.
- `/api/v1/operations/admin/subscriptions`, `/subscriptions/<id>/actions`, and `/plans`.
- `/api/v1/operations/admin/users/<id>`, `/actions`, `/capabilities`, `/entitlements`, and `/roles`.
- `/api/v1/operations/admin/analytics/dashboard`, notifications campaigns, audit, configuration, reports, and system health.
- Existing management routes under `/api/v1/management/*` now recognize the appropriate operational content/assessment capability in addition to product creator/admin roles.

## Frontend integration

- `frontend/src/pages/OperationsAdmin.jsx` implements the operational console against Django only, using existing cards, forms, panels, dialogs, responsive rules, light/dark theme tokens, loading states, empty states, error panels, and confirmation dialogs.
- `frontend/src/api/adminControl.js` uses the same-origin session/CSRF client; it validates identifiers and configuration keys, preserves Django validation envelopes, and uses idempotency only for server-supported financial/subscription/reconciliation mutations.
- Existing Creator Studio navigation and protected routes now recognize Content Admin / Assessment Admin capabilities without granting unrelated routes.
- The service worker precaches only build assets and removes the legacy private API cache; it has no API runtime caching rule.

## Security and integrity decisions

- Django session authentication and CSRF are retained; no JWT, secret, or browser-side authority was introduced.
- Sensitive financial reconciliation uses two different authorized administrators and payment transition validation.
- Subscription, entitlement, role, account, notification, configuration, refund, report, moderation, and administrative payment changes are audited.
- Server logic remains authoritative for scores, attempts, XP, subscriptions, Focus access, purchases, and entitlements.
- Exports are permission checked at preview and execution time, bounded, confirmation-token protected, and CSV/XLSX formula safe.

## Commands and checks run

```powershell
cd backend
$env:DJANGO_SETTINGS_MODULE='config.settings.demo'
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
$env:LOCKIN_TEST_USE_SQLITE='1'
.\.venv\Scripts\python.exe -m pytest -q --no-cov

cd ..\frontend
$runtimeNode = 'C:\Users\ramih\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $runtimeNode .\node_modules\eslint\bin\eslint.js --max-warnings 0
& $runtimeNode .\node_modules\typescript\bin\tsc --project tsconfig.phase0.json --pretty false
& $runtimeNode --test tests\*.test.js
& $runtimeNode .\node_modules\vite\bin\vite.js build
```

Results: Django checks and migration check passed; the backend test suite passed; the focused admin suite passed `8/8`; frontend lint/typecheck passed; frontend tests passed `35/35`; production build passed. The running frontend and backend both answered HTTP 200 at `127.0.0.1:5050` and `127.0.0.1:8000/api/v1/health/live`.

## Required operational setup

- Apply migrations in the target environment.
- Run `python manage.py dispatch_due_notification_campaigns` on a scheduler for scheduled campaigns. Campaigns above the configured synchronous recipient limit are deliberately rejected until a background-job integration is configured.
- Configure an email backend before selecting email delivery; otherwise delivery is tracked as unavailable rather than simulated.

## Known limitations

- This project has no cache service or background-job framework configured. System health reports only real available application/database/analytics/provider signals and does not invent cache or worker health.
- The data model uses education subjects/nodes rather than a separate Course model, so analytics expose actual material/node usage rather than fabricating courses.
- The current visual console exposes real plan listing while the secured plan-version creation/lifecycle API is available; a dedicated plan editor is still a UI follow-up.
- Existing content models use protected historical references. Permanent deletion is intentionally not exposed where it would invalidate retained learning, assessment, payment, or audit history; archival/retirement is the supported controlled workflow.

