# Production Deployment Checklist

Last updated: 2026-07-19

This checklist is the repeatable production release contract. A checked source-code phase does not
authorize a deployment; the deployment owner must complete and retain this evidence per release.
The deployment shapes themselves, and the migration between them, are described in
`docs/DEPLOYMENT.md`.

## Before the maintenance window

- [ ] Green CI for the exact commit: backend/PostgreSQL, frontend/audit/build/budget, Playwright,
  containers/Nginx/Compose, the container-runtime job, and the final quality gate.
- [ ] The container-runtime job passed for this commit. It is the only evidence that the image
  starts, runs unprivileged, completes release and preflight, and serves a request. A deployment
  whose image has never started in CI is not production-ready.
- [ ] `validate_object_storage` passed against the target bucket, with `anonymous_access` refused
  and `ranged_reads` true. See docs/DEPLOYMENT.md, Staging validation for a storage provider.
- [ ] ClamAV verified per docs/DEPLOYMENT.md: reachable from the worker on 3310, unreachable from
  the public internet by explicit test, EICAR quarantined, signature volume persistent, sized for
  the reload peak.
- [ ] Immutable backend/edge image tags and digests recorded; no `latest` tag.
- [ ] `.env.production` reviewed against `.env.production.example`; no secret values in the file.
- [ ] Django, SMTP, PostgreSQL owner/runtime, and TLS secrets exist with restrictive host permissions.
- [ ] Owner/runtime database credentials differ and have an approved rotation record.
- [ ] TLS certificate covers the public host, key is readable by the container-mounted UID, expiry and
  renewal alert are healthy.
- [ ] DNS and Cloudflare proxying verified. Origin ports 80/443 allow current Cloudflare CIDRs only;
  administrative SSH is separately allowlisted. Direct public origin traffic is blocked.
- [ ] `frontend/nginx/cloudflare-real-ip.conf` matches Cloudflare's current published IPv4/IPv6
  ranges; spoofed `CF-Connecting-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` tests passed.
- [ ] Object storage reachable with a bucket-scoped token; the bucket is private, and no `/media/`
  route or public base URL exposes managed files. `STORAGE_ALLOW_LOCAL_MEDIA` is false unless a
  single-host exception is documented and its media volume is in the backup set.
- [ ] Database connection is explicit: `DATABASE_URL` or complete `POSTGRES_*`, with an `sslmode`
  that is not `allow` or `prefer`. Owner and runtime roles differ.
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
docker build --tag "lockin-clamav:$LOCKIN_IMAGE_TAG" deploy/clamav
```

- [ ] The database shape is deliberate: `COMPOSE_PROFILES=bundled-db` for the bundled PostgreSQL
  container, or no profile plus `POSTGRES_HOST`/`POSTGRES_PORT` for a managed provider. The rendered
  Compose output lists the services you expect and no others.

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
# Omit the first line when the database is managed rather than bundled.
docker compose --env-file .env.production -f compose.production.yaml up -d db
docker compose --env-file .env.production -f compose.production.yaml run --rm release
docker compose --env-file .env.production -f compose.production.yaml run --rm preflight
docker compose --env-file .env.production -f compose.production.yaml up -d backend operations-scheduler file-scan-worker edge
```

Never run Django migrations with the runtime credential. Never bypass a failed preflight.

## Post-deployment verification

- [ ] HTTP redirects to HTTPS; TLS 1.0/1.1 rejected; expected certificate chain served.
- [ ] `/healthz`, `/api/v1/health/live`, and readiness return expected minimal responses.
- [ ] Security headers verified on HTML, assets, API errors, and redirects.
- [ ] `/admin/` and API schema/docs are unavailable at the public edge.
- [ ] Login, CSRF-protected mutation, logout, and account recovery smoke-tested.
- [ ] Authorized private file access works; unauthorized/non-clean file access fails.
- [ ] Private files stream from object storage: view, download, and a byte-range seek all succeed,
  and the bucket refuses an unsigned anonymous request for the same object.
- [ ] Payment webhook is 404 while `PAYMENT_PROVIDER=none`.
- [ ] Static/PWA assets load; service-worker update does not cache private API responses.
- [ ] Error/request ID appears in structured logs without cookies/tokens/body secrets.
- [ ] OAuth/account-action query parameters do not appear in Nginx access logs.
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
