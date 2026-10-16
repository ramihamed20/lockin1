import { expect, test } from "@playwright/test";

async function holdOperations(page) {
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  let release, requested = false;
  const pending = new Promise((done) => { release = done; });
  await page.route("**/api/v1/operations/session", async (route) => {
    requested = true;
    await pending;
    if (!page.isClosed()) await route.fulfill({ status: 403, json: { error: { code: "permission_denied", message: "Synthetic student" } } });
  });
  return { release: () => release(), requested: () => requested };
}

test("confirmed student routes render while operational capabilities are still pending", async ({ page }) => {
  const held = await holdOperations(page);
  try {
    await page.goto("/#/dashboard");
    await expect.poll(held.requested).toBe(true);
    // A held response makes this a sequencing assertion, not an absolute speed budget.
    await expect(page.locator(".dashboard")).toBeVisible({ timeout: 10000 });
  } finally { held.release(); }
});

test("pending or denied capabilities never start privileged route requests", async ({ page }) => {
  const held = await holdOperations(page);
  let privilegedRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/v1/operations/admin/")) privilegedRequests++; });
  try {
    await page.goto("/#/operations/admin/overview");
    await expect.poll(held.requested).toBe(true);
    expect(privilegedRequests).toBe(0);
    held.release();
    await expect(page.getByText("Access unavailable", { exact: true })).toBeVisible({ timeout: 10000 });
    expect(privilegedRequests).toBe(0);
  } finally { held.release(); }
});
