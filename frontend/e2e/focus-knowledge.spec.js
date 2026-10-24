import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const DOCUMENT = "66000000-0000-4000-8000-000000000001";
const VERSION = "66000000-0000-4000-8000-000000000002";
const FILE = "66000000-0000-4000-8000-000000000003";
const CONCEPT = "66000000-0000-4000-8000-000000000004";
const QUESTION = "66000000-0000-4000-8000-000000000005";
const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function prepare(page, arabic = false) {
  await withoutServiceWorker(page);
  await page.addInitScript((locale) => localStorage.setItem("lock-in.locale", locale), arabic ? "ar" : "en");
  const artifacts = new Map(), attempts = new Map();
  await page.route("**/e2e-fixtures/pdf/**", async (route) => route.fulfill({
    path: "e2e/fixtures/pdf/sheet-41.pdf", contentType: "application/pdf",
  }));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/session") return send({ user: studentSession({ id: "knowledge-student", preferred_language: arabic ? "ar" : "en" }) });
    if (path === "/api/v1/auth/csrf") return send({ csrf_token: "fixture-token" });
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/focus/lock-in") return send({ active_session: null });
    if (path === "/api/v1/catalog/documents/biochemistry-1/vitamin-1") return send({
      document: { id: DOCUMENT, document_version_id: VERSION, file_id: FILE, view_url: `/api/v1/files/${FILE}/view` },
    });
    if (path.startsWith("/api/v1/knowledge/documents/") && path.includes("/artifacts/")) {
      const id = path.split("/").at(-1);
      if (method === "GET") return artifacts.has(id) ? send(artifacts.get(id)) : send({ error: { code: "not_found" } }, 404);
      const body = route.request().postDataJSON();
      const record = { id, document_id: DOCUMENT, ...body, revision: (artifacts.get(id)?.revision || 0) + 1, stale: false, updated_at: new Date().toISOString() };
      artifacts.set(id, record); return send(record);
    }
    if (path.startsWith("/api/v1/knowledge/documents/") && path.includes("/attempts/")) {
      const id = path.split("/").at(-1), body = route.request().postDataJSON();
      const record = { id, ...body, evaluation_status: "self_review", feedback: { reference_answer: "Nutrients diffuse from nearby vessels.", essential_points: ["Diffusion supplies nutrients."], alternatives: [], follow_ups: ["What supplies oxygen?"] } };
      attempts.set(id, record); return send(record);
    }
    if (path === `/api/v1/knowledge/documents/${DOCUMENT}`) return send({
      enabled: true, tools: { summary: true, map: true, explain: true, ai_evaluation: false },
      source: { document_id: DOCUMENT, source_version_id: VERSION, source_file_id: FILE, edition: "university" },
      artifacts: [...artifacts.values()].map((record) => ({ ...record, content: null })), attempts: [...attempts.values()],
      questions: [{ id: QUESTION, revision: 1, concept_id: CONCEPT, difficulty: "easy", page_start: 1, page_end: 1, prompt: "Explain nutrient diffusion." }],
      concepts: [{ id: CONCEPT, title: "Nutrient diffusion", page_start: 1, page_end: 1, status: "not_practiced", verified_events: 0 }],
    });
    if (path.includes("/workspace") && method === "GET") return send({ revision: 0, state: null });
    if (path.includes("/workspace") && method === "PATCH") return send({ revision: 1, state: route.request().postDataJSON().state });
    if (path === "/api/v1/catalog/materials") return send({ materials: [] });
    return send({ error: { code: "not_found", message: "Unused fixture endpoint." } }, 404);
  });
  return { artifacts, attempts };
}

// Summary, Map and Explain open from the toolbar Study launcher.
async function openStudyTool(page, tool = "summary") {
  const study = page.locator('[data-workspace-surface="study"]:visible');
  if (await study.count()) await study.click();
  else {
    await page.locator('[data-workspace-surface="more"]:visible').click();
    await page.locator('#workspace-more-popover [data-workspace-action="study"]').click();
  }
  await page.locator(`[data-study-tool="${tool}"]`).click();
}

async function open(page, resume = false, tool = "summary") {
  if (resume) await page.reload();
  else await page.goto(ROUTE);
  const normal = page.getByRole("button", { name: /Normal Study|الدراسة العادية/ });
  if (!resume) { await expect(normal).toBeVisible({ timeout: 20000 }); await normal.click(); }
  else { await expect(page.locator("[data-workspace-surface=\"study\"]")).toBeEnabled({ timeout: 20000 }); if (await normal.isVisible()) await normal.click(); }
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workspace-surface=\"study\"]")).toBeEnabled({ timeout: 20000 });
  await openStudyTool(page, tool);
  return page.getByRole("dialog", { name: /Study tools|أدوات الدراسة/ });
}

test("summary, map, explanation and reader share a persistent optional workspace", async ({ page }) => {
  test.setTimeout(90000);
  const fixture = await prepare(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = await open(page);
  await panel.getByRole("button", { name: "Start my summary", exact: true }).click();
  await panel.getByLabel("Title", { exact: true }).fill("My page one");
  await panel.getByLabel("In your own words").fill("التغذية / Nutrients move by diffusion.");
  await expect(panel.getByRole("status").filter({ hasText: /Saved on this device|Saved to your account/ }).first()).toBeVisible();
  await panel.getByRole("button", { name: "Add selection to map" }).click();
  await expect(panel.locator(".knowledge-map-node")).toHaveText("التغذية / Nutrients move by diffusion.");
  await panel.locator(".knowledge-map-node").focus();
  await panel.locator(".knowledge-map-node").press("ArrowRight");
  await expect(panel.locator(".knowledge-map-node")).toHaveCSS("left", "70px");
  await panel.locator(".knowledge-map-node").press("Control+z");
  await expect(panel.locator(".knowledge-map-node")).toHaveCSS("left", "60px");
  await panel.getByRole("button", { name: "Recall", exact: true }).click();
  await expect(panel.locator(".knowledge-map-node")).toHaveText("…");
  await panel.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(panel.locator(".knowledge-map-node")).toHaveText("التغذية / Nutrients move by diffusion.");
  await panel.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(panel.getByText("Nutrients diffuse from nearby vessels.", { exact: true })).toHaveCount(0);
  await panel.getByLabel("Your explanation", { exact: true }).fill("Nutrients diffuse from nearby vessels.");
  await panel.getByRole("button", { name: "Save answer and review criteria" }).click();
  await expect(panel.getByText("This reference is prepared content", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Save reference points to summary" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Save reference points to summary" }).click();
  await expect(panel.getByLabel("In your own words")).toHaveValue("التغذية / Nutrients move by diffusion.");
  await expect(panel.getByText("Diffusion supplies nutrients.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Draw", exact: true }).click();
  const svg = panel.locator(".knowledge-paper-scroll svg");
  await panel.locator(".knowledge-paper-scroll").scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 80); await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160, { steps: 8 }); await page.mouse.up();
  await expect(svg.locator("path")).toHaveCount(1);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".workspace-v2-body")).not.toHaveAttribute("inert");
  await openStudyTool(page);
  await panel.getByRole("button", { name: "Type", exact: true }).click();
  await expect(panel.getByLabel("In your own words")).toHaveValue("التغذية / Nutrients move by diffusion.");
  await panel.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => [...fixture.artifacts.values()].find((record) => record.kind === "summary")?.content.strokes?.length).toBe(1);
  await page.screenshot({ path: "output/playwright/knowledge-tablet.png" });
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 320, height: 740 }, { width: 834, height: 1194 }, { width: 1440, height: 900 }]) {
  test(`study tools reflow and preserve unfinished answers at ${viewport.width}px in Arabic`, async ({ page }) => {
    test.setTimeout(90000);
    await prepare(page, true); await page.setViewportSize(viewport);
    const panel = await open(page);
    await panel.getByRole("button", { name: "اشرح", exact: true }).click();
    await panel.getByLabel("شرحك", { exact: true }).fill("مسودة لم تُرسل بعد");
    await panel.getByRole("button", { name: "ملخصي", exact: true }).click();
    await panel.getByRole("button", { name: "اشرح", exact: true }).click();
    await expect(panel.getByLabel("شرحك", { exact: true })).toHaveValue("مسودة لم تُرسل بعد");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width < 1000) await expect(panel).toHaveAttribute("aria-modal", "true");
    else await expect(panel).not.toHaveAttribute("aria-modal", "true");
    if (viewport.width === 834) {
      const answer = panel.getByLabel("شرحك", { exact: true });
      await answer.focus();
      await page.setViewportSize({ width: 1194, height: 834 });
      await expect(panel).not.toHaveAttribute("aria-modal", "true");
      await expect(answer).toBeFocused();
      await expect(answer).toHaveValue("مسودة لم تُرسل بعد");
      await page.setViewportSize(viewport);
      await expect(panel).toHaveAttribute("aria-modal", "true");
      await expect(answer).toBeFocused();
    }
    if (viewport.width === 320) {
      await expect(panel.getByRole("status").filter({ hasText: "المسودة محفوظة على هذا الجهاز" }).first()).toBeVisible();
      const resumed = await open(page, true, "explain");
      await expect(resumed.getByLabel("شرحك", { exact: true })).toHaveValue("مسودة لم تُرسل بعد");
    }
    await page.screenshot({ path: `output/playwright/knowledge-ar-${viewport.width}.png` });
  });
}


test("storage failure stays unsaved across tools and offers export and explicit discard", async ({ page }) => {
  test.setTimeout(90000);
  await prepare(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  const panel = await open(page);
  await panel.getByRole("button", { name: "Start my summary", exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (value?.record?.content?.text === "unsaved quota draft") throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, value, ...args);
    };
  });
  await panel.getByLabel("In your own words").fill("unsaved quota draft");
  await expect(panel.getByRole("status").filter({ hasText: "Not saved" }).first()).toBeVisible();
  await panel.getByRole("button", { name: "Map Builder", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Not saved" }).first()).toBeVisible();
  await panel.getByRole("button", { name: "My Summary", exact: true }).click();
  await expect(panel.getByLabel("In your own words")).toHaveValue("unsaved quota draft");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".workspace-v2-control-group.is-exit button").click();
  await expect(panel).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export work held on screen" }).click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.records.some((record) => record.content.text === "unsaved quota draft")).toBe(true);
  await panel.getByRole("button", { name: "Discard unsaved changes", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard unsaved changes", exact: true }).click();
  await expect(panel.getByLabel("In your own words")).toHaveValue("");
});

test("failed Explain draft remains unsaved and its text is included in recovery export", async ({ page }) => {
  test.setTimeout(90000);
  await prepare(page);
  const panel = await open(page);
  await panel.getByRole("button", { name: "Explain", exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (Object.values(value?.explanationDrafts || {}).includes("answer quota draft")) throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, value, ...args);
    };
  });
  await panel.getByLabel("Your explanation", { exact: true }).fill("answer quota draft");
  await expect(panel.getByRole("status").filter({ hasText: "Not saved" }).first()).toBeVisible();
  await panel.getByRole("button", { name: "My Summary", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Not saved" }).first()).toBeVisible();
  await panel.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(panel.getByLabel("Your explanation", { exact: true })).toHaveValue("answer quota draft");
  const waiting = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export work held on screen" }).click();
  const download = await waiting;
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(Object.values(backup.workspace_state.ui.explanationDrafts)).toContain("answer quota draft");
});
