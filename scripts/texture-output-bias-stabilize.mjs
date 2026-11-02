// Stabilize only NEW refined triangles whose rendered centroid crosses a depth
// discontinuity after the 2.5cm z-fighting bias. Old triangles are immutable.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
import {BufferGeometry,Float32BufferAttribute,Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {cameraFor} from './texture-camera.mjs';
import {spatialEvidence} from './texture-spatial-evidence.mjs';
import {depthDisagreement} from './texture-spatial-depth.mjs';
import {triangulate} from './plateau-geometry.mjs';
const [area,option]=process.argv.slice(2);assert.ok(['tocho','tokyo-tower'].includes(area));assert.ok(!option||option==='--apply');
const apply=option==='--apply',root='public/assets/texture-poc/experimental/selection',path=`${root}/wall-coverage-refine2-all/${area}.json`;
const reportBytes=await readFile(path),report=JSON.parse(reportBytes),old=JSON.parse(await readFile(`${root}/wall-coverage-all/${area}.json`,'utf8'));
assert.equal(report.scope.kind,'all-buildings');assert.equal(report.refinement.depth,2);
assert.ok(!report.geometryBiasStabilization,'Already stabilized; audit existing output instead');
const io=new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]),modelBytes=await readFile('public'+report.model),doc=await io.readBinary(modelBytes),oldDoc=await io.read('public'+old.model);
const hash=b=>createHash('sha256').update(b).digest('hex');
const key=(id,p,i)=>id+':'+Buffer.from(p.buffer,p.byteOffset+i*4,36).toString('base64');
const oldCounts=new Map();for(const m of oldDoc.getRoot().listMeshes())for(const prim of m.listPrimitives()){
 const id=prim.getMaterial().getBaseColorTexture().getName(),p=prim.getAttribute('POSITION').getArray();
 for(let i=0;i<p.length;i+=9){const k=key(id,p,i);oldCounts.set(k,(oldCounts.get(k)||0)+1);}
}
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8')),a=catalog.areas.find(a=>a.id===area),g=JSON.parse(await readFile(`data/plateau/${a.dataset}/${area==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
const vertices=[];for(const b of g.buildings)for(const wall of b.walls){const t=triangulate(wall.rings.map(r=>r.points));for(const i of t.indices)vertices.push(...t.points[i]);}
const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(vertices,3)),bvh=new MeshBVH(geometry),fixes=[],unresolved=[];
for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives()){
 const id=prim.getMaterial().getBaseColorTexture().getName(),source=report.sources.find(s=>s.id===id),photo=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${id}.json`,'utf8'));
 assert.equal(source.sourceSha256,photo.sha256);const evidence=await spatialEvidence(photo);assert.equal(source.spatialEvidence.key,evidence.key);
 const camera=cameraFor({...photo,exif_orientation:source.exifOrientation},[0,0,0],source.height.height);camera.position=source.cameraPosition;
 const p=prim.getAttribute('POSITION').getArray();
 const sample=point=>{
  const v=new Vector3(point[0]-camera.position[0],camera.position[2]-point[2],point[1]-camera.position[1]).applyMatrix4(camera.rotation),depth=evidence.sampler.sample(v.toArray());
  return {distance:v.length(),depth,conflict:depthDisagreement(v.length(),depth)};
 };
 for(let i=0;i<p.length;i+=9){
  const k=key(id,p,i),count=oldCounts.get(k)||0;if(count){oldCounts.set(k,count-1);continue;}
  if(!evidence.sampler)continue;
  const original=Array.from(p.slice(i,i+9)),center=[0,1,2].map(j=>(p[i+j]+p[i+j+3]+p[i+j+6])/3),before=sample(center);
  // Use exactly the existing output audit's offset-jitter tolerance to identify
  // its failing centroids. Candidate corrections must pass the stricter policy.
  if(before.depth===null||!(Math.max(before.distance,before.depth)>2.02*Math.min(before.distance,before.depth)&&Math.abs(before.distance-before.depth)>10.1))continue;
  const hit=bvh.closestPointToPoint(new Vector3(...center),{},0,.026);
  if(!hit||hit.distance<.0001){unresolved.push({id,triangle:i/9,before,reason:'cannot-establish-original-wall-plane'});continue;}
  const toward=hit.point.toArray().map((v,j)=>v-center[j]);let fixed=null;
  // Keep a positive bias; do not shift onto or behind the wall, change UVs,
  // choose another photo, discard triangles, or relax a depth threshold.
  for(const fraction of [.5,.75,.875]){
   const candidate=original.map((v,j)=>Math.fround(v+toward[j%3]*fraction));
   const points=[0,3,6].map(start=>candidate.slice(start,start+3)),centroid=[0,1,2].map(j=>points.reduce((sum,q)=>sum+q[j],0)/3);
   const samples=[...points,centroid,...points.map((q,j)=>q.map((v,k)=>(v+points[(j+1)%3][k])/2))],depths=samples.map(sample);
   if(depths.some(d=>d.conflict))continue;
   fixed={id,triangle:i/9,originalPositions:original,positions:candidate,before,after:depths[3],wallDistance:hit.distance,fraction,maximumDisplacement:Math.max(...points.map((q,j)=>Math.hypot(...q.map((v,k)=>v-original[j*3+k]))))};
   for(let j=0;j<9;j++)p[i+j]=candidate[j];break;
  }
  if(fixed)fixes.push(fixed);else unresolved.push({id,triangle:i/9,before,reason:'positive-bias-candidates-still-conflict'});
 }
 evidence.sampler?.dispose();
}
geometry.dispose();assert.ok([...oldCounts.values()].every(n=>n===0),'An old source triangle is missing');
const result={area,apply,inputModelSha256:hash(modelBytes),inputReportSha256:hash(reportBytes),fixes,unresolved,policy:'reduce-bias-towards-original-wall-only-for-new-refined-triangles-v1'};
await mkdir('data/texture-city/output-bias',{recursive:true});
await writeFile(`data/texture-city/output-bias/${area}${apply?'-apply':'-dry-run'}.json`,JSON.stringify(result,null,2));
assert.equal(unresolved.length,0,'Cannot safely stabilize all conflicts');
if(apply&&fixes.length){
 // Content-addressed recoverable copies of generated inputs, not source models.
 await writeFile(`data/texture-city/output-bias/${result.inputModelSha256}.glb`,modelBytes,{flag:'wx'});
 await writeFile(`data/texture-city/output-bias/${result.inputReportSha256}.json`,reportBytes,{flag:'wx'});
 report.geometryBiasStabilization={policy:result.policy,adjustedTriangles:fixes.length,maximumDisplacement:Math.max(...fixes.map(f=>f.maximumDisplacement)),inputModelSha256:result.inputModelSha256,inputReportSha256:result.inputReportSha256,fixes};
 await io.write('public'+report.model,doc);await writeFile(path,JSON.stringify(report,null,2));
}
console.log(JSON.stringify(result,null,2));
