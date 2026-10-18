import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const live = process.env.LOCKIN_LIVE_KNOWLEDGE === "1";
const fixture = live ? JSON.parse(readFileSync("../output/knowledge/live-fixture.json", "utf8")) : {};
test.skip(!live, "Requires the isolated Django learning lab; no API mocks. Database engine is recorded separately.");

// Summary, Map and Explain open from the toolbar Study launcher.
async function openStudyTool(page, tool = "summary") {
  await page.locator("[data-workspace-surface=\"study\"]").click();
  await page.locator(`[data-study-tool="${tool}"]`).click();
}

async function login(page, email = fixture.email) {
  await page.goto("/");
  const csrf = await page.request.get("/api/v1/auth/csrf");
  expect(csrf.status()).toBe(200);
  const response = await page.request.post("/api/v1/auth/login", {
    headers: { "X-CSRFToken": (await csrf.json()).csrf_token },
    data: { email, password: "Lock-in-test-pass-2026" },
  });
  expect(response.status()).toBe(200);
  await page.evaluate(() => localStorage.setItem("lock-in.locale", "en"));
  await page.goto(fixture.route);
  await page.reload();
  expect((await page.request.get("/api/v1/auth/session")).status()).toBe(200);
  const normal = page.getByRole("button", { name: /^Normal Study/ });
  await expect(page.locator("[data-workspace-surface=\"study\"]")).toBeEnabled({ timeout: 30000 });
  await expect(normal).toBeVisible({ timeout: 30000 });
  await normal.click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 30000 });
  await openStudyTool(page);
  return page.getByRole("dialog", { name: "Study tools", exact: true });
}
test("real session, database saves, offline recovery, explanation and second-account isolation", async ({ page, context }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await login(page);
  await panel.getByRole("button", { name: "Start my summary", exact: true }).click();
  const text = `Live Arabic / فكرة ${Date.now()}`;
  await panel.getByLabel("In your own words").fill(text);
  await panel.getByRole("button", { name: "Sync now", exact: true }).click();
  const bootstrap = () => page.request.get(`/api/v1/knowledge/documents/${fixture.documentId}`).then((r) => r.json());
  // The document picker is hidden while there is only one document, so read its id from the server.
  let noteId = "";
  await expect.poll(async () => { noteId = (await bootstrap()).artifacts.find((item) => item.kind === "summary" && !item.deleted)?.id || ""; return noteId; }).not.toBe("");
  await panel.getByRole("button", { name: "Map Builder", exact: true }).click();
  await panel.getByRole("button", { name: "Start my map", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Add concept", exact: true })).toBeVisible();
  const mapTitle = `Live map ${noteId}`;
  await panel.getByLabel("Title", { exact: true }).fill(mapTitle);
  await panel.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(panel.getByLabel("Your explanation", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "My Summary", exact: true }).click();
  await context.setOffline(true);
  await panel.getByLabel("In your own words").fill(text + " offline");
  await expect(panel.getByRole("status").filter({ hasText: "Saved on this device" }).first()).toBeVisible();
  await panel.getByRole("button", { name: "Map Builder", exact: true }).click();
  await panel.getByRole("button", { name: "Add concept", exact: true }).click();
  await panel.locator(".knowledge-map-node").last().click();
  await panel.getByRole("combobox", { name: "Link to a sheet concept", exact: true }).selectOption(fixture.conceptId);
  await panel.getByRole("button", { name: "My Summary", exact: true }).click();
  await expect(panel.getByLabel("In your own words")).toHaveValue(text + " offline");
  await context.setOffline(false);
  await panel.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Saved to your account" }).first()).toBeVisible({ timeout: 45000 });
  const index = await bootstrap();
  const note = index.artifacts.find((item) => item.id === noteId);
  const detail = await page.request.get(`/api/v1/knowledge/documents/${fixture.documentId}/artifacts/${note.id}`);
  expect((await detail.json()).content.text).toBe(text + " offline");
  await panel.getByRole("button", { name: "My Knowledge", exact: true }).click();
  await panel.getByRole("button", { name: mapTitle, exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "Link to a sheet concept", exact: true })).toHaveValue(fixture.conceptId);
  const canvas = panel.locator(".knowledge-map-scroll");
  await canvas.evaluate((element) => { element.scrollLeft = 190; });
  await panel.getByRole("button", { name: "My Summary", exact: true }).click();
  await panel.getByRole("button", { name: "Map Builder", exact: true }).click();
  await expect.poll(() => canvas.evaluate((element) => element.scrollLeft)).toBe(190);
  await panel.getByRole("button", { name: "Explain", exact: true }).click();
  await panel.getByLabel("Your explanation", { exact: true }).fill("An explanation / شرح");
  await panel.getByRole("button", { name: "Save answer and review criteria" }).click();
  await expect(panel.getByText("Prepared source answer.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Normal Study/ }).click();
  await openStudyTool(page, "explain");
  await expect(page.getByRole("dialog", { name: "Study tools" }).getByLabel("Your explanation", { exact: true })).toHaveValue("An explanation / شرح");
  const unfinished = "Unfinished answer / مسودة بعد تسجيل الخروج";
  await page.getByRole("dialog", { name: "Study tools" }).getByLabel("Your explanation", { exact: true }).fill(unfinished);
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device" }).first()).toBeVisible();
  const csrf = await page.request.get("/api/v1/auth/csrf");
  await page.request.post("/api/v1/auth/logout", { headers: { "X-CSRFToken": (await csrf.json()).csrf_token }, data: {} });
  const second = await login(page, fixture.secondEmail);
  await second.getByRole("button", { name: "My Summary", exact: true }).click();
  await expect(second.getByLabel("In your own words")).toHaveCount(0);
  expect((await bootstrap()).artifacts).toEqual([]);
  const again = await login(page);
  await again.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(again.getByLabel("Your explanation", { exact: true })).toHaveValue(unfinished);
});

test("atomic IndexedDB rejects simultaneous edits without Web Locks", async ({ page, context }) => {
  test.setTimeout(90000);
  await login(page);
  const userId = fixture.userId;
  const result = await page.evaluate(async (id) => {
    const { offlineDatabase } = await import("/src/offline/database.js");
    const check = () => {};
    const key = "learning-lab-atomic-race";
    await offlineDatabase.delete(id, key);
    const update = (previous) => {
      if (previous) throw Object.assign(new Error("conflict"), { code: "knowledge_conflict" });
      return { revision: 1 };
    };
    const saved = await Promise.allSettled([
      offlineDatabase.updateScoped(id, key, update, check),
      offlineDatabase.updateScoped(id, key, update, check),
    ]);
    return saved.map((item) => item.status);
  }, userId);
  expect(result.sort()).toEqual(["fulfilled", "rejected"]);
  const other = await context.newPage();
  await other.goto(fixture.route);
  await other.close();
});

test("a resumed real MCQ mistake opens its verified prepared explanation", async ({ page }) => {
  test.setTimeout(90000);
  const panel = await login(page);
  await page.locator("[data-workspace-surface=\"study\"]").click();
  await page.locator("[data-study-action=\"mode\"]").click();
  await page.getByRole("button", { name: /Start Active Study|Resume Active Study/ }).click();
  await expect(page.locator(".workspace-v2-checkpoint-button")).toBeEnabled({ timeout: 20000 });
  await page.locator(".workspace-v2-checkpoint-button").click();
  const link = page.locator(".workspace-v2-quiz-result button").filter({ hasText: /Explain this concept|Explain concept/ });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Your explanation", { exact: true })).toBeVisible();
  await expect(panel.getByText("Explain the sheet concept.", { exact: true })).toBeVisible();
});
