# Deployment

Last updated: 2026-09-02

This is the deployment contract for both supported shapes. Phase 1 runs the
single application image on a managed container host with managed PostgreSQL and
S3-compatible object storage. Phase 2 runs the same source on a VPS with Docker
Compose. Moving between them changes infrastructure and environment values; it
does not change application code, authentication, or the frontend's API calls.

- Release evidence and sign-off: `docs/DEPLOYMENT_CHECKLIST.md`.
- Backup and restore contract: `docs/BACKUP_RECOVERY.md`.
- Day-2 operations: `docs/OPERATIONS.md`.
- Disposable public demo: `docs/RENDER_DEMO.md`.

## Architecture

### Phase 1 — managed container host

```
Internet
  |
Cloudflare
  |
Container host (TLS terminated by the platform)
  |
  +-- web service: one image, nginx + Gunicorn on one origin
  |     +-- /            SPA (built into the image)
  |     +-- /api/v1/     Django API
  |
  +-- worker service: operations scheduler   (same image, own command)
  +-- worker service: file-scan worker       (same image, own command)
  +-- private service: ClamAV
        |
Managed PostgreSQL (Supabase or equivalent)   S3-compatible object storage (R2)
```

### Phase 2 — VPS

```
Internet
  |
Cloudflare
  |
VPS firewall (443/80 from Cloudflare ranges only; SSH separately allowlisted)
  |
Docker Compose
  +-- edge      nginx, terminates TLS, serves the SPA and static assets
  +-- backend   Gunicorn, private application network
  +-- operations-scheduler, file-scan-worker, clamav
  +-- db        PostgreSQL, on an internal network with no published port
        |
S3-compatible object storage (unchanged by the migration)
```

The SPA and the API are same-origin in both shapes. That is what keeps the
`__Host-lockin_session` cookie, the CSRF contract, and the frontend's relative
`/api/v1` base URL identical across a migration. Splitting them onto separate
domains would require cross-site cookies and CORS, and is not supported.

## The configuration contract

Everything environment-specific is an environment variable. No credential,
endpoint, or hostname is compiled into an image or committed to the repository.

| Concern | Values | Notes |
| --- | --- | --- |
| Database | `DATABASE_URL`, or `POSTGRES_DB`/`USER`/`PASSWORD`/`HOST`/`PORT` | Any explicit `POSTGRES_*` value overrides the URL |
| Database transport | `POSTGRES_SSLMODE`, `POSTGRES_SSLROOTCERT` | Also read from an `sslmode` query parameter on `DATABASE_URL` |
| Object storage | `STORAGE_BACKEND`, `STORAGE_BUCKET_NAME`, `STORAGE_ENDPOINT_URL`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_ADDRESSING_STYLE` | Provider-neutral; see [Object storage](#object-storage) |
| Application identity | `PUBLIC_APP_URL`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | Must agree; production requires HTTPS |
| Secrets | `DJANGO_SECRET_KEY`, `PAYMENT_CODE_ENCRYPTION_KEY`, `EMAIL_HOST_PASSWORD`, `OBSERVABILITY_ERROR_WEBHOOK_TOKEN` | Every one also accepts a `_FILE` suffix pointing at a mounted secret |
| Proxy contract | `DJANGO_TRUST_PROXY_SSL_HEADER`, `DJANGO_TRUSTED_PROXY_CIDRS` | Names the only network allowed to assert `X-Forwarded-Proto` |

Any secret named `NAME` can instead be supplied as `NAME_FILE` holding a path.
Setting both is rejected at start-up. Container hosts use the plain form;
Compose uses the `_FILE` form with Docker secrets.

Templates: `.env.example` (local), `.env.container-host.example` (Phase 1),
`.env.production.example` (Phase 2).

### Database configuration precedence

1. `DATABASE_URL` (or `DATABASE_URL_FILE`) supplies name, user, password, host,
   port, and optionally `sslmode`.
2. Any explicitly set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
   `POSTGRES_HOST`, or `POSTGRES_PORT` overrides the corresponding part.

That ordering is what lets one deployment share a single connection URL while
the one-shot release step connects as the database owner and every serving
process connects as the least-privilege runtime role.

Production refuses to start without a complete connection and an explicit
`sslmode`. `allow` and `prefer` are rejected there because both silently fall
back to plaintext; `disable` additionally requires
`POSTGRES_TRUSTED_PRIVATE_NETWORK=true`.

### Database roles

The application never migrates and serves under the same role. Production
preflight fails closed if the serving role holds schema or superuser privileges,
and `manage.py release` refuses to run when the two roles are identical.

- Bundled PostgreSQL: `deploy/postgres/init-runtime-role.sh` creates the runtime
  role when the volume is first initialised.
- Managed PostgreSQL: run `deploy/postgres/create-runtime-role.sql` once, as the
  database owner, before the first deploy.

```bash
psql "$OWNER_DATABASE_URL" --set ON_ERROR_STOP=1 --set runtime_role=lockin_app --set runtime_password="$RUNTIME_PASSWORD" --file deploy/postgres/create-runtime-role.sql
```

`manage.py release` applies the table and sequence grants on every deploy, so the
script only has to establish the role.

## Object storage

Private study material is never stored on the application filesystem. Container
disks are ephemeral, and a host volume cannot follow the application across a
migration. `STORAGE_BACKEND=s3` selects any S3-compatible provider through
environment values alone.

| Provider | `STORAGE_ENDPOINT_URL` | `STORAGE_REGION` | `STORAGE_ADDRESSING_STYLE` |
| --- | --- | --- | --- |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | `virtual` |
| AWS S3 | omit | the bucket's region | `virtual` |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | the bucket's region | `virtual` |
| MinIO on the VPS | `http://minio:9000` | `auto` | `path` |

A plaintext endpoint additionally requires
`STORAGE_ALLOW_INSECURE_ENDPOINT=true`, which is only appropriate for a private
in-cluster address such as MinIO on the same Docker network.

### How private files are protected

The bucket is private. Objects carry no ACL, and signed URLs are never handed to
clients. Every read goes through `/api/v1/files/<id>/<view|download>`, which
checks entitlement, publication state, and clean-scan evidence before streaming
a single byte. Range requests become ranged GETs against the provider, so a
50 MB PDF is never staged in the container before delivery.

Consequences to keep in mind:

- Do not make the bucket public, and do not add a `/media/` location to any
  nginx configuration. Either would bypass authorisation entirely.
- `STORAGE_PUBLIC_BASE_URL` exists for deliberately public assets fronted by a
  CDN. It does not change how managed files are delivered.
- Keep `STORAGE_QUERYSTRING_AUTH` enabled. Production refuses to start with it
  disabled.

### Bucket setup

1. Create a bucket, private, in the region closest to your users.
2. Create an API token scoped to that one bucket with object read/write/delete.
   Do not use an account-wide token.
3. Set `STORAGE_*` on the web service and on both worker services. The file-scan
   worker reads uploaded bytes and needs the same access.
4. Enable object versioning or a lifecycle rule if your recovery plan expects to
   restore a deleted object; see `docs/BACKUP_RECOVERY.md`.

## Phase 1 — deploy to a managed container host

The root `Dockerfile` builds one image containing the SPA, the Django API, and
nginx. `deploy/container-host/start.sh` is the entry point: it renders the nginx
configuration, runs the release step, runs production preflight, then serves.
Passing a command instead turns the same image into a worker.

1. **Provision the database.** Create a managed PostgreSQL instance and copy its
   connection URI. Run `deploy/postgres/create-runtime-role.sql` as the owner to
   create `lockin_app`. Put the runtime role in `DATABASE_URL`; keep the owner
   credentials in `POSTGRES_OWNER_USER` and `POSTGRES_OWNER_PASSWORD`.
2. **Provision the bucket** as described above.
3. **Create the web service.** Point it at this repository, Docker runtime, root
   directory empty, health check path `/api/v1/health/ready`. The platform sets
   `PORT`; the container listens on it.
4. **Set the environment** from `.env.container-host.example`. Every value marked
   `replace-` must be replaced. Generate `DJANGO_SECRET_KEY` (50+ characters) and
   `PAYMENT_CODE_ENCRYPTION_KEY` (32+ characters) with the platform's secret
   generator, not by hand.
5. **Create the ClamAV private service** from `deploy/clamav`, reachable only on
   the platform's private network, and set `FILE_SCAN_HOST`/`FILE_SCAN_PORT` on
   every service that touches files. Production requires clean-scan evidence
   before it will deliver a file; without a reachable scanner, file delivery
   stays closed.
6. **Create the worker services**, both from the same image and the same
   environment, with `LOCKIN_RUN_RELEASE=false` and `LOCKIN_RUN_PREFLIGHT=false`:

   ```
   command: python manage.py run_operations_scheduler
   command: python manage.py run_file_scanner
   ```

7. **Deploy.** The web service runs migrations, applies runtime grants, collects
   static assets, and runs preflight before accepting traffic. A failed preflight
   is a failed deploy; do not bypass it.
8. **Configure the domain.** Add the custom domain on the platform, point
   Cloudflare at it with proxying enabled, and set `LOCKIN_PUBLIC_HOST`,
   `DJANGO_ALLOWED_HOSTS`, `PUBLIC_APP_URL`, and `DJANGO_CSRF_TRUSTED_ORIGINS`
   to the final hostname. Update the OAuth redirect URIs to match; production
   validates that they are HTTPS callbacks on the public host.

Scaling to more than one web instance: set `LOCKIN_RUN_RELEASE=false` on every
instance beyond the first, so only one process per deploy runs migrations.

## Phase 2 — deploy to a VPS

Target: 4 vCPU, 8 GB RAM, 100 GB SSD, Linux, root access.

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
docker compose version
```

### 2. Get the source and the configuration

```bash
sudo git clone <repository-url> /srv/lockin
cd /srv/lockin
cp .env.production.example .env.production
```

Edit `.env.production`. It holds non-secret configuration only; every secret is a
path to a file outside the repository.

### 3. Create the secret files

```bash
sudo install -d -m 0700 /secure/lockin
umask 077
openssl rand -base64 48 | tr -d '\n' | sudo tee /secure/lockin/django_secret_key > /dev/null
openssl rand -base64 32 | tr -d '\n' | sudo tee /secure/lockin/payment_code_encryption_key > /dev/null
openssl rand -base64 32 | tr -d '\n' | sudo tee /secure/lockin/postgres_owner_password > /dev/null
openssl rand -base64 32 | tr -d '\n' | sudo tee /secure/lockin/postgres_runtime_password > /dev/null
printf '%s' "$STORAGE_SECRET" | sudo tee /secure/lockin/storage_secret_access_key > /dev/null
sudo chmod 0400 /secure/lockin/*
```

Owner and runtime database passwords must differ. Add the SMTP password and the
observability webhook token the same way.

### 4. Choose the database shape

- **Bundled PostgreSQL** (default): keep `COMPOSE_PROFILES=bundled-db` in
  `.env.production`. The container has no published port and sits on an internal
  Docker network that the edge cannot reach.
- **Managed PostgreSQL**: remove `COMPOSE_PROFILES`, set `POSTGRES_HOST`,
  `POSTGRES_PORT`, and `POSTGRES_SSLMODE=require`, and put the provider's
  passwords in the owner and runtime secret files.

### 5. Start the deployment

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d db
docker compose --env-file .env.production -f compose.production.yaml run --rm release
docker compose --env-file .env.production -f compose.production.yaml run --rm preflight
docker compose --env-file .env.production -f compose.production.yaml up -d backend operations-scheduler file-scan-worker edge
```

Omit the first line when using a managed database. `release` and `preflight` must
each exit 0; retain the preflight JSON as release evidence.

### 6. Reverse proxy and HTTPS

The `edge` service is the reverse proxy. It terminates TLS on 443, redirects 80
to 443, serves the SPA and collected static assets, proxies `/api/` to the
backend on the private network, returns 404 for `/admin/`, and sets the security
headers in `frontend/nginx/default.conf` (CSP, HSTS, `X-Frame-Options: DENY`,
`X-Content-Type-Options`, referrer and permissions policy, COOP/CORP).

Provide the certificate through `TLS_CERT_PATH` and `TLS_KEY_PATH`. With
Cloudflare in front, an Origin CA certificate with Full (strict) mode is the
straightforward choice; a Let's Encrypt certificate renewed on the host works
equally well as long as the renewal hook reloads the edge container.

Keep `frontend/nginx/cloudflare-real-ip.conf` in step with Cloudflare's published
ranges, and restrict the firewall so 80/443 accept only Cloudflare addresses:

```bash
sudo ufw default deny incoming
sudo ufw allow from <your-admin-address> to any port 22 proto tcp
for range in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from "$range" to any port 443 proto tcp; done
sudo ufw enable
```

No database, ClamAV, or application port is published. The only ports reachable
from the internet are 80, 443, and the allowlisted SSH port.

### 7. Deploy an update

```bash
cd /srv/lockin
git fetch --all && git checkout <release-tag>
export LOCKIN_IMAGE_TAG=$(git rev-parse --short HEAD)
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml run --rm release
docker compose --env-file .env.production -f compose.production.yaml run --rm preflight
docker compose --env-file .env.production -f compose.production.yaml up -d backend operations-scheduler file-scan-worker edge
```

Never use a `latest` tag. Record the image digests you deployed; rollback is
redeploying the previous digests, and a database rollback needs the decision
point recorded in `docs/DEPLOYMENT_CHECKLIST.md`.

## Database backup, export, and restore

Migrations are ordinary Django migrations, version-controlled in each app's
`migrations/` package and applied only by `manage.py release`. Any
PostgreSQL-compatible tool can move the data.

### 1. Back up

```bash
scripts/production/backup-postgres.sh
```

It writes a compressed custom-format dump and a checksum, and prunes local
copies older than `BACKUP_RETENTION_DAYS`. Against a managed database, set the
owner connection URL and the same script dumps through a throwaway client
container instead of the bundled `db` service:

```bash
LOCKIN_BACKUP_DATABASE_URL="$OWNER_DATABASE_URL" scripts/production/backup-postgres.sh
```

The dump excludes owners and privileges, which is what makes it portable between
providers whose role names differ.

### 2. Verify the backup

```bash
scripts/production/verify-postgres-restore.sh <dump-file>
```

With a bundled database this restores into a scratch database on the same
server. With `LOCKIN_BACKUP_DATABASE_URL` set, or `LOCKIN_VERIFY_STANDALONE=true`,
it restores into a disposable local PostgreSQL container instead — which never
touches the production instance and proves the dump is portable to a different
server, exactly what the VPS migration depends on.

A backup that has not been restored is not a backup. Record the observed RPO and
RTO.

### 3. Restore onto another PostgreSQL server

```bash
createdb --maintenance-db="$NEW_ADMIN_URL" lockin
psql "$NEW_OWNER_DATABASE_URL" --set ON_ERROR_STOP=1 --set runtime_role=lockin_app --set runtime_password="$RUNTIME_PASSWORD" --file deploy/postgres/create-runtime-role.sql
pg_restore --no-owner --no-privileges --single-transaction --dbname="$NEW_OWNER_DATABASE_URL" lockin-<timestamp>.dump
```

### 4. Update the connection

Set `DATABASE_URL` (or `POSTGRES_HOST`/`POSTGRES_PORT`) to the new server and
keep `POSTGRES_SSLMODE` explicit.

### 5. Deploy against the new database

Run `release` then `preflight` before serving traffic. `release` reapplies the
runtime grants on the restored schema, and `preflight` proves the serving role
has no schema or audit-mutation privileges on the new server.

## Migrating private files to object storage

Deployments that still hold files on a local volume move them with one
re-runnable command. Object names do not change, so no database migration is
involved and the rollback is to point `STORAGE_BACKEND` back at the filesystem
while the local media is still intact.

1. Create the bucket and token, and set the `STORAGE_*` values on the running
   deployment **without restarting it yet**.
2. Rehearse:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml run --rm backend python manage.py migrate_managed_files --dry-run
   ```

3. Copy, verifying every object against its recorded SHA-256:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml run --rm backend python manage.py migrate_managed_files --verify-checksum
   ```

   For 2–3 GB this is minutes, not hours. The command streams, so it never
   stages a whole object in memory; `--limit` bounds a first batch, and re-runs
   skip what is already present.

4. Read the JSON summary. `missing_source` and `mismatched` must both be zero
   before you continue. The command exits non-zero if any checksum failed.
5. Restart the web and worker services with `STORAGE_BACKEND=s3`.
6. Verify in the running application: open a PDF, download it, and seek inside an
   audio file. Check that an unauthenticated request to the same file id is
   refused.
7. Keep the old volume for one full backup cycle before deleting it.

Once files are in the bucket, the VPS migration does not touch them. The bucket
is reached over the public internet from either shape, so the same
`STORAGE_ENDPOINT_URL` keeps working.

## Migration guide: container host + managed services to VPS + Docker

The application code, the authentication flow, and the frontend's API calls are
unchanged by this migration. What changes is where the containers run and where
PostgreSQL lives.

**Before the window**

1. Provision the VPS, install Docker, clone the repository at the exact release
   tag that is currently deployed.
2. Create `/secure/lockin` and every secret file. Reuse the existing
   `DJANGO_SECRET_KEY` and `PAYMENT_CODE_ENCRYPTION_KEY` values: rotating the
   secret key invalidates every session, and rotating the payment key makes
   stored recharge codes unreadable.
3. Copy the existing `STORAGE_*` values verbatim. Files stay where they are.
4. Build and start the stack against a *copy* of the database to rehearse the
   whole sequence, including `release` and `preflight`.
5. Confirm DNS TTL is low enough to cut over quickly.

**During the window**

6. Put the deployment into maintenance mode and stop the worker services, so no
   process writes after the dump is taken.
7. Take the final dump and its checksum.
8. Restore it onto the VPS database, then create the runtime role.
9. Set `DATABASE_URL` (or `POSTGRES_*`) on the VPS to the new database.
10. Run `release`, then `preflight`. Both must exit 0.
11. Start `backend`, the workers, and `edge`. Verify `/healthz`, readiness,
    login, a CSRF-protected mutation, and an authorised private file download.
12. Repoint Cloudflare's origin at the VPS. Keep the old deployment running but
    idle until you are satisfied.

**After the window**

13. Verify TLS, the security headers, that `/admin/` is 404 at the edge, and that
    the API schema is not exposed.
14. Take the first backup on the new host and verify a restore from it.
15. Decommission the old services and revoke their database credentials and any
    storage tokens they used exclusively.

The rollback at any point before step 12 is to leave Cloudflare pointing at the
container host. After step 12 it is to repoint Cloudflare back, accepting the
loss of anything written on the VPS in between; that is why the workers are
stopped for the cutover.

## Logging

Every process logs one JSON object per line to stdout, carrying a request id
that ties an API request to the work it triggered. The container host and
`docker compose logs` both collect them, and
`OBSERVABILITY_ERROR_WEBHOOK_URL` forwards errors to your own endpoint.

Because the log stream is the debugging surface, these are the categories it is
built to answer:

- Application errors: the exception type, the request id, and the route.
- Authentication problems: outcome, reason code, and rate-limit state — never
  the credential, the token, or the session key.
- Database connection issues: the failure from the connection attempt, without
  the password from the connection string.
- File upload failures: validation reason, scan state, and object name — never
  the file's bytes.
- API errors: status, error code, and the slow-request marker above
  `OBSERVABILITY_SLOW_REQUEST_MS`.

Secrets are redacted before a record is emitted, and `DEBUG` is hard-wired off in
production, so a stack trace never reaches a client.

## Security summary

| Control | Where it is enforced |
| --- | --- |
| No secret in the image or repository | `_FILE` secrets, `.dockerignore`, `.gitignore` |
| HTTPS only | `SECURE_SSL_REDIRECT`, HSTS, HTTPS-only `PUBLIC_APP_URL` and CSRF origins |
| Security headers | `frontend/nginx/default.conf`, `deploy/container-host/nginx.conf.template` |
| Session integrity | `__Host-` cookies, `Secure`, `HttpOnly`, `SameSite=Lax`, enforced CSRF |
| Rate limiting | Login, sensitive-action, community, moderation and manual-payment limits |
| Input validation | DRF serializers, plus signature and MIME checks on every upload |
| Database least privilege | Separate owner and runtime roles, verified by preflight |
| No public database or internal service | Internal Docker network, no published ports |
| Malware scanning | ClamAV, with delivery closed until a clean scan exists |
| Private file access | Entitlement-checked API delivery; no public bucket, no `/media/` route |
