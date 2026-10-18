# Active Study: page-based customization

Implementation date: 2026-10-17. Base: `codex/lockin0.1.3` at `3abb4d4`.
Working branch: `codex/active-study-page-customization`.

Students can choose the standard style, customize up to 10 pages per checkpoint and up to 30 questions (never more than 15 per page of the shortest group), or use Pomodoro style in the Focus reader. The final exam retains its configured size and difficulty. Custom groups use the exact requested page count with a shorter final group. Excluded PDF pages are never tested.

## Rollout and data

The content migration adds `LearningObject.active_study_page_bank_enabled=False`. Existing sheets, their JSON, runs and progress retain the legacy contract. The Content Studio `create_sheet` service opts newly created sheets into page banks. Replacing an existing sheet's PDF does not enable the feature. New banks support all three student styles.

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

Every eligible physical PDF page must appear exactly once and contain 1–15 distinct supported MCQ/True-False questions (up to 15, not exactly 15); the final exam keeps the configured count. Banks written earlier with 20 per page stay valid and use only the first 15 of each page. The arrays above are a structural example, not an importable complete bank. This per-page capacity makes a 15-question test on a single page possible. The prompt instructs the author to generate fewer supported questions when needed instead of inventing content. Checkpoints choose up to the requested count based on what is available from the assigned pages; final exams still use their configured exact counts.

Single-difficulty and All Questions prompts, validation, save, counts and previews use the same page contract. Questions are authored on the University Sheet tab. Both PDFs share that bank. Customization of the Lockin edition is enabled only when its eligible page count matches the University edition; source page numbers then use the exclusion offset. Mismatched editions retain the standard style. No inferred page mapping is introduced.

## All Questions workflow

All Questions remains **one prompt and one complete JSON document**, covering Easy, Medium and Hard, each difficulty's final exam, and the optional Normal Questions. The updated screen makes the workflow explicit:

1. Choose excluded pages and the Normal Questions count. Optionally paste exam-style instructions into the prompt's own reference field. Copy the complete prompt or download the same text as a TXT file, then supply it with the PDF to the authoring AI. Style instructions affect wording; the PDF remains the factual source and the required schema/counts stay fixed.
2. Paste the resulting JSON or upload one JSON/TXT file (UTF-8, up to 16 MiB). A BOM or a single Markdown code fence is tolerated. Invalid files leave existing pasted text intact. New sheets use physical `pages`; existing sheets retain `parts`.
3. Validate, inspect counts and errors by page/part/question, then preview questions by difficulty, page, final exam or Normal Questions. Only one question is rendered at a time. Save remains an explicit action after successful validation. Editing the JSON, counts, boundaries or bank/config revisions requires validation again; saving also waits for the requested boundaries to finish loading.

Documents of at least 1 MiB are sent as one multipart file to avoid Django's JSON request-body memory limit. The server accepts exactly one `payload` or `payload_file`, limits files to 16 MiB, and uses the same permissions, complete-document validation, revision checks and atomic save. The original JSON request contract remains supported. No additional generation prompts or per-difficulty import steps are introduced.

## Offline and UI

Focus and Paper Workspace share bilingual customization controls. The phone dialog expands to keep the fields and Start button visible. Reader controls show page ranges. Online and offline selection use the same deterministic algorithm. Offline keys include the mode while retaining the original standard keys. Replay receives the exact settings and bank revision, regrades on the server, and retains the existing idempotency and XP boundary.

## Pomodoro style

The additional style is selectable inside Active Study in the Focus PDF reader for eligible new page-based sheets. It has independent progress; Paper Workspace retains its existing standard/custom choices.

- Read for 25 minutes. A small translucent timer stays at the physical bottom-right in English and Arabic, above the page/zoom controls. It is smaller on phones and larger on tablets, with 44px pause/resume targets. Its one-second renders stay inside the timer component, rather than rerendering the PDF workspace.
- When the deadline is reached, the question-count dialog opens for the eligible physical pages reached during that cycle. The first cycle starts at the first eligible page; the next starts after the previous tested page. Excluded covers and inserted notebook pages do not become question sources. The dialog waits while notes, knowledge tools or another quiz are open.
- Choose 1–40 questions, limited by the available bank: one page supplies at most 20 unique questions. Round-robin selection shares questions as evenly as possible. When fewer questions than pages are chosen, source pages are spread across the range. The same existing bank and single All Questions JSON are reused.
- The server locks the run and freezes the cycle's `end_page` and `question_count`, appending the unread tail as the next range. A repeated request keeps the same range and attempt. A retry cannot change the closed range or count. Historical Review/Explain identities continue resolving the same questions after later cycles.
- After reviewing a test, both advancing and choosing to study again receive a five-minute break; the student explicitly starts the next 25 minutes. The configured final exam and once-per-sheet/difficulty XP rule remain unchanged. Time itself awards no XP; the countdown is a local study aid, while the server validates pages and grades answers.
- The timer's deadline, pause state and last physical page are saved per account/run on the device. Reloads and throttled background timers use the original deadline. The countdown is not a cross-device time ledger; server run progress remains authoritative.
- Downloaded runs use their own `:pomodoro` scope and queue the exact closed page/count metadata. Server replay revalidates, regrades and remains idempotent. Offline bundle schema v3 refreshes the capability/progress fields without making student progress part of content-version hashes.

Migration `focus.0019_active_study_pomodoro_style` adds the model choice only. Existing sheet flags and runs are not changed; the existing active-run uniqueness constraint already includes the style.

Pomodoro validation: 82 backend tests passed with 4 PostgreSQL-only skips across managed/page/Pomodoro/offline/Explain integration, plus 1 downloaded-bundle version regression. Timer, selection, offline, student and Paper frontend tests: 60 passed. Browser checks: 3 Pomodoro flows (390px phone including reload and 40 questions, 1180px touch tablet including pause/test/break/new range, 375px Arabic phone including capacity/focus/overflow) and 4 standard/custom/legacy regressions passed on synthetic Chromium data. These are viewport emulations, not physical Safari certification. Django checks and migration drift passed; the existing TypeScript error described below remains outside this feature.

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

No production data, existing question banks, remote branches or deployment were changed. Before release, run the PostgreSQL CI tests and resolve the existing TypeScript gate. Apply the additive content/focus migrations with the normal release workflow.
