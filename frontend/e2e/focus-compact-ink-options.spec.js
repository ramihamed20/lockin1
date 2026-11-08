import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

// Ink controls retain their behavior while captions and repeated rows are compacted.

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function mockWorkspace(page, { language = "en" } = {}) {
  await withoutServiceWorker(page);
  await page.route('**/e2e-fixtures/pdf/**', route => route.fulfill({ path: new URL('./fixtures/pdf/sheet-41.pdf', import.meta.url).pathname, contentType: 'application/pdf' }));
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "toolbar-student", email: "toolbar@example.test", full_name: "Toolbar Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by toolbar tests" } }) });
  });
}

async function openWorkspace(page, viewport, options) {
  await mockWorkspace(page, options);
  await page.setViewportSize(viewport);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}



for (const viewport of [{width:390,height:844},{width:1180,height:820}]) {
 test(`compact pen controls at ${viewport.width}`, async({page}, testInfo)=>{
  await openWorkspace(page,viewport,{language:'ar'});
  const rail=page.locator('.workspace-pane.is-active .workspace-tool-dock');
  await rail.locator('[data-workspace-tool="pen"]').click();
  const panel=page.locator('.workspace-v2-tool-options.is-compact-ink');
  await expect(panel).toBeVisible();
  await expect.poll(()=>panel.evaluate(node=>{const p=node.getBoundingClientRect();const bar=node.closest('.workspace-v2-reader').querySelector('.workspace-v2-toolbar').getBoundingClientRect();return p.top-bar.bottom;})).toBeGreaterThanOrEqual(19);
  await expect(panel).toHaveAttribute('data-notch-side','top');
  await expect.poll(()=>panel.evaluate(node=>{ const p=node.getBoundingClientRect(); const b=node.closest('.workspace-v2-reader').querySelector('[data-workspace-tool="pen"]').getBoundingClientRect(); const offset=parseFloat(node.style.getPropertyValue('--workspace-notch-offset')); return Math.abs(p.left+offset-(b.left+b.width/2)); })).toBeLessThanOrEqual(16);
  const profiles=panel.locator('.workspace-v4-pen-profiles');
  await expect(profiles.getByRole('button')).toHaveCount(5);
  await expect(profiles).toHaveText('');
  const rect=await panel.boundingBox();
  expect(rect.width).toBeLessThanOrEqual(297);expect(rect.height).toBeLessThanOrEqual(370);
  await expect.poll(()=>profiles.getByRole('button').evaluateAll(items=>items.every(n=>n.offsetWidth>=44 && n.offsetHeight>=44 && n.getAttribute('aria-label')))).toBe(true);
  for(let i=0;i<5;i++) {const b=profiles.getByRole('button').nth(i);await b.click();await expect(b).toHaveAttribute('aria-pressed','true');}
  await profiles.getByRole('button').first().click();
  const swatch=panel.locator('.workspace-v2-color-swatch').nth(1);
  await swatch.click();await expect(swatch).toHaveAttribute('aria-pressed','true');
  await expect(swatch.locator('svg')).toBeVisible();
  await panel.locator('.workspace-v2-custom-color').click();
  await panel.locator('.workspace-v2-custom-color-editor input').fill('#123456');
  await panel.locator('.workspace-v2-custom-color-editor button').click();
  const custom=panel.locator('.workspace-v2-color-swatch[title="#123456"]');
  await expect(custom).toBeVisible();await custom.click();await expect(custom).toHaveAttribute('aria-pressed','true');
  await swatch.click();
  await panel.getByRole('slider').first().fill('6');
  await expect(panel.getByRole('slider').first()).toHaveValue('6');
  const more=panel.locator('.workspace-tool-extras-toggle');
  await more.click();await expect(more).toHaveAttribute('aria-expanded','true');
  await expect(panel.locator('.workspace-v4-pen-gestures')).toBeVisible();
  await more.click();
  await expect.poll(()=>panel.evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).every(animation=>animation.playState==='finished'))).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`compact-pen-${viewport.width}.png`)});
 });
}
test('long press reveals accessible pen name without permanent captions',async({page})=>{
 await openWorkspace(page,{width:390,height:844});
 await page.locator('.workspace-pane.is-active [data-workspace-tool="pen"]').click();
 const first=page.locator('.workspace-v4-pen-profiles button').first();
 const box=await first.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await expect(first.getByRole('tooltip')).toBeVisible();
 await page.mouse.up();
 await page.mouse.move(380,800);await expect(first.getByRole('tooltip')).toBeHidden();
});
