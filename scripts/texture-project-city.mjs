// Experimental real-photo projection. NEVER writes the verified patch registry.
// Pose estimates, semantic classification and registration are not ground truth.
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BufferGeometry,Float32BufferAttribute,Ray,Vector3,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
import sharp from 'sharp';
import {cameraFor,roadHeight,projectPhoto,overlapsPhoto} from './texture-camera.mjs';
import {triangulate,sub,cross,dot} from './plateau-geometry.mjs';
import {cropTextureRegion} from './texture-uv.mjs';
import {roadSurfaceHeight} from './texture-road-surface.mjs';
import {packMask,maskContains} from './texture-mask.mjs';
import {terrainFor} from './texture-terrain.mjs';
import {checkpointKey,loadCheckpoint,saveCheckpoint} from './texture-checkpoint.mjs';
import {spatialEvidence} from './texture-spatial-evidence.mjs';
import {depthDisagreement} from './texture-spatial-depth.mjs';
import {photoQualityEvidence,PHOTO_QUALITY_POLICY} from './texture-photo-quality.mjs';
import {areaSamples,coveragePriority} from './texture-photo-selection.mjs';
import {refineRejected} from './texture-refinement.mjs';
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
// Release native image/GLB allocations between cities; isolate failures by area.
if(!process.argv[2]){
 const runtimeFlags=process.execArgv.filter(flag=>['--no-opt','--no-maglev','--jitless'].includes(flag));
 for(const area of catalog.areas){const child=spawnSync(process.execPath,[...runtimeFlags,'--max-old-space-size=8192',fileURLToPath(import.meta.url),area.id],{stdio:'inherit'});if(child.error||child.status!==0)throw Error(`Projection ${area.id} failed: status=${child.status}, signal=${child.signal}, error=${child.error?.message||''}`);}
 process.exit(0);
}
const selectedArea=catalog.areas.find(a=>a.id===process.argv[2]);if(!selectedArea)throw Error('Unknown projection area');
const options=Object.fromEntries(process.argv.slice(3).map(arg=>{const match=/^--(selection|buildings|refine)=(.+)$/.exec(arg);if(!match)throw Error('Unknown projection option');return [match[1],match[2]];}));
const refinementDepth=Number(options.refine||0);
if(options.refine&&(!options.selection||!['1','2','3','4'].includes(options.refine)))throw Error('Refinement requires separate selection and depth 1-4');
if(options.selection&&!['wall-coverage','triangle-first'].includes(options.selection))throw Error('Unknown photo selection method');
if(options.buildings&&!options.selection)throw Error('Subset generation requires a separate selection output');
const selectedIds=options.buildings?.split(',');
if(selectedIds&&(!selectedIds.length||new Set(selectedIds).size!==selectedIds.length||selectedIds.some(id=>!/^bldg_[a-f0-9-]{36}$/.test(id))))throw Error('Invalid subset building IDs');
const photoRoot='data/texture-city/photos/mapillary',maskRoot='data/texture-city/facade-masks';
const requiredFacadePolicy='intersect-cityscapes-building-and-ade20k-building-family-v2';
const output='public/assets/texture-poc/experimental'+(options.selection?`/selection/${options.selection}${refinementDepth?'-refine'+refinementDepth:''}${selectedIds?'':'-all'}`:'');await mkdir(output,{recursive:true});
const metas=[],skippedPhotos=[],unavailableCameras=[],qualityExcludedPhotos=[];
for(const f of await readdir(photoRoot))if(/^\d+\.json$/.test(f)){
 const p=JSON.parse(await readFile(`${photoRoot}/${f}`,'utf8'));
 if(!['spherical','equirectangular','perspective'].includes(p.camera_type)){unavailableCameras.push({id:p.id,reason:'missing-or-unsupported-camera-type'});continue;}
 // Enrichment never overwrites the original photo or acquisition metadata.
 if(p.exif_orientation===undefined){
  try{const o=JSON.parse(await readFile(`data/texture-city/orientation/${p.id}.json`,'utf8'));if(o.id!==p.id||o.width!==p.width||o.height!==p.height)throw Error('Orientation metadata mismatch');p.exif_orientation=o.exif_orientation;}
  catch(e){skippedPhotos.push({id:p.id,reason:e.code==='ENOENT'?'orientation-metadata-pending':'orientation-metadata-invalid'});continue;}
 }
 if(![1,3,6,8].includes(p.exif_orientation)){skippedPhotos.push({id:p.id,reason:'unsupported-orientation'});continue;}
 const location=cameraFor(p,selectedArea.origin,0)?.position;if(!location){unavailableCameras.push({id:p.id,reason:'missing-calibrated-position-or-rotation'});continue;}
 if(location[0]<selectedArea.bounds[0]-150||location[0]>selectedArea.bounds[1]+150||location[2]<selectedArea.bounds[2]-150||location[2]>selectedArea.bounds[3]+150)continue;
 p.quality=await photoQualityEvidence(p);
 if(p.quality.status==='low-quality'){qualityExcludedPhotos.push({id:p.id,sourceSha256:p.sha256,...p.quality});continue;}
 try{const provenance=JSON.parse(await readFile(`${maskRoot}/${p.id}.json`,'utf8'));if(provenance.sourceSha256!==p.sha256||provenance.policy!==requiredFacadePolicy)throw Error('Mask source or policy mismatch');const mask=await sharp(`${maskRoot}/${p.id}.png`).greyscale().raw().toBuffer({resolveWithObject:true});if(mask.info.width!==p.downloadSize[0]||mask.info.height!==p.downloadSize[1]||mask.info.channels!==1)throw Error('Mask dimensions mismatch');const bits=packMask(mask.data);metas.push({...p,hasFacadePixels:bits.some(v=>v!==0),mask:{info:mask.info,data:bits}});}catch(e){skippedPhotos.push({id:p.id,reason:e.code==='ENOENT'?'facade-mask-pending':'facade-mask-invalid'});}
}
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2),areaOf=t=>Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;
const terrain=await terrainFor(metas.map(p=>p.computed_geometry.coordinates));
function* split(t,depth=0){const edges=t.map((a,i)=>Math.hypot(...sub(a,t[(i+1)%3])));if(Math.max(...edges)<=4||depth>=9){yield t;return;}const i=edges.indexOf(Math.max(...edges)),a=t[i],b=t[(i+1)%3],c=t[(i+2)%3],m=mid(a,b);yield*split([a,m,c],depth+1);yield*split([m,b,c],depth+1);}
for(const a of catalog.areas){
 if(process.argv[2]&&process.argv[2]!==a.id)continue;
 const g=JSON.parse(await readFile(`data/plateau/${a.dataset}/${a.id==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
 const targets=selectedIds?g.buildings.filter(b=>selectedIds.includes(b.id)):g.buildings;
 if(selectedIds&&targets.length!==selectedIds.length)throw Error('Subset building does not exist in this area');
 const roads=catalog.sections.filter(s=>s.areaId===a.id),surface=await roadSurfaceHeight(a,g.origin),photos=[];
 for(const p of metas){if(!p.hasFacadePixels)continue;const initial=cameraFor(p,g.origin,0);if(!initial)continue;const [x,,z]=initial.position;if(x<a.bounds[0]-150||x>a.bounds[1]+150||z<a.bounds[2]-150||z>a.bounds[3]+150)continue;const exact=surface.sample(initial.position);if(exact?.ambiguous)continue;const height=exact||roadHeight(initial.position,roads)||terrain.sample(p.computed_geometry.coordinates);if(!height)continue;const camera=cameraFor(p,g.origin,height.height);photos.push({...p,camera,height});}
 console.log(JSON.stringify({area:a.id,roadTriangles:surface.triangles,eligiblePhotos:photos.length}));surface.dispose();
 for(const photo of photos)photo.depth=await spatialEvidence(photo);
 console.log(JSON.stringify({area:a.id,spatialEvidence:Object.fromEntries([...Map.groupBy(photos,p=>p.depth.status)].map(([k,v])=>[k,v.length]))}));
 const wallGeometries=new Map(),positions=[];
 for(const b of g.buildings)for(const p of b.polygons){const t=triangulate(p.rings.map(r=>r.points));wallGeometries.set(p.id,t);for(const i of t.indices)positions.push(...t.points[i]);}
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));const bvh=new MeshBVH(geometry);
 const ray=new Ray(),direction=new Vector3();
 function visible(camera,p){ray.origin.set(...camera.position);direction.set(...p).sub(ray.origin);const len=direction.length();ray.direction.copy(direction).normalize();return !bvh.raycastFirst(ray,DoubleSide,.05,len-.08);}
 function accepted(photo,t,diagnostic){
  diagnostic.attempts++;const reject=reason=>{diagnostic.rejections[reason]=(diagnostic.rejections[reason]||0)+1;return null;};
  const center=t[0].map((_,i)=>t.reduce((s,p)=>s+p[i],0)/3);
  const samples=[...t,center,...t.map((p,i)=>mid(p,t[(i+1)%3]))];
  const uv=samples.map(p=>projectPhoto(photo.camera,p));if(uv.some(p=>!p||!p.every(Number.isFinite)))return reject('invalid-or-behind-camera');
  if(photo.camera.type!=='perspective'&&Math.max(...uv.map(p=>p[0]))-Math.min(...uv.map(p=>p[0]))>.5)return reject('panorama-seam');
  const {data,info}=photo.mask;
  for(let i=0;i<samples.length;i++){
   const [u,v]=uv[i],margin=photo.camera.type==='perspective'?.015:.08;
   if(u<0||u>=1||v<margin||v>1-margin)return reject('outside-usable-image');
   if(!maskContains(data,Math.floor(v*info.height)*info.width+Math.floor(u*info.width)))return reject('non-facade-mask');
   if(!visible(photo.camera,samples[i]))return reject('model-occlusion');
   if(photo.depth.sampler){
    const [x,y,z]=samples[i].map((v,k)=>v-photo.camera.position[k]);
    const point=new Vector3(x,-z,y).applyMatrix4(photo.camera.rotation),depth=photo.depth.sampler.sample(point.toArray());
    diagnostic.depthSamples++;if(depth!==null)diagnostic.depthSupportedSamples++;
    const disagreement=depthDisagreement(point.length(),depth);if(disagreement)return reject(disagreement);
   }
  }
  return uv.slice(0,3).map(p=>p.slice(0,2));
 }
 const inputKey=checkpointKey([
  process.version,await readFile('package-lock.json'),
  JSON.stringify(options),...await Promise.all(['texture-project-city.mjs','texture-camera.mjs','texture-checkpoint.mjs','plateau-geometry.mjs','texture-mask.mjs','texture-spatial-depth.mjs','texture-spatial-evidence.mjs','texture-photo-quality.mjs','texture-photo-selection.mjs','texture-refinement.mjs'].map(f=>readFile(`scripts/${f}`))),
  JSON.stringify(g),JSON.stringify(photos.map(p=>[p.id,p.sha256,p.camera,p.height,p.depth.key,checkpointKey([p.mask.data])])),
 ]);
 const checkpointPath=`data/texture-city/checkpoints/${a.id}-${inputKey}.json`,photoById=new Map(photos.map(p=>[p.id,p]));
 const saved=await loadCheckpoint(checkpointPath,inputKey,targets.map(b=>b.id),new Set(photoById.keys()));
 const chunks=new Map((saved?.chunks||[]).map(c=>[c.id,{photo:photoById.get(c.id),positions:c.positions,uv:c.uv}])),results=saved?.results||[];let totalTriangles=saved?.totalTriangles||0;
 const resumeAt=results.length;
 if(resumeAt)console.log(JSON.stringify({area:a.id,resumedBuildings:resumeAt,triangles:totalTriangles}));
 async function checkpoint(){await saveCheckpoint(checkpointPath,{version:1,key:inputKey,results,totalTriangles,chunks:[...chunks].map(([id,c])=>({id,positions:c.positions,uv:c.uv}))});}
 for(const [i,b] of targets.entries()){
  if(i<resumeAt)continue;
  const center=b.min.map((v,k)=>(v+b.max[k])/2),sources=new Set(),diagnostic={nearbyEligiblePhotos:0,candidateWalls:0,attempts:0,rejections:{},acceptedBeyondSix:0,maxAcceptedRank:0,acceptedExtendedRange:0,maxAcceptedDistance:0,depthSamples:0,depthSupportedSamples:0};let appliedArea=0,triangles=0;
  const near=photos.filter(p=>Math.hypot(p.camera.position[0]-center[0],p.camera.position[2]-center[2])<300);
  const originalNearIds=new Set(near.filter(p=>Math.hypot(p.camera.position[0]-center[0],p.camera.position[2]-center[2])<150).map(p=>p.id));
  diagnostic.nearbyEligiblePhotos=near.length;
  const selectionDiagnostic={attempts:0,rejections:{},depthSamples:0,depthSupportedSamples:0,walls:[]};
  const refinement={splits:0,maxDepth:0,addedTriangles:0,addedArea:0};
  for(const wall of b.walls){
   const t=wallGeometries.get(wall.id);if(!t?.indices.length)continue;
   const pc=t.points[0].map((_,k)=>t.points.reduce((s,p)=>s+p[k],0)/t.points.length);
   let candidates=near.map(p=>{const d=sub(p.camera.position,pc),distance=Math.hypot(...d),angle=dot(d,t.normal)/distance;return {p,score:angle/distance,angle,distance,originalRange:originalNearIds.has(p.id)&&distance<120};}).filter(p=>p.angle>.3&&p.distance<300&&overlapsPhoto(p.p.camera,t.points)).sort((a,b)=>Number(b.originalRange)-Number(a.originalRange)||b.score-a.score);
   if(!candidates.length)continue;
   diagnostic.candidateWalls++;
   const wallTriangles=[];for(let n=0;n<t.indices.length;n+=3)for(const tri of split(t.indices.slice(n,n+3).map(j=>t.points[j])))if(areaOf(tri)>=.01)wallTriangles.push(tri);
   if(options.selection==='wall-coverage'){
    const samples=areaSamples(wallTriangles,areaOf),ranked=coveragePriority(candidates,samples,(c,tri)=>accepted(c.p,tri,selectionDiagnostic));
    candidates=ranked.map(r=>r.candidate);
    selectionDiagnostic.walls.push({polygonId:wall.id,samples:samples.length,candidates:candidates.length,rankedPhotos:ranked.filter(r=>r.area>0).map(r=>({id:r.candidate.p.id,estimatedArea:r.area,acceptedSamples:r.acceptedSamples}))});
   }
   const wallUsage=new Map();
   const rankedCandidates=candidates.map((c,rank)=>({...c,rank}));
   for(const originalTriangle of wallTriangles){
    for(const result of refineRejected(originalTriangle,rankedCandidates,(c,t)=>accepted(c.p,t,diagnostic),refinementDepth,refinement)){
     const {triangle:tri,value:uv,candidate:{p,distance,originalRange,rank},level}=result,size=areaOf(tri);
     if(level){refinement.addedTriangles++;refinement.addedArea+=size;}
     if(rank>=6)diagnostic.acceptedBeyondSix++;diagnostic.maxAcceptedRank=Math.max(diagnostic.maxAcceptedRank,rank+1);
     if(!originalRange)diagnostic.acceptedExtendedRange++;diagnostic.maxAcceptedDistance=Math.max(diagnostic.maxAcceptedDistance,distance);
     let chunk=chunks.get(p.id);if(!chunk){chunk={photo:p,positions:[],uv:[]};chunks.set(p.id,chunk);}
     for(const v of tri)chunk.positions.push(...v.map((x,k)=>x+t.normal[k]*.025));chunk.uv.push(...uv.flat());
     appliedArea+=size;triangles++;sources.add(p.id);wallUsage.set(p.id,(wallUsage.get(p.id)||0)+size);
    }
   }
   if(options.selection==='wall-coverage')selectionDiagnostic.walls.at(-1).usedPhotos=[...wallUsage].map(([id,area])=>({id,area}));
  }
  const outcome=triangles?'partially-projected':!b.walls.length?'no-wall-geometry':!near.length?'no-nearby-eligible-photo':!diagnostic.candidateWalls?'no-front-facing-photo-in-range-and-view':'all-samples-rejected';
  results.push({buildingId:b.id,areaId:a.id,projectedArea:appliedArea,triangles,sourceIds:[...sources],registration:'estimated-unverified',outcome,diagnostic,...(refinementDepth?{refinement}:{}),...(options.selection==='wall-coverage'?{selectionDiagnostic}:{})});totalTriangles+=triangles;
  if((i+1)%100===0||i+1===targets.length)await checkpoint();
  if(i%100===0)console.log(JSON.stringify({area:a.id,processed:i+1,buildings:targets.length,projectedBuildings:results.filter(r=>r.triangles).length,triangles:totalTriangles}));
 }
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('UNVERIFIED real photograph projection');
 const unlit=doc.createExtension(KHRMaterialsUnlit);doc.createExtension(EXTTextureWebP).setRequired(true);const sources=[];
 for(const [id,chunk] of chunks){
  const p=chunk.photo,crop=cropTextureRegion(chunk.uv,...p.downloadSize);
  const alpha=await sharp(`${maskRoot}/${id}.png`).extract(crop.rect).png().toBuffer();
  const rgba=await sharp(`${photoRoot}/${id}.jpg`).extract(crop.rect).removeAlpha().joinChannel(alpha).webp({quality:92,alphaQuality:100}).toBuffer();
  const tex=doc.createTexture(id).setImage(rgba).setMimeType('image/webp');
  const mat=doc.createMaterial('mapillary-experimental').setBaseColorTexture(tex).setDoubleSided(true).setAlphaMode('MASK').setAlphaCutoff(.5).setExtension('KHR_materials_unlit',unlit.createUnlit());
  const acc=(name,type,values)=>doc.createAccessor(name).setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
  const prim=doc.createPrimitive().setMaterial(mat).setAttribute('POSITION',acc('position','VEC3',chunk.positions)).setAttribute('TEXCOORD_0',acc('uv','VEC2',crop.uv));
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)).setExtras({sourcePage:p.sourcePage,author:p.creator?.username,registration:'estimated-unverified'}));
  sources.push({id,url:p.sourcePage,author:p.creator?.username,license:p.license,sourceSha256:p.sha256,cameraPosition:p.camera.position,height:p.height,cameraType:p.camera_type,exifOrientation:p.exif_orientation,originalSize:p.camera.size,imageCrop:crop.rect,spatialEvidence:{status:p.depth.status,key:p.depth.key,meshSha256:p.depth.meshSha256,atomicScale:p.depth.atomicScale}});
 }
 const attribution=sources.map(p=>`© ${p.author} / Mapillary, ${p.license}, ${p.url}`).join('; ');
 doc.getRoot().getAsset().copyright='PLATEAU / Tokyo 2025; '+attribution+'; camera terrain fallback: GSI DEM5A https://maps.gsi.go.jp/development/ichiran.html ; projected and masked by OpenGraffiti; unverified registration';
 await new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]).write(`${output}/${a.id}-mapillary.glb`,doc);
 const report={areaId:a.id,totalBuildings:g.buildings.length,projectedBuildings:results.filter(r=>r.triangles).length,projectedTriangles:totalTriangles,eligiblePhotos:photos.length,eligibleCameraTypes:Object.fromEntries([...Map.groupBy(photos,p=>p.camera_type)].map(([k,v])=>[k,v.length])),usedPhotos:sources.length,registration:'estimated-unverified',model:`/assets/texture-poc/experimental/${a.id}-mapillary.glb`,sources,buildings:results,warnings:['Camera height estimated from nearby roads; horizontal and vertical alignment not validated.','Automatic semantic masks may be wrong; building classes do not distinguish roofs.','Projected area is not confirmed facade coverage. Original photographs and artwork unchanged; LOD1 geometry repaired separately from source CityGML.']};
 report.maskPolicy='Cityscapes AND ADE20K building-family agreement';report.facadePolicy=requiredFacadePolicy;report.skippedPhotos=skippedPhotos;
 report.totalBuildings=targets.length;report.areaTotalBuildings=g.buildings.length;
 report.model=`/${output.replace(/^public\//,'')}/${a.id}-mapillary.glb`;
 report.scope={kind:selectedIds?'subset':'all-buildings',buildingIds:selectedIds??null};
 report.photoSelection=options.selection||'triangle-first';
 if(refinementDepth){report.refinement={depth:refinementDepth,policy:'bisect-only-rejected-triangles-retain-seven-point-acceptance-v1'};report.warnings.push('Rejected coarse triangles are subdivided; new fragments are provisional, not independently verified wall correspondence.');}
 report.photoQualityPolicy=PHOTO_QUALITY_POLICY;report.qualityExcludedPhotos=qualityExcludedPhotos;
 report.sourceQuality=photos.map(p=>({id:p.id,sourceSha256:p.sha256,...p.quality}));
 report.warnings.push('Known visual quality scores below 0.2 are excluded; zero or missing scores are unscored and retained. This is not a camera alignment or wall identity check.');
 report.cachedPhotosWithoutSupportedCamera=unavailableCameras;
 report.orientationPolicy='Mapillary original sensor frame to display-oriented thumbnail UV; original photos and masks unchanged';
 report.eligibleOrientations=Object.fromEntries([...Map.groupBy(photos,p=>p.exif_orientation)].map(([k,v])=>[k,v.length]));
 report.photosWithoutFacadePixels=metas.filter(p=>!p.hasFacadePixels).map(p=>p.id);
 report.terrain={source:'国土地理院 DEM5A 標高タイル',url:'https://maps.gsi.go.jp/development/ichiran.html',tiles:terrain.tiles,usedPhotos:sources.filter(p=>p.height.method.startsWith('GSI-')).length,limitation:'Ground surface, not bridge decks or upper pedestrian levels. Used only where existing road height is unavailable; camera remains unverified.'};
 report.warnings[0]='Camera height estimated from roads, or GSI ground elevation where road height is unavailable; horizontal and vertical alignment not validated.';
 report.outcomes=Object.fromEntries([...Map.groupBy(results,r=>r.outcome)].map(([k,v])=>[k,v.length]));
 report.diagnosticUnits='Rejection counts are attempted photo/triangle pairs; not numbers of walls or buildings.';
 report.candidatePolicy='All candidates within 300m; original 150m building / 120m wall candidates always first. Extended range only fills previously rejected triangles; same seven-point mask, model visibility and available photo-depth checks for both ranges. No top-six truncation.';
 if(options.selection==='wall-coverage'){
  report.candidatePolicy='All candidates within 300m, ranked by area-weighted acceptance on up to 32 wall samples. Original distance/angle priority breaks coverage ties. Same seven-point mask, model visibility and available photo-depth checks; every fallback candidate is retained. No top-six truncation.';
  report.warnings.push('Wall coverage ranking reduces preference for fragmented inputs but does not verify correspondence or perform photometric seam correction.');
 }
 if(selectedIds)report.warnings.push(`Subset experiment: ${targets.length} selected buildings of ${g.buildings.length}; not a whole-city result.`);
 report.spatialDepthPolicy='Experimental bidirectional depth rejection: max(target distance, raw SfM depth) > 2 * min(target distance, raw SfM depth) AND absolute difference > 10m, at the existing seven samples. Try next photo after rejection. Unknown depth retains existing checks, not verified agreement.';
 report.spatialEvidence=Object.fromEntries([...Map.groupBy(photos,p=>p.depth.status)].map(([k,v])=>[k,v.length]));
 report.warnings.push('SfM depth is sparse and estimated; foreground rejection may have false positives. Missing depth is not proof of correspondence.');
 await writeFile(`${output}/${a.id}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({areaId:a.id,totalBuildings:report.totalBuildings,projectedBuildings:report.projectedBuildings,projectedTriangles:totalTriangles,usedPhotos:sources.length,photoSelection:report.photoSelection,model:report.model,skippedPhotos:skippedPhotos.length}));geometry.dispose();
 for(const photo of photos)photo.depth.sampler?.dispose();
}
