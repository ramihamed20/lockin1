# Production Deployment Checklist

Last updated: 2026-07-19

This checklist is the repeatable production release contract. A checked source-code phase does not
authorize a deployment; the deployment owner must complete and retain this evidence per release.

## Before the maintenance window

- [ ] Green CI for the exact commit: backend/PostgreSQL, frontend/audit/build/budget, Playwright,
  containers/Nginx/Compose, and final quality gate.
- [ ] Immutable backend/edge image tags and digests recorded; no `latest` tag.
- [ ] `.env.production` reviewed against `.env.production.example`; no secret values in the file.
- [ ] Django, SMTP, PostgreSQL owner/runtime, and TLS secrets exist with restrictive host permissions.
- [ ] Owner/runtime database credentials differ and have an approved rotation record.
- [ ] TLS certificate covers the public host, key is readable by the container-mounted UID, expiry and
  renewal alert are healthy.
- [ ] DNS, firewall, load-balancer/proxy chain, and spoofed `X-Forwarded-Proto` stripping verified.
- [ ] Backup set completed: PostgreSQL dump plus coordinated private-media snapshot and hashes.
- [ ] Restore verification completed recently; observed RPO/RTO recorded.
- [ ] Migration reviewed for locks, table rewrites, reversibility, and compatibility with the previous
  application image. Large data migrations need a separately approved runbook.
- [ ] Monitoring/alerts/structured-log ingestion/error reporting are healthy; on-call owner named.
- [ ] Malware scanning is healthy. If not, production file ingestion remains disabled.
- [ ] Rollback image digests, database decision point, and rollback authority are recorded.

## Validate the Compose contract

```sh
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker build --tag "lockin-backend:$LOCKIN_IMAGE_TAG" backend
docker build --tag "lockin-edge:$LOCKIN_IMAGE_TAG" frontend
```

- [ ] Container vulnerability/image-signature policy passed in the deployment environment.
- [ ] `nginx -t` passed against the mounted production certificate/key.
- [ ] PostgreSQL and media volumes are on encrypted, capacity-monitored durable storage.

## Release sequence

1. Start/verify PostgreSQL only; wait through its declared start period and health retries.
2. Run the one-shot `release` service as migration owner. It must exit 0.
3. Run the one-shot `preflight` service as runtime role. Retain its JSON evidence; it must exit 0.
4. Start backend and wait for readiness. Do not restart while migrations/indexing still show progress.
5. Start edge and verify `/healthz`, public liveness, and authenticated readiness from the approved
   monitoring path.

Example commands:

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d db
docker compose --env-file .env.production -f compose.production.yaml run --rm release
docker compose --env-file .env.production -f compose.production.yaml run --rm preflight
docker compose --env-file .env.production -f compose.production.yaml up -d backend edge
```

Never run Django migrations with the runtime credential. Never bypass a failed preflight.

## Post-deployment verification

- [ ] HTTP redirects to HTTPS; TLS 1.0/1.1 rejected; expected certificate chain served.
- [ ] `/healthz`, `/api/v1/health/live`, and readiness return expected minimal responses.
- [ ] Security headers verified on HTML, assets, API errors, and redirects.
- [ ] `/admin/` and API schema/docs are unavailable at the public edge.
- [ ] Login, CSRF-protected mutation, logout, and account recovery smoke-tested.
- [ ] Authorized private file access works; unauthorized/non-clean file access fails.
- [ ] Payment webhook is 404 while `PAYMENT_PROVIDER=none`.
- [ ] Static/PWA assets load; service-worker update does not cache private API responses.
- [ ] Error/request ID appears in structured logs without cookies/tokens/body secrets.
- [ ] Database role evidence shows non-superuser, no schema create, no audit mutation.
- [ ] A bounded HTTP probe runs against approved safe endpoints; compare p95/error rate to baseline.
- [ ] Mobile/desktop smoke and primary Arabic RTL route checked.
- [ ] Metrics, errors, logs, certificate, disk, database, backup, upload-scan, and 5xx alerts observed.

## Rollback decision

- Application-only regression with backward-compatible schema: restore previous immutable images.
- Forward-fix migration: preferred when safe and reviewed.
- Reverse migration: only if explicitly tested against a staging copy and data loss is impossible or
  approved.
- Database restore: disaster-recovery operation only; stop writes, choose a consistent DB/media
  backup set, record lost interval, restore/verify, then run release/preflight.

Do not use `git reset --hard`, delete volumes, edit production tables manually, or improvise schema
rollback during an incident.

## Release record

Record: commit SHA, image digests, operator/approver, start/end UTC, release/preflight output,
migration list/duration, backup-set ID, smoke/load result, alert status, deviations, and final
go/rollback decision.
