# Codex phase review protocol

## Purpose and authority

This protocol is used after the implementation AI submits one phase report. Codex acts as technical
architect and reviewer, not a feature re-implementer. The backend is read-only and authoritative.
The current replacement frontend is the visual source of truth. The legacy backup is functional
reference only and must not be used to judge visual fidelity.

A phase is approved only after the requested phase works with real backend data, keeps the current
visual design, has no critical or major issue, passes required checks, and leaves every backend source
file unchanged.

## Inputs required before a review

The implementation AI must provide its named phase report, commands/results, known limitations and
files changed. Codex then inspects:

- The approved phase prompt, implementation plan, capability matrix, and previous review/correction.
- The phase diff and current Git status, including staged, unstaged, untracked, and generated files.
- Relevant current frontend routes, components, API modules, tests, package/build configuration.
- Django routes, serializers, views, selectors, policies, permissions and tests in read-only mode.
- The real local frontend and Django server where authentication/demo data permits.

If the report says a backend limitation blocks behavior, Codex verifies that statement against backend
source before accepting it.

## Review sequence

### 1. Scope and boundary review

1. Compare all changed files to the named phase's likely files and acceptance criteria.
2. Identify unrelated refactors, design changes, new dependencies, deleted features, changes to other
   phase domains, generated output, and unapproved package changes.
3. Run Git name-only/status inspection. Confirm no backend source/configuration/models/serializers/
   views/URLs/permissions/migrations/tests/static/media file changed.
4. If backend changes are present, reject the phase unless they are pre-existing user changes clearly
   outside the implementation diff. Do not silently revert user work; name the exact file and require
   the implementer to remove its accidental modification.

### 2. API contract review

For every endpoint touched, verify from Django source and the capability matrix:

- Exact relative endpoint, HTTP method, query encoding, JSON versus multipart body, headers,
  credentials and CSRF behavior.
- Required/optional fields, field names, UUID/idempotency/revision data, and no invented fields.
- Response parsing, nullability, enums, binary/204 handling, Django error envelope and field errors.
- Page pagination versus cursor pagination, page size limits, filter reset and end-of-list behavior.
- 401 session-expiry behavior, 403 forbidden behavior, 404/410 target behavior, 409 conflict
  recovery, and 429 rate-limit behavior.
- Mutation cache/list/detail/dashboard refresh after success. Review that failed requests do not
  produce a local success.

For session authentication, reject any token refresh scheme, Authorization bearer header, session
identifier storage, disabled CSRF handling, or cross-origin workaround that changes backend behavior.

### 3. Role and permission review

Verify both presentation and server-truth behavior:

- Visitor, student, creator, moderator, administrator, and operational-capability user route guards.
- Hidden navigation, direct deep-link forbidden state, and backend 403 response recovery.
- Product roles versus operational roles/capabilities are not conflated.
- Creator scope/ownership action visibility does not promise an action denied by backend.
- Moderator report conflict, reporter visibility, private-space management and administrator-only
  actions follow returned permissions/policies.
- Student cannot reach creator/admin/operations data through client routing or cached response.
- Action visibility is not considered authorization: all tests exercise server denial paths.

### 4. Security and integrity review

Search and inspect for:

- Client-controlled score, correct answer, XP, streak, completion, mastery, achievement, rank,
  entitlement, subscription or payment state.
- Correct answers/explanations loaded before a released result, management answer payload leaking into
  student state, public cache, local storage, URL, logs or analytics.
- Session/JWT secrets, CSRF values, confirmation tokens, checkout data or operational tokens stored
  in local/session storage, URLs, source, or console.
- Missing credentials/CSRF, unsafe raw HTML or dangerouslySetInnerHTML, unsanitized DOM injection,
  unsafe external file/document handling, or PWA caching of private API/files.
- Optimistic destructive/financial/access changes that declare success before server confirmation.
- Missing UUID idempotency, expected_revision or conflict behavior where backend requires it.
- Unauthorized control activation after role/scope changes or a 401/403.

Any answer leakage, authority manipulation, exposed secret, authentication bypass, arbitrary unsafe
HTML, or backend modification is critical.

### 5. UI consistency review

Compare implementation with the current replacement, not the legacy backup:

- Existing design-system components, CSS classes/tokens, typography, colors, spacing, card/form/
  table language, icons, images, shadows, animation and transitions are reused.
- New routes fit current navigation, desktop shell, mobile bottom nav/drawer, themes and responsive
  breakpoints. No old frontend visual patterns are copied.
- Loading uses current reserved-space/skeleton behavior; empty state explains real absence; errors,
  retry, forbidden, validation, disabled, pending release/access and offline/conflict states are
  visually non-disruptive.
- Keyboard focus, modal/drawer focus handling, labels, semantic controls, contrast and reduced motion
  remain at least as good as existing UI.
- Verify phone, tablet and desktop widths, all current themes, long strings and Arabic/RTL if the
  implementation touches localized/account UI. Detect horizontal overflow and console errors.

### 6. Code-quality review

Check for duplicated API logic/components, hardcoded URLs/user IDs/roles, unsupported fake data,
unsafe any-like assumptions in JSDoc/JS, stale state, unused imports, broken lazy routes, unresolved
asset paths, runtime exception paths and dependency bloat. Confirm shared pieces are actually reused
where a second phase will need them. Check mutation source refresh and cancellation of stale async
effects.

### 7. Verification review

Run in proportion to the phase and record exact commands/results:

1. Install only if lockfile/package change requires it.
2. Lint, contract/JSDoc or configured type check, unit/component tests, and production frontend build.
3. Start development or preview frontend and Django read-only verification server where needed.
4. Exercise relevant real backend flows using approved demo accounts; verify request/response in the
   browser/network or server behavior without mutating backend source.
5. Run relevant responsive/browser checks and inspect assets/fonts.
6. Run Django manage.py check in read-only verification mode when the environment is available.
7. Run Git diff --check, Git status, and Git diff --name-only to reconfirm backend unchanged.

A passing bundle alone never approves a phase.

## Severity and verdict rules

| Severity | Meaning | Required action |
| --- | --- | --- |
| Critical | Security/integrity breach, backend modification, auth/permission bypass, answer leak, client authority over protected result/access, destructive action falsely succeeds | Reject; correction is mandatory before rerun. |
| Major | Required phase flow broken, API contract wrong, server validation ignored, route/role guard wrong, mutation stale/conflict unsafe, substantial visual regression, required check fails | Reject; correction is mandatory. |
| Minor | Small correctness/accessibility/consistency issue with working core flow, missing narrow state, cleanup that does not alter required outcome | Approved with minor corrections only if no critical/major issue. |
| Informational | Optional non-blocking improvement or verified limitation | Does not block approval. |

Use these verdicts only:

- **Approved:** all acceptance criteria and required checks pass; no critical, major, or uncorrected
  minor issue; backend unchanged.
- **Approved with minor corrections:** required workflows/checks pass and backend is unchanged, but
  bounded non-blocking corrections remain. A follow-up review still verifies them.
- **Rejected:** any critical/major finding, failed required check, unverified real workflow, scope
  breach, or backend source modification.

## Required review output

For every review, create exactly:

frontend/reviews/PHASE_[NUMBER]_CODEX_REVIEW.md

Use this structure.

# Phase [NUMBER] Codex review

## Verdict

Approved | Approved with minor corrections | Rejected

## Scope

- Requested phase:
- Features reviewed:
- Files reviewed:
- Unrelated changes:
- Backend unchanged confirmation: include Git evidence and explain any pre-existing user changes.

## Evidence and checks

| Check | Command or flow | Result | Notes |
| --- | --- | --- | --- |
| Lint | | Pass/Fail/Not configured | |
| Contract/JSDoc/type check | | Pass/Fail/Not configured | |
| Frontend tests | | Pass/Fail/Not run | |
| Production build | | Pass/Fail | |
| Real backend runtime flows | | Pass/Fail/Blocked | |
| Responsive/theme/visual review | | Pass/Fail | |
| Django read-only system check | | Pass/Fail/Not run | |
| Git diff and backend boundary | | Pass/Fail | |

## Acceptance criteria

- Passed:
- Failed:
- Not verifiable and why:

## Findings

Every finding must be a separate item in this exact format.

### [Severity] Short finding title

- File path: absolute or repository-relative path
- Function/component/route:
- Evidence:
- Problem:
- Expected behavior:
- Precise correction instructions:
- Retest required:

Include a separate subsection even when there are no findings:

- Critical bugs:
- Major bugs:
- Minor bugs:
- API contract mismatches:
- Permission problems:
- Security findings:
- UI consistency problems:

Write "None found" only after actually checking that category.

## Required corrections

Numbered, prioritized, implementation-ready instructions. Each correction must name exact route/API
contract/component and objective acceptance condition.

## Optional improvements

Non-blocking items only.

## Correction prompt for the implementation AI

When verdict is Rejected or Approved with minor corrections, include a ready-to-send prompt:

"Implement only corrections for Phase [NUMBER]. Preserve current replacement visual identity. Modify
frontend files only. Do not change Django. For each numbered correction above, use the exact endpoint,
method, request/response, role and state stated in this review; do not add unrelated refactors.
Re-run [named failed checks], verify [named real flow], update the phase report, then stop."

Replace bracketed text with concrete correction and test names. Do not issue generic correction prompts.

## Final backend confirmation

State whether any backend file was modified. If no, state the Git command/evidence used. If yes, verdict
must be Rejected and the exact accidental file/change must be reported.

## Review handoff rules

- Do not mark a phase Approved merely because the implementation AI says it is done.
- If rejected, provide focused correction instructions; do not rewrite the entire implementation unless
  explicitly requested by the user.
- Review only the requested phase and strictly necessary shared foundation changes. Defer unrelated
  backend-supported product features to their scheduled phase.
- A backend limitation must remain an honest disabled/unavailable visual state; it is never a reason
  to invent an API or fake success.
- After corrections, create a new review revision in the same phase file with date/time and a concise
  prior-findings resolution table, retaining the original evidence.

