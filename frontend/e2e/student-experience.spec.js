import { expect, test } from "@playwright/test";
import { reminderDefaults } from "../src/pwa/studyReminder.js";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const summaries = [
  { id: "22222222-2222-4222-8222-222222222222", title: "Cell notes", mode: "keyboard", color: "blue", status: "finished", pages: { 1: "Cells" }, updated_at: "2026-10-25T12:00:00Z", document: { id: "doc-1", material_slug: "histology", material_title: "Histology", sheet_slug: "cells", title: "Cells", available: true } },
  { id: "33333333-3333-4333-8333-333333333333", title: "Bone notes", mode: "keyboard", color: "green", status: "writing", pages: { 1: "Bone" }, updated_at: "2026-10-25T12:00:00Z", document: { id: "doc-2", material_slug: "anatomy", material_title: "Anatomy", sheet_slug: "bones", title: "Bones", available: true } }
];

async function server(context, { locale = "en", signedIn = true } = {}) {
  const state = { weeklyFails: true, ledgerReads: [], reminderWrites: [], reminder: { ...reminderDefaults, locale, revision: 0 } };
  await context.addInitScript(({ language }) => localStorage.setItem("lock-in.locale", language), { language: locale });
  await context.route("**/api/v1/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/session") return signedIn ? json({ user: studentSession({ id: OWNER, preferred_language: locale }) }) : json({ detail: "Sign in" }, 401);
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: "test-csrf" });
    if (path === "/api/v1/operations/session") return json({ detail: "Student" }, 403);
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/biweekly/review") return json({ history: [], current_period: { period_start: "2026-10-19", period_end: "2026-11-01", next_report_at: "2026-11-02T00:00:00Z" } });
    if (path === "/api/v1/review-bank") return json({ active_count: 1, mastered_this_week: 0, subjects: [{ subject_key: "histology", subject_label_snapshot: "Histology", question_count: 1 }] });
    if (path === "/api/v1/review-queue") return json({ count: 0, results: [] });
    if (path === "/api/v1/weekly-recall") return state.weeklyFails ? json({ detail: "Weekly unavailable" }, 503) : json({ available: false, session: null, eligible_count: 0 });
    if (path === "/api/v1/progression/xp") return json({ total_points: 55, level: 1, level_progress: 55, level_target: 500, transaction_count: 6 });
    if (path === "/api/v1/progression/streak") return json({ current_days: 1, longest_days: 2, last_qualified_on: "2026-10-26", policy: { title: "Meaningful learning days", grace_days: 0 }, calendar: { today: "2026-10-26", start: "2026-10-05", end: "2026-11-01", qualified_days: ["2026-10-05", "2026-10-26"] } });
    if (path === "/api/v1/progression/xp/ledger") {
      state.ledgerReads.push(url.searchParams.toString());
      const empty = url.searchParams.get("period") === "month";
      const page = Number(url.searchParams.get("page") || 1);
      const entries = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), reason: `Award ${i + 1}`, category: "learning", points: 5, occurred_at: "2026-10-26T10:00:00Z" }));
      return json({ count: empty ? 0 : 6, next: !empty && page === 1 ? "/api/v1/progression/xp/ledger?page=2" : null, previous: page === 2 ? "/api/v1/progression/xp/ledger?page=1" : null, results: empty ? [] : entries.slice((page - 1) * 5, page * 5) });
    }
    if (path === "/api/v1/catalog/summaries") return json({ results: summaries });
    if (path === "/api/v1/notifications/preferences") return json([{ category: "learning", channel: "push", enabled: true, available: true, required: false }]);
    if (path === "/api/v1/notifications/push") return json({ enabled: false, registered: false });
    if (path === "/api/v1/notifications/study-reminder") {
      if (req.method() === "PUT") { const data = req.postDataJSON(); state.reminderWrites.push(data); state.reminder = { ...data, revision: data.expected_revision + 1, paused_until: data.pause_hours ? new Date(Date.now() + data.pause_hours * 3600000).toISOString() : null, next_due_at: new Date(Date.now() + 86400000).toISOString() }; }
      return json(state.reminder);
    }
    if (path === "/api/v1/notifications/summary") return json({ detail: "Summary unavailable" }, 503);
    if (path === "/api/v1/notifications") return json({ next: null, previous: null, results: [{ id: "notice", title: "New sheet ready", body: "Available", category: "learning", created_at: "2026-10-25T10:00:00Z", has_target: false, read_at: null }] });
    return json({ count: 0, results: [] });
  });
  return state;
}

test("XP pagination shows every award and does not change the qualified-day calendar", async ({ page, context }) => {
  const state = await server(context);
  await page.goto("/#/progress");
  await expect(page.getByText("Award 5", { exact: true })).toBeVisible();
  await expect(page.getByText("9%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Award 6", { exact: true })).toBeVisible();
  await expect(page.getByText("Award 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("9%", { exact: true })).toBeVisible();
  await page.locator(".progress-range-control select").selectOption("month");
  await expect(page.locator(".progress-empty-ledger")).toBeVisible();
  await expect(page.getByText("Award 6", { exact: true })).toHaveCount(0);
  expect(state.ledgerReads.some(query => query.includes("page_size=5") && query.includes("period=month"))).toBe(true);
});

for (const config of [{ locale: "en", width: 390, height: 844 }, { locale: "ar", width: 820, height: 1180 }]) {
  test(`review remains usable when weekly recall fails — ${config.locale}`, async ({ page, context }) => {
    const state = await server(context, config);
    await page.setViewportSize({ width: config.width, height: config.height });
    await page.goto("/#/review");
    const start = page.locator(".review-bank-entry .btn-primary");
    await expect(start).toBeVisible();
    await expect(page.getByText("Weekly unavailable", { exact: true })).toBeVisible();
    state.weeklyFails = false;
    await page.getByRole("button", { name: config.locale === "ar" ? "حاول مجددًا" : "Try again" }).first().click();
    await expect(page.locator(".weekly-recall-entry")).toBeVisible();
    await expect(start).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`summaries can be found, filtered and opened by identity — ${config.locale}`, async ({ page, context }) => {
    await server(context, config);
    await page.setViewportSize({ width: config.width, height: config.height });
    await page.goto("/#/materials/summaries");
    await expect(page.locator(".summary-row")).toHaveCount(2);
    await page.getByRole("searchbox").fill("Bone");
    await expect(page.locator(".summary-row")).toHaveCount(1);
    await expect(page.locator(".summary-row a")).toHaveAttribute("href", /summary=33333333-3333-4333-8333-333333333333/);
    await page.getByRole("searchbox").fill("");
    await page.locator(".summary-filters select").last().selectOption("finished");
    await expect(page.locator(".summary-row")).toHaveCount(1);
    await expect(page.getByText("Cell notes", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`study notification types, quiet hours, pause and reload persist — ${config.locale}`, async ({ page, context }) => {
    const state = await server(context, config);
    await page.setViewportSize({ width: config.width, height: config.height });
    await page.goto("/#/settings?section=notifications");
    const panel = page.locator("#settings-reminder");
    const checks = panel.getByRole("checkbox");
    await checks.nth(0).check();
    await checks.nth(2).check();
    await checks.nth(3).check();
    await panel.locator("select").first().selectOption("4");
    await panel.locator(".study-alert-days button").nth(1).click();
    await checks.nth(5).check();
    await checks.nth(6).uncheck();
    const save = panel.getByRole("button", { name: config.locale === "ar" ? "حفظ" : "Save", exact: true });
    await panel.locator('input[type="time"]').first().fill("23:00");
    await save.click();
    await expect(panel.getByRole("alert")).toContainText(config.locale === "ar" ? "خارج ساعات الهدوء" : "outside quiet hours");
    expect(state.reminderWrites).toHaveLength(0);
    await panel.locator('input[type="time"]').first().fill("20:30");
    await save.click();
    await expect.poll(() => state.reminderWrites.length).toBe(1);
    expect(state.reminderWrites[0]).toMatchObject({ review_enabled: true, weekly_enabled: true, weekly_day: 4, quiet_enabled: true, push_preview: false, weekdays: [0, 2, 3, 4, 5, 6] });
    await expect(panel.locator(".study-alert-schedule")).toBeVisible();
    await page.reload();
    await expect(panel.getByRole("checkbox").nth(2)).toBeChecked();
    await expect(panel.locator(".study-alert-days button").nth(1)).toHaveAttribute("aria-pressed", "false");
    await panel.getByRole("button", { name: config.locale === "ar" ? "إيقاف تنبيهات الدراسة لمدة 24 ساعة" : "Pause study alerts for 24 hours", exact: true }).click();
    await expect.poll(() => state.reminderWrites.length).toBe(2);
    expect(state.reminderWrites[1].pause_hours).toBe(24);
    await expect(panel.locator(".study-alert-schedule")).toContainText(config.locale === "ar" ? "متوقفة" : "paused");
    await panel.getByRole("button", { name: config.locale === "ar" ? "استئناف تنبيهات الدراسة" : "Resume study alerts", exact: true }).click();
    await expect.poll(() => state.reminderWrites.length).toBe(3);
    expect(state.reminderWrites[2].pause_hours).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const targets = await panel.locator(".study-alert-days button, .study-alert-toggle, .study-alert-actions button").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
    expect(targets.every(height => height >= 44)).toBe(true);
  });

  test(`daily reminder saves the account schedule without requesting device permission — ${config.locale}`, async ({ page, context }) => {
    const state = await server(context, config);
    await context.addInitScript(() => {
      window.__reminderPermissionRequests = 0;
      if (window.Notification) Notification.requestPermission = async () => {
        window.__reminderPermissionRequests += 1;
        return "denied";
      };
    });
    await page.setViewportSize({ width: config.width, height: config.height });
    await page.goto("/#/settings?section=notifications");
    const panel = page.locator("#settings-reminder");
    await expect(panel.locator('input[type="time"]')).toHaveValue("18:00");
    await panel.getByRole("checkbox", { name: config.locale === "ar" ? "تفعيل التنبيهات الدراسية المجدولة" : "Enable scheduled study notifications", exact: true }).check();
    await panel.locator('input[type="time"]').fill("20:30");
    await panel.getByRole("button", { name: config.locale === "ar" ? "حفظ" : "Save", exact: true }).click();
    await expect.poll(() => state.reminderWrites.length).toBe(1);
    expect(state.reminderWrites[0]).toMatchObject({ enabled: true, time: "20:30", timezone: "Africa/Tripoli", locale: config.locale, expected_revision: 0, study_enabled: true, review_enabled: false, weekly_enabled: false, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    await expect(panel.getByRole("status")).toBeVisible();
    expect(await page.evaluate(() => window.__reminderPermissionRequests)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("notification feed is usable even when its unread summary fails", async ({ page, context }) => {
  await server(context);
  await page.goto("/#/notifications");
  await expect(page.getByText("New sheet ready", { exact: true })).toBeVisible();
  await expect(page.locator(".notification-feed-item")).toHaveCount(1);
});

test("first visit reaches sign-in without dismissing an installation screen", async ({ page, context }) => {
  await server(context, { signedIn: false });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.locator(".pwa-launch-screen")).toHaveCount(0);
});
