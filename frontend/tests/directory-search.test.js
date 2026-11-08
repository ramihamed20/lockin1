import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDirectory } from '../src/lib/directorySearch.js';
test('directory search ignores Arabic marks, tatweel, English casing and word order', () => {
 const items=[{title:'أَسَاسِيَّات التشـريح'},{title:'Introduction to Oral Histology'}];
 assert.deepEqual(filterDirectory(items,'اساسيات تشريح'),[items[0]]);
 assert.deepEqual(filterDirectory(items,'HISTOLOGY introduction'),[items[1]]);
 assert.equal(filterDirectory(items,'   '),items);
 assert.equal(filterDirectory(items,'not found').length,0);
 assert.equal(items.length,2);
});
test('review names are searched through their display field',()=>{
 const items=[{subject_label_snapshot:'Anatomy'}];
 assert.equal(filterDirectory(items,'anatomy',item=>item.subject_label_snapshot).length,1);
});
