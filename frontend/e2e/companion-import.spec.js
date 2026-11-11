import {test,expect} from '@playwright/test';
const sheetId='11111111-1111-4111-8111-111111111111';
const card={key:'short-1',page:1,kind:'fact',teaser:'Small fact',question:'A short title',explanation:'A brief fact.'};
const context={subject_id:'subject-1',edition:'university',view:'study',sheets:[{sheet_id:sheetId,source_version_id:'version-1',title:'First sheet',page_count:3},{sheet_id:'sheet-2',source_version_id:'version-2',title:'Second sheet',page_count:4}]};
test('JSON import previews before writing, supports multiple sheets and invalidates changed input',async({page})=>{
 let imported=false;const posts=[];
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/v1/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/csrf'))return route.fulfill({json:{csrf_token:'test-csrf'}});
  if(path.endsWith('/import')){
   if(req.method()==='GET')return route.fulfill({json:context});
   const body=req.postDataJSON();posts.push(body);
   if(body.preview_token){imported=true;return route.fulfill({json:{imported:2,changed_count:2,published:body.publish}});}
   return route.fulfill({json:{preview_token:'signed-preview',count:2,changed_count:2,published:false,sheets:body.payload.sheets.map(s=>({...s,title:'Preview sheet',count:s.cards.length}))}});
  }
  if(path.endsWith('/assistance'))return route.fulfill({json:{available:true,version_id:'version-1',page_count:3,results:imported?[{...card,id:'idea-1',position:0,is_published:false,revision:1,followup_question:'',followup_answer:''}]:[]}});
  return route.fulfill({json:{results:[]}});
 });
 await page.goto('/e2e/fixtures/companion-import/');
 await page.getByText('Import companion cards (JSON)',{exact:true}).click();
 await expect(page.getByText('Generate with Antigravity on your server')).toBeVisible();
 await expect(page.locator('.admin-assistance-antigravity pre')).toContainText(sheetId);
 await expect(page.locator('.admin-assistance-antigravity pre')).toContainText('--actor-email');
 await page.getByRole('button',{name:'Copy server command'}).click();
 await page.getByRole('combobox',{name:'Select sheets',exact:true}).selectOption('all');
 await expect(page.locator('.admin-assistance-antigravity')).toHaveCount(0);
 await page.getByRole('button',{name:'Copy prompt',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Copy prompt'})).toHaveValue(/version-2/);
 const payload={schema_version:1,subject_id:context.subject_id,edition:'university',view:'study',sheets:context.sheets.map(s=>({sheet_id:s.sheet_id,source_version_id:s.source_version_id,cards:[card]}))};
 await page.getByLabel('JSON file',{exact:true}).setInputFiles({name:'cards.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
 await page.getByRole('button',{name:'Preview cards',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm import',exact:true})).toBeVisible();
 expect(posts).toHaveLength(1);expect(imported).toBe(false);expect(posts[0].publish).toBe(false);
 await page.getByLabel('Paste JSON',{exact:true}).fill(JSON.stringify(payload,null,2));
 await expect(page.getByRole('button',{name:'Confirm import',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Preview cards',exact:true}).click();
 await page.getByRole('button',{name:'Confirm import',exact:true}).click();
 await expect(page.locator('.admin-assistance-list')).toContainText('A short title');
 expect(posts[2].preview_token).toBe('signed-preview');expect(imported).toBe(true);
});
