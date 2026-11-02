// Own-only texture atlases. Native images supply dimensions only, never pixels.
// Donor projection and roof/equipment handling match the official patch generator.
import fs from 'node:fs/promises';
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

const base='public/assets/plateau-official-shinjuku-2025',out=base+'/own-only';
if(process.argv.includes('--verify')){await verifySavedAtlases();process.exit(0);}
const profiles=JSON.parse(await fs.readFile('public/assets/tocho-district-photo-v3-20261018/photo-profiles.json','utf8'));
const scope=JSON.parse(await fs.readFile(profiles.scopePath,'utf8'));
const wanted=new Set(profiles.selectedBuildingIds),central=scope.centralBuildingId;
assert.equal(wanted.size,83);
const folder=(await fs.readdir(base+'/model')).find(x=>x.endsWith('_bldg_3dtiles_13104_shinjuku-ku_lod2'));
assert(folder);const root=base+'/model/'+folder;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
await fs.mkdir(out+'/textures',{recursive:true});await fs.mkdir(out+'/masks',{recursive:true});
const neutral=[183,181,172,0],paddingRadius=4;
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
const manifest={schemaVersion:1,createdAt:new Date().toISOString(),mode:'native-uv-image-only',tiles:{},buildingIds:[...wanted],geometryModified:false,originalCompressedGeometryPreserved:true,
 neutralColor:'#b7b5ac',alphaMode:'own-donor-coverage',integration:{removeAllOriginalSourceMapsBeforeLoading:true,alphaZero:'building-specific own procedural fallback',alpha255:'own donor art',photoFlashPrevention:'Caller must clear every original map before asynchronous own-map loads.'},sourcePhotoFallback:false,sourcePhotoPixelsCopied:0,paddingRadius,
 maskLegend:{0:'neutral own color',1:'own donor sample',2:'padding copied from own donor sample'},
 textureDonors:['/assets/tocho-district-photo-v3-20261018/district.glb',profiles.centralAsset.path.replace(/^public/,'')],
 notes:['Texture-only overrides; no B3DM or tileset is emitted. Scope is handled by the caller.',
 'All images in each selected native tile are replaced, including images with no supported donor coverage.',
 'Native image metadata supplies dimensions only; original PLATEAU photo pixels are never decoded or copied.',
 'Unmatched, shared-owner and unsupported building texels are neutral own color, with no source photo fallback.',
 'Roof and equipment samples retain their dedicated donor materials; equipment is window-free.',
 'Primary RGBA image: alpha is 255 exactly on donor hits; every other pixel is neutral RGB and alpha 0.',
 'Optional padded image preserves the same alpha coverage, but extends donor RGB four pixels into unused atlas space for filtering. It never crosses into roofs/equipment or another surface.'],buildings:{}};
const selectedFiles=[];
for(const file of (await fs.readdir(root+'/data')).filter(x=>x.endsWith('.b3dm')).sort()){
 const tile=parse(await fs.readFile(root+'/data/'+file));if(tile.batch.gml_id.some(x=>wanted.has(x)))selectedFiles.push({file,tile});
}
console.log(JSON.stringify({stage:'ready',tiles:selectedFiles.length,donors:donors.size}));
for(const {file,tile}of selectedFiles){
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
 const records=[],buildingPixels=new Map();
 for(let image=0;image<g.images.length;image++){
  const targets=triangles.filter(t=>t.image===image&&wanted.has(t.id));
  const iv=g.bufferViews[g.images[image].bufferView];
  const {width:W,height:H}=await sharp(tile.bin.subarray(iv.byteOffset??0,(iv.byteOffset??0)+iv.byteLength)).metadata();
  assert(W>0&&H>0);
  const pixels=Buffer.alloc(W*H*4),mask=Buffer.alloc(W*H),owners=new Int16Array(W*H);owners.fill(-1);
  for(let i=0;i<W*H;i++)pixels.set(neutral,i*4);
  const localIds=[...new Set(targets.map(t=>t.id))],ids=new Map(localIds.map((x,i)=>[x,i]));
  // Mark shared or unsupported UVs so donor art cannot overwrite other surfaces.
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
    pixels[offset+3]=255;mask[i]=1;
    sampled++;buildingPixels.set(t.id,(buildingPixels.get(t.id)??0)+1);
   });
  }
  // Dilate from a frozen frontier into unused UV space only. Shared texels,
  // roofs/equipment and unmatched triangle interiors keep their own assignment.
  let paddedTexels=0;
  for(let pass=0;pass<paddingRadius;pass++){
   const frontier=[];
   for(let i=0;i<mask.length;i++){
    if(mask[i]||owners[i]!==-1)continue;
    const x=i%W,y=Math.floor(i/W);
    for(const j of [x>0?i-1:-1,x<W-1?i+1:-1,y>0?i-W:-1,y<H-1?i+W:-1]){
     if(j>=0&&mask[j]){frontier.push(i,j);break;}
    }
   }
   for(let k=0;k<frontier.length;k+=2){const i=frontier[k],j=frontier[k+1];pixels.set(pixels.subarray(j*4,j*4+3),i*4);mask[i]=2;paddedTexels++;}
  }
  let donorTexels=0,neutralTexels=0;
  for(let i=0;i<mask.length;i++){
   const j=i*4;
   assert.equal(pixels[j+3],mask[i]===1?255:0,'Alpha must exactly match donor hits');
   if(mask[i]===1)donorTexels++;
   else if(mask[i]===0){neutralTexels++;for(let k=0;k<4;k++)assert.equal(pixels[j+k],neutral[k],'Non-donor pixel is not neutral');}
   else {assert.equal(mask[i],2);assert.equal(owners[i],-1,'Padding crossed into a surface');}
  }
  assert.equal(donorTexels+paddedTexels+neutralTexels,W*H);
  const paddedEncoded=await sharp(pixels,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
  const paddedDecoded=await sharp(paddedEncoded).ensureAlpha().raw().toBuffer();assert(paddedDecoded.equals(pixels),'Padding PNG altered RGBA');
  for(let i=0;i<mask.length;i++)if(mask[i]!==1)pixels.set(neutral,i*4);
  for(let i=0;i<mask.length;i++){
   assert.equal(pixels[i*4+3],mask[i]===1?255:0,'Own alpha coverage mismatch');
   if(mask[i]!==1)for(let k=0;k<4;k++)assert.equal(pixels[i*4+k],neutral[k],'Unsampled primary RGBA is not neutral transparent');
  }
  const encoded=await sharp(pixels,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
  const decoded=await sharp(encoded).ensureAlpha().raw().toBuffer();assert(decoded.equals(pixels),'Lossless encoding altered pixels');
  const maskEncoded=await sharp(mask,{raw:{width:W,height:H,channels:1}}).png().toBuffer();
  const name=file.replace('.b3dm','')+'-image'+image;
  await fs.writeFile(out+'/textures/'+name+'.png',encoded);
  await fs.writeFile(out+'/textures/'+name+'-padded.png',paddedEncoded);
  await fs.writeFile(out+'/masks/'+name+'.png',maskEncoded);
  records.push({imageIndex:image,url:'/assets/plateau-official-shinjuku-2025/own-only/textures/'+name+'.png',width:W,height:H,sha256:hash(encoded),
   paddedUrl:'/assets/plateau-official-shinjuku-2025/own-only/textures/'+name+'-padded.png',paddedSha256:hash(paddedEncoded),ownAlphaCoverageVerified:true,opaqueTexels:donorTexels,transparentTexels:W*H-donorTexels,
   maskUrl:'/assets/plateau-official-shinjuku-2025/own-only/masks/'+name+'.png',maskSha256:hash(maskEncoded),sampledTexels:sampled,donorTexels,paddedTexels,neutralTexels,unmatchedSamples:unmatched,
   sourcePhotoPixelsCopied:0,neutralOutsideDonorAndPaddingVerified:true,losslessRoundtripVerified:true});
 }
 manifest.tiles[file]={images:records,sourceSha256:hash(tile.b),verticalDatumOffsetMeters:verticalShift,buildingIds:[...buildingPixels.keys()]};
 assert.equal(hash(await fs.readFile(root+'/data/'+file)),manifest.tiles[file].sourceSha256,'Source changed');
 for(const [id,count]of buildingPixels){const b=manifest.buildings[id]??={sampledTexels:0,tiles:[]};b.sampledTexels+=count;b.tiles.push(file);}
 await fs.writeFile(out+'/texture-overrides.json',JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({stage:'own-only',file,images:records.map(r=>({imageIndex:r.imageIndex,donor:r.donorTexels,padding:r.paddedTexels,neutral:r.neutralTexels,unmatched:r.unmatchedSamples})),buildings:buildingPixels.size,verticalShift}));
}
assert.equal(Object.keys(manifest.buildings).length,wanted.size,'Some selected buildings received no artwork');
manifest.completedAt=new Date().toISOString();
const images=Object.values(manifest.tiles).flatMap(t=>t.images),sum=key=>images.reduce((s,i)=>s+i[key],0);
manifest.summary={tiles:Object.keys(manifest.tiles).length,images:images.length,buildingsWithSampledArtwork:Object.keys(manifest.buildings).length,missingBuildingIds:[...wanted].filter(id=>!manifest.buildings[id]),
 donorTexels:sum('donorTexels'),paddedTexels:sum('paddedTexels'),neutralTexels:sum('neutralTexels'),sourcePhotoPixelsCopied:0,sourcePhotoFallback:false,ownAlphaCoverageVerified:true,opaqueTexels:sum('opaqueTexels'),transparentTexels:sum('transparentTexels'),
 neutralOutsideDonorAndPaddingVerified:true,losslessRoundtripVerified:true,nativeSourceTilesUnchanged:true,geometryOutputsWritten:false,roofEquipmentDonorHandlingPreserved:true};
await fs.writeFile(out+'/texture-overrides.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest.summary));

// Independent disk readback, runnable without decoding geometry or donor assets.
async function verifySavedAtlases(){
 const manifest=JSON.parse(await fs.readFile(out+'/texture-overrides.json','utf8'));
 assert(manifest.completedAt,'Generation is incomplete');
 assert.equal(manifest.summary.buildingsWithSampledArtwork,83);
 assert.equal(manifest.sourcePhotoFallback,false);
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 const results=[];
 for(const [file,tile]of Object.entries(manifest.tiles))for(const image of tile.images){
  const read=async(url,expected)=>{assert(url.startsWith('/assets/plateau-official-shinjuku-2025/own-only/'));const bytes=await fs.readFile('public'+url);assert.equal(sha(bytes),expected);return bytes;};
  const primary=await sharp(await read(image.url,image.sha256)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const padded=await sharp(await read(image.paddedUrl,image.paddedSha256)).ensureAlpha().raw().toBuffer();
  const mask=await sharp(await read(image.maskUrl,image.maskSha256)).toColourspace('b-w').raw().toBuffer();
  assert.equal(primary.info.width,image.width);assert.equal(primary.info.height,image.height);
  assert.equal(mask.length,image.width*image.height);assert.equal(padded.length,primary.data.length);
  const counts=[0,0,0];
  for(let i=0;i<mask.length;i++){
   const m=mask[i],j=i*4;assert(m<=2);counts[m]++;
   assert.equal(primary.data[j+3],m===1?255:0);assert.equal(padded[j+3],m===1?255:0);
   if(m!==1)for(let k=0;k<3;k++)assert.equal(primary.data[j+k],[183,181,172][k]);
   if(m===0)for(let k=0;k<3;k++)assert.equal(padded[j+k],[183,181,172][k]);
   if(m===1)for(let k=0;k<4;k++)assert.equal(padded[j+k],primary.data[j+k],'Padding changed a donor hit');
  }
  assert.equal(counts[0],image.neutralTexels);assert.equal(counts[1],image.donorTexels);assert.equal(counts[2],image.paddedTexels);
  results.push({file,imageIndex:image.imageIndex,width:image.width,height:image.height,donorTexels:counts[1],transparentTexels:counts[0]+counts[2],passed:true});
 }
 const report={verifiedAt:new Date().toISOString(),images:results.length,buildings:83,ownAlphaCoverageVerified:true,unsampledPrimaryRgbNeutral:true,paddingPreservesDonorHits:true,sourcePhotoFallback:false,allImageAndMaskHashesVerified:true,results};
 await fs.writeFile(out+'/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));
}
