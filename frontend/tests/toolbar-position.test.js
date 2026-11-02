import test from 'node:test';
import assert from 'node:assert/strict';
import {readDock, clampDock, snapDock} from '../src/pages/focus-workspace/toolbarPosition.js';
const bounds={left:8,top:64,right:382,bottom:836};
test('corrupt preferences recover without losing the handle',()=>{
  assert.equal(readDock({edge:'unknown'}).edge,'top');
  assert.deepEqual(readDock({edge:'float',x:Infinity,y:-4}),{edge:'float',x:.5,y:0});
});
test('drag remains reachable after rotating to a smaller viewport',()=>{
  assert.deepEqual(clampDock({x:1000,y:1200},bounds,{width:300,height:60}),{x:82,y:776});
  assert.deepEqual(clampDock({x:-100,y:-100},bounds,{width:300,height:60}),{x:8,y:64});
});
test('snap targets use physical edges and leave the middle floating',()=>{
  assert.equal(snapDock({x:100,y:200},bounds),'float');
  assert.equal(snapDock({x:10,y:200},bounds),'left');
  assert.equal(snapDock({x:380,y:200},bounds),'right');
  assert.equal(snapDock({x:100,y:65},bounds),'top');
  assert.equal(snapDock({x:100,y:835},bounds),'bottom');
  assert.equal(snapDock({x:100,y:0},bounds),'top');
  assert.equal(snapDock({x:500,y:200},bounds),'right');
});
