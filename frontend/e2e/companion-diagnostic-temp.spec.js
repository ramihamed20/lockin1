import {test} from '@playwright/test';
test('diagnose companion fixture', async ({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>localStorage.setItem('lock-in.locale','en'));
 const idea={id:'11111111-1111-4111-8111-111111111111',page:1,kind:'understand',teaser:'Prepared idea',question:'Prepared question?',explanation:'A reviewed explanation.',followup_question:'Follow up?',followup_answer:'Reviewed answer.',saved:false};
 await page.route('**/api/v1/catalog/documents/**',r=>r.fulfill({json:{version_id:'test-version',results:[idea]}}));
 await page.goto('/e2e/fixtures/companion-ready/');
 await page.locator('.study-companion-pet').click();
 await page.getByRole('heading',{name:'Prepared question?'}).waitFor();
 console.log('IDEA_BUTTONS',JSON.stringify(await page.locator('.study-companion-panel button').evaluateAll(ns=>ns.map(n=>({text:n.innerText,aria:n.getAttribute('aria-label'),hidden:getComputedStyle(n).display,html:n.outerHTML.slice(0,500)})))));
 await page.locator('.study-companion-panel header button').click();
 await page.locator('.study-companion-preferences').click();
 console.log('SETTINGS_BUTTONS',JSON.stringify(await page.locator('.study-companion-settings button').evaluateAll(ns=>ns.map(n=>({text:n.innerText,aria:n.getAttribute('aria-label'),html:n.outerHTML.slice(0,500)})))));
 const sizes=async()=>page.locator('.study-companion-pet').evaluate(n=>({rect:n.getBoundingClientRect().toJSON(),vw:innerWidth,root:n.parentElement.getBoundingClientRect().toJSON(),css:getComputedStyle(n.parentElement).getPropertyValue('--companion-width')}));
 console.log('PHONE_SIZE',JSON.stringify(await sizes())); await page.setViewportSize({width:820,height:1180}); await page.waitForTimeout(100); console.log('TABLET_SIZE',JSON.stringify(await sizes()));
});
