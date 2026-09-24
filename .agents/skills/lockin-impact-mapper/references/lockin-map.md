# Current Lock-in architecture cues

Use the repository as source of truth and refresh assumptions when files change.

Observed architecture:
- React + Vite PWA frontend
- Django + DRF modular monolith
- PostgreSQL primary database
- PDF.js-based reader/workspace
- Playwright critical browser coverage
- S3-compatible private file storage
- Docker/Nginx production runtime
- GitHub Actions production quality gate

Important frontend hotspots historically include:
- `frontend/src/pages/CatalogFocusWorkspace.jsx`
- `frontend/src/pages/AdminContentManagement.jsx`
- `frontend/src/pages/LockInMode.jsx`
- `frontend/src/workspace/**`
- `frontend/src/api/**`
- responsive and PWA layers

Important backend hotspots historically include:
- `backend/apps/content/**`
- `backend/apps/focus/**`
- `backend/apps/accounts/**`
- `backend/apps/payments/**`
- `backend/apps/subscriptions/**`
- `backend/apps/entitlements/**`
- `backend/apps/admin_control/**`

Do not assume these are relevant to every task. Use them as routing hints only.
