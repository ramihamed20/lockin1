# Phase 4 implementation report

## Outcome

Phase 4 is complete. The replacement frontend now opens the existing Focus canvas only from a Django-provided `focus_context` and drives document access, sessions, workspace persistence, and personal annotation persistence through the real Django Focus API. Django remains the sole authority for document access, entitlement, session timing, session completion, workspace revisions, and annotation revisions.

No stylesheet, asset, font, design token, theme, breakpoint, shell, routing architecture, state-management framework, or UI library was changed. The existing PDF/canvas chrome, toolbar, panels, controls, animation behavior, and responsive layout are reused.

## Files changed

| File | Reason |
| --- | --- |
| `src/api/focus.js` | Exact same-origin adapters and response validation for Focus documents, sessions, workspace revisions, annotation pagination, and annotation mutation batches. |
| `src/pages/FocusWorkspace.jsx` | New protected Django-backed Focus route: entitlement/error state, idempotent start, server workspace restore/autosave, page annotation loading/sync/recovery, and pause/resume/complete/abandon actions. |
| `src/pages/SheetStudy.jsx` | Exports the existing visual PDF/canvas surface as `FocusPdfWorkspace` and wires it to server workspace/session callbacks without a visual redesign. Server-backed pixel erasing is disabled because Django cannot represent that destructive geometry safely. |
| `src/pages/LearningObjectStudy.jsx` | Shows the existing-style Focus action only when Django supplies the supported `focus_context`. |
| `src/App.jsx` | Adds the lazy, protected `/focus/:documentVersionId` route. |
| `src/lib/authz.js` | Allows exactly one authenticated Focus document route; unknown/deeper paths remain denied. |
| `eslint.config.js`, `tsconfig.phase0.json` | Includes the new Phase 4 JavaScript files in existing checks. |
| `tests/phase4.test.js` | Covers exact Focus paths, methods, payloads, CSRF, revisions, guarded routing, terminal-sync behavior, and static-only PWA behavior. |
| `reviews/PHASE_4_CODEX_REVIEW.md` | Independent self-review record and approval verdict. |

## Django contracts verified

| Workflow | Existing API contract used |
| --- | --- |
| Focus document | `GET /focus/documents/{document_version_id}` provides document metadata, same-origin `view_url`, latest workspace, annotation revision, and summary. |
| Start/reuse session | `POST /focus/sessions` sends `document_version_id`, a stable UUID `client_instance_id`, and optional documented planned duration. Django returns the active/reused session and workspace. |
| Session actions | `POST /focus/sessions/{id}/{pause|resume|complete|abandon}` sends `{}` and uses Django's returned session status. |
| Workspace | `PATCH /focus/sessions/{id}/workspace` sends `expected_revision`, page, zoom, sidebar, active tool, layout, and up to eight tabs. A `409` reloads Django's latest workspace. |
| Annotations | `GET /focus/documents/{document_version_id}/annotations` uses the `pages`, `page`, and `page_size` contract. `POST` sends `expected_collection_revision`, UUID idempotency key, at most 100 total upserts/deletions, and honors `409` recovery. |

## Security and compatibility decisions

- The page accepts only the server's same-origin `/api/v1/files/{uuid}/view` document path; it does not turn a server field into an arbitrary external authenticated request.
- The Phase 0 same-origin cookie/CSRF client remains in use. No JWT or bearer-token flow was added, and the only session-storage value is a non-secret stable client-instance UUID used for documented session-start idempotency.
- The static-only service worker continues to cache no API, authentication, document, annotation, session, score, progress, purchase, subscription, notification, or administrator response. It removes the obsolete `api-cache` name on activation.
- Focus time, active duration, session status, completion, entitlement, workspace revision, and collection revision are displayed from Django responses. The frontend computes none of them authoritatively.
- Annotation data is rendered as canvas points only, never as HTML. It is kept in memory while unsaved and is never claimed to be saved after a network error or `409`.
- Explicit close waits for annotation synchronization and an active-session pause. Complete and abandon also flush annotations before their documented Django action. A failure leaves the user in the visible workspace with retry/error state instead of navigating away silently.
- The former unmounted legacy sheet implementation remains outside all live routes and its compatibility API throws a truthful unavailable error; the production Focus chunk contains no legacy sheet endpoint, XP, answer, or fake advanced-study string.

## Visual impact

No CSS changed. `FocusWorkspace` composes the existing `FocusPdfWorkspace` canvas rather than replacing it. It preserves the replacement frontend's cards, toolbar, tool panels, buttons, loading/error panels, responsive PDF layout, icons, spacing, typography, colors, and theme behavior. The old frontend was not used as a visual reference.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run lint` | Pass, no warnings. |
| `pnpm run typecheck` | Pass. |
| `pnpm test` | Pass: 21 tests, 0 failures. Phase 4 tests cover exact endpoint/method/body/CSRF behavior, route guarding, collection revision preservation, terminal annotation flush, and no API PWA cache. |
| `node .\\node_modules\\vite\\bin\\vite.js build` | Pass: Vite 6.4.3 production build. |
| Production Focus bundle scan | Pass: no `/api/sheets`, fabricated XP, correct-answer, Final Boss, or advanced-study mock string in the emitted Focus chunk. |
| Local frontend availability | Pass: `http://127.0.0.1:5050/` returned HTTP 200. |
| Live Django material/Focal access flow | Pass: a signed-in demo user navigated real published material hierarchy to a real learning object; Django supplied a `focus_context` and the server PDF link. The server correctly returned 403 for that account's missing `focus.workspace` entitlement, and the UI rendered the explicit non-disruptive denial state. |
| Django read-only check | Pass: `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, `.venv\\Scripts\\python.exe manage.py check`. |
| Git boundary checks | Pass: `git diff --check` and `git diff --cached --check`. |

The available runtime is Node 24.14.0 while `package.json` declares Node 24.16.0. All checks passed with only the non-blocking engine warning.

## Remaining limitations

- The available demo account has no `focus.workspace` entitlement, so it truthfully receives Django's 403 state. A disposable entitled account is required to capture a live positive start/pause/resume/workspace/annotation mutation trace; exact client contracts and Django Focus tests were verified read-only.
- The existing canvas provides freehand pen, pencil, and highlighter semantics. Django can also store shapes, text, and sticky notes, but this visual surface has no matching native controls. Such saved annotations are preserved untouched and a clear unavailable notice is shown instead of silently hiding, modifying, or fabricating them.
- Annotation pagination is intentionally limited to the backend-supported one to ten requested pages; clear-all only affects the supported, loaded freehand annotations and labels that scope in the existing UI.

## Backend boundary confirmation

All Phase 4 implementation writes are under `frontend/`. No Django source, settings, model, serializer, view, URL, migration, test, task, WebSocket, database schema, or backend configuration file was changed by this phase. The only backend Git status paths are the pre-existing staged `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; this phase did not touch either path.
