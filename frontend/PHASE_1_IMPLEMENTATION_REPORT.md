# Phase 1 implementation report

## Outcome and scope

Phase 1 is complete: the replacement frontend now uses the real Django account
and session endpoints for the existing sign-in, registration, security and
profile surfaces. This phase intentionally does not connect Dashboard, study
content, progress, XP, rankings, or product data; those are scheduled for
Phase 2 and later. No Django file was edited.

## Files changed

| File | Why it changed |
| --- | --- |
| `src/api/accounts.js` | Added the single account-domain adapter for Django's account, password, email confirmation, session-management, and public email/reset flows. |
| `src/lib/api.js` | Kept legacy public call signatures while delegating account actions to the real adapter instead of a fabricated response. |
| `src/App.jsx` | Added account refresh/sign-out cleanup, public one-time-token routes, and guarded future privileged route placeholders. |
| `src/components/auth/AuthPage.jsx` | Submitted the exact registration fields, rendered Django field errors, and added verification-resend feedback while retaining the current auth design. |
| `src/components/auth/TokenActionPage.jsx` | Added current-style routes for verification, email confirmation and password-reset tokens; strips a consumed token from the URL. |
| `src/components/account/AccountFormErrors.jsx` | Added reusable, backend-error-envelope-aware field and form feedback. |
| `src/components/account/SessionList.jsx` | Added real active-session loading, empty/error/retry, revoke confirmation, and current-session sign-out handling. |
| `src/pages/Profile.jsx` | Replaced fake profile/security state with real profile, password, email-change, session, and logout-all flows. |
| `eslint.config.js` | Included the Phase 1 source files in the existing lint boundary. |
| `tsconfig.phase0.json` | Included the JavaScript account adapter in the existing JSDoc type-check boundary. |
| `tests/phase1.test.js` | Added contract tests for account requests, public verification/reset routes, anonymous session behavior, and privileged-route wiring. |

## Django contracts verified

The frontend calls these existing endpoints with the backend's field names and
does not infer role values:

| Workflow | Endpoint and request |
| --- | --- |
| Registration | `POST /auth/register`: `full_name`, `email`, `password`, `password_confirm`, `preferred_language`, `accept_policies` |
| Login / session | `POST /auth/login`: `email`, `password`, `remember_me`; `GET /auth/session` |
| Verification | `POST /auth/verify-email`: `token`; `POST /auth/resend-verification`: `email` |
| Password reset | `POST /auth/password-reset`: `email`; `POST /auth/password-reset/confirm`: `token`, `new_password`, `new_password_confirm` |
| Profile | `GET,PATCH /account/profile`: `full_name`, `preferred_language` |
| Password | `POST /account/password`: `current_password`, `new_password`, `new_password_confirm` |
| Email change | `POST /account/email`: `new_email`, `current_password`; `POST /account/email/confirm`: `token` |
| Sessions | `GET /account/sessions`; `DELETE /account/sessions/{id}` |
| Logout | `POST /auth/logout`; `POST /auth/logout-all` |

`UserSerializer` values are normalized to the pre-existing replacement user
shape from server fields only: ID, email, full name, product roles, preferred
language, verified status, account status, and join date. Product roles and
operational capabilities remain distinct. The app denies unknown privileged
routes by default and treats UI guards as presentation only; Django continues
to authorize every request.

## Security and compatibility decisions

- Authentication remains Django HttpOnly session cookies with the Phase 0
  same-origin CSRF client. No JWT, bearer header, refresh-token scheme, or
  JavaScript cookie deletion was introduced.
- A one-time token is read from its route once, never persisted, logged, or
  added to navigation state. On successful use, the URL is replaced without
  the token; only a non-sensitive completion message survives the replacement.
- Registration never sends a client-selected role. The UI's old academic-year
  visual control is not submitted because the account API has no such field;
  the interface explains that limitation rather than storing fake data.
- Django error details (`status`, `code`, `message`, `fields`, `request_id`)
  remain available through the shared client and field errors render beside
  the relevant control. Mutations only report success after a server response.
- `401` and the backend's anonymous `/auth/session` `403` clear only the
  non-secret frontend session marker and React state. The code never tries to
  delete an HttpOnly session cookie.
- Theme, mascot, and reminder settings stay explicitly device-local because
  this backend exposes no server preference endpoint.

## Visual impact

No stylesheet, design token, layout, navigation structure, typography, asset,
animation, or responsive breakpoint was changed. Phase 1 reuses the current
auth card, form, buttons, panels, confirmation dialog, shell, icons and mobile
form layout. Browser checks at a 639 px width found no horizontal overflow.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run test` | Pass: 14 tests, 0 failures. |
| `pnpm run lint` | Pass. |
| `pnpm run typecheck` | Pass. |
| `pnpm run build` | Pass: Vite 6.4.3 production bundle. |
| Live frontend | `http://127.0.0.1:5050/` returned HTTP 200. |
| Live Django-account browser flow | Pass: signed-in real profile loaded, real active sessions loaded, same-value profile PATCH completed through CSRF, and a student deep-link to `#/admin` rendered the forbidden state. |
| Public token route | Pass: `#/verify-email` renders the existing auth visual and safely reports a missing token without an API call. |
| Responsive visual check | Pass: current Profile card/session layout at 639 px with no horizontal overflow. |
| Django system check | Pass with `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, and `.venv\\Scripts\\python.exe manage.py check`. |
| Boundary checks | `git diff --check` and `git diff --cached --check` passed. |

The bundled verification runtime is Node 24.14.0 while `package.json` declares
Node 24.16.0. The declared version should be used for normal development; the
checks above passed with the non-blocking engine warning.

An additional read-only run of the backend account test module exceeded the
120-second local timeout without output. It did not change source or database
files and is recorded as a verification-environment limitation, not as a
substitute for the frontend contract and browser checks above.

## Remaining limitations

- Dashboard and learning data intentionally remain unavailable until Phase 2;
  Phase 1 does not fabricate replacement metrics or content.
- The backend does not offer avatar upload, account deletion, server theme,
  server mascot, server reminder, or academic-year profile preferences. These
  controls are not represented as successful backend actions.
- Email-link success was verified against the exact backend serializers,
  views, endpoint contracts and frontend request tests. A full delivery-link
  browser E2E was not run because obtaining a disposable backend-issued token
  would require external email/console access outside this phase's safe demo
  workflow.

## Backend boundary confirmation

Phase 1 created or modified only files under `frontend/`. Final Git status has
two pre-existing staged backend paths, `backend/.lockin-demo.sqlite3` and
`backend/config/settings/demo.py`; this phase did not create, edit, stage, or
unstage them. No backend source/configuration/model/serializer/view/URL/
permission/test was modified by this work.
