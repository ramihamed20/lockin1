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
