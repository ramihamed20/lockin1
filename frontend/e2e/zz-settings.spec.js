import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
// Screenshots land in test-results unless a folder is given, so an unset
// variable no longer creates a directory literally named "undefined".
const OUT = process.env.SHOTS_DIR || "test-results/settings-shots";
const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
async function mock(page, lang) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "s", email: "s@example.test", full_name: "S", preferred_language: lang, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
    if (pathname === "/api/v1/operations/session") return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}
const tag = process.env.SHOT_TAG || "set";
for (const [name, vp, lang] of [["desk", { width: 1440, height: 900 }, "en"], ["ipad", { width: 820, height: 1180 }, "en"], ["phone", { width: 390, height: 844 }, "en"], ["phone-ar", { width: 390, height: 844 }, "ar"]]) {
  test("settings " + name, async ({ page }) => {
    await mock(page, lang);
    await page.setViewportSize(vp);
    await page.goto(ROUTE);
    await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).first().click();
    await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Workspace settings" }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
    const r = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2-switch-track")].filter((t) => t.getClientRects().length).map((t) => { const a = t.getBoundingClientRect(); const b = t.firstElementChild.getBoundingClientRect(); return [Math.round(b.left - a.left), Math.round(a.right - b.right)]; }));
    console.log(name, JSON.stringify(r));
  });
}
