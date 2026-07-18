import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const admin = {
  id: "91000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  full_name: "Rami Operator",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student", "administrator"],
  date_joined: "2026-07-01T00:00:00Z"
};

const operationalSession = {
  roles: ["platform_administrator"],
  capabilities: [
    "overview.view", "content.view", "content.manage", "assessments.view", "assessments.manage",
    "users.view", "users.manage", "operational_actions.execute", "operational_roles.manage",
    "audit.view", "reports.export", "configuration.view", "configuration.manage", "system_health.view"
  ],
  dashboards: ["overview", "content", "support"],
  timezone: "UTC"
};

const managedUser = {
  id: "92000000-0000-4000-8000-000000000001",
  email: "student@example.com",
  full_name: "Rami Student",
  status: "active",
  email_verified: true,
  product_roles: ["student"],
  operational_roles: [],
  date_joined: "2026-07-10T00:00:00Z"
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/auth/session")) await json({ user: admin });
    else if (path.endsWith("/auth/csrf")) await json({ csrf_token: "phase9-csrf" });
    else if (path === "/api/v1/notifications/summary") await json({ unread_count: 2 });
    else if (path === "/api/v1/operations/session") await json(operationalSession);
    else if (path === "/api/v1/operations/dashboards/overview") await json({
      generated_at: "2026-07-18T12:00:00Z",
      period: { from: "2026-07-05", to: "2026-07-18", timezone: "UTC" },
      analytics_freshness: "2026-07-18T11:58:00Z",
      metrics: { daily_active_learners: 420, lesson_completions: 880, quiz_submissions: 310, focus_minutes: 9400, subscriptions_started: 24 },
      subscriptions: { active: 380, trialing: 42, grace: 3 },
      queues: { moderation: 7, failed_payments: 3, failed_notifications: 1 },
      resources: [
        { code: "users", label: "User management", path: "/operations/users" },
        { code: "content", label: "Content studio", path: "/management/content" },
        { code: "audit", label: "Audit history", path: "/operations/audit" }
      ]
    });
    else if (path === "/api/v1/operations/system-health") await json({
      status: "ok",
      checked_at: "2026-07-18T12:00:00Z",
      components: [
        { code: "application", status: "ok" },
        { code: "database", status: "ok" },
        { code: "analytics_projection", status: "ok", freshness: "2026-07-18T11:58:00Z" },
        { code: "metrics_provider", status: "not_configured" }
      ]
    });
    else if (path === "/api/v1/operations/users") await json({ count: 1, next: null, previous: null, results: [managedUser] });
    else if (path === "/api/v1/operations/actions/previews") await json({
      id: "93000000-0000-4000-8000-000000000001",
      action_code: "users.set_status",
      reason: "Review a safety report",
      status: "previewed",
      preview: { target_count: 1, changes: [{ user_id: managedUser.id, full_name: managedUser.full_name, from_status: "active", to_status: "suspended", will_change: true }] },
      confirmation_token: "safe-confirmation-token"
    }, 201);
    else if (path === "/api/v1/operations/actions/93000000-0000-4000-8000-000000000001/execute") await json({
      id: "93000000-0000-4000-8000-000000000001",
      action_code: "users.set_status",
      reason: "Review a safety report",
      status: "completed",
      preview: {},
      result_summary: { requested: 1, succeeded: 1, failed: 0, failures: [] }
    });
    else await json({ error: { code: "not_found", message: "Not found." } }, 404);
  });
});

test("operations overview is accessible, responsive, and RTL-safe", async ({ page }, testInfo) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Platform operations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning activity" })).toBeVisible();
  await expect(page.getByText("420")).toBeVisible();
  await expect(page.getByText("not configured")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "العربية" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "تشغيل المنصة" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.screenshot({ path: testInfo.outputPath("operations-overview.png"), fullPage: true });
});

test("dangerous account actions stay previewed until explicit confirmation", async ({ page }) => {
  await page.goto("/operations/users");
  await page.getByRole("button", { name: /Rami Student/ }).click();
  await page.getByLabel(/Reason for this action/).fill("Review a safety report");
  await page.getByRole("button", { name: "Preview action" }).click();
  await expect(page.getByRole("heading", { name: "Review before applying" })).toBeVisible();
  await expect(page.getByText(/active → suspended/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm action" }).click();
  await expect(page.getByText("The operational action completed.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
