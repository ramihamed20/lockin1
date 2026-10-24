# Public knowledge evidence review — 14 October 2026

The production gate was correctly rejecting changed source digests. It remains enabled, with the same verifier and mandatory evidence checks. This review does not certify a release or turn the new Knowledge tools on.

## Reviewed source changes and affected claims

| Evidence paths | Actual change reviewed | Public claim assessment |
| --- | --- | --- |
| App.jsx | Deferred operations-session loading; optional dashboard trial | Public pages remain independent of account study routes; study still requires a session. |
| materialCatalog.js and materials-catalog.test.js | Account-scoped recent sheet history | Cohort/published catalog access and edition availability claims remain bounded; no universal-content claim. |
| Materials.jsx | Removed eager per-sheet Active Study availability fetching | Availability is resolved when opening a sheet; PDF publication still does not imply a prepared bank. |
| i18n.js | Added account error copy and optional Knowledge translations | Translation additions do not enable tools or promise AI. |
| CatalogFocusWorkspace.jsx | Existing Focus/performance and explicit annotation sharing changes; optional Knowledge panel and read-only MCQ links | Pen/eraser/text and Active Study rules remain documented as conditional; the privacy answer now explicitly describes deliberate sharing of a copy. |
| Review.jsx | Optional owned Knowledge shelf | Existing Review/Weekly Recall history and scheduling remain authoritative. |
| api/motivation.js | AbortSignal support for XP fetch | XP remains server-authoritative and is not an academic-grade guarantee. |
| AuthPage.jsx, Settings.jsx and accounts/tests/test_api.py | Field-aware errors and email/verification behavior | Account access remains authenticated; actual outbound delivery remains explicitly uncertified. |

Paths in this table are repository-relative under frontend/src, frontend/tests or backend/apps, as recorded in public-knowledge.json. Only the eleven changed paths identified by the gate were refreshed. Unchanged evidence digests were retained. Published help text was read before the refresh. No new Summary/Map/AI marketing capability was published.

## Evidence and limits

The complete frontend run before this refresh had 667 passing cases and three public-evidence failures. These failures matched the stale-gate rejection. Direct Knowledge tests, account isolation tests, existing catalog/reader/Review node tests and strict lint were included. The full frontend suite, generated-page checks and ordinary production build must be rerun after regeneration; final results live in UNIFIED_LEARNING_NEXT_INCREMENT.md.

The isolated PostgreSQL migration and 21 Knowledge tests passed, including first-save locking and the new owner/current-bank MCQ link contract. The native Windows PostgreSQL runtime later panicked during fsync; full PostgreSQL verification remains blocked. The complete backend behavior run uses the repository's explicit SQLite mode with its coverage gate, and its final successes/failures are reported separately. This review does not reinterpret SQLite as locking or durability evidence.

The gate was not disabled or narrowed. Public help still states that permissions, published content and account availability control access. Production rollout, real-device Pencil/dictation, provider AI and outbound email delivery remain outside this evidence.

## Final re-review

Concurrent dashboard changes were reviewed again: App imports dashboard styling and presents offline status inline on dashboard routes; other routes retain OfflineIndicator. The current English/Arabic copy and annotation-sharing copy were reviewed without modifying them. The reader's restored-result shortcut reads the owned run/attempt and opens a prepared Explain question; it does not change scoring or progression. Only these three newly changed evidence paths were reverified in this pass.

Final complete suites passed: frontend 674/674; backend 1093 passed and 26 skipped in explicit SQLite mode, with 85.99% coverage. Both frontend type projects, strict lint, the unchanged public generator --check, ordinary production build and existing bundle budgets passed. The final PostgreSQL/real-browser limits are recorded in UNIFIED_LEARNING_NEXT_INCREMENT.md; no release or paid AI enablement is certified here.

## Study Plan review — 16 October 2026

The published Arabic answers for product access, PDF tools, annotation privacy and Active Study were read again before refreshing evidence. Current `CatalogFocusWorkspace.jsx` still opens the authenticated Normal/Active selector, gates questions by the server range, confirms restarts, keeps original PDF bytes separate from annotations, and exposes annotation sharing only as an explicit user action. The earlier reader change adds a prepared explanation link to restored results; it does not change these claims. The complete frontend behavior run passed 689 tests; its three failures were two stale-evidence checks and an outdated expected document payload. The latter now asserts the existing `fileId` and `offline` fields, also reflected in the corrected return type. Reader/Active Study/annotation unit checks passed in that run. Reader browser validation and final build results are recorded in `STUDY_PLAN_V2_RELEASE.md`.

The current changes to `App.jsx` only load and route Study Plan; the changes to `i18n.js` add planner translations. Authentication, published-content gating, answer storage and the other published feature instructions were reviewed as unaffected. The feature registry now opens Study Plan. Its inventory record is updated to account-owned planning with self-reported completion; `publicDocumentable` remains false, and no public Study Plan guide, AI or academic-outcome claim is added.

Only these reviewed digests were refreshed: `App.jsx`, `i18n.js`, `CatalogFocusWorkspace.jsx`, and `featureAvailability.js`. In particular the changed, withheld email-delivery evidence was not re-certified. The public verifier remains mandatory and unchanged. This review does not certify live deployment, PostgreSQL concurrency, actual-device input or outbound mail.

## Combined feature review — 17 October 2026

Study Plan V2 is integrated after the page-based Active Study and Pomodoro changes. The shared translation catalog retains All Questions, Pomodoro and planner messages in both locales. Existing Active Study help keeps its new-sheet eligibility, page selection and question limits; planner routing remains account-owned, with self-reported completion and no XP or AI promise. Only the combined translation and feature-availability evidence digests were refreshed after resolving their merge conflicts. The other evidence and generated pages retain the reviewed changes from both branches. The public verifier remains unchanged.


## Page-bank question limits — 18 October 2026

Re-reviewed the published Arabic and English Active Study capability and Help answers against the new page-bank import and selection behavior. They already describe the count per page as **up to 15**, the custom 30-question cap, the Pomodoro 40-question cap, and the requirement for a prepared sheet. Those are limits rather than promises of that many available questions; the updated bank accepts 1–15 supported questions per eligible page and chooses no more than the number actually available. Empty pages and over-cap new pages are rejected. Legacy uniform 20-question banks continue to serve only their first 15 questions. Final exams retain exact configured totals; existing questions, permissions and stored progress are unchanged. Neither published text nor translations require changes. Only the two affected source digests were refreshed after inspecting the relevant answers and validation tests, without relaxing the evidence gate. These code-level checks do not certify a production deployment.

## Active Study custom inventory review — 18 October 2026

The public help's Active Study wording and student access boundaries were reviewed for the per-page question inventory change. This update does **not** claim more questions are generated or that a course has new questions. The server reveals only an ordered list of usable counts (capped at fifteen per source PDF page) for an already-ready bank, not its question text or answer keys. Both the student UI and offline runtime use these counts to cap **new** custom checkpoints at the least-stocked group, never more than 30 total. The server enforces the same cap and does so before replacing existing progress. Previously started custom runs may resume their stored settings; their delivered questions remain bounded by the available bank. Standard runs, published access rules, legacy banks, exam totals and XP policies were not changed here.

Changed evidence files `frontend/src/lib/i18n.js`, `frontend/src/components/shared/ActiveStudyCustomization.jsx`, `frontend/e2e/focus-active-study-customization.spec.js`, `backend/apps/focus/managed_active_study.py` and `backend/apps/focus/tests/test_page_active_study.py` had their source digests refreshed in the public-knowledge registry after reviewing these contract details. New unit, backend and browser regression cases exercise sparse banks, a short last checkpoint and old-session resume behavior. A passing GitHub production quality gate remains required for release; no VPS production deployment is asserted by this review.

## Focus release integration review — 24 October 2026

Reviewed the published help answers and source changes while integrating `codex/lockin0.1.4` with current `main`. The workspace extraction preserves sheet/edition/account scoping, access gates, source PDF immutability and annotation sharing boundaries. Phone tool cards, preset pens, page thumbnails and the zoom window change presentation rather than published content availability. The persistence browser spec now selects the renamed “Add text” menu item; its persistence assertions are retained. Material-catalog tests read the extracted workspace modules and cover the revised toolbar and reading-width layout. App bootstrap reuses the initial session request without bypassing session/access checks; auth language changes await the locale bundle before rebuilding validation messages. Translation additions label those controls and localize profile statuses; they do not publish unavailable product features.

The Active Study merge retains main's real question-inventory cap for new custom runs and its ability to resume older saved settings. It removes the superseded theoretical cap from `_runtime_plan`; the available-question check still runs before replacing existing progress. No answer text or keys are added to availability responses. Existing public guidance about prepared banks, per-page limits and conditional customization remains applicable.

Only the six changed evidence sources used by published entries were refreshed after this review: `frontend/src/App.jsx`, `frontend/tests/materials-catalog.test.js`, `frontend/src/lib/i18n.js`, `frontend/src/pages/CatalogFocusWorkspace.jsx`, `frontend/e2e/focus-workspace-persistence.spec.js` and `frontend/src/components/auth/AuthPage.jsx`. Non-public email/password/group-study items remain withheld; no delivery or deployment certification is claimed. The evidence verifier remains enabled and unchanged. Validation details are recorded in PR #67.


## Local-first PDF reader — 24 October 2026

Reviewed published Focus, annotation and Active Study guidance against the reader change. CatalogFocusWorkspace now remounts the reader when the document version changes, keeping annotations and study state attached to that version. Original PDF bytes remain separate from student work; account ownership, prepared-bank eligibility, progression and public feature availability remain unchanged. Only this reviewed source digest is refreshed; the mandatory verifier remains unchanged.

Explicitly opening a managed PDF now saves its fully received transport bytes after manifest size/signature/SHA-256 validation, without a second file fetch. Subsequent opens use the account's stored copy under a valid signed offline lease while metadata revalidates in the background. A known permission denial hides and blocks the cached reader without deleting notes; without a valid lease, a fresh server grant is required before local reuse. This does not predownload question banks or guarantee permanent browser storage, instant rendering, or a deployment. Unit coverage includes local-before-network resolution, corruption recovery, version identity and login fencing; real-browser coverage asserts automatic saving and no additional PDF transfer under the production CSP.


## Answer feedback and grading performance — 24 October 2026

Re-reviewed the published Questions, Review and Active Study guidance against these changes. Practice replay can show a verdict immediately only when a server-revealed correct-choice set belongs to the current question's offered option IDs. First answers still wait for authoritative server grading; retries still call the authorized server endpoint to count mistakes and earn no XP. No new answer keys are disclosed in question-list responses.

Active Study submissions retain the existing run/attempt row locks, transaction, immutable answers, progression, Review events and XP ledger. The batch path validates selections, loads held answers once and bulk-inserts new rows. Review validates correct attempts without creating an unnecessary write transaction; wrong-attempt writes retain their transaction and user lock. Published thresholds, eligibility, mastery and public availability remain unchanged. Regular answer endpoints also join the question version’s review context in the authorized question lookup; idempotent answer responses preload their recorded version and options. This removes repeat context queries without changing the request or answer payload. Refresh only the four reviewed changed evidence digests; the mandatory verifier remains enabled. Validation covers batch grading, rollback, replay, final-exam reward and concurrent duplicate submission, plus a browser test with the retry response deliberately stalled. No production latency guarantee or deployment is claimed.
