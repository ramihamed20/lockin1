import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

test("leaving the reader releases annotation databases across repeated mounts", async ({ page }) => {
  test.setTimeout(60_000);
  await mockStudentApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    const live = new Set();
    window.auditWorkspaceConnections = () => [...live].filter((database) => database.name === "lock-in-workspace").length;
    const originalOpen = IDBFactory.prototype.open;
    const originalClose = IDBDatabase.prototype.close;
    IDBFactory.prototype.open = function (...args) {
      const request = Reflect.apply(originalOpen, this, args);
      request.addEventListener("success", () => live.add(request.result), { once: true });
      return request;
    };
    IDBDatabase.prototype.close = function (...args) {
      live.delete(this);
      return Reflect.apply(originalClose, this, args);
    };
  });
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await page.goto("/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace");
    const normal = page.getByRole("button", { name: /Normal Study/ });
    if (await normal.isVisible()) await normal.click();
    await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.auditWorkspaceConnections())).toBe(1);
    await page.goto("/#/");
    await expect(page.locator(".dashboard-layout")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.auditWorkspaceConnections())).toBe(0);
  }
});
