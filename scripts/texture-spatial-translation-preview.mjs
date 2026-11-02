// Read-only camera correction experiment. NEVER writes projection inputs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {BufferGeometry,Float32BufferAttribute,Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {cameraFor,projectPhoto} from './texture-camera.mjs';
import {decodeSpatialMesh} from './texture-spatial-depth.mjs';
import {triangulate} from './plateau-geometry.mjs';
import {searchTranslation} from './texture-translation-search.mjs';
const [area,id,option]=process.argv.slice(2);
if(option&&option!=='--fixed-height')throw Error('Unknown translation option');
const fixedHeight=option==='--fixed-height';
if(!['tocho','tokyo-tower'].includes(area)||!/^\d+$/.test(id||''))throw Error('Specify area and source photo ID');
const hash=b=>createHash('sha256').update(b).digest('hex');
const report=JSON.parse(await readFile(`public/assets/texture-poc/experimental/selection/wall-coverage-all/${area}.json`,'utf8'));
const source=report.sources.find(p=>p.id===id);if(!source)throw Error('Photo must have an existing audited projection pose');
const photo=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${id}.json`,'utf8'));
const image=await readFile(`data/texture-city/photos/mapillary/${id}.jpg`);
if(hash(image)!==photo.sha256||source.sourceSha256!==photo.sha256)throw Error('Photo identity mismatch');
const meta=JSON.parse(await readFile(`data/texture-city/spatial/${id}.json`,'utf8'));
if(meta.id!==id||meta.sourceSha256!==photo.sha256||!meta.resources?.mesh?.available||!(meta.atomicScale>0))throw Error('No source-verified scaled mesh');
const bytes=await readFile(`data/texture-city/spatial/${id}.mesh.bin`);if(hash(bytes)!==meta.resources.mesh.sha256)throw Error('Mesh hash mismatch');
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8')),a=catalog.areas.find(a=>a.id===area);
const gbytes=await readFile(`data/plateau/${a.dataset}/${area==='tocho'?'53394525':'53393599'}-geometry.json`),g=JSON.parse(gbytes);
const camera=cameraFor({...photo,exif_orientation:source.exifOrientation},g.origin,source.height.height);
if(!camera||camera.position.some((v,i)=>Math.abs(v-source.cameraPosition[i])>1e-6))throw Error('Camera does not reproduce existing pose');
const maskMeta=JSON.parse(await readFile(`data/texture-city/facade-masks/${id}.json`,'utf8'));
if(maskMeta.sourceSha256!==photo.sha256||maskMeta.policy!=='intersect-cityscapes-building-and-ade20k-building-family-v2')throw Error('Mask source/policy mismatch');
const maskBytes=await readFile(`data/texture-city/facade-masks/${id}.png`),mask=await sharp(maskBytes).greyscale().raw().toBuffer({resolveWithObject:true});
if(mask.info.width!==photo.downloadSize[0]||mask.info.height!==photo.downloadSize[1]||mask.info.channels!==1)throw Error('Mask dimensions mismatch');
const mesh=decodeSpatialMesh(bytes),inverse=camera.rotation.clone().invert(),samples=[];
// Use actual mesh vertices, not the perspective viewer's four artificial corners.
for(const index of [...new Set(mesh.faces)].sort((a,b)=>a-b)){
 if(photo.camera_type==='perspective'&&index<4)continue;
 const p=new Vector3(...mesh.vertices.slice(index*3,index*3+3)).divideScalar(meta.atomicScale),distance=p.length();
 if(distance<5||distance>100||photo.camera_type==='perspective'&&p.z<=0)continue;
 p.applyMatrix4(inverse);const point=[p.x+camera.position[0],p.z+camera.position[1],-p.y+camera.position[2]];
 const uv=projectPhoto(camera,point);if(!uv||uv[0]<0||uv[0]>=1||uv[1]<0||uv[1]>=1)continue;
 if(!mask.data[Math.floor(uv[1]*mask.info.height)*mask.info.width+Math.floor(uv[0]*mask.info.width)])continue;
 samples.push({index,point});
}
const train=samples.filter((_,i)=>i%3!==0),validation=samples.filter((_,i)=>i%3===0);
const out='data/texture-city/registration/spatial-translation';await mkdir(out,{recursive:true});
const result={area,id,sourceSha256:photo.sha256,meshSha256:meta.resources.mesh.sha256,geometrySha256:hash(gbytes),maskSha256:hash(maskBytes),originalPosition:camera.position,
 sampleCount:samples.length,trainingCount:train.length,validationCount:validation.length,fixedHeight,applied:false,
 warning:'Nearest-wall translation only, fixed source rotation and scale. Split vertices are correlated, not independent photos. Low residual does not prove wall identity, registration or texture correctness.'};
if(train.length<40||validation.length<20){result.status='insufficient-facade-mesh-points';}
else{
 const positions=[];for(const b of g.buildings){
  const center=b.min.map((v,i)=>(v+b.max[i])/2);if(Math.hypot(center[0]-camera.position[0],center[2]-camera.position[2])>200)continue;
  for(const wall of b.walls){const t=triangulate(wall.rings.map(r=>r.points));for(const index of t.indices)positions.push(...t.points[index]);}
 }
 if(!positions.length)throw Error('No nearby model walls');
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geometry),p=new Vector3();
 const metric=(rows,offset)=>{
  let clippedSum=0,within2=0;for(const row of rows){p.set(...row.point).add(new Vector3(...offset));const hit=bvh.closestPointToPoint(p,{},0,10),distance=hit?.distance??10;clippedSum+=Math.min(distance,10);if(distance<2)within2++;}
  return {clippedMeanDistance:clippedSum/rows.length,within2m:within2,total:rows.length};
 };
 const fit=searchTranslation(offset=>metric(train,offset).clippedMeanDistance,{bounds:[10,fixedHeight?0:3,10]});
 Object.assign(result,{status:'translation-hypothesis-unverified',fit,estimatedPosition:camera.position.map((v,i)=>v+fit.offset[i]),trainingBefore:metric(train,[0,0,0]),trainingAfter:metric(train,fit.offset),validationBefore:metric(validation,[0,0,0]),validationAfter:metric(validation,fit.offset)});
 // Source-image overlay for reviewing the hypothesis, never a texture asset.
 const width=1440,height=Math.round(mask.info.height*width/mask.info.width),background=await sharp(image).resize(width,height).png().toBuffer();
 const ray=new Ray(),direction=new Vector3();result.overlays=[];
 for(const [name,offset] of [['original',[0,0,0]],['estimated',fit.offset]]){
  const previewCamera={...camera,position:camera.position.map((v,i)=>v+offset[i])},lines=[];
  for(const b of g.buildings){
   const center=b.min.map((v,i)=>(v+b.max[i])/2);if(Math.hypot(center[0]-previewCamera.position[0],center[2]-previewCamera.position[2])>100)continue;
   for(const wall of b.walls)for(const ring of wall.rings)for(let i=0;i<ring.points.length;i++){
    const first=ring.points[i],second=ring.points[(i+1)%ring.points.length],uv=[projectPhoto(previewCamera,first),projectPhoto(previewCamera,second)];
    if(uv.some(p=>!p||p[0]<0||p[0]>=1||p[1]<0||p[1]>=1)||Math.abs(uv[0][0]-uv[1][0])>.5)continue;
    const mid=first.map((v,k)=>(v+second[k])/2);ray.origin.set(...previewCamera.position);direction.set(...mid).sub(ray.origin);const distance=direction.length();ray.direction.copy(direction).normalize();
    if(bvh.raycastFirst(ray,DoubleSide,.05,distance-.08))continue;
    lines.push(`<line x1="${(uv[0][0]*width).toFixed(2)}" y1="${(uv[0][1]*height).toFixed(2)}" x2="${(uv[1][0]*width).toFixed(2)}" y2="${(uv[1][1]*height).toFixed(2)}"/>`);
   }
  }
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g stroke="#00ffff" stroke-width="1" opacity=".8">${lines.join('')}</g><rect width="${width}" height="27" fill="#111"/><text x="8" y="19" fill="white" font-family="sans-serif" font-size="15">${name} [${offset.join(', ')}] m | NOT REGISTERED | wall-only midpoint occlusion</text></svg>`);
  const path=`${out}/${area}-${id}${fixedHeight?'-fixed-height':''}-${name}.png`;await sharp(background).composite([{input:svg}]).png().toFile(path);result.overlays.push({name,path,lines:lines.length});
 }
 geometry.dispose();
}
await writeFile(`${out}/${area}-${id}${fixedHeight?'-fixed-height':''}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
