import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function mockAuthenticatedWorkspace(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "tabs-student", email: "tabs@example.test", full_name: "Tabs Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by tab tests" } }) });
  });
}

// Open tabs stay mounted behind the one on screen; everything below is read
// from the reader that is showing.
const onScreen = (page, selector) => page.locator(`.workspace-pane.is-active ${selector}`);
const tabs = (page) => onScreen(page, ".workspace-v2-toolbar [role='tab']");

test("sheets and whiteboards open as tabs, each keeping its own state", async ({ page }) => {
  test.setTimeout(90_000);
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(onScreen(page, ".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["Vitamin -1"]);
  // The tools no longer carry captions; their names are tooltips.
  await expect(page.locator(".workspace-v2-tool-caption")).toHaveCount(0);
  await expect(page.locator('[data-workspace-tool="pen"]')).toHaveAttribute("title", "Pen");

  // Marks this reader, to tell later whether coming back reused it or rebuilt it.
  await onScreen(page, ".workspace-v2").evaluate((element) => { element.dataset.keepAliveProbe = "first-sheet"; });

  // Another sheet opens in a new tab and asks for its own study mode.
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /Open sheet/ }).click();
  const picker = page.getByRole("dialog", { name: "Open sheet" });
  // The picker asks for the subject first, then the sheet.
  await picker.getByRole("button", { name: /Biochemistry 1/ }).click();
  await picker.getByRole("button", { name: /Vitamin -2/ }).click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-2\/workspace$/);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Vitamin -2"]);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");

  // Returning to the first sheet skips the question it already answered.
  await tabs(page).first().click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-1\/workspace$/);
  await expect(onScreen(page, ".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog", { name: /Choose study mode/i })).toHaveCount(0);
  // The same reader, not a reload: switching tabs keeps each one mounted.
  await expect(onScreen(page, ".workspace-v2[data-keep-alive-probe='first-sheet']")).toHaveCount(1);
  // Only the tab on screen can be seen or used.
  await expect(page.locator(".workspace-pane.is-kept")).toHaveCount(1);
  await expect(page.locator(".workspace-pane.is-kept")).toHaveAttribute("inert", "");

  // A whiteboard is a lined page that grows from the button under its last page.
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /Whiteboard/ }).click();
  await expect(page).toHaveURL(/\/whiteboards\/[a-f0-9-]+\/workspace$/);
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Whiteboard 1", "Vitamin -2"]);
  await expect(onScreen(page, '[data-workspace-page="1"] .workspace-v2-a4-canvas.is-visible')).toBeVisible({ timeout: 20_000 });
  await expect(onScreen(page, ".workspace-v2-study-mode-button")).toHaveCount(0);
  await expect(onScreen(page, ".workspace-v2-page-number")).toContainText("/ 1");
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(onScreen(page, ".workspace-v2-a4-page.is-virtual.is-background-lined")).toHaveCount(1);
  await expect(onScreen(page, ".workspace-v2-page-number")).toContainText("/ 2");

  // Sheet and whiteboard switch both ways without reloading either.
  await onScreen(page, ".workspace-v2").evaluate((element) => { element.dataset.keepAliveProbe = "whiteboard"; });
  await tabs(page).first().click();
  await expect(onScreen(page, ".workspace-v2[data-keep-alive-probe='first-sheet']")).toHaveCount(1);
  await tabs(page).nth(1).click();
  await expect(onScreen(page, ".workspace-v2[data-keep-alive-probe='whiteboard']")).toHaveCount(1);
  await expect(onScreen(page, ".workspace-v2-page-number")).toContainText("/ 2");

  // The whiteboard keeps its pages on this device across a reload.
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(onScreen(page, ".workspace-v2-a4-page.is-virtual.is-background-lined")).toHaveCount(1, { timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Whiteboard 1", "Vitamin -2"]);

  // Closing the open tab moves to its neighbour.
  await page.getByRole("button", { name: "Close Whiteboard 1" }).click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-2\/workspace$/);
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Vitamin -2"]);
});
