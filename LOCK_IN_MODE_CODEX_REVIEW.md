# Lock In Mode Codex review

## Review status: Approved

Lock In Mode and the previously failing repository-wide backend gate are now
verified against the current workspace. The repair preserved the existing UI
and backend contracts; no route, feature, or product redesign was introduced.

## Independent verification

| Requirement | Result | Evidence |
| --- | --- | --- |
| Dedicated, real Lock In screen | Pass | `/lock-in` and `/lock-in/:sessionId` are protected routes; browser exercised the real Django flow. |
| Discoverable entry | Pass | Existing-style actions on dashboard and material study views. |
| Normal navigation hidden | Pass | Lock In routes bypass the normal application shell; browser verification confirmed no bottom navigation. |
| Real material/session data | Pass | Setup lists Django-authorized materials and all session values come from the Lock In APIs. |
| No duplicate active session | Pass | Transactional user lock plus active-session recovery; backend regression test passes. |
| Timer correctness | Pass | Server timestamps and session activity history calculate active/break time; live refresh restored the paused value. |
| Pause/resume/break authority | Pass | Django validates transitions, persists activities, and returns the reconciled session. |
| Completion vs. abandonment | Pass | Separate terminal states, summaries, and regression coverage; completion was verified live. |
| Notes and tasks | Pass | Revisioned note autosave and idempotent task persistence were verified against Django. |
| Return navigation | Pass | Live completion returned to the source dashboard with the regular shell restored. |
| Exit safety | Pass | Browser exit dialog offered stay, pause/exit, complete, and abandon. |
| Mobile safe areas and controls | Pass | `dvh` fallback, safe-area insets, 44px targets, no horizontal overflow at 320–430 and tablet widths. |
| Client-only permission enforcement | Pass | Route guard establishes authentication only; server entitlement responses control access. |
| Private data caching | Pass | No authenticated API response was added to the service-worker cache; return hint is user-scoped session storage only. |
| Frontend quality gates | Pass | ESLint, TypeScript, 45 frontend tests, and production Vite/PWA build pass. |
| Lock In backend gates | Pass | Django check, migration drift check, and 16 focused backend/integration tests pass. |
| Complete backend suite | Pass | 205 passed, 2 skipped under the SQLite test profile; configured coverage gate passed at 85.04%. |
| Migration state | Pass | `makemigrations --check --dry-run` reports no changes. |
| Team-hub entry flow | Pass | `/lock-in` now opens the reference-style team hub. Create Team and Lock In Together both open the themed preparation flow; only Create Team requires a team name. |
| Team-name persistence | Pass | `FocusSession.team_name`, migration `0004`, Django serializer/service, and a backend regression test preserve the submitted name across recovery. |

## Quality-gate repair

- Operational capabilities are cached per request-user object and invalidated
  when an operator changes capability assignments, eliminating the moderation
  queue N+1 lookup without weakening authorization.
- Maintenance middleware now exempts health and authentication endpoints before
  configuration storage is read. Liveness remains query-free and readiness
  returns its structured database failure rather than leaking an exception.
- The regression work also fixed real operations API issues in refund error
  handling, subscription-action serialization, entitlement-history ordering,
  and catalog-code validation.

## Conclusion

Approved. The complete Lock In workflow is real and launch-ready: entry,
setup, active session, pause/resume, recovery, notes/tasks, completion or
abandonment, summary, protected exit, and return are implemented and tested.
The mobile focused route respects safe areas, hides normal navigation, and does
not conceal controls or content behind fixed UI. No critical or major verified
issue remains in the tested workflow.

### Team-data boundary

The reference-style leaderboard, activity feed, member avatars, and rewards
are visual content because this repository has no team membership or live
collaboration API. They do not claim to be saved user progress. The only new
team value is the server-persisted session name. This review does not treat the
visual team panels as an implementation of memberships, invitations, or shared
sessions.

### Follow-up verification: functional team mode

This boundary is now resolved. Django owns `FocusTeam`, membership, invite
code, message, and session-to-team persistence. The Lock In hub displays only
server-returned teams, statuses, weekly focus totals, and rankings; empty
states replace unavailable data. The active screen uses the secure PDF URL and
persists workspace page/zoom through the revisioned Focus workspace API.
