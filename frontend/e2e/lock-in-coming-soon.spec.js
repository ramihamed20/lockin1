import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

async function connect(page) {
  let lockInRequests = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession() });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "coming-soon-csrf" });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (pathname === "/api/v1/focus/lock-in/availability") return json({ enabled: false });
    if (pathname.startsWith("/api/v1/focus/lock-in")) lockInRequests += 1;
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  return () => lockInRequests;
}


for (const path of ["/lock-in"]) {
  test(`${path} shows Coming Soon instead of the lobby or a session`, async ({ page }) => {
    const lockInRequests = await connect(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#${path}`);
    await expect(page.locator('.feature-coming-soon[data-feature-id="lock-in"]')).toBeVisible();
    await expect(page.locator(".lm-shell")).toHaveCount(0);
    expect(lockInRequests()).toBe(0);
  });
}
