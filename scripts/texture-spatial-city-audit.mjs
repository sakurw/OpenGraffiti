// Read-only depth-consistency survey of the actual published GLBs.
// SfM is estimated, not a measurement certificate; this script never removes texture.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
import {Vector3} from 'three';
import {cameraFor} from './texture-camera.mjs';
import {decodeSpatialMesh,spatialDepthSampler} from './texture-spatial-depth.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const area=process.argv[2];if(!['tokyo-tower','tocho'].includes(area))throw Error('Specify a city area');
const reportBytes=await readFile(`public/assets/texture-poc/experimental/${area}.json`),report=JSON.parse(reportBytes);
const modelBytes=await readFile('public'+report.model);
const doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]).readBinary(modelBytes);
const sources=new Map(report.sources.map(s=>[s.id,s])),rows=[];
for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
 const id=primitive.getMaterial()?.getBaseColorTexture()?.getName(),source=sources.get(id);
 if(!source)throw Error('Model source is missing from report');
 const row={id,cameraType:source.cameraType,sampled:0,supported:0,behindOverTwice:0,inFrontUnderHalf:0};
 try{
  const meta=JSON.parse(await readFile(`data/texture-city/spatial/${id}.json`,'utf8'));
  if(meta.id!==id||meta.sourceSha256&&meta.sourceSha256!==source.sourceSha256)throw Error('Depth source mismatch');
  if(!meta.resources?.mesh?.available){row.status='mesh-not-provided';rows.push(row);continue;}
  if(!(meta.atomicScale>0&&Number.isFinite(meta.atomicScale))){row.status='depth-scale-unavailable';rows.push(row);continue;}
  const bytes=await readFile(`data/texture-city/spatial/${id}.mesh.bin`);
  if(sha(bytes)!==meta.resources.mesh.sha256)throw Error('Depth mesh hash mismatch');
  const photo=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${id}.json`,'utf8'));
  if(photo.sha256!==source.sourceSha256)throw Error('Photo source mismatch');
  const camera=cameraFor({...photo,exif_orientation:source.exifOrientation},[0,0,0],source.height.height);
  if(!camera)throw Error('Invalid source camera');camera.position=source.cameraPosition;
  const sampler=spatialDepthSampler(decodeSpatialMesh(bytes),meta.atomicScale,{cameraType:source.cameraType});
  const positions=primitive.getAttribute('POSITION').getArray();
  if(primitive.getIndices()||positions.length%9)throw Error('Unexpected projection topology');
  const total=positions.length/9,count=Math.min(total,32),ratios=[];
  for(let n=0;n<count;n++){
   const index=Math.floor((n+.5)*total/count)*9;
   const p=[0,1,2].map(k=>(positions[index+k]+positions[index+3+k]+positions[index+6+k])/3-camera.position[k]);
   const v=new Vector3(p[0],-p[2],p[1]).applyMatrix4(camera.rotation),depth=sampler.sample(v.toArray());
   row.sampled++;if(!(depth>0))continue;row.supported++;
   const ratio=v.length()/depth;ratios.push(ratio);
   if(ratio>2)row.behindOverTwice++;if(ratio<.5)row.inFrontUnderHalf++;
  }
  ratios.sort((a,b)=>a-b);row.medianRatio=ratios.length?ratios[Math.floor(ratios.length/2)]:null;
  row.qualityScore=meta.qualityScore;row.status='sampled';row.depthSha256=meta.resources.mesh.sha256;
 }catch(e){row.status=e.code==='ENOENT'?'depth-not-acquired':'invalid-evidence';row.error=e.code==='ENOENT'?undefined:e.message;}
 rows.push(row);
}
const summary={area,modelSha256:sha(modelBytes),reportSha256:sha(reportBytes),sourcePrimitives:rows.length,
 statuses:Object.fromEntries([...Map.groupBy(rows,r=>r.status)].map(([k,v])=>[k,v.length])),
 ...Object.fromEntries(['sampled','supported','behindOverTwice','inFrontUnderHalf'].map(k=>[k,rows.reduce((s,r)=>s+r[k],0)])),
 policy:'Up to 32 evenly spaced triangle centroids per source primitive. Raw SfM depths divided by atomic scale; no viewer depth clamp. Perspective corner triangles excluded. Ratio thresholds are diagnostic only.',
 limitation:'Sparse reconstructed depth and camera registration are unverified. Counts are samples, not buildings or area. No texture changed.',rows};
await writeFile(`data/texture-city/spatial/city-audit-${area}.json`,JSON.stringify(summary,null,2));
console.log({...summary,rows:undefined});
if(rows.some(r=>r.status==='invalid-evidence'))process.exitCode=2;
