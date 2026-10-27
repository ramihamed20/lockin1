import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";
import { studentSession } from "./fixtures/productionApi.js";
import { POLICY_VERSION } from "../src/lib/policyContent.js";

test.use({ serviceWorkers: "block" });

async function server(page, locale) {
  await mockStudentApi(page);
  await page.addInitScript(locale => {
    localStorage.setItem("lock-in.locale", locale);
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
  }, locale);
  const user = studentSession({ username: "lockin_student", full_name: "Lockin Student", preferred_language: locale, policy_version: POLICY_VERSION, policy_accepted_at: "2026-10-26T10:00:00Z" });
  const state = { confirmations: 0, deletionStatus: "not_requested", profileWrites: [], pageReads: [], revokes: [], emails: [], preferences: [{ category: "learning", channel: "push", enabled: true, available: true, required: false }, { category: "learning", channel: "in_app", enabled: true, available: true, required: false }, { category: "security", channel: "in_app", enabled: true, available: true, required: true }] };
  const sessions = [["phone", "Safari on iPhone", true], ["tablet", "Safari on iPad", false], ["laptop", "Chrome on Windows computer", false], ["unknown", "Another browser", false]].map(([id, device_label, is_current]) => ({ id, device_label, is_current, created_at: "2026-10-01T12:00:00Z", last_seen_at: "2026-10-26T16:00:00Z", expires_at: "2026-11-01T12:00:00Z" }));
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { user } }));
  await page.route("**/api/v1/auth/csrf", route => route.fulfill({ json: { csrf_token: "synthetic-csrf" } }));
  await page.route("**/api/v1/account/**", async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path.endsWith("/sessions")) return route.fulfill({ json: { sessions: sessions.filter(session => !state.revokes.includes(session.id)) } });
    if (path.includes("/sessions/") && req.method() === "DELETE") { state.revokes.push(path.split("/").at(-1)); return route.fulfill({ status: 204 }); }
    if (path.endsWith("/deletion/confirm")) { state.confirmations += 1; state.deletionStatus = "confirmed"; return route.fulfill({ json: { status: "confirmed", request: { policy_version: "test" } } }); }
    if (path.endsWith("/deletion")) return route.fulfill({ json: { status: state.deletionStatus, request: null } });
    if (path.endsWith("/data-export")) return route.fulfill({ json: { account: { full_name: "Lockin Student" } } });
    if (path.endsWith("/email")) { state.emails.push(req.postDataJSON()); return route.fulfill({ json: { status: "confirmation_required" } }); }
    if (path.endsWith("/profile")) { state.profileWrites.push(req.postDataJSON()); return route.fulfill({ json: { user: { ...user, ...req.postDataJSON() } } }); }
    return route.fulfill({ json: { status: "updated" } });
  });
  await page.route("**/api/v1/payments?*", route => {
    const page = Number(new URL(route.request().url()).searchParams.get("page")); state.pageReads.push(page);
    return route.fulfill({ json: { count: 11, next: page === 1 ? "/api/v1/payments?page=2" : null, previous: page === 2 ? "/api/v1/payments?page=1" : null, results: [{ id: `payment-${page}`, amount_minor: 12500, currency: "LYD", currency_exponent: 3, method: "libyana", created_at: "2026-10-25T10:00:00Z", status: page === 1 ? "refunded" : "pending", refunded_amount_minor: page === 1 ? 12500 : 0, price_snapshot: { plan_title: page === 1 ? "Midterm plan" : "Year plan" }, manual_submission: { status: "approved" } }] } });
  });
  await page.route("**/api/v1/notifications/preferences", route => {
    if (route.request().method() === "PUT") state.preferences = route.request().postDataJSON().map(item => ({ ...item, available: true, required: item.category === "security" }));
    return route.fulfill({ json: state.preferences });
  });
  await page.route("**/api/v1/notifications/study-reminder", route => route.fulfill({ json: { enabled: false, time: "18:00", timezone: "Africa/Tripoli", locale, revision: 0 } }));
  return state;
}

for (const config of [{ name: "phone-ar", width: 320, height: 740, locale: "ar" }, { name: "phone-en", width: 390, height: 844, locale: "en" }, { name: "ipad-ar", width: 820, height: 1180, locale: "ar" }, { name: "ipad-landscape-ar", width: 1180, height: 820, locale: "ar" }, { name: "desktop-en", width: 1440, height: 1000, locale: "en" }]) {
  test.describe(`settings redesign ${config.name}`, () => {
    test.use({ viewport: { width: config.width, height: config.height }, hasTouch: true, serviceWorkers: "block" });
    test("search and section navigation are usable at this size", async ({ page }) => {
      await server(page, config.locale);
      await page.goto("/#/settings");
      const nav = page.locator(".settings-v2-nav");
      await expect(nav.getByRole("searchbox")).toBeVisible({ timeout: 15000 });
      await page.screenshot({ path: `test-results/settings-preview/${config.name}-settings.png`, fullPage: true });
      await nav.getByRole("searchbox").fill("payment history");
      await expect(nav.locator("ul button")).toHaveCount(1);
      await nav.locator("ul button").click();
      await expect(page.locator("#settings-billing")).toBeVisible();
      await expect(page.locator("#settings-billing-heading")).toBeFocused();
      if (config.width < 1100) {
        await page.locator(".settings-v2-back").click();
        await expect(nav.getByRole("searchbox")).toHaveValue("payment history");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test("devices show distinct silhouettes and revocation requires confirmation", async ({ page }) => {
      const state = await server(page, config.locale);
      await page.goto("/#/settings?section=devices");
      for (const type of ["phone", "tablet", "computer", "unknown"]) await expect(page.locator(`.settings-device-art[data-device-type="${type}"]`)).toHaveCount(1);
      await expect(page.locator(".settings-device.is-current")).toHaveCount(1);
      const tablet = page.locator(".settings-device").filter({ has: page.locator('[data-device-type="tablet"]') });
      await tablet.locator("summary").click();
      await tablet.getByRole("button").click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible(); expect(state.revokes).toEqual([]);
      await dialog.locator(".btn-danger").click();
      await expect.poll(() => state.revokes).toEqual(["tablet"]);
      await expect(page.locator('[data-device-type="tablet"]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/settings-preview/${config.name}-devices.png`, fullPage: true });
    });
    test("payment history uses final refund status and visits the next server page", async ({ page }) => {
      const state = await server(page, config.locale);
      await page.goto("/#/settings?section=billing");
      await expect(page.locator(".settings-payment-status")).toHaveText(config.locale === "ar" ? "مستردة" : "Refunded");
      await page.locator(".settings-payment summary").click();
      await expect(page.locator(".settings-payment-detail")).toContainText("payment-1");
      await expect(page.locator(".settings-payment-detail")).toContainText(/12[.,]5/);
      await page.locator(".settings-payment-paging button").last().click();
      await expect(page.locator(".settings-payments")).toContainText("Year plan");
      expect(state.pageReads).toEqual([1, 2]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/settings-preview/${config.name}-payments.png`, fullPage: true });
    });
    test("notification channels are grouped and required security alerts stay enabled", async ({ page }) => {
      await server(page, config.locale);
      await page.goto("/#/settings?section=notifications");
      await expect(page.locator(".settings-notification-category")).toHaveCount(2);
      const switches = page.locator(".settings-notification-category").first().getByRole("switch");
      await expect(switches.first()).toHaveAttribute("aria-checked", "true");
      await switches.first().click();
      await expect(switches.first()).toHaveAttribute("aria-checked", "false");
      await expect(page.locator(".settings-notification-category").last().getByRole("switch")).toBeDisabled();
      await expect(page.locator("#settings-reminder").getByRole("switch")).toHaveAttribute("aria-checked", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/settings-preview/${config.name}-notifications.png`, fullPage: true });
    });
    test("privacy exports data without opening deletion and security accepts an email change request", async ({ page }) => {
      const state = await server(page, config.locale);
      await page.goto("/#/settings?section=privacy");
      await expect(page.locator("#settings-deletion-form")).toHaveCount(0);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: config.locale === "ar" ? /تنزيل نسخة من بياناتك/ : /Download a copy of your data/ }).click();
      expect((await download).suggestedFilename()).toBe("lockin-personal-data.json");
      await expect(page.locator("#settings-deletion-form")).toHaveCount(0);
      await page.goto("/#/settings?section=security");
      const email = page.locator("#settings-email");
      await email.locator('input[type="email"]').fill("new@example.test");
      await email.locator('input[type="password"]').fill("synthetic-password");
      await email.getByRole("button").click();
      await expect(email.getByRole("status")).toBeVisible();
      expect(state.emails).toEqual([{ new_email: "new@example.test", current_password: "synthetic-password" }]);
      await expect(email.locator('input[type="password"]')).toHaveValue("");
    });
  });
}

test("a desktop-mode iPad changes only its current session illustration", async ({ page }) => {
  await server(page, "ar");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  });
  await page.goto("/#/settings?section=devices");
  await expect(page.locator('.settings-device.is-current [data-device-type="tablet"]')).toHaveCount(1);
  await expect(page.locator('[data-device-type="computer"]')).toHaveCount(1);
});


test("deletion links open privacy and consume confirmation only once", async ({ page }) => {
  const state = await server(page, "ar");
  await page.goto("/#/settings?section=account&token=synthetic-confirmation");
  await expect(page.locator("#settings-privacy")).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await expect(page.locator("#settings-deletion-form")).toBeVisible();
  expect(state.confirmations).toBe(1);
  await page.reload();
  await expect(page.locator("#settings-privacy")).toBeVisible();
  expect(state.confirmations).toBe(1);
});

test("payment history can retry a failed read without depending on catalogue availability", async ({ page }) => {
  const state = await server(page, "en");
  let fails = true;
  await page.route("**/api/v1/payments?*", async route => {
    if (fails) { fails = false; return route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Temporarily unavailable" } } }); }
    await route.fallback();
  });
  await page.goto("/#/settings?section=billing");
  const history = page.locator(".settings-payments");
  await expect(history.getByRole("button")).toBeVisible();
  await history.getByRole("button").click();
  await expect(history.locator(".settings-payment")).toHaveCount(1);
  expect(state.pageReads).toEqual([1]);
  await expect(page.locator("#settings-billing")).not.toContainText("No active plan");
});

test("choosing an app icon stays local and survives reloading settings", async ({ page }) => {
  const state = await server(page, "en");
  await page.goto("/#/settings?section=app-icon");
  const options = page.locator("#settings-app-icon").getByRole("radio");
  await options.last().click();
  await expect(options.last()).toHaveAttribute("aria-checked", "true");
  expect(state.profileWrites).toEqual([]);
  await page.reload();
  await expect(options.last()).toHaveAttribute("aria-checked", "true");
  expect(state.profileWrites).toEqual([]);
});
