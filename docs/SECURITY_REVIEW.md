# Production Security Review

Last updated: 2026-07-19

Scope: Lock-in React/TypeScript frontend, Django/DRF backend, PostgreSQL contract, Nginx edge,
production Compose topology, CI gates, uploads, authentication, authorization, and commerce edge.

Method: repository-grounded review using the selected `security-best-practices` Skill for Django,
Python web servers, JavaScript/TypeScript, and React. Findings use stable IDs and distinguish fixed,
accepted, and launch-blocking residual risk.

## Finding summary

| ID | Severity | Status | Finding |
|---|---|---|---|
| SEC-001 | High | Fixed; scanner remains launch gate | Published/private files could lack clean scan evidence |
| SEC-002 | High | Fixed | Runtime database role could own DDL or mutate audit evidence |
| SEC-003 | Medium | Fixed | Duplicate registration could disclose account existence |
| SEC-004 | Medium | Fixed | Provider webhook route remained callable with no provider |
| SEC-005 | Medium | Fixed | Production settings and edge had development-safe defaults only |
| SEC-006 | Medium | Open launch blocker | No approved malware-scanning provider/workflow is installed |
| SEC-007 | Medium | Open launch blocker | Metrics/error sinks and alerts are intentionally unconfigured |
| SEC-008 | Low | Accepted with controls | CSP permits inline style attributes |
| SEC-009 | Low | Open tracked debt | Inherited OpenAPI schema generation emits 96 warnings |
| SEC-010 | Low | Accepted until domain validation | HSTS browser preload is intentionally disabled |

## SEC-001 - Clean-file evidence was not a production invariant

Severity: High

Status: Fixed, with SEC-006 residual launch gate

Rule: uploaded active content must be validated, quarantined, and served only after trusted approval.

Locations and evidence:

- `backend/apps/files/services.py:114` assigns `PENDING` when production requires a clean scan.
- `backend/apps/files/views.py:111` blocks quarantined/failed and every non-clean file in production.
- `backend/apps/content/services.py:186` blocks unsafe review/publish transitions.
- `backend/platform_core/management/commands/production_preflight.py:42` rejects already-published
  unsafe file evidence before the application starts.

Impact before fix: a structurally valid but malicious PDF/audio file could be published and later
delivered through the authorized private-file endpoint.

Remediation: make scan state fail closed across ingestion, publication, delivery, and preflight.
Tests cover pending creation, blocked delivery, blocked publication, and clean-state success.

False-positive notes: structural validation/checksum evidence is not malware evidence. The code does
not claim that it scans files; SEC-006 remains a launch blocker.

## SEC-002 - Application and migration database authority were not separated

Severity: High

Status: Fixed

Rule: runtime identities must have least privilege and append-only audit must be enforced below the
application layer.

Locations and evidence:

- `backend/platform_core/production/database.py:31` applies runtime grants only from PostgreSQL.
- `backend/platform_core/production/database.py:56` revokes update/delete/truncate on audit records.
- `backend/platform_core/management/commands/release.py:17` requires a distinct runtime role.
- `compose.production.yaml` runs release with the owner and backend/preflight with the runtime secret.

Impact before fix: a backend compromise or accidental code path could create/alter schema or erase
administrative evidence; migrations could also become impossible to audit independently.

Remediation: owner-only release step, restricted runtime role, PUBLIC schema-create revocation,
default privilege grants, runtime privilege preflight, and PostgreSQL CI validation.

Mitigation/verification: the local workstation lacks PostgreSQL. The exact release/preflight path is
mandatory in CI and staging; production deployment is blocked without that evidence.

## SEC-003 - Duplicate registration disclosed account state

Severity: Medium

Status: Fixed

Rule: public identity workflows must not disclose whether an identifier exists.

Location and evidence: `backend/apps/accounts/views.py:153` normalizes model-validation and database
race conflicts into the same `201 {"status":"verification_required"}` response, while re-raising
unrelated validation/integrity failures.

Impact before fix: an attacker could enumerate student email addresses through response shape/status.

Remediation: remove serializer existence lookup, catch both uniqueness validation and database race,
confirm only the normalized email collision, and return the same accepted response. No verification
email is sent to an existing user. Regression coverage verifies equal status/body.

## SEC-004 - Disabled commerce provider exposed a fake webhook-shaped route

Severity: Medium

Status: Fixed

Rule: disabled integrations must fail closed and never process client-reported success.

Location and evidence: `backend/apps/provider_integrations/views.py:17` returns not found when the
provider is `none` or the route provider differs. Production settings reject `fake` and all unknown
production adapters.

Impact before fix: a route advertised a provider integration that was not installed, increasing
attack surface and risking future accidental acceptance through misconfiguration.

Remediation: provider/path exact match plus production configuration rejection. Payment state still
changes only from verified normalized provider events.

## SEC-005 - Production boundary lacked a fail-closed deployment contract

Severity: Medium

Status: Fixed

Rule: production must require explicit hosts/origins/secrets/TLS/proxy trust and enforce browser/API
headers and limits at the public edge.

Locations and evidence:

- `backend/config/settings/production.py:7` begins strict production-only configuration.
- `backend/config/settings/production.py:88` and `:93` use secure `__Host-` cookies.
- `backend/config/settings/production.py:103` disables API docs and requires clean scans.
- `frontend/nginx/nginx.conf:73` sets CSP and related response headers.
- `frontend/nginx/nginx.conf:87` and `:94` rate-limit auth and uploads; `:93` bounds uploads.

Impact before fix: accidental wildcard hosts, weak/default secrets, insecure proxy interpretation,
oversized edge bodies, or missing browser hardening could reach production.

Remediation: strict settings validation, file-mounted secrets, TLS-only origins, trusted proxy
contract, secure cookies, HSTS, Nginx TLS/headers/rates/body limits, non-root read-only containers,
and deploy/preflight checks.

## SEC-006 - Malware scanner is not installed

Severity: Medium

Status: Open launch blocker

Rule: untrusted uploads must not become active without malware evidence.

Evidence: production now assigns `pending` and blocks publication/delivery; no scanner adapter or
operator-approved transition workflow exists in the repository.

Impact: enabling file ingestion would create an ever-growing pending queue, and any manual database
override would bypass evidence. Lock-in must not accept production uploads until this is integrated.

Required fix: approve a scanner/provider-independent workflow, authenticate its result, bind the
result to checksum/file identity, record timestamp/engine/version, test malicious/timeout/retry
behavior, and alert on backlog. Do not weaken `CONTENT_REQUIRE_CLEAN_SCAN`.

## SEC-007 - Observability provider code is configured; alert delivery is unverified

Severity: Medium

Status: Partially remediated; external launch blocker

Rule: production incidents and suspicious activity must be detectable and actionable.

Evidence: production now requires a StatsD destination and operator-owned HTTPS error collector;
backend, browser, request, and scheduled-job signals are redacted and emitted. Development/test may
still use honest no-op sinks. No real collector receipt, dashboard, paging route, or alert drill has
been demonstrated from this workstation.

Impact: without log aggregation, error capture, metrics, and tested paging, availability/security
incidents may be invisible even though the application emits useful signals.

Required fix: select approved providers, configure secrets outside source, verify redaction and
retention, create availability/error/auth/upload/payment/backup alerts, and execute an alert drill.

## SEC-008 - CSP permits inline style attributes

Severity: Low

Status: Accepted with controls

Rule: prefer a nonce/hash-based CSP and never permit inline scripts.

Location/evidence: `frontend/nginx/nginx.conf:73` has `style-src 'self' 'unsafe-inline'`; `script-src`
remains strictly `'self'` with no `unsafe-inline`/`unsafe-eval`.

Reason: current React components use dynamic style properties. Removing inline styles in Phase 11
would be a broad UI refactor outside the production-readiness boundary.

Mitigation: scripts are strict; `object-src`, `base-uri`, `frame-ancestors`, and `form-action` are
restricted; React does not use unsafe HTML injection. Revisit style nonces/classes in the approved
UI/UX phase without weakening script policy.

## SEC-009 - OpenAPI schema warning backlog

Severity: Low

Status: Open tracked debt

Rule: published API contracts should be deterministic and complete.

Evidence: production `check --deploy --fail-level ERROR` exits 0 but reports 96 inherited
drf-spectacular serializer/operation/enum warnings. `backend/config/urls.py:12` omits schema/docs in
production.

Impact: internal API runtime behavior remains tested, but an external schema/SDK could be incomplete
or unstable. This is not currently a direct public route exposure.

Required fix: annotate APIViews and resolve operation/enum names domain-by-domain before exposing
external schema or generating SDKs. Do not silence the warnings globally.

## SEC-010 - HSTS preload is disabled

Severity: Low

Status: Accepted until domain validation

Rule: enable preload only after every subdomain is permanently HTTPS-capable and rollback is understood.

Evidence: `backend/config/settings/production.py:97` requires HSTS >=300 seconds, includes
subdomains by default, and leaves preload false; Nginx sends `max-age=3600; includeSubDomains`.

Reason/mitigation: premature browser preload can make misconfigured or non-HTTPS subdomains
unreachable for a long period. Start with the documented short max-age, validate all subdomains,
increase progressively, then explicitly approve preload in both Django and edge configuration.

## Control review matrix

| Area | Result |
|---|---|
| Authentication | HttpOnly server sessions, password validators, single-use token digests, generic public responses, database-backed throttles |
| Authorization | DRF defaults authenticated; domain policies/capabilities; private file checks; server entitlements; operational RBAC |
| Session/CSRF | secure `__Host-` cookies, SameSite, login rotation, CSRF on unsafe anonymous/authenticated flows, same-origin API |
| CORS | no permissive cross-origin layer; same-origin architecture; explicit HTTPS CSRF origins |
| Headers/TLS | TLS 1.2/1.3, CSP, HSTS, frame/MIME/referrer/permissions/cross-origin policies |
| Rate limiting | edge auth/upload/webhook limits plus authoritative database-backed sensitive-domain limits |
| File upload | type/size/signature/checksum validation, private storage, fail-closed scan state; scanner still required |
| Input validation | strict serializers, bounded payloads/pagination/batches, integer money, normalized provider events |
| API exposure | production schema/Admin absent at edge; health is minimal; webhook disabled without provider |
| Secrets/logging | file-mounted secrets, no committed values, structured redacted logs, request IDs |
| Database | PostgreSQL required, owner/runtime split, timeouts/TLS policy, audit mutation denial, preflight |
| Dependencies | exact locks/pins; CI runs production npm audit; remote audit evidence still required for this commit |

## Launch security checklist

- [ ] Green CI, including dependency audit, PostgreSQL, image, Nginx, and Compose gates.
- [ ] Scanner integration and clean-file backlog alert proven.
- [ ] Monitoring/error/log destinations and paging drill proven.
- [ ] External penetration test or approved threat-model follow-up for deployed topology.
- [ ] TLS certificate/renewal and proxy-header spoofing tests complete.
- [ ] Backup/restore evidence and secret rotation drill complete.
- [ ] HSTS max-age ramp approved; preload remains off until all subdomains qualify.
- [ ] Payment provider remains `none` unless separately approved and tested.
