# Lock-in Admin Panel 2.0 — first deliverable

This branch upgrades **the existing** Creator Studio/Operations Admin, rather than running another Django instance, database or SPA. It is intentionally a **safe foundation** for cross-functional automation, not a claim that every administrative action has been automated.

## Included

- **Admin Panel 2.0** heading and capability-gated navigation throughout the existing operational areas.
- Cross-functional next-action links for students, subscriptions, payments, content, question banks, moderation, feedback, notifications, analytics, audit, exports, system and settings.
- **Automation** workspace at \`/operations/admin/automation\`, available to users with \`content.view\`.
- Upload a batch of up to **20 PDFs** (50 MB each) to an existing subject in **sequence**, using the same \`management/files\` and \`createSheet\` services as the old admin panel.
- Automation rejects a PDF already attached as the primary file of a current, non-archived sheet in the same subject. It compares SHA-256 checksums and serializes concurrent Automation requests for that subject.
- Every uploaded sheet is created with \`publish: false\`, \`notify_students: false\` and \`allow_download: false\`. It is never published automatically.
- Download an AI task prompt derived from the existing All Questions backend planning contract, plus optional pasted past-exam question style (up to 6,000 chars).
- Read-only Django command \`export_lockin_ai_task\` for text extraction from a sheet PDF and up to five explicitly selected reference PDFs. It does not invoke AI. Image-only pages are reported for manual visual review.
- Validate the returned JSON through the existing \`all-questions/validate\` endpoint and require explicit confirmation before \`all-questions\` save with \`publish_sheet_questions: false\`.
- Deny fast-path import when the sheet has existing questions, since normal All Questions save can replace Active Study/previously-generated question banks.

## Boundaries and limitations

1. **No automatic Antigravity invocation.** Consumer CLI is never called from the web application, service or cron. The operator uses Antigravity directly with the downloaded task and PDF.
2. The upload batch list lives in the current browser session. Successful draft uploads persist in Django. Refreshing the browser clears the transient list, but the sheets remain accessible through the existing Content panel.
3. The optional past-exam style field is not a durable reference library. The server-side export command accepts existing reference PDFs explicitly. A future revision can add a permissioned, subject-scoped reference catalog and persistent processing jobs.
4. Text-only PDF extraction is not sufficient for tables, micrographs, or image-heavy medical slides. Visually inspect flagged pages and source citations before approval.
5. The user must **review every generated question**. Schema validation checks structure and count; it does not prove factual correctness.
6. There is no extra database, new service worker or background AI consumer. No production deployment occurs as part of this branch.
7. No existing management endpoints, permissions or question bank schemas were replaced.

## Operator walkthrough (after local staging review)

1. Open Admin Panel 2.0 → **Automation**.
2. Choose the exact existing university/specialty/year/subject; select lecture PDFs.
3. Upload drafts and verify their titles in the Content list.
4. In the batch, choose **Download AI task** for a sheet.
5. If the agent is operating on the VPS, choose **Copy VPS PDF export**. The clipboard receives a command of this form:
   \`cd /home/lockin/lockin1/backend && python manage.py export_lockin_ai_task --sheet-id <uuid> --output-dir /home/lockin/ai-tasks\`
   This is an optional operator command. It requires the project's normal Django environment and read-only access to the selected document.
6. For previous-year references on the VPS, append up to five \`--reference /path/to/authorized.pdf\` options.
7. Open the exported text, task prompt and source PDFs in Antigravity **directly**. Request a single JSON output.
8. Upload the returned JSON via **Validate returned JSON**. Fix any validation errors.
9. Review the preview against the source PDF and correct any errors in the JSON before validating again. Confirm the draft import. Publish separately in Content after review.

## Development and verification

- No writes to production data or automatic publication.
- Run \`node --test tests/admin-automation.test.js\` in \`frontend/\`.
- Run the frontend lint, typecheck and build plus existing admin tests.
- Exercise the flow with a staging account and a disposable sheet (normal PDFs, missing text, invalid JSON, and a valid All Questions payload).
- Verify page counts, active study exclusions, two sheet editions and capability gates.
- Verify existing questions cannot be silently replaced by automation.

## Follow-up milestones

- **2.1:** Durable PostgreSQL automation jobs, resume/retry, content checksums and idempotency, role-based approvals.
- **2.2:** Durable scoped reference catalog, semantic topic matching and extraction of image-heavy pages on a separate bounded worker.
- **2.3:** Deployment-ready optional AI engine adapters using officially supported service terms; scheduled background inference only where the provider allows that model of use.
- **2.4:** Per-area workflow automations: subscription eligibility checks, pending payments, moderation triage, notification review and system-health alerts. Each irreversible action requires a confirmation and audit trail.

The sections below track the implementation and verification of subsequent milestones.

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
4. Download an AI task and open it with its PDF. Use disposable sample JSON,
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
