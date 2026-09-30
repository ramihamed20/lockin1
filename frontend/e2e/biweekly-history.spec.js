import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const now = new Date();
const end = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
const start = new Date(Date.parse(end) - 14 * 24 * 60 * 60 * 1000).toISOString();
const history = [
  {
    id: "report-two", report_type: "analysis",
    period_start: "2026-10-13T00:00:00Z", period_end: "2026-10-27T00:00:00Z",
    generated_at: "2026-10-27T01:00:00Z",
    summary: { questions_answered: 20, accuracy: 80 }
  },
  {
    id: "report-one", report_type: "analysis",
    period_start: "2026-09-29T00:00:00Z", period_end: "2026-10-13T00:00:00Z",
    generated_at: "2026-10-13T01:00:00Z",
    summary: { questions_answered: 12, accuracy: 75 }
  }
];

async function mockApi(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      return route.fulfill({ json: { user: {
        id: "biweekly-student", email: "student@example.test", full_name: "Student",
        preferred_language: "en", status: "active", is_email_verified: true,
        roles: ["student"], date_joined: "2026-01-01T00:00:00Z"
      } } });
    }
    if (pathname === "/api/v1/auth/csrf") return route.fulfill({ json: { csrf_token: "test" } });
    if (pathname === "/api/v1/operations/session") {
      return route.fulfill({ status: 403, json: { error: { code: "permission_denied" } } });
    }
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/biweekly/analysis") {
      return route.fulfill({ json: {
        current_period: { period_start: start, period_end: end, next_report_at: end },
        history
      } });
    }
    if (pathname === "/api/v1/biweekly/review") {
      return route.fulfill({ json: {
        current_period: { period_start: start, period_end: end, next_report_at: end },
        history: history.map((report, index) => ({
          ...report, report_type: "review", summary: { mistake_count: index ? 27 : 32 }
        }))
      } });
    }
    if (pathname === "/api/v1/review-bank") {
      return route.fulfill({ json: { active_count: 0, mastered_this_week: 0, subjects: [] } });
    }
    if (pathname === "/api/v1/review-queue") {
      return route.fulfill({ json: { count: 0, results: [] } });
    }
    if (pathname === "/api/v1/weekly-recall") {
      return route.fulfill({ json: { available: false, eligible_count: 0, session: null } });
    }
    return route.fulfill({ status: 404, json: { error: { message: "Not found" } } });
  });
}

test("Analysis keeps multiple reports visible with View and Download actions", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#/analysis");
  await expect(page.getByText(/Next report in 6 days/i)).toBeVisible();
  const rows = page.locator(".biweekly-history-row");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".biweekly-month h3")).toHaveText("October 2026");
  await expect(rows.nth(0).getByRole("link", { name: "View" })).toHaveAttribute("href", "#/analysis/report-two");
  await expect(rows.nth(1).getByRole("link", { name: /Download PDF/i }))
    .toHaveAttribute("href", "/api/v1/biweekly/analysis/report-one/pdf");
});

test("Review keeps older mistake packs downloadable", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#/review");
  const rows = page.locator(".biweekly-history-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("32 mistakes");
  await expect(rows.nth(1).getByRole("link", { name: /Download PDF/i }))
    .toHaveAttribute("href", "/api/v1/biweekly/review/report-one/pdf");
});

test("Analysis history scrolls without horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/#/analysis");
  await expect(page.locator(".biweekly-history-row")).toHaveCount(2);
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
