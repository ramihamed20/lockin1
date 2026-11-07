import { test, expect } from '@playwright/test';
const idea={id:'11111111-1111-4111-8111-111111111111',page:1,kind:'understand',teaser:'Prepared idea',question:'Prepared question?',explanation:'A reviewed explanation.',followup_question:'Follow up?',followup_answer:'Reviewed answer.',saved:false};
for(const locale of ['en','ar']) test(`general companion works without prepared content in ${locale}`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(locale=>localStorage.setItem('lock-in.locale',locale),locale);
 await page.route('**/api/v1/catalog/documents/**',r=>r.fulfill({json:{version_id:'test-version',results:[]}}));
 await page.goto('/e2e/fixtures/companion-ready/');
 await expect(page.locator('.study-companion-bubble')).toBeVisible();
 await page.locator('.study-companion-pet').click();
 await expect(page.locator('.study-companion-ready-note')).toContainText(locale==='ar'?'نصيحة دراسية عامة':'General study tip');
 await expect(page.locator('.study-companion-save')).toHaveCount(0);
 await page.locator('.study-companion-explain').click();
 await expect(page.locator('.study-companion-followup')).toBeVisible();
 await page.locator('.study-companion-followup > button').click();
 await expect(page.locator('.study-companion-followup .study-companion-text')).toBeVisible();
 await page.locator('.study-companion-card-nav').getByRole('button').last().click();
 await expect(page.locator('.study-companion-card-nav span')).toHaveText('2 / 10');
 await page.locator('.study-companion-card-nav').getByRole('button').first().click();
 await expect(page.locator('.study-companion-card-nav span')).toHaveText('1 / 10');
 await page.locator('.study-companion-panel header button').click();
 await page.locator('.study-companion-preferences').click();
 await page.locator('.study-companion-characters button').last().click();
 await expect(page.locator('.study-companion-characters button').last()).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:locale==='ar'?'إخفاء الرفيق':'Hide companion',exact:true}).click();
 await expect(page.locator('.study-companion-restore')).toBeVisible();
 await page.locator('.study-companion-restore').click();
 await expect(page.locator('.study-companion-pet')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('failed page help retries and confirmed server ideas can be saved',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 let failed=true,saved=false;
 await page.route('**/api/v1/auth/csrf',route=>route.fulfill({json:{csrf_token:'test-csrf'}}));
 await page.route('**/api/v1/catalog/documents/**',route=>{
  if(route.request().method()==='PUT'){saved=route.request().postDataJSON().saved;return route.fulfill({json:{idea:{...idea,saved}}});}
  return failed?route.fulfill({status:503,json:{error:{code:'unavailable',message:'Retry later'}}}):route.fulfill({json:{version_id:'test-version',results:[{...idea,saved}]}});
 });
 await page.goto('/e2e/fixtures/companion-ready/');
 await expect(page.locator('.study-companion-bubble')).toBeVisible();
 await page.locator('.study-companion-pet').click();
 await expect(page.locator('.study-companion-ready-note')).toContainText('could not be loaded');
 failed=false;
 await page.getByRole('button',{name:'Retry page help'}).click();
 await expect(page.getByRole('heading',{name:'Prepared question?'})).toBeVisible();
 await page.getByRole('button',{name:'Save idea',exact:true}).click();
 await expect(page.getByRole('button',{name:'Idea saved',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(saved).toBe(true);
});

test('study companion stays compact on phone, larger on iPad, and its panels fit both',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('lock-in.locale','ar'));
 await page.route('**/api/v1/catalog/documents/**',r=>r.fulfill({json:{version_id:'test-version',results:[]}}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/e2e/fixtures/companion-ready/');
 const pet=page.locator('.study-companion-pet');
 const panel=page.locator('.study-companion-panel');
 const bounds=async(locator)=>locator.evaluate(element=>{
  const rect=element.getBoundingClientRect();
  return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
 });
 const checkInsideViewport=async(locator)=>{
  const rect=await bounds(locator);
  const viewport=page.viewportSize();
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.y).toBeGreaterThanOrEqual(-1);
  expect(rect.x+rect.width).toBeLessThanOrEqual(viewport.width+1);
  expect(rect.y+rect.height).toBeLessThanOrEqual(viewport.height+1);
 };
 await expect(pet).toBeVisible();
 const phone=await bounds(pet);
 expect(phone.width).toBeLessThanOrEqual(90);
 await checkInsideViewport(pet);
 await pet.click();
 await expect(panel).toBeVisible();
 await checkInsideViewport(panel);
 await panel.locator('header button').click();

 await page.setViewportSize({width:820,height:1180});
 await expect(pet).toBeVisible();
 const ipad=await bounds(pet);
 expect(ipad.width).toBeGreaterThan(phone.width);
 expect(ipad.width).toBeLessThanOrEqual(130);
 await checkInsideViewport(pet);
 await pet.click();
 await expect(panel).toBeVisible();
 await checkInsideViewport(panel);
 await panel.locator('header button').click();

 await page.setViewportSize({width:844,height:390});
 await pet.click();
 await expect(panel).toBeVisible();
 await checkInsideViewport(panel);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

for (const [locale, width, height] of [
 ['ar', 320, 568],
 ['en', 390, 844],
 ['ar', 844, 390],
]) test(`companion settings, saved ideas and explanation are responsive at ${width}x${height} (${locale})`, async ({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width,height});
 await page.addInitScript(lang=>localStorage.setItem('lock-in.locale',lang),locale);
 await page.route('**/api/v1/catalog/documents/**',r=>r.fulfill({json:{version_id:'test-version',results:[]}}));
 await page.goto('/e2e/fixtures/companion-ready/');
 const fits=async(locator)=>{
  const bounds=await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(height+1);
  return bounds;
 };
 await page.locator('.study-companion-preferences').click();
 const settings=page.locator('.study-companion-settings');
 await expect(settings).toBeVisible();
 const settingsBounds=await fits(settings);
 expect(settingsBounds.width).toBeLessThanOrEqual(width<=600?301:293);
 const characterImage=settings.locator('.study-companion-characters img').first();
 const imageBounds=await fits(characterImage);
 expect(imageBounds.width).toBeLessThanOrEqual(65);
 const close=settings.locator('header button');
 const closeBounds=await fits(close);
 expect(closeBounds.width).toBeGreaterThanOrEqual(43);
 expect(closeBounds.height).toBeGreaterThanOrEqual(43);
 const motion=settings.locator(':scope > button[aria-pressed]');
 await expect(motion).toHaveAttribute('aria-pressed','true');
 await motion.click();
 await expect(motion).toHaveAttribute('aria-pressed','false');
 await settings.locator(':scope > button').nth(1).click();
 const saved=page.locator('.study-companion-saved');
 await expect(saved).toBeVisible();
 await fits(saved);
 await saved.locator('header button').click();
 await page.locator('.study-companion-pet').click();
 const explanation=page.locator('.study-companion-panel');
 await expect(explanation).toBeVisible();
 await fits(explanation);
 await page.locator('.study-companion-explain').click();
 await expect(page.locator('.study-companion-text')).toBeVisible();
 await fits(explanation);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

for (const [locale, width, height] of [['ar',320,568], ['en',390,844], ['ar',844,390]]) {
 test(`companion learning card keeps navigation visible while content scrolls at ${width}x${height} (${locale})`,async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width,height});
  await page.addInitScript(language=>localStorage.setItem('lock-in.locale',language),locale);
  await page.route('**/api/v1/catalog/documents/**',route=>route.fulfill({json:{
   version_id:'test-version',
   results:[{...idea,explanation:'Long explanation to test scrolling. '.repeat(100)}]
  }}));
  await page.goto('/e2e/fixtures/companion-ready/');
  await page.locator('.study-companion-pet').click();
  const panel=page.locator('.study-companion-panel');
  const body=page.locator('.study-companion-lesson');
  const footer=page.locator('.study-companion-card-nav');
  await expect(panel).toBeVisible();
  await expect(footer).toBeVisible();
  await page.locator('.study-companion-explain').click();
  await expect(page.locator('.study-companion-text')).toBeVisible();
  await expect.poll(()=>body.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  const before=await footer.boundingBox();
  const initialPanel=await panel.boundingBox();
  await body.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  await expect(footer).toBeInViewport();
  const after=await footer.boundingBox();
  const finalPanel=await panel.boundingBox();
  expect(Math.abs(after.y-before.y)).toBeLessThan(2);
  expect(Math.abs(finalPanel.height-initialPanel.height)).toBeLessThan(2);
  expect(finalPanel.x).toBeGreaterThanOrEqual(-1);
  expect(finalPanel.y).toBeGreaterThanOrEqual(-1);
  expect(finalPanel.x+finalPanel.width).toBeLessThanOrEqual(width+1);
  expect(finalPanel.y+finalPanel.height).toBeLessThanOrEqual(height+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 });
}

test("dragging the phone companion moves without opening help and survives reload and viewport resize", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/catalog/documents/**", (route) => route.fulfill({ json: { version_id: "test-version", results: [] } }));
  await page.goto("/e2e/fixtures/companion-ready/");
  const pet = page.locator(".study-companion-pet");
  await expect(pet).toBeVisible();
  const initial = await pet.boundingBox();
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await page.mouse.down();
  await page.mouse.move(initial.x + initial.width / 2 - 110, initial.y + initial.height / 2 - 85, { steps: 8 });
  await page.mouse.up();
  const moved = await pet.boundingBox();
  expect(Math.hypot(moved.x - initial.x, moved.y - initial.y)).toBeGreaterThan(40);
  await expect(page.locator(".study-companion-panel")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("lock-in.study-companion.v1:test-student") || "null");
    return Number.isFinite(prefs?.position?.x) && Number.isFinite(prefs?.position?.y);
  })).toBe(true);

  await page.reload();
  await expect(pet).toBeVisible();
  const restored = await pet.boundingBox();
  expect(Math.abs(restored.x - moved.x)).toBeLessThan(3);
  expect(Math.abs(restored.y - moved.y)).toBeLessThan(3);
  await pet.click();
  await expect(page.locator(".study-companion-panel")).toBeVisible();
  await page.locator(".study-companion-panel header button").click();

  await page.setViewportSize({ width: 320, height: 568 });
  const narrow = await pet.boundingBox();
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.y).toBeGreaterThanOrEqual(0);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(320);
  expect(narrow.y + narrow.height).toBeLessThanOrEqual(568);
});

test('phone + adds a draggable companion, keeps its position and restores it without a floating button', async ({ page }) => {
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.setViewportSize({ width: 390, height: 844 });
 await page.addInitScript(() => localStorage.setItem('lock-in.locale', 'en'));
 await page.route('**/api/v1/catalog/documents/**', route => route.fulfill({ json: { version_id: 'test-version', results: [] } }));
 await page.goto('/e2e/fixtures/companion-ready/?toolbar');
 const pet = page.locator('.study-companion-pet');
 const add = page.getByRole('button', { name: 'Add', exact: true });
 await expect(pet).toHaveCount(0);
 await expect(page.locator('.study-companion-restore')).toHaveCount(0);
 await add.click();
 const menu = page.getByRole('dialog', { name: 'Add to page' });
 await expect(menu.getByRole('button', { name: 'Add study companion' })).toBeVisible();
 await menu.getByRole('button', { name: 'Add study companion' }).click();
 await expect(pet).toBeVisible();
 await expect(page.locator('.study-companion-restore')).toHaveCount(0);
 const original = await pet.boundingBox();
 const x = original.x + original.width / 2;
 const y = original.y + original.height / 2;
 await pet.dispatchEvent('pointerdown', { pointerId: 82, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y });
 for (let i = 1; i <= 8; i++) {
  await pet.dispatchEvent('pointermove', { pointerId: 82, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x - 10 * i, clientY: y - 15 * i });
 }
 await pet.dispatchEvent('pointerup', { pointerId: 82, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: x - 80, clientY: y - 120 });
 await expect(page.locator('.study-companion-panel')).toHaveCount(0);
 await expect.poll(async () => (await pet.boundingBox()).x).toBeLessThan(original.x - 40);
 await expect.poll(async () => (await pet.boundingBox()).y).toBeLessThan(original.y - 70);
 const moved = await pet.boundingBox();
 const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lock-in.study-companion.v1:test-student')));
 expect(saved.phoneAdded).toBe(true);
 expect(saved.position.x).toBeGreaterThanOrEqual(0);
 expect(saved.position.x).toBeLessThanOrEqual(1);
 expect(saved.position.y).toBeGreaterThanOrEqual(0);
 expect(saved.position.y).toBeLessThanOrEqual(1);

 await page.reload();
 await expect(pet).toBeVisible();
 const restored = await pet.boundingBox();
 expect(Math.abs(restored.x - moved.x)).toBeLessThan(3);
 expect(Math.abs(restored.y - moved.y)).toBeLessThan(3);
 await pet.click();
 await expect(page.locator('.study-companion-panel')).toBeVisible();
 await page.locator('.study-companion-panel header button').click();
 await page.locator('.study-companion-preferences').click();
 await page.getByRole('button', { name: 'Hide companion', exact: true }).click();
 await expect(pet).toHaveCount(0);
 await expect(page.locator('.study-companion-restore')).toHaveCount(0);
 await add.click();
 await page.getByRole('dialog', { name: 'Add to page' }).getByRole('button', { name: 'Add study companion' }).click();
 await expect(pet).toBeVisible();
 await expect(page.locator('.study-companion-restore')).toHaveCount(0);
});

test('toolbar companion cannot be accidentally added on tablet, which keeps its original launcher', async ({ page }) => {
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.setViewportSize({ width: 820, height: 1180 });
 await page.addInitScript(() => localStorage.setItem('lock-in.locale', 'en'));
 await page.route('**/api/v1/catalog/documents/**', route => route.fulfill({ json: { version_id: 'test-version', results: [] } }));
 await page.goto('/e2e/fixtures/companion-ready/?toolbar');
 await page.getByRole('button', { name: 'Add', exact: true }).click();
 const menu = page.locator('#workspace-add-popover');
 await expect(menu.locator('.workspace-add-phone-companion')).toBeHidden();
 await menu.locator('header button').click();
 await expect(page.locator('.study-companion-pet')).toBeVisible();
});

test('prepared page help appears ahead of sheet-wide tips with kind and PDF page',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>localStorage.setItem('lock-in.locale','ar'));
 const pageIdea={...idea,id:'22222222-2222-4222-8222-222222222222',page:1,kind:'connection',teaser:'ربط مفاهيم',question:'الفرق بين مفهومين',explanation:'شرح مرتبط بهذه الصفحة.'};
 const generalIdea={...idea,id:'33333333-3333-4333-8333-333333333333',page:null,kind:'organize',teaser:'نصيحة عامة',question:'مراجعة عامة',explanation:'راجع بهدوء.'};
 await page.route('**/api/v1/catalog/documents/**',route=>route.fulfill({json:{version_id:'test-version',results:[generalIdea,pageIdea]}}));
 await page.goto('/e2e/fixtures/companion-ready/');
 await expect(page.locator('.study-companion-bubble')).toContainText('ربط مفاهيم');
 await page.locator('.study-companion-pet').click();
 const lesson=page.locator('.study-companion-panel');
 await expect(lesson.locator('.study-companion-kind')).toContainText('ربط أفكار');
 await expect(lesson.locator('.study-companion-kind')).toContainText('صفحة 1');
 await expect(lesson.getByRole('heading',{name:'الفرق بين مفهومين'})).toBeVisible();
 await lesson.locator('.study-companion-card-nav button').last().click();
 await expect(lesson.getByRole('heading',{name:'مراجعة عامة'})).toBeVisible();
 await expect(lesson.locator('.study-companion-kind')).toContainText('تنظيم');
});
