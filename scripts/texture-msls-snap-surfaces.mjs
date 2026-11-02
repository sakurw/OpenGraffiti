// Whole-city provisional geometry from real SfM inputs.
// Baseline projection keeps one best photo per building for local registration.
// Official output admits cameras by actual geometry/frustum/semantic/occlusion
// evidence. Accepted local registration refines a pose, but is never a hard
// admissibility gate for an otherwise provenance-valid source image.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {BufferGeometry,Float32BufferAttribute,Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {triangulate,sub,cross,dot} from './plateau-geometry.mjs';
import {packMask,maskContains} from './texture-mask.mjs';
import {quadrant} from './plateau-surfaces.mjs';
const area=process.argv[2],ignoreLocalRegistration=process.argv.includes('--ignore-local-registration');if(!['tocho','tokyo-tower'].includes(area))throw Error('Specify area');
const onlyBuildingId=process.argv.find(arg=>arg.startsWith('--only-building='))?.slice('--only-building='.length)||null;
const outputPathArg=process.argv.find(arg=>arg.startsWith('--output='))?.slice('--output='.length)||null;
const includeAllPhotos=process.argv.includes('--include-all-photos');
// Acquisition planning needs a wider search space than the final atlas. It
// still uses reprojection and visibility validation later, but early quality
// gates must not discard complementary views before greedy selection sees them.
const acquisitionMode=process.argv.includes('--acquisition-mode');
const hash=b=>createHash('sha256').update(b).digest('hex'),inputBytes=await readFile(`data/texture-city/msls/snap-inputs-${area}.json`),inputs=JSON.parse(inputBytes),photos=[];
if(inputs.areaId!==area)throw Error('Area mismatch');
let localRegistration=null,localRegistrationSha256=null;
if(!ignoreLocalRegistration){try{const bytes=await readFile(`data/texture-city/msls/snap-local-registration-${area}.json`);localRegistration=JSON.parse(bytes);localRegistrationSha256=hash(bytes);if(localRegistration.areaId!==area)throw Error('Local registration area mismatch');}catch(error){if(error?.code!=='ENOENT')throw error;}}
const refinedBySource=new Map((localRegistration?.registrations??[]).filter(r=>r.accepted).map(r=>[r.sourceId,r]));
for(const p of inputs.photos){
 const bytes=await readFile(p.maskPath);if(hash(bytes)!==p.maskSha256||hash(await readFile(p.imagePath))!==p.imageSha256||hash(await readFile(`data/texture-city/photos/msls/${p.id}.jpg`))!==p.sourceSha256)throw Error('Source changed');
 const mask=await sharp(bytes).greyscale().raw().toBuffer({resolveWithObject:true});if(mask.info.width!==p.imageSize[0]||mask.info.height!==p.imageSize[1])throw Error('Mask dimensions mismatch');
 const refined=refinedBySource.get(p.id);
 const registeredBuildingIds=refined?[...(refined.metrics?.targetBuildingIds??[refined.metrics?.targetBuildingId]).filter(Boolean)]:[];
 photos.push({...p,...(refined?{position:refined.position,camFromWorld:refined.camFromWorld,cameraMatrix:refined.cameraMatrix,registeredBuildingIds,localRegistration:{sourceId:p.id,overlayPath:refined.overlayPath,metrics:refined.metrics,accuracy:refined.accuracy}}:{}),mask:packMask(mask.data)});
}
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8')),a=catalog.areas.find(a=>a.id===area),geometryBytes=await readFile(`data/plateau/${a.dataset}/${area==='tocho'?'53394525':'53393599'}-geometry.json`),g=JSON.parse(geometryBytes);
const selectedBuildings=onlyBuildingId?g.buildings.filter(b=>b.id===onlyBuildingId):g.buildings;if(onlyBuildingId&&!selectedBuildings.length)throw Error(`Building not found: ${onlyBuildingId}`);
const positions=[];for(const b of g.buildings)for(const p of b.polygons){const t=triangulate(p.rings.map(r=>r.points));for(const i of t.indices)positions.push(...t.points[i]);}
const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geometry),ray=new Ray(),direction=new Vector3();
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2),areaOf=t=>Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;
const IMAGE_BORDER=acquisitionMode?8:18,MIN_PIXELS_PER_METRE=acquisitionMode?1:2,MIN_FACADE_COVERAGE=acquisitionMode?.002:.012,MIN_IMAGE_OCCUPANCY=acquisitionMode?.001:.006;
const VISIBILITY_PIXELS_PER_METRE=4,VISIBILITY_MAX_DIMENSION=512;
const CANDIDATE_SAFETY_RADIUS_METRES=1000;
const clamp=(value,lo=0,hi=1)=>Math.max(lo,Math.min(hi,value));
function* split(t,depth=0){const edges=t.map((p,i)=>Math.hypot(...sub(p,t[(i+1)%3]))),i=edges.indexOf(Math.max(...edges));if(edges[i]<=4||depth>=10){yield t;return;}const m=mid(t[i],t[(i+1)%3]);yield*split([t[i],m,t[(i+2)%3]],depth+1);yield*split([m,t[(i+1)%3],t[(i+2)%3]],depth+1);}
function project(photo,point){const v=photo.camFromWorld.map(r=>dot(r.slice(0,3),point)+r[3]),k=photo.cameraMatrix;return v[2]>.01?[k[0][0]*v[0]/v[2]+k[0][2],k[1][1]*v[1]/v[2]+k[1][2]]:null;}
function accepts(photo,triangle){
 const samples=[...triangle,triangle[0].map((_,i)=>triangle.reduce((s,p)=>s+p[i],0)/3),...triangle.map((p,i)=>mid(p,triangle[(i+1)%3]))];
 const projected=[];let minimumBorder=Infinity;
 for(const point of samples){const uv=project(photo,point),[w,h]=photo.imageSize;if(!uv||!uv.every(Number.isFinite))return {ok:false,reason:'projection'};
  const border=Math.min(uv[0],uv[1],w-uv[0],h-uv[1]);minimumBorder=Math.min(minimumBorder,border);if(border<IMAGE_BORDER&&!acquisitionMode)return {ok:false,reason:'border'};
  if(!maskContains(photo.mask,Math.floor(uv[1])*w+Math.floor(uv[0])))return {ok:false,reason:'mask'};
  ray.origin.set(...photo.position);direction.set(...point).sub(ray.origin);const distance=direction.length();ray.direction.copy(direction).normalize();if(bvh.raycastFirst(ray,DoubleSide,.05,distance-.08))return {ok:false,reason:'occlusion'};
  projected.push(uv);
 }
 const worldArea=areaOf(triangle),q=projected.slice(0,3),pixelArea=Math.abs((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2,ppm=Math.sqrt(pixelArea/Math.max(worldArea,1e-9));
 if(!Number.isFinite(ppm)||ppm<MIN_PIXELS_PER_METRE)return {ok:false,reason:'resolution'};
 return {ok:true,projected,minimumBorder,pixelsPerMetre:ppm};
}
function visibilityReason(photo,point){
 const uv=project(photo,point),[w,h]=photo.imageSize;if(!uv||!uv.every(Number.isFinite))return 'projection';
 const border=Math.min(uv[0],uv[1],w-uv[0],h-uv[1]);if(border<IMAGE_BORDER)return 'border';
 if(!maskContains(photo.mask,Math.floor(uv[1])*w+Math.floor(uv[0])))return 'semantic-mask';
 ray.origin.set(...photo.position);direction.set(...point).sub(ray.origin);const distance=direction.length();ray.direction.copy(direction).normalize();
 return bvh.raycastFirst(ray,DoubleSide,.05,distance-.08)?'occlusion':'visible';
}
function barycentric(point,a,b,c){
 const v0=[b[0]-a[0],b[1]-a[1]],v1=[c[0]-a[0],c[1]-a[1]],v2=[point[0]-a[0],point[1]-a[1]],d00=dot(v0,v0),d01=dot(v0,v1),d11=dot(v1,v1),d20=dot(v2,v0),d21=dot(v2,v1),den=d00*d11-d01*d01;
 if(Math.abs(den)<1e-12)return null;const vb=(d11*d20-d01*d21)/den,vc=(d00*d21-d01*d20)/den,va=1-vb-vc;
 return va>=-1e-7&&vb>=-1e-7&&vc>=-1e-7?[va,vb,vc]:null;
}
async function createVisibilityMask(photo,surface,tag=''){
 const ppm=Math.min(VISIBILITY_PIXELS_PER_METRE,VISIBILITY_MAX_DIMENSION/Math.max(surface.width,1e-6),VISIBILITY_MAX_DIMENSION/Math.max(surface.height,1e-6));
 const width=Math.max(16,Math.round(surface.width*ppm)),height=Math.max(16,Math.round(surface.height*ppm)),mask=Buffer.alloc(width*height),reasonRgb=Buffer.alloc(width*height*3),covered=Buffer.alloc(width*height),triangles=[];
 const reasonCounts={visible:0,projection:0,border:0,'semantic-mask':0,occlusion:0};
 const reasonColors={visible:[40,180,70],projection:[80,80,80],border:[240,190,40],'semantic-mask':[220,70,70],occlusion:[70,110,220]};
 for(let i=0;i<surface.positions.length;i+=9){
  const xyz=[0,1,2].map(k=>surface.positions.slice(i+k*3,i+k*3+3)),uvBase=(i/3)*2,uv=[0,1,2].map(k=>surface.uv.slice(uvBase+k*2,uvBase+k*2+2));
  const xs=uv.map(p=>p[0]),ys=uv.map(p=>p[1]);triangles.push({xyz,uv,minX:Math.max(0,Math.floor(Math.min(...xs)*width)-1),maxX:Math.min(width-1,Math.ceil(Math.max(...xs)*width)+1),minY:Math.max(0,Math.floor(Math.min(...ys)*height)-1),maxY:Math.min(height-1,Math.ceil(Math.max(...ys)*height)+1)});
 }
 let geometryPixels=0,visiblePixels=0;
 for(const tri of triangles)for(let y=tri.minY;y<=tri.maxY;y++)for(let x=tri.minX;x<=tri.maxX;x++){
 const index=y*width+x;if(covered[index])continue;const weights=barycentric([(x+.5)/width,(y+.5)/height],...tri.uv);if(!weights)continue;covered[index]=1;geometryPixels++;
  const point=[0,1,2].map(k=>weights[0]*tri.xyz[0][k]+weights[1]*tri.xyz[1][k]+weights[2]*tri.xyz[2][k]),reason=visibilityReason(photo,point);reasonCounts[reason]++;
  if(reason==='visible'){mask[index]=255;visiblePixels++;}
  const color=reasonColors[reason],offset=index*3;reasonRgb[offset]=color[0];reasonRgb[offset+1]=color[1];reasonRgb[offset+2]=color[2];
 }
 const suffix=tag?`-${hash(tag).slice(0,12)}`:'',out=`data/texture-city/msls/snap-visibility-${area}`,path=`${out}/${surface.key}${suffix}.png`,reasonPath=`${out}/${surface.key}${suffix}.reasons.png`;await mkdir(out,{recursive:true});
 await sharp(mask,{raw:{width,height,channels:1}}).png().toFile(path);const bytes=await readFile(path);
 await sharp(reasonRgb,{raw:{width,height,channels:3}}).png().toFile(reasonPath);const reasonBytes=await readFile(reasonPath);
 return {record:{path,sha256:hash(bytes),reasonPath,reasonSha256:hash(reasonBytes),size:[width,height],pixelsPerMetre:ppm,geometryPixels,visiblePixels,visibleRatio:geometryPixels?visiblePixels/geometryPixels:0,reasonCounts,policy:'continuous per-wall pixel validity from un-eroded semantic facade agreement, image border and whole-model BVH occlusion; one conservative boundary margin is deferred to final atlas space'},mask};
}
const surfaces=[],buildings=[];
const wallPhotoCandidates=[];
for(const [i,b] of selectedBuildings.entries()){
 const center=b.min.map((v,i)=>(v+b.max[i])/2),near=photos.filter(p=>Math.hypot(p.position[0]-center[0],p.position[2]-center[2])<CANDIDATE_SAFETY_RADIUS_METRES);
 const surfaceStart=surfaces.length;let best=null,attempts=0;const candidateDiagnostics=[],acceptedByWall=new Map();
 if(near.length){
  const walls=b.walls.map(w=>{const t=triangulate(w.rings.map(r=>r.points)),triangles=[];for(let i=0;i<t.indices.length;i+=3)for(const tri of split(t.indices.slice(i,i+3).map(j=>t.points[j])))if(areaOf(tri)>=.01)triangles.push(tri);return {w,t,triangles};});
  for(const photo of near){const selected=[];let total=0,facingArea=0,weightedFacing=0,minimumBorder=Infinity;const ppms=[],allProjected=[],rejected={projection:0,border:0,mask:0,occlusion:0,resolution:0};
   for(const {w,t,triangles} of walls){if(!t.points.length)continue;const view=sub(photo.position,t.points[0]),facing=dot(t.normal,view)/Math.hypot(...view);if(facing<.3)continue;
    const wallArea=triangles.reduce((sum,tri)=>sum+areaOf(tri),0);facingArea+=wallArea;
    const accepted=[],wallPpms=[];let wallMinimumBorder=Infinity;for(const tri of triangles){attempts++;const quality=accepts(photo,tri);if(!quality.ok){rejected[quality.reason]++;continue;}accepted.push(tri);minimumBorder=Math.min(minimumBorder,quality.minimumBorder);wallMinimumBorder=Math.min(wallMinimumBorder,quality.minimumBorder);ppms.push(quality.pixelsPerMetre);wallPpms.push(quality.pixelsPerMetre);allProjected.push(...quality.projected.slice(0,3));}if(!accepted.length)continue;
    const full=t.indices.map(j=>t.points[j]),origin=t.points[0],right=new Vector3(t.normal[2],0,-t.normal[0]).normalize().toArray(),up=cross(t.normal,right),plane=p=>[dot(sub(p,origin),right),dot(sub(p,origin),up)],points=full.map(plane);
    const lo=Math.min(...points.map(p=>p[0])),hi=Math.max(...points.map(p=>p[0])),bottom=Math.min(...points.map(p=>p[1])),top=Math.max(...points.map(p=>p[1])),width=hi-lo,height=top-bottom;
    if(width<.02||height<.02)continue;
    const imagePoints=[[lo,bottom],[hi,bottom],[hi,top],[lo,top]].map(([u,v])=>project(photo,origin.map((x,i)=>x+right[i]*u+up[i]*v)));
    if(imagePoints.some(p=>!p||!p.every(Number.isFinite)))continue;
    const area=accepted.reduce((s,t)=>s+areaOf(t),0);total+=area;weightedFacing+=area*facing;wallPpms.sort((a,b)=>a-b);const wallMedianPpm=wallPpms[Math.floor(wallPpms.length/2)]||0;
    const viewTarget=[0,0,0];for(const tri of accepted){const triArea=areaOf(tri);for(let k=0;k<3;k++)viewTarget[k]+=triArea*(tri[0][k]+tri[1][k]+tri[2][k])/3;}for(let k=0;k<3;k++)viewTarget[k]/=area;
    const q=quadrant(t.normal);
    const registrationBonus=photo.localRegistration?.accuracy?.accepted===false?0:photo.localRegistration?.accuracy?0.05:0;
    const sourceQuality=clamp(.30*clamp((facing-.3)/.7)+.25*clamp(wallMedianPpm/8)+.20*clamp((wallMinimumBorder-IMAGE_BORDER)/70)+.15*clamp((wallArea?area/wallArea:0)/.5)+.10*clamp(1-(photo.anchorErrorMetres||0)/10)+registrationBonus);
    selected.push({key:hash(`${b.id}:${w.id}`).slice(0,24),buildingId:b.id,polygonId:w.id,sourceId:photo.id,groupKey:`${b.id}|direction-${q}`,quadrant:q,normal:t.normal,width,height,imagePoints,area,geometryArea:wallArea,viewTarget,coverageRatio:wallArea?area/wallArea:0,frontalCosine:facing,sourceQuality,effectivePixelsPerMetreMedian:wallMedianPpm,minimumBorderPixels:wallMinimumBorder,
     positions:full.flat(),uv:full.flatMap(p=>{const [u,v]=plane(p);return [(u-lo)/width,(top-v)/height];})});
   }
   const [iw,ih]=photo.imageSize,xs=allProjected.map(p=>p[0]),ys=allProjected.map(p=>p[1]),bbox=allProjected.length?[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]:[0,0,0,0];
   const imageOccupancy=((bbox[2]-bbox[0])*(bbox[3]-bbox[1]))/(iw*ih),facadeCoverage=facingArea?total/facingArea:0,frontalCosine=weightedFacing/total;
   ppms.sort((a,b)=>a-b);const medianPpm=ppms[Math.floor(ppms.length/2)]||0,anchorQuality=clamp(1-(photo.anchorErrorMetres||0)/10),coverageQuality=clamp(facadeCoverage/.16),occupancyQuality=clamp(imageOccupancy/.12),resolutionQuality=clamp(medianPpm/8),frontalQuality=clamp((frontalCosine-.3)/.7),marginQuality=clamp((minimumBorder-IMAGE_BORDER)/70);
   const score=total*(.20+.25*coverageQuality+.15*occupancyQuality+.15*resolutionQuality+.12*frontalQuality+.08*anchorQuality+.05*marginQuality);
   const rejectionReason=!total?'no-accepted-triangles':facadeCoverage<MIN_FACADE_COVERAGE?'facade-coverage':imageOccupancy<MIN_IMAGE_OCCUPANCY?'edge-only-image-occupancy':null;
   const diagnostics={sourceId:photo.id,distanceMetres:Math.hypot(photo.position[0]-center[0],photo.position[2]-center[2]),projectedArea:total,facingArea,facadeCoverage,imageOccupancy,minimumBorderPixels:Number.isFinite(minimumBorder)?minimumBorder:null,effectivePixelsPerMetreMedian:medianPpm,frontalCosine:Number.isFinite(frontalCosine)?frontalCosine:0,anchorErrorMetres:photo.anchorErrorMetres,localRegistrationApplied:Boolean(photo.localRegistration),score,rejected,rejectionReason};candidateDiagnostics.push(diagnostics);
   if(!total)continue;
   // Keep projectable evidence for acquisition optimization even when the
   // photo does not satisfy final texture quality gates. The acquisition loop
   // needs visibility masks from the full search space to estimate marginal
   // coverage gain.
   if(rejectionReason){
    for(const surface of selected){
      const candidateVisibility=await createVisibilityMask(photo,surface,`acquisition-${photo.id}`);
      wallPhotoCandidates.push({
        buildingId:b.id,
        wallId:surface.key,
        surfaceId:surface.key,
        sourceId:photo.id,
        acquisitionOnly:true,
        rejectionReason,
        surface:{
          ...surface,
          sourceIds:[photo.id],
          sourceMappings:[{
            sourceId:photo.id,
            frontalCosine:surface.frontalCosine,
            sourceQuality:surface.sourceQuality,
            effectivePixelsPerMetreMedian:surface.effectivePixelsPerMetreMedian,
            minimumBorderPixels:surface.minimumBorderPixels,
            acceptedArea:surface.area,
            visibilityMask:candidateVisibility.record,
          }],
        },
        sourceQuality:surface.sourceQuality,
        frontalCosine:surface.frontalCosine,
      });
    }
   }
   // Candidate acquisition mode keeps geometrically projected but lower-ranked
   // photos available for marginal-pixel evaluation. Final atlas admission
   // still uses the normal quality gates.
   if(!rejectionReason || includeAllPhotos){
    if(!best||score>best.score)best={photo,area:total,surfaces:selected,score,quality:diagnostics};
    for(const surface of selected){
      if(!acceptedByWall.has(surface.key))acceptedByWall.set(surface.key,[]);
      acceptedByWall.get(surface.key).push({photo,surface});
      const candidateVisibility=await createVisibilityMask(photo,surface,`candidate-${photo.id}`);
      wallPhotoCandidates.push({
        buildingId:b.id,
        wallId:surface.key,
        surfaceId:surface.key,
        sourceId:photo.id,
        surface:{
          ...surface,
          sourceIds:[photo.id],
          sourceMappings:[{
            sourceId:photo.id,
            frontalCosine:surface.frontalCosine,
            sourceQuality:surface.sourceQuality,
            effectivePixelsPerMetreMedian:surface.effectivePixelsPerMetreMedian,
            minimumBorderPixels:surface.minimumBorderPixels,
            acceptedArea:surface.area,
            visibilityMask:candidateVisibility.record,
          }],
        },
        sourceQuality:surface.sourceQuality,
        frontalCosine:surface.frontalCosine,
      });
    }
   }
  }
 }
 if(ignoreLocalRegistration||!localRegistration){
  if(best)for(const surface of best.surfaces){if(!ignoreLocalRegistration)surface.visibilityMask=(await createVisibilityMask(best.photo,surface)).record;surfaces.push(surface);}
 }else{
  for(const candidates of acceptedByWall.values()){
   candidates.sort((a,b)=>b.surface.sourceQuality-a.surface.sourceQuality||b.surface.area-a.surface.area||a.photo.id.localeCompare(b.photo.id));
   const base=candidates[0].surface,sourceMappings=[];let unionMask=null,geometryPixels=0;
   for(const {photo,surface} of candidates){
    const visibility=await createVisibilityMask(photo,base,photo.id);if(!visibility.record.visiblePixels)continue;
    if(!unionMask)unionMask=Buffer.alloc(visibility.mask.length);if(unionMask.length!==visibility.mask.length)throw Error('Visibility dimensions changed across source mappings');
    for(let k=0;k<unionMask.length;k++)if(visibility.mask[k])unionMask[k]=255;
    geometryPixels=visibility.record.geometryPixels;
    sourceMappings.push({sourceId:photo.id,imagePoints:surface.imagePoints,frontalCosine:surface.frontalCosine,sourceQuality:surface.sourceQuality,effectivePixelsPerMetreMedian:surface.effectivePixelsPerMetreMedian,minimumBorderPixels:surface.minimumBorderPixels,acceptedArea:surface.area,visibilityMask:visibility.record});
   }
   if(!sourceMappings.length||!unionMask)continue;
   const unionVisiblePixels=unionMask.reduce((sum,value)=>sum+(value?1:0),0),projectedArea=geometryPixels?base.geometryArea*unionVisiblePixels/geometryPixels:0;
   const {sourceId,imagePoints,frontalCosine,sourceQuality,effectivePixelsPerMetreMedian,minimumBorderPixels,...canonical}=base;
   surfaces.push({...canonical,area:projectedArea,coverageRatio:base.geometryArea?projectedArea/base.geometryArea:0,sourceIds:sourceMappings.map(m=>m.sourceId),sourceMappings,visibilityUnion:{geometryPixels,visiblePixels:unionVisiblePixels,visibleRatio:geometryPixels?unionVisiblePixels/geometryPixels:0,policy:'union of provenance-valid source visibility masks before final atlas-space source assignment'}});
  }
 }
 candidateDiagnostics.sort((a,b)=>b.score-a.score);
 const applied=surfaces.slice(surfaceStart),projectedArea=(localRegistration&&!ignoreLocalRegistration)?applied.reduce((sum,s)=>sum+s.area,0):(best?.area||0),sourceIds=[...new Set(applied.flatMap(s=>s.sourceMappings?.map(m=>m.sourceId)??(s.sourceId?[s.sourceId]:[])))];
 const candidateRejectionSummary=candidateDiagnostics.reduce((summary,candidate)=>{summary[candidate.rejectionReason??'accepted']=(summary[candidate.rejectionReason??'accepted']||0)+1;for(const [reason,count] of Object.entries(candidate.rejected))summary[`triangle:${reason}`]=(summary[`triangle:${reason}`]||0)+count;return summary;},{});
 buildings.push({buildingId:b.id,areaId:area,projectedArea,sourceIds,candidatePhotos:near.length,attempts,outcome:projectedArea?'provisional-surfaces':'no-accepted-surface',selectionScore:best?.score||0,selectionQuality:best?.quality||null,topCandidates:candidateDiagnostics.slice(0,3),candidateRejectionSummary,...(onlyBuildingId?{candidateDiagnostics}: {})});
 if(i%100===0)console.log({area,processed:i+1,total:selectedBuildings.length,projected:buildings.filter(b=>b.projectedArea>0).length});
}
geometry.dispose();
const usedPhotoIds=new Set(surfaces.flatMap(s=>s.sourceMappings?.map(m=>m.sourceId)??(s.sourceId?[s.sourceId]:[])));
// Keep the acquisition search space separate from the final accepted atlas.
// High precision reconstruction needs rejected-but-geometrically-projectable
// views available for later marginal-pixel evaluation. The atlas output can
// remain conservative while the acquisition planner explores more views.
const finalWallPhotoCandidates=[...wallPhotoCandidates, ...surfaces.flatMap((surface)=>
  (surface.sourceMappings || []).map((mapping)=>({
    buildingId: surface.buildingId,
    wallId: surface.key,
    surfaceId: surface.key,
    sourceId: mapping.sourceId,
    surface:{...surface, sourceIds:[mapping.sourceId], sourceMappings:[mapping]},
    sourceQuality: mapping.sourceQuality,
    frontalCosine: mapping.frontalCosine,
  }))
)];
const record={areaId:area,inputSha256:hash(inputBytes),geometrySha256:hash(geometryBytes),totalBuildings:g.buildings.length,processedBuildings:selectedBuildings.length,onlyBuildingId,buildings,surfaces,wallPhotoCandidates:finalWallPhotoCandidates,
 photos:(includeAllPhotos?photos:photos.filter(p=>usedPhotoIds.has(p.id))).map(({mask,...p})=>p),
 qualityGates:{imageBorderPixels:IMAGE_BORDER,minimumEffectivePixelsPerMetre:MIN_PIXELS_PER_METRE,minimumFacadeCoverage:MIN_FACADE_COVERAGE,minimumImageOccupancy:MIN_IMAGE_OCCUPANCY,visibilityPixelsPerMetre:VISIBILITY_PIXELS_PER_METRE,visibilityMaximumDimension:VISIBILITY_MAX_DIMENSION,candidateSafetyRadiusMetres:CANDIDATE_SAFETY_RADIUS_METRES,acceptedOcclusionContradictions:0,locallyRegisteredBuildingIdentityRequired:false,localRegistrationRole:'accepted pose refinement and quality bonus only'},
 localRegistration:localRegistration?{sha256:localRegistrationSha256,acceptedSources:localRegistration.acceptedSources,rejectedSources:localRegistration.rejectedSources,registration:localRegistration.registration,policy:localRegistration.policy,applied:true}:null,
 policy:ignoreLocalRegistration?'one best photo per building for unrestricted local-registration baseline':localRegistration?'multi-source per WallSurface admitted by actual projection, image border, semantic facade, whole-model BVH visibility, effective resolution, frontal angle, SfM/GPS anchor and image-occupancy gates; accepted local registration refines pose and contributes only a small quality bonus; unrefined provenance-valid SfM/GPS poses remain eligible; 1000m is a performance-only safety ceiling':'one best photo per building without local-registration gate',applied:Boolean(localRegistration&&!ignoreLocalRegistration)};
const outputPath=outputPathArg||`data/texture-city/msls/snap-surfaces-${area}${onlyBuildingId?'-target':''}.json`;await writeFile(outputPath,JSON.stringify(record));console.log({area,totalBuildings:record.totalBuildings,processedBuildings:record.processedBuildings,surfaces:surfaces.length,projectedBuildings:buildings.filter(b=>b.projectedArea>0).length,outputPath});
