import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const dir='data/texture-city/photos/mapillary';
const photos=[],errors=[];
for(const f of await readdir(dir)){
 if(!/^\d+\.json$/.test(f))continue;
 const p=JSON.parse(await readFile(`${dir}/${f}`,'utf8'));
 try{
  const b=await readFile(`${dir}/${p.id}.jpg`),im=await sharp(b).metadata();
  if(createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('hash-mismatch');
  if(im.width!==p.downloadSize[0]||im.height!==p.downloadSize[1])throw Error('dimension-mismatch');
  const c=p.computed_geometry?.coordinates||p.geometry?.coordinates;
  if(!c||c[0]<139.67||c[0]>139.77||c[1]<35.64||c[1]>35.71)throw Error('outside-target-region');
  photos.push({id:p.id,lon:c[0],lat:c[1],type:p.camera_type||'unavailable',positionSource:p.computed_geometry?'computed_geometry':'original_geometry',hasRotation:!!p.computed_geometry&&p.computed_rotation?.length===3&&p.computed_rotation.every(Number.isFinite),hasIntrinsics:p.camera_type==='spherical'||p.camera_type==='equirectangular'||(p.camera_type==='perspective'&&p.camera_parameters?.[0]>0),username:p.creator?.username,bytes:b.length});
 }catch(e){errors.push({id:p.id,error:e.message});}
}
const c=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
const buildings=c.buildings.map(b=>{
 const candidates=photos.map(p=>({id:p.id,distance:Math.hypot((p.lon-b.lon)*111320*Math.cos(b.lat*Math.PI/180),(p.lat-b.lat)*111320),cameraUsable:p.hasRotation&&p.hasIntrinsics})).filter(p=>p.distance<150).sort((a,b)=>a.distance-b.distance);
 return {id:b.id,areaId:b.areaId,nearbyDownloadedPhotos:candidates.length,cameraUsableCandidates:candidates.filter(p=>p.cameraUsable).length,nearest:candidates.slice(0,12),registration:'not-verified',applied:false};
});
const report={generatedAt:new Date().toISOString(),downloadedAndHashVerified:photos.length,totalBytes:photos.reduce((s,p)=>s+p.bytes,0),cameraTypes:Object.fromEntries([...Map.groupBy(photos,p=>p.type)].map(([k,v])=>[k,v.length])),errors,totalBuildings:buildings.length,buildingsWithPhotoWithin150m:buildings.filter(b=>b.nearbyDownloadedPhotos).length,buildingsWithCameraCandidate:buildings.filter(b=>b.cameraUsableCandidates).length,note:'Acquired photos, not registered wall coverage. Existing manually verified patches are not part of this new batch.',buildings};
await mkdir('data/texture-city',{recursive:true});
await writeFile('data/texture-city/photo-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,buildings:undefined}));
if(errors.length)process.exitCode=1;
