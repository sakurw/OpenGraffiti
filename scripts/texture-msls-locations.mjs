// Estimated world anchors for later SfM alignment, never measured ground truth.
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';
import {roadSurfaceHeight} from './texture-road-surface.mjs';
import {roadHeight} from './texture-camera.mjs';
import {terrainFor} from './texture-terrain.mjs';
const root='data/texture-city/photos/msls',photos=[];
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
for(const file of await readdir(root)){
 if(!/^[A-Za-z0-9_-]+\.json$/.test(file))continue;
 const p=JSON.parse(await readFile(`${root}/${file}`,'utf8'));
 if(p.provider!=='msls'||p.status!=='downloaded')throw Error('Unexpected source');
 if(createHash('sha256').update(await readFile(`${root}/${p.id}.jpg`)).digest('hex')!==p.sha256)throw Error('Photo hash mismatch');
 const lat=number(p.lat),lng=number(p.lng);if(lat===null||lng===null||Math.abs(lat)>90||Math.abs(lng)>180)throw Error('Missing GPS position');
 photos.push({...p,coordinates:[lng,lat]});
}
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
const terrain=await terrainFor(photos.map(p=>p.coordinates)),locations=[];
for(const area of catalog.areas){
 const surface=await roadSurfaceHeight(area,area.origin),roads=catalog.sections.filter(s=>s.areaId===area.id);
 for(const p of photos.filter(p=>p.areaIds.includes(area.id))){
  const [east,north]=proj4(GEO,CRS,p.coordinates),position=[east-area.origin[0],0,-(north-area.origin[1])];
  const exact=surface.sample(position),height=exact?.ambiguous?null:exact||roadHeight(position,roads)||terrain.sample(p.coordinates);
  const row={id:p.id,sequenceId:p.sequenceId,areaId:area.id,sourceSha256:p.sha256,coordinates:p.coordinates,gpsAccuracy:number(p.gpsAccuracy),
   status:height?'estimated-world-anchor':'height-unavailable',position:null,height:height??null};
  if(height){position[1]=height.height-area.origin[2];if(!position.every(Number.isFinite))throw Error('Invalid estimated height');row.position=position;}
  if(exact?.ambiguous)row.reason='ambiguous-road-level';locations.push(row);
 }
 surface.dispose();
}
const report={locations,origins:catalog.areas.map(a=>({areaId:a.id,origin:a.origin})),
 note:'GPS coordinates and road/ground-derived camera heights are approximate. These are not surveyed controls, registered cameras, wall identities or applied textures.'};
await mkdir('data/texture-city/msls',{recursive:true});await writeFile('data/texture-city/msls/locations.json',JSON.stringify(report,null,2));
console.log({photos:photos.length,anchors:locations.filter(p=>p.position).length,unknownHeight:locations.filter(p=>!p.position).length,
 methods:Object.fromEntries([...Map.groupBy(locations,p=>p.height?.method||p.reason||'unknown')].map(([k,v])=>[k,v.length]))});
