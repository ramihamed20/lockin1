import { expect, test } from "@playwright/test";
import { ID, mockAdmin } from "./helpers/mock-admin-workspace.js";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });

test("operators see real job attempts and can retry or cancel in RTL", async ({ page }) => {
  await mockAdmin(page, { locale: "ar" });
  const actions = [];
  let job = {
    id: ID, job_type: "question_package", sheet_id: ID, sheet_title: "Synthetic lecture",
    subject_id: ID, subject_title: "Pathology", status: "failed", revision: 3,
    error_message: "Preparation failed.", created_at: "2026-11-13T12:00:00Z",
    attempts: [{ attempt_number: 1, result: "failed", started_at: "2026-11-13T12:00:00Z", error_details: { message: "PDF unavailable." } }],
    output: {}
  };
  await page.route("**/api/v1/operations/admin/automation/jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const action = request.postDataJSON();
      actions.push(action);
      job = { ...job, revision: job.revision + 1, status: action.action === "retry" ? "queued" : "cancelled", error_message: "" };
    }
    const body = url.pathname.endsWith(ID) ? job : {
      count: 1, results: [job], status_counts: { [job.status]: 1 },
      task_types: [{ id: "question_package", label: "Question task package", can_run: true }]
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/#/operations/admin/automation");
  await expect(page.getByText("Failed 1")).toBeVisible();
  await page.getByRole("button", { name: "Job details" }).click();
  await expect(page.getByText("PDF unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Retry job" }).click();
  await expect(page.getByText("Queued 1")).toBeVisible();
  await page.getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByText("Cancelled 1")).toBeVisible();
  expect(actions).toEqual([{ action: "retry", expected_revision: 3 }, { action: "cancel", expected_revision: 4 }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("batch upload and the saved draft queue use the same academic subject", async ({ page }) => {
  await mockAdmin(page, { locale: "ar" });
  const subject = { id: ID, title: "Synthetic Pathology", college_title: "جامعة الاختبار", specialty_title: "Dentistry", academic_year_title: "Year 2" };
  const draft = { id: ID, title: "New lecture", workflow_status: "draft" };
  let uploadCount = 0;
  let queueBody;
  await page.route("**/api/v1/operations/admin/content/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/subjects")) return route.fulfill({ json: { results: [subject] } });
    if (url.pathname.endsWith("/automation-drafts")) {
      expect(url.pathname).toContain(subject.id);
      uploadCount += 1;
      return route.fulfill({ status: uploadCount === 1 ? 201 : 409, json: uploadCount === 1 ? draft : { error: { code: "revision_conflict", message: "This PDF is already attached." } } });
    }
    return route.fulfill({ json: { results: uploadCount ? [draft] : [], count: uploadCount ? 1 : 0 } });
  });
  await page.route("**/api/v1/operations/admin/automation/jobs**", async (route) => {
    if (route.request().method() === "POST") {
      queueBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: ID, status: "queued" } });
    }
    return route.fulfill({ json: { count: 0, results: [], status_counts: {}, task_types: [] } });
  });
  await page.route("**/api/v1/operations/admin/automation/subjects/**", (route) => route.fulfill({ json: { count: 0, results: [], matches: [] } }));
  await page.goto("/#/operations/admin/automation");
  await page.getByLabel("Destination", { exact: true }).selectOption(ID);
  await page.getByLabel("PDF files", { exact: false }).setInputFiles([
    { name: "New lecture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") },
    { name: "Duplicate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") }
  ]);
  await page.getByRole("button", { name: "Upload drafts" }).click();
  await expect(page.getByText("This PDF is already attached.")).toBeVisible();
  await page.getByRole("button", { name: "Queue AI task" }).click();
  await expect(page.getByText("New lecture queued. Open Automation jobs to continue.")).toBeVisible();
  expect(queueBody).toMatchObject({ job_type: "question_package", sheet_id: ID, normal_count: 30 });
  expect(uploadCount).toBe(2);
});

test("a validated question candidate requires a separate approval", async ({ page }) => {
  await mockAdmin(page);
  const job = {
    id: ID, job_type: "question_package", sheet_id: ID, sheet_title: "Review lecture",
    subject_id: ID, subject_title: "Pathology", status: "needs_review", revision: 5,
    created_at: "2026-11-13T12:00:00Z", attempts: [],
    output: { visual_review_pages: [2] }
  };
  const candidate = {
    active_study: {}, sheet_questions: { questions: [{
      type: "true_false", question: "Synthetic question for review?", explanation: "Synthetic explanation.",
      correct_answer: true, source_page: 2, difficulty: "easy"
    }] }
  };
  const actions = [];
  await page.route("**/api/v1/operations/admin/automation/jobs**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === "POST") {
      actions.push(request.postDataJSON());
      job.status = "completed";
      job.revision += 2;
      job.output.draft_import = true;
      return route.fulfill({ json: job });
    }
    if (pathname.endsWith("/questions")) return route.fulfill({ json: { revision: job.revision, payload: candidate } });
    if (pathname.endsWith(ID)) return route.fulfill({ json: job });
    return route.fulfill({ json: {
      count: 1, results: [job], status_counts: { [job.status]: 1 },
      task_types: [{ id: "question_package", label: "Question task package", can_run: true }]
    } });
  });
  await page.goto("/#/operations/admin/automation");
  await page.getByRole("button", { name: "Job details" }).click();
  await expect(page.getByText("Inspect these PDF pages visually before approval.", { exact: false })).toBeVisible();
  await page.locator(".admin-all-questions-preview summary").click();
  await expect(page.getByText("Synthetic explanation.", { exact: false })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve draft import" });
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox", { name: "I reviewed the questions", exact: false }).check();
  await approve.click();
  await expect(page.getByText("Completed 1")).toBeVisible();
  expect(actions).toEqual([{ action: "approve", expected_revision: 5 }]);
});
