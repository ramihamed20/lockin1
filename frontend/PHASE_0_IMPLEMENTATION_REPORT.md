# Phase 0 implementation report

## Outcome

Phase 0 is complete. The replacement frontend starts, builds, and uses Django's
same-origin session-cookie authentication without changing Django. This phase
implements only the shared transport, session, authorization, safety, and
quality-gate foundations; it does not implement any Phase 1 product screens.

## Files changed

| File | Reason |
| --- | --- |
| `src/api/client.js` | Added the single relative-path-only Django client, session marker, CSRF bootstrap, error-envelope parsing, multipart/binary/204 support, and 401 subscriber. |
| `src/api/contracts.js` | Added exact user, auth-session, operations-session, pagination, and error normalizers. |
| `src/api/pagination.js` | Added documented P25/cursor helpers and secure UUID idempotency-key generation. |
| `src/lib/api.js` | Replaced fabricated compatibility responses with the real account/session calls or an explicit unavailable error. |
| `src/lib/authz.js` | Added backend-derived product-role and operations-capability route decisions with default denial. |
| `src/App.jsx` | Connected session boot, 401 state cleanup, retryable boot errors, protected routes, operations-session loading, and safe failed-logout feedback. |
| `src/components/auth/ProtectedRoute.jsx` | Enforced loading, signed-out, forbidden, and permitted route states. |
| `src/components/shared/ForbiddenState.jsx` | Added the forbidden state using existing panel, icon, button, and theme classes. |
| `src/components/shared/index.jsx` | Reused existing full-screen and toast components for retry/session feedback. |
| `src/components/ui/index.jsx` | Added an optional retry action to the existing error panel. |
| `src/components/layout/index.jsx` | Replaced client-authoritative streak/notification success claims with explicit server-unavailable states. |
| `src/pages/Profile.jsx` | Removed invented profile/XP/academic-year values and retained only backend-backed account actions. |
| `src/service-worker.js` | Added static-asset-only precaching and activation cleanup for the obsolete `api-cache` cache. |
| `vite.config.js` | Removed API runtime caching, configured the inject-manifest worker, and made the local Django proxy target configurable. |
| `.env.example` | Documented the same-origin API path and development-proxy target. |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Added Phase 0 scripts, lint/type tooling, lockfile, and the narrowly approved `esbuild` local build required by Vite. |
| `eslint.config.js`, `tsconfig.phase0.json`, `src/api/vite-env.d.ts` | Added focused linting and real JSDoc TypeScript checking for the Phase 0 foundation. |
| `tests/phase0.test.js` | Added ten focused client, contract, permission, PWA, pagination, and route-wiring tests. |
| `PHASE_0_CORRECTION_CHECKLIST.md` | Recorded the rejected-review audit and correction scope. |
| `dev-dist/registerSW.js`, `dev-dist/sw.js`, `dev-dist/workbox-84250dca.js` | Removed stale generated development-worker files that still contained the rejected `/api/` cache rule. |

## Backend contracts verified

- `GET /api/v1/auth/csrf` returns `csrf_token` and establishes the Django CSRF cookie.
- `POST /api/v1/auth/login` accepts `email`, `password`, and `remember_me`; it returns `{ user }` and rotates CSRF state.
- `POST /api/v1/auth/logout` returns `204 No Content`.
- `GET /api/v1/auth/session` returns `{ user }`. In this Django setup an anonymous request returned `403`, so this endpoint alone treats both `401` and `403` as a signed-out session.
- `GET /api/v1/operations/session` is separate from authentication session data and returns `roles`, `capabilities`, `dashboards`, and `timezone`; a student correctly received `403`.
- Product roles are server values: `student`, `moderator`, `creator`, and `administrator`.
- Django validation errors are preserved as `status`, `code`, `message`, `fields`, and `request_id`, including `409` conflicts.
- Pagination helpers follow the backend's page/page-size contract (default 25, maximum 100). No idempotency header is attached unless a caller explicitly supplies one.

## Security and compatibility corrections

- The browser client accepts only same-origin relative paths inside `VITE_API_BASE_URL`; it rejects absolute, protocol-relative, backslash, fragment, and API-boundary-escaping paths before `fetch`.
- It always uses Django cookies only for that internal path and sends `X-CSRFToken` only for unsafe methods after a successful CSRF bootstrap. It never attempts to read or delete the HttpOnly session cookie.
- `lock-in.session` is a documented non-secret UI boot marker, not a JWT, token, or session identifier.
- A `401` clears the marker and synchronizes React authentication state. The special anonymous `403` from `/auth/session` is also handled safely; operational `403` responses do not log the user out.
- The service worker precaches static build assets only. It has no API runtime route and deletes the old `api-cache` on activation. The stale generated development worker with that route was removed.
- Unsupported later-phase data functions now fail honestly with `feature_unavailable`; no success arrays, fabricated activity, XP, streak, score, rank, or entitlement values remain in the shared compatibility adapter.
- Operations capabilities remain separate from product roles, and unknown routes or permissions are denied by default.

## Visual impact

No CSS, design tokens, layout system, navigation structure, typography, images, theme behavior, or responsive breakpoints were redesigned. New loading, forbidden, unavailable, and retry feedback reuse existing `panel`, `error-panel`, `btn`, `stat-icon`, toast, and screen-state patterns. Browser inspection at 639 px showed no horizontal overflow; the signed-out screen retained the current replacement design.

## Checks run

| Check | Command or flow | Result |
| --- | --- | --- |
| Dependencies | `pnpm install --frozen-lockfile` | Installed; the frontend workspace now permits only Vite's required `esbuild` postinstall. |
| Frontend tests | `pnpm run test` | Pass: 10/10. |
| Lint | `pnpm run lint` | Pass. |
| JSDoc type check | `pnpm run typecheck` | Pass. |
| Production build | `pnpm run build` | Pass; Vite 6.4.3 generated the inject-manifest worker. |
| Service-worker inspection | searched generated `dist/service-worker.js` for API caching rules | Pass: zero `/api/`, `NetworkFirst`, `runtimeCaching`, or `api-cache` matches. |
| Frontend dev server | `http://127.0.0.1:5050/` | Pass: HTTP 200. |
| CSRF proxy | `GET /api/v1/auth/csrf` through port 5050 | Pass: 200, token, and same-origin cookie. |
| Real auth flow | CSRF → `student@lockin.local` login → session → operations session → logout | Pass: 200 → 200 → 200 → 403 (correct for student) → 204. |
| Browser flow | signed-out screen, demo credential fill, login, protected deep link, logout | Pass. |
| Django read-only check | `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, `.venv\\Scripts\\python.exe manage.py check` | Pass. |
| Boundary checks | `git diff --check`, `git diff --cached --check`, Git status | Pass; see confirmation below. |

The bundled runtime reported Node `24.14.0` while `package.json` requests `24.16.0`; all checks above passed with the warning. Use Node `24.16.0` for the declared project environment.

## Remaining limitations

- Feature screens scheduled for Phase 1 and later are intentionally not integrated in Phase 0. Their old generic adapter requests now render the existing error/unavailable treatment instead of fabricated data. This includes dashboard learning data, questions, progress, analytics, achievements, community, ranking, and notifications.
- Account registration is not submitted because the visible replacement form does not yet collect the backend-required explicit policy acceptance. It reports an honest unavailable state rather than recording false consent.
- The backend has no session-token refresh endpoint. The frontend intentionally uses Django session cookies and reboots authentication from `/auth/session`.

## Backend unchanged confirmation

No backend file was modified by this Phase 0 implementation. The final Git check shows two **pre-existing staged** backend files, `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; this implementation did not create, edit, stage, or unstage them. All Phase 0 writes are within `frontend/`.
