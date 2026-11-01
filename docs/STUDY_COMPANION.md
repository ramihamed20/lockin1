# Curated study companion

Implemented for published catalog PDFs in the Focus reader. This version uses reviewed content authored by staff; it makes no AI-provider calls and does not enable the reserved `ai.assistance` entitlement. Student access follows the existing catalog and `focus.workspace` permissions.

## Student experience

- The approved original boy/girl PNGs are masked into head, body, hands and tail pieces using `original-motion.js` (from the editable Wick project). `originalCompanion.js` preserves their design and original pupil/highlight pixels, with smooth gesture transitions, gaze damping, uneven blink timing, mouth articulation during typing, thought dots/question mark, idea light and save sparkles. Six interaction states are idle, invite, speaking, thinking, saved and settle. One local RAF paints at most 30fps; hidden/inactive/reduced-motion characters use the original still. Appearance, motion and hide preferences are stored per account without session credentials.
- A contextual speech bubble opens one specific question. **Explain** types only its explanation; the related question appears after completion and reveals/types its answer when pressed. The lesson has save and close controls.
- Saving waits for server confirmation, persists per student, and does not restart the explanation. Saved ideas can be reviewed from the character settings without moving the PDF.
- Help is scoped to document version, edition, study/summary view and actual PDF page. A null page applies to the whole sheet. Changing scope cancels old requests and writing. Draft, stale-version and out-of-range ideas are excluded.
- The overlay is suppressed during quizzes, other reader panels, export, virtual pages, personal files and whiteboards. Failed content loads leave the reader usable.
- Arabic/English, RTL, reduced motion, 44px controls, narrow screens and short landscape layouts are supported.

## Authoring

In Content Studio, open a sheet's management controls and select **Study companion / مساعد الدراسة**. Choose the edition and study/summary view. Add the teaser, question, reviewed explanation, related question and answer; choose a page or leave it blank for the sheet. Save as draft, then publish using the publication selector. Roughly 10–12 ideas per sheet is an editorial target rather than a hard limit.

A ready PDF is required. Page-specific authoring also requires known PDF page-count metadata; whole-sheet help remains usable when that count is unknown. Updating an idea requires its current revision and source-version ID. Replacing the PDF creates a different content version: review and re-author its help for that version rather than attaching old explanations automatically. Unpublishing an idea also removes it from student saved-idea results.

## API

All paths are under `/api/v1`; existing session authentication, CSRF, cohort/content permissions and private API cache policy apply.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/catalog/documents/{document_id}/assistance?page=1&view=study` | Published current-page and sheet-wide help |
| GET | `/catalog/documents/{document_id}/assistance?saved=true&view=study` | Student's saved published help for this document/view |
| PUT | `/catalog/documents/{document_id}/assistance/{idea_id}/saved` | Idempotent save/unsave with `{ "saved": true, "view": "study" }` |
| GET / POST | `/operations/admin/content/sheets/{sheet_id}/assistance` | List or author current-version help; list filters are `edition` and `view` |
| PATCH | `/operations/admin/content/sheets/{sheet_id}/assistance/{idea_id}` | Edit or publish with `source_version_id` and `expected_revision` |

Student list responses include `version_id`. GET responses are `private, no-store`; save requests cannot enter the offline mutation queue. Administration uses the existing `content.view` / `content.manage` capability checks. Only plain text is rendered. Lists are bounded to 200 entries per scope.

## Integration and validation

Migration `content.0021_study_assistance` adds two tables, a positive-page check, a scope index and a unique student/idea save constraint. Existing rows are not backfilled; no teaching content or student saves are seeded. Apply the migration through the ordinary release process before serving the new endpoints. No new runtime dependency, environment variable or background service is required.

Validation (2026-11-01):

- 12 direct frontend tests cover content scoping, preference validation, Arabic typing, stale events, gesture interruption, blink/gaze limits, speech timing and RAF teardown. 148 adjacent Focus/Active Study/edition tests pass.
- 40 backend assistance/translation/summary/catalog tests pass in the explicit SQLite test mode. Targeted Ruff, Django checks and migration-drift checks pass.
- TypeScript, production build and public knowledge evidence validation pass.
- Browser QA uses the actual React components in a disposable mock-content harness: both original characters, speaking/thinking gestures, progressive explanation, subsequent question, answer disclosure and confirmed saving. The harness is excluded from the commit.

PostgreSQL and physical iPad/WebKit verification remain release checks. SQLite results do not establish row-lock behavior. This change is for the `codex/lockin0.1.5` source branch; applying the migration and publishing staff-authored ideas are needed before the companion appears in a deployed reader.
