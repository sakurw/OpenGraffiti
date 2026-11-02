import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),dir='public/assets/tocho-landmark/wall-hour-20261018';
const report=JSON.parse(await fs.readFile(dir+'/patch-view.json','utf8'));
const before=await io.read(report.baseline),after=await io.read(dir+'/tocho-context-illustrated-v1.glb');
const ps=d=>d.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const A=ps(before),B=ps(after),patch=B.filter(p=>p.getExtras().wallHourPatch),retained=B.filter(p=>!p.getExtras().wallHourPatch);
const hash=a=>crypto.createHash('sha256').update(a).digest('hex');
const attrHash=a=>a?hash(Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength)):null;
const tris=p=>(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;
assert.equal(retained.length,A.length);assert.equal(patch.length,2);
const changes=new Set(report.changedParts.map(p=>p.id));
let untouched=0;
for(let i=0;i<A.length;i++){
 assert.equal(retained[i].getMaterial().getName(),A[i].getMaterial().getName());
 assert.equal(hash(retained[i].getMaterial().getBaseColorTexture().getImage()),hash(A[i].getMaterial().getBaseColorTexture().getImage()));
 if(changes.has(i))continue;
 assert.equal(attrHash(A[i].getIndices()),attrHash(retained[i].getIndices()));
 for(const sem of A[i].listSemantics())assert.equal(attrHash(A[i].getAttribute(sem)),attrHash(retained[i].getAttribute(sem)),`${i}/${sem}`);
 untouched++;
}
let uvValid=true,positionsInside=true;
for(const p of patch){const uv=p.getAttribute('TEXCOORD_0').getArray(),pos=p.getAttribute('POSITION').getArray();for(let i=0;i<uv.length;i+=2)if(uv[i]<.055-1e-6||uv[i]>.91+1e-6||uv[i+1]<-1e-6||uv[i+1]>1+1e-6)uvValid=false;for(let i=0;i<pos.length;i+=3){const t=pos[i]*report.tangent[0]+pos[i+2]*report.tangent[2];if(t<report.selection.loT-1e-5||t>report.selection.hiT+1e-5||pos[i+1]<report.selection.minY-1e-5||pos[i+1]>report.selection.maxY+1e-5)positionsInside=false;}}
assert(uvValid&&positionsInside);
const patches=await Promise.all(['patch-photo','patch-v32','patch-illustrated-v1'].map(n=>io.read(dir+'/'+n+'.glb')));
function faceKeys(d){const keys=[];for(const p of ps(d)){const a=p.getAttribute('POSITION').getArray();for(let i=0;i<a.length;i+=9)keys.push([0,3,6].map(k=>[0,1,2].map(j=>Math.round(a[i+k+j]*10000)).join(',')).sort().join('|'));}return keys.sort();}
assert.deepEqual(faceKeys(patches[0]),faceKeys(patches[1]));assert.deepEqual(faceKeys(patches[0]),faceKeys(patches[2]));
const result={date:new Date().toISOString(),result:'geometry-scope-and-uv-pass',untouchedPrimitiveCount:untouched,modifiedOriginalPrimitives:[...changes],newPatchPrimitives:patch.length,baselineTriangles:A.reduce((s,p)=>s+tris(p),0),candidateTriangles:B.reduce((s,p)=>s+tris(p),0),patchTriangles:patch.reduce((s,p)=>s+tris(p),0),sameGeometryForThreeComparisons:true,originalMaterialTexturesUnchanged:true,uvValid,positionsInside,partitionAreaError:report.partitionAreaError,humanAppearanceApproved:false};
await fs.writeFile('data/texture-city/tocho-wall-hour-20261018/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
