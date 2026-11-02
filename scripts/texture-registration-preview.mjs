// Diagnostic only: overlays source-model edges onto the actual downloaded photograph.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {cameraFor,projectPhoto,roadHeight} from './texture-camera.mjs';
const [id,areaId='tokyo-tower']=process.argv.slice(2);
if(!/^\d+$/.test(id||''))throw Error('Usage: node scripts/texture-registration-preview.mjs IMAGE_ID [AREA]');
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
const area=catalog.areas.find(a=>a.id===areaId);if(!area)throw Error('Unknown area');
const g=JSON.parse(await readFile(`data/plateau/${area.dataset}/${areaId==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
const root='data/texture-city/photos/mapillary',p=JSON.parse(await readFile(`${root}/${id}.json`,'utf8'));
const provisional=cameraFor(p,g.origin,0);if(!provisional)throw Error('Camera metadata incomplete');
const height=roadHeight(provisional.position,catalog.sections.filter(s=>s.areaId===areaId));
if(!height)throw Error('No nearby LOD3 road height: registration required');
const c=cameraFor(p,g.origin,height.height),[w,h]=p.downloadSize;
const paths=[],buildingIds=[];
for(const b of g.buildings){
 const dx=Math.max(b.min[0]-c.position[0],0,c.position[0]-b.max[0]),dz=Math.max(b.min[2]-c.position[2],0,c.position[2]-b.max[2]);
 if(Math.hypot(dx,dz)>100)continue;
 buildingIds.push(b.id);
 for(const poly of b.walls)for(const ring of poly.rings){
  for(let i=0;i<ring.points.length;i++){
   const a=ring.points[i],b=ring.points[(i+1)%ring.points.length];let last=null;
   // Curved equirectangular image lines need subdivision; no seam-spanning lines.
   for(let j=0;j<=16;j++){
    const q=projectPhoto(c,a.map((v,k)=>v+(b[k]-v)*j/16));
    if(q&&last&&Math.abs(q[0]-last[0])<.1&&q[0]>=0&&q[0]<=1&&q[1]>=0&&q[1]<=1)
     paths.push(`M${(last[0]*w).toFixed(1)},${(last[1]*h).toFixed(1)}L${(q[0]*w).toFixed(1)},${(q[1]*h).toFixed(1)}`);
    last=q;
   }
  }
 }
}
const out='data/texture-city/registration';await mkdir(out,{recursive:true});
await sharp(`${root}/${id}.jpg`).composite([{input:Buffer.from(`<svg width="${w}" height="${h}"><path d="${paths.join('')}" fill="none" stroke="#ff0088" stroke-width="1" opacity=".65"/></svg>`)}]).jpeg({quality:90}).toFile(`${out}/${id}-edges.jpg`);
await writeFile(`${out}/${id}.json`,JSON.stringify({id,areaId,cameraPosition:c.position,height,nearbyBuildingIds:buildingIds,registration:'estimated-unverified',note:'All nearby wall edges, including hidden edges, shown for calibration. Not a visibility mask.'},null,2));
console.log(JSON.stringify({id,cameraPosition:c.position,height,buildings:buildingIds.length}));
