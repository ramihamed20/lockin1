# Lock-in

Lock-in is a mobile-first university study platform rebuilt as a modular monolith:

- React, TypeScript, Vite, and a conservative PWA shell;
- Django and Django REST Framework;
- PostgreSQL as the primary development and production database.

Phase 2 provides the runnable foundation only. Authentication screens, the design system,
education content, quizzes, and the complete Focus workspace belong to later approved phases.

## Quick start with containers

Requirements: Docker Desktop with Compose.

1. Copy `.env.example` to `.env` and replace the two local example secrets.
2. Run `docker compose up --build`.
3. Open `http://localhost:5173`.

The development Compose file starts PostgreSQL, applies Django migrations, starts the local API,
and starts Vite. Django's development server is used only in this local workflow; the backend
image itself has a production WSGI entrypoint.

## Local tools without containers

Use Python 3.13, Node 24, and PostgreSQL 18. Create `backend/.venv`, install
`-e ".[dev]"` from the backend directory, then run migrations. Install frontend packages with
`npm ci`. Environment field descriptions are in `.env.example` and `docs/OPERATIONS.md`.

## Quality checks

From the repository root on Windows:

```powershell
.\scripts\lockin.ps1 test
```

The CI workflow runs backend linting, typing, migration checks, tests against PostgreSQL 18,
frontend linting, typing, unit tests, a production PWA build, and a Playwright smoke test.

## Source of truth

Product, architecture, decisions, phase status, and handoff information live in `docs/`.
