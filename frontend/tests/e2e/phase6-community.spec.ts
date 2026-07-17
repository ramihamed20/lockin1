import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "e2e-moderator",
  email: "moderator@example.com",
  full_name: "Mona Moderator",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student", "moderator"],
  date_joined: "2026-07-17T00:00:00Z"
};
const discussionId = "61000000-0000-4000-8000-000000000001";
const commentId = "62000000-0000-4000-8000-000000000001";
const reportId = "63000000-0000-4000-8000-000000000001";
const author = { id: "student-author", full_name: "Maya Student", badges: ["creator"] };
const discussion = {
  id: discussionId,
  author,
  space_id: null,
  space_title: null,
  context_type: "lesson",
  context_id: "lesson-1",
  context_title: "Cranial nerves",
  context_route: "/learn/nodes/lesson-1",
  title: "How does the facial nerve pathway connect clinically?",
  body: "I understand the origin but need help connecting the pathway to the clinical finding.",
  status: "active",
  revision: 1,
  comment_count: 1,
  last_activity_at: "2026-07-17T10:00:00Z",
  created_at: "2026-07-17T10:00:00Z",
  updated_at: "2026-07-17T10:00:00Z",
  can_edit: false,
  can_delete: false
};
const comment = {
  id: commentId,
  discussion_id: discussionId,
  parent_id: null,
  author: { id: "student-helper", full_name: "Nora Student", badges: [] },
  body: "Start from the larger landmark, then trace the border before naming the structure.",
  status: "active",
  revision: 1,
  created_at: "2026-07-17T10:05:00Z",
  updated_at: "2026-07-17T10:05:00Z",
  can_edit: false,
  can_delete: false
};
const report = {
  id: reportId,
  reporter_id: "reporter-1",
  reporter_name: "Careful Student",
  target_type: "discussion",
  target_id: discussionId,
  target_label: discussion.title,
  context_type: "lesson",
  context_id: "lesson-1",
  private_space_id: null,
  reason: "abuse",
  description: "The wording is abusive and distracts from this learning discussion.",
  status: "open",
  priority: "important",
  assigned_to_id: null,
  assigned_to_name: null,
  duplicate_of_id: null,
  resolution_notes: "",
  revision: 1,
  resolved_at: null,
  created_at: "2026-07-17T10:10:00Z",
  updated_at: "2026-07-17T10:10:00Z",
  can_manage: true,
  target_author_id: author.id,
  target_version_id: null,
  evidence_snapshot: { title: discussion.title, body: discussion.body }
};
const pageOf = <T,>(results: T[]) => ({ next: null, previous: null, results });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/session")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    } else if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrf_token: "e2e-csrf" }) });
    } else if (path === "/api/v1/community/discussions" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([discussion])) });
    } else if (path === "/api/v1/community/spaces") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([])) });
    } else if (path === `/api/v1/community/discussions/${discussionId}`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(discussion) });
    } else if (path === `/api/v1/community/discussions/${discussionId}/comments` && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([comment])) });
    } else if (path === `/api/v1/community/discussions/${discussionId}/comments` && request.method() === "POST") {
      const created = { ...comment, id: "62000000-0000-4000-8000-000000000002", author: { id: user.id, full_name: user.full_name, badges: ["moderator"] }, body: "Follow the landmark before naming the branch.", can_edit: true, can_delete: true };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    } else if (path === "/api/v1/moderation/reports" && request.method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...report, evidence_snapshot: undefined, can_manage: false }) });
    } else if (path === "/api/v1/moderation/reports" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([report])) });
    } else if (path === "/api/v1/moderation/audit") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([])) });
    } else if (path === `/api/v1/moderation/reports/${reportId}/transition`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...report, status: "resolved", revision: 2, resolution_notes: "Confirmed after independent review." }) });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }) });
    }
  });
});

test("contextual community feed is accessible, responsive, and RTL-safe", async ({ page }, testInfo) => {
  await page.goto("/community");
  await expect(page.getByRole("heading", { name: "Questions grounded in what you study." })).toBeVisible();
  await expect(page.getByRole("link", { name: discussion.title })).toHaveAttribute("href", `/community/discussions/${discussionId}`);
  await expect(page.getByRole("button", { name: "Ask about this" })).toHaveCount(0);
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
  await page.screenshot({ path: testInfo.outputPath("community-feed.png"), fullPage: true });
});

test("discussion replies and reports remain attached to learning content", async ({ page }) => {
  await page.goto(`/community/discussions/${discussionId}`);
  await expect(page.getByRole("heading", { name: discussion.title })).toBeVisible();
  await page.getByLabel("Add a useful explanation").fill("Follow the landmark before naming the branch.");
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(page.getByText("Follow the landmark before naming the branch.")).toBeVisible();
  await page.getByRole("button", { name: "Report" }).first().click();
  await page.getByLabel("Explain the issue").first().fill("This discussion contains abusive language that needs review.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Your report was recorded for independent review.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("moderation preserves evidence and records a server-authoritative decision", async ({ page }, testInfo) => {
  await page.goto("/moderation");
  await expect(page.getByText("Evidence captured when reported")).toBeVisible();
  await page.getByLabel("Decision").selectOption("resolved");
  await page.getByLabel("Content action").selectOption("remove");
  await page.getByLabel("Review notes").fill("Confirmed abuse after reviewing the preserved discussion evidence.");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("resolved", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("moderation-workspace.png"), fullPage: true });
});
