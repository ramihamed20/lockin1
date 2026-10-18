import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAnnotationCommand, withCommandPositions } from '../src/workspace/catalog/catalogWorkspaceState.js';
import { createEraserSession } from '../src/workspace/ink/eraserSession.js';

function marks(maskCount) {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `stroke-${i}`, page: 1, type: ['pen', 'pencil', 'highlighter'][i % 3],
    color: '#8b5cf6', width: 4 + i * 2, opacity: .7, profile: i % 2 ? 'pencil' : 'ball',
    pressureSensitivity: .85, locked: i === 11,
    points: Array.from({ length: 25 }, (_, j) => ({ x: 20 + j * 9, y: 30 + i * 16 + Math.sin(j / 3) * 8, p: j % 5 / 4, pointer: 'pen', t: j * 8 })),
    erasures: Array.from({ length: maskCount }, () => ({ radius: 2, points: [{ x: 200, y: 220 }] }))
  }));
}

test('mask-only commits keep overlapping ink in place through exact Undo/Redo', () => {
  const original = marks(0).slice(0, 8);
  const session = createEraserSession();
  const point = {x:100,y:90};
  session.begin(point,1); session.append(point,{candidates:original,radius:10,mode:'precision'});
  const result = session.finish();
  const command = withCommandPositions(result.command, original);
  const committed = applyAnnotationCommand(original, command, 'redo');
  assert.deepEqual(committed.map(mark=>mark.id), original.map(mark=>mark.id));
  assert.deepEqual(applyAnnotationCommand(committed, command, 'undo'), original);
  assert.deepEqual(applyAnnotationCommand(original, command, 'redo'), committed);
  const touched = new Set(command.before.map(mark=>mark.id));
  for (let index=0; index<original.length; index++) if (!touched.has(original[index].id)) assert.equal(committed[index],original[index]);
});

test('fragment replacements and deletion retain their positional Undo behavior', () => {
  const original = marks(0).slice(0, 4), first = original[0], third = original[2];
  const command = withCommandPositions({type:'replace',before:[first,third],after:[{...first,id:'fragment-a'}, {...first,id:'fragment-b'}]}, original);
  const committed = applyAnnotationCommand(original,command,'redo');
  assert.deepEqual(committed.map(mark=>mark.id),['fragment-a','fragment-b',original[1].id,original[3].id]);
  assert.deepEqual(applyAnnotationCommand(committed,command,'undo'),original);
});

test('scattered mask replacements preserve order and missing IDs retain generic recovery', () => {
  const original = marks(0).slice(0, 4);
  const before = [original[0],original[2]];
  const after = before.map(mark => ({...mark,erasures:[{radius:4,points:[{x:50,y:50}]}]}));
  const command = withCommandPositions({type:'replace',before,after},original);
  const committed = applyAnnotationCommand(original,command,'redo');
  assert.deepEqual(committed,[after[0],original[1],after[1],original[3]]);
  assert.deepEqual(applyAnnotationCommand(committed,command,'undo'),original);
  const missing = original.filter(mark=>mark.id!==original[2].id);
  const recovered = applyAnnotationCommand(missing,command,'redo');
  assert.deepEqual(recovered.map(mark=>mark.id),[original[0].id,original[2].id,original[1].id,original[3].id]);
});

test('incomplete replace commands keep the existing empty-list fallback', () => {
  const original = marks(0).slice(0, 4);
  assert.deepEqual(applyAnnotationCommand(original, { type: 'replace', before: [original[1]] }), [original[0], original[2], original[3]]);
  assert.deepEqual(applyAnnotationCommand(original, { type: 'replace' }), original);
  assert.deepEqual(applyAnnotationCommand(original, { type: 'replace', after: [{ ...original[0], id: 'added' }] }), [...original, { ...original[0], id: 'added' }]);
});
