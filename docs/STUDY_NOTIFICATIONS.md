# Student study notifications

The existing account-owned reminder and Web Push delivery queue now support a single consolidated study briefing per local date. Students enable the schedule themselves; existing daily schedules retain their behavior and all new notification types default off.

## Student controls

Settings → Notifications offers a gentle study reminder, ready Review Bank questions, and a weekly activity summary. Daily study/review days and the weekly summary day can differ. They share the selected local time. Weekly summaries take priority over review alerts, which take priority over the generic study reminder, so students receive at most one scheduled study briefing per local date. Other existing account/content notifications have their own producers.

Review alerts count only the student's active, due, usable Review Bank items. Hidden/mastered/future/unusable items are excluded. The message includes a count, never question or answer content. Weekly summaries count distinct dates with qualifying study activity in the last seven local dates, including today. They use actual activity timestamps and the student's selected timezone, independently of the streak policy's calendar timezone. Skipping a reminder after studying applies only to the generic study reminder; reviews and weekly summaries remain eligible.

Students can pause scheduled study notifications for 24 hours (the API also supports seven days), resume, see the next scheduled check, configure quiet hours, and hide device notification details. Quiet hours defer optional device notifications without consuming a transport retry. Expired messages are cancelled; security/billing/required notices and explicitly requested push tests bypass quiet hours. The scheduled reminder time must be outside quiet hours. Hiding previews replaces all device notification text with a generic Lockin notice while retaining full content in the authenticated inbox.

## API and delivery

`GET/PUT /api/v1/notifications/study-reminder` remains account-owned, authenticated and revision checked. New input fields are optional, so older clients preserve previously selected new settings. `pause_hours` accepts 0, 24 or 168; clients cannot write `paused_until` directly. The response exposes all settings, revision, next_due_at and paused_until. Invalid day/time/quiet-hour combinations fail without writing a schedule. Stale revisions return 409.

The existing operations scheduler invokes study dispatch and the durable per-installation push dispatcher. No new queue infrastructure or browser timer is required. Saving, pausing, disabling or rescheduling cancels obsolete queued study pushes. The push dispatcher also rechecks active settings, pause and revision before sending. Scheduled study pushes expire after two hours; all other pushes expire after one day, bounded by session expiry. Both provider TTL and the service worker payload use that deadline, preventing delayed offline-device delivery beyond expiry. A message already accepted by a provider cannot be recalled.

Account/session ownership, valid-session checks, safe destination resolution, provider allowlisting, encrypted Web Push and existing category preferences remain enforced. Device permission is requested only by the explicit enable button. The inbox links directly to notification settings.

## Rollout and validation

Apply additive `notifications/0006_study_briefing_preferences` after 0005, then run web and operations scheduler from the same release. Existing rows use all weekdays, daily study enabled, new review/weekly options disabled, quiet hours disabled and previews visible. Production still needs valid WEB_PUSH configuration, outbound push-provider access and a running operations scheduler. iPhone/iPad require an installed Home Screen web app and notification permission. A private Codespaces preview is only available while its Codespace runs.

Local evidence: 54 notification/review/streak tests passed on explicit SQLite; the two existing PostgreSQL concurrency tests require PostgreSQL CI. Ten targeted Node tests, frontend lint/typecheck, production build and bundle checks passed. Backend typing, Ruff and migration drift are checked separately. Browser cases cover English phone / Arabic tablet scheduling, types, quiet-time validation, persistence, pause/resume and touch targets alongside the existing closed-tab Web Push cases. Local Chromium could not start because this execution environment disallows its process-singleton socket; browser and PostgreSQL results must be obtained in CI for the final commit. Physical device receipt remains a device acceptance check, distinct from provider acceptance or mocked OS notification surfaces.
