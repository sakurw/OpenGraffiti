import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';

// Area-level discovery is shared across all buildings. A GPS/heading candidate
// is never evidence of a successfully registered building facade.
const root='data/texture-city/universal-all-buildings/ground';
await mkdir(root,{recursive:true});
const token=process.env.MAPILLARY_ACCESS_TOKEN;
const rad=x=>x*Math.PI/180;
function distance(a,b){const dlat=rad(b[0]-a[0]),dlon=rad(b[1]-a[1]),v=Math.sin(dlat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dlon/2)**2;return 12742000*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));}
function bearing(a,b){const p=rad(a[0]),q=rad(b[0]),d=rad(b[1]-a[1]);return (Math.atan2(Math.sin(d)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(d))*180/Math.PI+360)%360;}
const angular=(a,b)=>Math.abs(((a-b+540)%360)-180);
function children([w,s,e,n]){const x=(w+e)/2,y=(s+n)/2;return [[w,s,x,y],[x,s,e,y],[w,y,x,n],[x,y,e,n]];}
async function save(file,content){await writeFile(file+'.partial',content);await rename(file+'.partial',file);}
async function fetchCached(box){
 const key=box.map(v=>v.toFixed(6)).join('_'),file=`${root}/tile_${key}.json`;
 if(existsSync(file))return JSON.parse(await readFile(file,'utf8'));
 if(!token)return {data:[],error:'MAPILLARY_ACCESS_TOKEN unavailable'};
 const url=new URL('https://graph.mapillary.com/images');
 url.search=new URLSearchParams({bbox:box.join(','),fields:'id,computed_geometry,captured_at,compass_angle,is_pano,camera_type',limit:'100'}).toString();
 let lastError='retry exhausted';
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetch(url,{headers:{Authorization:`OAuth ${token}`},signal:AbortSignal.timeout(18000)});
   if(response.ok){const result=await response.json();await save(file,JSON.stringify(result));return result;}
   lastError=`HTTP ${response.status}`;
   if(response.status===500||response.status!==429&&response.status<500)return {data:[],error:lastError};
  }catch(error){lastError=error.message;}
  await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
 }
 return {data:[],error:lastError};
}
const option=(flag,fallback)=>{const at=process.argv.indexOf(flag);return at>=0?Math.max(1,Number(process.argv[at+1])||fallback):fallback;};
const MAX_DEPTH=option('--max-depth',4),MAX_REQUESTS=option('--max-requests',340);
const pilotDir='data/texture-city/universal-ten-buildings/images/mapillary';
const pilot=[];
if(existsSync(pilotDir))for(const filename of await readdir(pilotDir))if(filename.endsWith('.json')){
 try{const row=JSON.parse(await readFile(`${pilotDir}/${filename}`,'utf8'));if(row.id&&row.computed_geometry?.coordinates)pilot.push(row);}catch{}
}
for(const [area,filepath] of [['tocho','data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json'],['tokyo-tower','data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json']]){
 const geo=JSON.parse(await readFile(filepath,'utf8'));
 const buildings=geo.buildings.map(b=>{const center=[(b.min[0]+b.max[0])/2,(b.min[2]+b.max[2])/2];const [lon,lat]=proj4(CRS,GEO,[center[0]+geo.origin[0],geo.origin[1]-center[1]]);return {buildingId:b.id,lat,lon};});
 const box=[Math.min(...buildings.map(b=>b.lon))-.002,Math.min(...buildings.map(b=>b.lat))-.002,Math.max(...buildings.map(b=>b.lon))+.002,Math.max(...buildings.map(b=>b.lat))+.002];
 const cachedOnly=process.argv.includes('--cached-only');
 const candidates=new Map(pilot.map(p=>[String(p.id),p])),requests=[],queue=cachedOnly?[]:[{box,depth:0}];
 while(queue.length&&requests.length<MAX_REQUESTS){
  const job=queue.shift(),result=await fetchCached(job.box),rows=result.data??[];
  requests.push({box:job.box,depth:job.depth,count:rows.length,error:result.error??null,truncated:rows.length>=100&&job.depth===MAX_DEPTH});
  for(const photo of rows)if(photo.computed_geometry?.coordinates)candidates.set(String(photo.id),photo);
  // A large geographic query can return HTTP 500. Try smaller bounding boxes,
  // retaining the failed parent for audit rather than silently losing coverage.
  if((rows.length>=100||result.error?.startsWith('HTTP 500'))&&job.depth<MAX_DEPTH)
   for(const part of children(job.box))queue.push({box:part,depth:job.depth+1});
 }
 const photos=[...candidates.values()].map(p=>({...p,point:[p.computed_geometry.coordinates[1],p.computed_geometry.coordinates[0]]}));
 const records=buildings.map(b=>{
  const target=[b.lat,b.lon],matches=[];
  for(const p of photos){const metres=distance(p.point,target);if(metres>220)continue;const pano=p.is_pano===true,heading=Number(p.compass_angle),angle=pano?0:Number.isFinite(heading)?angular(heading,bearing(p.point,target)):180;
   if(!pano&&angle>85)continue;
   matches.push({imageId:String(p.id),distanceMetres:+metres.toFixed(1),headingErrorDegrees:+angle.toFixed(1),capturedAt:p.captured_at??null,sourcePage:`https://www.mapillary.com/app/?pKey=${p.id}`,score:+(Math.exp(-metres/110)*(pano?.8:Math.max(.05,Math.cos(rad(angle))**2))).toFixed(4),registration:'unverified-candidate'});
  }
  matches.sort((a,b)=>b.score-a.score);
  return {...b,candidateCount:matches.length,candidates:matches.slice(0,24)};
 });
 const output={area,generatedAt:new Date().toISOString(),provider:'Mapillary',licenseNote:'Mapillary contributor attribution and applicable API terms required for image use',registration:'candidate-only; building/facade registration not performed',discoveryMode:cachedOnly?'pilot-cache-only':'live-plus-pilot-cache',photoMetadataSources:['previous ten-building pilot cache','current Mapillary area queries when available'],cachedPilotPhotoCount:pilot.length,requestedTiles:requests.length,unqueriedTiles:queue.length,failedTiles:requests.filter(x=>x.error).length,truncatedTiles:requests.filter(x=>x.truncated).length,uniquePhotoMetadata:photos.length,buildingsWithCandidates:records.filter(x=>x.candidateCount>0).length,buildingCount:records.length,searchComplete:!cachedOnly&&queue.length===0&&requests.every(r=>!r.error||r.error==='HTTP 500'&&r.depth<MAX_DEPTH)&&requests.every(r=>!r.truncated),requests,buildings:records};
 await save(`${root}/${area}-discovery.json`,JSON.stringify(output));
 console.log(JSON.stringify({area,requestedTiles:output.requestedTiles,unqueriedTiles:output.unqueriedTiles,failedTiles:output.failedTiles,uniquePhotoMetadata:photos.length,buildingsWithCandidates:output.buildingsWithCandidates,buildingCount:records.length}));
}
