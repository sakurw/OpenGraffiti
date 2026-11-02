import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {flatManifest,flatSurface} from '../src/pv-layout.ts';
import {meshHeight} from '../src/pv-ground.ts';
const dir='public/assets/pv-adopted-20261029/',read=async n=>JSON.parse(await fs.readFile(dir+n));
const original=await read('manifest.json'),layout=await read('flat-layout.json'),source=await new NodeIO().read(dir+'city.glb'),flat=flatManifest(original,layout),field=flatSurface(layout),by=new Map(original.buildings.flatMap(b=>b.parts.map(p=>[p,b.id]))),bottoms=new Map();
let vertices=0,maxContactError=0,roadChecks=0;
for(const mesh of source.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
 const id=by.get(p.getMaterial()?.getExtras().partKey);if(!id)continue;
 const a=p.getAttribute('POSITION').getArray(),offset=layout.offsets[id];assert(Number.isFinite(offset));
 for(let i=0;i<a.length;i+=3){const y=a[i+1]+offset;assert(y>=-1e-6,'buried building vertex');bottoms.set(id,Math.min(bottoms.get(id)??Infinity,y));vertices++;}
}
assert.equal(bottoms.size,127);for(const y of bottoms.values()){maxContactError=Math.max(maxContactError,Math.abs(y));assert(Math.abs(y)<1e-6);}
for(let i=0;i<original.buildings.length;i++){const a=original.buildings[i],b=flat.buildings[i];for(const j of [0,2,3,5])assert.equal(a.bounds[j],b.bounds[j]);assert(Math.abs((b.bounds[4]-b.bounds[1])-(a.bounds[4]-a.bounds[1]))<1e-9);}
for(const road of (await read('roads.json')).roads){for(const ring of road.rings||[])for(const p of ring){assert.equal(meshHeight(field,p[0],p[1]),0,'road/land missing or non-flat');roadChecks++;}const path=road.path||[road.start,road.end];for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5));for(let n=0;n<=steps;n++){assert.equal(meshHeight(field,a[0]+(b[0]-a[0])*n/steps,a[1]+(b[1]-a[1])*n/steps),0);roadChecks++;}}}
const hash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex');
assert.equal(await hash(dir+'city.glb'),original.modelSha256);
// The recovery terrain stays byte-identical to this session's snapshot.
for(const [name,expected]of Object.entries(layout.recovery.files))assert.equal(await hash(dir+name),expected,'Recovery asset was changed');
const report={passed:true,buildings:bottoms.size,vertices,roadChecks,maxContactError,planeHeight:0,sourceModelUnchanged:true,recoveryTerrainUnchanged:true,translationOnly:true};
await fs.writeFile(dir+'flat-layout-audit.json',JSON.stringify(report,null,2)+'\n');console.log(report);
