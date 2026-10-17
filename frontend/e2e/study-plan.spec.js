import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

const TODAY = "2026-10-16";
async function planner(page, { configured = false, locale = "en" } = {}) {
  let profile = { configured, mode: "normal", revision: configured ? 1 : 0, daily_minutes: 60, session_minutes: 25, weekdays: [0,1,2,3,4], subjects: [], timezone: "Africa/Tripoli" };
  let items = [];
  let rejectSave = false;
  await page.addInitScript(locale => { localStorage.setItem("lock-in.locale", locale); localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); }, locale);
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return send({ user: studentSession({ id: "planner-student", preferred_language: locale }) });
    if (path === "/api/v1/auth/csrf") return send({ csrf_token: "planner-csrf" });
    if (path === "/api/v1/operations/session") return send({}, 403);
    if (path === "/api/v1/study-plan") {
      const selected = items.filter(item => item.scheduled_date >= url.searchParams.get("from") && item.scheduled_date <= url.searchParams.get("to"));
      return send({ profile, today: TODAY, progress: { completed_days: 3, session_minutes: 15, ready_for_normal: false }, overdue: [], overdue_count: 0, count: selected.length, results: selected, summary: { planned_count: selected.length, completed_count: selected.filter(item => item.status === "completed").length, planned_minutes: selected.reduce((sum,item) => sum+item.duration_minutes,0), today_minutes: selected.filter(item => item.scheduled_date === TODAY).reduce((sum,item) => sum+item.duration_minutes,0) } });
    }
    if (path === "/api/v1/study-plan/profile") {
      const body = request.postDataJSON();
      expect(body.expected_revision).toBe(profile.revision);
      if (rejectSave) return send({ error: { code: "invalid", message: "Try again" } }, 400);
      profile = { ...profile, ...body, revision: profile.revision + 1, configured: true };
      return send(profile);
    }
    if (path === "/api/v1/study-plan/preview") return send({ count: 1, minutes: profile.mode === "beginning" ? 15 : 25, preview_token: "a".repeat(64), items: [{ title: "Study session", subject: "", scheduled_date: TODAY, duration_minutes: profile.mode === "beginning" ? 15 : 25 }] });
    if (path === "/api/v1/study-plan/generate") {
      expect(request.postDataJSON().preview_token).toBe("a".repeat(64));
      items.push({ id: "generated", title: "Study session", subject: "", generated: true, plan_mode: profile.mode, scheduled_date: TODAY, duration_minutes: 25, status: "planned", revision: 1 });
      return send({ count: 1, results: items });
    }
    if (path === "/api/v1/study-plan/items") {
      const body = request.postDataJSON();
      expect(body.client_request_id).toMatch(/^[\da-f-]{36}$/);
      const item = { ...body, id: "manual", status: "planned", generated: false, revision: 1 };
      items.push(item); return send(item, 201);
    }
    if (path.startsWith("/api/v1/study-plan/items/")) {
      const id = path.split("/").at(-1);
      const item = items.find(item => item.id === id);
      if (request.method() === "DELETE") { items = items.filter(item => item.id !== id); return route.fulfill({ status: 204 }); }
      const body = request.postDataJSON();
      expect(body.expected_revision).toBe(item.revision);
      Object.assign(item, body, { revision: item.revision + 1 }); return send(item);
    }
    return send({ count: 0, results: [] });
  });
  return { reject: value => { rejectSave = value; }, getItems: () => items };
}

test("Beginning and Normal persist preferences, preview sessions and retain completion after reload", async ({ page }) => {
  await planner(page);
  await page.goto("/#/study-plan");
  await page.getByRole("radio", { name: "Beginning", exact: true }).check();
  await expect(page.getByText(/Every 3 completed study days/)).toBeVisible();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByText("3 completed days · new sessions: 15 min")).toBeVisible();
  await page.getByRole("button", { name: "Preview this week" }).click();
  await expect(page.getByRole("heading", { name: "Your week, before you add it" })).toBeVisible();
  await page.getByRole("button", { name: "Add these sessions" }).click();
  await page.getByRole("button", { name: "Complete Study session", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Reopen Study session", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Plan settings", exact: true }).click();
  await page.getByRole("radio", { name: "Normal", exact: true }).check();
  await page.getByLabel("Minutes per day", { exact: true }).fill("90");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen Study session", exact: true })).toBeVisible();
});

test("Custom can create, reschedule and delete a task with an accessible confirmation", async ({ page }) => {
  await planner(page);
  await page.goto("/#/study-plan");
  await page.getByRole("radio", { name: "Custom", exact: true }).check();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Add session", exact: true }).click();
  await page.getByLabel("What will you study?", { exact: true }).fill("Review anatomy");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await page.getByRole("button", { name: "Edit Review anatomy", exact: true }).click();
  await page.getByLabel("Minutes", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.locator(".plan-task-list")).toContainText("40 min");
  await page.getByRole("button", { name: "Edit Review anatomy", exact: true }).click();
  await page.getByRole("button", { name: "Delete session", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Delete session", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".plan-task-list")).toHaveCount(0);
});

test("a rejected settings save keeps the student's draft for retry", async ({ page }) => {
  const state = await planner(page);
  state.reject(true);
  await page.goto("/#/study-plan");
  await page.getByLabel("Subjects", { exact: true }).fill("Anatomy, Physiology");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check the session details" })).toBeVisible();
  await expect(page.getByLabel("Subjects", { exact: true })).toHaveValue("Anatomy, Physiology");
  state.reject(false);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.locator(".plan-hero")).toBeVisible();
});

for (const [width, height, locale] of [[320,740,"ar"],[390,844,"en"],[820,1180,"ar"],[1194,834,"en"],[1440,900,"en"],[844,390,"ar"]]) {
  test(`planner reflows at ${width}x${height} in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await planner(page, { locale });
    await page.goto("/#/study-plan");
    await expect(page.locator(".plan-modes")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await page.screenshot({ path: `output/study-plan/setup-${width}-${locale}.png`, fullPage: true });
  });
}
