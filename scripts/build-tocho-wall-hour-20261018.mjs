import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS,KHRMaterialsUnlit} from '@gltf-transform/extensions';
const dir='public/assets/tocho-landmark/wall-hour-20261018';
const audit='data/texture-city/tocho-wall-hour-20261018';
const source='public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb';
const baseline='public/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const config=JSON.parse(await fs.readFile(audit+'/patch-config.json','utf8'));
const photoDoc=await io.read(source),doc=await io.read(baseline);
const parts=d=>d.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const sourcePart=parts(photoDoc)[config.primitive];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const illustrated=await fs.readFile(dir+'/wall-illustrated-v1.png');
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
// Interior selection avoids photographed neighboring return faces at both edges.
const loT=config.minT+(config.maxT-config.minT)*.055;
const hiT=config.minT+(config.maxT-config.minT)*.91;
const planes=[v=>dot(v.POSITION,config.tangent)-loT,v=>hiT-dot(v.POSITION,config.tangent),v=>v.POSITION[1]-config.minY,v=>config.maxY-v.POSITION[1]];
const faceKey=vs=>vs.map(v=>v.POSITION.map(x=>Math.round(x*1000)).join(',')).sort().join('|');
function triangles(p){
 const sem=p.listSemantics();
 const attrs=Object.fromEntries(sem.map(s=>[s,p.getAttribute(s)]));
 const idx=p.getIndices()?.getArray()??Array.from({length:attrs.POSITION.getCount()},(_,i)=>i);
 const res=[];
 for(let i=0;i<idx.length;i+=3)res.push(Array.from(idx.slice(i,i+3),k=>Object.fromEntries(sem.map(s=>{const a=attrs[s],n=a.getElementSize();return[s,Array.from(a.getArray().slice(k*n,k*n+n))]}))));
 return res;
}
const sourceTriangles=triangles(sourcePart),keys=new Set(sourceTriangles.map(faceKey));
const mix=(a,b,t)=>Object.fromEntries(Object.keys(a).map(s=>[s,a[s].map((v,i)=>v+(b[s][i]-v)*t)]));
function clip(poly,fn,sign=1){
 const out=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=fn(a)*sign,db=fn(b)*sign;
  if(da>=0)out.push(a);
  if((da>=0)!==(db>=0))out.push(mix(a,b,da/(da-db)));
 }
 return out;
}
function area(vs){const [a,b,c]=vs.map(v=>v.POSITION),u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}
function fan(poly){const ts=[];for(let i=1;i+1<poly.length;i++){const t=[poly[0],poly[i],poly[i+1]];if(area(t)>1e-10)ts.push(t);}return ts;}
function partition(tri){let inside=tri;const outside=[];for(const fn of planes){if(!inside.length)break;outside.push(...fan(clip(inside,fn,-1)));inside=clip(inside,fn);}return {inside:fan(inside),outside};}
const remap=t=>t.map(v=>({...v,TEXCOORD_0:[(dot(v.POSITION,config.tangent)-config.minT)/(config.maxT-config.minT),(config.maxY-v.POSITION[1])/(config.maxY-config.minY)]}));
function setGeometry(d,p,ts){
 assert(ts.length>0);const buf=d.getRoot().listBuffers()[0]??d.createBuffer();
 for(const s of p.listSemantics())p.setAttribute(s,null);
 for(const s of Object.keys(ts[0][0])){
  const n=ts[0][0][s].length;
  const a=new Float32Array(ts.flatMap(t=>t.flatMap(v=>v[s])));
  p.setAttribute(s,d.createAccessor().setType(n===1?'SCALAR':`VEC${n}`).setArray(a).setBuffer(buf));
 }
 p.setIndices(null);return p;
}
function newDoc(name){const d=new Document();d.createBuffer();const scene=d.createScene(name);d.getRoot().setDefaultScene(scene);const mesh=d.createMesh(name);scene.addChild(d.createNode(name).setMesh(mesh));return {d,mesh};}
function material(d,name,image,mime='image/png',src=null){
 const tex=d.createTexture(name).setImage(image).setMimeType(mime);
 const mat=d.createMaterial(name).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true);
 mat.setExtension('KHR_materials_unlit',d.createExtension(KHRMaterialsUnlit).createUnlit());
 const info=mat.getBaseColorTextureInfo();info.setWrapS(33071).setWrapT(33071).setMagFilter(9729).setMinFilter(9987);
 if(src){mat.setBaseColorFactor(src.getBaseColorFactor());const prev=src.getBaseColorTextureInfo();info.setWrapS(prev.getWrapS()).setWrapT(prev.getWrapT());}
 return mat;
}
const patchMat=material(doc,'写真の部材配置を保持したイラスト調・1区画試作',illustrated);
patchMat.setExtras({kind:'AI-stylized-photographic-layout',sourcePhotoId:config.sourcePhotoId,sourcePrimitive:2,photoCertified:false,scope:'single-wall-patch',humanAppearanceApproved:false});
const originalPatch=newDoc('写真・選択壁面'),oldPatch=newDoc('v32・選択壁面'),newPatch=newDoc('イラスト調・選択壁面');
let originalArea=0,insideArea=0,outsideArea=0,matched=0,affected=0;
const afterAll=[],changedParts=[];
for(const [id,p]of parts(doc).entries()){
 const all=triangles(p);if(!all.some(t=>keys.has(faceKey(t))))continue;
 const retained=[],patch=[],before=[];
 for(const t of all){
  if(!keys.has(faceKey(t))){retained.push(t);continue;}matched++;
  const {inside,outside}=partition(t);originalArea+=area(t);insideArea+=inside.reduce((s,t)=>s+area(t),0);outsideArea+=outside.reduce((s,t)=>s+area(t),0);
  if(inside.length){affected++;patch.push(...inside.map(remap));before.push(...inside);retained.push(...outside);}else retained.push(t);
 }
 if(!patch.length)continue;
 const oldMat=p.getMaterial(),tex=oldMat.getBaseColorTexture();
 oldPatch.mesh.addPrimitive(setGeometry(oldPatch.d,oldPatch.d.createPrimitive(),before).setMaterial(material(oldPatch.d,`v32 original material ${id}`,tex.getImage(),tex.getMimeType(),oldMat)));
 setGeometry(doc,p,retained);
 const parent=p.listParents().find(x=>x.propertyType==='Mesh');
 parent.addPrimitive(setGeometry(doc,doc.createPrimitive(),patch).setMaterial(patchMat).setExtras({wallHourPatch:true,sourcePrimitive:2,oldPrimitive:id}));
 afterAll.push(...patch);changedParts.push({id,selectedTriangles:before.length,retainedTriangles:retained.length});
}
assert.equal(matched,sourceTriangles.length);
assert(Math.abs(originalArea-insideArea-outsideArea)<1e-5,'Partition must conserve surface area');
const photoPatch=sourceTriangles.flatMap(t=>partition(t).inside);
const sourceMat=sourcePart.getMaterial(),sourceTex=sourceMat.getBaseColorTexture();
originalPatch.mesh.addPrimitive(setGeometry(originalPatch.d,originalPatch.d.createPrimitive(),photoPatch).setMaterial(material(originalPatch.d,'既存地上写真の同じ区画',sourceTex.getImage(),sourceTex.getMimeType(),sourceMat)));
newPatch.mesh.addPrimitive(setGeometry(newPatch.d,newPatch.d.createPrimitive(),afterAll).setMaterial(material(newPatch.d,'イラスト調・生成テクスチャ',illustrated)));
assert(Math.abs(photoPatch.reduce((s,t)=>s+area(t),0)-insideArea)<.0001);
const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
for(const t of afterAll)for(const v of t)for(let i=0;i<3;i++){bounds.min[i]=Math.min(bounds.min[i],v.POSITION[i]);bounds.max[i]=Math.max(bounds.max[i],v.POSITION[i]);}
const first=afterAll.find(t=>area(t)>.1),[a,b,c]=first.map(v=>v.POSITION),u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],nn=Math.hypot(...n);
const center=bounds.min.map((x,i)=>(x+bounds.max[i])/2);
const report={createdAt:new Date().toISOString(),source,baseline,config,selection:{loT,hiT,minY:config.minY,maxY:config.maxY},bounds,center,normal:n.map(x=>x/nn),tangent:config.tangent,changedParts,matched,affected,patchTriangles:afterAll.length,originalArea,insideArea,outsideArea,partitionAreaError:Math.abs(originalArea-insideArea-outsideArea),textureSha256:hash(illustrated),sourcePhotoId:config.sourcePhotoId,photoCertified:false,humanAppearanceApproved:false,method:'Ground photo baked via existing mesh UV into frontal wall coordinates; built-in image generation style transfer; same position-derived UV applied only to clipped original wall faces. No overlapping replacement plane.'};
doc.getRoot().setExtras({...doc.getRoot().getExtras(),wallHourPilot:report});
for(const [name,d]of [['patch-photo',originalPatch.d],['patch-v32',oldPatch.d],['patch-illustrated-v1',newPatch.d],['tocho-context-illustrated-v1',doc]]){
 const file=dir+'/'+name+'.glb';await io.write(file,d);report[name]={file,sha256:hash(await fs.readFile(file))};
}
await fs.writeFile(audit+'/build-report.json',JSON.stringify(report,null,2));
await fs.writeFile(dir+'/patch-view.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({bounds,center,normal:report.normal,changedParts,patchTriangles:afterAll.length,area:insideArea,error:report.partitionAreaError}));
