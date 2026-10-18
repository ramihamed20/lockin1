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
