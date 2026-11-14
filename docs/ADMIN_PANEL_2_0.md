# Lock-in Admin Panel 2.0

Automation extends the existing Creator Studio and uses the same academic
hierarchy, files, All Questions planner, publication controls and audit log.

## Operator workflow

1. Open **Automation**, select the exact university, specialty, year and
   subject, then upload up to 20 lecture PDFs. Files upload in sequence, up to
   50 MB each. The server checks the SHA-256 before storing each draft.
2. Optionally add previous examinations or other references to that subject.
   Wait for indexing to complete. Fix a blocked scan or invalid PDF before retrying.
3. Choose the Normal Question count and queue a job from **Saved draft sheets**.
   Open the job after it reaches **Ready for AI** and download the task.
4. Open the downloaded task and original lecture PDF directly in Antigravity.
   Inspect pages flagged for visual review. Request one All Questions JSON file.
5. Upload the result in the job. Review the saved candidate and correct any
   flagged errors. Approve the draft import after checking the source.
6. Publish the sheet and Normal Questions through their existing authorized
   publication controls. Review the audit log for the actor and action.

Operators can also run permission-scoped checks for their departments from
the same dashboard. Student, finance, and moderation decisions use the
existing authorized consoles.

## Phase 1 device acceptance

Physical iPhone and iPad verification is pending. Use a staging-only content
manager and disposable PDFs. On iPhone Safari in portrait, and on iPad Safari
in portrait and landscape, repeat these steps:

1. Open Automation in Arabic and English. Select a subject with a matching name
   in a different university or year and verify the full destination before upload.
2. Pick two valid PDFs in Files and upload them. Verify two draft rows with the
   selected subject, no student notification and no visibility from a student account.
3. Upload a renamed duplicate and then a malformed PDF. Verify distinct errors,
   and that neither produces another sheet. Retry after correcting the input.
4. Queue a job, download the AI task and open it with its PDF. Use disposable sample JSON,
   first invalid and then valid. Check the error and preview without overflow.
5. Change the sheet revision from another session and verify the stale import is
   rejected. Use a fresh draft for a successful import and verify audit history.
6. Verify the sheet and Normal Questions remain drafts. Reopen Automation with
   a view-only account and check that write controls are unavailable.

Record device, OS, browser, viewport orientation, branch SHA and each outcome.

## Persistent automation jobs

The dashboard loads persisted job status, filters and attempt history from
`/api/v1/operations/admin/automation/jobs`. It starts with the question-package
task and uses the existing All Questions planner. A job targets a single draft
and captures its sheet and settings revisions. The operator starts Antigravity
after downloading the prepared task.

On an isolated environment, apply the new Administration migration through
the regular release mechanism, then start one instance of
`python manage.py run_automation_worker`. Use `--once` to process one job in
a smoke test. The worker reclaims expired five-minute leases, fences stale
results by claim revision and preserves up to three preparation attempts.
Stop the worker before rolling back application code. The new tables can
remain in place for a code rollback. Reversing the migration deletes job
and attempt history, so export it first if it needs to be retained.

## Subject references

Choose the academic destination in Automation to open its reference library.
PDFs are private managed files. Replacements retain each earlier revision.
The worker checks the stored checksum before indexing text by original PDF
page number. An isolated Linux subprocess limits extraction to 384 MiB of
address space, 100 seconds of wall time, and 500 pages per reference. Each
page contributes at most 3,000 characters to the index. Search uses PostgreSQL
full-text search and filters by subject, type and topic tag.

## Persistent question review

Queue a task for a never-published draft from its subject's draft list. The
worker uses the saved All Questions plan, verifies the lecture PDF checksum,
and attaches excerpts from relevant indexed reference pages in that subject.
The downloaded instructions include original page numbers and flag pages
that require visual review. Use the original lecture PDF in Antigravity.

Upload the returned All Questions JSON in the job, correct validation errors,
and review the answers and explanations. Approval writes the reviewed
candidate through existing services. Normal Questions remain drafts. Active
Study banks become eligible only after the corresponding sheet is separately
published, and Normal Questions have their own authorized publication action.

If a flagged page needs a separate image, an authorized shell operator with
Poppler can run `python manage.py export_automation_page_images JOB_UUID
--page 2 --page 5 --output-dir NEW_PRIVATE_DIRECTORY`. The command renders
up to eight original pages per run with bounded dimensions, memory and time.
The review page links the task to its sheet. Medical interpretation remains
part of the operator's visual review.

## Operational checks

The same job dashboard can run role-scoped, deterministic reviews for student
access, subscriptions, payments, notifications, feedback, moderation, analytics,
and system health. Counts are computed from source rows. Identifiers are limited
to 25 examples per rule, with links to existing authorized consoles where
supported. Feedback grouping covers up to 250 recent submissions and detects
normalized duplicates. Payment and subscription findings are flags for
operator review. Campaign drafts use the existing composer. The dispatch
screen previews the recipient count and asks for confirmation before sending.

## Release and rollback

- Migrations 0005–0008 add job, attempt, reference, reference-page and candidate
  tables plus a PostgreSQL GIN search index. Existing educational records
  need no backfill. Start one worker only after the migrations succeed.
- Allow room for one temporary PDF of up to 50 MB and, when exporting images,
  a separate temporary image set. The worker runs one bounded parser at a time
  and holds no database transaction while extracting a PDF. Poppler is an
  optional dependency on the machine used for the manual image command.
- The base app image supplies the worker command. Start a single managed
  process or one replica from the same tested image and settings as Django.
  For a staging smoke test with an existing Compose project, run
  `docker compose run --rm backend python manage.py run_automation_worker --once`
  with the same staging Compose options used for the app. Verify the job's
  attempt and audit records. Staging acceptance still requires a live worker,
  synthetic accounts, representative PDFs and the device checks above.
- On rollback, stop the worker and restore the previous app image. Keeping the
  additive tables preserves history. Reverse the migrations only after backing
  up job, reference and candidate records. Reversal removes database metadata
  and leaves managed file objects for separately authorized cleanup.
- Reference matching and feedback grouping are deterministic. Reviewers must
  verify medical content and difficulty. The campaign preview confirms the
  recipient count and checks it again on dispatch. Recipient membership is
  calculated at dispatch, so equal-count membership changes are possible.

## Verification commands

Run the backend quality gate against isolated PostgreSQL and disposable
media. The targeted acceptance set is:

```bash
cd backend
python -m ruff check .
python -m ruff format --check .
python -m mypy .
python manage.py makemigrations --check --dry-run
python -m pytest --no-cov apps/administration/tests apps/admin_control/tests \
  apps/content/tests/test_all_questions.py \
  apps/content/tests/test_admin_list_query_budget.py \
  apps/content/tests/test_export_ai_task.py \
  apps/content/tests/test_edition_active_study_flow.py \
  apps/questions/tests/test_admin_content_management.py apps/files/tests/test_files.py
```

```bash
cd frontend
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:bundle
pnpm exec playwright test e2e/admin-automation-jobs.spec.js
```
