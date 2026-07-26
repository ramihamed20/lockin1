# Phase 0 — Codex Review

## Review verdict

**Rejected**

Phase 0 establishes useful foundations and the submitted unit suite and production build currently pass. It cannot be approved because the service worker caches authenticated API responses, the authorization adapter does not match the backend operations-session contract, and authentication/route-guard behavior is not fully connected to the application.

## Features reviewed

- Shared HTTP client, Django session cookies, CSRF handling, response parsing, and errors.
- JSDoc contracts and pagination/idempotency helpers.
- Product-role and operations-capability helpers.
- Protected-route and forbidden-state components.
- Authentication boot and logout state in the application shell.
- Existing compatibility API adapter and mock/fabricated result paths.
- PWA runtime-cache configuration.
- Package scripts and Phase 0 tests.

## Files reviewed

- src/api/client.js
- src/api/contracts.js
- src/api/pagination.js
- src/lib/authz.js
- src/lib/api.js
- src/App.jsx
- src/components/auth/ProtectedRoute.jsx
- src/components/shared/ForbiddenState.jsx
- src/components/shared/index.jsx
- src/components/ui/index.jsx
- tests/phase0.test.js
- vite.config.js
- package.json
- PHASE_0_IMPLEMENTATION_REPORT.md

## Checks executed

| Check | Result | Notes |
| --- | --- | --- |
| Phase 0 unit tests | Passed with gaps | 12 of 12 Node tests passed. They exercise pure helpers only; they do not exercise fetch, CSRF headers, FormData headers, 401 application state, or route integration. |
| JavaScript syntax checks | Passed | client.js, contracts.js, pagination.js, and authz.js passed node --check. |
| Lint | Failed / unavailable | package.json has no lint script or lint configuration. |
| Type checking | Failed requirement | The typecheck script is node --check, which is syntax validation, not TypeScript or JSDoc type checking. |
| Production build | Passed | Vite production build passed. It generated a service worker containing the insecure API runtime-cache route below. |
| Runtime API and browser-flow verification | Not approved | The claimed CSRF, 401 cleanup, binary error, and guard behavior are not covered by the submitted tests or an integrated route flow. |
| Django system check | Passed | backend/.venv/Scripts/python.exe manage.py check with config.settings.demo completed with no issues. The read-only verification did not alter backend source. |
| Git diff whitespace check | Passed | git diff --check passed. |

## Acceptance criteria status

| Criterion | Status | Reason |
| --- | --- | --- |
| One safe shared API request path | Failed | The client accepts arbitrary absolute URLs while always including credentials. |
| Exact Django CSRF and error behavior | Failed | A missing CSRF token does not fail closed; non-JSON response modes discard backend validation payloads. |
| Backend-derived roles and capabilities | Failed | The operations-session response uses capabilities, but the helper only reads invented operational_capabilities fields. |
| Protected-route foundation integrated | Failed | ProtectedRoute is created but is not used by App.jsx or any route. |
| No mock/fabricated success responses in the foundation | Failed | The legacy adapter still returns fabricated metrics and empty successful question results. |
| No private API content cached by the PWA | Failed | Every GET matching /api/ is cached in api-cache. |
| Lint and type checking pass | Failed | Neither required check is configured. |
| Unit tests and production build pass | Partial | The existing 12 tests and build pass, but required behaviors are untested. |
| Current visual system preserved | Partial | No active UI regression was found in the routed screens. The new forbidden state is unused and uses standalone inline colors instead of existing design-system styling. |

## Findings

### 1. [Critical] Authenticated API responses are cached by the service worker

- **Severity:** Critical
- **File path:** vite.config.js:67-79
- **Relevant component:** VitePWA workbox.runtimeCaching
- **Problem:** The NetworkFirst rule caches every GET URL under /api/ in api-cache. This includes the authenticated session and can include private learning data, assessment results, and subsequently released answer data. The generated production service worker contains the same route.
- **Expected behavior:** The PWA must not cache authenticated or user-specific API responses. API requests must always reach Django and must not persist private response bodies in Cache Storage.
- **Precise correction instructions:**
  1. Remove the /api/ runtimeCaching rule completely. Do not replace it with another cache strategy for authenticated API responses.
  2. Add a frontend-only service-worker upgrade/activation cleanup that removes the previous api-cache cache name for clients that installed the old service worker.
  3. Rebuild and verify that dist/sw.js has no route matching /api/ and no api-cache runtime cache.
  4. Add an automated regression assertion against the PWA configuration or generated service worker.
- **Retest:** Build production, inspect dist/sw.js, then verify a signed-in API response is absent from Cache Storage after navigation.

### 2. [Major] The shared client can send credentials and CSRF data to arbitrary absolute URLs

- **Severity:** Major
- **File path:** src/api/client.js:56-74, 117-180
- **Relevant function:** ensureCsrfToken and request
- **Problem:** request accepts a path beginning with http as the complete request URL while using credentials: include. This bypasses the configured API base path. Also, if /auth/csrf returns no cookie or csrf_token, an unsafe request proceeds without an X-CSRFToken header. For blob, arraybuffer, and text response modes, a JSON Django error envelope is discarded instead of preserving code and fields.
- **Expected behavior:** The shared API client must make only same-origin, configured API requests; unsafe requests must fail before sending when a CSRF token cannot be obtained; Django error envelopes must remain available regardless of the requested successful response type.
- **Precise correction instructions:**
  1. Require API paths to be relative paths and reject schemes, protocol-relative values, and origins outside the configured API origin before calling fetch.
  2. After the CSRF bootstrap request, throw a typed ApiError when neither the cookie nor csrf_token is present. Never send an unsafe request without a CSRF token.
  3. On errors in blob, arraybuffer, or text modes, parse JSON when the response Content-Type is JSON (or safely attempt response.clone().json()) and pass that envelope to ApiError.
  4. Add fetch-mocked tests for same-origin enforcement, CSRF bootstrap failure, CSRF header injection, FormData without a forced Content-Type, 204 handling, binary-error parsing, and 409 payload preservation.
- **Retest:** Run the new unit tests and a real signed-in mutation against Django.

### 3. [Major] Operations permissions use fields and route requirements that the backend does not provide

- **Severity:** Major
- **File path:** src/api/contracts.js, src/lib/authz.js:20-25, 59-71
- **Relevant function/component:** normalizeSessionResponse, hasOperationalCapability, ROUTE_ACCESS_CONFIG
- **Problem:** Django GET /api/v1/auth/session returns a user object. Django GET /api/v1/operations/session returns roles, capabilities, dashboards, and timezone. The implementation instead looks for operational_capabilities or operational_roles and requires users.view for every /operations route. This rejects valid content and analytics operations users and does not represent the actual backend payload.
- **Expected behavior:** The frontend must normalize and evaluate the exact operations-session response. Each operations route must be guarded by its specific required backend capability; the default operations entry must use the capability required by the backend endpoint it opens.
- **Precise correction instructions:**
  1. Add a distinct operations-session contract/normalizer for roles, capabilities, dashboards, and timezone. Do not pretend those fields are returned by the authentication-session endpoint.
  2. Make hasOperationalCapability read the actual capabilities array, while retaining only documented compatibility handling that is genuinely needed.
  3. Replace the blanket /operations => users.view rule with explicit route-to-capability mappings derived from the capability matrix. Do not gate all operations pages with a user-management capability.
  4. Add tests using the real operations-session fixture shape and positive/negative cases for each mapped route.
- **Retest:** Authenticate as at least one non-user-management operations role and confirm permitted operations routes render while forbidden actions show a 403/forbidden state.

### 4. [Major] Authentication state and route guards are not wired into the live application

- **Severity:** Major
- **File path:** src/App.jsx:111-152; src/components/auth/ProtectedRoute.jsx
- **Relevant function/component:** session boot effect, Shell onLogout callback, ProtectedRoute
- **Problem:** App.jsx clears the user for every session-bootstrap failure, including transient network and server errors. A later 401 only clears the local marker inside the API client and does not update App user state. Logout can leave user state unchanged when the network logout request rejects because setUser(null) is after await. ProtectedRoute is exported but never used by application routes.
- **Expected behavior:** A genuine 401/unauthenticated response must clear the marker and React authentication state consistently; transient failures must render a retryable error rather than impersonating logout; logout must leave marker and UI state consistent; protected route behavior must be exercised by live route definitions.
- **Precise correction instructions:**
  1. Add one controlled client-to-auth-state unauthorized notification mechanism and subscribe to it in App.jsx. It must clear user state and redirect/show the signed-out flow on 401.
  2. Only treat confirmed unauthenticated responses as logout during session bootstrap. Preserve the session state for transient errors and render the existing retry-capable error UI.
  3. Define explicit logout behavior for a failed logout request so marker and React state cannot diverge. Surface a non-disruptive error if the server session may still exist.
  4. Wire ProtectedRoute around actual authenticated/role-gated route definitions, or remove it from this phase and add it only when the first guarded route is introduced. If retained, add an integration test proving direct navigation is denied.
- **Retest:** Verify bootstrap network failure, 401 from a protected request, successful logout, failed logout, and direct navigation to each configured guarded route.

### 5. [Major] The compatibility adapter still fabricates backend-supported results and mock success responses

- **Severity:** Major
- **File path:** src/lib/api.js:76-81, 123-128, 159-180, 202-206
- **Relevant function/component:** dashboard, community, ranked, progress, analytics, and api route adapter
- **Problem:** The shared adapter reports questionsSolved from completed learning objects, sets accuracy and likes to zero, reuses a ranking for unrelated groups, and returns successful empty question arrays. These are fabricated application results, despite the Phase 0 report and plan requiring that a real endpoint is used or the visible action remains honestly unavailable.
- **Expected behavior:** Phase 0 must provide a single trustworthy API foundation. It must not silently convert unsupported data into successful empty/fabricated product data.
- **Precise correction instructions:**
  1. Remove fabricated metrics and empty-success mock branches from the shared adapter.
  2. Where a phase has not yet implemented a real backend mapping, return the existing explicit unavailable/error result so the UI can preserve its visual state without claiming data exists.
  3. Move real endpoint adaptations into focused feature services in the phase that implements their associated screen.
  4. Update the Phase 0 implementation report to distinguish remaining legacy compatibility paths from real integrations.
- **Retest:** Search frontend source for successful fallback arrays, hard-coded activity metrics, and duplicated ranking data; none may remain in the shared API foundation.

### 6. [Major] Required quality gates and behavioral tests are missing

- **Severity:** Major
- **File path:** package.json; tests/phase0.test.js
- **Relevant function/component:** scripts and Phase 0 test suite
- **Problem:** There is no lint script or lint configuration. The script named typecheck only runs JavaScript syntax parsing. The 12 tests do not mock fetch and therefore do not cover the CSRF, FormData, 204/binary response, 401 cleanup, and request behavior claimed by the implementation report.
- **Expected behavior:** Phase 0 must have a frontend lint command, a real JSDoc/TypeScript type-checking command appropriate to this JavaScript project, and tests that cover the shared HTTP behavior and real backend-contract fixtures.
- **Precise correction instructions:**
  1. Add a non-invasive ESLint setup and lint script that covers changed frontend source and tests.
  2. Add a JavaScript/JSDoc type-check configuration (for example, a dedicated noEmit TypeScript check with allowJs and checkJs) and make typecheck run it. Do not rename syntax parsing as type checking.
  3. Expand tests with mocked fetch, browser storage, and cookie state for all client behaviors listed in Finding 2 and app-auth synchronization in Finding 4.
  4. Run lint, typecheck, tests, and build and report their exact outcomes.
- **Retest:** All four commands must exit successfully and test coverage must include the required client and auth scenarios.

### 7. [Minor] New forbidden state is visually detached from the existing component system

- **Severity:** Minor
- **File path:** src/components/shared/ForbiddenState.jsx
- **Relevant component:** ForbiddenState
- **Problem:** The component is unused and introduces standalone inline visual values such as #ef4444 instead of the project’s existing shared styling patterns.
- **Expected behavior:** When the component is activated, it must preserve the replacement frontend design system in both themes and responsive layouts.
- **Precise correction instructions:** Reuse existing shared layout, typography, button, theme, and error-state primitives. Keep the component visually equivalent to the current product’s empty/error treatments and add a narrow rendering test or visual verification when it becomes routed.
- **Retest:** Check both themes and mobile/desktop widths for a denied route.

### 8. [Minor] Small cleanup items remain

- **Severity:** Minor
- **File path:** src/lib/api.js; tests/phase0.test.js
- **Relevant function/component:** imports
- **Problem:** apiClient is imported but unused in src/lib/api.js, and normalizeError is imported but not exercised in the Phase 0 tests.
- **Expected behavior:** Imports should reflect active dependencies and each advertised contract helper should either be tested or not claimed as covered.
- **Precise correction instructions:** Remove unused imports or add the missing targeted tests. Address the existing Vite static/dynamic import warning only if it can be done without changing page behavior.
- **Retest:** Lint must pass with no unused-import finding.

## Critical bugs

- Authenticated API response bodies are persisted by the service worker.

## Major bugs

- The shared HTTP client does not constrain absolute URLs, fails open without CSRF, and drops validation envelopes for non-JSON success modes.
- Operations permissions do not consume Django’s actual operations-session contract.
- Authentication state can diverge after a 401 or failed logout; the new route guard is not used.
- The legacy shared adapter still returns fabricated or mock-success data.
- Required lint/type-check gates and behavioral tests are absent.

## Minor bugs

- The forbidden state is unused and does not clearly reuse the established styling system.
- Unused imports and incomplete advertised contract coverage remain.

## API contract mismatches

- GET /api/v1/auth/session is not an operations-session source; it returns the current user.
- GET /api/v1/operations/session provides roles, capabilities, dashboards, and timezone; it does not supply operational_capabilities.
- Error response parsing must preserve Django’s JSON validation envelope for all response modes.

## Permission problems

- A blanket users.view requirement incorrectly blocks non-user-management operations roles.
- The only new route guard is not attached to route definitions, so configured restrictions are not enforced by navigation.

## Security findings

- Critical: private API data is cached by the PWA.
- Major: the shared request helper accepts absolute URLs while attaching browser credentials.
- No bearer-token persistence or backend source modification was found.

## UI consistency problems

- No current routed-screen redesign was detected.
- The new forbidden component must be aligned to the existing visual primitives before it becomes active.

## Required corrections

Correct Findings 1 through 6 before resubmission. Do not modify Django or add product features from later phases.

## Optional improvements

- Resolve the Vite warning caused by mixed static and dynamic imports of src/lib/api.js if it can be done without altering behavior.
- Add a browser-level visual regression check for the forbidden state once it is used.

## Correction prompt for the implementation AI

Implement **only Phase 0 corrections** from frontend/reviews/PHASE_0_CODEX_REVIEW.md. Preserve the current replacement frontend’s visual identity exactly and modify frontend files only.

1. Remove all /api/ PWA runtime caching, add a safe frontend-only upgrade cleanup for the old api-cache, rebuild, and prove generated service-worker output has neither the API route nor api-cache.
2. Harden src/api/client.js: accept only configured same-origin relative API paths; fail closed if CSRF bootstrapping yields no token; preserve Django JSON errors for blob/arraybuffer/text error paths; add tests for these cases.
3. Normalize Django’s exact GET /api/v1/operations/session shape (roles, capabilities, dashboards, timezone). Map each operations route to its real required capability rather than applying users.view to all routes. Test actual response fixtures.
4. Wire authentication state to 401 outcomes, distinguish transient boot errors from unauthenticated sessions, make logout state consistent when the request fails, and either route/use ProtectedRoute with integration coverage or remove it until the first real guarded route.
5. Remove fabricated successful fallback data from src/lib/api.js. Keep unsupported later-phase UI visually intact but explicitly unavailable; do not claim fake metrics or empty question data are real.
6. Add ESLint and a real JSDoc/JavaScript type-check, then expand tests to cover fetch/CSRF/FormData/204/error parsing/auth synchronization. Run lint, typecheck, tests, and build.

Do not start Phase 1 or later features. Update PHASE_0_IMPLEMENTATION_REPORT.md with exact commands and outcomes, including any remaining unsupported legacy paths. Stop after these corrections and provide the revised report.

## Backend unchanged confirmation

No backend file was modified by this Phase 0 review. The review used read-only inspection and checks only. git diff --check passed, and no new unstaged backend diff was found. Pre-existing staged backend files were not altered by this work.
