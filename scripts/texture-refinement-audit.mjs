import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
const area=process.argv[2],all=process.argv[3]==='--all';
assert.ok(['tocho','tokyo-tower'].includes(area));assert.ok(!process.argv[3]||all);
const root='public/assets/texture-poc/experimental/selection/';
const old=JSON.parse(await readFile(`${root}wall-coverage-all/${area}.json`,'utf8'));
const bytes=await readFile(`${root}wall-coverage-refine2${all?'-all':''}/${area}.json`),report=JSON.parse(bytes);
assert.equal(report.refinement.depth,2);assert.equal(report.refinement.policy,'bisect-only-rejected-triangles-retain-seven-point-acceptance-v1');
assert.equal(report.scope.kind,all?'all-buildings':'subset');
const expected=all?old.buildings:old.buildings.filter(b=>report.scope.buildingIds.includes(b.buildingId));
assert.deepEqual(report.buildings.map(b=>b.buildingId),expected.map(b=>b.buildingId));
let addedTriangles=0,addedArea=0,newBuildings=0,oldTriangles=0;
for(let i=0;i<expected.length;i++){
 const b=report.buildings[i],before=expected[i];
 assert.equal(b.triangles,before.triangles+b.refinement.addedTriangles);
 assert.ok(Math.abs(b.projectedArea-before.projectedArea-b.refinement.addedArea)<1e-6);
 assert.ok(b.refinement.maxDepth<=2);assert.ok(b.refinement.addedArea>=0);
 assert.equal(b.diagnostic.attempts,b.triangles+Object.values(b.diagnostic.rejections).reduce((s,n)=>s+n,0));
 addedTriangles+=b.refinement.addedTriangles;addedArea+=b.refinement.addedArea;oldTriangles+=before.triangles;
 if(!before.triangles&&b.triangles)newBuildings++;
}
const io=new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]);
async function triangles(path){
 const bytes=await readFile(path),doc=await io.readBinary(bytes),counts=new Map();let total=0;
 for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
  assert.equal(primitive.getIndices(),null);
  const p=primitive.getAttribute('POSITION').getArray(),uv=primitive.getAttribute('TEXCOORD_0').getArray();
  assert.ok(p instanceof Float32Array);assert.equal(p.length%9,0);assert.equal(uv.length,p.length/3*2);
  assert.ok([...uv].every(Number.isFinite));
  const source=primitive.getMaterial().getBaseColorTexture().getName();
  for(let i=0;i<p.length;i+=9){
   const key=source+':'+Buffer.from(p.buffer,p.byteOffset+i*4,36).toString('base64');
   counts.set(key,(counts.get(key)||0)+1);total++;
  }
 }
 return {counts,total,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const a=await triangles('public'+old.model),b=await triangles('public'+report.model);let retained=0;
for(const [key,count] of b.counts)retained+=Math.min(count,a.counts.get(key)||0);
assert.equal(b.total,report.projectedTriangles);assert.equal(b.total,oldTriangles+addedTriangles);
assert.equal(retained,oldTriangles,'Existing coarse geometry and source assignment must be retained');
if(all)for(const [key,count] of a.counts)assert.ok((b.counts.get(key)||0)>=count,'Existing triangle lost');
const result={area,scope:report.scope,totalBuildings:report.totalBuildings,oldProjectedBuildings:expected.filter(b=>b.triangles).length,projectedBuildings:report.projectedBuildings,newBuildings,oldTriangles,retainedTriangles:retained,addedTriangles,addedArea,modelSha256:b.sha256,reportSha256:createHash('sha256').update(bytes).digest('hex'),note:'Actual GLB source-plus-coordinate multiset checked. Added fragments remain provisional; this is not wall-photo identity or complete facade coverage.'};
await writeFile(`data/texture-city/refinement-audit-${area}${all?'-all':''}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
