import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

test.use({ serviceWorkers: "block" });

test("focus and visibility share an access check, and a later return checks again", async ({ page }) => {
  await mockStudentApi(page);
  let calls = 0;
  let fail = false;
  let release;
  let gate = Promise.resolve();
  await page.route("**/api/v1/subscriptions/current", async (route) => {
    calls += 1;
    await gate;
    await route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(fail
      ? { error: { code: "unavailable", message: "Retry later" } }
      : { subscription: { id: "s", status: "active", access_allowed: true, expires_at: "2999-01-01T00:00:00Z" } }) });
  });
  await page.goto("/#/");
  await expect(page.locator(".dashboard")).toBeVisible();
  const burst = () => page.evaluate(() => {
    for (let count = 0; count < 5; count += 1) {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  for (const failing of [false, true, false]) {
    const before = calls;
    fail = failing;
    gate = new Promise((resolve) => { release = resolve; });
    await burst();
    await expect.poll(() => calls).toBeGreaterThan(before);
    // A browser task boundary lets all handlers enqueue their fetches.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(calls - before).toBe(1);
    const response = page.waitForResponse((result) => result.url().endsWith("/subscriptions/current"));
    release();
    await response;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
});
