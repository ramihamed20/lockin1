# Active Study: page-based customization

Implementation date: 2026-10-17. Base: `codex/lockin0.1.3` at `3abb4d4`.
Working branch: `codex/active-study-page-customization`.

Students can choose the standard style or customize pages per checkpoint and 1–20 questions. The final exam retains its configured size and difficulty. Custom groups use the exact requested page count with a shorter final group. Excluded PDF pages are never tested.

## Rollout and data

The content migration adds `LearningObject.active_study_page_bank_enabled=False`. Existing sheets, their JSON, runs and progress retain the legacy contract. The Content Studio `create_sheet` service opts newly created sheets into page banks. Replacing an existing sheet's PDF does not enable the feature. New banks support both student styles.

The run migration adds `study_mode=standard` to existing runs, and includes the mode in the unique active-run scope. Standard and custom progress stay separate. Replacing custom settings requires explicit confirmation; the prior run is archived as abandoned. Source bank revisions are pinned so content replacement cannot silently change questions during grading. Completion XP retains the existing once-per-user/sheet/difficulty source key. Review identities remain stable across regrouping of the same bank. Explain links and knowledge evidence resolve those same actual question identities; old part-position mappings cannot match a custom question by accident.

## Authoring contract

Legacy sheets continue importing `parts`. New sheets import:

```json
{
  "pages": [
    { "page": 2, "questions": [] },
    { "page": 3, "questions": [] }
  ],
  "final_exam": { "questions": [] }
}
```

Every eligible physical PDF page must appear exactly once and contain 20 distinct supported MCQ/True-False questions; the final exam keeps the configured count. The arrays above are a structural example, not an importable complete bank. This per-page capacity makes a 20-question test on a single page possible. If the source cannot support that many valid questions, the prompt instructs the author to report the limitation instead of inventing content.

Single-difficulty and All Questions prompts, validation, save, counts and previews use the same page contract. Questions are authored on the University Sheet tab. Both PDFs share that bank. Customization of the Lockin edition is enabled only when its eligible page count matches the University edition; source page numbers then use the exclusion offset. Mismatched editions retain the standard style. No inferred page mapping is introduced.

## All Questions workflow

All Questions remains **one prompt and one complete JSON document**, covering Easy, Medium and Hard, each difficulty's final exam, and the optional Normal Questions. The updated screen makes the workflow explicit:

1. Choose excluded pages and the Normal Questions count. Optionally paste exam-style instructions into the prompt's own reference field. Copy the complete prompt or download the same text as a TXT file, then supply it with the PDF to the authoring AI. Style instructions affect wording; the PDF remains the factual source and the required schema/counts stay fixed.
2. Paste the resulting JSON or upload one JSON/TXT file (UTF-8, up to 16 MiB). A BOM or a single Markdown code fence is tolerated. Invalid files leave existing pasted text intact. New sheets use physical `pages`; existing sheets retain `parts`.
3. Validate, inspect counts and errors by page/part/question, then preview questions by difficulty, page, final exam or Normal Questions. Only one question is rendered at a time. Save remains an explicit action after successful validation. Editing the JSON, counts, boundaries or bank/config revisions requires validation again; saving also waits for the requested boundaries to finish loading.

Documents of at least 1 MiB are sent as one multipart file to avoid Django's JSON request-body memory limit. The server accepts exactly one `payload` or `payload_file`, limits files to 16 MiB, and uses the same permissions, complete-document validation, revision checks and atomic save. The original JSON request contract remains supported. No additional generation prompts or per-difficulty import steps are introduced.

## Offline and UI

Focus and Paper Workspace share bilingual customization controls. The phone dialog expands to keep the fields and Start button visible. Reader controls show page ranges. Online and offline selection use the same deterministic algorithm. Offline keys include the mode while retaining the original standard keys. Replay receives the exact settings and bank revision, regrades on the server, and retains the existing idempotency and XP boundary.

## Validation

Additional All Questions workflow checks (2026-10-17): 29 backend API tests passed on the explicit SQLite test configuration, including a real document above Django's JSON-body limit, multipart metadata, invalid files, stale revisions and physical-page errors. Frontend prompt/import/preview, Paper and public-knowledge tests: 49 passed. Browser tests: 3 passed (desktop prompt download/file import/preview/save, Arabic 375px phone with stale-validation protection, and invalid-upload recovery). Production build, targeted Ruff and ESLint passed. The catalogue evidence digest was reviewed after adding only the new admin translations; existing public translations and generated pages are unchanged. A missing `range` field on the Paper final-step descriptor was corrected; only the pre-existing `useCatalogDocument.js:52` TypeScript error remains. Browser data is synthetic and viewport-emulated; PostgreSQL concurrency and physical Safari remain outside this local evidence.

- Targeted content/JSON/admin/offline API suite: 73 passed, 2 PostgreSQL-only skips.
- Managed runtime, page banks and edition regression suite: 48 passed, 2 PostgreSQL-only skips.
- Frontend prompt, public knowledge, offline and account isolation tests: 68 passed.
- Additional custom offline continuation regression: 1 passed.
- Page-bank and Explain/knowledge integration suite: 35 passed.
- Browser workflow: 4 passed on synthetic data: 390px phone, 1180px tablet, Arabic RTL phone and legacy-sheet start. Chromium viewport emulation; not physical iPad/Safari certification.
- Production build passed after reviewing and updating the relevant public-help evidence; Django checks and migration drift passed; targeted Ruff and ESLint passed.
- TypeScript's existing failure remains in unchanged `frontend/src/hooks/useCatalogDocument.js:52`: `fileId` is absent from the inferred descriptor parameter type.
- PostgreSQL locking/concurrency validation could not run: this environment does not permit starting PostgreSQL under a separate operating-system user. SQLite results are business-logic and migration evidence, not PostgreSQL concurrency evidence.

The public-help source already had stale evidence for the workspace and translation catalogue at the base revision. The active-study answers were reviewed against the current source, regression tests and four browser paths. Only the three relevant changed source digests and new Active Study evidence were updated. Withheld account-email evidence was left untouched.

No production data, existing question banks, remote branches or deployment were changed. Before release, run the PostgreSQL CI tests and resolve the existing TypeScript gate. Apply both additive migrations with the normal release workflow.
