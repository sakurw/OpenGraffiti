import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';

// Mild photographic albedo harmonization over the ORIGINAL PLATEAU GLB.
// Preserve source triangles/UV/images. Geographic image candidates lack camera
// registration, so the correction strength is deliberately bounded and its
// evidence is recorded as estimated, never observed.
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit])
 .registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const outputRoot='public/assets/universal-all-areas';
const originalRoot='public/assets/datasets/plateau-2025-v4/models';
const geometryRoots={tocho:'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json',
 'tokyo-tower':'data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json'};
const GRID=36,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sha256=buf=>createHash('sha256').update(buf).digest('hex');
const key=(x,z)=>`${Math.floor(x/GRID)}:${Math.floor(z/GRID)}`;
const report={method:'original-PLATEAU-UV-preserving-ground-photo-estimate-v1',generatedAt:new Date().toISOString(),areas:[],limitations:[
 'Mapillary images are selected from geographic position/heading, without verified building silhouettes or camera-to-surface registration.',
 'Color is a weak wall tint estimate, not a transfer of photographed windows or wall details.',
 'Original PLATEAU geometry, UV and images are retained; unverified colors are multiplied at low strength.'
]};
for(const area of ['tocho','tokyo-tower']){
 const geometry=JSON.parse(await readFile(geometryRoots[area],'utf8'));
 const evidence=JSON.parse(await readFile(`${outputRoot}/${area}-building-evidence.json`,'utf8'));
 const evidenceById=new Map(evidence.buildings.map(b=>[b.buildingId,b]));
 const buckets=new Map();let selectedBuildings=0;
 for(const building of geometry.buildings){
  const entry=evidenceById.get(building.id),rgb=entry?.groundPhotoEstimate?.rgb;
  if(!rgb||rgb.length!==3)continue;
  selectedBuildings++;
  const row={id:building.id,min:building.min,max:building.max,rgb,volume:(building.max[0]-building.min[0])*(building.max[2]-building.min[2])};
  for(let x=Math.floor((building.min[0]-.3)/GRID);x<=Math.floor((building.max[0]+.3)/GRID);x++)
   for(let z=Math.floor((building.min[2]-.3)/GRID);z<=Math.floor((building.max[2]+.3)/GRID);z++){
    const bucket=`${x}:${z}`;
    if(!buckets.has(bucket))buckets.set(bucket,[]);
    buckets.get(bucket).push(row);
   }
 }
 const source=await readFile(`${originalRoot}/${area}.glb`),document=await io.readBinary(source);
 const buffer=document.getRoot().listBuffers()[0]??document.createBuffer();
 let vertices=0,wallMatched=0,altered=0,primitives=0;
 const signatures=[];
 for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
  const p=primitive.getAttribute('POSITION'),n=primitive.getAttribute('NORMAL'),uv=primitive.getAttribute('TEXCOORD_0');
  if(!p||!n||!uv)continue;
  const positions=p.getArray(),normals=n.getArray(),size=positions.length/3;
  signatures.push({pos:sha256(Buffer.from(positions.buffer,positions.byteOffset,positions.byteLength)),
   normal:sha256(Buffer.from(normals.buffer,normals.byteOffset,normals.byteLength)),
   uv:sha256(Buffer.from(uv.getArray().buffer,uv.getArray().byteOffset,uv.getArray().byteLength)),
   indices:primitive.getIndices()?sha256(Buffer.from(primitive.getIndices().getArray().buffer,primitive.getIndices().getArray().byteOffset,primitive.getIndices().getArray().byteLength)):null});
  const old=primitive.getAttribute('COLOR_0')?.getArray(),colors=new Float32Array(size*3);
  const strength=primitive.getMaterial()?.getBaseColorTexture()?0.23:0.48;
  for(let i=0;i<size;i++){
   const offset=i*3,x=positions[offset],y=positions[offset+1],z=positions[offset+2];vertices++;
   const original=old?[old[offset],old[offset+1],old[offset+2]]:[1,1,1];
   let multiplier=[1,1,1];
   if(Math.abs(normals[offset+1])<.50){
    const matches=(buckets.get(key(x,z))??[]).filter(b=>x>=b.min[0]-.20&&x<=b.max[0]+.20&&y>=b.min[1]-.20&&y<=b.max[1]+.20&&z>=b.min[2]-.20&&z<=b.max[2]+.20);
    if(matches.length){
     // Prefer the spatially most specific bounding box when buildings overlap.
     matches.sort((a,b)=>a.volume-b.volume);
     const rgb=matches[0].rgb;wallMatched++;
     multiplier=rgb.map(c=>clamp(1+strength*((c-.52)/.52),1-strength,1+strength));
     if(multiplier.some(c=>Math.abs(c-1)>.008))altered++;
    }
   }
   for(let k=0;k<3;k++)colors[offset+k]=clamp(original[k]*multiplier[k],0,1);
  }
  primitive.setAttribute('COLOR_0',document.createAccessor(`${mesh.getName()}-color`).setType('VEC3').setArray(colors).setBuffer(buffer));
  primitives++;
 }
 let checkIndex=0;
 for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
  const p=primitive.getAttribute('POSITION'),n=primitive.getAttribute('NORMAL'),uv=primitive.getAttribute('TEXCOORD_0');
  if(!p||!n||!uv)continue;
  const original=signatures[checkIndex++];
  for(const [name,attribute] of [['pos',p],['normal',n],['uv',uv]]){
   const a=attribute.getArray();if(sha256(Buffer.from(a.buffer,a.byteOffset,a.byteLength))!==original[name])throw Error(`${area} ${name} geometry/UV modified`);
  }
  if(primitive.getIndices()){
   const a=primitive.getIndices().getArray();if(sha256(Buffer.from(a.buffer,a.byteOffset,a.byteLength))!==original.indices)throw Error(`${area} indices modified`);
  }
 }
 const target=`${outputRoot}/${area}-photo-fused.glb`;
 const bytes=await io.writeBinary(document);
 await writeFile(target,bytes);
 const row={area,buildingCount:geometry.buildings.length,buildingsWithEligiblePhotoAlbedo:selectedBuildings,meshPrimitives:primitives,vertices,wallMatched,altered,geometryUVIdentical:true,sourceSha256:sha256(source),resultSha256:sha256(bytes),bytes:bytes.length,model:`/assets/universal-all-areas/${area}-photo-fused.glb`};
 report.areas.push(row);console.log(JSON.stringify(row));
}
await writeFile(`${outputRoot}/photo-fusion-report.json`,JSON.stringify(report,null,2));
