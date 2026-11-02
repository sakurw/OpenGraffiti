import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BufferGeometry,Float32BufferAttribute,Ray,Vector3,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {xml,descendants,polygon,triangulate} from './plateau-geometry.mjs';

export async function roadSurfaceHeight(area,origin){
 const tile=area.id==='tocho'?'53394525':'53393599';
 const source=await readFile(`data/plateau/${area.dataset}/udx/tran/${tile}_tran_6697_op.gml`);
 const key=createHash('sha256').update(source).update(JSON.stringify(origin)).digest('hex');
 const base=`data/texture-city/roads/${area.id}-${key}`;await mkdir('data/texture-city/roads',{recursive:true});
 let bytes;
 try{bytes=await readFile(base+'.bin');}catch(e){
  if(e.code!=='ENOENT')throw e;
  const points=[];
  for(const m of source.toString('utf8').matchAll(/<tran:Road\b[^>]*>[\s\S]*?<\/tran:Road>/g)){
   const road=xml(m[0]);
   for(const scope of descendants(road,'tran:lod3MultiSurface'))for(const node of descendants(scope,'gml:Polygon')){
    const p=polygon(node,origin);if(!p)continue;const t=triangulate(p.rings.map(r=>r.points));
    if(Math.abs(t.normal[1])<.7)continue;
    for(const i of t.indices)points.push(...t.points[i]);
   }
  }
  bytes=Buffer.from(new Float32Array(points).buffer);await writeFile(base+'.bin',bytes);
 }
 if(!bytes.length)return {sample:()=>null,dispose:()=>{},triangles:0};
 return heightSampler(new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
}
export function heightSampler(positions){
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geometry);
 const ray=new Ray(new Vector3(),new Vector3(0,-1,0));
 return {triangles:positions.length/9,dispose:()=>geometry.dispose(),sample:(point)=>{
  ray.origin.set(point[0],1000,point[2]);const hits=bvh.raycast(ray,DoubleSide);
  if(!hits.length)return null;
  const heights=hits.map(h=>1000-h.distance);
  if(Math.max(...heights)-Math.min(...heights)>2)return {ambiguous:true,method:'multiple-road-levels'};
  return {height:Math.max(...heights)+1.65,distance:0,method:'LOD3-road-at-camera-XY-plus-1.65m-estimate'};
 }};
}
