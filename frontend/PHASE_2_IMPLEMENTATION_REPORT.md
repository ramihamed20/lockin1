# Phase 2 implementation report

## Outcome

Phase 2 is complete. The replacement frontend now uses real Django data for the student dashboard, academic hierarchy, published materials, search, bookmarks, secure file links, and learning-object progress. No CSS, asset, font, theme token, breakpoint, or UI library was changed.

Quiz attempts/results, answer review, Focus sessions, annotations, XP, streaks, rankings, notifications, and study-plan editing are outside this phase. Their visible controls are disabled or unavailable rather than simulated.

## Files changed

| File | Reason |
| --- | --- |
| `src/api/learning.js` | Exact API adapters for dashboard metadata, education nodes, learning objects, and search. |
| `src/api/progress.js` | Learning dashboard, bookmarks, resume, and revision-safe progress adapters. |
| `src/components/learning/BookmarkButton.jsx` | Server-confirmed bookmark UI. |
| `src/components/learning/LearningObjectCard.jsx` | Server material cards in current sheet-card styling. |
| `src/components/learning/PaginationControls.jsx` | P25 previous/next controls. |
| `src/hooks/useAsyncData.js` | Focused reload handle for retry/refetch. |
| `src/components/shared/StatsGrid.jsx` | Supports server-derived metric cards without changing card markup. |
| `src/pages/Dashboard.jsx` | Replaces fabricated metrics/content/goals/study-plan calls with server data and unavailable states. |
| `src/pages/Materials.jsx` | Connects hierarchy, breadcrumbs, filters, P25 lists, and material cards. |
| `src/pages/LearningObjectStudy.jsx` | Secure reader entry, direct file links, bookmarks, revision-safe progress, and legacy sheet-link compatibility. |
| `src/pages/Bookmarks.jsx` | Real paginated bookmarks and confirmed removal. |
| `src/pages/Search.jsx` | Server-indexed search with supported filters and P25 controls. |
| `src/App.jsx`, `src/components/layout/index.jsx`, `src/lib/authz.js` | Real search/reader routing, top-bar search destination, authenticated route allowlist. |
| `eslint.config.js`, `tsconfig.phase0.json`, `tests/phase2.test.js` | Phase 2 checking and contract tests. |

## Django contracts verified

| Workflow | Existing endpoint and behavior |
| --- | --- |
| Dashboard | `GET /dashboard`, `GET /learning/dashboard`, `GET /progress/resume?page=&page_size=`; all counts/resume/review facts are server values. |
| Hierarchy | `GET /education/nodes?parent=&page=&page_size=`, `GET /education/nodes/{id}`; immediate-parent traversal and returned breadcrumbs. |
| Materials | `GET /learning-objects?node=&content_type=&page=&page_size=`, `GET /learning-objects/{id}`; only returned published version/assets/progress render. |
| Search | `GET /search?q=&kinds=&content_types=&academic_path=&page=&page_size=`; arrays are comma-separated. |
| Bookmarks | `GET /bookmarks`, `POST /bookmarks` with `learning_object_id`, `DELETE /bookmarks/{learning_object_id}`. |
| Progress | `GET,PUT /progress/learning-objects/{id}`; PUT sends `expected_revision`, `status`, `completion_percent`, and `position`; `409` refetches state. |
| Files | Returned `view_url`/optional `download_url` are accepted only for `/api/v1/files/{uuid}/{view|download}` and remain normal same-origin Django links. |

## Security and compatibility

- The static-only service worker still does not cache `/api/`, authenticated data, private files, questions, answers, or other user data.
- The reader rejects arbitrary file URLs and never routes file links through the authenticated client/cache. A null `download_url` disables download.
- Bookmark/progress UI changes only after Django responds. Progress conflict reloads the latest revision rather than overwriting it.
- The legacy sheet URL resolves to the real reader. Invalid IDs render Django's error state, not a mock study screen.
- The focus timer is explicitly device-local and cannot grant progress, XP, or completion. Missing study-plan support is disabled.

## Visual impact

No CSS changed. The phase reuses the replacement `Page`, panel, material/sheet grid, list-row, card, button, form, `ProgressLine`, `LoadingPanel`, `ErrorPanel`, `EmptyState`, shell, icon, theme, and responsive classes.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run lint` | Pass, no warnings. |
| `pnpm run typecheck` | Pass. |
| `pnpm test` | Pass: 17 tests, 0 failures. |
| `node .\\node_modules\\vite\\bin\\vite.js build` | Pass: Vite 6.4.3 production bundle and static-only service worker. |
| Live dashboard | Pass: real completed/saved/review/session metrics, resume item, recent material, and review data rendered. |
| Live hierarchy/search | Pass: root and child nodes rendered; real filter/search empty states rendered. |
| Live reader/files | Pass: Dashboard Continue opened a real object and returned secure view/download links. |
| Live progress | Pass: same-value CSRF save retained 45% and advanced revision 1 to 2. |
| Live bookmarks | Pass: remove and restore through Django completed; final saved state confirmed. |
| Missing content | Pass: unknown object rendered `Learning content not found.` with retry. |
| Legacy reader URL | Pass: `#/materials/{node}/sheets/{learning_object}` opens the real reader. |
| Django read-only check | Pass: `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, `.venv\\Scripts\\python.exe manage.py check`. |
| Git boundary checks | Pass: `git diff --check` and `git diff --cached --check`. |

The supplied runtime is Node 24.14.0 while `package.json` declares Node 24.16.0; checks passed with a non-blocking engine warning. A combined PowerShell check exposed a Windows Unicode-path Vite config issue, but the direct Vite command above passed and is the recorded build result.

## Remaining limitations

- Django exposes no study-plan API.
- Checkpoints, attempts/results, answer review, annotations, and Focus workspace are deferred to Phases 3–4.
- Demo data did not include `download_url: null` or a denied material/file for live no-download/403 evidence. Both branches are implemented and reviewed against the serializer/shared error client.

## Backend boundary confirmation

All Phase 2 writes are under `frontend/`. No Django file was created, edited, staged, or unstaged. Backend Git status retains only pre-existing staged `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; this phase did not touch either file.
