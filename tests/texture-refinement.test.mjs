import test from 'node:test';
import assert from 'node:assert/strict';
import {refineRejected} from '../scripts/texture-refinement.mjs';
const tri=[[0,0,0],[4,0,0],[0,4,0]],stats=()=>({splits:0,maxDepth:0});
test('refinement preserves accepted coarse geometry and candidate priority',()=>{
 const calls=[],s=stats(),r=[...refineRejected(tri,['bad','good','unused'],(p,t)=>{calls.push(p);return p==='good'?[1,2,3]:null;},4,s)];
 assert.equal(r.length,1);assert.equal(r[0].triangle,tri);assert.equal(r[0].level,0);
 assert.deepEqual(calls,['bad','good']);assert.equal(s.splits,0);
});
test('rejected parents can yield only independently accepted child geometry',()=>{
 const s=stats(),r=[...refineRejected(tri,['photo'],(p,t)=>Math.max(...t.map(v=>v[0]))<=2?'uv':null,2,s)];
 assert.ok(r.length>0);assert.ok(r.every(r=>r.level>0&&r.triangle.every(v=>v[0]<=2)));
 assert.ok(s.splits<=3);assert.ok(s.maxDepth<=2);
});
test('fully rejected geometry stays unapplied with bounded attempts',()=>{
 let attempts=0;const s=stats();
 assert.deepEqual([...refineRejected(tri,['a','b'],()=>{attempts++;return null;},2,s)],[]);
 assert.equal(attempts,14);assert.deepEqual(s,{splits:3,maxDepth:2});
 assert.deepEqual([...refineRejected(tri,[],()=>assert.fail(),4,stats())],[]);
});
test('zero depth and minimum area never invent smaller accepted samples',()=>{
 const s=stats();assert.deepEqual([...refineRejected(tri,['a'],()=>null,0,s)],[]);
 assert.deepEqual([...refineRejected([[0,0,0],[.1,0,0],[0,.1,0]],['a'],()=>null,4,s)],[]);
 assert.deepEqual(s,{splits:0,maxDepth:0});
});
