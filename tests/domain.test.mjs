import test from 'node:test';
import assert from 'node:assert/strict';
import {fadePixels,imageHash} from '../server/render.mjs';
import {atRevision,progress,stage} from '../shared/catalog.mjs';
test('fade returns exact source and exact wall at endpoints',()=>{const a=Buffer.from([220,30,45,255,255,255,0,255]),b=Buffer.from([120,130,140,255,40,50,60,255]);assert.deepEqual(fadePixels(a,b,2,1,0),a);assert.deepEqual(fadePixels(a,b,2,1,1000),b);assert.deepEqual(fadePixels(a,b,2,1,667),fadePixels(a,b,2,1,667));});
test('unchanged wall never changes throughout fading',()=>{const a=Buffer.from([123,87,60,255]);for(let p=0;p<=1000;p++)assert.deepEqual(fadePixels(a,a,1,1,p),a);});
test('revision intervals are half-open and initial revision never fades',()=>{const rs=[{no:0,start:10,end:20},{no:1,start:20,end:30},{no:2,start:30,end:null}];assert.equal(atRevision(rs,19).no,0);assert.equal(atRevision(rs,20).no,1);assert.equal(atRevision(rs,30).no,2);assert.equal(atRevision(rs,9),undefined);assert.equal(progress(rs[0],11),1000);assert.equal(progress(rs[1],15020),1000);assert.equal(stage(667),'輪郭のみ');});
test('image hash includes dimensions',()=>{const raw=Buffer.alloc(16,255);assert.notEqual(imageHash(raw,2,2),imageHash(raw,4,1));assert.equal(imageHash(raw,2,2),imageHash(raw,2,2));});
