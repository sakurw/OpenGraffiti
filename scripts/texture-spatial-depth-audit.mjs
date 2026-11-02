import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
import {Vector3} from 'three';
import {cameraFor} from './texture-camera.mjs';
import {decodeSpatialMesh,spatialDepthSampler} from './texture-spatial-depth.mjs';
const id='234724268410125',buildingId='bldg_9f293263-46b9-454d-ab46-c84982f22398';
const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8')),b=catalog.buildings.find(b=>b.id===buildingId);
const report=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${b.areaId}.json`,'utf8')),source=report.sources.find(s=>s.id===id);
const photo=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${id}.json`,'utf8')),spatial=JSON.parse(await readFile(`data/texture-city/spatial/${id}.json`,'utf8'));
const mesh=decodeSpatialMesh(await readFile(`data/texture-city/spatial/${id}.mesh.bin`)),depth=spatialDepthSampler(mesh,spatial.atomicScale);
const camera={...cameraFor(photo,[0,0,0],source.height.height),position:source.cameraPosition};
const glb=await new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]).read('public'+report.model),samples=[];
for(const m of glb.getRoot().listMeshes())for(const p of m.listPrimitives()){
 if(p.getMaterial()?.getBaseColorTexture()?.getName()!==id)continue;
 const pos=p.getAttribute('POSITION').getArray();
 for(let i=0;i<pos.length;i+=9){const center=[0,1,2].map(k=>(pos[i+k]+pos[i+3+k]+pos[i+6+k])/3);
  if(center.some((v,k)=>v<b.min[k]-.1||v>b.max[k]+.1))continue;
  const [x,y,z]=center.map((v,k)=>v-camera.position[k]),v=new Vector3(x,-z,y).applyMatrix4(camera.rotation),measured=depth.sample(v.toArray());
  samples.push({targetDistance:v.length(),sfmDepth:measured,ratio:measured?v.length()/measured:null});
 }
}
const known=samples.filter(s=>s.sfmDepth!==null),ratios=known.map(s=>s.ratio).sort((a,b)=>a-b);
const result={id,buildingId,meshVertices:mesh.vertices.length/3,meshTriangles:mesh.faces.length/3,supportedTriangles:depth.triangles,selectedModelTriangles:samples.length,depthSupported:known.length,medianTargetToDepthRatio:ratios[Math.floor(ratios.length/2)],behindByOverTwice:known.filter(s=>s.ratio>2).length,samples,note:'Probe on triangle centroids inside the target bounding box; sparse SfM depth is not ground truth and no model was changed.'};
await writeFile('data/texture-city/spatial/depth-audit.json',JSON.stringify(result,null,2));console.log({...result,samples:samples.slice(0,5)});
