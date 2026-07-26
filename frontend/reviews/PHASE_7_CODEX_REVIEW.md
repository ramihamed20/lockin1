# Phase 7 Codex review

## Verdict: Approved with minor corrections

### Live-demo update (2026-07-23)

The user authorized a narrow backend change to repair the local development seed command. After
reseeding the SQLite demo database, the documented creator account signed in through the
replacement UI, loaded real creator data, and created a real scoped video draft. A no-file PDF
request returned the exact Django `content_rule_rejected` message rather than fabricated success
or a generic client error. The frontend now omits blank optional creator text fields to match the
strict serializers, and it treats only `403/not_authenticated` as a completed local logout.

The backend change is confined to `backend/platform_core/management/commands/seed_demo.py`.
It repairs legacy local demo hierarchy paths without changing Django models, serializers, views,
routes, permissions, settings, migrations, or production behavior. No critical or major finding
was introduced.

The Phase 7 frontend implementation has no critical or major code, API-contract, permission, or
visual defect in the reviewed scope. Automated checks and live creator read/create/validation
flows pass. The minor-verdict status remains only because a real uploaded-file lifecycle,
question/quiz mutation, and administrator transfer pass was not performed against the shared
local demo data.

## Scope review

Reviewed the new management API service, reusable creator components, education hierarchy,
content/upload, question, quiz, route, navigation, authorization, test, and documentation
changes. The implementation is confined to Phase 7. It does not add administration tooling,
scope grants/revocation UI, commerce, notifications, analytics, a new state-management library,
or a production backend change. The only backend modification is the user-authorized,
DEBUG-only local demo seed repair.

## API contract review

- All management calls use the existing same-origin CSRF/session client and exact inspected Django
  paths and HTTP methods.
- Education uses the actual `LockinPagination` contract: visible data is paged at 25; the
  selector-only complete managed-node lookup uses the documented maximum 100. The implementation
  never follows a backend-provided `next` URL as an arbitrary authenticated destination.
- Create/update/move/status and every workflow mutation include Django's required
  `expected_revision`. Conflict responses keep status, code, message, fields, and request ID via
  the shared `ApiError`; visible record data is reloaded after hierarchy conflicts.
- Content, question, and quiz writes match their strict serializers, including complete update
  payloads, null availability values, optional object metadata, question option names,
  `pass_percent`, and quiz question selection rules.
- Uploads are native `FormData`, send `kind` plus `file`, retain CSRF, and do not set a JSON
  `Content-Type`. JSON, multipart, 204, blobs, and error envelopes remain supported by the shared
  client.
- Forms display Django field errors and global errors. No empty fabricated success payload is used.

## Role, permission, and integrity review

- Creator routes are within the app's existing `ProtectedRoute` and then use the exact backend
  product roles `creator` or `administrator`. A student was live-verified to receive the existing
  forbidden state at `#/creator/education`; unknown roles deny access by default.
- Creator scopes are obtained from Django and shown as advisory information. Ownership, inherited
  scope, reviewer/publisher capability, administrator-only transfer, workflow state, validation,
  file safety, and revision checks remain backend-enforced for every mutation.
- Management answer data is imported only in lazy creator pages. The Phase 7 source regression
  test confirms it does not enter student attempt/result state or local storage.
- The browser does not calculate or grant correct answers, results, scores, XP, streaks,
  completion, mastery, achievements, rankings, purchases, subscriptions, entitlements, or roles.
- No secret, hardcoded user, external authenticated API target, bearer/JWT flow, unsafe HTML
  rendering, or duplicate API client was introduced.
- The Phase 0 service-worker policy remains effective: there is no API runtime cache and the
  legacy `api-cache` entry is deleted during activation.

## UI consistency review

The phase reuses the existing replacement `Shell`, `Page`, panels, form fields, buttons, list
rows, status pills, dialogs, loading panels, empty states, error panel, icons, responsive
navigation, and theme classes. No CSS, visual token, asset, font, animation, or breakpoint was
modified. The live forbidden-route check rendered within the unchanged current shell without a
console error.

## Verification results

| Check | Result |
| --- | --- |
| Frontend tests | Passed — 32 tests, including blank-optional-field and Phase 7 security checks |
| Lint | Passed — zero warnings |
| Type checking | Passed |
| Production build | Passed — Vite 6.4.3 and PWA output generated |
| Django system check | Passed — 0 issues |
| Django education policy tests | Passed — 4 pytest tests using SQLite |
| Local frontend health | Passed — `http://127.0.0.1:5050/` returned HTTP 200 |
| Live student route guard | Passed — creator route produced forbidden UI and no console error |
| Anonymous real management API checks | Passed — all Phase 7 endpoints returned HTTP 403 |
| API-origin / identifier / multipart tests | Passed |
| Service-worker API-cache regression test | Passed |
| `git diff --check` | Passed |
| Backend scope | Only the user-authorized DEBUG-only `seed_demo` repair changed |

## Acceptance criteria

- Creator/admin route guard and role-gated navigation: passed.
- Real Django request serializers for hierarchy, content, uploads, questions, and quizzes: passed.
- Revision and conflict/error handling: passed.
- Student answer isolation and server-authoritative assessment results: passed.
- Existing visual identity and responsive/theme patterns: passed.
- API/authenticated-data cache protection: passed.
- Live creator content creation and Django validation feedback: passed with a documented creator
  session. Uploaded-file lifecycle, question/quiz mutation, and administrator transfer remain
  unexecuted to avoid expanding the shared local demo data.

## Findings

### Critical bugs

None found.

### Major bugs

None found.

### Minor findings from the initial pass (superseded by the live-demo update)

1. **Severity: Minor — verification coverage**
   - **Location:** live local environment, not a frontend source file.
   - **Problem:** The available authenticated session has the `student` role. It correctly cannot
     reach the creator studio, and the documented seeded creator account is absent or has different
     credentials in the database that backs the running server. Real creator-only mutations could
     therefore not be exercised safely.
   - **Expected behavior:** The final approval pass must run real create/update/workflow/upload
     actions as a creator and transfer as an administrator, using a disposable or user-supplied
     authorized account.
   - **Precise correction:** Sign in with an existing creator account, create a scoped draft,
     upload a permitted PDF/audio file, revise it, submit/review/publish/archive it, create a
     question and quiz, and verify a stale revision receives a 409/reload. Then sign in as an
     administrator and verify the manual UUID transfer action. Do not create credentials or change
     backend data without the user's authorization.

### Current minor finding

1. **Severity: Minor — verification coverage**
   - **Location:** live local demo environment, not a frontend source file.
   - **Problem:** Creator sign-in, real data loading, content creation, and backend validation are
     verified. The complete file-upload/review/publish/archive path, question/quiz mutations,
     stale-revision conflict, and administrator transfer were not executed in the shared demo.
   - **Expected behavior:** A later dedicated creator/administrator QA pass should exercise those
     remaining backend-supported workflows using disposable demo records.
   - **Precise correction:** Do not add client fallbacks. Reuse the seeded local demo data, perform
     the remaining server workflows, and update this review with the observed request results.

## Required corrections

- Complete the real creator/administrator runtime verification described above before changing the
  verdict to **Approved**. No frontend code correction is currently required.

## Informational backend limitations

1. **Severity: Informational — backend capability limitation**
   - **Location:** `src/pages/CreatorContent.jsx`.
   - **Problem:** Video delivery and publishing are explicitly unavailable in Django.
   - **Expected behavior:** Do not fabricate a player, file upload, or successful publication.
   - **Resolution:** The UI preserves the content form and explains that video metadata has no
     primary file/delivery path.

2. **Severity: Informational — backend capability limitation**
   - **Location:** `src/components/creator/index.jsx` (`LifecycleActions`).
   - **Problem:** Django has no general user-directory endpoint for choosing a transfer target.
   - **Expected behavior:** Do not invent a user picker.
   - **Resolution:** The administrator-only transfer form requires the exact Django user UUID.

3. **Severity: Informational — backend capability limitation**
   - **Location:** `src/components/creator/index.jsx` (`FileUploadField`).
   - **Problem:** Django has no creator managed-file collection/list endpoint.
   - **Expected behavior:** Do not fabricate an upload library or file safety state.
   - **Resolution:** The interface renders only the returned upload result and the primary asset
     embedded in the managed content version.

## Backend integrity confirmation

Following explicit user authorization, one development-only backend source file was modified:
`backend/platform_core/management/commands/seed_demo.py`. It repairs the local demo path format
and leaves all runtime API behavior, schema, settings, migrations, permissions, authentication,
and production code unchanged. The demo SQLite database was reseeded; the pre-existing staged
`backend/config/settings/demo.py` was left untouched.
