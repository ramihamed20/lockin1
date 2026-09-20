import { expect, test } from "@playwright/test";

/**
 * Admin analytics scoped University -> Specialty -> Year.
 *
 * The filters send node ids and the server answers with totals for that scope;
 * the page never sums anything itself. These tests hold the request each
 * choice makes and the empty state an empty scope gets.
 */

const ZAWIYA = "0b7e7f7a-0000-4000-8000-000000000001";
const TRIPOLI = "0b7e7f7a-0000-4000-8000-000000000002";
const ZAWIYA_DENTISTRY = "0b7e7f7a-0000-4000-8000-000000000011";
const ZAWIYA_MEDICINE = "0b7e7f7a-0000-4000-8000-000000000012";
const ZAWIYA_DENTISTRY_Y2 = "0b7e7f7a-0000-4000-8000-000000000021";

const DASHBOARD = {
  period: { from: "2026-08-20", to: "2026-09-18" },
  users: { total: 0 },
  learning: {
    active_learners: 0,
    focus_sessions: 0,
    completion_rate: 0,
    material_completions: 0,
    focus_activity: [],
    quiz_attempts: 0,
    exam_attempts: 0,
    average_score: null,
    pass_rate: null,
    most_used_materials: [],
    most_active_subjects: []
  },
  revenue: { net_minor: 0, paying_users: 0, gross_minor: 0, refund_total_minor: 0, average_order_minor: 0, failed_payments: 0 },
  subscriptions: { churn_rate: null, renewals: 0, active: 0, trial: 0, expired: 0, cancelled: 0 }
};

function metrics(overrides = {}) {
  return {
    students: 6, active_students: 4, universities: 3, specialties: 5, years: 8, subjects: 40, sheets: 5,
    published_questions: 5, question_answers: 6, correct_answers: 4, incorrect_answers: 2, accuracy: 66.7,
    xp_awarded: 20, active_subscriptions: 1, trial_subscriptions: 1, ...overrides
  };
}

function scopeResponse(params) {
  const university = params.get("university");
  const specialty = params.get("specialty");
  const year = params.get("year");
  const universities = [{ id: TRIPOLI, title: "Tripoli" }, { id: ZAWIYA, title: "Zawiya" }];
  const specialties = university === ZAWIYA ? [{ id: ZAWIYA_DENTISTRY, title: "Dentistry" }, { id: ZAWIYA_MEDICINE, title: "Medicine" }] : [];
  const years = specialty === ZAWIYA_DENTISTRY ? [{ id: ZAWIYA_DENTISTRY_Y2, title: "Second Year" }] : [];
  const pick = (list, id) => list.find((item) => item.id === id) || null;
  const scope = { university: pick(universities, university), specialty: pick(specialties, specialty), year: pick(years, year) };
  if (year) return { scope: { level: "year", ...scope }, options: { universities, specialties, years }, metrics: metrics({ students: 2 }), active_window_days: 30, breakdown: { level: null, rows: [] } };
  if (specialty === ZAWIYA_MEDICINE) return { scope: { level: "specialty", ...scope }, options: { universities, specialties, years }, metrics: metrics({ students: 0, active_students: 0, subjects: 0, sheets: 0, published_questions: 0, question_answers: 0, correct_answers: 0, incorrect_answers: 0, accuracy: null, xp_awarded: 0 }), active_window_days: 30, breakdown: { level: "year", rows: [] } };
  if (specialty) return { scope: { level: "specialty", ...scope }, options: { universities, specialties, years }, metrics: metrics({ students: 3 }), active_window_days: 30, breakdown: { level: "year", rows: [{ id: ZAWIYA_DENTISTRY_Y2, title: "Second Year", students: 2, subjects: 7, sheets: 1, published_questions: 1, question_answers: 2, accuracy: 50 }] } };
  if (university) return { scope: { level: "university", ...scope }, options: { universities, specialties, years }, metrics: metrics({ students: 4 }), active_window_days: 30, breakdown: { level: "specialty", rows: [{ id: ZAWIYA_DENTISTRY, title: "Dentistry", students: 3, subjects: 13, sheets: 2, published_questions: 2, question_answers: 3, accuracy: 66.7 }, { id: ZAWIYA_MEDICINE, title: "Medicine", students: 1, subjects: 1, sheets: 1, published_questions: 1, question_answers: 1, accuracy: 100 }] } };
  return { scope: { level: "overall", university: null, specialty: null, year: null }, options: { universities, specialties, years }, metrics: metrics(), active_window_days: 30, breakdown: { level: "university", rows: [{ id: TRIPOLI, title: "Tripoli", students: 1, subjects: 20, sheets: 1, published_questions: 1, question_answers: 1, accuracy: 100 }, { id: ZAWIYA, title: "Zawiya", students: 4, subjects: 20, sheets: 3, published_questions: 3, question_answers: 4, accuracy: 75 }] } };
}

async function mockOperator(page, requests) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/session") return json({ user: { id: "scope-operator", email: "scope@example.test", full_name: "Scope Operator", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student", "administrator"], date_joined: "2026-01-01T00:00:00Z" } });
    if (url.pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (url.pathname === "/api/v1/operations/session") return json({ roles: ["administrator"], capabilities: ["overview.view", "analytics.view"], dashboards: ["overview"], timezone: "UTC" });
    if (url.pathname === "/api/v1/operations/admin/analytics/dashboard") return json(DASHBOARD);
    if (url.pathname === "/api/v1/operations/admin/analytics/scope") {
      requests.push(Object.fromEntries(url.searchParams));
      return json(scopeResponse(url.searchParams));
    }
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
}

test("the admin drills from Overall to one University, Specialty and Year", async ({ page }) => {
  const requests = [];
  await mockOperator(page, requests);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/operations/admin/analytics");

  const panel = page.locator(".scope-analytics");
  await expect(panel.getByText("Overall · every university")).toBeVisible();
  await expect(panel.locator(".creator-metric", { hasText: "Students" }).getByText("6", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Zawiya/ })).toBeVisible();
  expect(requests[0]).toEqual({});

  await panel.getByRole("combobox", { name: "University", exact: true }).selectOption(ZAWIYA);
  await expect(panel.locator(".creator-panel-heading span").first()).toHaveText("Zawiya");
  await expect.poll(() => requests.at(-1)).toEqual({ university: ZAWIYA });

  // Clicking a breakdown row applies that specialty inside the same university.
  await panel.getByRole("button", { name: /Dentistry/ }).click();
  await expect(panel.getByText("Zawiya → Dentistry")).toBeVisible();
  await expect.poll(() => requests.at(-1)).toEqual({ university: ZAWIYA, specialty: ZAWIYA_DENTISTRY });

  await panel.getByRole("combobox", { name: "Year", exact: true }).selectOption(ZAWIYA_DENTISTRY_Y2);
  await expect(panel.getByText("Zawiya → Dentistry → Second Year")).toBeVisible();
  await expect.poll(() => requests.at(-1)).toEqual({ university: ZAWIYA, specialty: ZAWIYA_DENTISTRY, year: ZAWIYA_DENTISTRY_Y2 });

  // A new university clears the specialty and year beneath it.
  await panel.getByRole("combobox", { name: "University", exact: true }).selectOption(TRIPOLI);
  await expect.poll(() => requests.at(-1)).toEqual({ university: TRIPOLI });
  await panel.getByRole("combobox", { name: "Scope", exact: true }).selectOption("overall");
  await expect(panel.getByText("Overall · every university")).toBeVisible();
  await expect.poll(() => requests.at(-1)).toEqual({});
});

test("an empty scope shows an empty state, not a wall of zeros", async ({ page }) => {
  await mockOperator(page, []);
  await page.goto("/#/operations/admin/analytics");
  const panel = page.locator(".scope-analytics");
  await panel.getByRole("combobox", { name: "University", exact: true }).selectOption(ZAWIYA);
  await panel.getByRole("combobox", { name: "Specialty", exact: true }).selectOption(ZAWIYA_MEDICINE);
  await expect(panel.getByText("No data in this scope yet")).toBeVisible();
});

for (const [name, width, height] of [["phone", 390, 844], ["ipad-portrait", 820, 1180], ["ipad-landscape", 1180, 820]]) {
  test(`scope analytics fits the ${name} viewport`, async ({ page }, testInfo) => {
    await mockOperator(page, []);
    await page.setViewportSize({ width, height });
    await page.goto("/#/operations/admin/analytics");
    const panel = page.locator(".scope-analytics");
    await panel.getByRole("combobox", { name: "University", exact: true }).selectOption(ZAWIYA);
    await expect(panel.getByRole("button", { name: /Medicine/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`scope-analytics-${name}.png`), fullPage: true });
  });
}
