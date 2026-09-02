# Lock-in

Lock-in is a mobile-first university study platform rebuilt as a modular monolith:

- React, TypeScript, Vite, and a conservative PWA shell;
- Django and Django REST Framework;
- PostgreSQL as the primary development and production database.

Implemented through Phase 11: secure accounts/roles; English/Arabic responsive design; generic
education hierarchy; versioned learning objects and private files; discovery, progress, and a
next-action dashboard; server-authoritative assessments and spaced review; and contextual learning
community with evidence-based moderation; plus independent XP, achievements, rankings, streaks, and
in-app notifications; server-authoritative subscriptions/entitlements; and dedicated capability-
based operations, event projections, reporting, immutable audit, safe actions/configuration, and
provider-neutral observability; the complete independent Focus workspace; and a hardened production
baseline with Nginx, Gunicorn, PostgreSQL role separation, release/preflight, backup/restore tooling,
security review, performance budgets, and required CI. Real payment/notification/monitoring/scanner
providers remain explicit launch inputs.

## Quick start with containers

Requirements: Docker Desktop with Compose.

1. Copy `.env.example` to `.env` and replace the two local example secrets.
2. Run `docker compose up --build`.
3. Open `http://localhost:5173`.

The development Compose file starts PostgreSQL, applies Django migrations, starts the local API,
and starts Vite. Django's development server is used only in this local workflow; the backend
image itself has a production WSGI entrypoint.

## Local tools without containers

Use Python 3.13, Node 24, pnpm 11.19, and PostgreSQL 18. Create `backend/.venv`, install
`-e ".[dev]"` from the backend directory, then run migrations. Install frontend packages with
`pnpm install --frozen-lockfile`. Environment field descriptions are in `.env.example` and
`docs/OPERATIONS.md`.

## Quality checks

From the repository root on Windows:

```powershell
.\scripts\lockin.ps1 test
```

The CI workflow runs backend linting, typing, migration checks, the full PostgreSQL 18.4 suite,
owner release/runtime preflight, frontend dependency audit/lint/type/coverage/build/budgets, the full
desktop/mobile Playwright suite, image builds, Nginx validation, Compose validation, and an aggregate
fail-closed quality gate.

## Production deployment

`docs/DEPLOYMENT.md` is the deployment contract. It covers both supported shapes and the
migration between them:

- **Managed container host**: the root `Dockerfile` builds one image with the SPA, the Django API
  and Nginx on one origin, against managed PostgreSQL (`DATABASE_URL`) and S3-compatible object
  storage. Background workers run the same image with their own commands.
- **VPS**: `compose.production.yaml` runs the edge, backend, workers, scanner and, optionally, a
  bundled PostgreSQL container behind `COMPOSE_PROFILES=bundled-db`.

Both read the same environment variables, so moving between them changes infrastructure rather than
code: authentication, the frontend API base URL and the database schema are untouched. Private files
live in object storage in both, and do not move during a migration.

Start with `docs/PHASE_11_PRODUCTION_READINESS.md` and execute `docs/DEPLOYMENT_CHECKLIST.md`. Real secrets are
file-mounted; PostgreSQL owner and runtime credentials must differ; the one-shot release must
complete before runtime preflight/backend/edge.

`scripts/production/backup-postgres.sh` and `verify-postgres-restore.sh` create and verify logical
database backups. A complete recovery set must also include coordinated encrypted private media and
exact image/config evidence as defined in `docs/BACKUP_RECOVERY.md`.

The current workstation has no Docker, PostgreSQL server, or `psql`. Local SQLite tests, static
analysis, production frontend builds, browser checks, and current dependency audits are available;
PostgreSQL concurrency, container, TLS, and runtime-role evidence must still come from mandatory CI
and production-equivalent staging for the exact commit.

## Source of truth

Product, architecture, decisions, phase status, and handoff information live in `docs/`.
