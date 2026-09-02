# Deployment

Last updated: 2026-09-02

This is the deployment contract for both supported shapes. Phase 1 runs the
single application image on a managed container host with managed PostgreSQL and
S3-compatible object storage. Phase 2 runs the same source on a VPS with Docker
Compose. Moving between them changes infrastructure and environment values; it
does not change application code, authentication, or the frontend's API calls.

- Which host to deploy on, and why: `docs/HOSTING.md`.
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
  +-- operations-scheduler
  +-- file-scan-worker, clamav   (file-scanning profile; not started at launch)
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

### Cloudflare R2: the exact values

R2 is reached through the generic S3 backend. Nothing below is R2-specific in
the application; these are the same names any provider uses.

| Variable | Value for R2 | Notes |
| --- | --- | --- |
| `STORAGE_BACKEND` | `s3` | Selects the S3-compatible backend |
| `STORAGE_BUCKET_NAME` | your bucket name | One bucket per environment |
| `STORAGE_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com` | The account id from the R2 dashboard, not the public `r2.dev` URL |
| `STORAGE_REGION` | `auto` | R2 has one region, and `auto` is what its S3 API expects |
| `STORAGE_ACCESS_KEY_ID` | R2 API token access key id | Scope the token to this one bucket |
| `STORAGE_SECRET_ACCESS_KEY` | R2 API token secret | On the VPS use `STORAGE_SECRET_ACCESS_KEY_FILE` |
| `STORAGE_ADDRESSING_STYLE` | `virtual` | The default; only self-hosted gateways need `path` |

Deliberately left unset: `STORAGE_PUBLIC_BASE_URL`. Do not enable R2's public
`r2.dev` domain, and do not attach a public custom domain to this bucket.
Private study material is delivered by the API, and a public bucket URL would
route around the entitlement and clean-scan checks.

Creating the token: R2 → Manage API Tokens → Create Token, permission **Object
Read & Write**, scoped to **this bucket only**. An account-wide token would let
a compromised application container reach every other bucket in the account.

### Staging validation for a storage provider

Run this against a staging bucket before any real file is written, and again
whenever you change provider. The procedure is identical for R2, MinIO, S3 and
B2, because the application has no provider-specific code.

Steps 1, 2, 3, 5 and 7 are automated. The command writes a 5 MiB probe object,
exercises the guarantees the delivery path depends on, and removes it:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm backend python manage.py validate_object_storage
```

On a container host, run the same command inside the running web service. It
prints one JSON evidence line, and every field must read as below.

| Field | Required value | What it proves |
| --- | --- | --- |
| `ranged_reads` | `true` | Reads are served by provider byte ranges (step 3) |
| `partial_read_without_full_download` | `true` | The first 4 KiB arrive without fetching all 5 MiB (step 3) |
| `full_stream_checksum_matches` | `true` | Upload and streamed read are byte-identical (steps 1, 2) |
| `ranged_read_matches` | `true` | A mid-object range returns exactly the right window (step 2) |
| `anonymous_access` | `refused_403`, or another 4xx | The bucket is not publicly readable (step 5) |
| `deleted` | `true` | The probe object was removed (step 7) |

The command fails closed rather than warning. An unsigned object URL, an
anonymously readable object, a provider that renames objects on write, or a
checksum mismatch each abort with a non-zero exit.

Steps 4 and 6 need a running application and two accounts, because they test
authorization rather than storage. With a PDF already published to a course:

```bash
# 4. An entitled student reads the file through the protected route.
curl --fail --cookie "$STUDENT_COOKIE_JAR" -o /dev/null -w '%{http_code}\n' "https://$LOCKIN_PUBLIC_HOST/api/v1/files/$FILE_ID/view"
```

```bash
# 4b. Byte ranges work through the API, which is what the PDF reader relies on.
curl --cookie "$STUDENT_COOKIE_JAR" -H 'Range: bytes=1024-2047' -o /dev/null -w '%{http_code} %{size_download}\n' "https://$LOCKIN_PUBLIC_HOST/api/v1/files/$FILE_ID/view"
```

```bash
# 6. An unauthenticated caller must be refused.
curl -o /dev/null -w '%{http_code}\n' "https://$LOCKIN_PUBLIC_HOST/api/v1/files/$FILE_ID/view"
```

```bash
# 6b. A signed-in account without the entitlement must also be refused.
curl --cookie "$OUTSIDER_COOKIE_JAR" -o /dev/null -w '%{http_code}\n' "https://$LOCKIN_PUBLIC_HOST/api/v1/files/$FILE_ID/view"
```

Expected: `200` for step 4, `206` with a `size_download` of `1024` for 4b, and
`404` for both requests in step 6. The route answers `404` rather than `403` on
purpose, so an outsider cannot use the response to confirm that a file exists.

CI runs the automated half of this on every change, against MinIO, inside the
real production image — so the generic S3 path is proven before any R2
credential is involved.

## Required production services

Production depends on two services that are not the application, and neither can
be turned off from configuration: the settings module refuses to start without
them. A third, the malware scanner, is a stated deployment decision rather than a
constant — see below.

### Malware scanning — a stated decision, disabled for the initial launch

`CONTENT_REQUIRE_CLEAN_SCAN` governs whether a managed file must carry
clean-scan evidence before it can be published or delivered. Production reads it
from the environment and **defaults to enforcing it**; a deployment that wants it
off has to say so.

**The initial launch runs with it off (`CONTENT_REQUIRE_CLEAN_SCAN=false`), and
starts neither ClamAV nor the file-scan worker.** The reason is that the upload
surface is itself the control:

- `ManagedFileUploadView` is gated by `IsCreatorOrAdministrator`. Students and
  every other unprivileged account are refused before a file is ever stored —
  including avatars. There is no other route by which a managed file enters the
  system.
- Only trusted administrators upload study material, so every stored object has a
  known, accountable origin.
- ClamAV needs roughly 1.6 GB resident and 2.4 GB during its daily signature
  reload. On a 4 GB host that is more memory than the entire rest of the
  deployment, and it cannot be made to fit beside PostgreSQL and the application.

**What does not change when it is off.** Nothing else in the file path moves with
this flag, and this is worth being precise about, because the flag is easy to
mistake for a general relaxation:

- Upload authorisation is unchanged. Unprivileged accounts still cannot upload.
- `can_access_managed_file` and every entitlement check are unchanged. A student
  still only reaches a file they are entitled to.
- Delivery still goes through the API at `/api/v1/files/`, never a public bucket
  URL. Objects stay private in the bucket.
- Files already marked `quarantined` or `failed` stay undeliverable in both
  modes. Turning enforcement off never resurrects a condemned file.
- The only difference is that a file with no scan evidence at all
  (`not_configured`) is deliverable rather than withheld.

**What it costs.** A malicious PDF uploaded by a compromised administrator
account would not be caught at ingestion. That is the risk being accepted, and it
is bounded by how few accounts can upload.

**Re-enabling is configuration only.** The scanning architecture — the ClamAV
image, the worker, the retry and quarantine model, the operator override — is
intact and covered by tests. To turn it on:

```bash
# in .env.production
CONTENT_REQUIRE_CLEAN_SCAN=true
COMPOSE_PROFILES=bundled-db,file-scanning
```

Change both together. Enforcement without a scanner leaves every upload `pending`
and undeliverable; a scanner without enforcement just burns memory. The settings
module refuses to start if enforcement is on and `FILE_SCAN_HOST` is empty, and
`manage.py check --deploy` reports `lockin.W003` on every release while
enforcement is off, so the decision is never silently inherited.

Sizing when you do enable it: plan **4 GB for the scanner alone**, or set the
`CLAMAV_CONCURRENT_RELOAD=false` build argument to halve the peak at the cost of
blocking scans during the daily reload (the worker retries with backoff, so it is
safe, just slower once a day). In practice that means moving the scanner, the
database, or both off this VPS first.

### Error webhook — mandatory

**Why.** `OBSERVABILITY_ERROR_WEBHOOK_URL` receives a redacted exception envelope:
type, request id, route, and trimmed stack frames — never bodies, credentials or
user data. Without it, a production exception exists only in a log line nobody
is watching. Production validates that the URL is HTTPS and that the token is a
dedicated secret of at least 20 characters.

**Low-cost option for Phase 1.** A Cloudflare Worker, which you already have an
account for and which is free at this volume. It verifies the bearer token and
forwards to email, Slack, or an issue tracker:

```js
export default {
  async fetch(request, env) {
    if (request.headers.get("Authorization") !== `Bearer ${env.LOCKIN_TOKEN}`) {
      return new Response("forbidden", { status: 403 });
    }
    const event = await request.json();
    await fetch(env.FORWARD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    return new Response(null, { status: 204 });
  },
};
```

Sentry works too, through a small adapter, if you want grouping and history.

### StatsD — mandatory

**Why.** `OBSERVABILITY_STATSD_HOST` receives request timing, slow-request
markers above `OBSERVABILITY_SLOW_REQUEST_MS`, and domain counters. It is how
you see a degradation that never raises an exception — a query that got slower,
a scan queue that stopped draining. Metrics are sent over UDP, fire-and-forget:
an unreachable collector never fails a request, which is also why an unreachable
collector is easy not to notice.

**Low-cost option for Phase 1.** Run `prom/statsd-exporter` as a private
companion (tens of MB of memory), and scrape it from Grafana Cloud's free tier
or a local Prometheus. On the VPS that is one more Compose service on the
internal network; nothing is exposed publicly.

### The trade-off, stated plainly

ClamAV is the component that decides how the deployment is sized and where it can
run. It is the largest single memory consumer in the whole architecture — larger
than the application — and it must run continuously on a private network with a
persistent volume for its signature database. On a VPS it is a Compose service
with a memory limit. On a managed host it is a separate paid instance sized for
4 GB, which is what makes the Phase 1 economics turn (see `docs/HOSTING.md`).

Where a host cannot run it, there are two honest responses, and which one applies
depends entirely on who can upload:

- **If uploads are open to ordinary users, move to a host that can run it.**
  Untrusted input reaching storage unscanned is not a trade to make.
- **If uploads are restricted to trusted operators**, as they are here — see
  "Malware scanning" above — running without it is a defensible decision, because
  the authorisation on the upload endpoint is doing the work the scanner would
  otherwise do at ingestion. State it with `CONTENT_REQUIRE_CLEAN_SCAN=false` and
  keep the profile stopped.

What is not defensible in either case is enabling enforcement with no scanner
reachable, or widening upload permissions while scanning is off.

## ClamAV architecture

This is the architecture the `file-scanning` profile starts. It is not running in
the launch shape; it is kept intact and documented so that enabling it later is a
configuration change rather than a rebuild.

The simplest production architecture is a single private companion service that
the file-scan worker talks to over TCP 3310, and that nothing else can reach.

```
file-scan-worker ──clamd INSTREAM, TCP 3310──► clamav
      │                                          │
      │                                    signature volume
      ▼                                    (freshclam, daily)
  object storage                           no public address
```

**Properties this architecture must have.**

- **Never publicly exposed.** clamd has no authentication whatsoever: anything
  that can open TCP 3310 can submit files and read verdicts. On the VPS it sits
  on the `data` network, which is `internal: true`, with no published port. On a
  managed host it must be a private service with no public address.
- **Only the worker talks to it.** The web service does not scan; it records an
  upload as pending and returns. Scanning is asynchronous by design, so a slow
  scan cannot slow a request.
- **A persistent volume for signatures.** Without it, every restart re-downloads
  roughly 1 GB from the ClamAV mirrors and the service is unavailable for
  minutes while it does.
- **Sized for the reload.** See the memory numbers above.
- **`StreamMaxLength` raised to 100 MB.** clamd's default is 25 MiB, which would
  silently refuse the 90 MB audio uploads the application accepts.
  `deploy/clamav/Dockerfile` sets this and asserts it at build time.

On the VPS this is already configured in `compose.production.yaml`: the `clamav`
service, the `lockin_clamav_signatures` volume, `mem_limit: 4g`, and the
internal `data` network.

**On a managed container host**, create it as a private service from
`deploy/clamav`, with a persistent disk mounted at `/var/lib/clamav`, sized for
4 GB of memory, with no public URL. Then set `FILE_SCAN_HOST` on the web service
and both workers to its private hostname. Verify before launch:

- The scanner is reachable from the worker on 3310 over the private network.
- It is **not** reachable from the public internet. Test this explicitly; do not
  assume it from the absence of a public URL in the dashboard.
- A test upload transitions from `pending` to `clean`, and the EICAR test string
  transitions to `quarantined`.

Provider support for this shape is assessed in `docs/HOSTING.md`.

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
5. **Create the ClamAV private service** from `deploy/clamav`, following
   [ClamAV architecture](#clamav-architecture). It must have a persistent disk,
   4 GB of memory, and no public address. Set `FILE_SCAN_HOST`/`FILE_SCAN_PORT`
   on the web service and both workers.
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

**Minimum for the launch shape** (no malware scanner, bundled PostgreSQL,
private media in object storage): **2 vCPU, 4 GB RAM, 40 GB SSD**, Linux, root
access. Expect roughly 1.3 GB resident at idle and 1.5-2.1 GB under early
traffic, leaving the remainder as page cache for PostgreSQL.

**Add 4 GB of RAM before enabling the file-scanning profile.** ClamAV alone needs
more memory than everything else here combined.

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
docker compose version
```

### 1b. Add swap

4 GB with no swap gives the kernel no room to manoeuvre: a single spike — a
signature-verification burst, a large `pg_dump`, an unusually heavy scheduled
job — turns into an OOM kill, and the victim is chosen by the kernel, not by
you. 2 GB of swap absorbs those spikes. It is not there to be used routinely;
if the system swaps steadily, the host is undersized.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# Prefer reclaiming page cache over swapping application memory.
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-lockin-swap.conf
sudo sysctl --system
free -h
```

The Compose file also sets an explicit `mem_limit` on every service. Those are
ceilings that stop a runaway process from taking the host down with it; they sum
to more than 4 GB deliberately, because they are limits rather than
reservations, and swap covers the rare case where several approach theirs at
once.

### 1c. Tune PostgreSQL for 4 GB

The `postgres` defaults assume a machine that is not also running the
application. These values suit a 4 GB host shared with Gunicorn, and are applied
by appending a `command:` to the `db` service or by editing `postgresql.conf` in
the data volume:

| Setting | Value | Why |
| --- | --- | --- |
| `shared_buffers` | `512MB` | Up from the 128 MB default; still leaves room for the application and page cache. |
| `effective_cache_size` | `1536MB` | A planner hint, not an allocation. Tells the planner what the OS is likely caching. |
| `work_mem` | `8MB` | Per sort or hash node. Modest, because a complex query can use several at once. |
| `maintenance_work_mem` | `128MB` | Makes `VACUUM` and index builds finish rather than crawl. |
| `max_connections` | `50` | The application opens at most ~30 (3 workers x 8 threads, plus the scheduler). Lower is safer than the 100 default. |
| `max_parallel_workers_per_gather` | `1` | Two cores are shared with the application; wide parallelism costs more than it returns. |
| `random_page_cost` | `1.1` | SSD-backed storage, so random reads are not 4x sequential. |

```yaml
  db:
    command: >-
      postgres
      -c shared_buffers=512MB
      -c effective_cache_size=1536MB
      -c work_mem=8MB
      -c maintenance_work_mem=128MB
      -c max_connections=50
      -c max_parallel_workers_per_gather=1
      -c random_page_cost=1.1
```

`shm_size: 256mb` is already set on the service: PostgreSQL's parallel workers
allocate dynamic shared memory, and Docker's 64 MB default makes them fail with
"could not resize shared memory segment".

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

### 5. Rehearse the edge before the first boot

Put the TLS certificate and key in place first, owned as step 7 describes; the
rehearsal reads them the same way the deployment will.

The edge is the one container whose security settings can stop it starting:
read-only root, every capability dropped, and a single tmpfs for writes. Neither
a build nor `nginx -t` exercises any of that. Prove it on this host before it
matters:

```bash
scripts/ci/edge-smoke.sh "$LOCKIN_IMAGE_REPOSITORY-edge:$LOCKIN_IMAGE_TAG"
```

It starts the real image with the production security options against a stub
upstream, and asserts the container stays up, runs as uid 10001, attempts no
chown, keeps its temporary paths writable, reads the private key, serves
`/healthz` on both listeners, proxies `/api/v1/health/ready`, serves the SPA,
and keeps `/admin/` closed. CI runs the same script on every change, so this is
a confirmation rather than a discovery — but it is a cheap one, and it uses this
host's kernel and Docker version rather than the runner's.

### 6. Start the deployment

Images come from the registry CI published them to. The VPS never builds: a
frontend build peaks near 2 GB, which this host cannot spare beside PostgreSQL
and a running application, and a host build makes the deployed artefact
unreproducible. Set `LOCKIN_IMAGE_REPOSITORY` and `LOCKIN_IMAGE_TAG` in
`.env.production` to the values the CI publish job printed, then:

```bash
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml up -d db
docker compose --env-file .env.production -f compose.production.yaml run --rm release
docker compose --env-file .env.production -f compose.production.yaml run --rm preflight
docker compose --env-file .env.production -f compose.production.yaml up -d backend operations-scheduler edge
```

Omit the `up -d db` line when using a managed database. `release` and `preflight`
must each exit 0; retain the preflight JSON as release evidence — it now records
`clean_scan_enforced`, so the scanning decision is part of the release record.

The launch shape starts no `file-scan-worker`. Add it to the last line, and
`file-scanning` to `COMPOSE_PROFILES`, only together with
`CONTENT_REQUIRE_CLEAN_SCAN=true`.

### 7. Reverse proxy and HTTPS

The `edge` service is the reverse proxy. It terminates TLS on 443, redirects 80
to 443, serves the SPA and collected static assets, proxies `/api/` to the
backend on the private network, returns 404 for `/admin/`, and sets the security
headers in `frontend/nginx/default.conf` (CSP, HSTS, `X-Frame-Options: DENY`,
`X-Content-Type-Options`, referrer and permissions policy, COOP/CORP).

Provide the certificate through `TLS_CERT_PATH` and `TLS_KEY_PATH`. With
Cloudflare in front, an Origin CA certificate with Full (strict) mode is the
straightforward choice; a Let's Encrypt certificate renewed on the host works
equally well as long as the renewal hook reloads the edge container.

**The certificate and key must be readable by uid 10001.** The edge runs
unprivileged, so the nginx master that reads them at start-up is uid 10001, not
root. A key left as root-owned `0600` cannot be read, and the container exits
before it binds a port:

```bash
sudo chown 10001:10001 "$TLS_CERT_PATH" "$TLS_KEY_PATH"
sudo chmod 0644 "$TLS_CERT_PATH"
sudo chmod 0640 "$TLS_KEY_PATH"
```

Do the same in the certificate renewal hook, before it reloads the edge — a
renewal that restores root ownership breaks the next restart rather than the
current one, which is a considerably worse failure to debug.

Why unprivileged: nginx creates its temporary-path directories at start-up and,
under a root master with a `user` directive, chowns each one to that user. The
edge runs with `cap_drop: ALL`, so that chown has no CAP_CHOWN to draw on, and
its `/tmp` is a fresh tmpfs on every boot, so the directories never already
exist and the chown always runs. A root nginx master therefore cannot start in
this container at all. Running the master as uid 10001 removes the operation
instead of the restriction: nginx leaves the configured user unset when it is
not root, and skips the chown entirely. Both listeners are above 1024, so
binding needs no capability either.

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

### 8. Deploy an update

CI builds and pushes an image for every commit on `main` and prints the exact
tag. Deploying is pulling that tag — there is no build step on the host.

```bash
cd /srv/lockin
git fetch --all && git checkout <release-tag>
# The tag CI published, not a local git hash, and never "latest".
export LOCKIN_IMAGE_TAG=<sha-from-the-ci-publish-job>
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml run --rm release
docker compose --env-file .env.production -f compose.production.yaml run --rm preflight
docker compose --env-file .env.production -f compose.production.yaml up -d backend operations-scheduler edge
```

Before the first publish, set the repository variables the frontend image needs:
`LOCKIN_SUPPORT_EMAIL`, `LOCKIN_LEGAL_ENTITY`, `LOCKIN_LEGAL_ADDRESS`,
`LOCKIN_LEGAL_JURISDICTION`, `ACCOUNT_POLICY_VERSION`. They are public build
inputs, not secrets, and the image refuses to build on placeholders.

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

## Migrating existing private files to object storage

Roughly 2–3 GB of PDFs currently sit on a local volume. This runbook moves them
without a maintenance window and without a database migration.

Why it is safe to interrupt and re-run: the object name never changes, so the
database needs no update and the operation is addressed by name rather than by
position. An object already present at the destination is skipped, so a run that
is killed halfway resumes where it stopped. Nothing is deleted from the source,
so the rollback is a configuration change while the local files are still there.

Set `STORAGE_*` on the deployment **without restarting it** for steps 1–5. The
running application keeps serving from local storage; the command below talks to
the bucket in a separate one-shot container.

Below, `RUN` is the one-shot container the commands execute in:

```bash
RUN="docker compose --env-file .env.production -f compose.production.yaml run --rm backend python manage.py"
```

On a container host, replace it with an exec into the running web service.

### 1. Dry run — count the work, write nothing

```bash
$RUN migrate_managed_files --dry-run
```

Read `examined` and `copied` against what you expect, and confirm
`missing_source` is `0`. A non-zero `missing_source` means the database
references files the volume no longer has; investigate before continuing,
because those rows will still be broken after the migration.

### 2. A small batch first

```bash
$RUN migrate_managed_files --limit 10 --verify-checksum
```

This proves credentials, permissions, network path and checksums against real
data. `copied` should be `10`, `verified` `10`, `mismatched` empty.

### 3. Verify the batch independently

```bash
$RUN migrate_managed_files --verify-only --limit 10
```

`--verify-only` reads the destination and compares each object against the
SHA-256 recorded at upload. It writes nothing.

### 4. The full migration

```bash
$RUN migrate_managed_files --verify-checksum
```

The first ten are skipped as already present. Expect a few minutes for 2–3 GB.
The command streams object by object, so memory use is flat regardless of total
size. If it is interrupted, run the same command again.

### 5. Verify everything

```bash
$RUN migrate_managed_files --verify-only
```

Required before switching over: `mismatched` empty and `missing_destination` `0`.
The command exits non-zero if either fails, so it is safe to use as a gate in a
script.

### 6. Switch the application over

Set `STORAGE_BACKEND=s3` and restart the web service and both workers. Then
confirm with real traffic: open a PDF, download one, seek inside an audio file,
and check that an unauthenticated request for the same file id is refused.

```bash
$RUN validate_object_storage
```

### 7. Keep the old volume

Keep it for at least one full backup cycle. It is the rollback, and it is also
the only remaining copy of anything the checksums could not verify.

### Rolling back to local storage

Only possible while the local volume is intact, which is why step 7 matters.

```bash
# 1. Point the deployment back at the filesystem.
#    Production refuses local media unless the exception is explicit.
STORAGE_BACKEND=filesystem
STORAGE_ALLOW_LOCAL_MEDIA=true
```

```bash
# 2. Restart the web service and the scheduler (add file-scan-worker only if
#    the file-scanning profile is enabled).
docker compose --env-file .env.production -f compose.production.yaml up -d backend operations-scheduler
```

Nothing else changes: object names are identical in both places, so no row is
rewritten and no file is renamed. Files uploaded *after* the switch to object
storage exist only in the bucket, so copy them back before rolling back if
uploads have happened since:

```bash
$RUN migrate_managed_files --verify-only
```

Run that first to list what the bucket holds; anything reported as present that
predates the volume is what you would lose. In practice, roll back promptly or
not at all.

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

### Rotation

The log stream is also the fastest way to fill the deployment disk. Three lines
per request across nginx, Gunicorn and the application is roughly 600 bytes, so a
million requests a day writes close to a gigabyte a day into Docker's JSON log
files, which have no size limit of their own.

Every service therefore caps its own logs in `compose.production.yaml`:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

That bounds the whole deployment to well under 300 MB of logs. It also bounds how
far back `docker compose logs` reaches, so ship anything you need to keep for
longer to the error webhook or an off-host collector rather than relying on the
container log as an archive.

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
| Malware scanning | Opt-in `file-scanning` profile; off at launch because only trusted administrators can upload |
| Private file access | Entitlement-checked API delivery; no public bucket, no `/media/` route |
| Unprivileged runtime | Backend, workers and edge all run as uid 10001; no container has a root process |
| Container hardening | Read-only roots, `cap_drop: ALL`, `no-new-privileges`, writes only through declared tmpfs |
| Start-up under those settings | `scripts/ci/edge-smoke.sh` and `scripts/ci/docker-smoke.sh`, both gated in CI |
