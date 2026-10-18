# Study Plan V2

Base: `codex/lockin0.1.3` at `3abb4d45b336cf346e56f87b17ff72ca913a428b`.
Scope: account-owned planning; existing Focus/PDF/Active Study progression and XP rules are preserved.

## Behavior

- Beginning starts new generated sessions at 10 minutes. Every three distinct completed study dates raises subsequent generated sessions by five minutes, capped at 25. After 12 completed dates the student can choose Normal. Missed dates do not reset progress. Completion is explicitly self reported, never an XP grant or evidence of elapsed time.
- Normal allocates a 10–240 minute daily budget into sessions on selected weekdays and rotates through up to 12 user-entered subjects. Existing manual time is subtracted. A remainder below five minutes joins the preceding session.
- Custom uses manually created sessions. All modes allow editing, moving, completing, reopening and deleting tasks. Future tasks cannot be marked completed. Dates use the account plan's validated IANA timezone.
- Before automatic generation, the student reviews the proposed week. Past dates and days with existing generated sessions are left intact. No automatic catch-up load or replacement of completed work occurs. Changing mode/settings affects new sessions only.
- The next-study action opens Materials for the student to select a sheet. Tasks do not bypass published-content, cohort, subscription or reader gates.
- Plans need a connection. Mutations are not silently queued or represented as saved until the server confirms them. Form content remains after a failed request. Stale revisions return a refresh prompt.

## Persistence and API

Migration: `study_plans.0002_studyplanprofile_studyplanitem_client_request_id_and_more` adds a one-to-one settings row and additive task metadata. Existing titles, dates, status and completion timestamps are retained; legacy tasks remain Custom. No new production service or dependency is introduced.

| Endpoint | Contract |
| --- | --- |
| GET `/api/v1/study-plan?from=YYYY-MM-DD&to=YYYY-MM-DD` | Existing range/summary/results plus profile, account-local today, beginner progress and a bounded overdue list. GET does not create a profile. Maximum range remains 42 days. |
| PATCH `/api/v1/study-plan/profile` | Full settings and `expected_revision` (0 on first save). Older settings writes are rejected with 409. |
| POST `/api/v1/study-plan/preview` | A Monday `start_date`; preview contains items, totals and `preview_token`. Current/future weeks only, within one year. |
| POST `/api/v1/study-plan/generate` | The reviewed `start_date` and `preview_token`. A changed profile or task snapshot returns 409. |
| POST `/api/v1/study-plan/items` | Existing fields plus optional `client_request_id`. New UI retries reuse the same UUID. |
| PATCH `/api/v1/study-plan/items/:id` | Existing fields plus optional `expected_revision`; the new UI always sends it. Repeated completion preserves its original timestamp. |
| DELETE `/api/v1/study-plan/items/:id?revision=N` | Revision-aware deletion; old callers without the query remain compatible. |

Every writer locks the account row inside a transaction. Partial unique constraints enforce generated slots and client request identities per account. A moved generated task releases its date slot so it can be moved alongside another generated day. Account ownership, the existing session/CSRF enforcement, and `content.premium` subscription policy apply to all endpoints. Days are capped at 480 planned minutes and 48 sessions.

## Verification

- 692/692 frontend Node tests pass.
- Frontend strict lint and both TypeScript projects pass.
- Ordinary production build and existing bundle budgets pass. Study Plan is a lazy route (about 4.9 KiB gzip).
- All backend lint/format checks and mypy pass (531 source files); Django check and migration drift pass.
- 41 backend tests pass across Study Plan, Start Rescue and annotation sharing in the repository's explicit SQLite test mode. One PostgreSQL concurrency test is skipped in that environment and must pass in PostgreSQL CI.
- Nine planner browser tests pass against both Vite and the production-style E2E bundle: setup, modes, failed-save recovery, persistence after reload, manual editing/deletion, and reflow at 320, 390, 820, 1194, 1440 and short-landscape 844 px in Arabic/English. Three existing navigation/coming-soon browser tests and four Focus/Active Study browser regressions pass.
- A real session/CSRF/browser/Django workflow passes with no API mocks, using an isolated SQLite database under the repository's e2e settings: generate, complete, reload, change mode without losing completion, verify second-account isolation and phone reflow.
- Public knowledge's unchanged verifier passes after the documented claim review and regeneration. No new public planner guide or outcome/AI claim is advertised.

The native PostgreSQL package could not initialize inside this runner's user namespace (it cannot create the required service user). SQLite is not evidence of PostgreSQL row locking. The account-lock concurrency test is marked `postgres` for the existing PostgreSQL CI gate. Browser viewports emulate devices; physical iPad/iPhone and Safari validation are separate from Chromium evidence.

## Build-gate repairs

The base branch had an outdated catalog document return type and test expectation (`fileId`/`offline` were already returned), incomplete typing in Start Rescue/annotation sharing, one unsorted import and one quote-format issue. These narrow repairs make the required static checks executable without changing those features' business behavior. The navigation and the two exercised Focus fixtures now dismiss the existing PWA intro before interacting with the tested feature.

See `PUBLIC_KNOWLEDGE_REVERIFICATION.md` for the evidence-path review. The verifier was neither disabled nor weakened.

## Release sequence

1. Require passing PostgreSQL CI, including the concurrent-generation test, and review this feature branch against `codex/lockin0.1.3`.
2. Build the backend/frontend images through the existing CI pipeline. Use the existing release/migration service with migration-owner credentials before new clients are served; do not build on the VPS or embed credentials in this change.
3. Deploy compatible backend first, then frontend/edge. Existing clients still work against the additive backend contract. Confirm a subscribed test account can save/preview a plan and a second account cannot read its tasks.
4. If the feature must be closed, restore the Study Plan coming-soon route/registry entry; retain plan rows. Do not delete study history to disable navigation.

This change does not publish, merge or deploy production. Production approval depends on the PostgreSQL CI result and the normal deployment review.

## Integration verification — 17 October 2026

Integrated after `55cea80` (page-based Active Study and Pomodoro). Planner implementation files match original local commit `4cea99b`; shared translations and public help retain both feature sets. Targeted frontend checks: 75 passed. Backend planner, page-based Active Study, Pomodoro and offline regressions: 76 passed, 3 PostgreSQL-only tests skipped in explicit SQLite mode. Both TypeScript projects, production build, targeted frontend/backend lint, Django check, migration drift and the unchanged public-content verifier pass. PostgreSQL concurrency remains a CI requirement; this integration check did not repeat browser or physical-device tests.
