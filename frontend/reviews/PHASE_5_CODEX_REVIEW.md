# Phase 5 Codex review

## Verdict: Approved

No critical or major defect remains in the Phase 5 scope.

## Scope review

Reviewed the motivation, ranking, notification, preference, route-alias, test, and report changes.
The work stays within Phase 5: no subscription, discussion, creator, administrator, or operations
feature was implemented. Unsupported notification targets use a clear existing-style unavailable
state. No backend file was edited in this phase.

## API contract review

- XP summary, P25 ledger, streak summary, and achievement catalog use their exact Django routes.
- Ranking profile uses `GET,PUT /progression/rankings/profile`; the PUT body is exactly
  `{ included, display_mode }`, and its returned value refreshes the page state.
- Notification cursor pagination sends `page_size=30`, optional `unread=true`, and extracts only a
  `cursor` from a returned URL whose pathname is exactly the configured internal notifications API.
- Read, open, and read-all use Django's exact POST routes and an empty JSON body with CSRF.
- Preference PUT retains all returned preference rows and sends only its valid serializer write
  fields. A Django top-level `detail` validation response remains visible to the user.
- `410 notification_target_unavailable`, empty, loading, retry, and mutation-error paths are
  explicitly handled.

## Role, permission, and security review

- Phase 5 routes are authenticated-route guarded. Unknown routes remain denied by default.
- The frontend neither awards nor calculates authoritative XP, streaks, completion, achievements,
  ranks, scores, or entitlement. Display percentages are derived from response fields only.
- The freeze action is disabled because no Django mutation exists.
- The session-cookie/CSRF architecture from Phase 0 remains unchanged; no JWT, bearer token, or
  refresh-token flow was introduced.
- The service worker has no API runtime caching and removes only the obsolete `api-cache` entry.
- Both the header menu and full inbox now use the same supported-route guard. External routes and
  unimplemented internal routes cannot be navigated after an open response.
- No secrets, user IDs, hardcoded roles, unsafe HTML, or client-side answer exposure were added.

## UI consistency review

The pages reuse the replacement's existing `Page`, panel, list-row, progress, error, loading,
empty-state, button, settings, sidebar, and header styles. No stylesheet or shared visual token was
modified. Browser verification covered the current light/dark-capable shell and existing responsive
components; the new content uses those existing layout classes without a visual redesign.

## Verification results

| Check | Result |
| --- | --- |
| `pnpm test` | Passed — 24 tests |
| `pnpm run lint` | Passed — zero warnings |
| `pnpm run typecheck` | Passed |
| Production build | Passed — Vite 6.4.3 plus PWA generation |
| Django system check | Passed — 0 issues |
| Real browser data flows | Passed — progress, achievements, rankings, inbox, preference save/restore, notification open, unavailable target |
| Git whitespace check | Passed |
| Backend unchanged in this phase | Confirmed |

## Acceptance criteria

- Server-authoritative XP, streak, achievement, ranking, and notification data: passed.
- Cursor/read/open/preferences workflows with validation and error states: passed.
- No fake champions, duplicate leaderboards, new-badge success, local freeze consumption, or
  operations analytics call: passed.
- Safe notification destination behavior: passed. The review found that the header's original
  route predicate was less strict than the full inbox; it was corrected with
  `src/lib/notificationRoutes.js` and reverified.
- Existing visual identity and responsive component system preserved: passed.

## Remaining minor findings / limitations

1. **Severity: Minor — backend capability limitation**
   - **Location:** `src/pages/Progress.jsx`, `src/components/layout/index.jsx`
   - **Problem:** Django exposes a freeze-token count but no consume endpoint.
   - **Expected behavior:** Do not claim the token was used.
   - **Resolution:** The UI is explicitly disabled/explanatory. No frontend correction is possible
     without a backend endpoint.

2. **Severity: Minor — later-phase target detail**
   - **Location:** `src/App.jsx`, `src/lib/notificationRoutes.js`
   - **Problem:** A Django notification may point to subscription or contextual-discussion detail
     pages not yet integrated by the current phase.
   - **Expected behavior:** Do not silently redirect or fake the target.
   - **Resolution:** The corresponding routes now show an explicit unavailable state. Replace these
     placeholders only when their scheduled real API integrations are implemented.

3. **Severity: Minor — live 410 fixture coverage**
   - **Location:** `src/pages/Notifications.jsx`, `src/components/layout/index.jsx`
   - **Problem:** The isolated verification dataset had no deleted notification target to trigger a
     live `410` click.
   - **Expected behavior:** Show the clear unavailable message while retaining server-read truth.
   - **Resolution:** The status branch is implemented and contract-reviewed. Add a live deleted
     target only in a controlled test fixture; do not mutate production data to obtain it.

## Backend confirmation

No backend source, configuration, model, serializer, view, URL, migration, test, or database file
was modified by this phase. Git status contains only the pre-existing staged backend entries
`backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`, which this work did not touch.
