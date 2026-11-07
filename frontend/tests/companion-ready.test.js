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

test("saved companion drag coordinates are validated and clamped", async () => {
  const { companionPreferences } = await import("../src/lib/studyAssistance.js");
  assert.equal(companionPreferences(null).phoneAdded, false);
  assert.equal(companionPreferences(null).position, null);
  assert.deepEqual(companionPreferences({ phoneAdded: true, position: { x: -2, y: 9 } }).position, { x: 0, y: 1 });
  assert.equal(companionPreferences({ position: { x: "bad", y: 0.5 } }).position, null);
});
