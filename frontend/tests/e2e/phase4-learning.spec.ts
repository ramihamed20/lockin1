import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "e2e-user",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: "2026-07-15T00:00:00Z"
};

const node = {
  id: "node-1",
  parent_id: null,
  kind: "subject",
  title: "Oral anatomy",
  slug: "oral-anatomy",
  description: "Build a durable foundation.",
  position: 0,
  path: "node-1",
  depth: 0,
  status: "published",
  is_discoverable: true,
  revision: 1,
  updated_at: "2026-07-15"
};

const version = {
  id: "version-1",
  version_number: 1,
  academic_node_id: "node-1",
  academic_node_title: "Oral anatomy",
  content_type: "pdf",
  title: "Cranial landmarks",
  summary: "Study the key structures.",
  language: "en",
  allow_download: false,
  metadata: {},
  available_from: null,
  available_until: null,
  assets: [{ id: "asset-1", file_id: "file-1", role: "primary", position: 0, original_name: "lesson.pdf", content_type: "application/pdf", size_bytes: 100, view_url: "/api/v1/files/file-1/view", download_url: null }],
  focus_context: { context_type: "study", context_id: "version-1" },
  created_at: "2026-07-15"
};

const learningObject = { id: "content-1", version, published_at: "2026-07-15", is_bookmarked: false, progress: null };
const pageOf = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/auth/session")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    } else if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrf_token: "e2e-csrf" }) });
    } else if (path === "/api/v1/learning/dashboard") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ next_item: null, bookmark_count: 1, completed_count: 2, recent_content: [], review_due: [] }) });
    } else if (path === "/api/v1/education/nodes") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([node])) });
    } else if (path === "/api/v1/search") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([{ resource_kind: "learning_object", resource_id: "content-1", content_type: "pdf", title: "Cranial landmarks", summary: "Study the key structures.", language: "en", published_at: "2026-07-15" }])) });
    } else if (path === "/api/v1/learning-objects/content-1") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(learningObject) });
    } else if (path === "/api/v1/bookmarks" && request.method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    } else if (path === "/api/v1/progress/learning-objects/content-1" && request.method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "completed", completion_percent: 100, position: { page: 1 }, revision: 1 }) });
    } else if (path === "/api/v1/files/file-1/view") {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }) });
    }
  });
});

test("student search stays accessible and fluid across responsive layouts", async ({ page }, testInfo) => {
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "What will you master next?" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Oral anatomy/ })).toHaveAttribute("href", "/learn/nodes/node-1");

  await page.getByLabel("Search learning").fill("cranial");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: /Cranial landmarks/ })).toHaveAttribute("href", "/learn/content/content-1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("learning-search.png"), fullPage: true });
});

test("a learning object preserves the private file boundary and saves progress", async ({ page }, testInfo) => {
  await page.goto("/learn/content/content-1");
  await expect(page.getByRole("heading", { name: "Cranial landmarks" })).toBeVisible();
  await expect(page.locator("object.pdf-frame")).toHaveAttribute("data", "/api/v1/files/file-1/view");
  await expect(page.getByText("The publisher limited this item to in-app study.")).toBeVisible();

  await page.getByRole("button", { name: "Save for later" }).click();
  await expect(page.getByRole("button", { name: "Remove bookmark" })).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByRole("status")).toHaveText("Your study progress is saved.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("learning-object.png"), fullPage: true });
});
