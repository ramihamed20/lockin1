# Dentify Independent Second-Opinion Pre-Launch Audit

**Audit date:** 2026-08-31 (Africa/Tripoli)  
**Repository:** Dentify-Rebuild  
**Reviewed revision:** \`4f056408ae26c6564c97373bf1eeaf50ae2be4ef\` on \`codex/phase-11-production-readiness\`  
**Final launch verdict:** **NO-GO**

This is a read-only, evidence-led second opinion. I did not alter product source code. I created only disposable audit artifacts under \`audit-artifacts/\` and this report. The review covered the repository, the first audit, targeted source inspection, a real service-level content lifecycle dry run, backend/frontend gates, dependency and migration checks, build output, and Chromium/WebKit test execution.

The working tree was already unusually large and mutable: 161 tracked files differed from HEAD before this report was written, plus numerous untracked product and audit files. Audit #1 and this audit point to the same committed HEAD, but the exact dirty snapshot used by Audit #1 is not reconstructible from Git. Therefore, “changed since Audit #1” below distinguishes verifiable committed changes from current-state observations and does not pretend that file timestamps prove semantic equivalence.

## 1. Executive Summary

Dentify is **not ready for production launch**.

The most important result is narrower, but more serious, than the headline in Audit #1:

- One original P0 is fully confirmed: production requires uploaded content to be marked \`CLEAN\`, yet the repository contains no production scanner, queue consumer, or controlled operator override that can ever set that state. The intended upload-to-publish workflow dead-ends.
- The original “content/Focus is only a static mock” P0 is overstated. A substantial, permission-aware backend content, question, quiz, search, Focus-document, annotation, and lifecycle pipeline exists and works in a disposable dry run once scan state is simulated. However, the normal student Materials journey and the routed Lock-In experience are still not wired to that real pipeline. That is a **P1 launch blocker**, not a second P0.
- A new P1 confidentiality/revocation defect was reproduced: an entitled student can still download a superseded private PDF after replacement and can still download the current private PDF after the learning object is unpublished. List, detail, and search visibility are correctly revoked; the file authorization policy is not.
- All major release-gate families are not green. Backend tests, frontend type checking, migration drift, strict Python dependency audit, Ruff checks/formatting, mypy, and the full browser suite fail. Unit coverage is generally strong, and the production frontend build and bundle budget pass.
- Production operations remain incomplete: no scheduled backups, restore verification, campaign dispatch, cleanup jobs, real metrics/error reporting/alerting, or demonstrated deployment/rollback target.
- Auth, session, payment state transitions, content permissions, file validation, PWA cache policy, and admin auditability contain several strong controls. Those strengths reduce some exploit likelihood, but they do not compensate for the P0, stale-file authorization, red release gates, and missing operational controls.

**Blocking counts in this second opinion:** 1 confirmed P0; 16 P1-labelled launch blockers (11 original P1s, the reclassified P0-2, and 4 newly identified P1s). Several overlap operationally and should be fixed as grouped workstreams rather than treated as 16 unrelated projects.

## 2. Independent Launch Verdict

**NO-GO.**

This is not a conditional “go if watched closely.” A real creator cannot complete the mandatory clean-upload publish path without manually mutating database state. Even if that were bypassed, an authorized user can retain access to private file bytes after replacement or unpublication, the real student content/Focus path is incomplete, the configured CI gates cannot pass, and the production operating model lacks backups and alerting.

Minimum conditions to reconsider the verdict:

1. Implement and prove the malware/file-scan state transition, including failure, timeout, quarantine, retry, and operator procedures.
2. Fix private file authorization so replacement, unpublish, archive, entitlement expiry, and account changes revoke byte delivery immediately and consistently.
3. Wire the real backend content hierarchy and server-backed Focus experience into the ordinary student journey, then remove demo-only content.
4. Make every required CI/release gate green, including migrations, dependency policy, backend tests, typecheck, and meaningful browser coverage.
5. Schedule and observe backups, restore verification, notification campaigns, session/auth cleanup, and subscription lifecycle processing.
6. Configure production monitoring, error reporting, alerts, incident ownership, secrets, SMTP, OAuth, PostgreSQL, TLS, and rollback in a real staging/production-like environment.

## 3. What Changed Since Audit #1

### Verifiable repository state

- Audit #1 and this audit reference the same committed HEAD: \`4f056408ae26c6564c97373bf1eeaf50ae2be4ef\`.
- There is therefore **no committed delta** to attribute to a remediation effort between the two reports.
- The dirty working snapshot is extensive and cannot be reconstructed historically. Current test collection is 283 backend tests versus 281 reported in Audit #1, which itself proves that “same HEAD” does not mean “same reviewed files.”

### Current-state differences or refinements

- The real backend content pipeline was exercised end to end rather than inferred from UI screenshots. It is materially more complete than Audit #1 credited.
- The P0-2 rationale is reclassified: demo content is real cleanup debt, but the backend pipeline is not a mock. The blocking defect is integration/routing, now P1.
- A stale private-file authorization flaw after replace/unpublish was newly reproduced.
- Migration drift was newly detected.
- Current Python dependency versions now fail the repository’s strict security policy; current frontend production dependencies pass their audit, while the full dev/build graph does not.
- Unconfigured OAuth controls now appear disabled and visually muted; Audit #1’s P2 on enabled-looking buttons is substantially resolved.
- Chromium results are unchanged in practical terms: 137 total, 87 failed, 46 passed, 4 skipped. WebKit reaches the same stale precondition and cannot verify Focus behavior.

No original P0/P1 can be marked fixed based on the current evidence.

## 4. P0/P1 Verification Table

| Original ID | Original Severity | Second Reviewer Status | New Severity | Reason |
|---|---:|---|---:|---|
| P0-1 | P0 | **CONFIRMED** | P0 | Production requires \`CLEAN\`; no production writer/scanner/override exists. Upload succeeds as \`PENDING\`, publish is rejected. |
| P0-2 | P0 | **PARTIALLY CONFIRMED / REFRAMED** | P1 | Static demo surfaces remain, but a substantial real backend pipeline works. The blocker is missing normal-student integration and routed server-backed Focus, not total absence of a pipeline. |
| P1-1 | P1 | **CONFIRMED** | P1 | The limiter keys raw \`REMOTE_ADDR\`; behind the edge proxy clients collapse into a shared bucket unless trusted proxy resolution is added. |
| P1-2 | P1 | **CONFIRMED WITH WORDING CHANGE** | P1 | Login/register are not literally unthrottled, but only a per-(email, IP) bucket exists; one source can spray many identities. |
| P1-3 | P1 | **CONFIRMED** | P1 | Backend gate is red: 280 passed, 1 failed, 2 skipped. Failure reflects a stale/contradictory search-count contract, not measured query slowness. |
| P1-4 | P1 | **CONFIRMED** | P1 | Frontend typecheck exits 2 with four errors. |
| P1-5 | P1 | **CONFIRMED** | P1 | Backup and verification scripts exist, but no scheduler, off-host copy proof, alert, or demonstrated restore exists. |
| P1-6 | P1 | **CONFIRMED** | P1 | Production observability defaults to no-op metric and error sinks; no alert routing or frontend error reporting is configured. |
| P1-7 | P1 | **CONFIRMED** | P1 | Due-campaign command exists but no deployed scheduler invokes it. |
| P1-8 | P1 | **CONFIRMED** | P1 | Entitlement bypass uses substring matching; crafted \`subject_key\` path values can match \`/admin/\` or \`/operations/\`. |
| P1-9 | P1 | **CONFIRMED** | P1 | A plan version can be published with an absent/empty entitlements array. |
| P1-10 | P1 | **CONFIRMED** | P1 | Manual recharge codes and customer identity are sent in plaintext to Telegram; the privacy/policy surface does not disclose it. |
| P1-11 | P1 | **CONFIRMED AS A RELEASE-TEST DEFECT** | P1 | 87/137 Chromium tests fail, largely before behavior is exercised due to stale fixtures/contracts. The suite currently protects neither release confidence nor Focus compatibility. |

## 5. Confirmed P0

### P0-1 — The production file lifecycle has no path to \`CLEAN\`

**Status:** Confirmed without downgrade.  
**Actual severity:** P0.  
**Launch blocker:** Yes.

**Evidence**

- \`backend/config/settings/production.py:168\` makes a clean scan mandatory in production.
- \`backend/apps/files/services.py:124-140\` creates an uploaded managed file in a pending scan state.
- \`backend/apps/files/views.py:90-115\` permits private delivery only when clean.
- \`backend/apps/content/services.py:178-198\` refuses publication unless the file is clean.
- \`backend/apps/files/admin.py:18-24\` exposes scan status as read-only.
- Repository-wide review found test helpers that mark files clean, but no production scanner, asynchronous worker, command, webhook, or controlled operator transition that does so.

**Reproduction**

1. Upload a valid PDF through the creator API.
2. Observe HTTP 201 and scan status \`PENDING\`.
3. Attempt to publish a learning object using the file.
4. Observe HTTP 400; no partial sheet/version is committed.

The disposable dry run reproduced these exact results. It then set \`CLEAN\` directly only to isolate and test downstream behavior. That mutation is an audit technique, not a viable production process.

**Impact**

The intended creator workflow cannot publish any newly uploaded production file. Weakening the gate would create a different P0 by allowing unscanned user-supplied content into a paid student reader. This needs a real scanner and state machine, not a configuration toggle.

**Disagreement with Audit #1:** None.

## 6. Confirmed P1

### P1-1 — Client throttling collapses behind the reverse proxy

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

\`backend/apps/accounts/views.py:134-137\` passes raw \`request.META["REMOTE_ADDR"]\` into \`auth_attempt_fingerprint\`, and \`backend/apps/accounts/services.py:411-414\` hashes that value into the rate key. Nginx forwards client-chain headers, but the application does not resolve a trusted client IP from a constrained proxy chain. In the production topology Django sees the internal proxy address, so unrelated users share a rate bucket. A burst from one user can deny service to everyone in the same bucket; alternatively, changing code later to trust arbitrary forwarded headers could create spoofing. Fix with an explicit trusted-proxy model and tests for direct, single-proxy, multi-hop, and spoofed headers.

### P1-2 — Credential spraying and registration flooding lack a source-wide bucket

**Status:** Confirmed with wording change. **Severity:** P1. **Blocker:** Yes.

The endpoints do have a per-(normalized identity, IP) control, so “unthrottled” is inaccurate. The problem is that no independent per-source or broader anomaly bucket limits attempts spread over many email addresses. Reproduction is to rotate the submitted email while holding the source address constant; every pair starts a fresh allowance. Add layered per-account, per-source, velocity, and global safety controls with care for carrier NAT and IPv6 aggregation.

### P1-3 — Backend release gate is red

**Status:** Confirmed. **Severity:** P1 release gate. **Blocker:** Yes.

Command: \`LOCKIN_TEST_USE_SQLITE=true backend/.venv/Scripts/python.exe -m pytest\`.

Result: **280 passed, 1 failed, 2 skipped; 84.99% coverage; exit 1**. The failure at \`backend/platform_core/tests/test_performance.py:56\` expects a search count of 100 while the API intentionally reports a displayed/capped count of 12. This is a test/API-contract contradiction rather than evidence of slow queries. The release problem remains: a required gate is knowingly red, and the search count/pagination contract is unclear.

### P1-4 — Frontend type safety gate is red

**Status:** Confirmed. **Severity:** P1 release gate. **Blocker:** Yes.

\`pnpm run typecheck\` exits 2 with four errors:

- \`frontend/src/api/learning.js:65\`: request \`signal\` inference mismatch.
- \`frontend/src/components/search/GlobalSearch.jsx:117\`: signal type mismatch.
- \`frontend/src/components/search/GlobalSearch.jsx:271\`: CSS custom property not accepted by the inferred style type.
- \`frontend/src/components/shared/UserAvatar.jsx:37\`: arbitrary string passed where the image loading union is required.

The production build succeeds because Vite transpilation is not the same gate as static type checking.

### P1-5 — Backups are tooling, not an operating system

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

Backup and verification scripts are thoughtful, but no production Compose service, cron/systemd job, managed backup policy, off-host destination, retention enforcement, failure alert, or successful restore record is present. A script that nobody schedules does not establish recoverability.

### P1-6 — Metrics, error reporting, and alerting are no-ops

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

The code exposes useful interfaces and structured logs, but defaults to \`NoOpMetricSink\` and \`NoOpErrorReporter\`. No concrete provider, frontend global error reporting, alert thresholds, paging route, dashboard, or runbook linkage is configured. Production failures in checkout, file delivery, OAuth, mail, scanning, and schedulers could persist without detection.

### P1-7 — Scheduled notification campaigns never dispatch

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

\`backend/apps/admin_control/management/commands/dispatch_due_notification_campaigns.py\` implements dispatch. \`backend/apps/subscriptions/management/commands/run_subscription_scheduler.py\` invokes only subscription lifecycle processing, and production Compose schedules neither the campaign command nor a general job runner. A campaign can be created and become due but will not send by itself.

### P1-8 — Paid entitlement can be bypassed through a path parameter

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

\`backend/apps/entitlements/access_permissions.py:35\` exempts paths containing \`/operations/\`, \`/admin/\`, and similar substrings. \`backend/apps/review/urls.py:20\` accepts \`<path:subject_key>\`. A crafted subject key containing an exempt-looking segment makes the request path pass the substring check. Object ownership still limits cross-user exposure, but an unsubscribed user can reach their paid review data. Match named routes or resolved namespaces, never arbitrary substrings of user-controlled paths.

### P1-9 — A plan version can publish without entitlements

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

\`backend/apps/admin_control/services.py:1060\` iterates \`payload.get("entitlements", [])\`, and publication proceeds at approximately line 1071 without requiring a nonempty entitlement set. Reproduce by publishing a syntactically valid plan payload with the property omitted or empty. The result is a commercially published plan that grants no usable paid capability, producing broken purchases and support incidents.

### P1-10 — Telegram receives plaintext recharge secrets and customer identity

**Status:** Confirmed. **Severity:** P1. **Blocker:** Yes.

\`backend/apps/payments/manual_services.py:234-240\` sends the normalized recharge code plus user identity into the Telegram integration. The database path is comparatively strong—encrypted storage, digests, masking, audit events—but the outgoing Telegram message creates a new plaintext copy controlled by a third-party account and retention model. Current legal/privacy pages do not explain that transfer. Remove the code from messages, use an internal opaque reference, minimize identity, restrict access, define retention, and obtain product/legal approval.

### P1-11 — Browser release coverage is materially broken

**Status:** Confirmed as a release-test defect. **Severity:** P1. **Blocker:** Yes.

Current Chromium run: **137 total; 46 passed; 87 failed; 4 skipped**. Many failures wait for a \`Normal Study\` control that never appears. Error contexts show stale API mocks, including a subscription response without the newly required expiration and test stubs that explicitly return “Not used by this visual test.”

WebKit project collection contains 62 tests. A bounded run stopped after the first 60-second failure at the same \`Normal Study\` precondition; three in-flight tests were interrupted. This does **not** prove a WebKit product bug. It proves the suite cannot reach the behavior it claims to protect. Repair fixtures/contracts first, then run the complete Chromium and WebKit matrices.

### Reclassified P1 — Real content and server-backed Focus are not the normal student journey

**Status:** Partially confirmed from original P0-2. **Severity:** P1. **Blocker:** Yes.

The root \`/materials\` route still reads \`MATERIAL_CATALOG\` from \`frontend/src/lib/materialCatalog.js\` through \`frontend/src/pages/Materials.jsx\`. Demo Questions and a public demo PDF remain. Real server-backed material sheet components exist under object-specific routes, and global search can reach real published objects, but removing the demo catalog leaves no complete hierarchy/navigation on the default Materials page.

\`LearningObjectStudy.jsx\` provides secure PDF reading, progress, bookmark, and discussion actions but no route into server-backed Focus. \`LockInMode.jsx\` is substantial and server-backed; however, \`frontend/src/App.jsx:430-431\` routes \`/lock-in\` and \`/lock-in/:sessionId\` to \`LockInComingSoon\`. The user-visible launch flow therefore does not expose the implemented experience coherently.

## 7. P2

The following are important but do not independently outrank the P0/P1 blockers:

1. **Upload temporary-storage exhaustion and size mismatch.** The edge tmpfs is 64 MiB, Nginx can buffer request bodies to \`/tmp\`, and the edge accepts bodies up to 52 MiB. Two near-limit concurrent uploads can exhaust the volume. Backend audio policy allows up to 100 MiB, which the edge cannot pass.
2. **No media quota, capacity alert, or orphan-blob reaper.** Object storage writes are not transactional with the database; failures after a write can leave unreferenced blobs.
3. **No explicit CPU, memory, or PID bounds in production Compose.** A runaway process can degrade all colocated services.
4. **Optional high-impact secrets are passed as environment values.** Google/Apple credentials and Telegram tokens should use the same file/secret pattern already available for core secrets.
5. **OAuth does not use PKCE.** The implementation has signed one-time state, browser binding, OIDC nonce, exact HTTPS redirects, issuer/audience verification, and verified-email checks; PKCE is still recommended defense in depth.
6. **Frontend dev/build dependency graph has advisories.** Production dependencies pass \`pnpm audit --prod --audit-level=high\`; the full graph reports 10 advisories (1 moderate, 9 high) in transitive tooling such as brace-expansion, fast-uri, js-yaml, and nanoid.
7. **Published quiz snapshots remain startable after a source question is retired.** This may be intended immutable-version behavior, but the operator meaning of “retire” is ambiguous when a newly created attempt can still serve the snapshot.
8. **The Store presents fake currency/cart behavior.** USD-looking top-ups and local LOCK balances can damage trust if visible at launch without an explicit demo label.
9. **Hard-coded English remains in student and operator paths.** Examples include token action, sessions, content administration, and parts of Lock-In.
10. **The remembered email address remains in localStorage.** It is not an auth token, but it exposes a previous user’s identity on a shared device.
11. **Expired Django sessions and auth-attempt records have cleanup commands but no schedule.**
12. **Search exposes a capped/misleading count and no complete pagination contract.**
13. **Legal pages remain incomplete and English-only.** They omit or underspecify OAuth providers, Telegram processing, payment operations, retention, deletion, and support/escalation contacts.
14. **CSRF cookie lifetime is one year.** This is not a direct bypass, but it should be consciously aligned with the session and device-risk policy.
15. **The PWA install prompt can become a full-screen first-visit interruption.** Treat this as a measured conversion/product decision.
16. **All responses are marked noindex.** This may be intentional for a private learning app, but it should be an explicit launch decision.

## 8. Expected Pre-Launch Cleanup

These items are real work, but they should not be misreported as proof that the backend pipeline does not exist:

- Remove \`frontend/src/lib/materialCatalog.js\`, the public demo PDF, demo question bank, and IndexedDB-only demo annotation workspace after the real student route is complete.
- Replace all seed/demo identities, products, balances, charts, activity, and placeholder community content with empty states or controlled staging fixtures.
- Hide or label the Store until monetary semantics and checkout paths are real.
- Translate the remaining launch-critical student, admin, and legal strings.
- Remove test-only and launch-review visual pages from production navigation.
- Confirm every icon, avatar, manifest image, OpenGraph asset, and legal link uses launch assets and domains.

Demo deletion should happen **after** the real hierarchy and Focus entry points are verified; deleting it first would create a blank or fragmented student journey.

## 9. Findings Missed by Audit #1

### SO-P1-01 — Superseded and unpublished private PDFs remain downloadable

- **Severity:** P1
- **Area:** Content authorization / private file delivery
- **Evidence:** \`backend/apps/content/policies.py:45-49\` filters \`version__published_for__archived_at__isnull=True\` but does not require \`version__published_for__isnull=False\` or that the file belongs to the object’s current published version. With the left join, an unpublished or historical version has a null related row whose \`archived_at\` also appears null.
- **Reproduction:** Publish clean PDF A; verify entitled student receives A (200). Replace with clean PDF B; the same student still receives A (200). Unpublish the learning object; object detail and search disappear, but B still returns 200.
- **Affected files/routes:** \`backend/apps/content/policies.py\`; private managed-file delivery endpoint; learning-object replace/unpublish lifecycle.
- **Impact:** Access revocation is inconsistent. Private paid bytes survive replacement and unpublication and may remain reachable from browser history, logs, bookmarks, or copied URLs.
- **Fix:** Authorize only a non-archived object whose non-null current published version references the requested file, plus any explicitly documented historical-access rule. Add tests for replace, unpublish, archive, entitlement expiry, account lock/delete, and concurrent version changes.
- **Launch blocker:** Yes.

### SO-P1-02 — Model changes are missing a migration

- **Severity:** P1 release gate
- **Area:** Database schema/release
- **Evidence:** \`manage.py makemigrations --check --dry-run\` exits 1 and proposes \`apps/files/migrations/0002_alter_managedfile_kind.py\`.
- **Reproduction:** Run the command against the current tree.
- **Affected files:** \`backend/apps/files/models.py\`, existing files migrations, production release workflow.
- **Impact:** The checked-in migration graph does not describe the checked-in model state. Releases can drift between fresh and upgraded databases, and CI cannot pass.
- **Fix:** Review the intended model change, generate the migration, inspect SQL/locking behavior, and test both fresh install and upgrade on PostgreSQL.
- **Launch blocker:** Yes.

### SO-P1-03 — The configured backend CI policy fails before product tests

- **Severity:** P1 release/supply-chain gate
- **Area:** CI, dependencies, static analysis
- **Evidence:** \`.github/workflows/ci.yml\` requires strict dependency audit, Ruff check and format, mypy, migration check, Django checks, tests, release, and preflight. Current results: strict \`pip-audit\` exits 1; Ruff check exits 1 at \`backend/apps/accounts/views.py:496\`; Ruff formatting reports 19 files; mypy reports 13 errors across 9 files; migration check exits 1.
- **Reproduction:** Run the exact workflow commands in the project virtual environment.
- **Affected files:** \`backend/pyproject.toml\`, dependency lock/input, listed Python files, CI workflow.
- **Impact:** The repository advertises a fail-closed quality/security policy that the current release cannot satisfy. Bypassing it would normalize unreviewed schema, dependency, type, and formatting drift.
- **Fix:** Upgrade and re-resolve dependencies, assess reachable advisory surfaces, correct static-analysis errors, commit the intended migration, and keep policy exceptions narrow, documented, expiring, and advisory-specific.
- **Launch blocker:** Yes.

The strict Python audit reports advisory records affecting Django 5.2.16 and cryptography 46.0.5. Django 5.2.17 is the patched 5.2 release for the reported issue. Cryptography records include aliases/duplicates and APIs not evidently used by Dentify; this is not evidence that nine exploitable app vulnerabilities were reproduced. It is evidence that the configured strict dependency gate is not green.

### SO-P1-04 — The product’s own account-deletion launch requirement is unimplemented

- **Severity:** P1 governance/privacy
- **Area:** Account lifecycle and data rights
- **Evidence:** \`docs/PRODUCT.md\` requires a deletion request/confirmation flow pending final retention policy and marks owner/legal decisions as production prerequisites. Current operator “soft delete” changes status/\`is_active\` and invalidates sessions but retains identity, learning data, annotations, payment history, and related records. No user request, verification, export/anonymization/erasure orchestration, retention schedule, or completion record was found.
- **Reproduction:** Disable/soft-delete a user and inspect retained related rows and user-visible settings; there is no end-user deletion workflow.
- **Affected files/routes:** Account settings, accounts services/models, admin user controls, privacy/legal documentation, related user-owned models.
- **Impact:** The implementation does not meet the repository’s own launch definition and cannot give support or users a consistent answer about deletion.
- **Fix:** Obtain the product/legal retention matrix, distinguish disable from deletion, implement verified request and status tracking, anonymize/delete eligible data, preserve only explicitly required records, and test cascading effects and restore/backups.
- **Launch blocker:** Yes under the project’s documented launch requirements. This is not a jurisdiction-specific legal conclusion.

### SO-P2-01 — Edge upload buffering can exhaust its tmpfs

- **Severity:** P2
- **Area:** Availability / upload infrastructure
- **Evidence:** \`compose.production.yaml:225-227\` gives the edge a 64 MiB tmpfs; Nginx body buffering can write to \`/tmp\`; \`nginx/default.conf:19\` permits 52 MiB bodies. Backend audio policy permits 100 MiB.
- **Reproduction:** Concurrently upload two near-limit bodies through the edge while observing tmpfs capacity; separately try a legitimate backend-allowed audio body over 52 MiB.
- **Affected files/routes:** Production Compose, Nginx config, upload endpoints and size policy.
- **Impact:** Low-cost disk exhaustion and inconsistent client behavior.
- **Fix:** Align limits end to end, give body temp storage deliberate capacity/isolation, add concurrent-upload tests, quotas and alarms, and only disable buffering if the upstream is proven to stream safely.
- **Launch blocker:** No by itself; fix before public upload scale.

### SO-P2-02 — Media lifecycle lacks quotas, capacity alarms, and orphan reconciliation

- **Severity:** P2
- **Area:** Storage operations
- **Evidence:** Managed-file creation writes storage within a database transaction, but blob storage cannot roll back with SQL. No per-user/system quota, disk/object-store alarm, or job to reconcile unreferenced blobs was found.
- **Reproduction:** Force a database failure after a successful storage write and inspect storage for an unreferenced object.
- **Affected files:** \`backend/apps/files/services.py\`, storage configuration, operations/schedulers.
- **Impact:** Slow capacity leaks and eventual upload outages.
- **Fix:** Add compensating deletion, periodic reconciliation with a safety age, quotas, capacity dashboards and alerts.
- **Launch blocker:** No.

### SO-P2-03 — Production services have no explicit resource bounds

- **Severity:** P2
- **Area:** Deployment resilience
- **Evidence:** Production Compose defines isolation/read-only controls but no enforceable CPU, memory, or PID budgets for application services.
- **Reproduction:** Apply memory/CPU pressure in staging and observe cross-service degradation.
- **Affected file:** \`compose.production.yaml\`.
- **Impact:** One runaway worker, PDF workload, or dependency can destabilize the host.
- **Fix:** Load-test first, then set limits/reservations and alert on saturation/OOM/restarts.
- **Launch blocker:** No by itself.

### SO-P2-04 — High-impact optional credentials bypass the existing secret-file pattern

- **Severity:** P2
- **Area:** Secrets
- **Evidence:** Core secrets use file-backed helpers, while Google/Apple and Telegram values are passed directly through Compose environment variables.
- **Reproduction:** Inspect container environment and process/config diagnostics in a staging deployment.
- **Affected files:** \`compose.production.yaml\`, environment examples, settings secret loader.
- **Impact:** Broader accidental disclosure surface.
- **Fix:** Extend the existing \`*_FILE\`/secret mechanism, define rotation, and avoid secrets in support dumps.
- **Launch blocker:** No unless production has no acceptable secret manager.

## 10. Findings I Disagree With

### Original P0-2 is too broad and too severe

I disagree that “the paid study surface is only a static mock over a public PDF” accurately describes the repository. Static demo surfaces are visible, but the backend contains real, permission-aware content versioning, review/publish/archive, private delivery, discovery indexing, question import and quiz snapshots, Focus documents, annotations, and sessions. The dry run exercised them.

I agree with the user-facing conclusion that the launch journey is incomplete. The accurate blocker is P1: real Materials navigation and routed server-backed Focus are not coherently connected.

### “Unthrottled” registration/login is imprecise

There is a pair bucket. The high-risk gap is the absence of an independent source-wide/velocity layer, which enables spraying many identities.

### The backend failing test is not a proven performance regression

The test is named as a performance test, but the observed failure is a count-contract assertion. It should still block release because the gate is red and the API contract is ambiguous.

### The browser failures do not prove 87 distinct product regressions

Most fail at a shared setup assumption. This makes the suite unusable as a release gate; it does not prove that each named gesture, viewport, or recovery behavior is broken.

### Unconfigured OAuth buttons are substantially improved

The current \`AuthPage.jsx\` disables unavailable providers and \`auth.css\` visibly mutes them. A tooltip-only explanation may still be weak on touch devices, but the original “enabled-looking dead controls” characterization is no longer fair.

### Demo content is expected cleanup, not automatically a production defect

The supplied second-opinion brief explicitly says demo data will be removed before real content load. The defect is any dependency on that demo after removal, not its temporary existence during launch preparation.

## 11. Security Re-Assessment

### Strong controls observed

- Django/DRF session authentication uses secure, HttpOnly, \`__Host-\` cookies, SameSite Lax, CSRF enforcement, and server-side session invalidation.
- OAuth state is signed, one-time, database-digested, browser-bound, and row-locked; OIDC nonce, issuer, audience, signature, verified-email, exact redirect, and locked-account checks are present.
- Upload validation checks extension, declared MIME, file signatures, size, and checksum. Avatars reject SVG. Private responses use no-store and nosniff controls and support bounded range delivery.
- No dangerous \`dangerouslySetInnerHTML\`, \`eval\`, or obvious browser token storage was found.
- Payment services use row locks, idempotency, code digests, encrypted database fields, masked display, status transitions, and audit events.
- Search filters results by permissions, and content index updates generally track publish/archive lifecycle.
- PWA service-worker rules avoid caching API/auth/private PDF responses and focus on public shell/assets.

### Blocking or high-priority weaknesses

- Missing scan executor (P0).
- Stale private-file access after replace/unpublish (P1).
- Proxy-collapsed rate limiting and insufficient spray layering.
- Substring entitlement bypass.
- Empty-entitlement plan publication.
- Plaintext recharge secret/customer identity sent to Telegram.
- Dependency, schema, typing, test, and browser release gates fail.
- No concrete monitoring/alerting or backup operating loop.
- No account deletion/retention implementation matching the project’s own launch requirements.

### Security interpretation

The codebase is not “insecure everywhere.” Several high-value mechanisms show good design intent. The risk is discontinuity: strong controls around a workflow can be defeated by one lifecycle edge (stale file authorization), an unfinished operational transition (scan state), or an untrusted input class (substring path exemption). Launch security should be evaluated by complete lifecycle and failure behavior, not by the presence of individual security utilities.

## 12. Real Content Pipeline Dry Run

A disposable service/API dry run was executed with:

- Script: \`audit-artifacts/second_opinion_dry_run.py\`
- Database: \`audit-artifacts/second-opinion-20260831-014106.sqlite3\`
- Media root: \`audit-artifacts/media-20260831-014106/\`
- Result: **43 expected checks passed; 2 security assertions failed**

The two failures are the stale-file authorization finding, not harness crashes.

### Verified behavior

1. Valid PDF upload returns 201 in \`PENDING\`.
2. Publication while pending returns 400 and is atomic.
3. After the audit manually simulates \`CLEAN\`, publication returns 201.
4. An entitled, verified student receives object detail, search result, and private PDF.
5. Anonymous and unverified users are denied.
6. Server-backed Focus document creation, annotation sync (revision 1), and Focus session creation succeed.
7. Metadata revision and republish succeed.
8. Replacement with a pending file is rejected; clean replacement succeeds.
9. Question JSON validation/import, publish, list, discovery, quiz version creation, attempt, submit, scoring, update, republish, and retirement work.
10. Answers remain hidden before submission; the submitted sample scores 100%.
11. Retired source questions leave discovery.
12. Unpublish removes object detail and discovery.
13. Unsafe HTTP DELETE of published/historical content is rejected.
14. A never-published draft can be permanently deleted and its blob is removed.

### Failed security assertions

- The superseded PDF returns 200 after replacement.
- The current PDF returns 200 after unpublication.

### Important semantic observation

A quiz snapshot created before source-question retirement remains startable afterward. This may be intentional immutable assessment-version behavior. Product and safety operators need an explicit “retire from future builds” versus “withdraw immediately from delivery” contract.

### Scope limits

The dry run used SQLite to isolate service behavior. It did not validate PostgreSQL locks, query plans, transaction isolation, production storage, scanner callbacks, Nginx ranges, or real browser PDF rendering.

## 13. Auth/OAuth/Session

### Assessment

Core session and OAuth implementation is stronger than the overall launch state:

- CSRF protection is applied to session-authenticated API writes.
- Secure cookie settings and session invalidation are present.
- Password reset, verification, and OAuth attempt state use bounded lifetimes and non-plaintext database tokens/digests.
- OAuth protects state replay and account-linking ambiguity.
- Policy acceptance is versioned and timestamped, including OAuth onboarding.

### Blocking work

- Fix rate limiting for trusted proxy topology and add layered anti-spray controls.
- Schedule deletion of expired Django sessions and stale auth/OAuth attempts.
- Prove live Google and Apple configuration, exact registered redirects, consent screens, secret rotation, provider outage behavior, and account-linking support paths.
- Add PKCE as defense in depth and test it.
- Remove remembered email from persistent storage or make the shared-device tradeoff explicit.
- Implement the documented account deletion workflow and retention matrix.

### Session conclusion

Static controls are credible; live identity-provider operation, source-IP handling, cleanup scheduling, and data lifecycle are not launch-ready.

## 14. Subscription/Payment

### Strengths

- Server time and row locking are used for subscription transitions.
- Idempotency and unique digests reduce double redemption and replay.
- Grace, cancellation, renewal, and lifecycle logic are substantially tested.
- Manual payment/recharge code database handling is encrypted/masked and audited.

### Blockers

- A plan can publish with no entitlements.
- The review endpoint entitlement exemption can be bypassed with a crafted path.
- Telegram receives plaintext recharge codes and identity.
- No real alerting covers failed payments, stuck manual reviews, lifecycle scheduler failures, or entitlement anomalies.
- The production scheduler covers subscription lifecycle but not all required jobs.

### Not proven

No real payment-provider settlement/reconciliation, chargeback, fraud, refund, financial reporting, or customer-support workflow was exercised. If launch relies only on manual Libyana/recharge operations, that scope must be explicit and the Telegram design must be changed.

## 15. Admin/Creator

### Verified

- Creator upload, version, publish, republish, replace, archive/unpublish, and safe deletion services exist.
- Pending scan blocks publication atomically.
- Historical/published records resist unsafe permanent deletion.
- Question import validation, publication, discovery, quiz snapshots, edits, and retirement exist.
- Admin actions generally create auditable events and services use transactions/locks.

### Blocking gaps

- No scanner completes uploads.
- Empty-entitlement plan publication is allowed.
- Notification campaigns have no scheduler.
- The default student hierarchy is not connected to creator-published content.
- “Retire” semantics for questions already captured in quiz versions need operator-safe language and an emergency withdrawal path.
- Several admin surfaces retain hard-coded English and placeholder/product-review behavior.

The admin/creator backend is not a mock; its last-mile automation and consumer integration are incomplete.

## 16. Database/Storage/Backup

### Database

- Production targets PostgreSQL 18 and uses separate owner/runtime roles, bounded connection lifetime, and statement/lock/idle-transaction timeouts.
- Services use atomic transactions, row locks, uniqueness, and idempotency in sensitive paths.
- Migration drift currently blocks release.
- PostgreSQL-specific concurrency, grants, migration locks, query plans, indexes under production volume, and restore compatibility were not exercised locally because Docker and \`psql\` were unavailable.

### Storage

- Private managed-file delivery has good response headers and validation but a critical lifecycle authorization defect.
- Local/volume storage is persistent in Compose.
- No demonstrated S3/object-storage durability, off-host replication, quota, orphan reconciliation, or capacity alarm exists.
- Edge temp capacity and upload limits are inconsistent.

### Backup

The repository has backup and verification scripts but no evidence of:

- an active schedule;
- encrypted off-host copies;
- defined RPO/RTO;
- retention enforcement;
- alerting on missed/failed jobs;
- periodic restore drills;
- application/media and database consistency;
- recovery of secrets/configuration;
- PostgreSQL point-in-time recovery.

Launch requires a timestamped restore record from production-like infrastructure, not only a successful dump command.

## 17. Deployment/Monitoring/Incident

### Deployment strengths

- Production Compose separates release, preflight, runtime backend, scheduler, database, and edge roles.
- Startup ordering, health/readiness, non-root/read-only containers, dropped capabilities, and owner/runtime database roles are well considered.
- Gunicorn and database timeouts are bounded starting values.
- Release/preflight commands are explicit.
- Nginx private routing and service separation are clearer than a development stack.

### Blocking gaps

- No concrete metrics, tracing/error provider, frontend reporting, dashboards, alerts, or on-call destination.
- No backup scheduler/restore proof.
- Campaign and cleanup schedulers are absent.
- No real deployment target, image registry evidence, TLS/certificate renewal, DNS, secret manager, smoke run, canary/blue-green procedure, or executed rollback record was available.
- Production services lack measured resource bounds.
- Local container build, Nginx config test, Compose rendering, and full release/preflight were not verified because Docker is unavailable.

### Incident readiness

Define incident ownership, severity levels, paging, customer communication, evidence preservation, credential rotation, payment/content takedown, restore, and post-incident review. Each high-risk workflow should emit actionable signals: scan stuck/failed, private-file authorization denial spikes, payment/recharge anomalies, OAuth failures, mail failures, scheduler lag, DB saturation, disk capacity, 5xx, and service-worker update errors.

## 18. PWA/Mobile/Focus

### PWA

The PWA implementation uses an inject-manifest service worker, version/update handling, legacy cache cleanup, manifest/icons, and public-asset caching. It does not deliberately cache API, auth, or private PDF traffic. That is the correct security direction. Build output precached 14 entries totaling approximately 964.65 KiB.

### Mobile and Focus

\`LockInMode.jsx\` and Focus components contain substantial gesture, annotation, persistence, accessibility, recovery, and responsive logic. However:

- the routed \`/lock-in\` experience is a coming-soon screen;
- the default Materials page is demo-backed;
- real learning-object study does not provide a coherent Focus entry;
- current Playwright fixtures prevent both Chromium and WebKit from proving behavior;
- physical iOS/Android, stylus, memory, large PDF, offline/update, and install-mode behavior were not tested.

### UI health score

Using the interface audit rubric:

| Dimension | Score (0-4) | Evidence |
|---|---:|---|
| Accessibility | 3 | Real semantic/tab/focus work exists, but browser a11y coverage is currently unreachable and full manual/device verification is absent. |
| Performance | 3 | Bundle budget passes and code splitting exists; main chunk warning, large CSS, PDF/device memory, and production profiling remain. |
| Responsive design | 3 | Extensive viewport/gesture intent and responsive CSS exist; current E2E cannot prove it and no physical-device run was performed. |
| Theming/token consistency | 2 | A design language is visible, but Focus/launch CSS contains extensive hard-coded colors, gradients, and parallel token vocabularies. |
| Anti-pattern control | 3 | The interface has a deliberate identity rather than generic generated UI, but placeholder/demo surfaces, heavy ornamental treatments, and route duplication remain. |
| **Total** | **14/20** | Promising implementation, insufficient launch proof and too much parallel styling debt. |

The design is not “AI slop”; it has recognizable product intent. The risk is fragmentation: the demo catalog, server-backed content, coming-soon route, legacy/reference Focus styling, and launch-readiness layer form parallel experiences. Consolidate after functionality is wired, using shared semantic tokens rather than a large final override layer.

## 19. Privacy/Policy

### Confirmed concerns

- Plaintext recharge code and customer identity are sent to Telegram without adequate product/privacy disclosure.
- Legal pages are incomplete, English-only, and do not fully describe OAuth providers, Telegram/manual payment operations, retention, deletion, subprocessors, support contacts, or incident handling.
- The product specification itself leaves retention/deletion decisions open, while the application implements only account disable/soft deletion.
- Remembered email persists on the device.
- Logs, backups, Telegram history, media, annotations, learning progress, audit events, and payment records need an explicit retention matrix and deletion/anonymization behavior.

### Required decisions

Before launch, the owner and qualified legal/privacy reviewer must approve:

- controller/contact identity and jurisdiction;
- lawful/product basis for every data category;
- provider/subprocessor inventory and transfer terms;
- retention by category, including backups and security logs;
- user access/correction/export/deletion process;
- minor/student considerations if applicable;
- payment and Telegram data minimization;
- cookie/session disclosure;
- incident and breach response.

This audit does not make jurisdiction-specific legal conclusions. It finds an implementation/documentation gap against the repository’s own stated launch prerequisites.

## 20. CI/Test Quality

### Gate matrix

| Gate | Result | Launch interpretation |
|---|---|---|
| Backend pytest with SQLite test setting | **FAIL** — 280 passed, 1 failed, 2 skipped, 84.99% coverage | Red required gate; search-count contract mismatch |
| Django \`check\` | **PASS** | Baseline configuration check only |
| Production \`check --deploy --fail-level ERROR\` | **PASS with 153 warnings** | Errors absent; schema-generation/HSTS warnings still require review |
| Migration drift check | **FAIL** | Missing \`files\` migration |
| Ruff check | **FAIL** | One E501 |
| Ruff format check | **FAIL** | 19 files would be reformatted |
| mypy | **FAIL** | 13 errors in 9 files |
| strict Python dependency audit | **FAIL** | Django/cryptography advisories under configured policy |
| Frontend lint | **PASS** | Good |
| Frontend typecheck | **FAIL** | Four errors |
| Frontend unit tests | **PASS** — 190 | Good unit baseline |
| Frontend production build | **PASS** | Vite/PWA build succeeds |
| Bundle budget | **PASS** | Main JS ~148.5 KiB gzip; CSS ~71.9 KiB gzip |
| Frontend production dependency audit | **PASS** | No known production dependency advisories at configured level |
| Full frontend dependency audit | **FAIL** | Dev/build transitive advisories |
| Chromium Playwright | **FAIL** — 46 pass, 87 fail, 4 skip | Shared stale fixtures invalidate release evidence |
| WebKit Focus | **NOT VERIFIED** | First test times out at same precondition; run stopped after first failure |
| Container build/Nginx/Compose/release/preflight | **NOT VERIFIED locally** | Docker unavailable |

### Test-quality interpretation

The unit suites cover a broad amount of business logic and the dry run validates many important transitions. The principal weakness is gate credibility:

- a test named “performance” asserts an unclear display count;
- browser fixtures do not evolve with subscription/API contracts;
- dozens of tests fail at one setup step and obscure the signal;
- WebKit collection exists but cannot reach behavior;
- CI asks for strict static and dependency quality that developers are not keeping green.

Repair shared fixtures first, fail fast on environment/contract setup, separate smoke/contract/visual/gesture suites, and require a small reliable cross-browser core before scaling the matrix.

## 21. External Research/References

The following current primary/authoritative references informed severity and remediation:

- [OAuth 2.0 Security Best Current Practice (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700.html) — PKCE, redirect and browser-flow guidance.
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) — layered validation, storage isolation, malware scanning, size/authorization controls.
- [OWASP Bot Management and Anti-Automation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html) — layered throttling and why a username/IP pair alone is insufficient.
- [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/) — upload, rate, execution, and capacity limits.
- [Django 5.2 deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/) — production settings, checks, HTTPS, logging, backups, and operational review.
- [Django session documentation](https://docs.djangoproject.com/en/5.2/topics/http/sessions/) — expired session records require operational cleanup.
- [Django 5.2.17 release notes](https://docs.djangoproject.com/en/5.2/releases/5.2.17/) — patched security release relevant to the current strict audit result.
- [PostgreSQL 18 backup and restore](https://www.postgresql.org/docs/18/backup.html) and [continuous archiving/PITR](https://www.postgresql.org/docs/17/continuous-archiving.html) — dump, physical, and point-in-time recovery models.
- [Nginx core request-body buffering directives](https://nginx.org/en/docs/http/ngx_http_core_module.html) — body buffer, maximum size, and temporary-file behavior.
- [Docker Compose resource configuration](https://docs.docker.com/reference/compose-file/deploy/) — CPU/memory/resource controls.
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) — secure context, lifecycle, and caching model.
- [PyCA cryptography GHSA-537c-gmf6-5ccf](https://github.com/pyca/cryptography/security/advisories/GHSA-537c-gmf6-5ccf), [GHSA-p423-j2cm-9vmq](https://github.com/pyca/cryptography/security/advisories/GHSA-p423-j2cm-9vmq), and [GHSA-g6cj-pr64-35w5](https://github.com/pyca/cryptography/security/advisories/GHSA-g6cj-pr64-35w5) — examples behind the current dependency-policy failure.

These references support control expectations. They do not replace exploitability analysis of Dentify’s actual reachable code.

## 22. NOT VERIFIED

The following must not be inferred as passing:

- Physical iPhone/iPad Safari, Android Chrome, installed standalone PWA, keyboard-only, screen-reader, pointer, touch, and stylus behavior.
- WebKit Focus behavior beyond reaching the broken shared test precondition.
- Large/complex PDFs, low-memory devices, long annotation sessions, offline recovery, update races, cache eviction, and multi-tab conflicts.
- Live Google/Apple developer-console settings, consent screens, registered redirects, key rotation, or provider outage behavior.
- Real SMTP/mailbox delivery, SPF/DKIM/DMARC, bounce handling, retry, deliverability, and suppression.
- PostgreSQL migrations, locks, concurrency, runtime grants, query plans, backup/restore, PITR, failover, and production load.
- Container images, Nginx configuration test, Compose render, release job, preflight job, or production health checks.
- Backup schedule, off-host encryption, retention, alerts, or completed restore drill.
- TLS certificates/renewal, DNS, hosting topology, registry, production secret manager, and network/firewall controls.
- Real metrics/error provider, paging destination, on-call process, incident exercise, or customer-status communication.
- Payment settlement, refund, reconciliation, fraud/abuse, and chargeback flows.
- Final privacy/legal approval, jurisdictional obligations, data-processing agreements, deletion/retention decisions, and backup erasure behavior.
- Executed rollback, zero/low-downtime migration behavior, or old-client/service-worker compatibility during deployment.

## 23. Launch Checklist

### P0/P1 product and security

- [ ] Implement production scanning and prove \`PENDING → CLEAN/REJECTED/FAILED\` lifecycle.
- [ ] Add quarantine, timeout, retry, operator override policy, alerting, and audit events for scans.
- [ ] Fix stale private-file access after replace, unpublish, archive, and entitlement/account changes.
- [ ] Replace substring entitlement exemptions with resolved route/permission rules.
- [ ] Require at least one valid entitlement before plan publication.
- [ ] Add independent source-wide and account-aware anti-spray controls behind a trusted-proxy IP model.
- [ ] Remove plaintext recharge secrets/identity from Telegram and approve minimized processing.
- [ ] Implement the documented deletion request, verification, retention, anonymization/erasure, and completion workflow.

### Real launch journey

- [ ] Make \`/materials\` load the real server hierarchy and creator-published objects.
- [ ] Provide a clear entry from a real learning object into server-backed Focus.
- [ ] Route \`/lock-in\` to the production experience or remove it from launch navigation.
- [ ] Remove static catalog/demo PDF/demo questions/local-only demo workspace after replacement is verified.
- [ ] Resolve quiz-question retirement versus published-snapshot withdrawal semantics.
- [ ] Hide or relabel fake Store behavior.
- [ ] Complete launch-critical Arabic/English content and legal copy.

### Release gates

- [ ] Commit and validate the missing migration on fresh and upgraded PostgreSQL.
- [ ] Upgrade/resolve Python dependencies and make strict audit green or document narrow temporary exceptions.
- [ ] Make Ruff check/format and mypy green.
- [ ] Resolve the backend search-count contract and make all backend tests green.
- [ ] Fix all four frontend type errors.
- [ ] Repair Playwright subscription/API fixtures and make Chromium and WebKit release suites green.
- [ ] Keep lint, unit, production audit, build, PWA generation, and bundle budget green.
- [ ] Build containers and execute Nginx, Compose, release, preflight, health, and smoke gates in staging.

### Operations

- [ ] Schedule subscription lifecycle, campaigns, session/auth cleanup, scan processing, storage reconciliation, and any mail retry jobs.
- [ ] Schedule encrypted off-host backups and alert on missed/failed jobs.
- [ ] Execute and record a full PostgreSQL + media + configuration restore against declared RPO/RTO.
- [ ] Configure concrete backend/frontend error reporting, metrics, dashboards, logs, traces where useful, and paging.
- [ ] Add measured service resource limits and upload/storage quotas/capacity alarms.
- [ ] Configure production secrets, SMTP, OAuth, TLS, DNS, registry, and key rotation.
- [ ] Run load, abuse, concurrency, and capacity tests on production-like PostgreSQL/storage.
- [ ] Execute deployment and rollback drills, including migration and old-PWA-client behavior.
- [ ] Run physical-device, accessibility, offline/update, large-PDF, and long-session Focus tests.
- [ ] Approve privacy, retention, deletion, payment, provider, and incident policies.

## 24. Recommended Fix Order

1. **Unblock safe content publication:** design and implement the scanner lifecycle without weakening the clean-file gate.
2. **Close stale byte access:** correct private-file authorization and add lifecycle revocation regression tests.
3. **Finish the real student journey:** server-backed Materials hierarchy, learning-object-to-Focus entry, production Lock-In route, then remove demos.
4. **Restore release-gate integrity:** migration, Python dependencies, Ruff/mypy, backend contract, frontend typecheck, shared Playwright fixtures, Chromium/WebKit.
5. **Close authorization/commercial gaps:** trusted-proxy throttling, layered anti-spray controls, route-based entitlement checks, nonempty plan entitlements.
6. **Resolve sensitive data governance:** remove Telegram secrets/identity, complete disclosures, implement deletion/retention.
7. **Build the operating loop:** schedules for campaigns/cleanup/backups/scans, restore drills, monitoring/alerts, resource/storage controls.
8. **Prove the release in a real environment:** PostgreSQL migrations/concurrency/load, SMTP/OAuth, containers/Nginx/TLS, deploy/rollback, physical mobile/PWA/Focus/accessibility.

Do not spend the first remediation cycle polishing demo visuals or chasing individual downstream Playwright gesture failures. The scanner, stale-file authorization, real route wiring, and shared gate prerequisites dominate launch risk.

## 25. Final Verdict

**NO-GO.**

Dentify has a meaningful application behind the demo shell and several security-conscious foundations. The second opinion is therefore not that the product must be rebuilt. It is that the final production chain is discontinuous at exactly the places where launch safety depends on continuity:

- content cannot naturally become clean and publishable;
- private bytes are not revoked with content lifecycle state;
- the real backend content/Focus capability is not the ordinary student route;
- the repository’s own release gates are red;
- backups, monitoring, schedulers, deletion, and real-environment proof are incomplete.

After the ordered P0/P1 work and a green staging release with restore, alerting, cross-browser, and device evidence, a new launch decision would be justified. On the current evidence, production launch would knowingly expose an unusable creator flow, stale paid-content access, unreliable release validation, and unowned operational failure modes.
