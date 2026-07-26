# Phase 0 Codex review V2

## Verdict

**Approved**

The rejected Phase 0 findings have been independently rechecked against the current frontend, the real Django contracts, production output, and live local flows. No critical, major, or uncorrected minor finding remains within the Phase 0 scope.

## Scope

- Requested phase: Phase 0 — shared transport, Django session authentication, authorization foundation, PWA safety, and quality gates.
- Features reviewed: relative-only API boundary; CSRF; cookies; 204/blob/ArrayBuffer/FormData/error parsing; user and operations-session contracts; P25/idempotency helpers; product-role/capability helpers; protected routes; 401 and anonymous-session 403 handling; logout; unavailable compatibility behavior; service worker; tests and build configuration.
- Files reviewed: all Phase 0 files listed in `frontend/PHASE_0_IMPLEMENTATION_REPORT.md`, generated `dist/service-worker.js`, the current app/auth/layout/profile integration, and the relevant read-only Django URLs, views, serializers, permissions, settings, tests, and demo seeder.
- Unrelated changes: no Phase 1 feature implementation was added. The focused layout/profile changes only remove false client-authoritative state and preserve the existing unavailable/error visual treatments.
- Backend unchanged confirmation: `git diff --check` and `git diff --cached --check` passed. Git status contains only two pre-existing staged backend paths: `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; this Phase 0 work did not modify them.

## Evidence and checks

| Check | Command or flow | Result | Notes |
| --- | --- | --- | --- |
| Lint | `pnpm run lint` | Pass | Focused ESLint configuration covers the Phase 0 source and tests. |
| Contract/JSDoc/type check | `pnpm run typecheck` | Pass | `tsc --noEmit` with `allowJs` and `checkJs`; not a syntax-only alias. |
| Frontend tests | `pnpm run test` | Pass | 10/10 tests cover origin rejection, CSRF, multipart, 204, 409, 401, anonymous session 403, contracts, P25/UUID, and PWA/guard wiring. |
| Production build | `pnpm run build` | Pass | Vite 6.4.3; inject-manifest service worker generated. |
| Real backend runtime flows | Port-5050 proxy: CSRF → login → auth session → operations session → logout | Pass | 200 → 200 → 200 → 403 student denial → 204. Login response and session user ID matched. |
| Protected-route flow | Browser navigated to `#/profile` after logout | Pass | Current replacement sign-in screen rendered; no protected data was exposed. |
| Responsive/theme/visual review | Browser inspection at 639 × 646 and source/CSS boundary review | Pass | Existing sign-in design retained; no horizontal overflow; no CSS or design-system rewrite. |
| Service-worker safety | Source and generated-worker search | Pass | No `/api/` runtime route, `api-cache`, `NetworkFirst`, or `runtimeCaching`; old `api-cache` is deleted on activation. |
| Django read-only system check | `PYTHONDONTWRITEBYTECODE=1 DJANGO_SETTINGS_MODULE=config.settings.demo .venv\\Scripts\\python.exe manage.py check` | Pass | No issues. |
| Git diff and backend boundary | `git diff --check`; `git diff --cached --check`; `git status --short -- backend` | Pass | No backend source change attributable to this phase. |

## Acceptance criteria

- Passed:
  - One shared internal-only API client is used for the Phase 0 integrations.
  - Django session cookies and CSRF are used; no JWT, refresh-token, Authorization bearer header, or client-managed session secret was introduced.
  - The exact user/session and operations-session contracts are separate and normalized.
  - Product roles and operational capabilities are separate; authorization denies unknown routes and missing permissions by default.
  - Protected routes are attached to the live route tree and the signed-out deep-link behavior is verified.
  - Unsafe CSRF bootstrap fails closed; JSON error details, 204, blobs, ArrayBuffers, FormData, and 409 conflicts are supported at the client boundary.
  - No API response is cached by the service worker, including obsolete generated development-worker output.
  - The old compatibility layer no longer fabricates successful feature data.
  - Lint, JSDoc type checking, tests, production build, live backend flow, and Django system check pass.
  - The replacement visual system remains intact.
- Failed: none.
- Not verifiable and why: later product workflows are deliberately outside Phase 0 and remain explicitly unavailable until their scheduled phases; they are not represented as successful real-data flows.

## Findings

### Critical bugs

None found.

### Major bugs

None found.

### Minor bugs

None found.

### API contract mismatches

None found. The live anonymous `/auth/session` behavior returned `403`; the session-specific frontend handling now reflects that observed Django behavior without reclassifying operational `403` responses.

### Permission problems

None found. Student access to `/operations/session` was server-denied with `403`, and the client leaves operational capabilities absent rather than granting a fallback.

### Security findings

None found. The rejected PWA private-cache route and arbitrary authenticated origin path were removed. The client does not access HttpOnly cookies or hold a JWT/session secret.

### UI consistency problems

None found. The new forbidden/retry/unavailable feedback uses existing visual primitives; the current sign-in page, shell, mobile navigation, and theme styling were not redesigned.

## Required corrections

None. Phase 0 is approved.

## Optional improvements

- Use the declared Node `24.16.0` locally to remove the non-blocking warning emitted by the bundled Node `24.14.0` runtime used for verification.
- Add visual regression coverage for future newly routed operations pages when those pages are implemented in their assigned phases.

## Final backend confirmation

No backend file was modified by this Phase 0 implementation or review. Evidence: the final `git diff --check`, `git diff --cached --check`, and backend-scoped Git status checks passed, while the two staged backend paths listed above were pre-existing user work and were not touched.
