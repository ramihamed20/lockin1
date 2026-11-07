import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

for (const direction of ["ltr", "rtl"]) {
  test(`five sheet tabs keep the selected document in view on phone and rotation (${direction})`, async ({ page }) => {
    test.setTimeout(90_000);
    await withoutServiceWorker(page);
    await page.route("**/api/v1/**", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/v1/auth/session") return route.fulfill({ json: { user: { id: "overflow-student", email: "overflow@example.test", full_name: "Overflow Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } } });
      if (await fulfillAccessContract(route, pathname)) return;
      return route.fulfill({ status: 404, json: {} });
    });
    await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
    await page.setViewportSize({ width: 390, height: 844 });
    const active = page.locator(".workspace-pane.is-active");
    const strip = active.locator(".workspace-tabs-scroller");
    const selected = active.getByRole("tab", { selected: true });
    const inStrip = () => selected.evaluate((button) => {
      const tab = button.parentElement.getBoundingClientRect();
      const strip = button.closest(".workspace-tabs-scroller").getBoundingClientRect();
      return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    });
    for (const slug of ["vitamin-1", "vitamin-2", "vitamin-3", "range-probe", "long-probe"]) {
      if (slug === "vitamin-1") await page.goto(`/#/materials/catalog/biochemistry-1/sheets/${slug}/workspace`);
      else await page.evaluate((slug) => { location.hash = `/materials/catalog/biochemistry-1/sheets/${slug}/workspace`; }, slug);
      await page.getByRole("button", { name: /Normal Study/ }).click();
      if (slug === "vitamin-1") await page.evaluate((direction) => { document.documentElement.dir = direction; }, direction);
      await expect.poll(inStrip).toBe(true);
    }
    await expect(active.getByRole("tab")).toHaveCount(5);
    expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await strip.evaluate((el) => el.scrollTo({ left: 0 }));
    await active.getByRole("tab", { name: "Vitamin -1", exact: true }).click();
    await expect(selected).toHaveText("Vitamin -1");
    await expect.poll(inStrip).toBe(true);
    await active.getByRole("tab", { name: "Long probe", exact: true }).click();
    await expect(selected).toHaveText("Long probe");
    for (const viewport of [{ width: 844, height: 390 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(inStrip).toBe(true);
      const bounds = await active.locator(".workspace-tabs-add").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
  });
}
