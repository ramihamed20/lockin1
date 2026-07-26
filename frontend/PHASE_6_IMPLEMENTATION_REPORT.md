# Phase 6 — Contextual community, creator spaces, and reporter status

## Result

Phase 6 is complete. The replacement frontend now uses the existing Django community and
moderation APIs for contextual discussions, replies, creator spaces, membership changes, and
report submission/status. The phase was deliberately limited to reporter-facing moderation data:
it does not add moderator assignment, transitions, evidence, or an invented administration UI.

No stylesheet, design token, font, layout, image, breakpoint, or theme behavior was changed.
All new UI composes the replacement frontend's existing `Page`, panel, form, list, button,
loading, empty, error, breadcrumb, and confirmation-dialog patterns.

## Django contracts verified

| Area | Endpoint / method | Frontend use |
| --- | --- | --- |
| Contextual discussion feed | `GET /api/v1/community/discussions?context_type=&context_id=&space_id=&cursor=&page_size=20` | Server-visible global, context, and space feeds with safe cursor parsing. |
| Discussion detail / edit / removal | `GET`, `PATCH`, `DELETE /api/v1/community/discussions/{id}` | Reads detail; writes `{ expected_revision, title, body }` and uses server tombstones/revisions. |
| Discussion creation | `POST /api/v1/community/discussions` | Sends `{ context_type, context_id, space_id?, title, body, client_request_id }`. |
| Replies | `GET`, `POST /api/v1/community/discussions/{id}/comments`; `PATCH`, `DELETE /api/v1/community/comments/{id}` | Uses the documented 40-item cursor page, one-level server parent relationship, revisions, and client request IDs. |
| Creator spaces | `GET`, `POST /api/v1/community/spaces`; `GET /api/v1/community/spaces/{id}` | Displays only server-visible spaces. Creation sends the backend's lesson/learning-object context contract. |
| Space membership | `POST /api/v1/community/spaces/{id}/members`; `DELETE /api/v1/community/spaces/{id}/members/{user_id}` | Manager UI depends on returned `can_manage`; invitation uses email or user ID exclusively, with backend roles `member` / `moderator`. |
| Reports | `GET`, `POST /api/v1/moderation/reports`; `GET /api/v1/moderation/reports/{id}` | Sends `{ target_type, target_id, reason, description, client_request_id }`; displays only common reporter-safe fields. |

The backend uses session cookies and CSRF. Phase 0's same-origin request client remains the only
authenticated client; this phase did not add bearer tokens, refresh tokens, a second API client,
or any external URL path.

## Implementation

- Added `src/api/community.js`, which validates resource UUIDs, keeps all requests on the
  internal API client, preserves server errors, and extracts cursor values only from the matching
  internal endpoint.
- Replaced the previous generic/fake community surface with real global, contextual, and
  private-space feeds. The home page explicitly states that unsupported generic posts, likes,
  tags, and announcements are unavailable.
- Added real routes for discussion detail, contextual discussions, creator spaces, and reporter
  status. The route guard recognizes only the backend context types and continues to deny unknown
  routes by default.
- Added existing-style entry points from a learning object and a quiz to their respective
  contextual discussion views.
- Added edit/delete actions only when Django returns `can_edit` / `can_delete`; conflicts reload
  the current server version. Report controls are not displayed for the user's own visible
  discussion/comment.
- Added stable `client_request_id` values across a failed submission retry; a new value is made
  only after successful creation. No generic HTTP idempotency header is sent because these Django
  endpoints do not contractually support one.
- Kept authoritative visibility, membership, permissions, report status, moderation, revisions,
  and deleted-content handling on Django. React renders escaped text only and never derives scores,
  access, or moderation outcomes.

## Files changed for this phase

- `src/api/community.js` — new exact community and reporter API service.
- `src/components/community/index.jsx` — reusable contextual links, cards, forms, validation,
  mutation notices, and manager membership control.
- `src/pages/Community.jsx` — real community home and contextual feed.
- `src/pages/Discussion.jsx` — real detail, replies, revision-safe mutations, and reporting.
- `src/pages/CommunitySpace.jsx` — real private space and server-gated membership UI.
- `src/pages/CommunityReport.jsx` — reporter-safe report status detail.
- `src/App.jsx` — Phase 6 lazy route wiring.
- `src/pages/LearningObjectStudy.jsx`, `src/pages/QuizDetail.jsx` — contextual discussion entry
  points using the current visual system.
- `src/lib/authz.js` — guarded real community route recognition.
- `eslint.config.js`, `tsconfig.phase0.json`, `tests/phase6.test.js` — Phase 6 coverage and
  source inclusion.
- This report and `reviews/PHASE_6_CODEX_REVIEW.md`.

No dependency, lockfile, environment, service-worker, or backend source change was required.

## Runtime verification

Against the isolated local Django test server, browser verification covered:

- loading the signed-in community home with real visible discussion, private-space, and report data;
- opening a learning material's contextual discussion entry point;
- creating and editing a contextual discussion with Django-assigned identity/revision;
- posting a real reply and loading its discussion detail;
- opening a real private creator space, including the member-only view where `can_manage` was
  false and management controls were correctly absent;
- submitting a report against another author's visible content, then loading its real report-status
  page without moderation evidence or workflow controls.

## Checks executed

```powershell
# frontend (bundled Node runtime on PATH)
pnpm test                 # passed: 27 tests
pnpm run lint             # passed: zero warnings
pnpm run typecheck        # passed
node .\node_modules\vite\bin\vite.js build  # passed: Vite 6.4.3 + PWA build

# read-only Django verification
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:DJANGO_SETTINGS_MODULE = 'config.settings.test'
$env:LOCKIN_TEST_USE_SQLITE = '1'
.\.venv\Scripts\python.exe manage.py check  # passed: 0 issues

# repository integrity
git diff --check          # passed
git diff --name-only -- backend  # no unstaged backend source changes
```

The package declares Node `24.16.0`; the bundled `24.14.0` emitted its pre-existing engine
warning but completed every check successfully.

## Known backend limitations handled truthfully

- Django provides no member-list endpoint. The manager UI can invite/update a member by email and
  revoke the member returned by that mutation during the same session; it does not invent a
  directory or an unverifiable existing-members list.
- Django exposes no generic/unaffiliated community post, likes, tags, or announcements endpoint;
  the existing visual surface stays present as a contextual guidance state instead of faking them.
- This phase intentionally does not expose report evidence, assignment, transitions, or moderator
  actions. Those require the Django moderation-workspace capability and belong to a later phase.
- A seeded local discussion returned `comment_count: 0` while its comments endpoint returned a
  visible reply. The UI faithfully displays the server-supplied count and list; it does not make up
  a corrected authoritative count.

## Backend integrity

No backend file was modified by Phase 6. The repository already contains two staged backend paths
(`backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`) that predate this phase;
they were inspected, not changed, staged, unstaged, or reverted by this work.
