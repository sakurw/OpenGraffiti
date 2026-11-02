import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {BufferGeometry,Float32BufferAttribute,Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {triangulate,sub,cross,dot} from './plateau-geometry.mjs';
import {packMask,maskContains} from './texture-mask.mjs';
import {quadrant} from './plateau-surfaces.mjs';

const area=process.argv[2];
if(!['tocho','tokyo-tower'].includes(area)) throw Error('Specify area');
const onlyBuildingId=process.argv.find(v=>v.startsWith('--only-building='))?.slice('--only-building='.length)||null;
const outputArg=process.argv.find(v=>v.startsWith('--output='))?.slice('--output='.length)||null;
const hash=v=>createHash('sha256').update(v).digest('hex');
const inputBytes=await readFile(`data/texture-city/kartaview/snap-inputs-${area}.json`);
const inputs=JSON.parse(inputBytes),photos=[];
if(inputs.areaId!==area) throw Error('Area mismatch');
for(const p of inputs.photos){
  const maskBytes=await readFile(p.maskPath);
  if(hash(maskBytes)!==p.maskSha256 || hash(await readFile(p.imagePath))!==p.imageSha256 || hash(await readFile(`data/texture-city/photos/kartaview/${p.id}.jpg`))!==p.sourceSha256) throw Error(`Source changed: ${p.id}`);
  const mask=await sharp(maskBytes).greyscale().raw().toBuffer({resolveWithObject:true});
  if(mask.info.width!==p.imageSize[0] || mask.info.height!==p.imageSize[1]) throw Error(`Mask dimensions mismatch: ${p.id}`);
  photos.push({...p,mask:packMask(mask.data)});
}

const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
const areaInfo=catalog.areas.find(v=>v.id===area);
const geometryBytes=await readFile(`data/plateau/${areaInfo.dataset}/${area==='tocho'?'53394525':'53393599'}-geometry.json`);
const city=JSON.parse(geometryBytes);
const buildings=onlyBuildingId?city.buildings.filter(v=>v.id===onlyBuildingId):city.buildings;
if(onlyBuildingId && !buildings.length) throw Error(`Building not found: ${onlyBuildingId}`);

const allPositions=[];
for(const b of city.buildings) for(const polygon of b.polygons){
  const t=triangulate(polygon.rings.map(r=>r.points));
  for(const index of t.indices) allPositions.push(...t.points[index]);
}
const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(allPositions,3));
const bvh=new MeshBVH(geometry),ray=new Ray(),direction=new Vector3();
const midpoint=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const triangleArea=t=>Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));

const IMAGE_BORDER=18;
const MIN_PIXELS_PER_METRE=2;
const MIN_FACADE_COVERAGE=.012;
const MIN_IMAGE_OCCUPANCY=.006;
const VISIBILITY_PIXELS_PER_METRE=4;
const VISIBILITY_MAX_DIMENSION=512;
const CANDIDATE_SAFETY_RADIUS_METRES=1000;

function* splitTriangle(t,depth=0){
  const lengths=t.map((p,i)=>Math.hypot(...sub(p,t[(i+1)%3]))),edge=lengths.indexOf(Math.max(...lengths));
  if(lengths[edge]<=4 || depth>=10){yield t;return;}
  const m=midpoint(t[edge],t[(edge+1)%3]);
  yield* splitTriangle([t[edge],m,t[(edge+2)%3]],depth+1);
  yield* splitTriangle([m,t[(edge+1)%3],t[(edge+2)%3]],depth+1);
}
function project(photo,point){
  const v=photo.camFromWorld.map(r=>dot(r.slice(0,3),point)+r[3]),k=photo.cameraMatrix;
  return v[2]>.01?[k[0][0]*v[0]/v[2]+k[0][2],k[1][1]*v[1]/v[2]+k[1][2]]:null;
}
function accepts(photo,triangle){
  const samples=[...triangle,triangle[0].map((_,i)=>triangle.reduce((s,p)=>s+p[i],0)/3),...triangle.map((p,i)=>midpoint(p,triangle[(i+1)%3]))];
  const projected=[];let minimumBorder=Infinity;
  for(const point of samples){
    const uv=project(photo,point),[w,h]=photo.imageSize;
    if(!uv || !uv.every(Number.isFinite)) return {ok:false,reason:'projection'};
    const border=Math.min(uv[0],uv[1],w-uv[0],h-uv[1]);minimumBorder=Math.min(minimumBorder,border);
    if(border<IMAGE_BORDER) return {ok:false,reason:'border'};
    if(!maskContains(photo.mask,Math.floor(uv[1])*w+Math.floor(uv[0]))) return {ok:false,reason:'mask'};
    ray.origin.set(...photo.position);direction.set(...point).sub(ray.origin);const distance=direction.length();ray.direction.copy(direction).normalize();
    if(bvh.raycastFirst(ray,DoubleSide,.05,distance-.08)) return {ok:false,reason:'occlusion'};
    projected.push(uv);
  }
  const area=triangleArea(triangle),q=projected.slice(0,3);
  const pixelArea=Math.abs((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2;
  const ppm=Math.sqrt(pixelArea/Math.max(area,1e-9));
  if(!Number.isFinite(ppm) || ppm<MIN_PIXELS_PER_METRE) return {ok:false,reason:'resolution'};
  return {ok:true,projected,minimumBorder,pixelsPerMetre:ppm};
}
function visibilityReason(photo,point){
  const uv=project(photo,point),[w,h]=photo.imageSize;
  if(!uv || !uv.every(Number.isFinite)) return 'projection';
  if(Math.min(uv[0],uv[1],w-uv[0],h-uv[1])<IMAGE_BORDER) return 'border';
  if(!maskContains(photo.mask,Math.floor(uv[1])*w+Math.floor(uv[0]))) return 'semantic-mask';
  ray.origin.set(...photo.position);direction.set(...point).sub(ray.origin);const distance=direction.length();ray.direction.copy(direction).normalize();
  return bvh.raycastFirst(ray,DoubleSide,.05,distance-.08)?'occlusion':'visible';
}
function barycentric(point,a,b,c){
  const v0=[b[0]-a[0],b[1]-a[1]],v1=[c[0]-a[0],c[1]-a[1]],v2=[point[0]-a[0],point[1]-a[1]];
  const d00=dot(v0,v0),d01=dot(v0,v1),d11=dot(v1,v1),d20=dot(v2,v0),d21=dot(v2,v1),den=d00*d11-d01*d01;
  if(Math.abs(den)<1e-12) return null;
  const vb=(d11*d20-d01*d21)/den,vc=(d00*d21-d01*d20)/den,va=1-vb-vc;
  return va>=-1e-7&&vb>=-1e-7&&vc>=-1e-7?[va,vb,vc]:null;
}
async function visibilityMask(photo,surface,tag){
  const ppm=Math.min(VISIBILITY_PIXELS_PER_METRE,VISIBILITY_MAX_DIMENSION/Math.max(surface.width,1e-6),VISIBILITY_MAX_DIMENSION/Math.max(surface.height,1e-6));
  const width=Math.max(16,Math.round(surface.width*ppm)),height=Math.max(16,Math.round(surface.height*ppm));
  const mask=Buffer.alloc(width*height),covered=Buffer.alloc(width*height),reasonRgb=Buffer.alloc(width*height*3),triangles=[];
  const reasonCounts={visible:0,projection:0,border:0,'semantic-mask':0,occlusion:0};
  const colors={visible:[40,180,70],projection:[80,80,80],border:[240,190,40],'semantic-mask':[220,70,70],occlusion:[70,110,220]};
  for(let i=0;i<surface.positions.length;i+=9){
    const xyz=[0,1,2].map(k=>surface.positions.slice(i+k*3,i+k*3+3)),base=(i/3)*2,uv=[0,1,2].map(k=>surface.uv.slice(base+k*2,base+k*2+2));
    const xs=uv.map(v=>v[0]),ys=uv.map(v=>v[1]);
    triangles.push({xyz,uv,minX:Math.max(0,Math.floor(Math.min(...xs)*width)-1),maxX:Math.min(width-1,Math.ceil(Math.max(...xs)*width)+1),minY:Math.max(0,Math.floor(Math.min(...ys)*height)-1),maxY:Math.min(height-1,Math.ceil(Math.max(...ys)*height)+1)});
  }
  let geometryPixels=0,visiblePixels=0;
  for(const tri of triangles) for(let y=tri.minY;y<=tri.maxY;y++) for(let x=tri.minX;x<=tri.maxX;x++){
    const index=y*width+x;if(covered[index]) continue;
    const weights=barycentric([(x+.5)/width,(y+.5)/height],...tri.uv);if(!weights) continue;
    covered[index]=1;geometryPixels++;
    const point=[0,1,2].map(k=>weights[0]*tri.xyz[0][k]+weights[1]*tri.xyz[1][k]+weights[2]*tri.xyz[2][k]);
    const reason=visibilityReason(photo,point);reasonCounts[reason]++;
    if(reason==='visible'){mask[index]=255;visiblePixels++;}
    const color=colors[reason],offset=index*3;reasonRgb[offset]=color[0];reasonRgb[offset+1]=color[1];reasonRgb[offset+2]=color[2];
  }
  const out=`data/texture-city/kartaview/snap-visibility-${area}`,suffix=hash(tag).slice(0,12),path=`${out}/${surface.key}-${suffix}.png`,reasonPath=`${out}/${surface.key}-${suffix}.reasons.png`;
  await mkdir(out,{recursive:true});
  await sharp(mask,{raw:{width,height,channels:1}}).png().toFile(path);const bytes=await readFile(path);
  await sharp(reasonRgb,{raw:{width,height,channels:3}}).png().toFile(reasonPath);const reasonBytes=await readFile(reasonPath);
  return {mask,record:{path,sha256:hash(bytes),reasonPath,reasonSha256:hash(reasonBytes),size:[width,height],pixelsPerMetre:ppm,geometryPixels,visiblePixels,visibleRatio:geometryPixels?visiblePixels/geometryPixels:0,reasonCounts,policy:'continuous per-wall validity from semantic facade agreement, image border and whole-model BVH occlusion; one boundary margin is deferred to final atlas space'}};
}

const outputSurfaces=[],buildingReports=[];
for(const [buildingIndex,b] of buildings.entries()){
  const center=b.min.map((v,i)=>(v+b.max[i])/2),near=photos.filter(p=>Math.hypot(p.position[0]-center[0],p.position[2]-center[2])<CANDIDATE_SAFETY_RADIUS_METRES);
  const wallCandidates=new Map(),candidateDiagnostics=[];let attempts=0;
  const walls=b.walls.map(w=>{const t=triangulate(w.rings.map(r=>r.points)),triangles=[];for(let i=0;i<t.indices.length;i+=3)for(const tri of splitTriangle(t.indices.slice(i,i+3).map(j=>t.points[j])))if(triangleArea(tri)>=.01)triangles.push(tri);return {w,t,triangles};});
  for(const photo of near){
    let total=0,facingArea=0,weightedFacing=0,minimumBorder=Infinity;const ppms=[],projectedPoints=[],selected=[],rejected={projection:0,border:0,mask:0,occlusion:0,resolution:0};
    for(const {w,t,triangles} of walls){
      if(!t.points.length) continue;
      const view=sub(photo.position,t.points[0]),facing=dot(t.normal,view)/Math.hypot(...view);if(facing<.3) continue;
      const geometryArea=triangles.reduce((s,v)=>s+triangleArea(v),0);facingArea+=geometryArea;
      const accepted=[];let wallMinimumBorder=Infinity;const wallPpms=[];
      for(const tri of triangles){attempts++;const q=accepts(photo,tri);if(!q.ok){rejected[q.reason]++;continue;}accepted.push(tri);minimumBorder=Math.min(minimumBorder,q.minimumBorder);wallMinimumBorder=Math.min(wallMinimumBorder,q.minimumBorder);ppms.push(q.pixelsPerMetre);wallPpms.push(q.pixelsPerMetre);projectedPoints.push(...q.projected.slice(0,3));}
      if(!accepted.length) continue;
      const full=t.indices.map(j=>t.points[j]),origin=t.points[0],right=new Vector3(t.normal[2],0,-t.normal[0]).normalize().toArray(),up=cross(t.normal,right),plane=p=>[dot(sub(p,origin),right),dot(sub(p,origin),up)],planePoints=full.map(plane);
      const lo=Math.min(...planePoints.map(v=>v[0])),hi=Math.max(...planePoints.map(v=>v[0])),bottom=Math.min(...planePoints.map(v=>v[1])),top=Math.max(...planePoints.map(v=>v[1])),width=hi-lo,height=top-bottom;
      if(width<.02||height<.02) continue;
      const imagePoints=[[lo,bottom],[hi,bottom],[hi,top],[lo,top]].map(([u,v])=>project(photo,origin.map((x,i)=>x+right[i]*u+up[i]*v)));
      if(imagePoints.some(v=>!v||!v.every(Number.isFinite))) continue;
      const acceptedArea=accepted.reduce((s,v)=>s+triangleArea(v),0);total+=acceptedArea;weightedFacing+=acceptedArea*facing;wallPpms.sort((a,b)=>a-b);const wallMedian=wallPpms[Math.floor(wallPpms.length/2)]||0;
      const sourceQuality=clamp(.32*clamp((facing-.3)/.7)+.25*clamp(wallMedian/8)+.20*clamp((wallMinimumBorder-IMAGE_BORDER)/70)+.13*clamp((geometryArea?acceptedArea/geometryArea:0)/.5)+.10*clamp(1-(photo.anchorErrorMetres||0)/10));
      const q=quadrant(t.normal),key=hash(`${b.id}:${w.id}`).slice(0,24);
      selected.push({key,buildingId:b.id,polygonId:w.id,groupKey:`${b.id}|direction-${q}`,quadrant:q,normal:t.normal,width,height,imagePoints,area:acceptedArea,geometryArea,coverageRatio:geometryArea?acceptedArea/geometryArea:0,frontalCosine:facing,sourceQuality,effectivePixelsPerMetreMedian:wallMedian,minimumBorderPixels:wallMinimumBorder,sourceId:photo.id,positions:full.flat(),uv:full.flatMap(p=>{const [u,v]=plane(p);return [(u-lo)/width,(top-v)/height];})});
    }
    const [iw,ih]=photo.imageSize,xs=projectedPoints.map(v=>v[0]),ys=projectedPoints.map(v=>v[1]),bbox=projectedPoints.length?[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]:[0,0,0,0];
    const imageOccupancy=((bbox[2]-bbox[0])*(bbox[3]-bbox[1]))/(iw*ih),facadeCoverage=facingArea?total/facingArea:0,frontalCosine=total?weightedFacing/total:0;
    ppms.sort((a,b)=>a-b);const median=ppms[Math.floor(ppms.length/2)]||0;
    const score=total*(.20+.25*clamp(facadeCoverage/.16)+.15*clamp(imageOccupancy/.12)+.15*clamp(median/8)+.12*clamp((frontalCosine-.3)/.7)+.08*clamp(1-(photo.anchorErrorMetres||0)/10)+.05*clamp((minimumBorder-IMAGE_BORDER)/70));
    const rejectionReason=!total?'no-accepted-triangles':facadeCoverage<MIN_FACADE_COVERAGE?'facade-coverage':imageOccupancy<MIN_IMAGE_OCCUPANCY?'edge-only-image-occupancy':null;
    candidateDiagnostics.push({sourceId:photo.id,distanceMetres:Math.hypot(photo.position[0]-center[0],photo.position[2]-center[2]),projectedArea:total,facingArea,facadeCoverage,imageOccupancy,minimumBorderPixels:Number.isFinite(minimumBorder)?minimumBorder:null,effectivePixelsPerMetreMedian:median,frontalCosine,anchorErrorMetres:photo.anchorErrorMetres,score,rejected,rejectionReason});
    if(!rejectionReason) for(const surface of selected){if(!wallCandidates.has(surface.key)) wallCandidates.set(surface.key,[]);wallCandidates.get(surface.key).push({photo,surface});}
  }
  const start=outputSurfaces.length;
  for(const candidates of wallCandidates.values()){
    candidates.sort((a,b)=>b.surface.sourceQuality-a.surface.sourceQuality||b.surface.area-a.surface.area||String(a.photo.id).localeCompare(String(b.photo.id)));
    const base=candidates[0].surface,sourceMappings=[];let unionMask=null,geometryPixels=0;
    for(const {photo,surface} of candidates){
      const visibility=await visibilityMask(photo,base,String(photo.id));if(!visibility.record.visiblePixels) continue;
      if(!unionMask) unionMask=Buffer.alloc(visibility.mask.length);if(unionMask.length!==visibility.mask.length) throw Error('Visibility dimensions changed across source mappings');
      for(let i=0;i<unionMask.length;i++) if(visibility.mask[i]) unionMask[i]=255;
      geometryPixels=visibility.record.geometryPixels;
      sourceMappings.push({sourceId:photo.id,imagePoints:surface.imagePoints,frontalCosine:surface.frontalCosine,sourceQuality:surface.sourceQuality,effectivePixelsPerMetreMedian:surface.effectivePixelsPerMetreMedian,minimumBorderPixels:surface.minimumBorderPixels,acceptedArea:surface.area,visibilityMask:visibility.record});
    }
    if(!sourceMappings.length||!unionMask) continue;
    const visiblePixels=unionMask.reduce((s,v)=>s+(v?1:0),0),projectedArea=geometryPixels?base.geometryArea*visiblePixels/geometryPixels:0;
    const {sourceId,imagePoints,frontalCosine,sourceQuality,effectivePixelsPerMetreMedian,minimumBorderPixels,...canonical}=base;
    outputSurfaces.push({...canonical,area:projectedArea,coverageRatio:base.geometryArea?projectedArea/base.geometryArea:0,sourceIds:sourceMappings.map(v=>v.sourceId),sourceMappings,visibilityUnion:{geometryPixels,visiblePixels,visibleRatio:geometryPixels?visiblePixels/geometryPixels:0,policy:'union of provenance-valid source visibility masks; source assignment remains discrete and provider provenance is preserved'}});
  }
  candidateDiagnostics.sort((a,b)=>b.score-a.score);
  const applied=outputSurfaces.slice(start),projectedArea=applied.reduce((s,v)=>s+v.area,0),sourceIds=[...new Set(applied.flatMap(v=>v.sourceMappings.map(m=>m.sourceId)))];
  const rejectionSummary=candidateDiagnostics.reduce((acc,c)=>{acc[c.rejectionReason??'accepted']=(acc[c.rejectionReason??'accepted']||0)+1;for(const [reason,count] of Object.entries(c.rejected))acc[`triangle:${reason}`]=(acc[`triangle:${reason}`]||0)+count;return acc;},{});
  buildingReports.push({buildingId:b.id,areaId:area,projectedArea,sourceIds,candidatePhotos:near.length,attempts,outcome:projectedArea?'provisional-surfaces':'no-accepted-surface',topCandidates:candidateDiagnostics.slice(0,3),candidateRejectionSummary:rejectionSummary,...(onlyBuildingId?{candidateDiagnostics}: {})});
  if(buildingIndex%100===0) console.log({area,processed:buildingIndex+1,total:buildings.length,projected:buildingReports.filter(v=>v.projectedArea>0).length});
}
geometry.dispose();
const usedIds=new Set(outputSurfaces.flatMap(v=>v.sourceMappings.map(m=>m.sourceId)));
const record={areaId:area,inputSha256:hash(inputBytes),geometrySha256:hash(geometryBytes),totalBuildings:city.buildings.length,processedBuildings:buildings.length,onlyBuildingId,buildings:buildingReports,surfaces:outputSurfaces,photos:photos.filter(v=>usedIds.has(v.id)).map(({mask,...rest})=>rest),qualityGates:{imageBorderPixels:IMAGE_BORDER,minimumEffectivePixelsPerMetre:MIN_PIXELS_PER_METRE,minimumFacadeCoverage:MIN_FACADE_COVERAGE,minimumImageOccupancy:MIN_IMAGE_OCCUPANCY,visibilityPixelsPerMetre:VISIBILITY_PIXELS_PER_METRE,visibilityMaximumDimension:VISIBILITY_MAX_DIMENSION,candidateSafetyRadiusMetres:CANDIDATE_SAFETY_RADIUS_METRES,acceptedOcclusionContradictions:0},policy:'multi-source per WallSurface using projection, semantic facade agreement, whole-model BVH occlusion, resolution, frontal-angle, SfM/GPS and road-height gates; PLATEAU geometry is authoritative; source colors are never blended across providers',applied:true};
const outputPath=outputArg||`data/texture-city/kartaview/snap-surfaces-${area}${onlyBuildingId?'-target':''}.json`;
await writeFile(outputPath,JSON.stringify(record));
console.log({area,totalBuildings:record.totalBuildings,processedBuildings:record.processedBuildings,surfaces:outputSurfaces.length,projectedBuildings:buildingReports.filter(v=>v.projectedArea>0).length,outputPath});
