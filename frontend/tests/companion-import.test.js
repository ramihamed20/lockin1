import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanionPrompt, parseCompanionJson } from '../src/lib/companionImport.js';
import { normalizeAssistanceIdea } from '../src/lib/studyAssistance.js';
test('prompts retain the selected subject, sheet versions, variety and concise limits',()=>{
 const ctx={subject_id:'subject',edition:'lockin',view:'summary'};
 const sheets=[{sheet_id:'a',source_version_id:'v1',title:'Sheet A',page_count:10},{sheet_id:'b',source_version_id:'v2',title:'Sheet B',page_count:20}];
 const prompt=buildCompanionPrompt(ctx,sheets);
 for(const value of ['Starmo','Starsea','v1','v2','600','fact','memory','up to 40 cards per sheet','no fixed target or minimum','MUST have page','Only genuinely general information','ONLY the PDFs'])assert.ok(prompt.includes(value));
 assert.throws(()=>buildCompanionPrompt(ctx,[]));
 assert.equal(parseCompanionJson('\uFEFF{"schema_version":1,"sheets":[{}]}').sheets.length,1);
 assert.throws(()=>parseCompanionJson('[]'));
 assert.throws(()=>parseCompanionJson('```json'));
});
test('short cards do not require a followup but reject half a followup',()=>{
 const card={id:'11111111-1111-4111-8111-111111111111',page:null,kind:'fact',teaser:'Hint',question:'Title',explanation:'A small fact.'};
 assert.equal(normalizeAssistanceIdea(card).followup_question,'');
 assert.equal(normalizeAssistanceIdea({...card,followup_question:'Question?'}),null);
 for(const kind of ['understand','fact','simplify','memory','organize','connection'])assert.ok(normalizeAssistanceIdea({...card,kind}));
});
