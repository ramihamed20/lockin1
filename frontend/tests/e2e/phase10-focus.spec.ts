import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const documentVersionId = "a0000000-0000-4000-8000-000000000010";
const documentId = "a0000000-0000-4000-8000-000000000011";
const fileId = "a0000000-0000-4000-8000-000000000012";
const sessionId = "a0000000-0000-4000-8000-000000000013";
const timestamp = "2026-07-18T12:00:00Z";

const user = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: timestamp
};

function workspace(revision = 1) {
  return {
    session_id: sessionId,
    document_id: documentId,
    document_version_id: documentVersionId,
    file_id: fileId,
    current_page: 1,
    page_count: 1,
    zoom: "1.00",
    sidebar: "closed",
    active_tool: "",
    layout: {},
    open_tabs: [documentVersionId],
    revision,
    updated_at: timestamp
  };
}

function session() {
  return {
    id: sessionId,
    context_type: "study",
    context_id: documentVersionId,
    status: "active",
    started_at: timestamp,
    last_activity_at: timestamp,
    ended_at: null,
    active_duration_seconds: 0,
    revision: 1,
    workspace: workspace()
  };
}

function onePagePdf(): string {
  const content = "BT\n/F1 18 Tf\n72 720 Td\n(Focus workspace study page) Tj\nET\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  return `${pdf}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/auth/session")) await json({ user });
    else if (path.endsWith("/auth/csrf")) await json({ csrf_token: "phase10-csrf" });
    else if (path === `/api/v1/focus/documents/${documentVersionId}` && request.method() === "GET") {
      await json({
        document: {
          document_id: documentId,
          document_version_id: documentVersionId,
          file_id: fileId,
          title: "Cranial anatomy study guide",
          language: "en",
          view_url: `/api/v1/files/${fileId}/view`,
          size_bytes: 1024,
          checksum_sha256: "a".repeat(64),
          page_count: 1
        },
        latest_workspace: null,
        annotation_revision: 0
      });
    } else if (path === "/api/v1/focus/sessions" && request.method() === "POST") {
      await json(session(), 201);
    } else if (path === `/api/v1/focus/documents/${documentVersionId}/annotations` && request.method() === "GET") {
      await json({ collection_revision: 0, results: [] });
    } else if (path === `/api/v1/focus/sessions/${sessionId}/workspace` && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      await json({ ...workspace(2), ...body, session_id: sessionId, document_id: documentId, document_version_id: documentVersionId, file_id: fileId, revision: 2, updated_at: timestamp });
    } else if (path === `/api/v1/focus/documents/${documentVersionId}/annotations` && request.method() === "POST") {
      const body = request.postDataJSON() as { annotations: Array<Record<string, unknown>>; deleted_ids: string[] };
      await json({
        collection_revision: 1,
        annotations: body.annotations.map((annotation) => ({ ...annotation, revision: 1, created_at: timestamp, updated_at: timestamp })),
        deleted_ids: body.deleted_ids
      });
    } else if (path.startsWith(`/api/v1/focus/sessions/${sessionId}/`) && request.method() === "POST") {
      await json(session());
    } else if (path === `/api/v1/files/${fileId}/view`) {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: onePagePdf() });
    } else {
      await json({ error: { code: "not_found", message: "Not found." } }, 404);
    }
  });
});

test("Focus workspace renders a real PDF and autosaves a contextual note", async ({ page }, testInfo) => {
  await page.goto(`/focus/${documentVersionId}`);
  await expect(page.getByRole("heading", { name: "Cranial anatomy study guide" })).toBeVisible();
  await expect(page.getByLabel("Page 1")).toBeVisible();
  await expect(page.locator(".focus-pdf-page canvas")).toBeVisible();

  await page.getByRole("button", { name: "Sticky note" }).click();
  const annotationSync = page.waitForResponse((response) =>
    response.url().includes(`/focus/documents/${documentVersionId}/annotations`) &&
    response.request().method() === "POST"
  );
  await page.locator(".focus-annotation-layer").click({ position: { x: 120, y: 140 } });
  await annotationSync;
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Notes" }).getByRole("textbox")).toHaveValue("New note");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("focus-workspace.png"), fullPage: true });
});

test("Focus workspace remains usable on mobile RTL without covering the document", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-specific responsive and RTL evidence.");
  await page.addInitScript(() => localStorage.setItem("lockin.locale", "ar"));
  await page.goto(`/focus/${documentVersionId}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "Cranial anatomy study guide" })).toBeVisible();
  await page.getByRole("button", { name: "الملاحظات", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "الملاحظات" });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => element.getBoundingClientRect().width < window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("focus-workspace-mobile-rtl.png"), fullPage: true });
});
