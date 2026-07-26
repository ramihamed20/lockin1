# Phase 7 — Creator content studio

## Result

Phase 7 connects the existing replacement UI to Django's creator and administrator
management APIs. It adds real, revision-safe management workflows for the education hierarchy,
learning content and uploads, questions, and quizzes. The work is limited to the planned creator
studio routes; it does not begin the administration, commerce, notifications, analytics, or any
new product feature phase.

No stylesheet, token, font, asset, layout, breakpoint, theme behavior, or animation was changed.
The new screens use the replacement frontend's existing shell, panels, forms, buttons, lists,
empty states, loading state, error panel, confirmation dialog, and responsive navigation patterns.

## Local demo repair and live creator verification (2026-07-23)

The user subsequently authorized a backend change solely to make the local demo usable. The
development-only `seed_demo` command had written education paths using title slugs, while the
existing Django scope policies correctly use the production UUID-path format. That mismatch meant
the documented creator account could read its scoped records but could not create within the same
scope. The command now finds demo nodes by their parent/slug and repairs their paths in place,
preserving existing document, question, quiz, and scope references. No model, serializer, view,
URL, authentication, permission policy, setting, migration, or API contract was changed.

The local SQLite demo database was reseeded under `config.settings.demo`. This intentionally
updated `backend/.lockin-demo.sqlite3` and created one visible creator-owned draft video titled
`Creator workspace verification video` as a live UI verification artifact.

The same DEBUG-only seed command now materializes valid single-page PDF files in local Django
media storage for every seeded study guide. This fixes the Focus workspace's real file-delivery
path; a live authenticated check returned the document metadata and its `/api/v1/files/.../view`
endpoint as `200 application/pdf` with a `%PDF-1.4` payload.

Two frontend compatibility corrections were made without visual changes:

- Optional blank `summary`, `explanation`, and `instructions` fields are omitted from creator
  writes. Django's strict serializers supply their documented defaults when the fields are absent
  but reject an explicit empty string.
- An expired Django session returned as `403/not_authenticated` now completes a local logout;
  other 403 responses, including permission and CSRF failures, retain the authenticated UI. A
  successful sign-in also clears a prior session notice.

Live browser verification used the documented `creator@lockin.local` development account. It
successfully opened every Creator Studio tab, loaded real data, created the draft video through
the replacement UI, and displayed the exact Django rule message for a PDF creation request with
no uploaded primary file: `A primary file is required for PDF and audio content.`

## Django contracts verified

| Module | Endpoint and method | Frontend use |
| --- | --- | --- |
| Creator hierarchy | `GET`, `POST /api/v1/management/education/nodes`; `PATCH /{id}`; `POST /{id}/move`; `POST /{id}/status` | Uses Django's `P25` page size for the visible list, `P100` only to populate server-visible parent choices, exact node kinds, `expected_revision`, and `published` / `archived` status values. |
| Creator scopes | `GET /api/v1/management/education/scopes` | Shows the server-returned scope/capability records. Scope and ownership remain enforced by Django. |
| Learning content | `GET`, `POST /api/v1/management/content`; `GET`, `PATCH /{id}`; lifecycle `POST` actions | Reads/writes all version fields, revision number, ownership, review note, and workflow status. Content actions are `submit`, `publish`, `reject`, `archive`, and the administrator-only `transfer`. |
| Managed files | `POST /api/v1/management/files` | Sends native multipart `FormData` with `kind` and `file`; the browser owns the multipart content-type boundary. Validation and scan results come only from Django. |
| Question bank | `GET`, `POST /api/v1/management/questions`; `GET`, `PATCH /{id}`; lifecycle `POST` actions | Uses the management-only question form and exact `options: [{ text, is_correct }]` contract. Correct-option data stays inside lazy creator routes, never student assessment state. |
| Quiz studio | `GET`, `POST /api/v1/management/quizzes`; `GET`, `PATCH /{id}`; lifecycle `POST` actions | Sends Django's complete quiz version contract, including selection mode, question IDs, duration, availability, release policy, ranking/achievement flags, and current revision. |

All Phase 7 requests use the existing same-origin session-cookie/CSRF client. The implementation
does not add tokens, bearer authentication, a second API client, external API URLs, or a cache for
authenticated data.

## Implementation

- Added `src/api/management.js`: a single creator-management service with strict UUID boundary
  checks, exact request serializers, P25/P100 pagination use, multipart upload support, lifecycle
  action validation, and Django response-shape checks.
- Added `src/components/creator/index.jsx`: creator route gate, studio tabs, validation/error
  helpers, status display, node/question/quiz selectors, upload state, and revision-aware workflow
  actions. Rejection, archive, and retire flows keep the current dialog pattern.
- Added the Education, Content, Question, and Quiz creator pages and the six detail routes. Each
  mutation sends `expected_revision`, displays field/global Django errors, handles 409 by
  reloading, and uses the response returned by Django rather than producing local success data.
- Attached the real routes in `src/App.jsx`, kept them inside the existing `ProtectedRoute`, and
  added a second creator/administrator role gate. The exact server product roles are
  `creator` and `administrator`; unknown/missing roles fail closed.
- Added the existing-style `Creator Studio` navigation entry only for these exact roles.
- Replaced the deferred creator placeholder with the real implementation. Student accounts cannot
  enter creator routes; the live browser check showed the existing access-unavailable state.
- Kept uploads truthful: a file is attachable only after the server accepts it; publication and
  safety remain Django decisions. Switching a content type clears an incompatible previously
  selected primary file. Video delivery remains visibly unavailable because Django does not
  implement it.
- Question answers are never copied into student pages, local storage, caches, score logic, XP,
  progress, achievement, ranking, or entitlement logic. Django alone decides all authoritative
  outcomes.

## Files changed for this phase

- `src/api/management.js` — new exact creator-management service.
- `src/components/creator/index.jsx` — reusable creator UI and lifecycle controls.
- `src/pages/CreatorEducation.jsx` — scoped hierarchy list, create, revise, move, and status UI.
- `src/pages/CreatorContent.jsx` — content list/detail, revision form, ownership, and upload UI.
- `src/pages/CreatorAssessments.jsx` — question and quiz list/detail/revision forms.
- `src/App.jsx` — lazy creator route wiring.
- `src/lib/authz.js` — creator/administrator route authorization using documented product roles.
- `src/components/layout/index.jsx` — role-gated Creator Studio navigation entry.
- `eslint.config.js`, `tsconfig.phase0.json`, and `tests/phase7.test.js` — source inclusion and
  Phase 7 contract/security regression coverage.
- This report and `reviews/PHASE_7_CODEX_REVIEW.md`.

No dependency, lockfile, environment, service-worker, backend configuration, schema, or API
change was required for this phase. The only backend source change is the user-authorized
development seed repair described above.

## Security and compatibility decisions

- The shared API client permits only same-origin relative API paths. Management identifiers are
  validated before they are interpolated into a request path, so an authenticated request cannot
  be redirected to an arbitrary origin.
- The existing session cookie remains HttpOnly and is never read or deleted from JavaScript.
  Django's CSRF token is requested/sent only for unsafe same-origin API requests.
- The service worker is unchanged by this phase. It has no API runtime cache and deletes the prior
  `api-cache` entry on activation. Thus creator records, uploads, answers, attempts, progress,
  scores, purchases, subscriptions, notifications, and administrator data are not cached.
- Complete record versions are resent for Django's update serializers; metadata remains `{}` when
  the current visual design supplies no metadata editor. This is the documented optional default,
  not fabricated backend state.
- Creator scope is explanatory UI data only. Django independently checks scope inheritance,
  ownership, workflow state, server revisions, file safety, and administrator-only transfer.

## Runtime and verification

- The Vite frontend was already running successfully at `http://127.0.0.1:5050/` and returned
  HTTP 200 after the Phase 7 build.
- A live signed-in student session was navigated to `#/creator/education`. It stayed inside the
  current replacement shell, showed the existing forbidden state, exposed no Creator Studio
  navigation item, and produced no browser-console error.
- Real anonymous `GET` checks against the local Django service returned HTTP 403 for the session
  and every creator-management endpoint, confirming their backend access boundary.
- With the user's authorization, the local demo was reseeded and the documented creator account
  was signed in through the replacement UI. It loaded the scoped hierarchy, six seeded documents,
  twelve questions, and three quizzes; then created a real scoped video draft. The same UI showed
  Django's exact primary-file validation error for an invalid PDF request. Upload, publish,
  archive, transfer, question, and quiz mutations remain covered by the exact contract tests and
  are intentionally not simulated by fabricated client state.

## Checks executed

```powershell
# frontend (bundled Node runtime on PATH)
node --test tests/*.test.js                         # passed: 32 tests
node .\node_modules\eslint\bin\eslint.js --max-warnings 0  # passed
node .\node_modules\typescript\bin\tsc --project tsconfig.phase0.json --pretty false  # passed
node .\node_modules\vite\bin\vite.js build        # passed: Vite 6.4.3 + PWA build

# read-only Django verification
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:DJANGO_SETTINGS_MODULE = 'config.settings.test'
$env:LOCKIN_TEST_USE_SQLITE = '1'
.\.venv\Scripts\python.exe manage.py check  # passed: 0 issues

# live read-only endpoint and browser checks
Invoke-WebRequest http://127.0.0.1:5050/     # passed: HTTP 200
# anonymous GET requests to /api/v1/auth/session and all Phase 7 management
# collection endpoints returned the expected HTTP 403
```

The package declares Node `24.16.0`; the bundled `24.14.0` emitted its existing engine warning
but completed every check successfully.

## Backend limitations handled truthfully

- Video metadata can be created, but Django explicitly does not implement video delivery or
  publishing. The form keeps the existing visual pattern and clearly states that no primary file
  is attached; it never fakes delivery.
- Django provides no Phase 7 user directory/search endpoint. The content transfer control is shown
  only to an administrator and requires the exact destination user UUID, as the backend contract
  requires. It does not invent a user picker.
- Django provides no creator-facing managed-file list endpoint. The UI displays the just-uploaded
  server response and the current primary asset returned with a content version; it does not
  manufacture a file library or scan result.

## Backend integrity

The user authorized backend changes for this local trial. The phase modified only
`backend/platform_core/management/commands/seed_demo.py`, a DEBUG-only demo-data command, and
ran it against the local SQLite demo database. Backend models, serializers, views, URLs,
permissions, authentication, settings, migrations, tests, and production behavior remain
unchanged. The repository's pre-existing staged `backend/config/settings/demo.py` was not edited.
