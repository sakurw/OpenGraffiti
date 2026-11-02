// Texture transport only. Draco is decoded for sampling, never re-encoded.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import proj4 from 'proj4';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {BufferGeometry,Float32BufferAttribute,Vector3,Triangle,Matrix4} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const base='public/assets/plateau-official-shinjuku-2025',out=base+'/styled';
const profiles=JSON.parse(await fs.readFile('public/assets/tocho-district-photo-v3-20261018/photo-profiles.json','utf8'));
const scope=JSON.parse(await fs.readFile(profiles.scopePath,'utf8'));
const wanted=new Set(profiles.selectedBuildingIds),central=scope.centralBuildingId;
assert.equal(wanted.size,83);
const folder=(await fs.readdir(base+'/model')).find(x=>x.endsWith('_bldg_3dtiles_13104_shinjuku-ku_lod2'));
assert(folder);const root=base+'/model/'+folder;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
await fs.mkdir(out+'/textures',{recursive:true});await fs.mkdir(out+'/data',{recursive:true});
const sandbox={module:{exports:{}},exports:{},require:createRequire(import.meta.url),__dirname:process.cwd(),console};
vm.runInNewContext(await fs.readFile('node_modules/three/examples/jsm/libs/draco/draco_decoder.js','utf8'),sandbox);
const draco=await sandbox.module.exports({});
function parse(b){
 assert.equal(b.toString('ascii',0,4),'b3dm');
 const lengths=[12,16,20,24].map(o=>b.readUInt32LE(o)),start=28+lengths.reduce((a,b)=>a+b,0);
 const batch=JSON.parse(b.subarray(28+lengths[0]+lengths[1],28+lengths[0]+lengths[1]+lengths[2]).toString().trim());
 assert.equal(b.toString('ascii',start,start+4),'glTF');
 const size=b.readUInt32LE(start+12),json=JSON.parse(b.subarray(start+20,start+20+size).toString());
 const binStart=start+20+size+8,bin=b.subarray(binStart,start+b.readUInt32LE(start+8));
 return {b,start,batch,json,bin};
}
function decode(g,p,bin){
 const ext=p.extensions?.KHR_draco_mesh_compression;assert(ext,'Expected native Draco');
 const view=g.bufferViews[ext.bufferView],bytes=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
 const decoder=new draco.Decoder(),buffer=new draco.DecoderBuffer(),mesh=new draco.Mesh();buffer.Init(new Int8Array(bytes),bytes.length);
 const status=decoder.DecodeBufferToMesh(buffer,mesh);assert(status.ok(),status.error_msg());
 const attrs={};
 for(const [name,id] of Object.entries(ext.attributes)){
  const attr=decoder.GetAttributeByUniqueId(mesh,id),array=new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh,attr,array);const a=new Float32Array(array.size());for(let i=0;i<a.length;i++)a[i]=array.GetValue(i);
  attrs[name]={array:a,size:attr.num_components()};draco.destroy(array);
 }
 const faces=new draco.DracoInt32Array(),indices=new Uint32Array(mesh.num_faces()*3);
 for(let i=0;i<mesh.num_faces();i++){decoder.GetFaceFromMesh(mesh,i,faces);for(let k=0;k<3;k++)indices[i*3+k]=faces.GetValue(k);}
 draco.destroy(faces);draco.destroy(mesh);draco.destroy(buffer);draco.destroy(decoder);return {attrs,indices};
}

// These are texture donors, never geometry outputs. Their established per-face
// artwork placement and equipment/roof exclusions are sampled onto native UVs.
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),donors=new Map(),textureCache=new Map();
async function texture(t){
 if(!t)return null;if(!textureCache.has(t))textureCache.set(t,await sharp(t.getImage()).ensureAlpha().raw().toBuffer({resolveWithObject:true}));return textureCache.get(t);
}
async function addDonors(file,fixedId){
 const doc=await io.read(file);
 for(const node of doc.getRoot().listNodes()){
  const id=fixedId??node.getExtras().buildingId;if(!wanted.has(id)||!node.getMesh())continue;
  let rec=donors.get(id);if(!rec){rec={positions:[],faces:[],minY:Infinity,maxY:-Infinity};donors.set(id,rec);}
  const matrix=new Matrix4().fromArray(node.getWorldMatrix());
  for(const p of node.getMesh().listPrimitives()){
   const pos=p.getAttribute('POSITION'),uv=p.getAttribute('TEXCOORD_0'),idx=p.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i),mat=p.getMaterial();
   const image=await texture(mat?.getBaseColorTexture()),factor=mat?.getBaseColorFactor()??[1,1,1,1],info=mat?.getBaseColorTextureInfo();
   const role=mat?.getExtras().surfaceRole??node.getExtras().surfaceRole??'unknown';
   if(role==='equipment')assert.equal(mat?.getExtras().windowAllowed,false,'Equipment donor must be window-free');
   for(let i=0;i<idx.length;i+=3){
    const points=[0,1,2].map(k=>new Vector3().fromArray(pos.getArray(),idx[i+k]*3).applyMatrix4(matrix));
    const n=new Triangle(...points).getNormal(new Vector3());if(n.lengthSq()<.5)continue;
    const uvs=uv?[0,1,2].map(k=>Array.from(uv.getArray().slice(idx[i+k]*2,idx[i+k]*2+2))):null;
    rec.positions.push(...points.flatMap(v=>v.toArray()));rec.faces.push({points,uvs,image,factor,n,role,wrapS:info?.getWrapS(),wrapT:info?.getWrapT()});
    for(const q of points){rec.minY=Math.min(rec.minY,q.y);rec.maxY=Math.max(rec.maxY,q.y);}
   }
  }
 }
}
await addDonors('public/assets/tocho-district-photo-v3-20261018/district.glb');
await addDonors(profiles.centralAsset.path,central);
assert.equal(donors.size,83);
for(const d of donors.values()){
 const geo=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(d.positions,3));
 d.bvh=new MeshBVH(geo,{indirect:true});delete d.positions;
}
const projected='+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
const convert=proj4('+proj=geocent +ellps=GRS80 +units=m +no_defs',projected);
function local(a,rtc){const v=convert.forward([rtc[0]+a[0],rtc[1]-a[2],rtc[2]+a[1]]);return new Vector3(v[0]-scope.origin[0],v[2],-(v[1]-scope.origin[1]));}
function raster(uv,W,H,visit){
 const [a,b,c]=uv.map(q=>[q[0]*W-.5,q[1]*H-.5]);
 const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)return;
 const x0=Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0]))),x1=Math.min(W-1,Math.floor(Math.max(a[0],b[0],c[0])));
 const y0=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1]))),y1=Math.min(H-1,Math.floor(Math.max(a[1],b[1],c[1])));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
  if(Math.min(u,v,w)>=-1e-7)visit(y*W+x,u,v,w);
 }
}
function imageIndex(g,p){const t=g.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture;if(!t)return null;const tex=g.textures[t.index];assert(!t.extensions?.KHR_texture_transform,'Texture transform needs explicit handling');return tex.extensions?.EXT_texture_webp?.source??tex.source;}
function patchedTile(tile,replacements){
 const g=structuredClone(tile.json),chunks=[tile.bin];let offset=tile.bin.length;
 for(const [i,bytes]of replacements){const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
  const view=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});g.images[i]={...g.images[i],bufferView:view};chunks.push(bytes);offset+=bytes.length;}
 g.buffers[0].byteLength=offset;let bin=Buffer.concat(chunks);bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
 let json=Buffer.from(JSON.stringify(g));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
 const glb=Buffer.alloc(12+8+json.length+8+bin.length);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(json.length,12);glb.writeUInt32LE(0x4e4f534a,16);json.copy(glb,20);
 const o=20+json.length;glb.writeUInt32LE(bin.length,o);glb.writeUInt32LE(0x004e4942,o+4);bin.copy(glb,o+8);
 let result=Buffer.concat([tile.b.subarray(0,tile.start),glb]);result.writeUInt32LE(result.length,8);
 const check=parse(result);
 for(const key of ['meshes','accessors','nodes','scenes','materials','textures','samplers','extensions'])assert.deepEqual(check.json[key],tile.json[key],key+' changed');
 assert(check.bin.subarray(0,tile.bin.length).equals(tile.bin),'Original BIN bytes changed');
 assert(result.subarray(12,tile.start).equals(tile.b.subarray(12,tile.start)),'Batch tables changed');return result;
}
let manifest={schemaVersion:1,createdAt:new Date().toISOString(),mode:'native-uv-image-only',tiles:{},buildingIds:[...wanted],geometryModified:false,originalCompressedGeometryPreserved:true,
 textureDonors:['/assets/tocho-district-photo-v3-20261018/district.glb',profiles.centralAsset.path.replace(/^public/,'')],
 notes:['Existing artwork appearance transferred by nearest matching surface into native UV atlas. No donor geometry is emitted.','Outside selected UV coverage decoded pixels are unchanged. Roof/equipment appearance comes from own dedicated donor surfaces.','Unmatched texels retain original appearance; donor matching tolerance 0.35m and normal cosine 0.95.'],buildings:{}};
if(process.argv.includes('--resume')){
 manifest=JSON.parse(await fs.readFile(out+'/texture-overrides.json','utf8'));
 assert.deepEqual(manifest.buildingIds,[...wanted]);delete manifest.completedAt;delete manifest.summary;
}
const selectedFiles=[];
for(const file of (await fs.readdir(root+'/data')).filter(x=>x.endsWith('.b3dm')).sort()){
 const tile=parse(await fs.readFile(root+'/data/'+file));if(tile.batch.gml_id.some(x=>wanted.has(x)))selectedFiles.push({file,tile});
}
console.log(JSON.stringify({stage:'ready',tiles:selectedFiles.length,donors:donors.size}));
for(const {file,tile}of selectedFiles){
 if(manifest.tiles[file]){
  assert.equal(hash(tile.b),manifest.tiles[file].sourceSha256,'Resume source changed');
  assert.equal(hash(await fs.readFile(out+'/data/'+file)),manifest.tiles[file].styledSha256,'Resume output changed');
  console.log(JSON.stringify({stage:'resume-preserved',file}));continue;
 }
 const g=tile.json,rtc=g.extensions.CESIUM_RTC.center,triangles=[],minHeights=new Map();
 for(const mesh of g.meshes)for(const p of mesh.primitives){
  const d=decode(g,p,tile.bin),image=imageIndex(g,p),{array:pos,size:stride}=d.attrs.POSITION,batch=d.attrs._BATCHID.array,uv=d.attrs.TEXCOORD_0?.array;
  const points=Array.from({length:pos.length/stride},(_,i)=>local(pos.subarray(i*stride,i*stride+3),rtc));
  for(let i=0;i<points.length;i++){const id=tile.batch.gml_id[Math.round(batch[i])];if(wanted.has(id))minHeights.set(id,Math.min(minHeights.get(id)??Infinity,points[i].y));}
  if(!uv||image===null)continue;
  for(let k=0;k<d.indices.length;k+=3){const ix=Array.from(d.indices.subarray(k,k+3)),b=ix.map(i=>Math.round(batch[i]));assert(b.every(x=>x===b[0]),'Mixed-building triangle');
   const id=tile.batch.gml_id[b[0]];triangles.push({id,image,points:ix.map(i=>points[i].clone()),uv:ix.map(i=>[uv[i*2],uv[i*2+1]])});}
 }
 // Each B3DM RTC has ellipsoidal altitude; donors use orthometric altitude.
 // Determine one tile-wide offset from complete low-rise features. Partial LOD
 // building fragments must not each be independently snapped to ground.
 const shifts=[...minHeights].map(([id,y])=>y-donors.get(id).minY).sort((a,b)=>a-b);
 const known=Object.values(manifest.tiles).map(t=>t.verticalDatumOffsetMeters).sort((a,b)=>a-b);
 const anchor=known.length?known[Math.floor((known.length-1)/2)]:null;
 // Some parent tiles contain only upper building fragments, so their lowest
 // vertex cannot establish the datum. Reuse offsets from complete features.
 const validShifts=shifts.filter(s=>s>20&&s<60&&(anchor===null||Math.abs(s-anchor)<.25));
 const verticalShift=validShifts.length?validShifts[Math.floor((validShifts.length-1)/2)]:anchor;
 assert(Number.isFinite(verticalShift),'No complete feature available to establish vertical datum');
 assert(verticalShift>20&&verticalShift<60,'Unexpected ellipsoid/orthometric offset '+verticalShift);
 for(const t of triangles)for(const p of t.points)p.y-=verticalShift;
 const replacements=[],records=[],buildingPixels=new Map();
 for(let image=0;image<g.images.length;image++){
  const targets=triangles.filter(t=>t.image===image&&wanted.has(t.id));if(!targets.length)continue;
  const iv=g.bufferViews[g.images[image].bufferView],original=await sharp(tile.bin.subarray(iv.byteOffset??0,(iv.byteOffset??0)+iv.byteLength)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width:W,height:H}=original.info,pixels=Buffer.from(original.data),owners=new Int16Array(W*H);owners.fill(-1);
  const localIds=[...new Set(targets.map(t=>t.id))],ids=new Map(localIds.map((x,i)=>[x,i]));
  // Protect all nonselected UV coverage, even when an atlas reuses texels.
  for(const t of triangles.filter(t=>t.image===image))raster(t.uv,W,H,(i)=>{const owner=ids.get(t.id)??-2;if(owners[i]===-1)owners[i]=owner;else if(owners[i]!==owner)owners[i]=-2;});
  const point=new Vector3(),closest={},bary=new Vector3();let sampled=0,unmatched=0;
  for(const t of targets){
   const donor=donors.get(t.id),normal=new Triangle(...t.points).getNormal(new Vector3()),owner=ids.get(t.id);
   raster(t.uv,W,H,(i,a,b,c)=>{
    if(owners[i]!==owner)return;
    point.set(0,0,0).addScaledVector(t.points[0],a).addScaledVector(t.points[1],b).addScaledVector(t.points[2],c);
    const hit=donor.bvh.closestPointToPoint(point,closest,0,.35);if(!hit){unmatched++;return;}
    const face=donor.faces[hit.faceIndex];if(Math.abs(face.n.dot(normal))<.95){unmatched++;return;}
    Triangle.getBarycoord(hit.point,...face.points,bary);if(!Number.isFinite(bary.x))return;
    const offset=i*4;
    if(face.image&&face.uvs){
     let u=bary.x*face.uvs[0][0]+bary.y*face.uvs[1][0]+bary.z*face.uvs[2][0],v=bary.x*face.uvs[0][1]+bary.y*face.uvs[1][1]+bary.z*face.uvs[2][1];
     const wrap=(x,mode)=>mode===10497?((x%1)+1)%1:mode===33648?1-Math.abs(((x%2)+2)%2-1):Math.max(0,Math.min(1,x));
     u=wrap(u,face.wrapS);v=wrap(v,face.wrapT);const im=face.image,x=Math.min(im.info.width-1,Math.floor(u*im.info.width)),y=Math.min(im.info.height-1,Math.floor(v*im.info.height)),j=(y*im.info.width+x)*4;
     for(let k=0;k<3;k++)pixels[offset+k]=Math.round(im.data[j+k]*face.factor[k]);
    }else for(let k=0;k<3;k++)pixels[offset+k]=Math.round(face.factor[k]*255);
    sampled++;buildingPixels.set(t.id,(buildingPixels.get(t.id)??0)+1);
   });
  }
  const encoded=await sharp(pixels,{raw:{width:W,height:H,channels:4}}).webp({lossless:true,effort:2}).toBuffer();
  const decoded=await sharp(encoded).ensureAlpha().raw().toBuffer();assert(decoded.equals(pixels),'Lossless encoding altered pixels');
  let changed=0,protectedPixels=0;for(let i=0;i<owners.length;i++){
   const j=i*4,diff=!pixels.subarray(j,j+4).equals(original.data.subarray(j,j+4));
   if(owners[i]<0){protectedPixels++;assert(!diff,'Non-target texel modified');}if(diff)changed++;
  }
  const name=file.replace('.b3dm','')+'-image'+image+'.webp';await fs.writeFile(out+'/textures/'+name,encoded);
  replacements.push([image,encoded]);records.push({imageIndex:image,url:'/assets/plateau-official-shinjuku-2025/styled/textures/'+name,width:W,height:H,sha256:hash(encoded),sampledTexels:sampled,unmatchedSamples:unmatched,changedTexels:changed,protectedPixelsUnchanged:protectedPixels});
 }
 if(replacements.length){const styled=patchedTile(tile,replacements);await fs.writeFile(out+'/data/'+file,styled);
  manifest.tiles[file]={images:records,b3dmUrl:'/assets/plateau-official-shinjuku-2025/styled/data/'+file,sourceSha256:hash(tile.b),styledSha256:hash(styled),verticalDatumOffsetMeters:verticalShift,buildingIds:[...buildingPixels.keys()]};}
 for(const [id,count]of buildingPixels){const b=manifest.buildings[id]??={sampledTexels:0,tiles:[]};b.sampledTexels+=count;b.tiles.push(file);}
 await fs.writeFile(out+'/texture-overrides.json',JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({stage:'patched',file,images:records.map(r=>({imageIndex:r.imageIndex,changed:r.changedTexels,unmatched:r.unmatchedSamples})),buildings:buildingPixels.size,verticalShift}));
}
const tileset=JSON.parse(await fs.readFile(root+'/tileset.json','utf8'));
function remap(t){if(t.content){const key=t.content.uri?'uri':'url',uri=t.content[key],name=path.basename(uri);t.content[key]=manifest.tiles[name]?.b3dmUrl??'/assets/plateau-official-shinjuku-2025/model/'+folder+'/'+uri;}for(const child of t.children??[])remap(child);}
remap(tileset.root);await fs.writeFile(out+'/tileset.json',JSON.stringify(tileset));
assert.equal(Object.keys(manifest.buildings).length,wanted.size,'Some selected buildings received no artwork');
manifest.completedAt=new Date().toISOString();manifest.summary={tiles:Object.keys(manifest.tiles).length,buildingsWithSampledArtwork:Object.keys(manifest.buildings).length,missingBuildingIds:[...wanted].filter(id=>!manifest.buildings[id]),changedTexels:Object.values(manifest.tiles).flatMap(t=>t.images).reduce((s,i)=>s+i.changedTexels,0),nativeGeometryBuffersUnchanged:true,nonTargetDecodedPixelsUnchanged:true};
await fs.writeFile(out+'/texture-overrides.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest.summary));
