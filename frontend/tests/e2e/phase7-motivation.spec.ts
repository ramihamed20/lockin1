import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "e2e-student",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: "2026-07-18T00:00:00Z"
};

const achievement = {
  code: "first_step",
  category: "learning",
  icon_key: "path",
  title: "First step",
  description: "Complete your first lesson.",
  current_value: 1,
  target_value: 1,
  earned_at: "2026-07-18T00:00:00Z"
};

const ranking = {
  definition: {
    code: "learning_all_time",
    title: "Learning progress",
    period: "all_time",
    tie_strategy: "competition",
    rules: { summary: "Only verified learning evidence counts." }
  },
  snapshot: {
    id: "snapshot-1",
    generated_at: "2026-07-18T00:00:00Z",
    participant_count: 2,
    checksum: "abc"
  },
  entries: [
    { position: 1, score: 650, evidence_count: 8, display_name: "Rami Student", is_me: true },
    { position: 2, score: 500, evidence_count: 6, display_name: "M. L.", is_me: false }
  ],
  own_entry: {
    position: 1,
    score: 650,
    evidence_count: 8,
    display_name: "Rami Student",
    is_me: true
  }
};

const notification = {
  id: "71000000-0000-4000-8000-000000000001",
  category: "community",
  template_key: "community.reply",
  title: "New reply in your discussion",
  body: "A learner replied in a study discussion you follow.",
  data: {},
  actor_name: "Maya Student",
  target_type: "discussion",
  has_target: true,
  read_at: null,
  created_at: "2026-07-18T00:00:00Z"
};

const preferences = [
  { category: "account", channel: "in_app", enabled: true, required: true, available: true },
  { category: "community", channel: "in_app", enabled: true, required: false, available: true },
  { category: "community", channel: "email", enabled: true, required: false, available: false }
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/auth/session")) await json({ user });
    else if (path.endsWith("/auth/csrf")) await json({ csrf_token: "e2e-csrf" });
    else if (path === "/api/v1/notifications/summary") await json({ unread_count: 1 });
    else if (path === "/api/v1/progression/xp") {
      await json({
        total_points: 650,
        ranking_points: 600,
        transaction_count: 8,
        level: 2,
        level_progress: 150,
        level_target: 500,
        last_awarded_at: "2026-07-18T00:00:00Z"
      });
    } else if (path === "/api/v1/progression/streak") {
      await json({
        current_days: 3,
        longest_days: 5,
        last_qualified_on: "2026-07-18",
        freeze_tokens_available: 0,
        policy: {
          title: "Meaningful learning days",
          version: 1,
          qualifying_activity_types: ["lesson.completed"],
          grace_days: 0,
          freeze_tokens_enabled: false
        }
      });
    } else if (path === "/api/v1/progression/achievements") await json([achievement]);
    else if (path === "/api/v1/progression/rankings/current") await json(ranking);
    else if (path === "/api/v1/progression/rankings/profile") {
      await json({ included: true, display_mode: "initials", updated_at: "2026-07-18T00:00:00Z" });
    } else if (path === "/api/v1/notifications") {
      await json({ next: null, previous: null, results: [notification] });
    } else if (path === "/api/v1/notifications/preferences") await json(preferences);
    else if (path === "/api/v1/notifications/read-all") await json({ updated: 1 });
    else if (path.endsWith(`/notifications/${notification.id}/open`)) {
      await json({ route: "/progression" });
    } else {
      await json({ error: { code: "not_found", message: "Not found." } }, 404);
    }
  });
});

test("learning momentum is calm, accessible, responsive, and RTL-safe", async ({ page }, testInfo) => {
  await page.goto("/progression");
  await expect(page.getByRole("heading", { name: "Your learning momentum" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "First step" })).toBeVisible();
  await expect(page.locator(".momentum-card--xp p")).toContainText("650");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  if (testInfo.project.name.includes("mobile")) {
    await page.evaluate(() => localStorage.setItem("lockin.locale", "ar"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.screenshot({ path: testInfo.outputPath("progression.png"), fullPage: true });
});

test("notification center exposes useful actions and required preferences", async ({ page }, testInfo) => {
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText(notification.title)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Account and security/ })).toBeDisabled();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("0 unread")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("notifications.png"), fullPage: true });
});
