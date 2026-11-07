import { expect, test } from '@playwright/test';
import { studentSession, fulfillAccessContract } from './fixtures/productionApi.js';

for (const locale of ['en','ar']) {
 test(`long directories can be searched and cleared in ${locale}`, async ({ page }) => {
  await page.setViewportSize({width:320,height:900});
  const materials=Array.from({length:7},(_,i)=>({slug:`subject-${i}`,title:i===6?'أَسَاسِيَّات التشريح':`Subject ${i}`,sheets:Array.from({length:7},(_,n)=>({slug:`sheet-${n}`,id:`sheet-${n}`,title:`Sheet ${n}`,number:n+1,questionCount:2})),questionCount:14}));
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const send=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   if(await fulfillAccessContract(route,path))return;
   if(path==='/api/v1/auth/session')return send({user:studentSession({preferred_language:locale})});
   if(path==='/api/v1/auth/csrf')return send({csrf_token:'test-csrf'});
   if(path==='/api/v1/operations/session')return route.fulfill({status:403,body:'{}'});
   if(path==='/api/v1/catalog/materials'||path==='/api/v1/catalog/questions')return send({count:7,results:materials});
   if(path==='/api/v1/review-bank')return send({active_count:7,mastered_this_week:0,subjects:materials.map(m=>({subject_key:m.slug,subject_label_snapshot:m.title,question_count:1,repeated_count:0}))});
   return send({count:0,results:[]});
  });
  const label=locale==='ar'?'ابحث في هذه القائمة':'Search this list';
  const clear=locale==='ar'?'مسح البحث':'Clear search';
  for(const [path,query,selector] of [
   ['/materials','اساسيات تشريح','.catalog-material-grid'],
   ['/materials/catalog/subject-0','sheet 6','.catalog-sheet-grid'],
   ['/questions/categories/ai-sheet','اساسيات تشريح','.catalog-material-grid'],
   ['/questions/categories/ai-sheet/subjects/subject-0','sheet 6','.catalog-material-grid'],
   ['/review/bank','اساسيات تشريح','.review-bank-subjects']
  ]){
   await page.goto('/#'+path);
   const input=page.getByRole('searchbox',{name:label});
   await input.fill(query);
   await expect(page.locator(selector).getByRole('link')).toHaveCount(1);
   await input.fill('unmatched');
   await expect(page.locator(selector)).toHaveCount(0);
   await page.getByRole('button',{name:clear,exact:true}).click();
   await expect(page.locator(selector).getByRole('link')).toHaveCount(7);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
 });
}
