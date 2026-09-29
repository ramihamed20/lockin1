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
const QUESTION_ITEM = `questions:${SHEET_ID}:ai-sheet`;
const FILE_ID = "5b1f8a1e-4c2d-4e6f-8a9b-0c1d2e3f4a5b";
const RANGES = [
  { part: 1, start_page: 1, end_page: 10 },
  { part: 2, start_page: 11, end_page: 20 },
  { part: 3, start_page: 21, end_page: 30 },
  { part: 4, start_page: 31, end_page: 41 }
];

const normalQuestion = {
  id: "normal-true-false-1", question_type: "true_false", prompt: "Vitamin K is fat-soluble.",
  topic: "Vitamins", difficulty: "easy", xp_value: 5, source_page: null, answer: null,
  choices: [{ id: "normal-true", text: "True", position: 0 }, { id: "normal-false", text: "False", position: 1 }]
};

function bundle(questionType = "mcq") {
  const question = (label) => questionType === "true_false"
    ? { type: "true_false", question: `Vitamin K is fat-soluble (${label}).`, correct_answer: true, explanation: "Vitamin K is fat-soluble." }
    : { question: `Which vitamin is fat-soluble (${label})?`, options: { A: "Vitamin C", B: "Vitamin K" }, correct_answer: "B", explanation: "Vitamin K is fat-soluble." };
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
    if (state.serverHangs) return undefined; // The request never answers, as on a weak signal.
    if (state.serverDown) {
      (state.offlineRequests ||= []).push(pathname);
      return route.abort("internetdisconnected");
    }
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
          { id: `active_study:${SHEET_ID}:university`, type: "active_study", subject_id: "subject-biochemistry", sheet_id: SHEET_ID, material_slug: "biochemistry-1", sheet_slug: "vitamin-1", edition: "university", title: "Vitamin -1", version: "e2e-as-1", updated_at: null, size: null, checksum: "e2e-as-1", download_url: `/api/v1/offline/active-study/${SHEET_ID}/?edition=university`, dependencies: [PDF_ITEM], available: true },
          { id: QUESTION_ITEM, type: "questions", subject_id: "subject-biochemistry", sheet_id: SHEET_ID, source: "ai-sheet", title: "AI Sheet", version: "e2e-questions-1", updated_at: null, size: null, checksum: "e2e-questions-1", download_url: `/api/v1/offline/questions/${SHEET_ID}/?source=ai-sheet`, dependencies: [], available: true }
        ]
      });
    }
    if (pathname === `/api/v1/files/${FILE_ID}/view`) return route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    if (pathname === `/api/v1/offline/active-study/${SHEET_ID}/`) return json(bundle(state.questionType));
    if (pathname === `/api/v1/offline/questions/${SHEET_ID}/`) return json({
      sheet: { id: SHEET_ID, title: "Vitamin -1", material_slug: "biochemistry-1", subject_title: "Biochemistry 1" },
      source: "ai-sheet", count: 1, content_version: "e2e-questions-1", results: [normalQuestion],
      answer_keys: { [normalQuestion.id]: { correct_choice_ids: ["normal-true"], explanation: "It is one of the fat-soluble vitamins." } }
    });
    if (pathname === "/api/v1/offline/review/") return json({ bank: { active_count: 0, mastered_this_week: 0, subjects: [] }, queue: { count: 0, results: [] }, subjects: {}, weekly: { available: false, session: null }, answer_keys: {}, version: "e2e" });
    if (pathname === "/api/v1/catalog/materials") return json({ count: 0, results: [] });
    if (pathname === "/api/v1/catalog/questions") return json(url.searchParams.get("source") === "ai-sheet" ? {
      count: 1,
      results: [{ slug: "biochemistry-1", title: "Biochemistry 1", questionCount: 1, sheets: [{ id: SHEET_ID, slug: SHEET_ID, number: 1, title: "Vitamin -1", questionCount: 1 }] }]
    } : { count: 0, results: [] });
    if (pathname.startsWith("/api/v1/focus/managed-active-study/sheets/")) return json(bundle(state.questionType).availability);
    if (pathname === "/api/v1/offline/sync/" && method === "POST") {
      const body = request.postDataJSON();
      state.synced.push(...body.operations);
      const run = { id: "server-run-1", sheet_id: SHEET_ID, difficulty: "medium", status: "active", stage: "reading", current_part: 2, number_of_parts: 4, current_page_range: RANGES[1], completed_parts: [1], checkpoint_attempts: 1, final_attempts: 0, last_score: 1, last_outcome: "passed", xp_awarded: 0 };
      return json({ accepted: body.operations.map((operation) => ({ operation_id: operation.operation_id, result: operation.operation_type === "question_answer"
        ? { question_id: operation.payload.question_id, answer: { selected_choice_ids: operation.payload.choice_ids, correct_choice_ids: ["normal-true"], is_correct: true, explanation: "It is one of the fat-soluble vitamins.", xp_awarded: 5 } }
        : { status: "applied", run, result: { score: 1, total: 1, passed: true, completed: false, xp_awarded: 0 } } })), rejected: [], xp_total: 10 });
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

/** Online: verify access and download the University Sheet with its Active Study bundle. */
async function downloadUniversitySheet(page) {
  await page.goto("/#/settings?section=offline");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15_000 });
  const offlineSection = page.locator("#settings-offline");
  await expect(offlineSection.getByText("Offline access available")).toBeVisible({ timeout: 20_000 });
  await offlineSection.getByRole("button", { name: "Manage Downloads" }).click();
  await offlineSection.getByRole("button", { name: "Download University Sheet" }).click();
  await expect(offlineSection.getByRole("button", { name: /University Sheet · ✓ Available Offline/ })).toBeVisible({ timeout: 20_000 });
}

test("a passed checkpoint keeps the next part through a reload and syncs by itself when the server answers late", async ({ page }) => {
  test.setTimeout(150_000);
  const state = { serverDown: false, synced: [] };
  await mockServer(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await downloadUniversitySheet(page);

  await page.goto(WORKSPACE_ROUTE);
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  state.serverDown = true;
  await dialog.getByRole("button", { name: /Start Active Study/ }).click();
  const indicator = page.locator(".workspace-v2-page-number");
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 1 of 10", { timeout: 20_000 });
  await indicator.click();
  const pageInput = page.locator(".workspace-v2-page-navigator input[type='number']");
  await pageInput.fill("10");
  await pageInput.press("Enter");
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 10 of 10");
  await page.getByRole("button", { name: "Open checkpoint" }).click();
  const quiz = page.getByRole("dialog", { name: /Which vitamin/ });
  await quiz.getByRole("radio", { name: /Vitamin K/ }).click();
  await quiz.getByRole("button", { name: "Submit test" }).click();
  const result = page.getByRole("dialog", { name: "1 / 1" });
  // A passed student is offered only to continue: never "Study this part again".
  await expect(result.getByRole("button", { name: "Study this part again" })).toHaveCount(0);
  await result.getByRole("button", { name: "Continue studying" }).click();
  await expect(page.getByRole("button", { name: "Active Study: part 2 of 4" })).toBeVisible();
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(20);

  // Closing and reopening the sheet keeps Part 2 unlocked, with Part 1 still
  // readable, and does not reopen the Part 1 checkpoint.
  await page.reload();
  const reopened = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(reopened).toBeVisible({ timeout: 20_000 });
  await reopened.getByRole("button", { name: /Active Study/ }).first().click();
  await expect(page.getByRole("button", { name: "Active Study: part 2 of 4" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(20);
  await expect(page.locator('.workspace-v2-a4-page[data-pdf-page="1"]')).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: /Which vitamin/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open checkpoint" })).toHaveCount(0);

  // The radio comes back before the server does: the first sync fails.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1_500);
  expect(state.synced).toHaveLength(0);
  // The server answers again. No online, focus or visibility event follows,
  // yet the saved attempt uploads by itself, exactly once.
  state.serverDown = false;
  await expect.poll(() => state.synced.length, { timeout: 30_000 }).toBe(1);
  expect(state.synced[0]).toMatchObject({ operation_type: "active_study_attempt", payload: { kind: "checkpoint", part: 1 } });
  await expect(page.getByRole("button", { name: "Active Study: part 2 of 4" })).toBeVisible();
});

test("a cold start whose requests hang opens downloaded work instead of waiting for the server", async ({ page }) => {
  test.setTimeout(120_000);
  const state = { serverDown: false, synced: [] };
  await mockServer(page, state);
  await downloadUniversitySheet(page);
  // The device reports a connection, but nothing comes back from the server.
  state.serverHangs = true;
  const started = Date.now();
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 12_000 });
  expect(Date.now() - started).toBeLessThan(15_000);
  // Reads that hang are cut short once the server is known to be unreachable,
  // so the downloaded sheet opens well before the 30 second request timeout.
  const opening = Date.now();
  await page.goto(WORKSPACE_ROUTE);
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog).toBeVisible({ timeout: 25_000 });
  expect(Date.now() - opening).toBeLessThan(20_000);
});

test("a subject download survives a cold offline PWA reload", async ({ page }) => {
  test.setTimeout(120_000);
  const state = { serverDown: false, synced: [] };
  await mockServer(page, state);
  await page.goto("/#/settings?section=offline");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15_000 });
  const offlineSection = page.locator("#settings-offline");
  await expect(offlineSection.getByText("Offline access available")).toBeVisible({ timeout: 20_000 });
  await offlineSection.getByRole("button", { name: "Download subject" }).click();
  await expect(offlineSection.getByText("Downloaded", { exact: true })).toBeVisible({ timeout: 30_000 });
  state.serverDown = true;
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator("#settings-offline")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Offline access available")).toBeVisible();
  expect(state.offlineRequests || []).not.toContain("/api/v1/auth/session");
  await page.goto(WORKSPACE_ROUTE);
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("button", { name: /Start Active Study/ }).click();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 10", { timeout: 20_000 });
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(10);
  await page.goto("/#/questions");
  await page.getByRole("link", { name: /AI Sheet/ }).click();
  await page.getByRole("link", { name: /Biochemistry 1/ }).click();
  await page.getByRole("link", { name: /Vitamin -1/ }).click();
  await page.getByRole("button", { name: "Start Questions" }).click();
  await expect(page.getByRole("heading", { name: "Vitamin K is fat-soluble." })).toBeVisible();
  await page.locator(".question-card").getByRole("button", { name: /True/ }).click();
  await page.getByRole("button", { name: "Explanation" }).click();
  await expect(page.getByText("It is one of the fat-soluble vitamins.")).toBeVisible();
  expect(state.synced).toHaveLength(0);
  await page.context().setOffline(false);
  state.serverDown = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => state.synced.length, { timeout: 20_000 }).toBe(1);
  expect(state.synced[0].operation_type).toBe("question_answer");
});

test("a downloaded True/False checkpoint answers offline and syncs its typed answer", async ({ page }) => {
  test.setTimeout(120_000);
  const state = { serverDown: false, synced: [], questionType: "true_false" };
  await mockServer(page, state);
  await page.goto("/#/settings?section=offline");
  const offlineSection = page.locator("#settings-offline");
  await expect(offlineSection.getByText("Offline access available")).toBeVisible({ timeout: 20_000 });
  await offlineSection.getByRole("button", { name: "Download subject" }).click();
  await expect(offlineSection.getByText("Downloaded", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto(WORKSPACE_ROUTE);
  state.serverDown = true;
  await page.getByRole("dialog", { name: "Choose study mode" }).getByRole("button", { name: /Start Active Study/ }).click();
  const indicator = page.locator(".workspace-v2-page-number");
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 1 of 10", { timeout: 20_000 });
  await indicator.click();
  const pageInput = page.locator(".workspace-v2-page-navigator input[type='number']");
  await pageInput.fill("10");
  await pageInput.press("Enter");
  await expect(indicator).toHaveAttribute("aria-label", "PDF page 10 of 10");
  await page.getByRole("button", { name: "Open checkpoint" }).click();
  const quiz = page.getByRole("dialog", { name: /Vitamin K is fat-soluble/ });
  await quiz.getByRole("radio", { name: "True" }).click();
  await quiz.getByRole("button", { name: "Submit test" }).click();
  await expect(page.getByRole("dialog", { name: "1 / 1" })).toBeVisible();
  state.serverDown = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => state.synced.length, { timeout: 20_000 }).toBe(1);
  expect(state.synced[0].payload.answers).toEqual([{ position: 1, selected_answer: "T" }]);
});

test("the subject download action is usable on phone, tablet, and desktop", async ({ page }) => {
  const state = { serverDown: false, synced: [] };
  await mockServer(page, state);
  await page.goto("/#/settings?section=offline");
  const action = page.locator("#settings-offline").getByRole("button", { name: "Download subject" });
  for (const width of [390, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});
