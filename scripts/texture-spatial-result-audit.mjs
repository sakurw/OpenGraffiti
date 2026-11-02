// Validate the actual generated depth-filtered models, not just the policy label.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
import {Vector3} from 'three';
import assert from 'node:assert/strict';
import {spatialEvidence} from './texture-spatial-evidence.mjs';
import {cameraFor} from './texture-camera.mjs';
import {photoQualityEvidence,PHOTO_QUALITY_POLICY} from './texture-photo-quality.mjs';
const area=process.argv[2];if(!['tocho','tokyo-tower'].includes(area))throw Error('Specify area');
const selection=process.argv[3];if(selection&&!['wall-coverage','triangle-first','wall-coverage-all','triangle-first-all','wall-coverage-refine2','wall-coverage-refine2-all'].includes(selection))throw Error('Unknown selection audit');
const root='public/assets/texture-poc/experimental'+(selection?`/selection/${selection}`:''),reportBytes=await readFile(`${root}/${area}.json`),report=JSON.parse(reportBytes);
const baseline=JSON.parse(await readFile(selection?`public/assets/texture-poc/experimental/${area}.json`:`data/texture-city/depth-baseline-${area}.json`,'utf8'));
assert.ok(report.spatialDepthPolicy?.includes('Try next photo'));
const scopeIds=report.scope?.kind==='subset'?report.scope.buildingIds:null;
if(scopeIds){assert.ok(selection);assert.equal(new Set(scopeIds).size,scopeIds.length);assert.equal(report.totalBuildings,scopeIds.length);}
const expected=scopeIds?baseline.buildings.filter(b=>scopeIds.includes(b.buildingId)):baseline.buildings;
assert.deepEqual(report.buildings.map(b=>b.buildingId),expected.map(b=>b.buildingId));
const modelBytes=await readFile('public'+report.model),doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]).readBinary(modelBytes);
const sources=new Map(report.sources.map(s=>[s.id,s])),errors=[],stats={triangles:0,depthTested:0,depthSupported:0,conflicts:0};
for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
 const id=primitive.getMaterial()?.getBaseColorTexture()?.getName(),s=sources.get(id);assert.ok(s);
 const photo=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${id}.json`,'utf8'));
 assert.equal(photo.sha256,s.sourceSha256);
 if(report.photoQualityPolicy){
  assert.equal(report.photoQualityPolicy,PHOTO_QUALITY_POLICY);
  const quality=await photoQualityEvidence(photo),saved=report.sourceQuality.find(p=>p.id===id);
  assert.ok(saved);assert.equal(saved.key,quality.key);assert.equal(saved.sourceSha256,photo.sha256);
  assert.notEqual(quality.status,'low-quality','Low-quality image remains in actual GLB');
  assert.ok(!report.qualityExcludedPhotos.some(p=>p.id===id));
 }
 const e=await spatialEvidence(photo);assert.equal(e.key,s.spatialEvidence.key);
 const camera=cameraFor({...photo,exif_orientation:s.exifOrientation},[0,0,0],s.height.height);assert.ok(camera);camera.position=s.cameraPosition;
 const positions=primitive.getAttribute('POSITION').getArray();assert.equal(positions.length%9,0);assert.equal(primitive.getIndices(),null);
 for(let i=0;i<positions.length;i+=9){
  stats.triangles++;if(!e.sampler)continue;
  const p=[0,1,2].map(k=>(positions[i+k]+positions[i+k+3]+positions[i+k+6])/3-camera.position[k]);
  const v=new Vector3(p[0],-p[2],p[1]).applyMatrix4(camera.rotation),depth=e.sampler.sample(v.toArray());stats.depthTested++;
  if(depth===null)continue;stats.depthSupported++;
  // Output geometry is offset 2.5cm from the tested wall. Ignore threshold jitter.
  const distance=v.length(),foreground=distance>2.02*depth&&distance-depth>10.1;
  const background=report.spatialDepthPolicy.includes('bidirectional')&&depth>2.02*distance&&depth-distance>10.1;
  if(foreground||background){stats.conflicts++;if(errors.length<20)errors.push({id,triangle:i/9,distance,depth,direction:foreground?'foreground':'background'});}
 }
 e.sampler?.dispose();
}
assert.equal(stats.triangles,report.projectedTriangles);
let rejected=0,backgroundRejected=0;for(const b of report.buildings){
 assert.equal(b.diagnostic.attempts,b.triangles+Object.values(b.diagnostic.rejections).reduce((s,n)=>s+n,0));
 assert.ok(b.diagnostic.depthSupportedSamples<=b.diagnostic.depthSamples);
 rejected+=b.diagnostic.rejections['photo-depth-foreground']||0;
 backgroundRejected+=b.diagnostic.rejections['photo-depth-background']||0;
}
assert.ok(rejected>0,'Depth policy must actually reject candidates');
const result={area,modelSha256:createHash('sha256').update(modelBytes).digest('hex'),reportSha256:createHash('sha256').update(reportBytes).digest('hex'),...stats,rejectedAttempts:rejected,
 qualityExcludedPhotos:report.qualityExcludedPhotos?.length??null,backgroundRejectedAttempts:backgroundRejected,bidirectional:report.spatialDepthPolicy.includes('bidirectional'),beforeBuildings:expected.filter(b=>b.triangles>0).length,afterBuildings:report.projectedBuildings,errors,
 note:'Checks generated triangle centroids, source evidence hashes and complete building accounting. SfM and correspondence remain unverified; this is not facade reconstruction accuracy.'};
await writeFile(`data/texture-city/spatial/result-audit-${area}${selection?'-'+selection:''}.json`,JSON.stringify({...result,scope:report.scope},null,2));console.log(result);
assert.equal(stats.conflicts,0,'Output still contains large depth conflicts');
