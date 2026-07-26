# Phase 4 Codex review

## Verdict

**Approved**

Phase 4 connects the existing Focus surface to Django's real, entitlement-protected Focus contracts. No critical or major issue remains after the self-review correction that prevents closing or terminally ending a session before confirmed annotation synchronization.

## Scope review

- Requested scope: Phase 4 — entitled Focus workspace and annotation synchronization.
- Reviewed features: document access state, session start/reuse, pause/resume/complete/abandon, server workspace restore/autosave, annotation pagination/upsert/delete, revision conflicts, denial/retry behavior, and protected Focus deep links.
- Reviewed files: every implementation and test file listed in `frontend/PHASE_4_IMPLEMENTATION_REPORT.md`; the Phase 0 API/PWA/auth foundations; existing replacement PDF canvas and shared UI patterns; and read-only Django Focus routes, serializers, validation, permission/entitlement checks, and tests.
- Unrelated scope: no Phase 5 motivation/notification feature, creator/admin work, billing, community, CSS redesign, new state framework, or UI library was introduced.

## Evidence and checks

| Check | Result | Notes |
| --- | --- | --- |
| Lint | Pass | `pnpm run lint`, no warnings. |
| Type checking | Pass | `pnpm run typecheck`. |
| Frontend tests | Pass | `pnpm test`: 21/21 passing. |
| Production build | Pass | Vite 6.4.3 direct production build. |
| Runtime availability | Pass | Frontend development server returned HTTP 200 at `http://127.0.0.1:5050/`. |
| Live Django access behavior | Pass | Real material supplied Focus context; an unentitled real account received Django 403 and the UI showed the exact unavailable state rather than fabricating a workspace. |
| PWA/mock scan | Pass | No API runtime cache; no legacy fake sheet/XP/answer strings in emitted Focus bundle. |
| Django verification | Pass | `manage.py check` under demo settings with bytecode disabled. |
| Git boundary | Pass | Both diff checks passed; no unstaged backend path. |

## Acceptance criteria

- Passed:
  - The route is protected and is linked only from Django's real `focus_context`.
  - Server-provided, same-origin document links are validated before the PDF viewer uses them.
  - Session creation uses a stable UUID and never invents entitlement, time, completion, XP, progress, score, or page-unlock state.
  - Pause, resume, complete, and abandon use the exact Django action URLs and `{}` body; the returned session controls visible status.
  - Workspace persistence uses Django's revision, allowed enum values, tab limit, debounced save, and conflict recovery.
  - Annotation reads honor one-to-ten page request limits and pagination. Writes use collection revision, a UUID key, and batches of no more than 100 mutations.
  - `409` annotation recovery reloads Django's revision without claiming the in-memory edits were saved; close/complete/abandon do not navigate away before required sync succeeds.
  - No annotation payload is rendered as HTML. No private Focus/API state is cached by the service worker or persisted as user data in storage.
  - Existing canvas/PDF visual behavior, responsive geometry, theme, panels, controls, and loading/error patterns are reused without stylesheet changes.
- Failed: none.

## API contract review

No mismatch found. The reviewed implementation matches the documented document, session, action, workspace, annotation GET, and annotation POST contracts: paths, methods, CSRF, snake-case payload fields, `expected_revision`, `expected_collection_revision`, `idempotency_key`, JSON/empty-body behavior, pagination, 403, 404, and 409 handling.

## Role and permission review

No problem found. The frontend guard requires an authenticated session only as a UX boundary. It does not infer `focus.workspace` from a role; Django's entitlement response decides access. Unknown/deeper Focus paths are denied by the route helper, and a legitimate 403 remains an explicit unavailable state rather than a logout or privilege escalation.

## Security and integrity review

No critical or major finding remains.

- No client calculation or grant of focus time, completion, XP, progress, score, entitlement, role, or permission exists.
- Same-origin session cookie/CSRF behavior is inherited from the audited shared client. No arbitrary URL can receive authenticated API credentials.
- The service worker has no API runtime-cache route and deletes the historic API cache name.
- The only session-storage value is a non-secret client UUID needed to retry idempotent session start; no PDF, annotation, session, or account payload is stored.
- The app does not expose answers or unsafe HTML through the Focus viewer.

## UI consistency review

No visual inconsistency found. The new route uses the current replacement frontend's existing PDF workspace, toolbar, controls, panels, cards, icons, spacing, theme handling, and responsive behavior. It does not import old frontend styling or alter global CSS.

## Findings

### Critical bugs

None.

### Major bugs

None. The review initially found that an explicit close could navigate before a pending annotation sync and active pause completed. The implementation was corrected before this verdict: close, complete, and abandon now wait for required sync, retain the visible retry state on failure, and are covered by a test assertion.

### Minor bugs

None.

### API contract mismatches

None.

### Permission problems

None.

### Security findings

None.

### UI consistency problems

None.

## Required corrections

None.

## Optional improvements

- Use a disposable entitled Focus account to capture positive live mutation traces without changing the checked-in demo database.
- If the current visual product later adds dedicated shape/text/sticky-note controls, map them to the already verified Django annotation tool contracts instead of approximating them as freehand strokes.
- Use Node 24.16.0 in future checks to remove the non-blocking engine warning.

## Final backend confirmation

No backend file was modified by Phase 4. Final Git checks show no unstaged backend paths. The only backend status paths are the pre-existing staged `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; this phase did not touch either file.
