import test from 'node:test';
import assert from 'node:assert/strict';
import {areaSamples,coveragePriority} from '../scripts/texture-photo-selection.mjs';
test('area-stratified samples are bounded, deterministic and area weighted',()=>{
 const triangles=[1,1,1,100,1,1],samples=areaSamples(triangles,n=>n,4);
 assert.ok(samples.length<=4);assert.equal(samples.reduce((s,p)=>s+p.weight,0),105);
 assert.deepEqual(samples,areaSamples(triangles,n=>n,4));
 assert.ok(samples.some(s=>s.index===3));assert.deepEqual(areaSamples([],n=>n),[]);
 assert.throws(()=>areaSamples([0],n=>n),/area/);
});
test('coverage ranking prefers broad support but retains every fallback candidate',()=>{
 const samples=[{triangle:0,weight:3},{triangle:1,weight:4},{triangle:2,weight:5}];
 const candidates=[{id:'fragment',ok:[0]},{id:'broad',ok:[0,1,2]},{id:'absent',ok:[]},{id:'tie',ok:[0]}];
 const ranked=coveragePriority(candidates,samples,(c,t)=>c.ok.includes(t));
 assert.deepEqual(ranked.map(r=>r.candidate.id),['broad','fragment','tie','absent']);
 assert.equal(ranked[0].area,12);assert.equal(ranked[0].acceptedSamples,3);
 for(const triangle of [0,1,2,3])assert.equal(candidates.some(c=>c.ok.includes(triangle)),ranked.some(r=>r.candidate.ok.includes(triangle)));
});
