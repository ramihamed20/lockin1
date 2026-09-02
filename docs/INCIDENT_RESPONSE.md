# Incident Response Runbook

Last updated: 2026-08-31

## First response

1. Name an incident commander and a communications owner; record UTC start time and release ID.
2. Preserve structured logs, request IDs, scheduler state, metrics, and provider evidence. Never paste
   tokens, recharge codes, private file URLs, raw request bodies, or personal records into chat.
3. Classify impact: availability, integrity, confidentiality, payment, or recoverability.
4. Stop the unsafe operation with the narrowest reversible control. Maintenance mode is preferred to
   ad-hoc database writes; stop uploads if scanning or file authorization is uncertain.
5. Page the named on-call owner through the approved monitoring destination and start a timeline.

## Scenario actions

| Incident | Immediate action | Recovery evidence |
|---|---|---|
| Outage / elevated 5xx | Check edge, backend readiness, PostgreSQL, release ID, and job failures; enable maintenance mode if writes are unsafe. | Health, error rate, latency, representative sign-in and material-open smoke tests. |
| PostgreSQL issue | Fence writes, preserve database logs, check capacity/locks/replication; never restore over the only copy. | Isolated restore or database recovery plus release/preflight and consistency checks. |
| OAuth outage | Disable only the affected provider configuration; keep password sign-in available when supported. | Provider callback test, state/nonce validation, and successful existing-user sign-in. |
| Email failure | Stop email campaigns, inspect SMTP response and failed deliveries; do not log message bodies. | Test verification/reset email and campaign delivery record. |
| Malware scanner outage | Stop file ingestion/publication, inspect ClamAV health and pending/stale queue; keep the clean-scan gate enabled. | EICAR rejection, clean PDF scan, queue recovery, and alert receipt. |
| File authorization bug | Disable affected delivery path or unpublish content, preserve access logs, identify stale URLs and entitlements. | Re-run replace/unpublish/archive/expiry/suspension denial matrix. |
| Payment issue | Disable new checkout/manual review path, preserve opaque internal references and audit records, reconcile from authoritative provider state. | Idempotent replay/reconciliation and finance-owner approval. |
| Leaked secret | Revoke/rotate at the source, invalidate dependent sessions or signatures, search redacted logs, and assess exposure. | Old credential rejected, new credential works, deployment/preflight green. |
| Failed deploy | Stop rollout, retain old environment read-only where possible, follow compatible-image rollback policy. | Release/preflight, migration compatibility, health, smoke, and alert checks. |
| Restore | Follow `BACKUP_RECOVERY.md`; choose one consistent database/media set and restore in isolation first. | Hashes, migration history, private file opens, RPO/RTO, and operator record. |

## Closeout

Do not close on symptom disappearance alone. Record root cause, affected interval and users, data
integrity/privacy impact, commands and approvals, alert effectiveness, permanent action owner, and
deadline. Security/privacy notification decisions belong to the approved incident and legal owners.
