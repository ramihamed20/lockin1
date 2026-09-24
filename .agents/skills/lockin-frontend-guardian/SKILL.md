---
name: lockin-frontend-guardian
description: Implement or review general Lock-in React/Vite frontend changes while preserving state ownership, API boundaries, PWA safety, performance, accessibility, RTL, and responsive behavior. Use for frontend work outside the specialized Focus/PDF guardian.
---

# Lock-in Frontend Guardian

Keep frontend changes local, observable, and compatible with the existing product architecture.

## Before editing

1. Read relevant `AGENTS.md`.
2. Identify the page/component, API source, state owner, and existing tests.
3. Search for an existing component/pattern before creating a new abstraction.
4. Use `lockin-impact-mapper` for unclear blast radius.

## State discipline

Distinguish:
- server-authoritative state
- route state
- local UI state
- persisted recovery/preferences
- derived display state

Do not duplicate server truth into long-lived browser state without a clear reason.
Do not store auth/session identifiers or secrets in local/session storage.

## React discipline

Prefer:
- explicit data flow
- small pure helpers
- existing shared primitives
- stable keys
- effects only for real side effects
- cleanup for listeners/timers/observers
- memoization only when measured or clearly needed

Avoid:
- effect chains that recreate state machines
- hidden mutable module state
- broad refactors mixed with bug fixes
- new dependencies for trivial utilities

## API use

Use the established API client and error handling.
Do not bypass CSRF/session/credential behavior.
If request/response meaning changes, use `lockin-api-contract-guardian`.

## PWA

When touching:
- service worker
- update flow
- offline behavior
- cache handling

Preserve the rule that private API responses/authenticated data are not generically cached.
Do not force an update during a sensitive active flow unless explicitly designed.

## i18n / RTL

Treat Arabic as a first-class direction change.
Avoid hardcoded left/right behavior when logical properties or direction-aware layout should be used.
Do not modify translation identifiers casually without finding all consumers.

## Performance

Watch:
- giant component rerenders
- expensive work in render
- unbounded list rendering
- oversized new dependencies
- duplicated PDF/image work
- unnecessary global listeners

Do not "optimize" without evidence if the code is already simple.

## Validation

Use `lockin-test-selector`.
For UI behavior, prefer the narrow unit/Playwright family that proves the change.
For responsive work, use `lockin-responsive-a11y`.
For Focus/PDF, switch to `lockin-focus-pdf-guardian`.

## Completion

FRONTEND RESULT
STATE OWNER: <where>
API IMPACT: <none/change>
PWA IMPACT: <none/change>
RTL/RESPONSIVE: <impact>
TESTS: <evidence>
RISK: <remaining>
