# Pre-Launch Production Audit

## 1. Executive Summary

| | |
|---|---|
| **Audit date** | 2026-08-30 / 2026-08-31 |
| **Branch** | `codex/phase-11-production-readiness` |
| **Head commit** | `4f05640` — *feat(i18n): translate the community, space, report and ranked surfaces* |
| **Working tree** | Dirty (large uncommitted change set across backend and frontend) |
| **Stack** | Django 5.2.16 / DRF 3.17.1 / PostgreSQL 18 · React 18.3 / Vite 6 / react-router 7 · Docker Compose + nginx edge · vite-plugin-pwa (injectManifest) |
| **Scope** | Full system: repository, build, dependencies, auth, authorization, API, DB, subscriptions, admin, files, Focus Workspace, PWA, mobile/RTL, performance, a11y, privacy, deployment, monitoring, backups |

### Method actually performed

- **Layer 1 (static):** read settings for all 5 environments, all middleware, 197 API routes, permission classes, OAuth, entitlements, file pipeline, migrations (77), CI, Dockerfiles, nginx config, compose.
- **Layer 2 (runtime):** booted the real backend (`config.settings.e2e`, seeded via `seed_demo`) on `127.0.0.1:8010` plus the real Vite frontend on `127.0.0.1:5052`; registered and verified a real account through the API; drove the app in a Chromium browser at desktop (1280×720), mobile (375×812) and tablet (768×1024) viewports in both English and Arabic.
- **Layer 3 (adversarial):** unauthenticated sweeps, cross-role matrix over 60+ endpoints, IDOR attempts on sessions / attempts / notifications / discussions, CSRF removal and forgery, malformed and hostile payloads, path-traversal-style file requests, range-header abuse, rate-limit exhaustion, registration flooding, credential spraying, 8-way concurrent writes.
- **Layer 4 (production readiness):** production settings validation, cookie inventory, header review, backup/DR review, observability review, migration review, dependency audits.

### Major strengths

The engineering quality of the **platform layer** is genuinely high and above what is typical at this stage:

- Authentication and authorization are enforced server-side and held up under every attack attempted. No IDOR, no privilege escalation, no role confusion found across a 60-endpoint role matrix.
- CSRF is enforced on **every** unsafe request including login and registration (`CsrfEnforcedSessionAuthentication`).
- OAuth implementation is textbook: signed one-time state, OIDC nonce, HttpOnly browser-binding cookie, issuer/audience/signature/expiry validation, verified-email requirement, private-relay handling, provider-endpoint allowlist.
- Production settings **fail closed** on ~25 misconfigurations (weak secret, wildcard hosts, non-HTTPS public URL, console mail backend, fake payment provider, missing TLS contract, non-`__Host-` cookies).
- Strict CSP with no `unsafe-inline` for scripts; zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` in the entire frontend.
- Database design is careful: UUID PKs, unique/check constraints, `select_for_update` on every contended write, idempotency keys, append-only audit records, least-privilege runtime DB role verified at preflight.
- Backup/DR **runbook** and restore-verification scripts are well written.
- 280 backend tests, 190 frontend unit tests, 23 Playwright e2e specs, extensive docs (33 documents).

### Major risks

Two issues make the current build unsafe to launch, and both are about **the product not actually delivering what it sells**, not about platform code quality:

1. **No uploaded file can ever be served or published in production.** The production malware-scan gate has no scanner behind it and no operator override.
2. **The Materials → Sheets → Focus Workspace surface — the core of the paid product — is a hard-coded frontend mock** serving one bundled test PDF from a public, unauthenticated URL, with annotations stored only in the browser.

Beyond those, **three of the four required CI gates are red** (backend test suite, frontend typecheck, and the Playwright browser suite at 87 failures of 137), there is **no monitoring, no alerting, and no scheduled backup**, and rate limiting collapses to a single global bucket behind the production reverse proxy.

---

## 2. Launch Verdict

### NO-GO

Two P0 issues and eleven P1 issues remain in the audited state.

The platform *substrate* is close to launch quality. The *product* is not: a student who pays today would receive 22 sheets that are all the same test PDF, a question bank consisting of three demo questions per sheet, a store with real dollar prices that cannot transact, and — the moment an operator uploads real course material — a system that refuses to publish or serve it. Meanwhile the operator would have no metrics, no error reporting, and no scheduled backups.

The release pipeline also cannot currently certify any of this: three of the four required CI jobs fail, and the browser suite that guards the Focus Workspace is reporting nothing usable.

This verdict is about deliverability and operability, not about code quality. Fixing P0-1 is a small, contained change. P0-2 is a product-integration decision, not a rewrite: the secure server-side content pipeline already exists and works (verified end-to-end in this audit) — it simply is not what the Materials route uses.

---

## 3. Launch Scorecard

| Area | Status | P0 | P1 | P2 | Notes |
|---|---|---:|---:|---:|---|
| Build (frontend) | PASS | 0 | 0 | 1 | `vite build` exit 0; 518 kB entry chunk warning |
| Build (typecheck) | **FAIL** | 0 | 1 | 0 | `tsc -p tsconfig.phase0.json` exits 2, 4 errors |
| Lint (frontend) | PASS | 0 | 0 | 0 | `eslint --max-warnings 0` clean |
| Unit tests (frontend) | PASS | 0 | 0 | 0 | 190/190 pass |
| Browser e2e (Playwright) | **FAIL** | 0 | 1 | 0 | 87 failed / 46 passed / 4 skipped — stale fixtures |
| Backend tests | **FAIL** | 0 | 1 | 0 | 1 failed / 280 passed; coverage 84.99% < 85% gate |
| Dependencies | PARTIAL | 0 | 0 | 0 | pnpm audit clean; pip-audit NOT VERIFIED locally |
| Authentication | PASS | 0 | 0 | 1 | Full lifecycle exercised live; OAuth code reviewed only |
| Authorization | PARTIAL | 0 | 1 | 0 | No IDOR/escalation found; entitlement gate bypassable |
| Cookies/Sessions | PASS | 0 | 0 | 2 | `__Host-` + HttpOnly + Secure in prod; 1-year CSRF cookie |
| API | PASS | 0 | 0 | 1 | Strict serializers, correct codes; search unpaginated |
| Database | PASS | 0 | 0 | 1 | 77 migrations, none destructive; no cleanup jobs |
| Subscription/Entitlements | PARTIAL | 0 | 1 | 0 | Server-enforced; plans can ship with no entitlement rules |
| Admin/Creator | PARTIAL | 0 | 1 | 1 | Capability model solid; scheduled campaigns never dispatch |
| Files/PDF | **FAIL** | 1 | 0 | 0 | Production scan gate has no scanner and no override |
| Focus Workspace | **FAIL** | 1 | 1 | 1 | Real rendering/ink engine; wired to a static mock catalog; e2e suite red |
| Mobile (375) | PASS | 0 | 0 | 1 | No overflow; bottom tab bar; install interstitial |
| iPad (768) | PASS | 0 | 0 | 1 | RTL mirrored correctly; untranslated sidebar strings |
| Android | NOT VERIFIED | | | | No physical/emulated Android device available |
| iOS Safari | NOT VERIFIED | | | | WebKit project is opt-in; not run |
| PWA | PARTIAL | 0 | 0 | 1 | Manifest/SW/update flow correct; not tested on real devices |
| Performance | PARTIAL | 0 | 0 | 1 | Bundle budget passes; no throttled measurement taken |
| Accessibility | PARTIAL | 0 | 0 | 1 | Names/labels/focus correct where sampled; not a full sweep |
| Privacy | PARTIAL | 0 | 1 | 3 | Telegram forwarding of payment codes undisclosed |
| Deployment | PASS | 0 | 0 | 0 | `check --deploy` passes; fail-closed prod settings |
| Monitoring | **FAIL** | 0 | 1 | 0 | Metric sink and error reporter are no-ops |
| Backups | **FAIL** | 0 | 1 | 0 | Runbook only; nothing scheduled |
| Rate limiting | **FAIL** | 0 | 2 | 0 | Global bucket behind proxy; spam/spraying unthrottled |

---

## 4. P0 — Launch Blockers

---

### P0-1 · Files · Production can never serve or publish any uploaded file

**Severity:** P0 **Area:** File pipeline / content publishing

**What is wrong.** Production sets `CONTENT_REQUIRE_CLEAN_SCAN = True`. With that flag, `create_managed_file()` stores every new upload with `scan_status = PENDING`. Both the delivery view and the publish validator refuse anything that is not `CLEAN`. **No code path anywhere in the product ever sets `scan_status` to `CLEAN`** — there is no scanner, no webhook, no management command, and no API. `ManagedFileAdmin` additionally lists `scan_status` in `readonly_fields`, so an operator cannot set it from Django admin either.

**Why it matters.** The entire content pipeline is dead on arrival in production: creators can upload a PDF, but it can never be published and can never be downloaded or viewed. `production_preflight` also hard-fails (`CommandError: There are N published files without clean scan evidence`) the moment any published file exists, which blocks the deploy itself. Avatars are affected identically.

**How it was verified.**
1. Exhaustive grep across `backend/apps` and `backend/platform_core` for any assignment of `ScanStatus.CLEAN` — the only non-test writers are the upload default and `seed_demo` (`not_configured`, dev-only).
2. Executed a real upload under production semantics:
```
DJANGO_SETTINGS_MODULE=config.settings.e2e python -c "... override_settings(CONTENT_REQUIRE_CLEAN_SCAN=True) ...
   create_managed_file(owner=creator, upload=<valid PDF>, kind=PDF)"
→ upload scan_status = pending
→ production delivery would 404 : True
→ production publish would fail : True
```
3. Read `ManagedFileAdmin.readonly_fields` — `scan_status` is not editable.

**Reproduction.** Deploy with `config.settings.production` → sign in as a creator → `POST /api/v1/management/files` with a valid PDF → attach it to a learning object → `POST /api/v1/management/content/<id>/submit` → `ContentRuleError: "The primary file is not safe to publish."` → `GET /api/v1/files/<id>/view` → `404`.

**Affected files.**
- [backend/apps/files/services.py:136](backend/apps/files/services.py:136) — sets `PENDING`
- [backend/apps/files/views.py:111](backend/apps/files/views.py:111) — delivery gate
- [backend/apps/content/services.py:191](backend/apps/content/services.py:191) — publish gate
- [backend/apps/files/admin.py:23](backend/apps/files/admin.py:23) — `scan_status` read-only
- [backend/platform_core/management/commands/production_preflight.py:42](backend/platform_core/management/commands/production_preflight.py:42)
- [backend/config/settings/production.py](backend/config/settings/production.py) — `CONTENT_REQUIRE_CLEAN_SCAN = True`

**Recommended fix.** Pick one and make it explicit:
- **(a)** Integrate a real scanner (e.g. ClamAV sidecar) that transitions `PENDING → CLEAN | QUARANTINED`, plus a retry/timeout path. Highest assurance, most work.
- **(b)** Add an *audited* operator action — a capability-gated `POST /api/v1/operations/admin/files/<id>/scan-decision` writing an `AuditRecord` — so a human can attest a file. Small, keeps the control meaningful.
- **(c)** Ship with `CONTENT_REQUIRE_CLEAN_SCAN = False` and remove `lockin.E003` from `production_security_checks`, accepting the risk explicitly given uploads are restricted to creators/admins. Smallest change; weakest control.

**Risk of the fix.** (a) new infrastructure dependency in the request path — do it asynchronously. (b) low; must be capability-gated and audited or it becomes a bypass. (c) documented, accepted risk — the upload path already enforces extension + declared MIME + magic-byte signature validation, and delivery already sends `Content-Disposition` + `X-Content-Type-Options: nosniff`.

**Blocks launch:** **Yes.**

---

### P0-2 · Content / Focus Workspace · The paid study surface is a static mock over a public PDF

**Severity:** P0 **Area:** Product content pipeline / access control

**What is wrong.** The student Materials surface does not use the server content API. `frontend/src/lib/materialCatalog.js` hard-codes 7 subjects × 3–4 sheets, and **every single sheet spreads the same object**:

```js
const ORAL_HISTO_TEST_SHEET = Object.freeze({
  summary: "Test PDF: Oral Histo 2.",
  fileName: "Oral Histo 2.pdf",
  pdfUrl: "/assets/oral-histology-test.pdf",
  pageCount: 16,
  isTestSheet: true
});
```

Consequences, all confirmed at runtime:

1. **All 22 sheets are the same test PDF.** Opening *Conservative → sheet 1* loads an Arabic **oral histology** document.
2. **That PDF is public.** It ships in `frontend/public/assets/` and is served by nginx from `/assets/` with no authentication, no session, and no entitlement check. Anonymous `GET` returns `200`, 827,356 bytes.
3. **Annotations never reach the server.** The catalog workspace persists to browser IndexedDB (`lock-in-workspace`) only. No request to `/api/v1/focus/documents/<id>/annotations` occurs. Clearing site data, switching device/browser, private browsing, or iOS ITP eviction destroys the student's handwritten work.
4. **Global search is partly fictional.** `frontend/src/lib/globalSearch.js` merges `MATERIAL_CATALOG` and `demoQuizCatalog` into results, so search returns entries for mock sheets and demo questions.
5. **The real pipeline exists and works** — it is simply unused by this route. This audit verified `GET /api/v1/learning-objects` → `GET /api/v1/files/<uuid>/view` end-to-end with correct entitlement gating, `Cache-Control: private, no-store`, `nosniff`, byte-range support and a correct `416`.

**Why it matters.** A subscriber pays for course material and receives one placeholder document repeated across every subject, while that document is simultaneously free to anyone with the URL. Any real course PDF placed in `public/assets/` under the same pattern would be published to the open internet. And students' study annotations — the stickiest asset in the product — have no server-side durability.

**How it was verified.**
- Browser network log while opening *Materials → Conservative → sheet 1 → Open Focus Workspace*: `GET /assets/oral-histology-test.pdf → 200`; no `/api/v1/focus/documents/...` and no `/api/v1/files/...` request.
- `curl` without any cookie: `GET /assets/oral-histology-test.pdf` → `200`, `size=827356`.
- Read `materialCatalog.js`, `globalSearch.js`, `workspace/storage/annotationStore.js` (IndexedDB, `WORKSPACE_DB_NAME = "lock-in-workspace"`).
- Confirmed the file is also emitted into `frontend/dist/assets/` by the production build.

**Affected files/routes.**
- [frontend/src/lib/materialCatalog.js](frontend/src/lib/materialCatalog.js)
- [frontend/src/lib/globalSearch.js](frontend/src/lib/globalSearch.js)
- [frontend/src/lib/demoQuizCatalog.js](frontend/src/lib/demoQuizCatalog.js)
- `frontend/public/assets/oral-histology-test.pdf`
- [frontend/src/pages/CatalogFocusWorkspace.jsx](frontend/src/pages/CatalogFocusWorkspace.jsx)
- Routes `/materials/catalog/*`, `/questions/demo/*`

**Recommended fix.**
1. Point `/materials` at `GET /api/v1/learning-objects` and the workspace at `/api/v1/focus/documents/<version_id>` + `/api/v1/files/<uuid>/view`; keep the existing rendering/ink engine unchanged.
2. Delete `oral-histology-test.pdf` from `public/assets/` — never serve study content from the static origin.
3. Move workspace annotations onto the existing server sync (`FocusAnnotationsView` with `expected_collection_revision` + `idempotency_key` is already implemented and conflict-safe), keeping IndexedDB as the offline cache.
4. If the mock catalog must ship for a soft launch, label it unmistakably in the UI and remove it from search.

**Risk of the fix.** Moderate and contained — the workspace already has a server document/annotation contract with tests; the change is at the data-source boundary, not in the rendering engine. Sequence it behind P0-1, because server-backed sheets cannot render until file delivery works.

**Blocks launch:** **Yes.**

---

## 5. P1 — Must Fix Before Launch

### P1-1 · Abuse · Rate limiting collapses to one global bucket behind the production proxy

Every limiter keys on `request.META["REMOTE_ADDR"]`. Django has no `X-Forwarded-For` handling anywhere in the stack (grep across all middleware and settings), and gunicorn's `forwarded_allow_ips` only affects `wsgi.url_scheme`, never `REMOTE_ADDR`. Behind the nginx edge in `compose.production.yaml`, `REMOTE_ADDR` is the edge container's address for **every** request.

The worst case is `oauth_start`, whose fingerprint is `sha256("oauth_start|<provider>|<REMOTE_ADDR>|SECRET_KEY")` — no user or session component. With `ACCOUNT_SENSITIVE_REQUEST_LIMIT = 5` per `900s`, production allows **5 Google sign-in starts per 15 minutes for the entire platform**.

**Verified:** six sequential `POST /api/v1/auth/oauth/google/start` from one client → attempts 1–5 returned `503` (provider unconfigured, i.e. they passed the limiter), attempt 6 and 7 returned `429`. A subsequent click from a *different* client (the browser) was silently blocked by the same bucket.

**Files:** [backend/apps/accounts/views.py:137](backend/apps/accounts/views.py:137), [backend/apps/accounts/views.py:295](backend/apps/accounts/views.py:295), [backend/apps/accounts/services.py](backend/apps/accounts/services.py) (`auth_attempt_fingerprint`), [backend/apps/payments/views.py:95](backend/apps/payments/views.py:95), [frontend/nginx/default.conf](frontend/nginx/default.conf).

**Fix:** add a trusted-proxy client-IP resolver (rightmost-untrusted hop from `X-Forwarded-For`, with the edge as the only trusted proxy) and use it for every limiter; add a per-session/per-user component to `oauth_start`. **Risk:** must not trust a client-supplied header — derive from the known edge only. **Blocks launch: Yes** if Google sign-in is offered at launch; P1 regardless.

---

### P1-2 · Abuse · Registration flooding and credential spraying are unthrottled

Registration is throttled per `(email, IP)` and login per `(email, IP)` only. With one client and one IP:

- **8 consecutive registrations with 8 distinct emails → all `201`.** Each sends a verification email. Unbounded account creation and outbound mail from a single source (deliverability/reputation risk, unbounded `User`/`OneTimeToken` growth).
- **8 consecutive logins against 8 distinct victim emails → all `403`, no `429`.** Per-account lockout (5 attempts) is intact, so targeted brute force is blocked, but password spraying across many accounts is completely unthrottled.

**Files:** [backend/apps/accounts/views.py](backend/apps/accounts/views.py) (`RegisterView`, `LoginView`).
**Fix:** add per-client-IP counters (after P1-1) for registration and login in addition to the per-identity ones; consider a proof-of-work/CAPTCHA on registration. **Risk:** tune limits so a shared university NAT does not lock out a lecture hall — scope by IP + coarse user-agent, and prefer soft failure. **Blocks launch: Yes (P1).**

---

### P1-3 · Release gate · Backend test suite is red

```
LOCKIN_TEST_USE_SQLITE=1 python -m pytest -q
→ 1 failed, 280 passed, 2 skipped in 239.53s
→ FAILED platform_core/tests/test_performance.py::test_search_query_cost_does_not_grow_with_result_count
→ FAIL Required test coverage of 85% not reached. Total coverage: 84.99%
```

The failure is **not** an SQLite artifact. `SearchView` now returns `count = len(results)` where results are capped at `min(limit, 24)` (default 12) with `next`/`previous` hard-coded to `None`, while the test still asserts `count == 100` and `len(results) == 25`. The view was changed without updating the test:

```
assert response.json()["count"] == 100
E   assert 12 == 100
```

CI runs the identical assertion on PostgreSQL, so the `backend` job — and therefore the `quality-gate` job that requires all four jobs to succeed — fails on this branch.

**Files:** [backend/platform_core/tests/test_performance.py:56](backend/platform_core/tests/test_performance.py:56), [backend/apps/discovery/views.py](backend/apps/discovery/views.py).
**Fix:** decide the intended `/search` contract (see P2-7), then update the test to it and lift coverage by 0.01pt. **Risk:** none. **Blocks launch: Yes (P1)** — a red gate means nothing else in the pipeline is trustworthy.

---

### P1-4 · Release gate · Frontend typecheck is red

```
npx tsc --project tsconfig.phase0.json --pretty false   → exit 2
src/api/learning.js(65,119): TS2339: Property 'signal' does not exist on type '{ query?…; pageSize?: number; }'.
src/components/search/GlobalSearch.jsx(117,47): TS2353: 'signal' does not exist in type '{ query?…; pageSize?: number; }'.
src/components/search/GlobalSearch.jsx(271,16): TS2353: '"--global-search-left"' does not exist in type 'Properties<…>'.
src/components/shared/UserAvatar.jsx(37,7): TS2322: Type 'string' is not assignable to type '"lazy" | "eager"'.
```
(`tsconfig.worker.json` passes, exit 0.)

`pnpm run typecheck` runs both projects, so the `frontend` CI job fails.

**Fix:** add `signal` to the `discoveryApi.search` JSDoc typedef, type the CSS custom property (`/** @type {React.CSSProperties} */`), and constrain the `loading` prop union. **Risk:** none — JSDoc/type annotations only. **Blocks launch: Yes (P1).**

---

### P1-5 · Backups · Nothing schedules a backup

`docs/BACKUP_RECOVERY.md` is a good runbook and `scripts/production/backup-postgres.sh` + `verify-postgres-restore.sh` are correct. But nothing runs them: `compose.production.yaml` has no backup service, `deploy/` has no cron/timer, CI has no scheduled job, and no `crontab`/systemd unit exists in the repo. Grep for `backup` across compose, `deploy/`, and `.github/` returns nothing.

**Answering the runbook's own question — *"If the production database disappears today, what can be recovered and how?"* — the answer at launch is: nothing, unless a human happened to run the script manually.** The doc also concedes restore has objectives that "must be measured in staging"; no drill record exists.

**Fix:** add a scheduled backup unit (compose sidecar with a cron loop, or host-level systemd timer) writing to off-host encrypted storage with retention, plus a monthly automated restore-verification run; record one drill before launch. **Risk:** low; ensure the dump does not contend with peak load and that `pg_dump` runs as the owner role. **Blocks launch: Yes (P1)** — unrecoverable-data risk is explicitly non-waivable.

---

### P1-6 · Monitoring · No metrics, no error reporting, no alerting

`platform_core/observability/providers.py` installs `NoOpMetricSink` and `NoOpErrorReporter` at import time. `set_metric_sink` / `set_error_reporter` are called **only from tests** (`platform_core/tests/test_observability.py`). The middleware faithfully calls `increment` / `observe` / `capture_exception` — into no-ops.

The frontend has no error reporting at all: `ErrorBoundary.componentDidCatch` calls `this.props.onError?.(...)`, and `App.jsx` renders `<ErrorBoundary>` **without an `onError` prop**. No `window.onerror`, no `unhandledrejection` handler, no reporting client anywhere in `frontend/src`.

What survives is JSON request logs on stdout (with request IDs — good) and two health endpoints.

Against the required operator questions:

| Question | Answerable? |
|---|---|
| What failed? | Partially — from stdout logs, if retained |
| Which endpoint failed? | Yes — `route` is logged |
| When did it start? | Yes, if logs are shipped and searchable |
| How many users are affected? | **No** — no metrics, no aggregation |
| Is the service still healthy? | Only by polling `/api/v1/health/ready` yourself |
| Did the frontend crash for users? | **No** — zero visibility |

**Fix:** wire a real `MetricSink` and `ErrorReporter` in an app-ready hook (Sentry/OTel or equivalent), pass an `onError` into `ErrorBoundary` that reports, add `unhandledrejection`, and configure log shipping + an uptime check with a paging destination. **Risk:** low; scrub PII in the error context (the seams already accept a redacted context dict). **Blocks launch: Yes (P1).**

---

### P1-7 · Admin · Scheduled notification campaigns never dispatch

`apps/admin_control/management/commands/dispatch_due_notification_campaigns.py` selects `NotificationCampaign` rows with `status=SCHEDULED, scheduled_for <= now` and dispatches them. **Nothing runs it in production.** The only long-running worker in `compose.production.yaml` is `subscription-scheduler`, and that command's loop calls exactly one thing: `process_subscription_lifecycle`.

An administrator can create and schedule a campaign in the admin UI; it will sit in `SCHEDULED` forever. Also unscheduled: `rebuild_motivation`, `rebuild_operational_analytics`, `reconcile_commerce`, and Django's `clearsessions`.

**Fix:** extend the scheduler loop (or add a second worker) to run the due-campaign dispatcher and the periodic reconciliation/cleanup commands on appropriate intervals. **Risk:** low; the dispatcher is already idempotent per campaign and logs failures per row. **Blocks launch: Yes (P1)** — a shipped admin feature that silently does nothing is worse than an absent one.

---

### P1-8 · Authorization · The subscription gate is bypassable through `path:` route converters

`SubscriptionProtectedPermission.has_permission()` opens with a substring test on the raw request path:

```python
if "/operations/" in request.path or "/admin/" in request.path:
    return True
```

Any route using Django's `<path:...>` converter lets a client inject those substrings into `request.path` and skip the entitlement check entirely.

**Verified live** with the seeded demo student, who holds `focus.workspace` but **not** `content.premium`:

```
GET /api/v1/review-bank                        → 403  (gate enforced)
GET /api/v1/review-bank/subjects/anything      → 403  (gate enforced)
GET /api/v1/review-bank/subjects/admin/        → 200  (gate skipped)
GET /api/v1/review-bank/subjects/x/admin/y     → 200  (gate skipped)
GET /api/v1/review-bank/subjects/x/operations/y→ 200  (gate skipped)
   body: {"subject_key":"x/admin/y","subject_label":null,"count":0,"results":[]}
```

**Current data impact is nil** — of the three `<path:>` routes in the codebase, only `review-bank/subjects/<path:subject_key>` sits in a protected app, and its response is keyed by the same injected string, so no real content is reachable. The other two (`entitlements/me/<path:entitlement_code>`, `operations/configuration/<path:key>`) are not in `PROTECTED_APP_ENTITLEMENTS`.

**Why it is still P1.** The paywall is defeated by a string in a URL. It is safe today by an accident of routing, not by design — the next `<path:>` route added to `content`, `files`, `questions`, or `focus` becomes a working subscription bypass with no code review signal.

**Files:** [backend/apps/entitlements/access_permissions.py:38](backend/apps/entitlements/access_permissions.py:38), [backend/apps/review/urls.py:20](backend/apps/review/urls.py:20).
**Fix:** replace the substring test with a structural one — exempt on `request.resolver_match.app_names` / namespace (e.g. `app_name in {"admin_control","administration","operational_actions",…}`) rather than on the path text. **Risk:** low; the resolver match is already read two lines later. Add a regression test asserting `review-bank/subjects/x/admin/y` returns 403 without `content.premium`. **Blocks launch: Yes (P1).**

---

### P1-9 · Subscriptions · A paid plan can be published with no entitlement rules, locking out every subscriber

`create_admin_plan_version()` reads `payload.get("entitlements", [])` — **the list is optional and defaults to empty**. An administrator can create *and publish* a paid plan version with zero `PlanEntitlementRule` rows. Subscribers on that plan get a subscription with `status=active` and `access_allowed=true`, but hold none of `content.premium` / `files.download` / `focus.workspace`, so `SubscriptionProtectedPermission` denies the entire study product.

**This is not hypothetical — the shipped demo data reproduces it exactly.** `seed_demo` creates plan `lockin-plus-monthly` and grants only `focus.workspace`:

```
GET /api/v1/subscriptions/current  → {"plan_code":"lockin-plus-monthly","status":"active",
                                      "current_period_ends_at":"2026-09-19T…"}
GET /api/v1/entitlements/me        → [{"code":"focus.workspace"}]        # content.premium missing
GET /api/v1/search?q=anatomy       → 403 "An active Lock-in subscription is required for this study feature."
GET /api/v1/learning-objects       → 403
GET /api/v1/quizzes                → 403
GET /api/v1/review-bank            → 403
GET /api/v1/bookmarks              → 403
GET /api/v1/learning/dashboard     → 403
GET /api/v1/files/<pdf>/view       → 403
```

An **actively subscribed, fully paid account is locked out of the entire product** with a message telling them to subscribe. (The migration-seeded `lockin_trial` / `lockin_monthly` plans *do* carry the correct rules, and a genuinely new user is fine — verified below in §11 — so this is a plan-configuration hazard, not a broken default.)

**Files:** [backend/apps/admin_control/services.py:1060](backend/apps/admin_control/services.py:1060), [backend/apps/entitlements/access_permissions.py](backend/apps/entitlements/access_permissions.py), [backend/platform_core/management/commands/seed_demo.py:728](backend/platform_core/management/commands/seed_demo.py:728).
**Fix:** require a non-empty entitlement set (or explicit `"entitlements": []` acknowledgement) before a plan version may be **published**; add a preflight/admin warning listing published plan versions with no rules; fix the demo seed to grant the full study set. **Risk:** low. **Blocks launch: Yes (P1)** — the failure mode is silent and hits paying customers.

---

### P1-10 · Privacy · Plaintext payment codes and user identity are sent to Telegram, undisclosed

Every manual Libyana recharge submission is forwarded to a Telegram chat containing the **plaintext recharge code** plus the user's ID, username, plan and amount:

```
New Lock-in Payment
User ID: …
Username: …
Plan: …
Amount: …
Recharge Code: <plaintext>
Submitted: …
Payment ID: …
```

The code is properly encrypted at rest (`encrypt_recharge_code`, `PAYMENT_CODE_ENCRYPTION_KEY` required and length-validated in production, admin reads masked to last-4 by default) — and then sent in clear to a third-party messaging service, where it persists in chat history for everyone in that chat, on their personal devices.

The Privacy Policy (`frontend/src/components/PublicInfoPage.jsx`) does **not** mention Telegram, payment/recharge data, Google/Apple OAuth, retention periods, data location, or any subprocessor.

**Files:** [backend/apps/payments/telegram.py](backend/apps/payments/telegram.py), [backend/apps/payments/manual_services.py:240](backend/apps/payments/manual_services.py:240), [frontend/src/components/PublicInfoPage.jsx](frontend/src/components/PublicInfoPage.jsx).
**Fix (technical):** send only a masked code (last 4) plus the payment ID, and require the reviewer to open the admin UI for the full value; that path is already built (`recharge_code_for_admin`). **Fix (documentation):** disclose the Telegram processor, OAuth providers, payment-data handling and retention in the Privacy Policy. **Risk:** low. **Blocks launch: Yes (P1)** for the masking change; the policy update is a launch-gate item requiring professional review (see §16).

---

### P1-11 · Release gate · The Playwright browser suite is 63% red and protects nothing

```
npx playwright test --reporter=line
→ 87 failed, 46 passed, 4 skipped   (137 tests, 24.5 min)
```

Failures span nearly every spec: `focus-pinch-zoom` (19), `focus-workspace-responsive` (16 — every phone and tablet viewport, portrait and landscape), `focus-workspace-lifecycle` (6), `responsive-p0-regressions` (5), `focus-workspace-persistence` (5), `focus-workspace-controls` (7), `focus-workspace-a11y` (5), `rtl-direction` (5), `focus-pdf-recovery` (2), `focus-workspace-stress` (2), plus `translation-coverage` (both languages), `shell-navigation`, `touch-targets`, `review-bank`, `interaction-states` and all three `auth` specs.

**Root cause — confirmed, single and shared.** The specs stub `**/api/v1/**` with a generic `{"count": 0, "results": []}` for every GET. `ProtectedRoute` now requires a resolved subscription session before rendering any study route, and that stub does not satisfy the contract. Re-running one spec in isolation:

```
npx playwright test e2e/rtl-direction.spec.js --reporter=list   → exit 1, 5/5 failed
Error: expect(locator('.catalog-tile').first()).toBeVisible() failed — element(s) not found
   at signIn (e2e/rtl-direction.spec.js:36)
```

and the captured page snapshot shows the shell rendering correctly with the content area replaced by:

```
- status: "The current-subscription response was incomplete."
- button "Try again"
```

So the application is behaving correctly and the **test fixtures are stale** — they predate the frontend subscription gate. (`subscription-live.spec.js`, written after that gate, is among the specs that pass.)

**Why it matters.** The `browser` CI job is one of four required by `quality-gate`, so it blocks every merge. More importantly, the suite that covers the highest-risk surface in the product — pinch zoom, gesture arbitration, ink lifecycle, annotation persistence, responsive fit across 16 device viewports, RTL direction, touch targets — is currently reporting nothing useful. Any real regression in the Focus Workspace would be invisible.

**How it was verified.** Full suite run (summary above); single-spec re-run with `--reporter=list` for the assertion text; inspection of `test-results/*/error-context.md` page snapshots; read of `e2e/rtl-direction.spec.js:15-38` (the shared `signIn` helper) against [frontend/src/components/auth/ProtectedRoute.jsx](frontend/src/components/auth/ProtectedRoute.jsx) and [frontend/src/lib/subscriptionSession.js](frontend/src/lib/subscriptionSession.js).

**Recommended fix.** Extract one shared e2e fixture that mocks `/api/v1/auth/session`, `/api/v1/subscriptions/current` and `/api/v1/entitlements/me` with a valid, entitled session, and route every spec's `signIn` helper through it. Then re-run and triage whatever still fails on its own merits — some of those 87 may be masking genuine defects.

**Risk of the fix.** Test-only; no production code changes. **Blocks launch: Yes (P1)** — not because the failures prove a product defect, but because there is currently no working browser regression gate in front of the P0-2 workspace rework.

*(Incidental confirmation: the captured Arabic page snapshot shows `generic: "Study streak"` and `strong: "0 day"` inside an otherwise fully Arabic sidebar — independent evidence for P2-3.)*

---

## 6. P2 — Important Before Launch

**P2-1 · Store is a non-functional storefront showing real currency prices.**
`/store` renders a full catalogue (themes, bundles, add-ons) priced in a fictional "LOCK" currency, with top-up tiles labelled **$1.99 / $3.99 / $7.99 / $14.99**. Every purchase button calls `setNotice(...)`. The top bar shows a hard-coded balance: `useState(1250)` in `App.jsx`, defaulted again as `lockBalance = 1250` in `Topbar`. Users can be led to believe they can buy. *Fix:* gate `/store` behind a feature flag or label it "Coming soon" like the Questions categories already do. Files: [frontend/src/pages/Store.jsx](frontend/src/pages/Store.jsx), [frontend/src/App.jsx](frontend/src/App.jsx), [frontend/src/components/layout/index.jsx:286](frontend/src/components/layout/index.jsx:286).

**P2-2 · The question bank is three demo questions per sheet.** Of five Questions categories, four are labelled "Soon" (honest). The only live one leads to a client-side **"Demo quiz"** from `demoQuizCatalog.js` whose explanations read *"The demo answer emphasizes…"*. No API call is made. Confirmed in-browser. *Fix:* wire to `/api/v1/quizzes` (which works) or label the category as demo content.

**P2-3 · Hardcoded English across error, auth and admin surfaces.** A JSX text-node sweep found **469 candidate untranslated strings across 34 files**. Confirmed user-facing examples in the persistent sidebar rail, visible on every page in Arabic: `Study streak`, `30 days`, `day`, `Freeze`, `Protect your streak for 1 week`, `Soon` ([frontend/src/components/layout/index.jsx:226,234,243](frontend/src/components/layout/index.jsx:226)). Also fully English: `ErrorBoundary`, `ForbiddenState`, `TokenActionPage` (email verification / password reset), `SessionList`, `PublicInfoPage` (Terms/Privacy/Support), and the whole Creator Studio and Admin Content Management. The existing `translation-coverage.spec.js` only detects *unresolved keys*, not hardcoded literals, so it passes. *Fix:* prioritise student-facing error/auth surfaces; admin surfaces can follow post-launch.

**P2-4 · Unconfigured OAuth buttons look enabled.** With `{"google": false, "apple": false}`, both provider buttons render at full visual weight at the top of the sign-in screen. Clicking produces **no visible feedback and no network request**. The accessible name is correct (`"This provider needs administrator configuration."`) but there is no visual affordance. *Fix:* visibly disable or hide unconfigured providers.

**P2-5 · The previous user's email address persists in `localStorage` after logout.** `reminderKey(email)` produces `lock-in.reminder.<email>`; `clearAuthenticatedUi()` clears `sessionStorage` return hints and subscription snapshots but not this key. On a shared university machine the next user can read the prior user's email from browser storage. Verified live: `lock-in.reminder.audit.newuser@example.com`. *Fix:* key reminders by user ID, and clear user-scoped `localStorage` on logout. Files: [frontend/src/lib/utils.js:101](frontend/src/lib/utils.js:101), [frontend/src/App.jsx:148](frontend/src/App.jsx:148).

**P2-6 · No cleanup job for sessions or rate-limit rows.** Every login inserts an `AccountSession` + `django_session` row (30-day lifetime with *remember me*); `AuthAttempt` rows are deleted only on successful login for the `login` scope — `registration`, `oauth_start`, `password_reset_*`, `email_change_*` and `manual_payment` rows are **never** removed. Both tables grow without bound, and the limiter's `COUNT(*)` degrades over time. `clearsessions` is not scheduled. *Fix:* add both to the scheduler loop from P1-7.

**P2-7 · `/api/v1/search` has no pagination and a misleading `count`.** `SearchView` returns `count = len(results)` with `next`/`previous` always `null`, and `global_search` clamps to `min(limit, 24)`. A student can never see more than 24 results and the UI cannot show a true total. The frontend still sends `page`/`page_size`, which the view ignores. (Bounded-ness is good for abuse resistance; the *contract* is the problem.) *Fix:* either document it as type-ahead-only and rename `count`, or restore real pagination — then fix P1-3's test to match.

**P2-8 · Legal pages are English-only and incomplete.** `PublicInfoPage` has no i18n. Content omits OAuth, Telegram, payment data, retention, data location and subprocessors (see P1-10 and §16).

**P2-9 · CSRF cookie lifetime is one year.** `Set-Cookie: csrftoken=…; Max-Age=31449600`. Not a secret leak (production sets `HttpOnly` + `Secure` + `__Host-` and the client obtains the token from `/auth/csrf`), but it is an unnecessarily long-lived persistent identifier. *Fix:* shorten to the session-age setting.

**P2-10 · `X-Robots-Tag: noindex, nofollow, noarchive` is applied to every path**, including `/terms` and `/privacy`. Intentional for a private workspace, but if public discoverability of the legal pages matters, carve them out in [frontend/nginx/default.conf](frontend/nginx/default.conf).

**P2-11 · Mobile install interstitial blocks the app on first visit.** On a 375×812 touch viewport the PWA launch screen covers the app (`inert` on the app root) until the user chooses *Install* or *Continue in browser*, and reappears after two weeks. Behaviourally correct and dismissible, but it is a full-screen wall before first use on the platform most students will arrive on. Flagging as a conversion risk for a product decision, not a defect.

---

## 7. P3 — Post-Launch Backlog

- **152 `drf_spectacular.W002` warnings** — most `APIView`s cannot be introspected, so the OpenAPI schema is largely unusable. Harmless in production (`EXPOSE_API_DOCS=False`), but the published contract is not trustworthy.
- **Dead API field:** community `context_route` emits `/learn/content/<id>` and `/learn/nodes/<id>`; no such frontend routes exist and no frontend code reads the field. ([backend/apps/community/context.py:39,53](backend/apps/community/context.py:39))
- **`seed_demo` bypasses the service layer**, so `SearchEntry` is empty (0 rows) in dev/demo and search appears broken locally even though production indexing is wired correctly (`upsert_search_entry` is called inline from content/question/quiz publish services).
- **Raw HTML persists in user text fields** (e.g. `full_name = "<script>alert(1)</script>"` was accepted). Inert — React escapes it and the CSP forbids inline scripts — but it is poor data hygiene and will render as literal markup.
- **Manual entitlement grants make the client snapshot permanently "fresh"** (`isSubscriptionSnapshotFresh` returns `true` unconditionally), so a revoked manual grant leaves the UI showing access for the rest of the session. The server still denies every request.
- **Main entry chunk is 518 kB (152 kB gzip)** with a Vite `chunkSizeWarningLimit` warning; `check:bundle` passes.
- **Duplicate API requests in development** (`/auth/cohorts`, `/auth/oauth/providers`, `/progression/streak`, `/notifications/summary` each fire twice) — consistent with React StrictMode double-effects; not verified in a production build.
- The repository root holds **11 historical audit/report markdown files**; consolidating them would make the launch-critical documents easier to find.

---

## 8. Security Findings

### Attempted and **not** exploitable

| Attack | Result |
|---|---|
| Unauthenticated access to 18 protected endpoints | All `403`/`404` — no anonymous data |
| Student → admin endpoints (24 routes) | All `403` |
| Creator → admin endpoints | All `403` |
| Student → creator/management endpoints | All `403` |
| IDOR: delete another user's session | `404` |
| IDOR: read/submit another user's quiz attempt | `404` / rejected; victim attempt unchanged (`status=active`, `revision=1`) |
| IDOR: mark another user's notification read | `404` |
| IDOR: edit / delete another user's discussion | `403` / `400` |
| CSRF: unsafe requests with no token (logout, profile PATCH, login, register) | All `403` |
| CSRF: forged token value | `403` |
| Malformed JSON body | `400`, no stack trace |
| Unknown/extra fields (`{"is_superuser": true}`) | `400` — `StrictSerializer` rejects unknown keys |
| Wrong types (`{"full_name": {"a": 1}}`) | `400` |
| Path traversal in file route (`/files/<uuid>/..%2f..%2fetc`) | `404` |
| Unsupported HTTP method | `403`/`405` |
| Byte-range abuse (`Range: bytes=99999999-`) | `416` with `Content-Range: bytes */601` |
| Stored XSS via profile name and discussion body | Stored but inert (React escaping + CSP `script-src 'self'`) |
| Concurrency: 8 parallel identical bookmark writes | 1× `201`, 7× `200`, **exactly one row** |
| Idempotency replay (same key, attempt creation) | `200` with `resumed`, no duplicate |
| Open redirect via OAuth outcome | Outcome/error values allowlisted; redirect built from `PUBLIC_APP_URL` only |

### Exploitable or broken

| Finding | Ref |
|---|---|
| Study content served from a public unauthenticated URL | P0-2 |
| Entitlement gate bypassable via `<path:>` converter | P1-8 |
| Global rate-limit bucket behind the proxy | P1-1 |
| Registration flooding / credential spraying unthrottled | P1-2 |
| Plaintext payment codes to a third-party chat service | P1-10 |

### Configuration review

- **Debug/dev leftovers:** none found. `DEBUG=False` in production and demo; no dev toolbars, no bypass flags, no force-admin code, no test endpoints. `PAYMENT_PROVIDER="fake"` is explicitly rejected by production settings. `EXPOSE_API_DOCS=False` in production (verified `/api/v1/docs/` returns 200 only in dev settings).
- **Secrets:** no keys, tokens or credentials found in tracked files. `.gitignore` covers `.env*` (except the two `.example` files), `secrets/`, `backups/`. Secrets are injected via `*_FILE` Docker secrets; `secret_env()` rejects ambiguous `NAME` + `NAME_FILE` configuration. Frontend build args are all public-by-design (support email, legal entity, policy version) and the Dockerfile **fails the build** on placeholder values.
- **Console logging:** 4 `console.*` calls total in `frontend/src`, none logging sensitive data (`[PWA]` diagnostics and two PDF render errors).
- **Source maps:** none emitted to `dist/`.
- **TODO/FIXME/HACK:** zero across backend and frontend source.

---

## 9. Permissions Matrix

Live results (HTTP status), `config.settings.e2e`, seeded demo data. Anonymous = no cookie.

| Endpoint | Anon | Student (no `content.premium`) | Student (trial) | Creator | Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| `GET /auth/session` | 403 | 200 | 200 | 200 | 200 |
| `GET /dashboard` | 403 | 200 | 200 | 200 | 200 |
| `GET /learning/dashboard` | 403 | **403** | 200 | 200 | 200 |
| `GET /search?q=` | 403 | **403** | 200 | 200 | 200 |
| `GET /learning-objects` | 403 | **403** | 200 | 200 | 200 |
| `GET /quizzes` | 403 | **403** | 200 | 200 | 200 |
| `GET /review-bank` | 403 | **403** | 200 | 200 | 200 |
| `GET /bookmarks` | 403 | **403** | 200 | 200 | 200 |
| `GET /files/<pdf>/view` | 403 | **403** | 200 | 200 | 200 |
| `GET /notifications` | 403 | 200 | 200 | 200 | 200 |
| `GET /progression/xp` \| `/streak` \| `/rankings` | 403 | 200 | 200 | 200 | 200 |
| `GET /community/discussions` \| `/spaces` | 403 | 200 | 200 | 200 | 200 |
| `GET /subscriptions/current` \| `/entitlements/me` | 403 | 200 | 200 | 200 | 200 |
| `GET /invoices` \| `/payments` \| `/refunds` | 403 | 200¹ | 200¹ | 200¹ | 200¹ |
| `GET /moderation/reports` | 403 | 200¹ | 200¹ | 200¹ | 200 |
| `GET /moderation/audit` | 403 | 403 | 403 | 200 | 200 |
| `GET /management/content` \| `/questions` \| `/quizzes` \| `/education/*` | 403 | 403 | 403 | **200** | 200 |
| `POST /management/files` | 403 | 403 | 403 | **200** | 200 |
| `GET /admin/users` | 403 | 403 | 403 | 403 | **200** |
| `PATCH /admin/users/<id>/roles` | 403 | 403 | 403 | 403 | **200** |
| `GET /operations/session` \| `/users` \| `/audit` \| `/analytics` | 403 | 403 | 403 | 403 | **200** |
| `GET /operations/admin/purchases` \| `/subscriptions` \| `/plans` \| `/roles` | 403 | 403 | 403 | 403 | **200** |
| `GET /operations/configuration` \| `/system-health` \| `/reports` \| `/resources` | 403 | 403 | 403 | 403 | **200** |
| `GET /operations/dashboards/{overview,support,content}` | 403 | 403 | 403 | 403 | **200** |
| `GET /entitlements/admin/grants` | 403 | 403 | 403 | 403 | 405² |

¹ User-scoped list — returns only the caller's own rows (verified empty for a fresh account).
² Method not allowed (POST-only endpoint); authorization is enforced.

**Enforcement model.** Global default is `IsAuthenticated` + `SubscriptionProtectedPermission`. Admin surfaces use `HasOperationalCapability` with a per-view `required_capability`; a scripted check confirmed **every** view using that class declares one (a missing declaration fails closed). Creator surfaces use `IsCreatorOrAdministrator`, which selects `assessments.manage` vs `content.manage` by view module. Roles are Django groups plus `is_superuser`; the last active administrator cannot be demoted or suspended (`replace_managed_roles`, `set_account_status`).

**Not exercised as distinct live roles:** trial-expired, grace-period, suspended, moderator. Suspension logic was read and is sound (`set_account_status` sets `status=SUSPENDED` → `is_active=False` → `ModelBackend` refuses authentication, and all sessions are deleted server-side), but a suspended login was not executed. **NOT VERIFIED.**

---

## 10. Cookie & Session Inventory

Captured from live `Set-Cookie` headers (dev) and read from `config/settings/production.py` (prod).

| Name (dev → prod) | Purpose | Lifetime | Secure | HttpOnly | SameSite | Path | Domain | Class |
|---|---|---|:--:|:--:|:--:|---|---|---|
| `sessionid` → `__Host-lockin_session` | Django auth session | 12 h, or 30 d with *remember me* | prod ✓ | ✓ | Lax | `/` | none | Essential |
| `csrftoken` → `__Host-lockin_csrf` | CSRF token | 1 year (P2-9) | prod ✓ | prod ✓ | Lax | `/` | none | Essential |
| `lockin_oauth_browser` → `__Host-lockin_oauth_browser` | OAuth browser binding (login-CSRF) | 600 s | prod ✓ | ✓ | prod `None`¹ | `/` | none | Essential |

¹ `SameSite=None` is required because Apple's `form_post` callback is cross-site; the cookie is `__Host-` prefixed, `Secure`, `HttpOnly`, and single-use.

**No analytics, marketing or third-party cookies exist.** Verified `document.cookie` in the browser after full sign-in: only `csrftoken` is script-visible (dev; in production `CSRF_COOKIE_HTTPONLY=True` makes it invisible too — the client reads the token from the `/auth/csrf` response body instead).

### Browser storage

| Store | Key | Contents | Cleared on logout |
|---|---|---|:--:|
| localStorage | `lock-in.session` | `"active"` — non-secret UI hint only | ✓ |
| localStorage | `lock-in.theme`, `lock-in.theme.settings`, `lock-in.locale` | Preferences | ✗ (fine) |
| localStorage | `lock-in.catalog-workspace.*` | Tool memory, recent colours, workspace settings | ✗ (fine) |
| localStorage | `lock-in.materials.{last,recent}-opened-sheet(s)` | Navigation hints | ✗ |
| localStorage | **`lock-in.reminder.<email>`** | **User's email in the key** | **✗ — P2-5** |
| localStorage | `lock-in.pwa-launch.dismissed-at` | Install-prompt suppression | ✗ (fine) |
| sessionStorage | `lock-in.subscription-session.<user-uuid>` | Subscription snapshot cache | ✓ |
| IndexedDB | `lock-in-workspace` | **All PDF annotations** (per-owner, per-sheet) | ✗ — see P0-2 |

**No authentication token is stored in JavaScript-reachable storage.** Django owns the session in an `HttpOnly` cookie; `lock-in.session` is only a boolean UI hint. This is the correct design.

**Client-clock dependency:** `isSubscriptionSnapshotFresh(snapshot, userId, now = Date.now())` uses the client clock for cache freshness. A back-dated clock keeps a stale "access allowed" snapshot — but the server re-checks entitlements on every protected request, so the worst case is a shell that renders while all data calls return 403. **Verified safe by design.**

---

## 11. User Journey Results

| Journey | Status | Evidence |
|---|---|---|
| **New user — full path** | **PASS** | `POST /auth/register` → `201 {"status":"verification_required"}` → verification email rendered to console with a single-use link → `POST /auth/verify-email` → `200 {"status":"verified"}` → `POST /auth/login` → `200` → **trial auto-provisioned on first protected call** (`lockin_trial`, 7 days, `trialing`) granting `content.premium` + `files.download` + `focus.workspace` → all study endpoints `200`. |
| New user — onboarding UI | PASS | Sign-in → *Welcome to Lock-in* screen showing "Free access 7 days / Trial expires Sep 7, 2026" → *Start my free trial* → Dashboard. Username auto-derived at registration (`auditnewuser`). |
| Browse → open sheet → PDF → Focus Workspace | **PARTIAL** | Navigation works and the workspace renders a real 16-page PDF with page indicator `1/16`. **But the PDF is the bundled mock** — see P0-2. |
| Annotate in Focus Workspace | **PARTIAL** | Pen tool selected, two strokes drawn, both rendered correctly. **Zero annotation API calls**; persistence is IndexedDB-only — see P0-2. |
| Questions → quiz → answer | PARTIAL | *Questions* hub renders 5 categories (4 labelled "Soon"). *Quizzes* → subject → sheet → **"Demo quiz"** with 3 hard-coded questions; answering shows immediate correct/incorrect feedback. No API calls. |
| Real server-backed quiz attempt | PASS | `POST /quizzes/<id>/attempts` with a UUID idempotency key → `201` with a live attempt; replay with the same key → `200 {"resumed":…}`; cross-user read/submit → `404`/rejected. |
| Logout → login again | PASS | Session invalidated server-side; re-login restores state. `sessionStorage` snapshots and return hints cleared. |
| Existing user not forced through onboarding | PASS | `welcome_completed_at` / `profile_completion_required` gate the flow; a completed user goes straight to the dashboard. |
| Arabic / RTL | PASS (with gaps) | `dir="rtl"`, `lang="ar"`, mirrored sidebar and icons, translated navigation, **no horizontal overflow** at 375 and 768. Untranslated sidebar strings — P2-3. |
| Expired subscriber | NOT VERIFIED | No expired subscription in the dataset; state machine reviewed statically only. |
| Suspended user | NOT VERIFIED | Logic reviewed (sessions deleted, `is_active=False`); no live suspension performed. |
| Admin full workflow | PARTIAL | Every admin API authorised correctly and returns data; admin UI workflows not driven end-to-end in the browser. |
| Payment / manual recharge | NOT VERIFIED | `PAYMENT_PROVIDER=none` in production; manual Libyana flow reviewed statically (rate limit is correctly per-user, duplicate-code detection present, codes encrypted at rest). |

---

## 12. Device / Browser Matrix

**Only what was actually executed is listed.**

| Target | Viewport | Executed | Result |
|---|---|---|---|
| Chromium desktop | 1280×720 | ✅ full session: auth, dashboard, materials, sheet, Focus Workspace, drawing, questions, quiz | PASS |
| Chromium mobile emulation | 375×812, touch + Android UA | ✅ dashboard, install interstitial, bottom nav, overflow check | PASS (`scrollWidth == innerWidth == 375`) |
| Chromium tablet emulation | 768×1024 | ✅ Arabic RTL dashboard, sidebar rail | PASS (overflow-free; untranslated strings found) |
| Playwright / Chromium (headless) | e2e suite, 23 spec files | ⏳ launched; see §19 | See §19 |
| **Safari iOS (real device)** | — | ❌ | **NOT VERIFIED** |
| **Safari desktop / WebKit** | — | ❌ | **NOT VERIFIED** — `--project=webkit-focus` not run |
| **Chrome Android (real device)** | — | ❌ | **NOT VERIFIED** |
| **Firefox** | — | ❌ | **NOT VERIFIED** |
| **Installed PWA (home screen launch)** | — | ❌ | **NOT VERIFIED** |

Emulation is not a substitute for hardware on the two things that matter most here: **iOS Safari pinch/pointer-capture in the Focus Workspace**, and **PWA install + update behaviour on iOS and Android**. `FOCUS_WORKSPACE_REAL_DEVICE_CHECKLIST.md` exists in the repo and should be executed on real devices before launch.

---

## 13. Focus Workspace Audit

The workspace is genuinely well-engineered as a *rendering and input* system, and separately compromised as a *content* system.

### What was verified working

| Aspect | Result |
|---|---|
| PDF opening and rendering | PASS — real 16-page PDF, correct Arabic text and vector graphics |
| Study-mode chooser (Normal / Active with Easy·Medium·Hard) | PASS — renders over the document, dismisses correctly |
| Page indicator | PASS — `1 / 16`, `aria` exposed as "Page 1 of 16" |
| Toolbar | PASS — 16 controls, **every one has a correct accessible name** (Pan, Pen, Pencil, Highlight, Eraser, Lasso, Shape, Image, Notes, Undo (Ctrl+Z), Redo (Ctrl+Shift+Z), Choose study mode, Save to Bookmarks, Workspace settings, Exit Workspace) |
| Drawing | PASS — pen selected, two drag strokes rendered with correct colour/width, no lag or artefacts observed |
| Exit and re-entry | PASS — returns to the sheet page cleanly |
| Console during the session | PASS — no exceptions, no unhandled rejections |
| Architecture | Strong — dedicated modules for gesture state machine, elastic gestures, scroll momentum, coordinate transforms, stroke model, eraser session, render queue and render budget |

### Defects

| ID | Finding |
|---|---|
| **P0-2** | Serves a bundled mock PDF from a public URL for all 22 sheets |
| **P0-2** | Annotations persist to IndexedDB only — no server sync, no cross-device, lost on cache clear / ITP eviction |
| P2-11 | On touch viewports the PWA install interstitial precedes workspace access |
| — | Active-Study "Medium" pace chip appears low-contrast when selected (grey on tan) — worth a contrast measurement |

### Server-side counterpart (built, unused by this route)

`FocusAnnotationsView` implements optimistic-concurrency annotation sync with `expected_collection_revision`, `idempotency_key`, per-page revisions, replay detection and page-count validation, all scoped by `user_id` — meaning **cross-user annotation access is structurally impossible** (annotations are keyed on `(user, document_version)`; there is no route that accepts another user's id). Wiring the catalog workspace to it would close P0-2's durability half.

### Not verified

Pinch zoom focal point, pan/gesture arbitration, diagonal movement, edge behaviour, momentum, page switching under load, eraser modes, undo/redo depth, shape tools, bookmarks, large-PDF memory, many-annotation performance, rapid zoom/pan, touch cancellation, multi-touch, Android scroll performance, memory leaks. The repository's Playwright suite covers much of this (`focus-pinch-zoom`, `focus-workspace-*`, `focus-pdf-recovery`) — see §19 — but **real-device testing remains outstanding**.

---

## 14. PWA Audit

| Item | Finding |
|---|---|
| Manifest | PASS — `id`/`start_url`/`scope` all derive from the build base path; `display: standalone` with `["standalone","minimal-ui"]` override; `theme_color`/`background_color` `#070b16`; categories set; `prefer_related_applications: false` |
| Icons | PASS — 192, 512 (`any`) and 512 (`maskable`); apple-touch-icon 180; favicons 16/32 |
| Service worker | PASS — `injectManifest`, `clientsClaim()`, `cleanupOutdatedCaches()` |
| Precache scope | Good — only `index.html`, manifest, and the entry JS/CSS (14 entries, 964.65 KiB). Lazy routes and media cache on first use |
| **Private-data caching** | **PASS — deliberately correct.** The fetch handler returns early for `url.pathname.startsWith("/api/")` and for non-asset paths, so **no API or navigation response is ever cached**. A previous version's `api-cache` is explicitly deleted on activate |
| Runtime cache hygiene | Good — versioned by `__APP_VERSION__`, 96-entry cap with FIFO trim, in-flight request de-duplication, old-version caches purged on activate |
| Update flow | PASS — `registerType: "prompt"`; `useRegisterSW` surfaces `needRefresh`; `PwaUpdatePrompt` offers *Update*, calls `updateServiceWorker(true)`, and suppresses itself inside immersive workspaces. `SKIP_WAITING` message handler present. Users are **not** stranded on an old build |
| Cache headers | PASS — `service-worker.js`: `expires epoch`; `manifest.webmanifest` and `index.html`: `expires -1`; `/assets/*`: `expires max` (content-hashed) |
| Install flow | PASS in emulation — `beforeinstallprompt` captured, Android manual-install instructions, iOS Safari share-sheet instructions, dismissal remembered with a two-week re-ask |
| **Offline launch, install, home-screen launch, upgrade-after-deploy, reconnect** | **NOT VERIFIED** — requires real devices |
| **iOS / Android behaviour** | **NOT VERIFIED** |

---

## 15. Performance Findings

**Measured:**
- Production build: **26.89 s**, exit 0. Service worker build: 0.53 s.
- Bundle (gzip): entry `index-ChAO-2V9.js` **148.5 KiB**, `index-s-b3I1XN.css` **71.9 KiB**, two small entries 2.4 + 3.6 KiB. `check:bundle` **passes** its budget.
- Largest lazy chunks: `CatalogFocusWorkspace` 194.25 KiB raw / 59.06 KiB gzip; `OperationsAdmin` 107.75 KiB / 25.59 KiB. Good — the two heaviest surfaces are correctly split out.
- Vite warning: entry chunk 518.63 KiB raw exceeds the 500 KiB advisory.
- Backend query cost: health endpoints are bounded (0 queries live, 1 ready). The `/search` bounded-query test currently fails for contract reasons (P1-3), not cost reasons.
- Backend test suite wall time: 239.53 s for 283 tests on SQLite.

**Reviewed, not measured:** no N+1 patterns spotted in the selectors read (consistent `select_related`/`prefetch_related`); pagination defaults to 25; `global_search` clamps to 24 results and 3× that in candidates; production DB sets `statement_timeout=15s`, `lock_timeout=3s`, `idle_in_transaction_session_timeout=30s`, `CONN_MAX_AGE=60` with health checks.

**NOT VERIFIED:** throttled CPU/network runs, Core Web Vitals, canvas/PDF memory under load, Android scroll performance, long main-thread tasks, memory leaks over a long workspace session, blur/shadow cost on mobile.

---

## 16. Privacy / Legal-Readiness Notes

### Technical privacy findings

1. **Third-party disclosure (P1-10):** plaintext recharge codes + user ID/username/plan/amount are POSTed to `api.telegram.org`. This is a real subprocessor relationship and a real transfer of payment-adjacent personal data.
2. **Email in browser storage (P2-5):** `lock-in.reminder.<email>` survives logout on shared devices.
3. **API response hygiene: good.** `UserSerializer` (which includes `email`) is used only for the caller's own record and for the admin user list. Community responses expose only `{id, full_name, avatar, badges}` — no emails. Rankings default to `"privacy_default": "initials"`.
4. **No advertising or analytics trackers.** No third-party scripts; CSP `connect-src 'self'` forbids external calls from the page.
5. **Logs:** structured JSON with `request_id`, `route`, `method`, `status_code`, `duration_ms` — no credentials, no bodies, no tokens. Admin actions record `AuditRecord` rows including IP.
6. **No PII in URLs or query strings** in any flow observed; account tokens travel in POST bodies.
7. **Password/token handling:** one-time tokens stored as salted-HMAC digests, never in plaintext; password reset invalidates all sessions; password change rotates the session and keeps only the current one.

### Policy / documentation recommendations

The Privacy Policy should additionally disclose: Google and Apple as identity providers and what is received from them; Telegram as a processor for manual payment review; what payment data is collected and how long recharge codes are retained; retention periods for accounts, security events, audit records and annotations; where data is stored; and how a user actually exercises deletion. The Terms should state the subscription/trial terms, renewal and cancellation behaviour, and refund handling — the product implements all three but the Terms are silent on them.

Both documents are **English-only** while the product ships an Arabic UI and targets Arabic-speaking students; users accept them at registration.

### Requires professional verification

Whether a consent banner is needed (the product uses **only essential cookies**, which in most regimes does not require one — mechanically requiring a banner here would be wrong); the lawful basis for processing; cross-border transfer implications of the Telegram forwarding; and jurisdiction-specific retention and deletion obligations. **These are legal questions and need qualified review — nothing in this report is legal advice.**

---

## 17. Production Configuration Review

**Verified:** `manage.py check --deploy --fail-level ERROR` under `config.settings.production` with a complete environment → **passes**, 0 errors (153 warnings: 152 `drf_spectacular.W002`, 1 `security.W021` HSTS-preload advisory).

| Area | Finding |
|---|---|
| Secrets | Docker secrets via `*_FILE`; `secret_env()` rejects ambiguous config, empty/oversized/NUL-containing values. `DJANGO_SECRET_KEY` must be ≥50 chars and must not start with `unsafe-`/`replace-`/`test-`. `PAYMENT_CODE_ENCRYPTION_KEY` must be ≥32 chars and distinct. |
| Environment | ~25 fail-closed assertions: explicit `ALLOWED_HOSTS` (no `*`), HTTPS `PUBLIC_APP_URL` whose host must appear in `ALLOWED_HOSTS`, HTTPS-only CSRF origins, real mail backend, no fake payment provider, valid `POSTGRES_SSLMODE`, mandatory proxy-SSL contract, scheduler interval bounds. |
| HTTPS | `SECURE_SSL_REDIRECT=True`; nginx `308` from `:8080` to `https://$host`; TLS 1.2/1.3 only; HSTS `max-age` ≥300 enforced, default 3600 with `includeSubDomains`. **HSTS at 1 hour is very short for launch** — raise to ≥6 months once the certificate/renewal path is proven. |
| CORS | No `django-cors-headers` and no CORS middleware — same-origin only by construction. Correct for this architecture. |
| CSRF | `__Host-` cookie, `Secure`, `HttpOnly`, HTTPS-only trusted origins, enforced on **every** unsafe request including login/register. |
| Headers (nginx) | CSP `default-src 'self'; base-uri 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:` · `Permissions-Policy` denies camera/geolocation/microphone/payment/usb · `Referrer-Policy: no-referrer` · `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · COOP + CORP `same-origin` · HSTS. **No wildcards anywhere.** `style-src-attr 'unsafe-inline'` is documented and scoped to attributes only. No CSP `report-uri` (add one). |
| OAuth | Redirect URIs must be HTTPS, on the public host, and exactly `/api/v1/auth/oauth/{google,apple}/callback`, with no query/params/fragment. Partial configuration is rejected. No provider secret reaches the frontend. |
| Static/media | `MEDIA_URL = "/unserved-media/"` — media is **never** served by the web server; all delivery goes through the authorising `ManagedFileDeliveryView`. Uploads `0o640` / dirs `0o750`. Static served by nginx with `expires 1h`. |
| Debug | `DEBUG=False` in production and demo. `EXPOSE_API_DOCS=False`. |
| Containers | Non-root `uid 10001`, `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, tmpfs for `/tmp`, internal-only `data` network, least-privilege runtime DB role verified at preflight (no schema-create, no audit mutation, PostgreSQL ≥16). |
| Upload limits | `client_max_body_size 52m` (nginx) vs `CONTENT_MAX_AUDIO_BYTES` default **100 MB** — **audio uploads above 52 MB will be rejected by nginx with a raw `413` before Django sees them.** Align these two values. |

---

## 18. Monitoring / Backup / Recovery Readiness

**Can launch operators detect a failure?** — **No.** Metrics and error reporting are no-op stubs (P1-6); the frontend reports nothing. The only signals are stdout logs and two health endpoints that nothing polls.

**Can they recover from one?** — **Partially, and only manually.** The runbook and scripts are good (P1-5), but nothing is scheduled, no restore drill has been recorded, and media backup requires manual write-fencing. Deployment rollback is well covered by immutable image tags + `release`/`preflight` gates; migration rollback is favourable because **no migration is destructive** (77 migrations, zero `RemoveField`/`DeleteModel`).

**Operational controls that exist:** deploy, rollback, run migrations (`release`), verify a release (`production_preflight`), suspend a user, force logout, cancel/transition subscriptions, review manual payments, grant/revoke entitlements, toggle maintenance mode (with an admin recovery path), rotate secrets (file-based), update OAuth config, disable registration (`registration.enabled`), immutable audit history.

**Operational controls that are missing:** automated backups; monitoring/alerting; scheduled campaign dispatch, projection rebuilds and session cleanup; a way to clear a file's scan state (P0-1); any way to see frontend errors.

---

## 19. Automated Test Results

Exact commands and results. Nothing below is inferred.

| Command | Result |
|---|---|
| `npx vite build` (frontend/) | ✅ **exit 0**, 26.89 s. Warning: entry chunk 518.63 KiB > 500 KiB. PWA precache 14 entries / 964.65 KiB |
| `npx eslint --max-warnings 0` | ✅ **exit 0**, no output |
| `npx tsc -p tsconfig.phase0.json --pretty false` | ❌ **exit 2** — 4 errors (listed in P1-4) |
| `npx tsc -p tsconfig.worker.json --pretty false` | ✅ **exit 0** |
| `node --test tests/*.test.js` | ✅ **190 pass, 0 fail**, 3.89 s |
| `node scripts/check-bundle.mjs` | ✅ **exit 0** — 148.5 / 2.4 / 3.6 KiB JS + 71.9 KiB CSS gzip |
| `npx pnpm audit --prod --audit-level=high` | ✅ **exit 0** — *No known vulnerabilities found* |
| `LOCKIN_TEST_USE_SQLITE=1 python -m pytest -q` (backend/) | ❌ **1 failed, 280 passed, 2 skipped**, 239.53 s; **coverage 84.99% < 85% gate** |
| `python -m pytest platform_core/tests/test_performance.py --no-cov` | ❌ 1 failed, 1 passed — `assert 12 == 100` (P1-3) |
| `python manage.py check --deploy --fail-level ERROR` (production settings) | ✅ **exit 0** — 153 warnings, 0 errors |
| `python -m pip_audit . --strict` | ⚠️ **NOT VERIFIED** — crashes locally: `pip_api` cannot invoke `pip` because the repository path contains RTL Unicode marks (`‏‏`). Environment-specific; CI runs it on Linux |
| `npx playwright test --reporter=line` (23 specs) | ❌ **87 failed, 46 passed, 4 skipped** of 137, 24.5 min — see P1-11 |
| `npx playwright test e2e/rtl-direction.spec.js --reporter=list` | ❌ **exit 1**, 5/5 failed — root-cause confirmation for P1-11 |

**Not run:** `ruff check`, `ruff format --check`, `mypy` (all covered by the same CI job as pytest, which already fails); `--project=webkit-focus`; the containers CI job (`docker build`, `nginx -t`, `docker compose config`).

**CI impact.** `.github/workflows/ci.yml` requires all four jobs (`backend`, `frontend`, `browser`, `containers`) to succeed in the `quality-gate` job. On the audited branch, **three of the four fail**: `backend` (pytest + coverage), `frontend` (typecheck), and `browser` (87 Playwright failures). **The branch cannot currently pass its own release gate, and the browser suite is providing no regression protection at all.**

---

## 20. Recommended Fix Order

Ordered by risk and dependency, not by file location.

**Phase 1 — unblock the gates (do first; cheap, and everything else depends on a green pipeline)**
1. **P1-4** Fix the 4 TypeScript errors. *(minutes)*
2. **P1-3** Decide the `/search` contract, update `test_performance.py`, restore coverage ≥85%. *(hours)*
3. **P1-11** Fix the shared Playwright sign-in fixture so the browser suite runs again, then triage the residual failures. Do this **before** the P0-2 workspace rework so that work lands with a working regression net. *(hours)*

**Phase 2 — P0 blockers**
4. **P0-1** Resolve the scan gate — scanner, audited operator action, or documented flag-off. Nothing about content can be tested until this lands.
5. **P0-2** Point Materials and the Focus Workspace at the real content API; remove the public test PDF; move annotations onto the existing server sync. Sequence strictly after #4.

**Phase 3 — security and access control**
6. **P1-8** Replace the substring exemption with a resolver-based one; add the `review-bank/subjects/x/admin/y` regression test.
7. **P1-1** Add trusted-proxy client-IP resolution; re-key every limiter; add a per-session component to `oauth_start`.
8. **P1-2** Add per-IP registration and login limits on top of the per-identity ones.
9. **P1-10** Send only the masked recharge code to Telegram.

**Phase 4 — operability (must land before real users, not after)**
10. **P1-5** Schedule backups + off-host copies; run and record one restore drill.
11. **P1-6** Wire a real metric sink and error reporter; add frontend error reporting; add an uptime check with a paging destination.
12. **P1-7** Extend the scheduler to dispatch due campaigns, rebuild projections, and run `clearsessions`.
13. **P1-9** Refuse to publish a plan version with no entitlement rules; fix the demo seed.

**Phase 5 — product honesty (low risk, high trust impact)**
14. **P2-1** Gate or relabel `/store` and the fabricated LOCK balance.
15. **P2-2** Wire or relabel the demo quiz path.
16. **P2-4** Visibly disable unconfigured OAuth providers.
17. **P2-3** Translate the student-facing error/auth surfaces (`ErrorBoundary`, `ForbiddenState`, `TokenActionPage`, sidebar streak card).

**Phase 6 — remaining P2**
18. P2-5 (email in localStorage), P2-6 (cleanup jobs — folds into #12), P2-7 (search contract — folds into #2), P2-8 (legal content + Arabic), P2-9 (CSRF cookie lifetime), the nginx `52m` vs 100 MB audio mismatch, HSTS `max-age`, CSP `report-uri`.

**Phase 7 — regression and real-device verification (gate for launch sign-off)**
19. Re-run the full pipeline: `pytest`, `ruff`, `mypy`, `lint`, `typecheck`, `test`, `build`, `check:bundle`, `playwright test`, `playwright test --project=webkit-focus`, plus the containers job.
20. Execute `FOCUS_WORKSPACE_REAL_DEVICE_CHECKLIST.md` on **real iOS Safari and real Chrome Android**: pinch focal point, pan arbitration, drawing latency, annotation persistence across reload, PWA install, home-screen launch, offline launch, and upgrade-after-deploy.
21. Re-verify the four end-to-end journeys not covered live in this audit: expired subscriber, grace period, suspended user, and full manual-payment review.

---

## Appendix — Audit Environment

- Backend: `config.settings.e2e` (SQLite), seeded with `manage.py seed_demo`, served at `127.0.0.1:8010`.
- Frontend: Vite dev server at `127.0.0.1:5052`, proxying `/api/v1` to the backend above.
- Accounts used: seeded `admin@lockin.local`, `creator@lockin.local`, `student@lockin.local`; plus two accounts registered and verified through the public API during the audit (`audit.newuser@example.com`, `audit.second@example.com`).
- Test data created during the audit (8 `spamN@example.com` registrations, one discussion, one quiz attempt, one bookmark, one managed file) lives only in the disposable audit database.
- **No application source code, configuration, or test file was modified.** The only files written were this report and scratch files outside the repository. One exception to disclose: the gitignored local dev database `backend/e2e.sqlite3` was overwritten with a freshly migrated + `seed_demo` copy so the running server and the shell agreed on one dataset. Regenerate it at any time with `DJANGO_SETTINGS_MODULE=config.settings.e2e python manage.py migrate && python manage.py seed_demo`.
- Playwright left ~87 `frontend/test-results/` directories (gitignored) from the failing run; they can be deleted.
- A pre-existing, unrelated Python process was found listening on port 8000; the audit backend was deliberately started on 8010 to avoid touching it.
