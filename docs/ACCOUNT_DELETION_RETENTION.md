# Account Deletion and Retention Decision Matrix

Last updated: 2026-08-31

The application now supports a password-protected request, single-use email confirmation, status
tracking, cancellation before processing, security events, and append-only audit evidence. Confirmed
requests are deliberately **not** erased or anonymized until this matrix is approved. Suspension,
deactivation, deletion, and anonymization are distinct operations.

| Data class | Proposed technical action | Retention/legal decision | Approval |
|---|---|---|---|
| Profile, email, social identity, avatar | Remove eligible media; replace direct identifiers with a non-reversible tombstone where references must survive. | Define completion deadline and identity fields that must be erased. | PENDING |
| Sessions, reset/OAuth tokens, auth-attempt buckets | Revoke immediately at processing start; delete expired operational rows on schedule. | Confirm security-log retention window. | PENDING |
| Focus annotations, study plans, progress, attempts, reviews | Delete or anonymize user-owned learning records while preserving no re-identifying join key. | Decide whether any learner records must be retained and for how long. | PENDING |
| Community content and moderation work | Anonymize authorship or delete where safe; preserve moderation integrity only when approved. | Decide public-thread continuity, legal hold, and abuse evidence policy. | PENDING |
| Creator uploads and published learning objects | Transfer ownership, unpublish, or delete through an operator-reviewed workflow; never orphan private blobs. | Product owner must define ownership/licensing continuity. | PENDING |
| Payments, invoices, refunds | Preserve only fields and duration explicitly required; detach/anonymize other profile identifiers. | Finance/legal owner must define statutory and dispute retention. | PENDING |
| Security and append-only audit logs | Preserve a minimized tombstoned subject reference only when required; keep secrets and unnecessary PII out. | Approve purpose, duration, access, and legal-hold behavior. | PENDING |
| Backups | Deletion applies prospectively; restored backups must replay confirmed deletions before service. | Approve backup expiry window and exception/legal-hold procedure. | PENDING |

## Processing gate

No operator or scheduled command may mark a request `processing` or `completed` until every row has
an owner-approved action and retention duration, `ACCOUNT_DELETION_POLICY_VERSION` identifies that
approval, restore handling is tested, and completion/audit behavior has regression coverage. Until
then the UI accurately reports a confirmed request as awaiting approved retention processing.
