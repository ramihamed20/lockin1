# Frontend adaptation report

## Architecture and commands

- Framework: React 18 with Vite 6, JavaScript/JSX, React Router hash routing,
  CSS in `src/styles.css`, and a Vite PWA plugin.
- Package manager: npm with `package-lock.json`.
- Required Node.js: `24.16.0`, from the repository `.nvmrc`.
- Install and run:

  ```powershell
  cd frontend
  Copy-Item .env.example .env.local
  npm ci
  npm run dev
  ```

- Build: `npm run build`.
- Environment variable: `VITE_API_BASE_URL=/api/v1`. The Vite development
  proxy forwards that path to `http://127.0.0.1:8000`.

## Backend contract discovered

The Django API is versioned at `/api/v1` and uses Django session cookies with
CSRF protection, not access/refresh bearer tokens. Unsafe requests first fetch
`GET /auth/csrf` and send `X-CSRFToken`; every request uses cookies.

Relevant integrated endpoints:

- Accounts: `/auth/csrf`, `/auth/register`, `/auth/login`, `/auth/logout`,
  `/auth/session`, `/auth/password-reset`, `/account/profile`,
  `/account/password`.
- Learning: `/education/nodes`, `/education/nodes/{id}`, `/learning-objects`,
  `/learning-objects/{id}`, `/learning/dashboard`, `/bookmarks`.
- Progression: `/assessment-review`, `/progression/xp`, `/progression/streak`,
  `/progression/achievements`, `/progression/rankings/current`.
- Community and notifications: `/community/discussions`, `/notifications`,
  `/notifications/read-all`, `/notifications/{id}/read`.
- The full backend also exposes management, focus, files, assessment attempts,
  moderation, billing, operations, reporting, and configuration routes. Their
  access is role/permission controlled and the replacement UI has no matching
  management screens, so they were not added or invented.

## Integrations completed

- Removed the runtime mock/Supabase bridge. `src/lib/api.js` is now a Django
  API client with cookie credentials, CSRF retrieval, normalized DRF validation
  errors, and unauthorized-session cleanup.
- Login, logout, session restoration, registration submission, and password
  reset use the real account endpoints. Registration correctly stops at email
  verification because the backend does not create an authenticated session at
  registration time.
- Account profile name and password changes use their supported backend fields.
  The backend does not own the UI-only academic-year field.
- Dashboard, materials, PDF delivery, bookmarks, review queue, XP, streak,
  achievements, ranking, discussion reads, and notification read state now use
  real Django responses. Material and analytics cards adapt real hierarchy and
  progress data to the existing visual component shapes without changing CSS or
  layouts.
- Theme and reminder preferences remain browser-local because no matching
  backend preference field exists.

## Unsupported UI actions and contract mismatches

- The backend has no general study-plan CRUD endpoint. The existing study-table
  controls remain visible but are disabled with an availability message.
- It has no individual public question-bank endpoint compatible with this UI,
  nor the replacement sheet checkpoint/final-quiz contract. The question bank
  presents its existing empty state; real PDF learning objects open in the
  existing study viewer, while sheet quiz actions are unavailable.
- General community-post creation requires a backend learning context UUID,
  title, and request UUID. The replacement composer does not collect those
  required fields, so it does not fake a successful post.
- Study-buddy matching, doctor-announcement feed, theme persistence, academic
  year, and advanced-sheet mistake feed are not provided by the current API.
- No token-refresh mechanism exists in the backend. Browser sessions naturally
  expire and the client returns to sign-in after an unauthorized response.

## Files changed and dependencies

- Changed: `src/lib/api.js`, `src/App.jsx`, auth, layout, dashboard, questions,
  community, settings, and sheet-study frontend components; `vite.config.js`;
  `package.json`; `package-lock.json`; frontend README and environment example.
- Removed unused frontend mock/Supabase source modules and the direct Supabase
  package declaration. No new frontend dependency was added.

## Verification

- `vite build` completed successfully using Node `v24.14.0` supplied by the
  workspace runtime. The app bundled 1,610 modules and generated its PWA.
- The initial shell lacked npm on PATH; use the Node version above with a normal
  npm installation for `npm ci` / `npm run dev` on a workstation.
- Django system checks and authenticated runtime flows could not be executed in
  this workspace because no PostgreSQL service or configured backend runtime was
  available. The frontend has been wired to the existing contracts, but real
  login and protected-route verification require the existing Django service
  and a verified user.
- Git inspection confirms implementation edits are limited to `frontend/`; no
  backend source file was modified by this adaptation.
