import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { signE2eLease } from "./fixtures/offlineLease.js";

/**
 * Offline Active Study through the real workspace UI.
 *
 * "Offline" here means the Lock-in server is unreachable: every API request
 * fails at the network level, which is exactly what the app sees in Airplane
 * Mode. The fixture PDF stays reachable because this build serves it as a
 * static file rather than as a downloaded blob.
 */

const USER_ID = "offline-e2e-student";
const SHEET_ID = "e2e-vitamin-1";
const WORKSPACE_ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const PDF_ITEM = "doc-offline-e2e:sheet";
const FILE_ID = "5b1f8a1e-4c2d-4e6f-8a9b-0c1d2e3f4a5b";
const RANGES = [
  { part: 1, start_page: 1, end_page: 10 },
  { part: 2, start_page: 11, end_page: 20 },
  { part: 3, start_page: 21, end_page: 30 },
  { part: 4, start_page: 31, end_page: 41 }
];

function bundle() {
  const question = (label) => ({ question: `Which vitamin is fat-soluble (${label})?`, options: { A: "Vitamin C", B: "Vitamin K" }, correct_answer: "B", explanation: "Vitamin K is fat-soluble." });
  return {
    sheet_id: SHEET_ID,
    edition: "university",
    content_version: "e2e-as-1",
    total_pdf_pages: 41,
    rules: { checkpoint_pass: 1, final_pass: 1 },
    availability: {
      sheet_id: SHEET_ID,
      enabled: true,
      difficulties: ["easy", "medium", "hard"].map((difficulty) => ({
        difficulty, status: difficulty === "medium" ? "ready" : "not_configured",
        number_of_parts: difficulty === "medium" ? 4 : 0, page_ranges: difficulty === "medium" ? RANGES : [], progress: null, completed: false
      }))
    },
    difficulties: {
      medium: {
        number_of_parts: 4,
        page_ranges: RANGES,
        parts: RANGES.map(({ part }) => ({ part, questions: [question(`part ${part}`)] })),
        final_exam: { questions: [question("final")] }
      }
    }
  };
}

async function mockServer(page, state) {
  const pdf = await readFile(new URL("./fixtures/pdf/sheet-41.pdf", import.meta.url));
  const checksum = createHash("sha256").update(pdf).digest("hex");
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    if (state.serverDown) return route.abort("internetdisconnected");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: USER_ID, email: "offline@example.test", full_name: "Offline Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "offline-csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/focus/lock-in" && method === "GET") return json({ active_session: null });
    if (pathname === "/api/v1/offline/lease/") return json({ lease: signE2eLease(USER_ID) });
    if (pathname === "/api/v1/offline/manifest/") {
      return json({
        version: 1,
        subjects: [{ id: "subject-biochemistry", title: "Biochemistry 1", material_slug: "biochemistry-1", cohort: "y1", program: "dds" }],
        items: [
          { id: PDF_ITEM, type: "sheet", document_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", document_version_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", material_slug: "biochemistry-1", sheet_slug: "vitamin-1", subject_id: "subject-biochemistry", sheet_id: SHEET_ID, edition: "university", title: "Vitamin -1", version: 1, updated_at: null, size: pdf.length, checksum, download_url: `/api/v1/files/${FILE_ID}/view`, dependencies: [], available: true },
          { id: `active_study:${SHEET_ID}:university`, type: "active_study", subject_id: "subject-biochemistry", sheet_id: SHEET_ID, material_slug: "biochemistry-1", sheet_slug: "vitamin-1", edition: "university", title: "Vitamin -1", version: "e2e-as-1", updated_at: null, size: null, checksum: "e2e-as-1", download_url: `/api/v1/offline/active-study/${SHEET_ID}/?edition=university`, dependencies: [PDF_ITEM], available: true }
        ]
      });
    }
    if (pathname === `/api/v1/files/${FILE_ID}/view`) return route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    if (pathname === `/api/v1/offline/active-study/${SHEET_ID}/`) return json(bundle());
    if (pathname === "/api/v1/offline/review/") return json({ bank: { active_count: 0, mastered_this_week: 0, subjects: [] }, queue: { count: 0, results: [] }, subjects: {}, weekly: { available: false, session: null }, answer_keys: {}, version: "e2e" });
    if (pathname === "/api/v1/catalog/materials" || pathname === "/api/v1/catalog/questions") return json({ count: 0, results: [] });
    if (pathname.startsWith("/api/v1/focus/managed-active-study/sheets/")) return json(bundle().availability);
    if (pathname === "/api/v1/offline/sync/" && method === "POST") {
      const body = request.postDataJSON();
      state.synced.push(...body.operations);
      const run = { id: "server-run-1", sheet_id: SHEET_ID, difficulty: "medium", status: "active", stage: "reading", current_part: 2, number_of_parts: 4, current_page_range: RANGES[1], completed_parts: [1], checkpoint_attempts: 1, final_attempts: 0, last_score: 1, last_outcome: "passed", xp_awarded: 0 };
      return json({ accepted: body.operations.map((operation) => ({ operation_id: operation.operation_id, result: { status: "applied", run, result: { score: 1, total: 1, passed: true, completed: false, xp_awarded: 0 } } })), rejected: [], xp_total: 10 });
    }
    return json({ error: { code: "not_found", message: "Not used by the offline test" } }, 404);
  });
}

test("Active Study downloads, runs a checkpoint with the server unreachable and syncs it once on reconnect", async ({ page }) => {
  test.setTimeout(120_000);
  const state = { serverDown: false, synced: [] };
  await mockServer(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1-4. Online: the subscription is verified and the complete bundle is downloaded.
  // Settings shows one section at a time at every width, so open Offline Mode
  // directly, the way the section list does.
  await page.goto("/#/settings?section=offline");
  const offlineSection = page.locator("#settings-offline");
  await expect(offlineSection.getByText("Offline access available")).toBeVisible({ timeout: 20_000 });
  await offlineSection.getByRole("button", { name: "Manage Downloads" }).click();
  await offlineSection.getByRole("button", { name: "Download University Sheet" }).click();
  await expect(offlineSection.getByRole("button", { name: /University Sheet · ✓ Available Offline/ })).toBeVisible({ timeout: 20_000 });

  await page.goto(WORKSPACE_ROUTE);
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  // 5. The Lock-in server becomes unreachable.
  state.serverDown = true;
  await dialog.getByRole("button", { name: /Start Active Study/ }).click();
  const indicator = page.locator(".workspace-v2-page-number");
  // 9. A first run starts at page one with only Part 1 unlocked.
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 1 of 10", { timeout: 20_000 });
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(10);

  // 10. Read to the end of Part 1.
  await indicator.click();
  const pageInput = page.locator(".workspace-v2-page-navigator input[type='number']");
  await pageInput.fill("10");
  await pageInput.press("Enter");
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 10 of 10");
  // The reading position is captured when the test opens, so let the smooth
  // jump come to rest first (as the online unlock spec does).
  const stage = page.locator(".workspace-v2-document-stage");
  let readingTop = -1;
  await expect.poll(async () => {
    const top = await stage.evaluate((node) => node.scrollTop);
    const settled = top === readingTop && top > 1000;
    readingTop = top;
    return settled;
  }).toBe(true);

  // 11. The checkpoint opens from the dock, graded from the downloaded bundle.
  await page.getByRole("button", { name: "Open checkpoint" }).click();
  const quiz = page.getByRole("dialog", { name: /Which vitamin/ });
  await quiz.getByRole("radio", { name: /Vitamin K/ }).click();
  await quiz.getByRole("button", { name: "Submit test" }).click();
  await page.getByRole("dialog", { name: "1 / 1" }).getByRole("button", { name: "Continue studying" }).click();

  // 12-13. Part 2 unlocks below; earlier pages stay; the reader does not return to page one.
  await expect(page.getByRole("button", { name: "Active Study: part 2 of 4" })).toBeVisible();
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(20);
  await expect(page.locator('.workspace-v2-a4-page[data-pdf-page="1"]')).toHaveCount(1);
  await expect(page.locator('.workspace-v2-a4-page[data-pdf-page="21"]')).toHaveCount(0);
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 10 of 20");
  await expect.poll(async () => Math.abs(await stage.evaluate((node) => node.scrollTop) - readingTop)).toBeLessThan(4);
  expect(state.synced).toHaveLength(0);

  // 21-25. The connection returns; the attempt syncs without any action, once.
  state.serverDown = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => state.synced.length, { timeout: 20_000 }).toBe(1);
  const [attempt] = state.synced;
  expect(attempt.operation_type).toBe("active_study_attempt");
  expect(attempt.payload).toMatchObject({ sheet_id: SHEET_ID, edition: "university", difficulty: "medium", kind: "checkpoint", part: 1, answers: [{ position: 1, selected_answer: "B" }] });
  expect(attempt.payload.xp_awarded).toBeUndefined();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1_500);
  expect(state.synced).toHaveLength(1);
  // The reader is still on Part 2 after the authoritative run is adopted.
  await expect(page.getByRole("button", { name: "Active Study: part 2 of 4" })).toBeVisible();
});
