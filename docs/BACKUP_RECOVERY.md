# Backup and Recovery Runbook

Last updated: 2026-07-19

## Recovery objectives

Final RPO/RTO are business inputs and must be measured in staging. Initial operational target for
planning only: database/media RPO <= 24 hours and service RTO <= 4 hours. Do not publish these as an
SLA until restore drills demonstrate them.

## Backup set

One recovery set contains:

1. PostgreSQL custom-format dump and SHA-256 sidecar;
2. encrypted private-media volume/object snapshot and manifest/hash;
3. exact application image digests and commit SHA;
4. non-secret environment/configuration version and migration list;
5. backup-set ID, UTC start/end, operator, database transaction boundary, retention class.

Static assets are reproducible from the edge/backend images and do not replace source/image retention.
Secrets are backed up through the approved secret manager, never copied into the application backup.

## PostgreSQL backup

```sh
BACKUP_RETENTION_DAYS=30 \
  ./scripts/production/backup-postgres.sh .env.production /encrypted/lockin-backups
```

When the database is managed rather than bundled, set `LOCKIN_BACKUP_DATABASE_URL` to the owner
connection URL. The script then dumps through a throwaway PostgreSQL client container instead of
executing inside the `db` service; every other guarantee below is unchanged. Restore verification
switches to a disposable local container in the same case, so verification never creates a scratch
database on the production instance.

The script uses restrictive permissions, writes a partial file first, creates a compressed custom
dump, validates the catalog, atomically renames it, emits a SHA-256 sidecar, and only then removes
completed local Lock-in dumps older than `BACKUP_RETENTION_DAYS` from that exact directory. The
default is 30 days; set it to `0` to disable local pruning. Copy the completed set to encrypted
off-host storage with its own retention/immutability controls before relying on the local prune.

Recommended starting cadence pending measured write volume: daily full logical dump, provider-level
encrypted volume snapshots at least daily, and PostgreSQL WAL/PITR only after the hosting provider
and operational ownership are approved. Keep at least one geographically separate copy.

## Coordinated media backup

Pause or fence file-ingestion writes for the snapshot boundary, or use a storage provider with
versioned point-in-time snapshots. Record the database dump and media snapshot in the same set. A
database-only restore may reference missing files; a media-only restore may contain unreferenced data.

Private media lives in S3-compatible object storage, not on a container volume (see
`docs/DEPLOYMENT.md`). That changes how the media half of the set is produced:

- Enable object versioning, or a lifecycle rule that retains noncurrent versions, so a deleted or
  overwritten object is recoverable to the boundary the database dump was taken at. Object storage
  is durable, not a backup: it replicates a deletion as faithfully as a write.
- Keep at least one copy under a separate credential, ideally in a different account or provider, so
  a compromised deployment token cannot destroy both the live objects and their history.
- Record the bucket, the key prefix (`STORAGE_LOCATION_PREFIX`), and the point in time in the
  backup-set manifest, alongside the database dump.
- Recovering an individual object is a provider-side restore of that key. Because `ManagedFile` rows
  carry the object name and its SHA-256, a restored object can be verified against the database
  before the file is trusted again.
- Rehearse the object half of the restore on the same cadence as the database half. A set whose
  media half has never been restored is a database backup, not a recovery set.

Before multi-host deployment, replace the single-host Docker media volume with approved durable
object storage while preserving private authorization and immutable original-file behavior.

## Restore verification

```sh
./scripts/production/verify-postgres-restore.sh \
  /encrypted/lockin-backups/lockin-YYYYMMDDTHHMMSSZ.dump .env.production
```

The script checks the hash when present, restores to a uniquely named disposable database with
`--exit-on-error`, verifies readable migration history, and drops the verification database in a
cleanup trap.

A complete quarterly drill must also restore matching media, start the exact images in isolation,
run `release` then runtime `preflight`, authenticate a test user, open representative private files,
and reconcile/rebuild derived projections using documented commands. Record actual RPO/RTO.

## Disaster recovery sequence

1. Declare incident, identify decision owner, stop or fence writes, and preserve logs/evidence.
2. Choose the latest internally consistent DB/media backup set; verify hashes and image digests.
3. Restore into an isolated environment first; never overwrite the only existing copy.
4. Validate PostgreSQL, migration history, row counts/checks, media manifests, and critical journeys.
5. Rotate credentials if compromise is possible; validate TLS/DNS/monitoring.
6. Run release as owner and preflight as runtime. Do not bypass privilege/unsafe-file checks.
7. Switch traffic, watch errors/latency/data consistency, and retain the old environment read-only.
8. Rebuild derived analytics/motivation/commerce projections only from authoritative evidence and
   inspect results before publication.
9. Document lost interval, affected records/users, notification/legal obligations, and follow-up.

## Migration rollback planning

- Every migration must be classified before release: backward-compatible, forward-fix only, or
  destructive/data-transforming.
- Prefer expand/migrate/contract across releases for large or compatibility-sensitive changes.
- Test reverse migrations on a restored staging backup; `migrations` being syntactically reversible
  is not proof that data restoration is safe.
- Never roll back the application to code that cannot read the new schema.
- For irreversible corruption/data loss, restore a verified backup and reconcile the approved lost
  transaction window rather than manually patching authoritative history.

## Retention and access

The 30-day local default is an operational safety net, not an approved legal retention policy.
Backup retention, deletion, residency, legal hold, and encryption-key ownership require legal and
operations approval. Restrict backup read/restore roles, log every restore, test key recovery, and
alert on failed/missing/undersized backups and stale restore verification. Backups are not considered
launch-proven until a matching database/media set has passed the complete restore drill above.
