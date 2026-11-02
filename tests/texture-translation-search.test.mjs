import test from 'node:test';
import assert from 'node:assert/strict';
import {searchTranslation} from '../scripts/texture-translation-search.mjs';
test('translation diagnostic recovers a bounded synthetic shift',()=>{
 const goal=[3.5,-1.25,2];const r=searchTranslation(v=>v.reduce((sum,n,i)=>sum+(n-goal[i])**2,0));
 assert.deepEqual(r.offset,goal);assert.equal(r.score,0);assert.equal(r.atBound,false);
});
test('translation diagnostic keeps flat geometry unchanged and flags a boundary optimum',()=>{
 assert.deepEqual(searchTranslation(()=>4).offset,[0,0,0]);
 const r=searchTranslation(v=>(v[0]-30)**2);assert.equal(r.offset[0],10);assert.equal(r.atBound,true);
 assert.throws(()=>searchTranslation(()=>NaN),/Non-finite/);
 assert.throws(()=>searchTranslation(()=>0,{bounds:[-1,1,1]}),/Invalid/);
 assert.deepEqual(searchTranslation(v=>v.reduce((s,n)=>s+(n-1)**2,0),{bounds:[2,0,2]}).offset,[1,0,1]);
});
