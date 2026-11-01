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
