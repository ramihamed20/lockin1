# Phase 1 Codex review

## Verdict

**Approved**

Phase 1 has been independently reviewed after implementation. The account
flows use Django's real contracts, session security remains cookie/CSRF based,
and the current replacement visual language is preserved. No critical, major,
or uncorrected minor Phase 1 issue remains.

## Scope

- Requested phase: Phase 1 — account flows, security, and route access.
- Features reviewed: public registration, verification resend, login/logout,
  password-reset request/confirmation route, profile/language update, password
  change, email-change request/confirmation route, session list/revoke,
  logout-all, session-expiry cleanup, and direct privileged-route guards.
- Files reviewed: every file listed in
  `frontend/PHASE_1_IMPLEMENTATION_REPORT.md`; Phase 0 API client/contracts,
  `ProtectedRoute`, authorization helper, current PWA worker, replacement auth
  and Profile visual primitives; read-only Django account URLs, views,
  serializers, models, role definitions and tests.
- Unrelated changes: no Phase 2 data integration, dashboard redesign, creator,
  administrator, commerce, quiz, or server-preference implementation was
  added. The honest Dashboard-unavailable state remains scheduled for Phase 2.
- Backend unchanged confirmation: `git diff --check` and
  `git diff --cached --check` passed. `git status --short -- backend` shows
  only pre-existing staged `backend/.lockin-demo.sqlite3` and
  `backend/config/settings/demo.py`; this Phase 1 work did not create, edit,
  stage, unstage, or otherwise touch either file.

## Evidence and checks

| Check | Command or flow | Result | Notes |
| --- | --- | --- | --- |
| Lint | `pnpm run lint` | Pass | No warnings. |
| Contract/JSDoc/type check | `pnpm run typecheck` | Pass | Existing focused `allowJs` check includes `src/api/accounts.js`. |
| Frontend tests | `pnpm run test` | Pass | 14/14. Phase 1 tests verify exact public/account payloads, no registration role, one-time-token endpoint paths, session marker behavior, 204 revoke, and live route wiring. |
| Production build | `node .\\node_modules\\vite\\bin\\vite.js build` | Pass | Vite 6.4.3 built the replacement and static-only PWA worker. |
| Real backend runtime flows | Existing signed-in browser: `GET /account/profile`, `GET /account/sessions`, same-value CSRF `PATCH /account/profile`, student deep link to `#/admin` | Pass | Real user data rendered; profile mutation settled successfully; administrator route rendered forbidden UI. Phase 0 had already exercised real CSRF → login → session → student operations 403 → logout. |
| Responsive/theme/visual review | Browser reload and 624 px rendered-width inspection | Pass | `scrollWidth === clientWidth === 624`; current shell/card/form/session visual was retained. |
| Runtime errors | Hard-reloaded `#/profile` and inspected current DOM | Pass | Account page loaded with real profile and sessions. Dev-log history includes pre-correction HMR export messages, but the hard reload completed normally after the corrected export was restored. |
| Django read-only system check | `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, `.venv\\Scripts\\python.exe manage.py check` | Pass | No issues. |
| Git diff and backend boundary | `git diff --check`; `git diff --cached --check`; backend-scoped Git status | Pass | No backend change attributable to Phase 1. |

## Acceptance criteria

- Passed:
  - Registration sends exactly `full_name`, `email`, `password`,
    `password_confirm`, `preferred_language`, and `accept_policies`, never a
    role.
  - Login, logout, logout-all, profile, password, email request, verification,
    confirmation, reset and session endpoints use exact Django methods and
    request fields.
  - The authenticated browser actually loaded server profile/session data,
    sent a real CSRF-protected profile update, and handled a student forbidden
    privileged deep link without rendering privileged content.
  - One-time route tokens are transient, unlogged, unpersisted, and removed
    from the URL once consumed; only a non-sensitive message remains.
  - Server field errors are displayed beside the relevant account controls and
    no failed request is reported as successful.
  - Password change refreshes the session list after Django revokes other
    sessions; revoking the current session and logout-all clear frontend auth
    state only after the server response.
  - Product role checks and operational-capability checks are separate and
    default-deny. Missing role data no longer displays a fabricated `student`
    role.
  - Current styles, assets, spacing, responsive layout and themes remain
    replacement-native; no CSS redesign was made.
- Failed: none.
- Not verifiable and why: a successful live email-link delivery/consume E2E
  was not run because safe access to a disposable console-email token was not
  available. Exact backend serializers/views, frontend contract tests, public
  route behavior, and token-handling source were independently reviewed. This
  is an informational test-environment limitation, not a known flow defect.

## Findings

### Critical bugs

None found.

### Major bugs

None found.

### Minor bugs

None found. During self-review, the implementation was corrected before this
verdict so a missing role does not fall back to `student`, and session data
refreshes after a password-change mutation invalidates other sessions.

### API contract mismatches

None found. The review matched request fields with `RegistrationSerializer`,
`ProfileUpdateSerializer`, `PasswordChangeSerializer`,
`EmailChangeRequestSerializer`, `PasswordResetConfirmSerializer`,
`TokenSerializer`, and the account views. Session revoke correctly handles
Django's `204 No Content` response.

### Permission problems

None found. `ProtectedRoute` is attached to the live route tree; the backend
product roles (`student`, `moderator`, `creator`, `administrator`) and
operational capabilities are not conflated. A real student deep link to
`#/admin` rendered a forbidden state.

### Security findings

None found. The account adapter uses the Phase 0 internal-path-only,
credentialed, CSRF-aware client; no bearer/JWT architecture, session secret,
arbitrary authenticated origin, token persistence, fake success, client role,
or client-authoritative result/entitlement data was added. The existing
compatibility `setToken` alias remains explicitly documented and implemented
as a Boolean non-secret UI session marker only.

### UI consistency problems

None found. New views reuse the auth card, current buttons, panels,
ConfirmDialog, form classes, icons, shell and mobile layout. No legacy UI or
new UI library was introduced.

## Required corrections

None. Phase 1 is approved.

## Optional improvements

- Use the declared Node 24.16.0 instead of the bundled 24.14.0 verification
  runtime to remove the engine warning.
- In a controlled non-production demo environment with mailbox/console access,
  add a disposable end-to-end test that follows a newly issued verification,
  email-change and password-reset link. It must never log or persist the raw
  token.

## Final backend confirmation

No backend file was modified by Phase 1. Evidence: final `git diff --check`,
`git diff --cached --check`, `git status --short -- backend`, and the read-only
Django system check. The two staged backend paths named above pre-date and are
outside this implementation; all Phase 1 writes are in `frontend/`.
