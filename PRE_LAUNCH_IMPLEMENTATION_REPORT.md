# Pre-Launch Implementation Report

Audit date: 2026-09-01  
Target: `https://lockin.ly`  
Scope: repository-wide production configuration, security, deployment, data safety, uploads, authentication, authorization, subscriptions, administration, frontend/PWA, responsive UX, accessibility, tests, and recovery.

## Executive Summary

**Launch verdict: NOT READY**

The application code is materially closer to launch and its automated quality baseline is strong: backend and frontend static checks pass, 311 backend tests and 202 frontend tests pass, the production/PWA build succeeds, dependency audits found no known vulnerabilities, and 180 of 185 Chromium scenarios passed in the full post-change run (four intentional skips and one load-sensitive test that passed three consecutive isolated reruns).

The remaining blockers are operational proof, not a recommendation to redesign the product. This workstation has no Docker or Nginx binary, so the production Compose stack, derived ClamAV image, TLS configuration, real PostgreSQL role split, migrations, scanner, SMTP, OAuth, and proxy chain could not be started together. A coordinated PostgreSQL/private-media backup has also not passed a full restore drill. Do not send public traffic until the P0 gates below have evidence.

No existing demo/test study sheet, PDF, question, quiz, or associated sample data was modified, renamed, migrated, deleted, or cleaned up during this pass. The existing temporary preview catalogs remain present and are now clearly separated from server-published content.

## What I Found

### P0 — Launch Blocker

- **The production stack has not been proven in a production-equivalent environment.** Compose and CI YAML parse, and automated configuration tests pass, but Docker/Nginx were unavailable locally. Build all three images, run `release` and `preflight`, and retain the output before launch.
- **Backup recovery is designed but not launch-proven.** A PostgreSQL catalog check is not a restore test. Complete one isolated restore of a matching database/private-media set and record observed RPO/RTO.
- **External production controls are unverified.** Provision TLS renewal, Cloudflare DNS/proxying, a Cloudflare-only origin firewall, SMTP, monitoring endpoints/alerts, disk alerts, and the final OAuth credentials/redirects. Test spoofed forwarding headers against the real origin.
- **Legal/operator inputs are intentionally unresolved.** Replace the legal entity/address/jurisdiction and policy version placeholders; name the payment-review, backup, security-response, and rollback owners.

### P1 — Should Fix Before Launch

- Run the four production-live subscription concurrency tests against real PostgreSQL; SQLite intentionally skips them.
- Run the full browser suite in CI and on at least one physical iPhone/iPad. The full Chromium run had one four-worker settings/keyboard timeout; the same case passed three isolated repetitions.
- Execute a real upload through Cloudflare → Nginx → Django → storage → ClamAV, including a near-limit audio file, invalid MIME/signature, scanner outage/retry, quarantine, authorized range request, and unauthorized request.
- Verify real email delivery, SPF/DKIM/DMARC, password reset, verification, and safe failure behavior. Verify Google OAuth state/nonce/callback and duplicate-account behavior using the production client.
- Retain encrypted off-host backups. The local 30-day pruning default is only a safety net.

### P2 — Can Fix After Launch

- The single-VPS deployment uses a private Docker media volume through Django's storage API. This is acceptable only with monitored durable storage and coordinated media backups. Add an S3-compatible Django storage backend before multi-host scaling or direct object delivery.
- Add an operator-reviewed abandoned-upload/blob reconciliation command. Existing immutable content references are protected, and replaced avatars are removed, but there is no general automatic orphan sweep.
- Move optional OAuth/Telegram secrets from direct Compose environment values to file-backed secrets if those integrations are enabled.
- Automate Cloudflare CIDR refresh validation and ClamAV signature-freshness alerting.
- Decide whether public legal/support pages should remain covered by the edge-wide `noindex` policy.

### P3 — Nice to Have

- Add a real server-authoritative commerce service before enabling the visual Store preview.
- Add upload progress for large creator uploads; current failure/retry states are present but progress is not granular.
- Add periodic WebKit and Android-device performance budgets for the PDF workspace.

## What I Fixed

### Trusted proxy and production edge

- **Issue:** Cloudflare's original visitor address was lost at Nginx, making source rate limits collapse onto Cloudflare POP addresses; caller-controlled forwarding chains and query-bearing request lines were logged.
- **Implementation:** Added an allowlisted Cloudflare real-IP configuration, forwarded only Nginx's resolved `$remote_addr`, disabled proxy request buffering for uploads, removed query strings/referrers/raw forwarding chains from access logs, added a minimal edge liveness response, blocked public Django admin, and aligned the edge upload limit with application limits.
- **Files:** `frontend/nginx/cloudflare-real-ip.conf`, `frontend/nginx/nginx.conf`, `frontend/nginx/default.conf`, `frontend/Dockerfile`, `frontend/tests/production-edge.test.js`.
- **Test:** Edge contract tests pass; frontend test suite passes. Live origin-firewall/spoof testing remains a P0 deployment gate. Cloudflare ranges were checked against [Cloudflare's published IP list](https://www.cloudflare.com/ips/) and the design follows [Cloudflare's original visitor IP guidance](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/).

### Upload and malware-scanning lifecycle

- **Issue:** The application accepted files larger than ClamAV's upstream INSTREAM default, so valid uploads could exhaust retries and remain unusable.
- **Implementation:** Added a pinned derived ClamAV image with `StreamMaxLength` and `MaxFileSize` set to 100 MiB, reduced production audio uploads to 90 MiB so multipart overhead stays below the edge ceiling, and added the scanner image to CI builds. Existing UUID object keys, extension/MIME/magic validation, size limits, private authorization, scan retries/recovery, quarantine, and clean-only publication were retained.
- **Files:** `deploy/clamav/Dockerfile`, `compose.production.yaml`, `.env.production.example`, `.github/workflows/ci.yml`, `frontend/tests/production-edge.test.js`.
- **Test:** Static contracts and all scanner/backend tests pass. The image could not be built locally because Docker is unavailable; CI/staging build is required. Limits were checked against ClamAV's [official configuration sample](https://github.com/Cisco-Talos/clamav/blob/main/etc/clamd.conf.sample) and [clamd protocol documentation](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).

### Published-file authorization

- **Issue:** Creating a replacement draft changed the learning object's workflow state and accidentally revoked the still-current published file.
- **Implementation:** Authorization now follows the exact immutable `published_version`, archive state, discoverability, availability, entitlement, and download policy. A replacement draft stays private while the previous published asset remains available; archive/unpublish still revoke access.
- **Files:** `backend/apps/content/policies.py`, `backend/apps/files/tests/test_files.py`, `backend/platform_core/management/commands/production_preflight.py`.
- **Test:** New published-version regression, superseded-version, unpublish/archive, ownership, scan-state, and private-delivery tests pass.

### OAuth and one-time account links

- **Issue:** OAuth callbacks lacked a source-level abuse limit, and email/password action tokens stayed in browser history until successful submission.
- **Implementation:** Added database-backed source limiting before callback processing with a safe redirect error; token routes now capture the credential only in component memory and immediately replace the public/history URL. Existing OAuth state, nonce, browser binding, exact provider endpoints, safe account linking, verified-email requirement, and suspended-user denial were preserved.
- **Files:** `backend/apps/accounts/oauth.py`, `backend/apps/accounts/tests/test_oauth.py`, `frontend/src/components/auth/AuthPage.jsx`, `frontend/src/components/auth/TokenActionPage.jsx`, `frontend/tests/phase1.test.js`.
- **Test:** New callback-rate and token-history regressions pass; full account/OAuth suite passes.

### Production data truthfulness

- **Issue:** The main Materials and Questions screens led with temporary client catalogs, while the Store displayed client-authoritative balance/reward/purchase behavior that has no production commerce backend.
- **Implementation:** Materials and Questions now load paginated, authorized Django content first with loading, retry, empty, and paging states. Temporary catalogs remain untouched in clearly identified preview sections. Store commerce actions, reward, top-up, cart, and fake balance are disabled behind an explicit preview state until a server-authoritative service exists.
- **Files:** `frontend/src/pages/Materials.jsx`, `frontend/src/pages/Questions.jsx`, `frontend/src/pages/Store.jsx`, `frontend/src/App.jsx`, `frontend/src/lib/i18n.js`.
- **Test:** API-contract, translation, responsive, Store, Materials, Questions, and browser tests pass except for the separately recorded settings test flake.

### Quiz accessibility

- **Issue:** Demo quiz answers were toggle buttons, not a single-choice group, and an unanswered question could disappear from keyboard tab order.
- **Implementation:** Reused the shared roving radio-group primitive with vertical arrow behavior and correct `radiogroup`, `radio`, `aria-checked`, and tab-stop semantics.
- **Files:** `frontend/src/pages/Questions.jsx`.
- **Test:** The previously failing Chromium assertion now passes; the full frontend suite and targeted browser test pass.

### Backup retention and domain-ready operations

- **Issue:** The backup script had no bounded local retention, and deployment examples still contained non-production domains/stale operational wording.
- **Implementation:** Added validated retention after successful dump, catalog verification, atomic rename, and SHA-256 generation. Pruning is restricted to completed Lock-in dump/hash pairs in the resolved target directory. Updated deployment, OAuth, backup, payment, Cloudflare, scanner, and `lockin.ly` examples.
- **Files:** `scripts/production/backup-postgres.sh`, `docs/BACKUP_RECOVERY.md`, `docs/DEPLOYMENT_CHECKLIST.md`, `docs/OAUTH_CONFIGURATION.md`, `docs/SUBSCRIPTION_MANUAL_LIBYANA.md`, `.env.production.example`.
- **Test:** Static retention/edge contract tests and YAML parsing pass. The backup script was not run against user or production data; the restore drill remains a P0 gate.

## Remaining Issues

1. No production-equivalent Docker startup, Nginx `-t`, Compose interpolation validation, real PostgreSQL migration/preflight, or TLS smoke was possible on this host.
2. No complete database/private-media restore was executed. Do not treat backups as complete until this succeeds.
3. No live SMTP/OAuth/Telegram/Cloudflare/observability integration was exercised because production credentials and infrastructure were correctly not present.
4. Local private-media storage is the implemented single-VPS path; object storage is not configured in production settings.
5. Four production-only subscription concurrency tests remain intentionally skipped under SQLite.
6. General abandoned-upload storage reconciliation remains manual.
7. The full Chromium run had one parallel-load timeout in the 390×844 settings keyboard case; it passed 3/3 isolated reruns.

## Production Architecture

```text
Student browser / installed PWA
        |
Cloudflare Free (DNS, TLS edge, DDoS/WAF controls)
        |
VPS firewall: 80/443 from current Cloudflare CIDRs only
        |
Nginx edge container (TLS, CSP/headers, static/PWA, /healthz)
        |
Django + Gunicorn container ---- operations scheduler
        |                         file-scan worker ---- ClamAV
        |
PostgreSQL owner role (release only) / restricted runtime role
        |
Private durable media volume (initial single-VPS deployment)

Encrypted PostgreSQL + coordinated media backup -> off-host storage
```

The browser receives only public Vite build values. Django owns authentication, authorization, entitlement, publication, progress, assessment grading, payment review, file delivery, analytics, and administrative capabilities. The built-in Django admin is not exposed through the public edge.

## Environment Variables

Names only; never commit their real values.

- **Deployment/public:** `COMPOSE_PROJECT_NAME`, `LOCKIN_IMAGE_TAG`, `LOCKIN_PUBLIC_HOST`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, `LOCKIN_SUPPORT_EMAIL`, `LOCKIN_LEGAL_ENTITY`, `LOCKIN_LEGAL_ADDRESS`, `LOCKIN_LEGAL_JURISDICTION`.
- **Database/backup:** `POSTGRES_DB`, `POSTGRES_OWNER_USER`, `POSTGRES_RUNTIME_ROLE`, `POSTGRES_OWNER_PASSWORD_FILE`, `POSTGRES_RUNTIME_PASSWORD_FILE`, `POSTGRES_CONN_MAX_AGE`, `POSTGRES_SSLMODE`, `POSTGRES_TRUSTED_PRIVATE_NETWORK`, `POSTGRES_STATEMENT_TIMEOUT_MS`, `POSTGRES_LOCK_TIMEOUT_MS`, `POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS`, `BACKUP_RETENTION_DAYS`.
- **Django/security:** `DJANGO_SECRET_KEY_FILE`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `DJANGO_TRUSTED_PROXY_CIDRS`, `ACCOUNT_LOGIN_SOURCE_ATTEMPT_LIMIT`, `ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT`, `ACCOUNT_POLICY_VERSION`, `DJANGO_SECURE_HSTS_SECONDS`, `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS`, `DJANGO_SECURE_HSTS_PRELOAD`, `DJANGO_LOG_LEVEL`.
- **Email:** `DJANGO_EMAIL_BACKEND`, `DEFAULT_FROM_EMAIL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD_FILE`, `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_TIMEOUT_SECONDS`.
- **OAuth (provider optional, all-or-none):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `APPLE_OAUTH_SERVICES_ID`, `APPLE_OAUTH_TEAM_ID`, `APPLE_OAUTH_KEY_ID`, `APPLE_OAUTH_PRIVATE_KEY`, `APPLE_OAUTH_REDIRECT_URI`, `OAUTH_FLOW_TTL_SECONDS`, `OAUTH_HTTP_TIMEOUT_SECONDS`.
- **Monitoring:** `OBSERVABILITY_SLOW_REQUEST_MS`, `OBSERVABILITY_STATSD_HOST`, `OBSERVABILITY_STATSD_PORT`, `OBSERVABILITY_METRIC_PREFIX`, `OBSERVABILITY_ERROR_WEBHOOK_URL`, `OBSERVABILITY_ERROR_WEBHOOK_TOKEN_FILE`, `OBSERVABILITY_ERROR_TIMEOUT_SECONDS`.
- **Files/scanner:** `CONTENT_MAX_PDF_BYTES`, `CONTENT_MAX_AUDIO_BYTES`, `FILE_SCAN_HOST`, `FILE_SCAN_PORT`, `FILE_SCAN_CONNECT_TIMEOUT_SECONDS`, `FILE_SCAN_READ_TIMEOUT_SECONDS`, `FILE_SCAN_MAX_ATTEMPTS`, `FILE_SCAN_RETRY_BASE_SECONDS`, `FILE_SCAN_RETRY_MAX_SECONDS`, `FILE_SCAN_CLAIM_TIMEOUT_SECONDS`, `FILE_SCAN_WORKER_INTERVAL_SECONDS`, `FILE_SCAN_BATCH_SIZE`.
- **Subscriptions/payments/jobs:** `PAYMENT_PROVIDER`, `DEFAULT_TRIAL_PLAN_CODE`, `PAYMENT_CODE_ENCRYPTION_KEY_FILE`, `MANUAL_PAYMENT_RATE_WINDOW_SECONDS`, `MANUAL_PAYMENT_RATE_LIMIT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PAYMENT_CHAT_ID`, `TELEGRAM_HTTP_TIMEOUT_SECONDS`, `SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS`, `NOTIFICATION_SCHEDULER_INTERVAL_SECONDS`, `OPERATIONAL_CLEANUP_INTERVAL_SECONDS`, `OPERATIONAL_DATA_RETENTION_DAYS`, `COMMERCE_RECONCILIATION_INTERVAL_SECONDS`, `ANALYTICS_REBUILD_INTERVAL_SECONDS`, `MOTIVATION_REBUILD_INTERVAL_SECONDS`, `OPERATIONS_SCHEDULER_POLL_SECONDS`, `OPERATIONS_JOB_LEASE_SECONDS`.
- **Gunicorn:** `GUNICORN_WORKERS`, `GUNICORN_THREADS`, `GUNICORN_TIMEOUT_SECONDS`, `GUNICORN_GRACEFUL_TIMEOUT_SECONDS`, `GUNICORN_KEEPALIVE_SECONDS`, `GUNICORN_MAX_REQUESTS`, `GUNICORN_MAX_REQUESTS_JITTER`.

## Deployment Checklist

1. Create a new production PostgreSQL database; never run `seed_demo` and never reuse a development/demo database.
2. Fill `.env.production` from `.env.production.example`; create restrictive secret files and approved legal/policy values.
3. Configure Cloudflare and permit current Cloudflare CIDRs only to origin ports 80/443; separately allowlist SSH.
4. Run `docker compose --env-file .env.production -f compose.production.yaml config --quiet` and build immutable backend, edge, and ClamAV images.
5. Take a coordinated database/media backup; prove restore in isolation.
6. Start PostgreSQL, run one-shot `release`, then one-shot runtime `preflight`; stop on any failure.
7. Start backend/scheduler/scanner/edge; verify `/healthz`, `/api/v1/health/live`, and `/api/v1/health/ready`.
8. Smoke login/logout, CSRF mutation, recovery email, OAuth, suspension/expiry, authorized/unauthorized PDF ranges, upload/scan/publication, Creator Studio, and Arabic/mobile/PWA update.
9. Confirm headers, query-free logs, request IDs, metrics/errors, backup/disk/certificate/5xx alerts, and payment endpoint disabled with `PAYMENT_PROVIDER=none`.
10. Record commit, immutable image digests, migration/preflight output, backup-set ID, test evidence, operator, and go/rollback decision.

Use `docs/DEPLOYMENT_CHECKLIST.md` for the command-level release record.

## Rollback

- Keep the previous immutable backend/edge/scanner image digests and the pre-release database/media backup set.
- For an application-only regression with a backward-compatible schema, switch Compose image tags back and rerun readiness/smoke checks.
- Prefer a reviewed forward fix for schema changes. Reverse a migration only when its reverse path has passed against a restored staging copy and cannot lose data.
- For corruption or an incompatible destructive migration, stop writes, select a matching database/media backup set, restore into isolation, verify it, then switch traffic. Never delete volumes, manually edit authoritative tables, or use `git reset --hard` as rollback.

## Backup / Restore

Create and validate a local PostgreSQL custom-format dump:

```sh
BACKUP_RETENTION_DAYS=30 \
  ./scripts/production/backup-postgres.sh .env.production /encrypted/lockin-backups
```

Copy the completed dump, SHA-256 sidecar, coordinated private-media snapshot/manifest, image digests, and non-secret config record to encrypted off-host storage.

Verify a dump in a disposable database:

```sh
./scripts/production/verify-postgres-restore.sh \
  /encrypted/lockin-backups/lockin-YYYYMMDDTHHMMSSZ.dump .env.production
```

A complete restore drill must also restore matching media, start the exact images in isolation, run `release` and `preflight`, authenticate, open representative private PDFs, and record RPO/RTO. See `docs/BACKUP_RECOVERY.md`.

## Test Results

| Check | Result |
|---|---|
| Backend Ruff lint | PASS — all checks passed |
| Backend Ruff format | PASS — 511 files formatted |
| Backend mypy | PASS — 427 source files |
| Django checks | PASS — no issues |
| Migration drift | PASS — no changes detected |
| Backend tests | PASS — 311 passed, 2 skipped, 85.12% coverage |
| Frontend ESLint | PASS — zero warnings |
| Frontend TypeScript | PASS |
| Frontend tests | PASS — 202 passed |
| Frontend production/PWA build | PASS — service worker generated, 14 entries precached |
| Bundle budget | PASS — entry JS 148.2 KiB gzip; entry CSS 72.3 KiB gzip |
| npm dependency audit | PASS — no known vulnerabilities |
| Python dependency audit | PASS — no known vulnerabilities |
| Chromium targeted quiz accessibility | PASS |
| Chromium full matrix | PARTIAL — 180 passed, 4 intentional skips, 1 parallel-load timeout |
| Chromium flake rerun | PASS — 3/3 isolated repetitions |
| Compose/CI YAML parsing | PASS |
| Container builds / Nginx `-t` | NOT RUN — Docker/Nginx unavailable locally |
| Real PostgreSQL production smoke | NOT RUN |
| Backup/media restore drill | NOT RUN |
| Live Cloudflare/SMTP/OAuth/monitoring smoke | NOT RUN |

Secret review covered tracked files and reachable Git history with assignment/high-entropy heuristics. No confirmed real credential was found. Only example placeholders/test values were observed. Dedicated `gitleaks`/`trufflehog` tooling was unavailable, so CI should still run a dedicated secret scanner before launch.
