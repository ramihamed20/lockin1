# Backend Guidance

Use `lockin-backend-guardian` for backend implementation/review.

- Django/DRF/PostgreSQL are authoritative for business rules.
- Keep domain ownership explicit; do not reach into another app's internals when an application service/selector exists.
- Server permissions are authoritative; frontend visibility never grants access.
- Preserve session + CSRF security.
- Use transactions, DB constraints, idempotency, and locking when invariants require them.
- Treat private files as untrusted and keep delivery behind the storage/permission abstraction.
- Model changes require migration-drift review and existing-data consideration.
- Prefer targeted pytest first; PostgreSQL-specific behavior needs PostgreSQL evidence.
