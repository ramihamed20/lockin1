# Lockin rankings

`GET /api/v1/focus/lock-in/leaderboard` preserves `teams` and `solo` and accepts
`period=weekly|all_time` plus `metric=time|sheets|accuracy|continuous`.
All results remain scoped to the requesting student's cohort and limited to ten entries.

- **Best:** total active seconds from completed sessions. Team time is session time, not
  member-hours multiplied by the number of participants.
- **Sheets (teams):** distinct managed sheets with a passed Active Study final submitted
  while the student owned or attended a completed team session. Repeated finals or multiple
  members completing the same sheet count once. Opening/scrolling a PDF does not count.
- **Accuracy:** sum of correct answers divided by sum of all graded answers submitted
  during completed sessions, including failed attempts. At least 20 answers are required.
- **Continuous (solo):** longest interval between a start/resume and the next timeline
  event. Pauses and breaks split intervals. Historical sessions without timeline evidence
  are excluded from this category rather than estimating a streak from their total time.
- Weekly means the existing rolling seven-day period. Equal primary scores use total
  active time, then stable identity, as a tie breaker.
- Anonymous participants keep opaque names and no identifiable avatar on solo rankings.

The response adds `active_seconds`, `completed_sheets`, `answered_count`,
`accuracy_percent` (nullable), and `longest_focus_seconds` (solo, nullable), along with
`metric`, `period`, and `accuracy_min_answers`. A missing score is not shown as 0%.
The client does not reuse an old ranking after a failed category request.

`POST /api/v1/focus/lock-in/teams/:id/image` accepts multipart `file`. Only the current
host of an open team can upload. JPEG/PNG/WebP uploads use the existing managed avatar
validation, size limits, scanning and authenticated delivery. Migration
`focus.0025_focusteam_image` adds the optional team image reference without changing
existing rows. Creation and image upload are separate; a failed picture upload can be
retried from team settings without recreating the team.
