import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateSnapReports} from '../scripts/texture-snap-aggregate.mjs';
import {combineSnapReports} from '../scripts/texture-snap-combined.mjs';
const catalog={buildings:['a','b'].map(id=>({id,areaId:'tocho',wallArea:100}))};
const make=(id)=>({caseId:id,areaId:'tocho',model:`/${id}.glb`,registration:'estimated-unverified',snapCommit:'pinned',
 buildings:[{buildingId:id,projectedArea:20,sourceIds:[id],camera:{position:[1,2,3]},minimumHeight:10}],
 sources:[{id,sourceSha256:id}],polygons:[{polygonId:id,area:20,triangles:2}],camera:{position:[1,2,3]},minimumHeight:10});
test('SNAP aggregation retains both independently registered buildings and their cameras',()=>{
 const r=aggregateSnapReports([make('b'),make('a')],'tocho',catalog);
 assert.equal(r.projectedBuildings,2);assert.deepEqual(r.buildings.map(b=>b.buildingId),['a','b']);
 assert.equal(r.sources.length,2);assert.equal(r.polygons.length,2);assert.equal(r.camera,undefined);
 assert.deepEqual(r.buildings[1].camera.position,[1,2,3]);
});
test('SNAP aggregation never double-counts overlapping building cases',()=>{
 assert.throws(()=>aggregateSnapReports([make('a'),{...make('a'),caseId:'other'}],'tocho',catalog),/geometric union/);
});
test('SNAP aggregation keeps an area without registered images unapplied',()=>{
 const r=aggregateSnapReports([make('a')],'tokyo-tower',catalog);
 assert.equal(r.projectedBuildings,0);assert.equal(r.model,'');assert.equal(r.registration,'not-applied');
});
test('SNAP aggregation rejects excessive area and unknown buildings',()=>{
 const a=make('a');a.buildings[0].projectedArea=101;
 assert.throws(()=>aggregateSnapReports([a],'tocho',catalog),/building area/);
 assert.throws(()=>aggregateSnapReports([make('c')],'tocho',catalog),/building area/);
});
test('combined SNAP preserves disjoint reports and explicitly records unobserved buildings',()=>{
 const reports=['a','b'].map(id=>aggregateSnapReports([make(id)],'tocho',catalog));
 const r=combineSnapReports(reports,'tocho',{buildings:[...catalog.buildings,{id:'c',areaId:'tocho',wallArea:100}]});
 assert.equal(r.projectedBuildings,2);assert.equal(r.coverage.length,3);assert.equal(r.coverage[2].outcome,'not-applied');
 assert.deepEqual(r.buildings[0],reports[0].buildings[0]);assert.equal(r.sources.length,2);
 assert.throws(()=>combineSnapReports([reports[0],reports[0]],'tocho',catalog),/geometric union/);
 assert.throws(()=>combineSnapReports([reports[0],{...reports[1],snapCommit:'other'}],'tocho',catalog),/version mismatch/);
});
