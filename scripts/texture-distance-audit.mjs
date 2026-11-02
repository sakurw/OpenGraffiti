import {readFile,writeFile} from 'node:fs/promises';
import {cameraFor,overlapsPhoto} from './texture-camera.mjs';
import {frame,dot,sub} from './plateau-geometry.mjs';
const previous=JSON.parse(await readFile('data/texture-city/camera-gate-audit.json','utf8'));
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8')),results=[];
for(const a of catalog.areas){
 const g=JSON.parse(await readFile(`data/plateau/${a.dataset}/${a.id==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
 const projection=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${a.id}.json`,'utf8'));
 const noView=new Set(projection.buildings.filter(b=>b.outcome==='no-front-facing-photo-in-range-and-view'||b.outcome==='no-nearby-eligible-photo').map(b=>b.buildingId));
 const photos=[];
 for(const p of previous.find(x=>x.areaId===a.id).photos){
  if(!p.facadePixels||p.reason==='ambiguous-road-levels')continue;
  const height=p.height||p.terrain;if(!height)continue;
  const meta=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${p.id}.json`,'utf8'));
  const camera=cameraFor(meta,g.origin,height.height);if(camera)photos.push({id:p.id,camera});
 }
 const items=[];
 for(const b of g.buildings.filter(b=>noView.has(b.id))){
  const center=b.min.map((v,i)=>(v+b.max[i])/2);let nearMin=Infinity,areaMin=Infinity,best;
  for(const wall of b.walls){const points=wall.rings.flatMap(r=>r.points),normal=frame(points).normal,pc=points[0].map((_,i)=>points.reduce((s,p)=>s+p[i],0)/points.length);
   for(const p of photos){const d=sub(p.camera.position,pc),distance=Math.hypot(...d);if(dot(d,normal)/distance<=.3||!overlapsPhoto(p.camera,points))continue;
    const centerDistance=Math.hypot(p.camera.position[0]-center[0],p.camera.position[2]-center[2]);
    if(distance<areaMin){areaMin=distance;best={photoId:p.id,centerDistance,wallCenter:pc};}
    if(centerDistance<150)nearMin=Math.min(nearMin,distance);
   }
  }
  items.push({id:b.id,lod:b.lod,height:b.max[1]-b.min[1],nearestWithinOldNeighborhood:Number.isFinite(nearMin)?nearMin:null,nearestInArea:Number.isFinite(areaMin)?areaMin:null,best});
 }
 const result={area:a.id,buildings:items.length,blockedBy120m:items.filter(b=>b.nearestWithinOldNeighborhood>=120).length,candidateWithin300m:items.filter(b=>b.nearestInArea!==null&&b.nearestInArea<300).length,noCandidateInArea:items.filter(b=>b.nearestInArea===null).length,items};results.push(result);console.log({...result,items:undefined});
}
await writeFile('data/texture-city/distance-gate-audit.json',JSON.stringify(results,null,2));
