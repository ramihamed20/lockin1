# Phase 2 Codex review

## Verdict

**Approved**

The student discovery and normal-learning-object paths use real Django data, mutations are server-confirmed and revision-aware, the new routes are correctly guarded, and the replacement visual system is preserved. No critical, major, or uncorrected minor finding remains.

## Scope

- Requested phase: Phase 2 — student discovery, content, files, bookmarks, and progress.
- Features reviewed: dashboard/resume, hierarchy/breadcrumbs, material list/filter/P25 paging, search, secure files, bookmarks, revision-safe progress, missing content, and legacy reader compatibility.
- Files reviewed: all files in `frontend/PHASE_2_IMPLEMENTATION_REPORT.md`, Phase 0 request/PWA code, route guard, current replacement shell/cards/panels, and read-only Django education/content/progress/search/dashboard source and tests.
- Unrelated changes: no quiz, answer, Focus, XP, streak, ranking, notification, creator, admin, billing, CSS redesign, UI library, or backend feature was added.
- Backend unchanged confirmation: `git diff --check` and `git diff --cached --check` pass. The only backend status paths are pre-existing staged `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`.

## Evidence and checks

| Check | Command or flow | Result | Notes |
| --- | --- | --- | --- |
| Lint | `pnpm run lint` | Pass | No warnings. |
| Contract/JSDoc/type check | `pnpm run typecheck` | Pass | Includes Phase 2 API modules. |
| Frontend tests | `pnpm test` | Pass | 17/17 exact contract, CSRF, static-file/PWA, integrity, and route-guard checks. |
| Production build | `node .\\node_modules\\vite\\bin\\vite.js build` | Pass | Vite 6.4.3 bundle and static-only PWA worker. |
| Real backend runtime flows | Signed-in browser at `http://127.0.0.1:5050/` | Pass | Dashboard, hierarchy, search, reader, files, bookmark remove/restore, and CSRF progress PUT verified. |
| Responsive/theme/visual review | Source and live UI review | Pass | No CSS changed; current shell, cards, grids, panels, loading/error/empty styles and theme classes are reused. |
| Django read-only system check | `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, `.venv\\Scripts\\python.exe manage.py check` | Pass | No issues. |
| Git diff and backend boundary | Diff checks and backend status | Pass | No backend change attributable to Phase 2. |

## Acceptance criteria

- Passed:
  - Parent nodes, returned breadcrumbs, `node`/`content_type` filters, search `q`/`kinds`/`content_types`/`academic_path` filters, and P25 paging match Django contracts.
  - Dashboard facts come only from `/dashboard`, `/learning/dashboard`, and `/progress/resume`; no questions, accuracy, goal, XP, or completion is invented.
  - Reader content, bookmark status, progress, file metadata, view URL, and download URL are returned server data only.
  - A live CSRF progress save advanced server revision from 1 to 2; the `409` implementation refetches current state rather than overwriting it.
  - Live bookmark removal/restoration completed only after server responses.
  - Direct file paths are restricted to documented same-origin file endpoints and are not API/PWA-cached.
  - Unsupported review, study-plan, and Focus actions remain honest unavailable states.
  - Search and reader routes require an authenticated user; unknown/privileged routes retain default-deny behavior.
  - Existing sheet URL shape now reaches the real reader, not the disconnected legacy screen.
  - No CSS/design-system/nav-shell/theme/responsive rewrite was introduced.
- Failed: none.
- Not verifiable and why: the seeded student did not have a no-download object or a denied material/file. The existing disabled download and shared 403 error branches were inspected against backend contracts; this is an evidence limitation, not a known defect.

## Findings

### Critical bugs

None found.

### Major bugs

None found. Self-review initially found two route-guard omissions: `#/search` and `#/materials/objects/{id}` displayed forbidden UI. `src/lib/authz.js` was corrected, tests added, and both routes retested in the live browser before approval. The legacy sheet route was also redirected to the real reader so a mock screen is no longer reachable through that URL.

### Minor bugs

None found.

### API contract mismatches

None found. Methods, JSON fields, query encoding, P25, 204 deletion, optional download, safe file paths, and revision payloads match the read-only Django source and tests.

### Permission problems

None found. Search and reader are allowlisted only for an authenticated session user. Product roles and operational capabilities remain separate; the frontend does not make file-access decisions.

### Security findings

None found. The phase reuses the same-origin cookie/CSRF client, sends no credentials to arbitrary origins, adds no JWT/bearer/refresh architecture, caches no API/files, exposes no answers, and does not calculate progress, XP, scores, or entitlements. Bookmark/progress state is not optimistic.

### UI consistency problems

None found. New views reuse current panels, grids, cards, controls, icons, loading, empty, error, disabled, and retry treatments without copying legacy UI or introducing a new library.

## Required corrections

None. The route-guard corrections identified during self-review were completed and retested before approval.

## Optional improvements

- In a controlled fixture environment, capture browser evidence for an object with `download_url: null` and a material/file `403` response.
- Use declared Node 24.16.0 in future checks to remove the engine warning.

## Final backend confirmation

No backend file was modified by Phase 2. Evidence: final diff checks, backend-scoped Git status, and the read-only Django system check. The two staged backend paths pre-date this implementation and were untouched.
