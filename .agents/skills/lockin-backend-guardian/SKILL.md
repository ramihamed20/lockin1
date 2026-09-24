---
name: lockin-backend-guardian
description: Implement or review Lock-in Django/DRF/PostgreSQL backend changes while preserving domain boundaries, authorization, transactions, data integrity, query efficiency, migrations, and production safety. Use for backend features, fixes, models, services, selectors, views, permissions, storage, or database work.
---

# Lock-in Backend Guardian

Treat Django/PostgreSQL as the authoritative business layer.

## First principles

- Preserve the modular-monolith domain boundary.
- Keep transport concerns in views/serializers and business invariants in services/domain logic.
- Prefer selectors/read models for non-trivial queries.
- Do not duplicate another domain's business rule.
- Frontend gating is never authorization.
- PostgreSQL constraints should enforce durable invariants when appropriate.
- Avoid new infrastructure such as Redis/Celery/WebSockets unless the repository has approved it.

## Before editing

1. Read relevant `AGENTS.md`.
2. Trace the endpoint/service/model path.
3. Identify the authoritative invariant.
4. Find existing tests and sibling patterns.
5. Check whether another domain already owns the rule.

## API and authorization

For every state-changing endpoint:
- authentication requirement is explicit
- permission/capability check is server authoritative
- object-level access is enforced
- CSRF/session behavior stays correct
- no unauthorized existence or answer-key leakage
- stable error envelope is preserved

For privileged actions:
- test direct API denial, not only hidden UI
- preserve audit/security evidence where the domain uses it

## Transactions and concurrency

Use `transaction.atomic()` when multiple writes form one invariant.

Consider:
- uniqueness
- idempotency
- `select_for_update()` when concurrent mutation matters
- retry-safe external callbacks
- duplicate submissions/approvals
- ordering of state transitions
- `transaction.on_commit()` for post-commit side effects when the codebase follows that pattern

Do not "fix" a concurrency bug with frontend disabling alone.

## Models and migrations

When changing models:
- inspect existing constraints/indexes
- prefer explicit DB constraints for durable invariants
- make migration intent clear
- avoid destructive migrations without a safe rollout path
- run `makemigrations --check --dry-run` when appropriate
- consider existing production rows, nullability, defaults, and backfill cost

Never edit applied migration history casually.

## Query discipline

Watch for:
- N+1 queries
- unbounded lists
- repeated `.exists()`/`.count()` loops
- missing `select_related` / `prefetch_related`
- expensive per-row Python work
- indexes missing from high-frequency filters/orderings

Measure or inspect query behavior before speculative optimization.

## Storage/files

For private files:
- permission lives in application logic
- bytes stay behind the storage abstraction
- do not expose raw private object URLs by accident
- validate type/size/path
- preserve scan/quarantine semantics
- never trust filename/content-type alone

## Production safety

Never:
- commit secrets
- place credentials in code
- silently weaken production fail-closed settings
- run destructive production commands unless explicitly requested
- add a fake production provider

## Validation

Select targeted backend tests with `lockin-test-selector` when available.

Typical checks:
- ruff
- mypy for affected typed surfaces
- Django check
- migration drift
- direct pytest module/class/test
- PostgreSQL-specific coverage when database behavior matters

## Completion report

BACKEND RESULT
INVARIANT: <what remains true>
AUTHZ: <what was verified>
DB/TRANSACTION: <impact>
API CONTRACT: <impact>
TESTS: <evidence>
RISK: <remaining risk or none>
