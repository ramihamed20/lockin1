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
