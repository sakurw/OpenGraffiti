import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {triangulate} from './plateau-geometry.mjs';
const dir='data/texture-city/tocho-district-plateau-v4-20261018',asset='public/assets/tocho-district-plateau-v4-20261018';
const scope=JSON.parse(await fs.readFile(dir+'/scope.json','utf8'));
const manifest=JSON.parse(await fs.readFile(asset+'/manifest.json','utf8'));
const selected=new Set(scope.selectedBuildingIds), buildings=new Map();
for(const f of scope.geometryFiles)for(const b of JSON.parse(await fs.readFile(f,'utf8')).buildings)if(selected.has(b.id))buildings.set(b.id,b);
assert.equal(buildings.size,selected.size);
assert.deepEqual(manifest.buildings.map(b=>b.id).sort(),[...selected].sort());
const key=t=>t.map(v=>v.map(x=>Math.fround(x).toString()).join(',')).sort().join('|');
const expected=new Map(),actual=new Map();
for(const [id,b] of buildings){const tris=new Map();for(const p of b.polygons){const t=triangulate(p.rings.map(r=>r.points));for(let i=0;i<t.indices.length;i+=3){const k=key(t.indices.slice(i,i+3).map(j=>t.points[j]));tris.set(k,(tris.get(k)||0)+1);}}expected.set(id,tris);}
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
let windowNonWall=0,unowned=0,triangles=0,roadTriangles=0;
for(const file of [asset+'/district.glb',manifest.centralAsset.path]){
 const doc=await io.read(file);
 for(const n of doc.getRoot().listNodes()){
  const extras=n.getExtras(),id=extras.buildingId;
  if(!n.getMesh())continue;
  assert.deepEqual(n.getTranslation(),[0,0,0]);assert.deepEqual(n.getScale(),[1,1,1]);assert.deepEqual(n.getRotation(),[0,0,0,1]);
  for(const p of n.getMesh().listPrimitives()){
   const material=p.getMaterial().getExtras();
   if(!id){assert.equal(material.surfaceRole,'road','Unexpected non-PLATEAU display object');roadTriangles+=(p.getIndices()?.getCount()||0)/3;continue;}
   assert(selected.has(id),'Non-selected object');
   const map=actual.get(id)||new Map();actual.set(id,map);
   const positions=p.getAttribute('POSITION').getArray(),ix=p.getIndices().getArray();
   assert([...positions].every(Number.isFinite));
   const uv=p.getAttribute('TEXCOORD_0')?.getArray();if(uv)assert([...uv].every(Number.isFinite));
   if(material.windowAllowed&&material.surfaceRole!=='wall')windowNonWall++;
   for(let i=0;i<ix.length;i+=3){const k=key([0,1,2].map(j=>Array.from(positions.slice(ix[i+j]*3,ix[i+j]*3+3))));map.set(k,(map.get(k)||0)+1);triangles++;}
  }
 }
}
for(const [id,tris] of expected)assert.deepEqual(actual.get(id),tris,'Native source triangle mismatch '+id);
assert.equal(actual.size,selected.size);assert.equal(windowNonWall,0);
const old=JSON.parse(await fs.readFile('public/assets/tocho-district-photo-v3-20261018/photo-profiles.json','utf8'));
const current=JSON.parse(await fs.readFile(asset+'/photo-profiles.json','utf8'));
let preserved=0;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const p of old.buildings.filter(p=>p.artwork&&selected.has(p.buildingId))){const q=current.buildings.find(q=>q.buildingId===p.buildingId);assert(q?.artwork);assert.equal(hash(await fs.readFile(asset+'/'+q.artwork)),hash(await fs.readFile('public/assets/tocho-district-photo-v3-20261018/'+p.artwork)));preserved++;}
const result={at:new Date().toISOString(),passed:true,buildingCount:actual.size,triangles,roadTriangles,allBuildingTrianglesExactlyNative:true,syntheticGeometryObjects:unowned,windowsOnNonWall:windowNonWall,oldOwnArtworksPreserved:preserved,blockCoverage:scope.blocks.map(b=>({positions:b.positions,count:b.selectedBuildingIds.length,allPresent:b.selectedBuildingIds.every(id=>actual.has(id))})),userVisualAcceptance:'pending',browserVerification:'separate'};
await fs.writeFile(dir+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
