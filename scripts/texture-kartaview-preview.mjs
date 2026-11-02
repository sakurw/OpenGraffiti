// Diagnostic overlay only. Hypotheses here never become registered camera records.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import proj4 from 'proj4';
import {BufferGeometry,Float32BufferAttribute,Ray,Vector3,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {CRS,GEO,triangulate,sub,dot} from './plateau-geometry.mjs';
import {roadSurfaceHeight} from './texture-road-surface.mjs';
import {roadHeight} from './texture-camera.mjs';
const id=process.argv[2];if(!/^\d+$/.test(id||''))throw Error('Specify KartaView photo ID');
const p=JSON.parse(await readFile(`data/texture-city/photos/kartaview/${id}.json`,'utf8'));
const bytes=await readFile(`data/texture-city/photos/kartaview/${id}.jpg`);
if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('Photo hash mismatch');
const headings=JSON.parse(await readFile('data/texture-city/kartaview/heading-audit.json','utf8'));
const motion=headings.results.find(r=>r.id===id);if(motion?.status!=='straight-motion-prior-unverified')throw Error('No locally straight trajectory prior');
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
const a=catalog.areas.find(a=>p.areaIds.includes(a.id));if(!a)throw Error('No target city');
const g=JSON.parse(await readFile(`data/plateau/${a.dataset}/${a.id==='tocho'?'53394525':'53393599'}-geometry.json`,'utf8'));
const [east,north]=proj4(GEO,CRS,[Number(p.lng),Number(p.lat)]),position=[east-g.origin[0],0,-(north-g.origin[1])];
const surface=await roadSurfaceHeight(a,g.origin),exact=surface.sample(position);surface.dispose();
if(exact?.ambiguous)throw Error('Ambiguous road level; no guessed preview height');
const height=exact||roadHeight(position,catalog.sections.filter(s=>s.areaId===a.id));
if(!height)throw Error('No road height for this preview');position[1]=height.height-g.origin[2];
const positions=[];for(const b of g.buildings)for(const polygon of b.polygons){const t=triangulate(polygon.rings.map(r=>r.points));for(const i of t.indices)positions.push(...t.points[i]);}
const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geometry);
const origin=new Vector3(...position),ray=new Ray(origin),direction=new Vector3();
function visible(point){direction.set(...point).sub(origin);const len=direction.length();ray.direction.copy(direction).normalize();return !bvh.raycastFirst(ray,DoubleSide,.05,len-.08);}
const scale=960/p.downloadSize[0],width=960,h=Math.round(p.downloadSize[1]*scale);
const image=await sharp(bytes).resize(width,h).png().toBuffer();
const hfov=Number(p.sequenceMetadata.cameraParameters.hFoV),f=width/(2*Math.tan(hfov*Math.PI/360));
if(!(hfov>0&&hfov<180))throw Error('No horizontal FoV hypothesis');
const root='data/texture-city/kartaview/previews';await mkdir(root,{recursive:true});const variants=[];
const inputs=[{name:'api',heading:Number(p.heading),position},{name:'motion',heading:motion.heading,position}];
const sfmOption=process.argv[3];
if(sfmOption){
 if(!sfmOption.startsWith('--sfm='))throw Error('Unknown preview option');
 const sfmPath=sfmOption.slice(6),sfmBytes=await readFile(sfmPath),sfm=JSON.parse(sfmBytes),camera=sfm.images.find(i=>i.id===id);
 if(!camera||camera.sourceSha256!==p.sha256)throw Error('SfM source identity mismatch');
 const intrinsics=sfm.cameras.find(c=>c.id===camera.cameraId);
 if(intrinsics?.model!=='SIMPLE_RADIAL'||intrinsics.width!==p.downloadSize[0]||intrinsics.height!==p.downloadSize[1])throw Error('Unsupported SfM intrinsics');
 if(camera.position.length!==3||!camera.position.every(Number.isFinite)||camera.camFromWorld.length!==3||camera.camFromWorld.some(r=>r.length!==4||!r.every(Number.isFinite)))throw Error('Invalid SfM pose');
 const [focal,cx,cy,k]=intrinsics.params;if(!(focal>0)||![cx,cy,k].every(Number.isFinite))throw Error('Invalid SfM parameters');
 const project=point=>{
  const xyz=camera.camFromWorld.map(r=>dot(r.slice(0,3),point)+r[3]);if(xyz[2]<=.1)return null;
  const x=xyz[0]/xyz[2],y=xyz[1]/xyz[2],radial=1+k*(x*x+y*y);
  return [(cx+focal*x*radial)*scale,(cy+focal*y*radial)*scale];
 };
 inputs.push({name:'sfm',heading:null,position:camera.position,project,source:sfmPath,sourceSha256:createHash('sha256').update(sfmBytes).digest('hex')});
}
for(const input of inputs){
 const {name,heading,position:previewPosition}=input;origin.set(...previewPosition);
 const yaw=heading*Math.PI/180,right=[Math.cos(yaw),0,Math.sin(yaw)],forward=[Math.sin(yaw),0,-Math.cos(yaw)];
 const project=input.project||(point=>{const d=sub(point,previewPosition),z=dot(d,forward);return z>.1?[width/2+f*dot(d,right)/z,h/2-f*d[1]/z]:null;});
 const lines=[],buildingIds=new Set();
 for(const b of g.buildings){
  const center=b.min.map((v,i)=>(v+b.max[i])/2);if(Math.hypot(center[0]-previewPosition[0],center[2]-previewPosition[2])>180)continue;
  for(const wall of b.walls){
   const t=triangulate(wall.rings.map(r=>r.points));if(!t.points.length||dot(t.normal,sub(previewPosition,t.points[0]))<=0)continue;
   for(const ring of wall.rings)for(let i=0;i<ring.points.length;i++){
    const first=ring.points[i],second=ring.points[(i+1)%ring.points.length],uv=[project(first),project(second)];
    if(uv.some(v=>!v||v.some(x=>!Number.isFinite(x))))continue;
    if(Math.min(...uv.map(v=>v[0]))>width||Math.max(...uv.map(v=>v[0]))<0||Math.min(...uv.map(v=>v[1]))>h||Math.max(...uv.map(v=>v[1]))<0)continue;
    const mid=first.map((v,k)=>(v+second[k])/2);if(!visible(mid))continue;
    lines.push(`<line x1="${uv[0][0].toFixed(2)}" y1="${uv[0][1].toFixed(2)}" x2="${uv[1][0].toFixed(2)}" y2="${uv[1][1].toFixed(2)}"/>`);buildingIds.add(b.id);
   }
  }
 }
 const label=name==='sfm'?'SfM intrinsics and GPS-aligned pose hypothesis':`${name} heading ${heading.toFixed(2)} deg | square-pixel horizontal-FoV hypothesis`;
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}"><g stroke="#00ffff" stroke-width="1.1" opacity=".85">${lines.join('')}</g><rect width="${width}" height="27" fill="#111"/><text x="8" y="19" fill="white" font-family="sans-serif" font-size="15">${label} | NOT REGISTERED</text></svg>`);
 const path=`${root}/${id}-${name}.png`;await sharp(image).composite([{input:svg}]).png().toFile(path);
 variants.push({name,heading,position:previewPosition,source:input.source,sourceSha256:input.sourceSha256,visibleWallEdges:lines.length,buildingIds:[...buildingIds],path});
}
geometry.dispose();const report={id,sourceSha256:p.sha256,area:a.id,position,height,horizontalFoV:hfov,focalPixels:f,previewSize:[width,h],variants,
 applied:false,note:'API/motion variants use GPS plus road height, zero pitch/roll and a horizontal-FoV hypothesis. Optional SfM uses its separately estimated intrinsics and GPS-aligned pose. Overlay lines are PLATEAU wall geometry, NOT feature matches or registration evidence.'};
await writeFile(`${root}/${id}.json`,JSON.stringify(report,null,2));console.log({...report,variants:variants.map(v=>({...v,buildingIds:v.buildingIds.length}))});
