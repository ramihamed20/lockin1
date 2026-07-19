# Lock-in Runtime and Package Baseline

Last updated: 2026-07-19

## Selected runtime baseline

| Layer | Selected version | Selection reason |
|---|---:|---|
| Python | 3.13.14 | Mature supported Python line for the deployment image; source code remains compatible with 3.11–3.14 so the current workstation can run fast checks |
| Django | 5.2.16 LTS | Supported LTS through April 2028; longer maintenance window than Django 6.0 |
| Django REST Framework | 3.17.1 | Current supported release and compatible with Django 5.2 |
| drf-spectacular | 0.30.0 | Current schema generator with Django 5.2/DRF 3.17 support |
| psycopg | 3.3.4 | Current PostgreSQL driver line with binary local-development support |
| Gunicorn | 26.0.0 | Production WSGI process manager with bounded gthread configuration |
| PostgreSQL | 18.4 | Current supported PostgreSQL release; used by Compose and CI |
| Nginx | 1.28.0 | Pinned non-root production edge image for TLS/static/reverse proxy |
| Node.js | 24.16.0 | Current LTS runtime already available in the workspace |
| React / React DOM | 19.2.7 | Current stable React release |
| Vite | 7.3.6 | Mature previous major; Vite 8 was only recently released when Phase 2 began |
| TypeScript | 6.0.3 | Supported previous major; TypeScript 7 was only days old when Phase 2 began |
| ESLint | 9.39.5 | Mature previous major rather than the newly released ESLint 10 line |
| vite-plugin-pwa | 1.3.0 | Current release with declared Vite 7 support |
| Vitest | 4.1.10 | Current release with declared Vite 7 support |
| Playwright | 1.61.1 | Current browser-testing package at foundation creation |

Direct Python and JavaScript dependencies are exact-pinned. `frontend/package-lock.json` locks the
complete npm tree and CI installs it with `npm ci`. Python direct and development dependencies live
in `backend/pyproject.toml`; the deployment image and CI resolve those exact direct versions.

## Compatibility decisions

- Application Python uses syntax supported by 3.11 so the current workstation can execute the
  fast unit suite, while CI and the backend image use 3.13.14.
- `djangorestframework-stubs` 3.16.9 is used with `django-stubs` 5.2.9. The 3.17.0 stubs package
  requires Django 6 stubs and produced a verified dependency conflict with the selected Django LTS.
- The backend source does not depend on typing packages at runtime.
- Major framework upgrades require a dedicated dependency review, migration notes, all quality
  gates, and a PWA update/recovery check.

## Primary version sources

- Django supported versions: https://www.djangoproject.com/download/
- Django REST Framework: https://pypi.org/project/djangorestframework/
- PostgreSQL policy and current releases: https://www.postgresql.org/support/versioning/
- React package: https://www.npmjs.com/package/react
- Vite package and version history: https://www.npmjs.com/package/vite
- TypeScript package and version history: https://www.npmjs.com/package/typescript
- Python releases: https://www.python.org/downloads/
