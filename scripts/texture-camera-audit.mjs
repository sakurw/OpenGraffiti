import {readFile,readdir,writeFile} from 'node:fs/promises';
import {cameraFor,roadHeight} from './texture-camera.mjs';
import {roadSurfaceHeight} from './texture-road-surface.mjs';
import {terrainFor} from './texture-terrain.mjs';
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8')),metas=[];
for(const f of await readdir('data/texture-city/photos/mapillary'))if(/^\d+\.json$/.test(f)){
 const p=JSON.parse(await readFile('data/texture-city/photos/mapillary/'+f,'utf8'));
 const mask=JSON.parse(await readFile('data/texture-city/facade-masks/'+f,'utf8'));
 metas.push({...p,facadePixels:mask.afterPixels});
}
const results=[];
const terrain=await terrainFor(metas.map(p=>p.computed_geometry.coordinates));
for(const a of catalog.areas){
 const g=JSON.parse(await readFile(`data/plateau/${a.dataset}/${a.id==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
 const surface=await roadSurfaceHeight(a,g.origin),roads=catalog.sections.filter(s=>s.areaId===a.id),photos=[];
 for(const p of metas){
  const camera=cameraFor(p,g.origin,0);if(!camera)continue;
  const local=camera.position;if(local[0]<a.bounds[0]-150||local[0]>a.bounds[1]+150||local[2]<a.bounds[2]-150||local[2]>a.bounds[3]+150)continue;
  const exact=surface.sample(local),height=exact?.ambiguous?null:exact||roadHeight(local,roads);
  const dem=terrain.sample(p.computed_geometry.coordinates);
  photos.push({id:p.id,position:local,facadePixels:p.facadePixels,height,terrain:dem,roadDemDifference:exact&&!exact.ambiguous&&dem?exact.height-dem.height:null,reason:!p.facadePixels?'no-facade-pixels':exact?.ambiguous?'ambiguous-road-levels':!height?'no-road-height':'eligible'});
 }
 surface.dispose();
 const projection=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${a.id}.json`,'utf8'));
 const buildings=g.buildings.map(b=>{
  const center=b.min.map((v,i)=>(v+b.max[i])/2),near=photos.filter(p=>Math.hypot(p.position[0]-center[0],p.position[2]-center[2])<150);
  return {id:b.id,lod:b.lod,center,nearbyByGate:Object.fromEntries([...Map.groupBy(near,p=>p.reason)].map(([k,v])=>[k,v.length])),outcome:projection.buildings.find(p=>p.buildingId===b.id).outcome};
 });
 const result={areaId:a.id,gates:Object.fromEntries([...Map.groupBy(photos,p=>p.reason)].map(([k,v])=>[k,v.length])),blockedOnlyByHeight:buildings.filter(b=>!b.nearbyByGate.eligible&&b.nearbyByGate['no-road-height']>0).length,photos,buildings};results.push(result);
 const diffs=photos.map(p=>p.roadDemDifference).filter(v=>v!==null).sort((a,b)=>a-b);
 result.terrainValidation={tiles:terrain.tiles,roadSamples:diffs.length,medianRoadMinusDem:diffs[Math.floor(diffs.length/2)],within2m:diffs.filter(v=>Math.abs(v)<=2).length,within5m:diffs.filter(v=>Math.abs(v)<=5).length,fallbackPhotos:photos.filter(p=>p.reason==='no-road-height'&&p.terrain).length};
 console.log(JSON.stringify({...result,photos:undefined,buildings:undefined}));
}
await writeFile('data/texture-city/camera-gate-audit.json',JSON.stringify(results,null,2));
