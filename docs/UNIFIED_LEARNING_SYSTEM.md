> Continuation update — 14 October 2026: [latest changes, complete suites and outstanding release gates](UNIFIED_LEARNING_NEXT_INCREMENT.md). The validation below records the earlier delivered baseline.

# Unified active learning — implementation and architecture audit

Date: 14 October 2026. This is a gated first increment, not completion of every capability in the original specification. Production has not been deployed or changed.

## Repository audit and decisions

The actual platform has React/Vite, Django/DRF and PostgreSQL. The current reader is `frontend/src/pages/CatalogFocusWorkspace.jsx`, backed by `ContinuousA4Pdf`, the Focus ink modules, account-scoped document storage and managed Active Study. It already owns page/zoom/scroll, edition selection, page restrictions, checkpoints, final examinations and resumable runs. `WorkspaceKeepAlive` retains a bounded number of reader tabs. Replacing this stack would put existing progress and annotations at risk.

Catalog identity is `CatalogDocument → LearningObjectVersion → LearningObject`. A catalog alias can change when content is revised, so a page number and alias alone are not sufficient to identify student work. The new artifacts and concept sources retain both the exact version and managed file. University and Lock-in editions have separate document/source mappings. File `pdf_page_count`, rather than the shared version's page count, validates edition ranges.

Focus already supplies coalesced pointer samples and stroke geometry. The notebook reuses those helpers, rather than copying the entire reader/editor state machine. Its own vectors and typed text remain separate from existing PDF annotations. No drawing or graph dependency was added.

The existing Review Bank owns mistake history and schedules. Managed Active Study owns server-scored answers and XP. My Knowledge reads those events and explicitly mapped question identities; it does not copy them into a competing review schedule, award XP, unlock parts or alter existing progress.

Offline mode already supplies account-specific IndexedDB, session revision fencing and signed lease-aware read resolvers. The new store reuses them. Private API responses are not added to a generic service-worker cache.

## Learning journey and UX

Reading remains in the existing reader. One compact Study tools button opens a separate panel. Summary, Map, Explain and Active Study are optional; no new progression gate has been added. My Knowledge also links back to the existing Review Bank.

| Surface | Implemented layout | Remaining verification |
| --- | --- | --- |
| Narrow phone | Full-width tool dialog; reader stays mounted and becomes inert; scrollable controls and 44px buttons | Real keyboard, touch and microphone behavior |
| Tablet portrait | Full-width collapsible editing panel with independent reader state | Real iPad/Apple Pencil |
| Tablet landscape | Reader and tool panel alongside one another | Real orientation and pencil interaction |
| Desktop | Split workspace, native forms, map arrow keys, copy/paste and undo shortcuts | Production bundle and load profiling |

The panel follows Lock-in V2's existing dark surfaces, gold selection/focus, system typography and logical RTL layout. Document range/export controls use progressive disclosure. Hidden editors unmount, including speech recognizers. Tool selection, active document, map selection/viewport, question choice and answer drafts are persisted independently of reader state.

A standalone editor route was rejected for this increment: it would increase navigation and reader restoration work. Mounting four hidden editors was also rejected because it would retain unnecessary canvases and microphone handlers.

## Shared data model

| Model | Responsibility |
| --- | --- |
| StudyToolSettings | Per-sheet availability of Summary, Map and Explain |
| Concept | Stable shared concept identity within an existing learning object |
| ConceptSource | Immutable edition/document, version, file and page-range mapping |
| StudentArtifact | Private Summary or Map snapshot with revision, source and deletion tombstone |
| ArtifactReceipt | Account-scoped mutation digest and lightweight acknowledgement metadata |
| ExplainQuestion | Published prepared prompt, source, difficulty, rubric, alternatives and bounded follow-up prompts; multiple concept links |
| ExplainAttempt | Private answer, question revision, frozen source/rubric/concept attribution and explicit self-rating |
| McqConceptLink | Explicit existing canonical MCQ identity plus imported bank revision |

Source references in the admin form are immutable; revised mappings get new IDs. Changing a question's source later does not move earlier attempts to a different concept. Legacy attempts without a frozen source are excluded from concept evidence rather than assigned retrospectively.

The four new migrations are additive. The initial migration depends on tracked Content migration 0014, not the unrelated annotation-sharing changes in the working tree. A later migration removes the global single-concept MCQ-key restriction and adds uniqueness for the concept/key pair. No student progress or existing tables are reset.

## Cross-tool behavior

- Summary selection creates a node in the selected current-source map. Existing map content is loaded before insertion; the latest in-memory edits are retained. The note remains unchanged.
- Explicit summary concept links can travel to map nodes.
- Map concepts and relationships open matching prepared Explain questions. Relationship actions appear only when prepared questions cover both concepts.
- Explain reference points enter the notebook only after confirmation, remain separate from student-authored text, and carry concept links.
- Old-source work is preserved and marked. Source-page navigation and cross-tool insertion do not silently reassign it to the current PDF.
- My Knowledge exposes source reading, relevant personal documents and prepared explanations. Review Center adds an owned document shelf.
- There is currently no direct Explain shortcut on each missed MCQ result. The available connection is the MCQ-derived concept view.

## API contract

All routes are under `/api/v1` and use the existing session, CSRF and safe error envelope.

| Method / route | Behavior |
| --- | --- |
| GET /knowledge/documents/{document_id} | Flags, source identity, lightweight artifact index, prepared question prompts, owned attempts and concept projection |
| GET /knowledge/documents/{document_id}/artifacts/{artifact_id} | Full owned document, loaded on demand |
| PUT /knowledge/documents/{document_id}/artifacts/{artifact_id} | Account-bound idempotent snapshot save or deletion, using expected revision |
| PUT /knowledge/documents/{document_id}/attempts/{attempt_id} | Account-bound, immutable prepared-question answer and self-review feedback |
| GET /knowledge/library | Links to permitted active catalog documents containing the student's work |

Artifact writes include `account_id`, `mutation_id`, `expected_revision`, immutable version/file IDs, kind, title, page range, validated content and deletion state. Attempt writes include `account_id`, question ID/revision, answer and optional self-rating. Account identity is a binding check, not authentication.

A 409 keeps the local draft; the client never retries by substituting the latest revision. Lost acknowledgements replay the same frozen mutation. First creation and receipt/quota checks lock an existing user row inside a transaction. PostgreSQL concurrency validation is still required.

Other students receive no artifact details, including administrators. Student artifacts and attempts are absent from Django admin. Content administrators can prepare concepts, source mappings, tool settings and question banks.

Current limits: 1 MiB document content, 500 strokes/100,000 points, 300 nodes/600 edges, 100 documents per sheet, 500 per account, 2,000 explanation attempts per sheet, 120 write requests/minute. Lists and evidence samples are bounded. Larger catalogs/notebooks will need paginated enrichment.

Deleting a document clears its content/title and previous save receipts, retaining a revision tombstone to reject stale resurrection. Other devices can retain an unsent conflict draft for explicit recovery. Existing account-level deletion policy remains authoritative.

## Saving, recovery and privacy

Every edit is queued for account-fenced local persistence. Network saves wait for local writes. Acknowledgements do not replace edits made while the request was in flight. A clean draft can rebase after the student explicitly loads a newer server copy; dirty drafts cannot.

Cross-tab local version checks detect unseen edits. Keep my draft as a new copy preserves the server version. It does not remove another tab's newer local draft. Scope changes fence writes/acknowledgements and clear stale views.

Storage failure remains visibly unsaved even after tool switches or sync callbacks. Normal workspace exit/tab actions are guarded. The current draft and work held on screen can be exported without fetching other documents. Explicit discard restores saved copies. Browser reload/close is guarded while saving or unsaved; forced browser/OS termination cannot be guaranteed.

Online bootstrap/detail reads are cached only in the account store. Offline reads require the existing valid lease and downloaded context; authoritative 401/403/404 responses do not fall back to stale access. Offline Explain submissions remain pending until a real server response. Unsubmitted answers are device drafts, scoped to question ID and revision; earlier question-version drafts remain separately visible.

Browser speech recognition is capability-detected. Start/stop, English/Arabic, permission/error states and typing fallback are implemented. The browser may use its own external speech service. Lock-in stores editable text, never raw recordings. Pause/resume, custom medical vocabulary and a server transcription provider are not implemented or promised.

Notebook PDF export uses browser print/save-to-PDF and vector strokes. JSON exports retain complete source IDs and editable data. In-app JSON import is not implemented. Basic text formatting currently uses Markdown markers; a full rich-text editor is not implemented.

## Truthful learning evidence

Notes and maps provide context and links, not mastery evidence. My Knowledge derives status from explicitly mapped, server-scored Active Study/Review events and the latest frozen Explain self-rating.

Three recent correct events on distinct days can produce Strong evidence. Old practice and newer reported difficulty prompt review. Self-reported checks are identified and never independently produce Strong evidence. Reimported question banks require an explicit mapping revision before new events contribute. Existing event history is retained.

Explain currently returns the prepared reference/rubric after submission and supports a self-check. It does not judge scientific equivalence automatically, generate missing-point diagnoses, assign numeric scores or fabricate confidence. Map Recall hides/reveals concepts and relationship labels; its self-check is not currently persisted as learning evidence.

## Phase status

| Phase | Implemented and tested | Partial / not implemented / external needs |
| --- | --- | --- |
| 1 — Architecture/workspace | Additive domain, source/version contract, lazy panel, optional navigation, account-safe saves | PostgreSQL locking and production build verification pending |
| 2 — My Summary | Per-page/range documents, typing/Markdown actions, vectors/shapes, selection, undo/redo, supported browser dictation, autosave, offline recovery and export | Rich-text editor, full object transforms and real Pencil/voice verification absent |
| 3 — Map Builder | Manual nodes/shapes, drag/resize, grouping, arrows/labels/styles, touch multi-selection, clipboard, undo/redo, layout, pan/zoom, source links and Recall basics | AI creation/suggestions and map handwriting absent; subject-level and explicit part-ID maps absent |
| 4 — Explain | Prepared bank, multiple concept links, typed/voice answers, versioned drafts, offline pending submissions, frozen reference feedback and self-rating | AI evaluation, interactive AI follow-ups, provider adapters and token/cost telemetry not implemented |
| 5 — Integration | Summary→Map, Map→prepared Explain, confirmed reference→Summary, MCQ-derived concept evidence and edition-safe source actions | Direct per-missed-MCQ shortcuts absent |
| 6 — Smart Review | Initial concept status/recommendation view and existing Review Center integration | No new adaptive schedule; AI and persisted Map Recall evidence absent |

The new tools currently support managed catalog study PDFs. Personal uploads, whiteboards and published summary-PDF reader variants continue using their existing editing surfaces.

## Setup and economical extension

1. Review migrations and run them in a configured local/staging PostgreSQL environment.
2. Set backend `KNOWLEDGE_ENABLED=true` and frontend `VITE_KNOWLEDGE_ENABLED=true`.
3. Use Django admin to configure per-sheet tools and publish reviewed concepts/source mappings/Explain questions. Basic notes and maps need no concept bank.
4. Resolve the public-knowledge evidence/build gate and complete PostgreSQL and device verification before production enablement.

Both global flags default off. `KNOWLEDGE_AI_ENABLED` is explicitly false; there is no paid provider adapter in this increment. An API key alone does not enable AI.

Current recurring AI API cost is zero. Future evaluation should use prepared rubrics, source-minimal requests, idempotent attempts, account quotas, explicit timeouts and at most two follow-ups. Provider, retention terms and spending limit need owner approval before activation.

For planning only: 20 evaluations/student/month at 1,200 input and 200 output tokens total 24,000 input and 4,000 output tokens. If approved provider prices per million tokens are Pi and Po, monthly cost/student is 0.024 Pi + 0.004 Po, before follow-ups. This is a usage formula, not a quoted provider price. Pre-generation should be amortized per reviewed sheet version.

## Validation and release gates

Passing evidence at handoff:
- 18 new backend behavior tests in explicit SQLite fast-test mode.
- 5 existing checkpoint/resume/final-XP/Review API regressions.
- 31 frontend model/storage and adjacent reader/Review tests.
- Targeted frontend ESLint, backend Ruff, strict mypy (8 source files), Django check and migration drift.
- All 5 browser cases passed in Chromium and WebKit: the connected workflow at 1194×834, Arabic reflow at 320×740, 834×1194 and 1440×900, phone answer recovery after reload, and storage-quota recovery/export/explicit discard.
- The updated tablet case also passed separately in both browsers after adding portrait↔landscape resizing, answer preservation and focus assertions.
- Manual integration diff review and `git diff --check` passed. Existing staged/unrelated changes were preserved.

These are 23 passing backend cases, 31 passing frontend cases and 5 browser scenarios run in each engine. The additional orientation runs repeat one browser case. One PostgreSQL-only test is skipped in SQLite. Browser tests use mocked API responses against a development preview; they do not certify production/PWA, real-device input, or a full frontend/backend browser integration.

The PostgreSQL first-save concurrency test exists and is marked postgres. The installed local service rejected the available local credentials. It was not verified; no remote database or production was mutated.

Ordinary production build is blocked by the repository's public-knowledge verification gate: many source entries, including pre-existing modified files, are stale. Hashes were not blindly refreshed and the gate was not weakened. Production bundle measurements, full coverage/CI, real iPad/Apple Pencil, actual browser dictation and server AI remain unverified.

Performance safeguards implemented: no new dependencies, on-demand document payloads, lazy editors, cached persisted ink geometry, bounded maps/evidence, commit-on-release map drags and debounced pan saves. Mobile latency, memory use and large-map frame rates have not been measured. Native controls, labels, keyboard movement/undo, stroke selection, focus restoration, RTL, touch targets and reduced motion are implemented; this is not a WCAG certification.

QA screenshots are in `frontend/output/playwright`. No deploy, push, merge, commit, production migration or paid service activation was performed.
