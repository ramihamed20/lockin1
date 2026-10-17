import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

test.use({ serviceWorkers: "block" });

async function setup(page, { legacy = false, language = "en" } = {}) {
  const calls = [];
  const pdf = await readFile(new URL("./fixtures/pdf/sheet-41.pdf", import.meta.url));
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/e2e-fixtures/pdf/**", (route) => route.fulfill({ contentType: "application/pdf", body: pdf }));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path === "/api/v1/auth/session") return json({ user: studentSession({ preferred_language: language }) });
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: "test-token" });
    if (path === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/focus/lock-in") return json({ active_session: null });
    if (path === "/api/v1/catalog/materials") return json({ results: [], count: 0 });
    if (path.startsWith("/api/v1/focus/managed-active-study/sheets/")) return json({ sheet_id: "e2e-vitamin-1", enabled: true, difficulties: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, status: "ready", number_of_parts: 8, page_ranges: [{ part: 1, start_page: 2, end_page: 6 }], progress: null, completed: false, customization_available: !legacy, eligible_study_pages: 40 })) });
    if (path === "/api/v1/focus/managed-active-study/start") {
      const body = route.request().postDataJSON();
      calls.push(body);
      const custom = body.study_mode === "custom";
      return json({ resumed: false, run: { id: "synthetic-run", sheet_id: "e2e-vitamin-1", difficulty: body.difficulty, study_mode: body.study_mode, status: "active", stage: "reading", current_part: 1, number_of_parts: custom ? 14 : 8, current_page_range: { part: 1, start_page: 2, end_page: custom ? 4 : 6 }, completed_parts: [], pages_per_checkpoint: body.pages_per_checkpoint, questions_per_checkpoint: body.questions_per_checkpoint || 15 } }, 201);
    }
    return json({ count: 0, results: [], error: { code: "not_found", message: "Synthetic fixture" } }, 404);
  });
  await page.goto("/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace");
  return calls;
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 820 }]) {
  test(`custom pages and question count gate the reader at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const calls = await setup(page);
    const dialog = page.getByRole("dialog", { name: "Choose study mode" });
    await dialog.getByRole("button", { name: "Customize", exact: true }).click();
    await dialog.getByLabel("Pages per test", { exact: true }).fill("3");
    const count = dialog.getByLabel("Questions (up to 20)", { exact: true });
    await count.fill("21");
    await expect(dialog.getByRole("button", { name: "Start Active Study", exact: true })).toBeDisabled();
    await count.fill("5");
    await page.screenshot({ path: `/tmp/active-custom-${viewport.width}.png` });
    await dialog.getByRole("button", { name: "Start Active Study", exact: true }).click();
    await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 4", { timeout: 20_000 });
    expect(calls[0]).toMatchObject({ study_mode: "custom", pages_per_checkpoint: 3, questions_per_checkpoint: 5 });
    await expect(page.locator('.workspace-v2-a4-page[data-pdf-page="5"]')).toHaveCount(0);
  });
}

test("legacy sheets retain the standard start without customization", async ({ page }) => {
  const calls = await setup(page, { legacy: true });
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog.getByRole("button", { name: "Customize", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Start Active Study", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].study_mode).toBe("standard");
  expect(calls[0].pages_per_checkpoint).toBeUndefined();
});

test("Arabic customization fields remain inside the phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, { language: "ar" });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "تخصيص", exact: true }).click();
  await expect(dialog.getByLabel("صفحات لكل اختبار", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/active-custom-ar.png" });
});
