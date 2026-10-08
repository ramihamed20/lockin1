import { expect, test } from "@playwright/test";

// Route mocks cannot intercept a service-worker-owned fetch in WebKit. PWA
// behavior is covered by its dedicated specs; these tests exercise admin UI.
test.use({ serviceWorkers: "block" });

const USER = { id: "queue-student", full_name: "Alice Student", email: "alice@example.test", username: "alice" };
const PAYMENT = {
  id: "00000000-0000-4000-8000-000000000101", user: USER, status: "pending", method: "libyana",
  amount_minor: 10000, currency: "LYD", currency_exponent: 3, plan_title: "Monthly plan",
  created_at: "2026-10-01T12:00:00Z", manual_submission: { status: "pending", submitted_at: "2026-10-01T12:00:00Z" }
};
const SUBSCRIPTION = {
  id: "00000000-0000-4000-8000-000000000102", user: USER, status: "active", plan_title: "Monthly plan",
  current_period_ends_at: "2026-11-01T12:00:00Z", remaining_days: 27, payment_verification: "verified"
};

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

async function mockQueues(page, { area = "purchases", locale = "en", initial = null, refresh = null, recordCount = 1 } = {}) {
  // Installation has its own tests. A touch browser's launch dialog would
  // otherwise keep the administration controls inert during this scenario.
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  const queries = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (url.pathname === "/api/v1/auth/session") return json({ user: { ...USER, id: "queue-admin", roles: ["student", "administrator"], status: "active", is_email_verified: true, preferred_language: locale } });
    if (url.pathname === "/api/v1/auth/csrf") return json({ csrf_token: "test-csrf" });
    if (url.pathname === "/api/v1/operations/session") return json({ roles: ["administrator"], capabilities: ["overview.view", "payments.view", "subscriptions.view"], dashboards: ["overview"], timezone: "Africa/Tripoli" });
    if (url.pathname === "/api/v1/operations/admin/analytics/dashboard") return json({ manual_reviews: { pending: 1, approved: 0, rejected: 0 }, revenue: { gross_minor: 0 }, subscriptions: { active: 1, trial: 0, upcoming_expirations: 0, expired: 0 } });
    if (url.pathname === `/api/v1/operations/admin/${area}`) {
      const query = url.searchParams.get("q") || "";
      queries.push(query);
      if (!query && initial) await initial.promise;
      if (query && refresh) await refresh.promise;
      const record = area === "purchases" ? PAYMENT : SUBSCRIPTION;
      return json({ count: recordCount, next: null, previous: null, results: Array.from({ length: recordCount }, (_, index) => ({ ...record, id: `${record.id.slice(0, -3)}${String(index + 101).padStart(3, "0")}` })) });
    }
    if (url.pathname.startsWith(`/api/v1/operations/admin/${area}/`)) return json(area === "purchases" ? PAYMENT : SUBSCRIPTION);
    return json({ count: 0, next: null, previous: null, results: [] });
  });
  return queries;
}

for (const area of ["purchases", "subscriptions"]) {
  test(`${area} opens long-queue details in view and restores the selected row`, async ({ page }) => {
    await mockQueues(page, { area, recordCount: 25 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/operations/admin/${area}`);
    const student = page.getByRole("button", { name: /Alice Student/ }).first();
    await student.click();
    const detail = page.getByRole("region", { name: area === "purchases" ? "Payment detail" : "Subscription detail" });
    await expect(detail).toBeInViewport();
    await expect(detail).toBeFocused();
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await expect(detail).toHaveCount(0);
    await expect(student).toBeFocused();
    await expect(student).toBeInViewport();
  });
}

for (const [name, width, height, locale] of [
  ["narrow-phone", 320, 720, "en"], ["phone-rtl", 390, 844, "ar"],
  ["landscape-phone", 844, 390, "en"], ["ipad-portrait", 820, 1180, "en"],
  ["ipad-landscape", 1180, 820, "en"], ["desktop", 1440, 1000, "en"]
]) {
  test(`admin queue loading and records fit ${name}`, async ({ page }, testInfo) => {
    const initial = gate();
    await mockQueues(page, { initial, locale });
    await page.setViewportSize({ width, height });
    await page.goto("/#/operations/admin/purchases");
    const skeleton = page.locator(".ops-queue-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeVisible();
    if (width <= 820) expect((await page.locator(".ops-search").boundingBox()).height).toBeLessThan(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    initial.release();
    const student = page.getByRole("button", { name: /Alice Student/ });
    await expect(student).toBeVisible();
    await expect(student).toBeEnabled();
    await expect(skeleton).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await student.focus();
    await expect(student).toBeFocused();
    const box = await student.boundingBox();
    if (width <= 820) expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`queue-${name}.png`), fullPage: true });
  });
}

for (const area of ["purchases", "subscriptions"]) {
  test(`${area} keeps rows and focus while a debounced search refreshes`, async ({ page }) => {
    await page.clock.install();
    const refresh = gate();
    const queries = await mockQueues(page, { area, refresh });
    await page.goto(`/#/operations/admin/${area}`);
    const student = page.getByRole("button", { name: /Alice Student/ });
    await expect(student).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search", exact: true });
    // Wall-clock scheduling under load can legitimately exceed the debounce
    // between keystrokes. Freeze app time to test one uninterrupted burst.
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    await search.pressSequentially("alice", { delay: 20 });
    await page.clock.runFor(300);
    await expect.poll(() => queries).toEqual(["", "alice"]);
    await expect(student).toBeVisible();
    await expect(student).toBeDisabled();
    await expect(search).toBeFocused();
    await expect(page.locator(".ops-queue-skeleton")).toHaveCount(0);
    await expect(page.locator(".ops-table-panel")).toHaveAttribute("aria-busy", "true");
    refresh.release();
    await expect(student).toBeEnabled();
    await expect(search).toBeFocused();
  });
}
