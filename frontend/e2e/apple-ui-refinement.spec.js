import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";
import { studentSession } from "./fixtures/productionApi.js";
import { POLICY_VERSION } from "../src/lib/policyContent.js";

test.use({ serviceWorkers: "block" });
async function mock(page, locale, theme) {
  await mockStudentApi(page);
  await page.addInitScript(locale => localStorage.setItem("lock-in.locale", locale), locale);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { user: studentSession({ username: "preview", full_name: "Preview", preferred_language: locale, policy_version: POLICY_VERSION, policy_accepted_at: "2026-10-27T00:00:00Z", theme_settings: { theme, character: "black", autoTheme: false } }) } }));
  await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: { results: [], checkout_available: false, manual_payment_available: false, first_subscription_offer_eligible: false } }));
  await page.route("**/api/v1/review-bank", route => route.fulfill({ json: { active_count: 0, mastered_this_week: 0, subjects: [] } }));
  await page.route("**/api/v1/weekly-recall", route => route.fulfill({ json: { available: false, eligible_count: 0, session: null } }));
  await page.route("**/api/v1/biweekly/*", route => route.fulfill({ json: { current_period: { period_start: "2026-10-20T00:00:00Z", period_end: "2999-01-01T00:00:00Z", next_report_at: "2999-01-01T00:00:00Z" }, history: [] } }));
  await page.route("**/api/v1/account/sessions", route => route.fulfill({ json: { sessions: [
    { id: "ipad", device_label: "Safari on iPad", is_current: true, last_seen_at: "2026-10-27T00:00:00Z" },
    { id: "phone", device_label: "Safari on iPhone", is_current: false, last_seen_at: "2026-10-26T00:00:00Z" }
  ] } }));
  await page.route("**/api/v1/notifications/preferences", route => route.fulfill({ json: [{ category: "learning", channel: "in_app", available: true, enabled: true, required: false }] }));
  await page.route("**/api/v1/notifications/push", route => route.fulfill({ json: { enabled: false, registered: false } }));
  await page.route("**/api/v1/notifications/summary", route => route.fulfill({ json: { unread_count: 0 } }));
  await page.route("**/api/v1/notifications/study-reminder", route => route.fulfill({ json: { enabled: false, time: "20:30", timezone: "Africa/Tripoli", locale, revision: 0 } }));
  await page.route("**/api/v1/progression/xp", route => route.fulfill({ json: { total_points: 55, level: 1, level_progress: 55, level_target: 500, transaction_count: 0 } }));
  await page.route("**/api/v1/progression/streak", route => route.fulfill({ json: { current_days: 0, longest_days: 0, last_qualified_on: null, policy: { title: "Meaningful learning days", grace_days: 0 } } }));
}

for (const config of [
  { name: "phone-ar", width: 320, height: 740, locale: "ar", theme: "night" },
  { name: "phone-en", width: 390, height: 844, locale: "en", theme: "day" },
  { name: "ipad-ar", width: 820, height: 1180, locale: "ar", theme: "day" },
  { name: "desktop-en", width: 1440, height: 1000, locale: "en", theme: "night" }
]) {
  test.describe(`quiet Apple-style UI ${config.name}`, () => {
    test.use({ viewport: { width: config.width, height: config.height }, hasTouch: true });
    test("core pages start with content, retain one accessible title and do not overflow", async ({ page }) => {
      await mock(page, config.locale, config.theme);
      for (const route of ["settings", "materials", "questions", "review", "notifications", "progress", "subscription"]) {
        await page.goto(`/#/${route}`);
        const loaded = { settings: ".settings-search", materials: ".catalog-directory", questions: ".question-directory", review: ".review-v2", notifications: ".notifications-v2", progress: ".progress-page-heading", subscription: ".subscription-v2" };
        await expect(page.locator(loaded[route])).toBeVisible({ timeout: 20000 });
        const title = page.getByRole("main").getByRole("heading", { level: 1 });
        await expect(title).toHaveCount(1, { timeout: 20000 });
        // The toolbar names the route visually; the semantic title stays for
        // assistive navigation instead of occupying a second hero row.
        expect((await title.boundingBox()).height, route).toBeLessThanOrEqual(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
        if (route === "settings") await page.screenshot({ path: `test-results/apple-ui-preview/${config.name}-settings.png`, fullPage: true });
      }
    });
    test("settings keeps keyboard navigation, concise controls and optional explanations", async ({ page }) => {
      await mock(page, config.locale, config.theme);
      await page.goto("/#/settings?section=notifications");
      await expect(page.locator("#settings-reminder").getByRole("switch")).toBeVisible({ timeout: 20000 });
      await expect(page.locator(".settings-notification-preview, .settings-detail-description")).toHaveCount(0);
      expect(Number.parseFloat(await page.locator("#settings-notifications-heading").evaluate(node => getComputedStyle(node).fontSize))).toBeLessThanOrEqual(22);
      const reminder = page.locator("#settings-reminder").getByRole("switch");
      await reminder.focus(); await page.keyboard.press("Space");
      await expect(reminder).toHaveAttribute("aria-checked", "true");
      expect((await reminder.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await page.goto("/#/settings?section=devices");
      const info = page.locator(".settings-info");
      await expect(info.locator("p")).toBeHidden();
      await info.locator("summary").focus(); await page.keyboard.press("Enter");
      await expect(info.locator("p")).toBeVisible();
      await expect(page.locator(".settings-device")).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/apple-ui-preview/${config.name}-devices.png`, fullPage: true });
    });
  });
}
