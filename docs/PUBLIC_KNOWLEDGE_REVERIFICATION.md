# Public knowledge evidence review — 14 October 2026

## Automatic PDF downloads — 29 October 2026

The follow-up hardening review covers two additional source changes: App waits
for account cleanup before starting the first sync and cancels obsolete effect
callbacks; i18n's existing Clear Downloads confirmation now explicitly says
automatic downloads will be turned off. Reviewed published feature requirements
and account/materials/reader/privacy/support Help claims retain their meaning:
publication, subscription, account isolation, original PDF content and server
grading rules are unchanged. Refreshed only these two affected source digests.
The evidence verifier remains enabled. Timeout, truncated/oversized content,
rollback, removal, session-race and shared-file authorization regression tests
cover this iteration. Browser execution remains unverified in this environment.

Reviewed the affected published feature requirements and Help answers before refreshing
only the App.jsx and i18n.js evidence digests. App now polls the authorized offline
manifest while visible; its existing authenticated and subscription routes are retained.
The two changed translations describe automatic sheet/summary downloads while Lockin
is open. No published account, cohort, edition, annotation, question, Review, XP or
support claim changes. Downloading a PDF does not prepare an Active Study bank;
question bundles remain separately selectable. Signed offline leases, current-session
checks, private account caches and authoritative access denials remain enforced.

The public evidence verifier is retained unchanged. Unit checks cover default downloads,
new/replaced files, local reopens, interruption, foreground reader priority, account
switches and uploads during a large download. Browser execution is pending because
the browser download returned an incomplete archive in this environment. This review
does not certify live deployment, unlimited storage retention or closed-app downloads.

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


## Optional device notifications — 24 October 2026

Reviewed the published guidance using App.jsx, Settings.jsx, i18n.js and the Active Study regression evidence. Settings only adds the device opt-in panel and the mobile-safe local notification call; account editing, session management, account-security instructions and support links remain unchanged. App changes only clear an account's push binding on sign-out/account switch and route existing foreground reminders through a service worker where supported. New bilingual settings labels do not publish new question, grading, payment or academic-outcome claims. The concurrent-batch fixture now recreates its administrator role after transactional test database flushes; its assertions and runtime behavior are unchanged. Only those four reviewed source digests are refreshed, and the verifier remains mandatory.

Web Push defaults off until keys and the deployment flag are configured. It forwards existing notifications to explicit device opt-ins, keeps private APIs uncached, and checks a session/account binding before showing or opening a notification. Existing daily reminders remain foreground-only. The public help is not rewritten to promise provider delivery, universal browser support or device verification. Setup and limits are documented in WEB_PUSH.md.

## Study Plan availability review — 25 October 2026

The normal Study Plan route is reopened through the product availability registry; its E2E-only query bypass is removed. Account-owned planning still requires an authenticated eligible account and connection. Completion remains self reported, without XP, automatic grading or elapsed-time certification. The inventory now describes Beginning/Normal/Custom accurately; publicDocumentable remains false, so no new public guide or outcome claim is published. App routing and the registry are the only changed published evidence sources. Other feature gates, authentication and content permissions remain unchanged. Regression tests now use the ordinary route and cover overdue navigation and stale editing/preview recovery. Evidence hashes are updated only for the reviewed App and registry files; the verifier is unchanged.


## Settings review — 26 October 2026

Reviewed the published account/access, account-security, About and Support answers against the Settings reorganization. The account list now links to separate Security, Devices, Billing and Privacy screens; existing About/Support/Suggestion routes remain available. Single-use deletion links open Privacy; old theme/reminder and account-password deep links retain their destinations. The i18n change imports only a bilingual settings catalogue and does not change other features or their availability. Only Settings.jsx and i18n.js evidence hashes are refreshed. Account/support entries and their four directly affected answers carry today's review date; other source evidence and dates are unchanged.

New settings remain account-owned API consumers: money/refund states come from the payment endpoint, session revocation and deletion remain server-enforced, and requesting an email change does not claim the address has changed. Device silhouettes are approximate browser/device classifications, not verified hardware identities. Public wording still does not promise universal notification support, outbound delivery, complete erasure, or a deployed release. The mandatory public-evidence verifier is unchanged. Validation and remaining limits are recorded in SETTINGS_REDESIGN_AR.md.


## Compact student interface — 27 October 2026

Reviewed published materials/cohort/edition/reader, Review/Weekly Recall, progress, account and support guidance against this visual-only refinement. Repeated route headings are now screen-reader titles beneath the existing toolbar identity; subject/sheet titles and navigation remain. Settings removes promotional preview copy and redundant descriptions, keeps field labels and security/payment/deletion notices, and makes the device-classification explanation available through a native disclosure. Dashboard keeps its real continuation target and uses a shorter first-study entry. The global palette, title scale and loading chrome change presentation only; no route, permission, entitlement, scoring, retention or delivery behavior is changed. Refreshed only changed existing evidence sources after reading the affected answers. Capability verification dates and public claims are retained; the generated token asset is regenerated from the same source. The mandatory verifier stays enabled. Validation is documented in APPLE_UI_REFINEMENT_AR.md.


## Rank Mode review — 26 October 2026

Reviewed the diff of App.jsx, i18n.js, api/motivation.js and featureAvailability.js against the published product and progress claims. The App diff only adds the lazy Ranked page and replaces its coming-soon route; authentication and other routes are unchanged. The API addition only fetches live ranking data. Existing XP/streak/achievement methods and existing translations are unchanged; the translation additions describe cohort-based ranking, privacy and periods. Existing published account/content/reader/Review instructions therefore retain their meaning. Only these four evidence digests were refreshed. The mandatory verifier is unchanged.

The withheld rankings inventory is updated to the implemented availability; publicDocumentable remains false, and no public marketing page or production rollout is claimed. The new endpoint reads ranking-owned evidence, enforces cohort boundaries, and provides current privacy filtering. Tests and deployment limits are recorded in RANK_MODE_REBUILD_AR.md.


## Rank Mode interface review — 26 October 2026

Reviewed the additional Rank Mode translations: they label the existing individual leaderboard, a points-to-next-rank meter, keyboard-accessible period tabs, participation controls and progressive disclosure. No published help instruction or existing translation is changed. Ranking/XP rules, account authentication and content access are unchanged. Refreshed only the reviewed i18n.js evidence digest; the mandatory public verifier remains enabled. Rank Mode remains withheld from public marketing. Browser validation is documented in RANK_MODE_REBUILD_AR.md.


## Rank Mode concise copy — 26 October 2026

Reviewed the revised Rank Mode copy and labels. The page now names the ranking and cohort directly, removes motivational/repeated copy, and moves update/reset timestamps into the existing rules disclosure. Existing public help instructions and all other translations retain their meaning; only the reviewed i18n.js digest was refreshed. No scoring, API, access or public marketing availability changed.


## 27 October 2026 — manual Arabic sheet translations

Reviewed the additive diff in i18n.js and CatalogFocusWorkspace.jsx. It adds localized
labels and an independent translation panel only for authorized catalog documents,
inside the active pane and outside mode dialogs/quizzes. Existing reading state,
annotation ownership, Active Study restrictions and published help claims are unchanged.
The admin can import complete translations by physical page; there is no external
translation provider or automatic content generation. No new marketing claim is added.

Validation: 29 targeted backend cases (SQLite) and 37 frontend cases passed, including
catalog authorization, admin imports, source identity, stale revisions, CSRF and edition
isolation. Type checking and lint are included. Only the two reviewed changed evidence
digests are refreshed; the gate and unrelated evidence remain intact. See
SHEET_TRANSLATION_AR.md for operational and verification limits.

## Study Plan server-authorized trial — 25 October 2026

Reviewed the App route change and the five affected public product/identity/audience/private-content entries. Public product, academic placement and private/public boundaries remain unchanged: the existing authenticated/subscription ProtectedRoute still encloses Study Plan, and only its coming-soon branch delegates to a server-authorized trial entry. The trial requires an explicit versioned capability response from the existing account-protected V2 exams endpoint. A generic successful response, denied pilot, missing capability or malformed envelope cannot unlock it. No browser storage or query-string toggle enables the trial.

The ordinary student sees coming soon; the private inventory is corrected to that state and stays non-publicDocumentable. Trial users see a reading-only preview with an initial estimate, incomplete-content warnings, unplaced work and explicit non-persistence. It does not advertise automatic completion, a mastery percentage, a full adaptive plan, or exam-grade outcomes. Reviewed App's changed digest only; public copy requires no factual change. Targeted route/registry/translation/API checks pass. Full public evidence tests and production build remain required; the verifier is not disabled.


## Focus tab interaction fixes — 27 October 2026

Reviewed the CatalogFocusWorkspace.jsx diff against the notes and Active Study
help entries that cite it. Its only change is to scope popover keyboard/pointer
listeners to the visible reader and respect an already-handled Escape event.
Reading, annotation persistence, sharing, quiz restrictions and the study-mode
entry paths are unchanged. Existing published copy and capability dates remain
valid. Only this reviewed source digest is refreshed; the verifier stays enabled.

Validation: 23 targeted tab/scroll/reader/ink/video unit checks and targeted lint
passed. Added browser regressions for hidden-reader picker events, modal focus,
picker cleanup on tab switch and thumbnail column changes. Browser execution
remains unverified because the local Playwright browser is unavailable; the
previous attempt to download it returned an unavailable-site response.


## Lockin team discussion beside Focus — 28 October 2026

Reviewed the additive i18n labels and the one-line CatalogFocusWorkspace diff.
StudyDock now receives the existing reader root for its team-panel portal. No
annotation ownership, PDF permissions, study progression or public claim changes.
The team room reuses authorized team messages and code-based invitations; it
does not claim a persistent friendship graph. The existing real Focus reader
opens the authorized sheet, with an optional team panel; no iframe, duplicate PDF
reader or relaxed framing/security policy is introduced. Only these reviewed
evidence digests are refreshed. Lockin launch remains controlled by the server.


## Lockin native room styling — 28 October 2026

Reviewed the additive live-status label in i18n.js against published help text.
This change adds presentation labels only. The existing Lockin, Focus, notes and
Active Study capability wording and all API contracts remain intact. The room
now uses the app palette, a decorative clock ring, segmented chat/member views,
compact invitations and responsive setup. A sheet change clears the page-range
inputs before submitting the same authorized version-2 contract. No independent
friendship system or new production rollout is claimed. Only the reviewed i18n
evidence digest is refreshed; verification stays enabled.


## Lockin release resilience — 28 October 2026

Reviewed additive translations for unsaved notes and manual code copying. Existing
public capability claims and verification dates are unchanged; only the reviewed
i18n digest is refreshed. Session APIs, launch gate, permissions and private
annotation data are unchanged.

Backend follow-up: reviewed the one-line initialization of the optional session
participant in _live_lock_in_payload. Solo responses previously raised an
UnboundLocalError; they now follow the existing non-team note branch. No
authorization, accounting, scoring or published capability statement changed.


## Lockin studio redesign — 28 October 2026

Reviewed the two additive composer placeholder translations in i18n.js. They
shorten the visible prompt only; the existing accessible label and all published
capability/help text are unchanged. No session, membership, friendship, note,
Focus, permission or rollout capability was added. Only the reviewed i18n
evidence digest is refreshed; verification remains enabled.


## Error handling review — 28 October 2026

Read the affected published Arabic feature requirements and help answers, including
reader-unavailable, notes-not-synced and active-start-error. The matching English
answers remain factually applicable. Changed list pages only pass the existing
error object to ErrorPanel; catalog, question availability, Review scheduling,
XP, access requirements and published routes retain their behavior. The reader
changes classify local-save failures and remove a false out-of-space diagnosis;
they do not change annotation scope, synchronization ownership or source PDFs.
The translation catalog only adds error/recovery strings. No new product
capability, outbound-delivery claim, AI promise or automatic-sync guarantee was
added to public copy. In particular the existing advice to preserve unsynced
work and not clear browser data remains correct.

Only changed paths already present in evidenceDigests were refreshed following
this review. The public verifier and publication allowlist remain mandatory and
unchanged; public text and its last substantive verification dates are retained.
Validation and runtime limits for this change are recorded in ERROR_HANDLING_FIXES.md.
