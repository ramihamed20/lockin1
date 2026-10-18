import { expect, test } from "@playwright/test";
import { studentSession } from "../e2e/fixtures/productionApi.js";

// The dashboard reads each section on its own; holding every summary read and
// the review queue keeps the whole page pending until the test releases it.
const HELD_READS = ["/api/v1/learning/dashboard", "/api/v1/review-bank", "/api/v1/progression/xp", "/api/v1/progression/streak", "/api/v1/review-queue"];

async function holdDashboardReads(page) {
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  let release;
  let requested = false;
  const pending = new Promise((done) => { release = done; });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/$/, "");
    if (!HELD_READS.includes(path)) return route.fallback();
    requested = true;
    await pending;
    if (!page.isClosed()) await route.fallback();
  });
  return { release: () => release(), requested: () => requested };
}

test("study navigation remains usable while dashboard statistics are pending", async ({ page }) => {
  const held = await holdDashboardReads(page);
  try {
    await page.goto("/#/dashboard");
    await expect.poll(held.requested).toBe(true);
    await expect(page.locator(".continue-card").getByRole("link", { name: "Browse materials" })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".dash-states")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".dash-state-value")).toHaveText(["—", "—", "—", "—", "—"]);
    await expect(page.locator(".dashboard-review-queue")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByText("Nice work.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No recent mistakes", { exact: true })).toHaveCount(0);
    await page.locator(".continue-card").getByRole("link", { name: "Browse materials" }).click();
    await expect(page.getByRole("link", { name: /Synthetic Subject 1\b/ }).first()).toBeVisible();
  } finally { held.release(); }
});

const mistake = { id: "synthetic-mistake", prompt: "Synthetic current-account mistake", subject_key: "synthetic-subject", subject_label: "Synthetic Subject" };

test("pending statistics become fresh values when the held request resolves", async ({ page }) => {
  const held = await holdDashboardReads(page);
  await page.route("**/api/v1/review-queue", (route) => route.fulfill({ json: { count: 1, results: [mistake] } }));
  try {
    await page.goto("/#/dashboard");
    await expect.poll(held.requested).toBe(true);
    await expect(page.locator(".dash-states")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".dash-state-value")).toHaveText(["—", "—", "—", "—", "—"]);
    held.release();
    await expect(page.locator(".dash-states")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".dash-state-value").nth(3)).toHaveText("14");
    await expect(page.locator(".dash-state-value").nth(4)).toHaveText("8");
    await expect(page.locator(".review-queue-item")).toContainText(mistake.prompt);
    await expect(page.locator(".dashboard-review-queue h2")).toHaveText("Latest mistakes");
  } finally { held.release(); }
});

test("a failed review panel never claims an empty queue and can retry", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  let fail = true;
  await page.route("**/api/v1/review-queue", (route) => fail
    ? route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Synthetic review unavailable" } } })
    : route.fulfill({ json: { count: 1, results: [mistake] } }));
  await page.goto("/#/dashboard");
  const queue = page.locator(".dashboard-review-queue");
  await expect(queue.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.locator(".continue-card a")).toBeVisible();
  await expect(page.getByText("Nice work.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No recent mistakes", { exact: true })).toHaveCount(0);
  fail = false;
  await queue.getByRole("button", { name: "Try again" }).click();
  await expect(queue.locator(".review-queue-item")).toContainText(mistake.prompt);
  await expect(queue.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("all dashboard data failing keeps each section's own error recovery", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  let fail = true;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (fail && ["/api/v1/learning/dashboard", "/api/v1/review-queue", "/api/v1/review-bank"].includes(path)) {
      return route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Synthetic dashboard unavailable" } } });
    }
    return route.continue();
  });
  await page.goto("/#/dashboard");
  const summaryError = page.locator(".dashboard-summary-error");
  const queue = page.locator(".dashboard-review-queue");
  await expect(summaryError).toContainText("Some progress numbers are temporarily unavailable.");
  await expect(queue).toContainText("Latest mistakes could not be loaded. Try again here.");
  // Continue stays usable while the numbers and mistakes are unavailable.
  await expect(page.locator(".continue-card a")).toBeVisible();
  fail = false;
  await summaryError.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(summaryError).toHaveCount(0);
  await expect(page.locator(".dash-state-value").nth(3)).toHaveText("14");
  await queue.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(queue.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

for (const profile of [
  { name: "Arabic phone", viewport: { width: 390, height: 844 }, locale: "ar" },
  { name: "English tablet", viewport: { width: 834, height: 1194 }, locale: "en" }
]) {
  test.describe(profile.name, () => {
    test.use({ viewport: profile.viewport, hasTouch: true, reducedMotion: "reduce" });
    test("pending dashboard has usable keyboard navigation and no horizontal overflow", async ({ page }) => {
      const held = await holdDashboardReads(page);
      await page.addInitScript((locale) => localStorage.setItem("lock-in.locale", locale), profile.locale);
      await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { user: studentSession({ id: "perf-navigation", preferred_language: profile.locale }) } }));
      try {
        await page.goto("/#/dashboard");
        await expect.poll(held.requested).toBe(true);
        const link = page.locator('.continue-card a[href="#/materials"]');
        await expect(link).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("dir", profile.locale === "ar" ? "rtl" : "ltr");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
        await link.focus();
        await expect(link).toBeFocused();
        await link.press("Enter");
        await expect(page.getByRole("link", { name: /Synthetic Subject 1\b/ }).first()).toBeVisible();
      } finally { held.release(); }
    });
  });
}


// The streak read is shared with the navigation rail (deduplicated per user),
// so it is not cancelled when the dashboard unmounts and is not counted here.
test("leaving Dashboard cancels its four private pending reads and returning loads fresh values", async ({ page }) => {
  const paths = ["/api/v1/learning/dashboard", "/api/v1/review-queue", "/api/v1/review-bank", "/api/v1/progression/xp"];
  await page.addInitScript((paths) => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    const nativeFetch = window.fetch.bind(window);
    window.__dashboardReadRequests = [];
    window.fetch = (input, options) => {
      const path = new URL(typeof input === "string" ? input : input.url, location.origin).pathname;
      if (paths.includes(path)) {
        const record = { path, aborted: Boolean(options?.signal?.aborted) };
        window.__dashboardReadRequests.push(record);
        options?.signal?.addEventListener("abort", () => { record.aborted = true; }, { once: true });
      }
      return nativeFetch(input, options);
    };
  }, paths);
  const cancelledPaths = new Set();
  page.on("requestfailed", (request) => {
    const path = new URL(request.url()).pathname;
    if (paths.includes(path) && /abort|cancel/i.test(request.failure()?.errorText || "")) cancelledPaths.add(path);
  });
  let release;
  const held = new Promise((done) => { release = done; });
  let blocking = true;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (blocking && paths.includes(path)) await held;
    try { await route.continue(); } catch (error) { if (!/closed|abort|cancel|invalid interception/i.test(error.message)) throw error; }
  });
  try {
    await page.goto("/#/dashboard");
    await expect.poll(() => page.evaluate(() => window.__dashboardReadRequests.length)).toBe(4);
    await page.locator('.continue-card a[href="#/materials"]').click();
    await expect(page.getByRole("link", { name: /Synthetic Subject 1\b/ }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__dashboardReadRequests.filter((read) => read.aborted).length), { timeout: 2000 }).toBe(4);
    blocking = false;
    release();
    await expect.poll(() => cancelledPaths.size).toBe(4);
    await page.locator('a[href="#/"]:visible').first().click();
    await expect(page.locator(".dash-states")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".dash-state-value").nth(3)).toHaveText("14");
    await expect(page.locator(".dash-state-value").nth(4)).toHaveText("8");
    await expect(page.locator(".dashboard-review-queue")).toHaveAttribute("aria-busy", "false");
  } finally { blocking = false; release(); }
});
