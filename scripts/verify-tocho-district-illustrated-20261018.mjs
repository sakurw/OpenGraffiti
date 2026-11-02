import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {triangulate} from './plateau-geometry.mjs';
const dir='data/texture-city/tocho-district-illustrated-20261018',asset='public/assets/tocho-district-illustrated-20261018';
const scope=JSON.parse(await fs.readFile(dir+'/scope.json','utf8')),report=JSON.parse(await fs.readFile(dir+'/build-report.json','utf8')),manifest=JSON.parse(await fs.readFile(asset+'/manifest.json','utf8'));
const selected=new Set(scope.selectedBuildingIds),central='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const buildings=new Map();for(const f of report.geometryFiles)for(const b of JSON.parse(await fs.readFile(f,'utf8')).buildings)if(selected.has(b.id))buildings.set(b.id,b);
assert.equal(selected.size,buildings.size);assert.equal(manifest.buildingCount,selected.size);
assert.deepEqual([...new Set(manifest.buildings.map(b=>b.id))].sort(),[...selected].sort());
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(asset+'/district.glb'),seen=new Map();
function triKey(tri){return tri.map(p=>p.map(v=>Math.fround(v).toString()).join(',')).sort().join('|');}
const expected=new Map();
for(const [id,b]of buildings){if(id===central)continue;const map=new Map();for(const p of b.polygons){const t=triangulate(p.rings.map(r=>r.points));for(let k=0;k<t.indices.length;k+=3){const key=triKey(t.indices.slice(k,k+3).map(i=>t.points[i]));map.set(key,(map.get(key)||0)+1);}}expected.set(id,map);}
let triangles=0;
for(const n of doc.getRoot().listNodes()){
 const id=n.getExtras().buildingId;if(!id)continue;assert(selected.has(id)&&id!==central);assert.deepEqual(n.getTranslation(),[0,0,0]);assert.deepEqual(n.getScale(),[1,1,1]);const actual=seen.get(id)??new Map();seen.set(id,actual);
 for(const p of n.getMesh().listPrimitives()){
  const a=p.getAttribute('POSITION'),ix=p.getIndices().getArray(),arr=a.getArray();assert([...arr].every(Number.isFinite));
  for(let k=0;k<ix.length;k+=3){const key=triKey([0,1,2].map(j=>Array.from(arr.slice(ix[k+j]*3,ix[k+j]*3+3))));actual.set(key,(actual.get(key)||0)+1);triangles++;}
  const uv=p.getAttribute('TEXCOORD_0').getArray();assert([...uv].every(Number.isFinite));
  if(p.getMaterial().getExtras().windowAllowed){assert.equal(p.getMaterial().getExtras().surfaceRole,'wall');assert([...uv].every(v=>v>=0&&v<=1));}
 }
}
assert.equal(seen.size,selected.size-1);for(const [id,want]of expected)assert.deepEqual([...seen.get(id)].sort(),[...want].sort(),'Native geometry changed: '+id);
const semanticReport=report.polygons.filter(p=>p.windows&&(p.role!=='wall'||p.semantic?.installation||['RoofSurface','GroundSurface','BuildingInstallation'].includes(p.semantic?.type)));assert.equal(semanticReport.length,0);
const centralFile='public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb',centralHash=crypto.createHash('sha256').update(await fs.readFile(centralFile)).digest('hex');assert.equal(centralHash,'36097e9604a487d6173052a3f49d1a87815af48fc809f40928df920693f259a6');
const result={passed:true,buildingCount:selected.size,neighborBuildingCount:seen.size,neighborTriangles:triangles,allSelectedBuildingsPresent:true,allNativeTrianglesPresentExactlyOnce:true,centralApprovedAssetUnchanged:true,windowsOnEquipmentOrRoof:0,finiteWindowUVs:true,appearanceApproval:'requires user review',at:new Date().toISOString()};await fs.writeFile(dir+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
