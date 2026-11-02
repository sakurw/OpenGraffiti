import {readFile,writeFile,readdir} from 'node:fs/promises';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';

// Conservative spatial visibility audit, not photographic building registration.
// BBox intersections indicate potential occluders; the absence of an occluder
// cannot demonstrate that a facade is actually visible in a photograph.
const root='data/texture-city/universal-ten-buildings/images/mapillary';
const metadata=new Map();
for(const file of await readdir(root))if(file.endsWith('.json')){
 try{const p=JSON.parse(await readFile(`${root}/${file}`,'utf8'));
  if(p.id&&p.computed_geometry?.coordinates)metadata.set(String(p.id),p);
 }catch{}
}
const intersects=(a,b,box)=>{
 let lo=0,hi=1;
 for(const [axis,min,max] of [[0,box.min[0],box.max[0]],[1,box.min[2],box.max[2]]]){
  const delta=b[axis]-a[axis];
  if(Math.abs(delta)<1e-8){if(a[axis]<min||a[axis]>max)return null;continue;}
  const u=(min-a[axis])/delta,v=(max-a[axis])/delta;
  lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));
  if(lo>hi)return null;
 }
 return hi>0.04&&lo<0.96?Math.max(lo,0):null;
};
const output={generatedAt:new Date().toISOString(),method:'camera-to-building-bbox-occlusion-screen-v1',areas:[],caution:'Potential occlusion only. Camera elevations, pixel segmentation, building target correspondence and complete geometry are not validated.'};
for(const [area,filename] of [['tocho','data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json'],['tokyo-tower','data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json']]){
 const geo=JSON.parse(await readFile(filename,'utf8'));
 // Audit every eligible discovery candidate, independently of whichever
 // images the color inference happened to select in an earlier run.
 const discovery=JSON.parse(await readFile(`data/texture-city/universal-all-buildings/ground/${area}-discovery.json`,'utf8'));
 const byId=new Map(geo.buildings.map(b=>[b.id,b]));
 const tileSize=40,grid=new Map(),key=(x,z)=>`${Math.floor(x/tileSize)},${Math.floor(z/tileSize)}`;
 for(const b of geo.buildings){
  for(let x=Math.floor(b.min[0]/tileSize);x<=Math.floor(b.max[0]/tileSize);x++)
   for(let z=Math.floor(b.min[2]/tileSize);z<=Math.floor(b.max[2]/tileSize);z++){
    const k=`${x},${z}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(b);
   }
 }
 const rows=[],counts={buildings:geo.buildings.length,photoEstimateBuildings:0,photosEvaluated:0,photosWithoutCoordinates:0,potentiallyOccluded:0,withoutBBoxOcclusion:0};
 for(const entry of discovery.buildings){
  const candidates=(entry.candidates??[]).filter(c=>c.distanceMetres<=110&&c.score>=.18);
  if(!candidates.length)continue;
  counts.photoEstimateBuildings++;
  const target=byId.get(entry.buildingId);
  if(!target)throw Error(`Missing PLATEAU building: ${entry.buildingId}`);
  const end=[(target.min[0]+target.max[0])/2,(target.min[2]+target.max[2])/2];
  const images=[];
  for(const candidate of candidates){
   const id=String(candidate.imageId);
   const photo=metadata.get(String(id));
   if(!photo){counts.photosWithoutCoordinates++;images.push({imageId:id,assessment:'missing-camera-coordinate'});continue;}
   const [east,north]=proj4(GEO,CRS,photo.computed_geometry.coordinates);
   const start=[east-geo.origin[0],-(north-geo.origin[1])];
   const n=Math.max(1,Math.ceil(Math.hypot(end[0]-start[0],end[1]-start[1])/tileSize));
   const possible=new Map();
   for(let i=0;i<=n;i++){const t=i/n,k=key(start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t);
    for(const b of grid.get(k)??[])if(b.id!==target.id)possible.set(b.id,b);
   }
   const occluders=[];
   for(const b of possible.values()){
    if(b.max[1]<target.min[1]-20)continue;
    const t=intersects(start,end,b);
    if(t!==null)occluders.push({buildingId:b.id,rayFraction:+t.toFixed(3)});
   }
   occluders.sort((a,b)=>a.rayFraction-b.rayFraction);
   counts.photosEvaluated++;
   if(occluders.length)counts.potentiallyOccluded++;else counts.withoutBBoxOcclusion++;
   images.push({imageId:id,assessment:occluders.length?'potential-bbox-occlusion':'no-bbox-occluder-found',occluders:occluders.slice(0,3)});
  }
  rows.push({buildingId:entry.buildingId,images});
 }
 output.areas.push({area,counts,buildings:rows});
 console.log(JSON.stringify({area,counts}));
}
await writeFile('test-results/universal-all-ground-visibility-audit.json',JSON.stringify(output,null,2));
