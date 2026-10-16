# Unified Learning — continuation verification, 14 October 2026

This continues the delivered implementation. Safe fixes are local. PostgreSQL durability and a clean final browser integration run remain release gates. Both Knowledge feature flags still default off; AI is disabled.

## Changes and audit findings

- Knowledge artifact writes now use one IndexedDB read/compare/write transaction. This protects simultaneous tabs even without Web Locks. Server acknowledgements cannot replace newer local edits; retries retain their original mutation ID and body.
- Workspace UI has its own local revision check. A conflicting tab or failed UI save remains visibly unsaved across tool switches. Recovery compare-delete preserves newer work.
- Logout/account switching retains the student's own artifacts, pending attempts, recovery copies and unfinished-answer UI in that account's database. Prepared-question/bootstrap/detail caches, profile, leases and downloads are cleared. Another account cannot open the retained work.
- Reconnect and explicit sync requests arriving during an active synchronization trigger a follow-up drain. A saved device draft is distinguished from an account save.
- Full JSON recovery exports include source identity, workspace state, unfinished Explain answers and attempts. Storage-quota recovery includes work still held in memory.
- Explain chooses the latest attempt by server timestamp rather than array position. Pending submissions remain visible. Self-rating an answer against a different question revision is disabled. Concept filters persist in workspace UI.
- Concept navigation opens the associated note/map; a map action selects and centers its mapped node. Ordinary tool switching preserves the existing viewport. Existing source/version/page-access checks remain authoritative.
- Drawing ignores a second pointer while a stroke is active, preserves zero pressure, and enforces the API's stroke/point/shape limits before silently producing an unsavable document.
- Content serializers reject invalid UTF-8 surrogate input and NUL text as validation errors. Six escaped-JSON API regressions cover content, title and answer; invalid requests create no artifact or attempt.
- The Knowledge feedback/UI state, map custom CSS property and optional Vite flag are typed. Atomic save requests are returned explicitly by the transaction callback.
- The public build gate remains enabled. Reviewed source digests and one privacy explanation were updated after reviewing the affected public claims. The privacy answer describes deliberately shared copies of PDF marks. No new AI marketing claim was published.
- The public-page dev-server test uses its own optimizer cache and closes its HTTP connections. Its real project configuration and every HTML/redirect/robots assertion remain in place; requests have deadlines and no retry hides failures.

## Read-only MCQ integration

New authenticated GET routes:

- `/api/v1/knowledge/documents/{document_id}/mcq-attempts/{attempt_id}/explain-links`
- `/api/v1/knowledge/documents/{document_id}/mcq-runs/{run_id}/explain-links`

An incorrect submitted Active Study answer receives a shortcut only when its owned attempt, current sheet/file, current question bank revision, explicit concept mapping and published prepared Explain question agree. Missing/unprepared/stale mappings are explicit states. A restored checkpoint/final result resolves its owned submitted attempt through the run route; this handles the reader's existing `result:{run_id}` identifier.

The shortcut selects the prepared question and its difficulty/concepts, preserves unfinished answers, and respects the reader's unlocked page range. Correct-only results do not show a misleading missing-mapping message. These routes read existing Focus records. Scoring, XP, checkpoint progression and Review scheduling are unchanged.

## Final verification

Complete frontend: **674 passed, 0 failed, 0 skipped**. [Every test](../output/knowledge/frontend-complete.log). Strict affected-surface lint, ordinary production build and bundle budgets all exited 0: [result codes](../output/knowledge/frontend-check-results.json), [build log](../output/knowledge/production-build-final.log). The index bundle is 240.9 KiB gzip and its CSS 89.2 KiB gzip. Generated public pages remain 63 canonical pages, 49 published answers and 8 withheld drafts.

| Validation | Result and evidence |
| --- | --- |
| Complete backend, explicit SQLite mode | **1093 passed, 26 skipped**, **85.99% coverage**, required 85% gate passed. [Every test and skip](../output/knowledge/backend-full.xml), [complete log](../output/knowledge/backend-full-final.log). |
| Isolated PostgreSQL migrations | All migrations applied, including Knowledge 0001–0004. [Migration log](../output/knowledge/migrations-postgres.log). Django check and migration drift subsequently passed in test settings. |
| Latest PostgreSQL Knowledge run | **30 passed, 1 teardown error**. The failing teardown is `test_parallel_revision_updates_and_lost_ack_retries[False]`: flush lost its database connection during recovery. [Exact results](../output/knowledge/knowledge-postgres.xml), [trace](../output/knowledge/knowledge-postgres-final.log). An earlier clean 29-case run included the three PostgreSQL concurrency cases. This is useful locking evidence, not durability certification. |
| Mocked browser interaction/fault matrix | **6 passed in Chromium and 6 in WebKit**, zero unexpected/skipped cases. [Chromium](../output/knowledge/chromium-browser-results.json), [WebKit](../output/knowledge/webkit-browser-results.json). |
| Latest real browser/Django run | **0 passed, 3 failed to complete**. Navigation timed out, Chromium launch timed out in the atomic case, and the resumed-MCQ case aborted before the workflow. [Exact test names and errors](../output/knowledge/live-browser-results.json). SQLite fallback uses actual HTTP/session/CSRF/database responses; there is no API interception. |
| Earlier real PostgreSQL integration | Two cases passed before the runtime failures: real account save/offline reconnect/source-linked map/Explain reload/second-account isolation, and native IndexedDB simultaneous edits without Web Locks. The expanded final workflow, including logout draft retention and resumed MCQ navigation, still requires a clean browser pass. |
| Frontend type checks | Phase 0 and worker projects passed after fixing the eleven Knowledge diagnostics. [Phase 0 output](../output/knowledge/frontend-types.log). |
| Backend static checks | Ruff passed; Django system check and migration drift passed. Strict mypy passed the eight actual Knowledge source files with an independent cache. [Analyzer output](../output/knowledge/mypy-final.log). A prior broad package scan produced a mypy internal error; no type errors were suppressed. |
| Guarded production build | Ordinary Vite build and existing bundle budgets passed. Production PWA generated 90 precache entries; final build details are recorded with the frontend result above. |
| Diff review | Affected save/account/API/navigation code was manually reviewed. Final `git diff --check` exited 0; concurrent unrelated changes were preserved. |

The 26 SQLite skips are preserved in JUnit. They include PostgreSQL-specific behavior; SQLite discards row locking and cannot certify PostgreSQL transaction semantics.

Browser behavior exercised in the mocked matrix includes connected tool navigation, Arabic reflow at 320×740, 834×1194 and 1440×900, tablet orientation changes, focus/reload preservation and both artifact/unfinished-answer quota recovery. These are desktop browser simulations.

## Failed runs and environment blockers

The disposable PostgreSQL 17.11 cluster used loopback port 55439, synthetic data and test-only authentication. Its checkpointer repeatedly reported `PANIC: could not fsync file ... Bad file descriptor`, followed by recovery/invalid test databases. Fsync was never disabled. Docker/WSL are unavailable; the owner confirmed there is no alternative test environment and requested documentation plus available checks. [Preserved runtime log](../output/knowledge/postgresql-runtime.log).

The initial full PostgreSQL attempt had 129 passing, 19 failing and 960 error outcomes after the test database became invalid. It is not a valid application regression count. [Raw attempt](../output/knowledge/backend-full-tests.log). A later targeted run passed all test bodies but failed teardown during another recovery.

Existing Windows media files and the payments management-command directory returned WinError 1392. Original media was preserved. The unreadable command directory was moved intact to the local `output/knowledge/commands-unreadable-00c9e15679cc4cfd8a108911b5f526e0` archive; its four tracked command files were restored byte-for-byte. No payment command or business workflow was changed. Full backend collection explicitly targets all tests under `apps` and `platform_core`, and the test settings use a fresh media directory.

An initial SQLite run against damaged existing media failed; a coverage run that imported Django before coverage started also produced an invalid 70.81% measurement. The final standard `python -m pytest apps platform_core` run starts coverage before Django and passes 85.99%. These setup failures were corrected without weakening coverage.

A frontend run after adding logout retention had 673 passes and one `ECONNRESET` in the real public-page dev-server test. A standalone fixture then held resources until it was stopped. The final rerun and fixture-isolation result are stated above; all previous failures are retained in [the prior frontend log](../output/knowledge/frontend-before-fixture-isolation.log).

The latest PostgreSQL browser attempt also failed three cases while the database/runtime was unhealthy. [Preserved PostgreSQL browser attempt](../output/knowledge/live-browser-postgres-failed.json). The later SQLite attempt had browser launch/navigation/service responsiveness failures. The failure classification is environmental evidence, not proof that the expanded application workflow is correct. A final controlled attempt, after the full suites completed, obtained a real Django CSRF 200. The same-origin Vite proxy still failed 5/10-second readiness requests while the server was warming; the browser suite was not launched in that attempt. The three-case JSON above remains the latest completed browser run.

## Reproduction and scope

Frontend: `node --test --test-concurrency=4 tests/*.test.js`, both configured TypeScript projects, strict lint on the affected surfaces, ordinary `vite build`, generated public-page `--check`, and `node scripts/check-bundle.mjs`.

Backend: use `DJANGO_SETTINGS_MODULE=config.settings.test`, `LOCKIN_TEST_USE_SQLITE=1` and a fresh `LOCKIN_TEST_MEDIA_ROOT`, then run `python -m pytest apps platform_core --junitxml=...`. The coverage threshold stays 85%. PostgreSQL tests require a healthy disposable cluster; the local helper and logs are in `output/knowledge`.

The opt-in `frontend/e2e/focus-knowledge-live.spec.js` requires `LOCKIN_LIVE_KNOWLEDGE=1`, the synthetic `live-fixture.json`, and a real Django server behind Vite's same-origin proxy. Its seed uses the actual catalog, entitlements and authoritative Focus start/answer/submit services. A browser screenshot or mocked response does not replace this gate.

Owned validation services are stopped and their evidence retained. No production database was used. No deployment, push, merge, commit or paid-service activation was performed by this continuation. Concurrent edits from other chats were preserved.

## Incomplete work and readiness

- A clean complete PostgreSQL suite and clean final real browser integration remain required. Passing SQLite and earlier partial runs do not close those gates.
- Actual iPad/Apple Pencil, touch rejection, browser dictation, physical keyboard/virtual keyboard, split-view and portrait/landscape behavior have not been device-tested.
- Drawing latency, large-map frame rate and memory have not been measured. The latency changes are safety/efficiency safeguards; bundle measurements are not device-performance evidence.
- Full rich text, map handwriting, AI map creation, personal-upload Knowledge tools, subject/explicit-part maps, persisted Map Recall evidence, JSON import and a new adaptive review schedule remain incomplete.
- Installed production PWA cold/offline reload, lease expiry/account revocation and long-duration recovery need their complete device/production-browser matrix. Current real offline evidence covers open-workspace edits/reconnection.
- Source preparation and verified MCQ mappings still require reviewed content. Unpublished/unmapped questions stay unavailable.
- Explain AI remains disabled. [The next implementation proposal](EXPLAIN_AI_PROPOSAL.md) covers source grounding, correct/missing criteria, equivalent explanations, Arabic/English/mixed answers, contextual follow-ups, secure adapters, quotas/spend reservation and teacher-labelled accuracy evaluation. Provider approval, spending limits and the accuracy dataset are required before activation.

The code is suitable for the next local stabilization/content-preparation increment, with the browser integration failures carried forward as an open verification gate. Production enablement and an AI pilot require the outstanding verification gates and explicit AI approval.
