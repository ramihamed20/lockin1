import test from 'node:test';
import assert from 'node:assert/strict';
import { generalCompanionIdeas } from '../src/lib/companionTips.js';
import { normalizeAssistanceIdea } from '../src/lib/studyAssistance.js';
test('general coaching is complete, marked as general and cannot be mistaken for server content',()=>{
 for(const locale of ['en','ar']){
  const ideas=generalCompanionIdeas(locale);
  assert.equal(ideas.length,10);
  assert.equal(new Set(ideas.map(i=>i.id)).size,10);
  for(const idea of ideas){
   assert.equal(idea.general,true);
   assert.equal(idea.saved,false);
   assert.equal(normalizeAssistanceIdea(idea),null);
   for(const key of ['question','explanation','followup_question','followup_answer']) assert.ok(idea[key].trim());
  }
 }
});
