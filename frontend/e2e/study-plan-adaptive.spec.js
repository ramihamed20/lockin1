import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

const exam = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const today = "2026-10-30";
async function setup(page, locale) {
  const writes = [];
  let profile = { configured: true, revision: 1, mode: "normal", daily_minutes: 60, session_minutes: 25,
    weekdays: [0,1,2,3,4,5,6], subjects: ["Anatomy"], timezone: "Africa/Tripoli", weekly_minutes: {}, date_minutes: {} };
  let item = { id: itemId, title: "Anatomy sheet", subject: "Anatomy", scheduled_date: today,
    duration_minutes: 25, revision: 1, status: "planned", activity: "reading", page_start: 1, page_end: 5,
    completed_page_end: null, period_id: exam, pinned: false, planning_key: "reading:owned", start_url: "/materials" };
  await page.addInitScript(locale => { localStorage.setItem("lock-in.locale", locale); localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); }, locale);
  await page.route("**/api/v1/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const send = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return send({ user: studentSession({ id: "adaptive-student", preferred_language: locale }) });
    if (path === "/api/v1/auth/csrf") return send({ csrf_token: "test-csrf" });
    if (path === "/api/v1/operations/session") return route.fulfill({ status: 403, body: "{}" });
    if (path.endsWith("/v2/exams")) return send({ enabled: true, schema_version: 1, results: [{ id: exam, title: "Midterm", starts_on: "2027-01-02", status: "tentative" }] });
    if (req.method() !== "GET" && path.startsWith("/api/v1/study-plan")) {
      const body = req.postDataJSON(); writes.push({ path, body });
      if (path.endsWith("/profile")) { profile = { ...profile, ...body, revision: profile.revision + 1 }; return send(profile); }
      if (path.endsWith("/progress")) { item = { ...item, completed_page_end: body.page_end, revision: item.revision + 1 }; return send({ saved: true }); }
      if (path.endsWith("/reading-preview")) return send({ kind: "reading_and_review_preview", persisted: false, profile_revision: profile.revision,
        estimate: { minutes_per_page: 5 }, required_reading_minutes: 25, scheduled_reading_minutes: 25,
        required_review_minutes: 0, scheduled_review_minutes: 0, required_active_study_minutes: 15, scheduled_active_study_minutes: 15,
        required_question_minutes: 0, scheduled_question_minutes: 0, include_questions: true,
        question_inventory: { available: 0, answered: 0, remaining: 0, by_source: {} },
        apply_token: "a".repeat(64), replace_item_ids: [itemId], today,
        issues: [], days: [], unscheduled: [], assignments: [{ key: "active", title: "Anatomy sheet", activity: "active_study", page_start: 1, page_end: 5,
          estimated_minutes: 15, scheduled_date: today, priority_reasons: ["retrieval_after_reading"], start_url: "/materials" }] });
      if (path.endsWith("/apply")) return send({ persisted: true, run_id: exam, created_count: 1, item_ids: [itemId], first_date: today, unscheduled_count: 0, issues_count: 0, replaced_count: 1 });
      item = { ...item, ...body, revision: item.revision + 1 }; return send(item);
    }
    if (path === "/api/v1/study-plan") return send({ profile, today, progress: {}, overdue: [], overdue_count: 0, count: 1, results: [item],
      summary: { planned_count: 1, completed_count: 0, planned_minutes: 25, completed_minutes: 0, today_minutes: 25 } });
    return send({ count: 0, results: [] });
  });
  await page.goto("/#/study-plan");
  await expect(page.locator(".study-plan-v2")).toBeVisible();
  return writes;
}
for (const [width, height, locale] of [[320,740,"ar"],[820,1180,"en"]]) {
  test(`partial reading, day exceptions and pins work at ${width}px in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const writes = await setup(page, locale);
    const tasks = page.locator(".plan-task-list");
    await tasks.getByRole("button", { name: locale === "ar" ? "تسجيل التقدم" : "Record progress" }).click();
    const form = page.locator(".plan-reading-progress");
    await form.locator('input[type="number"]').first().fill("3");
    await form.locator('input[type="number"]').last().fill("12");
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(writes.find(row => row.path.endsWith("/progress")).body).toMatchObject({ page_end: 3, minutes: 12, expected_revision: 1 });
    const capacity = page.locator(".plan-day-capacity");
    await capacity.locator("input").fill("20");
    await capacity.locator('button[type="submit"]').click();
    await expect.poll(() => writes.some(row => row.body.date_minutes?.[today] === 20)).toBe(true);
    await tasks.getByRole("button", { name: locale === "ar" ? "تثبيت الموعد" : "Keep this date" }).click();
    await expect(tasks.getByRole("button", { name: locale === "ar" ? "السماح بإعادة التوزيع" : "Allow rearranging" })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
test("replan previews and applies the selected active-study configuration", async ({ page }) => {
  const writes = await setup(page, "en");
  const panel = page.locator(".plan-exam-panel");
  await panel.getByLabel("Rearrange unfinished tasks; keep completed and pinned work").check();
  await panel.getByLabel("Question difficulty").selectOption("hard");
  await panel.locator('button[type="submit"]').click();
  await expect(panel.locator(".plan-exam-task-list")).toContainText("Active Study");
  await panel.locator(".plan-apply-bar button").click();
  await page.getByRole("alertdialog").locator(".btn-primary").click();
  await expect.poll(() => writes.some(row => row.path.endsWith("/apply"))).toBe(true);
  const body = writes.find(row => row.path.endsWith("/apply")).body;
  expect(body).toMatchObject({ replan: true, include_active_study: true, difficulty: "hard" });
});

test("subject preference order is saved without changing the study tasks", async ({ page }) => {
  const writes = await setup(page, "en");
  await page.locator(".plan-heading button").click();
  const settings = page.locator(".plan-settings");
  // Add a second subject, then move it ahead of the first.
  await settings.locator("#plan-subjects").fill("Physiology");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await settings.getByText("Preferred subject order", { exact: true }).click();
  await settings.getByRole("button", { name: "Move Physiology earlier" }).click();
  await settings.locator('button[type="submit"]').click();
  await expect.poll(() => writes.some(row => row.path.endsWith("/profile"))).toBe(true);
  expect(writes.find(row => row.path.endsWith("/profile")).body.subjects).toEqual(["Physiology", "Anatomy"]);
});


// The screenshot suite runs real Study Plan V2 components against deterministic
// API fixtures. No account, content, or exam information from production is used.
for (const [label, width, height, locale] of [
  ["phone-ar", 390, 844, "ar"],
  ["ipad-en", 820, 1180, "en"]
]) {
  test(`study-plan visual preview ${label}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await setup(page, locale);
    const panel = page.locator(".plan-exam-panel");
    await panel.locator('button[type="submit"]').click();
    await expect(panel.locator(".plan-exam-task-list")).toContainText("Anatomy sheet");
    await page.screenshot({
      path: testInfo.outputPath(`study-plan-visual-${label}.png`),
      fullPage: true,
      animations: "disabled"
    });
  });
}
