import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

const exams = [
  { id: "exam-one", title: "Dental midterm", starts_on: "2027-01-02", status: "tentative" },
  { id: "exam-two", title: "Practical exam", starts_on: "2027-01-09", status: "confirmed" }
];
function result(title = "Oral Histology") {
  return {
    kind: "reading_only_preview", persisted: false, planner_ready: false, profile_revision: 1,
    estimate: { minutes_per_page: 5 }, required_reading_minutes: 70, scheduled_reading_minutes: 25,
    required_question_minutes: 0, scheduled_question_minutes: 0, include_questions: true,
    question_inventory: { available: 0, answered: 0, remaining: 0, by_source: {} },
    issues: [{ sheet_id: "missing", title: "Pharmacology", reason: "page_count_unknown" }],
    days: [], assignments: [{ key: "reading-one", title, page_start: 1, page_end: 5, estimated_minutes: 25, scheduled_date: "2026-10-25" }],
    unscheduled: [{ key: "reading-two", title: "General Pathology", page_start: 1, page_end: 9, estimated_minutes: 45, reason: "no_fitting_slot" }]
  };
}
async function mock(page, { locale = "en", examStatus = 200, periods = exams, previewStatus = 200, onPreview, onApply } = {}) {
  const mutations = [];
  await page.addInitScript(locale => { localStorage.setItem("lock-in.locale", locale); localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); }, locale);
  await page.route("**/api/v1/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return send({ user: studentSession({ id: "pilot-student", preferred_language: locale }) });
    if (path === "/api/v1/auth/csrf") return send({ csrf_token: "test-csrf" });
    if (path === "/api/v1/operations/session") return send({}, 403);
    if (path === "/api/v1/study-plan/v2/exams") return send({ enabled: true, schema_version: 1, results: periods }, examStatus);
    if (path.endsWith("/apply") && onApply) return onApply(route, send);
    if (path.endsWith("/reading-preview")) {
      expect(req.method()).toBe("POST");
      if (onPreview) return onPreview(route, send);
      return send(result(), previewStatus);
    }
    if (path.startsWith("/api/v1/study-plan") && req.method() !== "GET") mutations.push(path);
    if (path === "/api/v1/study-plan") return send({
      profile: { configured: true, mode: "normal", revision: 1, daily_minutes: 60, session_minutes: 25, weekdays: [0,1,2,3,5,6], subjects: [], timezone: "Africa/Tripoli" },
      today: "2026-10-25", progress: {}, overdue: [], overdue_count: 0, count: 0, results: [],
      summary: { planned_count: 0, completed_count: 0, planned_minutes: 0, completed_minutes: 0, today_minutes: 0 }
    });
    return send({ count: 0, results: [] });
  });
  return mutations;
}
for (const [width, height, locale] of [[320,740,"ar"],[390,844,"en"],[820,1180,"ar"],[1194,834,"en"]]) {
  test(`authorized pilot previews actual pages and shortfall at ${width}px in ${locale}`, async ({ page }, testInfo) => {
    const mutations = await mock(page, { locale });
    await page.setViewportSize({ width, height });
    await page.goto("/#/study-plan");
    const panel = page.locator(".plan-exam-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".plan-exam-status")).toContainText(locale === "ar" ? "مبدئي" : "Tentative");
    await panel.locator("button[type=submit]").click();
    await expect(panel.locator(".plan-exam-task-list")).toContainText("Oral Histology");
    await expect(panel.locator(".plan-exam-warning")).toContainText("Pharmacology");
    await panel.locator(".plan-exam-unplaced > summary").click();
    await expect(panel.locator(".plan-exam-unplaced")).toContainText("General Pathology");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(mutations).toEqual([]);
    if (width === 320) await page.screenshot({ path: testInfo.outputPath("reading-preview-phone.png"), fullPage: true });
  });
}
test("non-pilot account stays on coming soon without loading the plan", async ({ page }) => {
  await mock(page, { examStatus: 403 });
  let loadedPlan = false;
  page.on("request", req => { if (new URL(req.url()).pathname === "/api/v1/study-plan") loadedPlan = true; });
  await page.goto("/#/study-plan");
  await expect(page.locator('.feature-coming-soon[data-feature-id="study-plan"]')).toBeVisible();
  await expect(page.locator(".study-plan-v2")).toHaveCount(0);
  expect(loadedPlan).toBe(false);
});
test("pilot with no assigned exams gets a truthful empty state", async ({ page }) => {
  await mock(page, { periods: [] });
  await page.goto("/#/study-plan");
  await expect(page.locator(".plan-exam-panel")).toContainText("No upcoming exam has been assigned");
  await expect(page.locator(".plan-exam-panel select")).toHaveCount(0);
});
test("preview errors keep the choices and allow a deliberate retry", async ({ page }) => {
  let calls = 0;
  await mock(page, { onPreview: (_route, send) => { calls++; return send(result(), calls === 1 ? 400 : 200); } });
  await page.goto("/#/study-plan");
  const panel = page.locator(".plan-exam-panel");
  await panel.locator("select").first().selectOption("exam-two");
  await panel.locator("button[type=submit]").click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator("select").first()).toHaveValue("exam-two");
  await panel.locator("button[type=submit]").click();
  await expect(panel.locator(".plan-exam-task-list")).toContainText("Oral Histology");
  expect(calls).toBe(2);
});
test("changing the exam discards results and rejects a stale in-flight preview", async ({ page }) => {
  let oldReply;
  await mock(page, { onPreview: (route, send) => {
    if (route.request().url().includes("exam-one")) return new Promise(resolve => { oldReply = () => send(result("STALE RESULT")).catch(() => {}).finally(resolve); });
    return send(result("Current exam"));
  } });
  await page.goto("/#/study-plan");
  const panel = page.locator(".plan-exam-panel");
  await panel.locator("button[type=submit]").click();
  await expect.poll(() => Boolean(oldReply)).toBe(true);
  await panel.locator("select").first().selectOption("exam-two");
  await oldReply();
  await expect(panel.locator(".plan-exam-result")).toHaveCount(0);
  await panel.locator("button[type=submit]").click();
  await expect(panel.locator(".plan-exam-task-list")).toContainText("Current exam");
  await expect(panel).not.toContainText("STALE RESULT");
});

test("a preview computed with different settings is discarded until plan refresh", async ({ page }) => {
  await mock(page, { onPreview: (_route, send) => send({ ...result(), profile_revision: 2 }) });
  await page.goto("/#/study-plan");
  const panel = page.locator(".plan-exam-panel");
  await panel.locator("button[type=submit]").click();
  await expect(panel.getByRole("alert")).toContainText("settings changed");
  await expect(panel.locator(".plan-exam-result")).toHaveCount(0);
});

function savedPreview() {
  const value = result("Anchored reading");
  return { ...value, apply_token: "a".repeat(64), today: "2026-10-25", required_reading_minutes: 25, scheduled_reading_minutes: 25, issues: [], unscheduled: [], assignments: [{ ...value.assignments[0], activity: "reading", start_url: "/materials/catalog/anatomy/sheets/intro/workspace?studyPage=1&studyVersion=version&studyFile=file" }] };
}

test("confirming a preview saves linked tasks and a lost acknowledgement retries the same intent", async ({ page }) => {
  let saved = false, attempts = 0;
  const intents = new Set();
  const task = { id: "task-one", title: "Anchored reading", activity: "reading", status: "planned", scheduled_date: "2026-10-25", duration_minutes: 25, revision: 1, start_url: savedPreview().assignments[0].start_url };
  await mock(page, { onPreview: (_route, send) => send(savedPreview()), onApply: (route, send) => {
    const body = route.request().postDataJSON();
    intents.add(body.client_request_id); attempts += 1; saved = true;
    expect(body.preview_token).toBe("a".repeat(64));
    if (attempts === 1) return send({ detail: "Response temporarily unavailable" }, 503);
    return send({ persisted: true, run_id: "run-one", created_count: 1, item_ids: [task.id], unscheduled_count: 0, issues_count: 0, first_date: task.scheduled_date });
  } });
  await page.route("**/api/v1/study-plan?**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile: { configured: true, mode: "normal", revision: 1, daily_minutes: 60, session_minutes: 25, weekdays: [0,1,2,3,5,6], subjects: [], timezone: "Africa/Tripoli" }, today: "2026-10-25", results: saved ? [task] : [], count: saved ? 1 : 0, overdue: [], overdue_count: 0, progress: {}, summary: { planned_count: saved ? 1 : 0, completed_count: 0, planned_minutes: saved ? 25 : 0, completed_minutes: 0, today_minutes: saved ? 25 : 0 } }) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/study-plan");
  const panel = page.locator(".plan-exam-panel");
  await panel.locator("button[type=submit]").click();
  await panel.getByRole("button", { name: "Save this plan", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Save this plan" });
  await expect(confirm).toContainText("1 activities");
  await confirm.getByRole("button", { name: "Confirm and save", exact: true }).click();
  await expect.poll(async () => await panel.locator(".plan-apply-success").count() || await panel.getByRole("alert").count()).toBeGreaterThan(0);
  if (!await panel.locator(".plan-apply-success").count()) {
    await panel.getByRole("button", { name: "Save this plan", exact: true }).click();
    await confirm.getByRole("button", { name: "Confirm and save", exact: true }).click();
  }
  await expect(panel.locator(".plan-apply-success")).toContainText("1 activities saved");
  await expect(page.locator(".plan-task-list")).toContainText(task.title);
  await expect(page.locator(".plan-task-list").getByRole("link", { name: "Start studying", exact: true })).toHaveAttribute("href", `#${task.start_url}`);
  expect(intents.size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a stale apply requires a new preview while retaining exam choices", async ({ page }) => {
  await mock(page, { onPreview: (_route, send) => send(savedPreview()), onApply: (_route, send) => send({ detail: "Plan changed" }, 409) });
  await page.goto("/#/study-plan");
  const panel = page.locator(".plan-exam-panel");
  await panel.locator("button[type=submit]").click();
  await panel.getByRole("button", { name: "Save this plan", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm and save", exact: true }).click();
  await expect(panel.getByRole("alert").last()).toContainText("Preview again");
  await expect(panel.getByRole("button", { name: "Save this plan", exact: true })).toHaveCount(0);
  await expect(panel.locator("select").first()).toHaveValue("exam-one");
  await expect(panel.locator("button[type=submit]")).toBeEnabled();
});
