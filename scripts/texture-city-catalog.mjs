import {readFile,writeFile,mkdir} from 'node:fs/promises';
import proj4 from 'proj4';
import {triangulate,sub,cross,CRS,GEO} from './plateau-geometry.mjs';
const output='public/assets/texture-poc';
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
const patches=JSON.parse(await readFile(output+'/verified-patches.json','utf8'));
let previous;try{previous=JSON.parse(await readFile(output+'/city-catalog.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const previousBuildings=new Map((previous?.buildings||[]).map(b=>[b.id,b]));
const buildings=[];
function area(p){const t=triangulate(p.rings.map(r=>r.points));let sum=0;for(let i=0;i<t.indices.length;i+=3){const [a,b,c]=t.indices.slice(i,i+3).map(j=>t.points[j]);sum+=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;}return sum;}
for(const a of catalog.areas){
 const g=JSON.parse(await readFile(`data/plateau/${a.dataset}/${a.id==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
 for(const [i,b] of g.buildings.entries()){
  const center=b.min.map((v,i)=>(v+b.max[i])/2),lonlat=proj4(CRS,GEO,[center[0]+g.origin[0],-center[2]+g.origin[1]]);
  const total=b.walls.reduce((s,p)=>s+area(p),0),known=patches.filter(p=>p.buildingId===b.id);
  const applied={snap:0,mapillary:0},sourceIds={snap:[],mapillary:[]};
  for(const patch of known){const polygon=b.walls.find(p=>p.id===patch.polygonId);if(!polygon)throw Error('Unknown verified polygon: '+patch.polygonId);
   const full=area(polygon),height=patch.heightRange[1]-patch.heightRange[0];
   for(const method of ['snap','mapillary'])if(patch.sources[method]){const s=patch.sources[method],lo=s.appliedHeightRange[0],hi=s.appliedHeightRange[1];if(height<=0||hi<=lo||lo<patch.heightRange[0]||hi>patch.heightRange[1])throw Error('Invalid coverage interval');applied[method]+=full*(hi-lo)/height;sourceIds[method].push(s.sourceId);}
  }
  if(applied.snap>total||applied.mapillary>total)throw Error('Applied area exceeds available facade');
  buildings.push({id:b.id,areaId:a.id,label:known[0]?.label||`${a.name} 建物 ${i+1}`,lod:b.lod,center,min:b.min,max:b.max,lon:lonlat[0],lat:lonlat[1],wallArea:total,
   wallIds:catalog.walls.filter(w=>w.source.buildingId===b.id).map(w=>w.id),
   status:applied.snap&&applied.mapillary?'both':applied.snap||applied.mapillary?'single':'unapplied',snap:{appliedArea:applied.snap,source:sourceIds.snap.join(','),survey:applied.snap?'applied':'not-searched'},mapillary:{appliedArea:applied.mapillary,source:sourceIds.mapillary.join(','),survey:applied.mapillary?'applied':'not-searched'}});
 }
}
// Recomputing geometry must not erase already collected independent photo candidates.
for(const b of buildings)for(const method of ['snap','mapillary']){
 const old=previousBuildings.get(b.id)?.[method];if(!old)continue;
 for(const key of ['candidates','queryCell'])if(old[key]!==undefined)b[method][key]=old[key];
 if(!b[method].appliedArea&&old.survey!=='applied')b[method].survey=old.survey;
}
const manifest={datasetVersion:catalog.datasetVersion,generatedAt:new Date().toISOString(),survey:previous?.survey,areas:catalog.areas.map(({id,name,model,camera,bounds})=>({id,name,model,camera,bounds})),buildings,
 patches:patches.map(p=>({buildingId:p.buildingId,areaId:p.areaId,polygonId:p.polygonId,snap:p.sources.snap?.model,mapillary:p.sources.mapillary?.model})),
 notes:'Applied areas are geometric surface areas, not visual quality or registration accuracy. Candidate photos are not verified facade coverage. Original textures remain everywhere else.'};
await mkdir(output,{recursive:true});await writeFile(output+'/city-catalog.json',JSON.stringify(manifest));
console.log(JSON.stringify({buildings:buildings.length,wallGroups:buildings.reduce((s,b)=>s+b.wallIds.length,0),both:buildings.filter(b=>b.status==='both').length,applied:buildings.filter(b=>b.status==='both').map(b=>({name:b.label,total:b.wallArea,snap:b.snap.appliedArea,mapillary:b.mapillary.appliedArea}))}));
