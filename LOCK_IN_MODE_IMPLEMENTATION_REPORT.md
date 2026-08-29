# Lock In Mode implementation report

## Scope

Lock In Mode is now a real, authenticated study-session workflow. It is an
immersive route rather than a modal or prototype, and it retains the existing
Lock In visual language, application data, Django permissions, and source-page
return behavior.

## Existing capabilities reused

- The existing `FocusSession`, Focus workspace material resolution, document
  permissions, entitlement service, progress data, and server-managed daily
  summary are reused.
- The existing application shell, button/card styles, icons, authentication,
  error envelopes, confirmation pattern, and direct secure material links are
  reused. The normal shell is omitted only while a Lock In route is active.
- Django remains authoritative for entitlement decisions, session transitions,
  material access, study time, session count, and completion data.

## Backend implementation

- Migration: `backend/apps/focus/migrations/0003_lock_in_mode.py`.
- Follow-up migration: `backend/apps/focus/migrations/0004_focussession_team_name.py`.
- `FocusSession.team_name` stores the requested team label with the real
  server-persisted Lock In session. The start serializer validates and trims
  the label; it is returned with session recovery and active-session payloads.
- `FocusSession` now supports `on_break`, session type, optional goal/topic,
  and planned break duration without creating a duplicate session model.
- `FocusSessionNote` stores one revisioned, durable note per session.
- `FocusSessionTask` stores idempotent, durable session tasks.
- The lifecycle is validated in the service layer with transactional locking:
  `active -> paused -> active`, `active -> on_break -> active`, and
  `active|paused|on_break -> completed|abandoned`. Terminal transitions are
  rejected; retrying an already-applied transition is safe and does not create
  another activity event.
- A user-row lock and active-session lookup prevent concurrent tabs from
  creating two unfinished sessions. Session activities provide the immutable
  timing transition history.
- Timer durations are derived from timezone-aware server timestamps and the
  activity timeline, not from a duration supplied by the browser.

## API surface

- `GET, POST /api/v1/focus/lock-in` — real materials, unfinished-session
  recovery, and session creation.
- `GET /api/v1/focus/lock-in/:sessionId` — session recovery and summary data.
- `POST /api/v1/focus/lock-in/:sessionId/:action` — pause, resume, complete,
  abandon, start break, and end break.
- `PATCH /api/v1/focus/lock-in/:sessionId/note` — revision-aware autosave.
- `POST /api/v1/focus/lock-in/:sessionId/tasks` and
  `POST /api/v1/focus/lock-in/:sessionId/tasks/:taskId/toggle` — persisted
  task changes.

All endpoints use the existing Django `focus.workspace` entitlement check;
the frontend permits an authenticated user to reach the route and displays the
actual backend denial instead of making a client-only access decision.

## Frontend implementation

- Routes: `/lock-in` and `/lock-in/:sessionId`.
- `/lock-in` now begins with the screenshot-matched Lock In team hub. It has
  always-visible **Create Team** and **Lock In Together** actions, while an
  unfinished session remains available through a separate resume action.
- Both actions use a themed, compact Prepare your session screen. Create Team
  requires only a team name in addition to material and duration; Lock In
  Together has no team-name field. Study goal, topic, optional break, notes,
  and setup tasks were removed from this entry flow. Starting continues to the
  existing dedicated immersive Lock In workspace.
- Entry actions: dashboard and material study views pass the current route,
  scroll position, and, when available, the real document version.
- `LockInMode.jsx` contains the setup, active session, exit protection,
  summary, notes, tasks, recovery, and source-route restoration flow.
- `SessionTimer` is isolated so only the timer display updates per second. It
  reconciles against server timestamps after refresh, visibility return, and
  session action responses.
- Notes autosave with a visible saved/saving/offline/error status and a retry
  mechanism. Tasks, notes, and all session actions use server responses rather
  than fabricated client statistics.
- Browser back, in-app exit, and page unload have protective handling. The
  exit dialog offers stay, pause and exit, complete, or abandon; abandonment
  explicitly preserves the real recorded work without marking it completed.

## Mobile and immersive behavior

- The normal header, sidebar, bottom navigation, reminder popup, and normal
  session popup are omitted for Lock In routes.
- The dedicated view uses `dvh` with a fallback, `env(safe-area-inset-*)`,
  bounded horizontal overflow, responsive grid changes, and 44px minimum
  interactive controls. Secondary information remains below the core controls
  on compact screens.
- Live browser checks covered 320, 360, 375, 390, 414, and 430 CSS-pixel
  mobile widths plus tablet portrait and landscape. No horizontal overflow was
  detected, and normal bottom navigation was absent from the focused route.

## Tests and validation

### Latest team-entry validation

- Django `check`: passed; migration drift check under the local demo SQLite
  settings: passed; `focus.0004_focussession_team_name` applied to the local
  demo database.
- Lock In backend regression tests: 7 passed, including persisted/trimmed
  team-name coverage.
- Frontend ESLint and TypeScript: passed; frontend tests: 47 passed; Vite/PWA
  production build: passed.
- Authenticated browser validation passed for the team hub, both entry actions,
  team-name-required setup, personal setup without that field, desktop layout,
  and a 390px mobile layout with no horizontal overflow or console errors.

### Functional team and material follow-up

- Migration `0005_lock_in_teams.py` adds durable teams, memberships, invite
  codes, team messages, and the optional team relationship on Focus sessions.
- A team is created before its Lock In session and receives a server-generated
  invite code. Other entitled users can join only through that code. Team chat
  is stored in Django and refreshed from its authenticated API; team member
  status and focus progress are derived from their persisted sessions.
- The Lock In PDF area now embeds the authorized Django file URL, not a
  drawing placeholder. Page and zoom choices debounce to the existing
  revisioned Focus workspace endpoint, so a refresh restores the position.
- Team rankings and weekly activity use completed, server-recorded focus time.
  Empty teams deliberately show empty states rather than invented ranks,
  members, activity, or statistics.

- Django system check: passed.
- Migration drift check: passed with the repository's SQLite test profile; no
  pending model changes.
- Lock In backend tests plus Focus workspace and demo-seed integration tests:
  16 passed using the repository's SQLite test profile.
- Complete backend suite: 205 passed, 2 skipped, with the required 85.04%
  coverage.
- Frontend ESLint: passed.
- TypeScript check: passed.
- Frontend unit/integration tests: 45 passed.
- Production Vite/PWA build: passed.
- Real authenticated Django browser workflow: setup with real material,
  unfinished-session resume, note and task persistence, pause, refresh
  recovery, completion summary, return restoration, exit protection, and
  responsive checks passed.

## Known limitations

- The backend has no pre-existing membership, invite, or live collaboration
  model. Consequently, Create Team persists a durable session team name only;
  the reference-style rankings, activity, member avatars, rewards, and chat
  remain display content rather than fabricated user progress. A true shared
  team feature needs its own backend product/API specification before those
  panels can become authoritative.

- The repository-wide quality gate is resolved. The moderation queue no longer
  repeats an operational-capability lookup for every serialized report; health
  and authentication probes bypass maintenance configuration reads; and the
  readiness endpoint now owns database-error handling. Focus migration `0003`
  also records the break activity choices, so migration drift is clean.
- Wider operations API tests additionally repaired refund validation error
  handling, subscription action response serialization, entitlement history
  ordering, and catalog code validation consistency. These are real backend
  fixes, not mocks or test-only branches.
- The existing secure material reader remains the canonical place for detailed
  page/section manipulation. Lock In opens the authorized material and
  preserves the current material selection; it deliberately does not fork or
  reimplement the reader inside the focused route.
- Tab-close prompting is best effort per browser policy. The server-persisted
  active or paused session remains recoverable after reopening.
