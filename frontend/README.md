# Dentify frontend

Vite/React 18 frontend for the existing Django API. It requires Node `24.16.0`
(the repository `.nvmrc` is the source of truth).

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

The development server runs on `http://127.0.0.1:5050` and proxies `/api/v1`
to Django at `http://127.0.0.1:8000`. Start the Django backend separately,
using its existing local-development instructions. For a deployment, serve the
frontend and `/api/v1` from the same site so Django's session and CSRF cookies
remain same-origin.

```powershell
npm run build
npm run preview
```

See `FRONTEND_ADAPTATION_REPORT.md` for the integration contract and known
backend feature gaps.
