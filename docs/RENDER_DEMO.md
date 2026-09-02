# Public demo on Render

This is a disposable demonstration deployment. It builds the Vite frontend and serves it beside Django through one public Render URL, so browser sessions and `/api/v1` remain same-origin.

For a real deployment, follow `docs/DEPLOYMENT.md` instead. It uses the same image and the same entry point with `config.settings.production`, the release/preflight contract, object storage, and separate worker services.

## Render service

Create a **Web Service** from the `codex/phase-11-production-readiness` branch with:

- Name: `lockin1`
- Language: `Docker`
- Region: Oregon (or the region nearest to the demo audience)
- Root directory: leave empty
- Build command: leave empty
- Start command: leave empty
- Health check: `/api/v1/health/ready`
- Instance type: Free (demo only)

The root `Dockerfile` builds the frontend and starts Nginx plus Django on the single Render service URL through `deploy/container-host/start.sh`. With demo settings that entry point migrates, collects static assets, and seeds; with production settings it runs the full release and preflight contract instead.

## Environment variables

Set these under Render **Environment**. Do not commit any of these values.

| Key | Value |
| --- | --- |
| `DJANGO_SETTINGS_MODULE` | `config.settings.demo` |
| `DJANGO_SECRET_KEY` | Generate a secret in Render (at least 50 characters) |
| `DATABASE_URL` | Supabase PostgreSQL connection string (secret) |
| `DJANGO_ALLOWED_HOSTS` | `lockin1.onrender.com` |
| `PUBLIC_APP_URL` | `https://lockin1.onrender.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://lockin1.onrender.com` |
| `ACCOUNT_POLICY_VERSION` | `demo-1` |
| `POSTGRES_SSLMODE` | `require` |
| `LOCKIN_DEMO_SEED` | `true` |
| `STORAGE_BACKEND` | `filesystem` (the demo keeps its throwaway files on the container disk) |

If Render gives the service a different public host, replace `lockin1.onrender.com` in all three host/URL values before deploying.

## Supabase

Create a blank project, then open **Connect** and copy a PostgreSQL URI appropriate for an external application. Add it only as Render's `DATABASE_URL` secret. The demo start command runs migrations and seeds public test data automatically.

The seeded credentials are deliberately public demo accounts; do not use this deployment for private user data or production traffic.
