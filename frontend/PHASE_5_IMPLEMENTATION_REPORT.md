# Phase 5 — Motivation, rankings, and notifications

## Result

Phase 5 is complete. The current replacement UI keeps its existing visual system and now uses
server-authoritative Django data for personal XP, streaks, achievements, rankings, notification
inbox, notification delivery preferences, and the header notification menu. No CSS, design token,
layout, font, image, breakpoint, or theme change was made in this phase.

## Backend contracts verified

| Area | Django endpoint and method | Frontend behavior |
| --- | --- | --- |
| XP | `GET /api/v1/progression/xp`, `GET /api/v1/progression/xp/ledger?page=&page_size=` | Renders only returned totals, level fields, and P25 ledger entries. |
| Streak | `GET /api/v1/progression/streak` | Renders returned days and policy. It does not consume or grant a freeze token. |
| Achievements | `GET /api/v1/progression/achievements` | Renders the returned catalog, values, and earned time only. |
| Ranking | `GET /api/v1/progression/rankings/current`, `GET,PUT /api/v1/progression/rankings/profile` | Renders the published snapshot and saves only `{ included, display_mode }`. |
| Notification inbox | `GET /api/v1/notifications?cursor=&page_size=30&unread=true`, `GET /api/v1/notifications/summary` | Uses Django cursor URLs only to extract a same-API cursor; supports unread filtering and load-more. |
| Notification actions | `POST /api/v1/notifications/{id}/read`, `/open`, and `/read-all` | Marks data read only after Django responds; handles `410 notification_target_unavailable`. |
| Preferences | `GET,PUT /api/v1/notifications/preferences` | Sends the full existing array, reduced to each serializer's `{ category, channel, enabled }` write fields. Required/unavailable preferences remain disabled. |

The ranking serializer and model were inspected directly: valid display modes are `full_name`,
`initials`, and `anonymous`. Notification route creation and resolution were inspected directly in
the Django integration and notification services.

## Implementation and security corrections

- Added a dedicated `motivationApi` service with strict response-shape checks and cursor parsing.
- Replaced fake XP, achievement, ranking, streak, header-notification, and personal-analytics
  behavior with real data or an explicit unavailable state.
- Kept XP, level, streak, achievement progress, score, ranking position, and preference truth on
  the server. The frontend derives only display percentages from returned values.
- Kept the unsupported streak-freeze action disabled; Django has no consume endpoint.
- Preserved Django validation detail text, including the notification-preference `detail` response.
- Added `/dashboard`, `/progression`, and `/security` aliases for real Django notification targets.
  `/subscription` and contextual discussion targets display the existing-style unavailable state
  until their scheduled integrations are implemented.
- Added one shared notification-target allowlist used by both the full inbox and the header menu.
  It rejects external, boundary-escaping, and unsupported routes instead of falling through the
  application's catch-all dashboard route.
- Preserved the Phase 0 same-origin session/CSRF client and service-worker policy. The service
  worker has no API runtime cache; it only removes the obsolete `api-cache` entry on activation.

## Files changed

- `src/api/motivation.js` — new Django motivation and notification API service.
- `src/api/client.js` — preserves a Django top-level `detail` validation message.
- `src/lib/notificationRoutes.js` — shared, frontend-supported notification destination guard.
- `src/lib/authz.js` — authenticated aliases and contextual discussion route recognition.
- `src/App.jsx` — real notification route and supported Django-target aliases.
- `src/components/layout/index.jsx` — server streak card and live header notification menu.
- `src/pages/Progress.jsx`, `src/pages/Achievements.jsx`, `src/pages/Ranked.jsx` — real
  progression/ranking data.
- `src/pages/Notifications.jsx` — new full inbox with cursor, read/open, retry, and unavailable
  states.
- `src/pages/Settings.jsx` — Django notification-delivery preferences, separate from device-local
  reminders.
- `src/pages/Analytics.jsx` — truthful unavailable state; no operations analytics request.
- `eslint.config.js`, `tsconfig.phase0.json`, `tests/phase5.test.js` — checks and Phase 5 contract
  coverage.
- This report and `reviews/PHASE_5_CODEX_REVIEW.md`.

No dependency or lockfile change was required for Phase 5.

## Verification

All final frontend checks passed with the bundled Node runtime (the package's Node `24.16.0`
engine declaration emitted only its existing `24.14.0` warning):

```powershell
pnpm test                 # 24 passing tests
pnpm run lint             # passed with zero warnings
pnpm run typecheck        # passed
node .\node_modules\vite\bin\vite.js build  # passed; Vite 6.4.3 and PWA build
```

Read-only backend verification also passed:

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:DJANGO_SETTINGS_MODULE = 'config.settings.test'
$env:LOCKIN_TEST_USE_SQLITE = '1'
.\.venv\Scripts\python.exe manage.py check  # System check identified no issues (0 silenced)
```

An isolated copy of the local Django test data was used for browser verification; project backend
source and the original database were not written. Verified runtime flows included:

- real sign-in/session, `/progress`, `/achievements`, `/ranked`, `/notifications`, and `/settings`;
- real XP ledger and streak policy rendering;
- a real ranking-profile save using `anonymous`;
- opening a real achievement notification, for which Django returned `/progression`, now rendering
  the Progress page at `#/progression`;
- a real optional notification-preference save, followed by restoring its original value; and
- the explicit unsupported subscription target state at `#/subscription`.

## Remaining supported-but-unexposed work

- Django exposes no streak-freeze consumption endpoint, so a client action cannot be implemented.
- The verification dataset has no published ranking snapshot; the empty ranking state is therefore
  expected and server-truthful.
- Subscription details and contextual discussion details are intentionally unavailable targets in
  this phase; their backend capabilities belong to later scheduled phases.
- Django does not expose a personal analytics endpoint. The existing Analytics route is truthful
  and makes no fabricated request.
- The `410` notification-target branch is implemented and contract-reviewed; the isolated test
  fixture did not include a deleted target for a live `410` click.

## Backend integrity

`git diff --check` passed. No backend source file was created, edited, or reverted by Phase 5.
The final Git inspection still shows two pre-existing staged backend entries,
`backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; they were present before this
phase and were deliberately left untouched.
