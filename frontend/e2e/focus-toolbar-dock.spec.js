import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

// The reader's toolbar layout contract: one row on a phone with one document
// open, the writing tools first and on screen, Undo/Redo pinned beside them,
// and every action dropped for room still reachable from More.

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


const rail = page => page.locator('.workspace-pane.is-active .workspace-tool-dock');
const grip = page => page.locator('.workspace-pane.is-active .workspace-dock-grip');
async function choose(page, label) {
  await grip(page).click();
  await page.locator('.workspace-dock-menu').getByRole('button', {name:label, exact:true}).click();
}
async function fits(page) {
  return rail(page).evaluate(node => { const r=node.getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1; });
}
for (const language of ['en', 'ar']) {
  test(`dock, float, resize, reset and original pen options (${language})`, async ({page}) => {
    await openWorkspace(page, {width:820,height:1180}, {language});
    await choose(page, language==='ar'?'يسار':'Left');
    await expect(rail(page)).toHaveAttribute('data-dock-edge','left');
    await expect.poll(()=>fits(page)).toBe(true);
    await rail(page).locator('[data-workspace-tool="pen"]').click();
    await expect(page.locator('.workspace-v2-tool-options')).toBeVisible();
    await expect(page.locator('.workspace-v4-pen-profiles')).toBeVisible();
    if (language === 'en') await expect.poll(() => page.locator('.workspace-v2-tool-options').evaluate(panel => { const p=panel.getBoundingClientRect(); const d=document.querySelector('.workspace-pane.is-active .workspace-tool-dock').getBoundingClientRect(); return p.left >= d.right || p.right <= d.left; })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace-v2-tool-options')).toBeHidden();
    if (process.env.LOCKIN_DOCK_SCREENSHOTS) await page.screenshot({path:`/tmp/lockin-dock-${language}.png`});
    await choose(page, language==='ar'?'عائم':'Floating');
    await expect(rail(page)).toHaveAttribute('data-dock-edge','float');
    await expect.poll(()=>fits(page)).toBe(true);
    await page.setViewportSize({width:390,height:844});
    await expect.poll(()=>fits(page)).toBe(true);
    await choose(page, language==='ar'?'أسفل':'Bottom');
    await expect.poll(()=>fits(page)).toBe(true);
    await page.setViewportSize({width:844,height:390});
    await expect.poll(()=>fits(page)).toBe(true);
    await grip(page).focus(); await page.keyboard.press('Home');
    await expect(rail(page)).toHaveAttribute('data-dock-edge','top');
  });
}
test('drag detaches, stays floating, snaps to right and preserves saved location',async({page})=>{
  await openWorkspace(page,{width:1180,height:820});
  let b=await grip(page).boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
  await page.mouse.move(480,300,{steps:15}); await page.mouse.up();
  await expect(rail(page)).toHaveAttribute('data-dock-edge','float');
  await expect.poll(()=>fits(page)).toBe(true);
  b=await grip(page).boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
  await page.mouse.move(1168,320,{steps:15}); await page.mouse.up();
  await expect(rail(page)).toHaveAttribute('data-dock-edge','right');
  await expect.poll(()=>fits(page)).toBe(true);
  await page.reload();
  await expect(rail(page)).toHaveAttribute('data-dock-edge','right');
  await expect.poll(()=>fits(page)).toBe(true);
});
