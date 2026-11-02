import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';

const out='public/assets/tocho-landmark/whole-illustrated-20261018';
const audit='data/texture-city/tocho-whole-illustrated-20261018';
const source='public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(source);
const parts=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const ownership=JSON.parse(await fs.readFile(audit+'/ownership-inventory.json','utf8'));
const sourceGeometry=JSON.parse(await fs.readFile('data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json','utf8')).buildings.find(b=>b.id==='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7');
const sourceAssets=JSON.parse(await fs.readFile(audit+'/source-assets.json','utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const unlit=doc.createExtension(KHRMaterialsUnlit),buffer=doc.getRoot().listBuffers()[0];
const materials=new Map(),images=new Map(),records=[];
const roofs=new Set([28,32,33]);
const poor=new Set([0,17,18,24,30]);
const nativeWalls=new Set([1,15,19,25,26,29,31]);
const photoAsset=new Map(sourceAssets.filter(x=>x.name.startsWith('photo-')).flatMap(x=>x.ids.map(id=>[id,x])));
const C={stone:[166,160,147],seam:[111,109,102],light:[216,209,193],metal:[113,120,120],dark:[70,79,85],roof:[174,175,164]};
async function image(name){if(!images.has(name))images.set(name,await fs.readFile(out+'/'+name+'.png'));return images.get(name);}
function material(name,png,role,extra={}){
 if(materials.has(name))return materials.get(name);
 const tex=doc.createTexture(name).setImage(png).setMimeType('image/png');
 const mat=doc.createMaterial(name).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setBaseColorFactor([1,1,1,1]);
 mat.setExtension('KHR_materials_unlit',unlit.createUnlit());
 mat.setExtras({surfaceRole:role,windowAllowed:false,...extra});
 mat.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071).setMagFilter(9729).setMinFilter(9987);
 materials.set(name,mat);return mat;
}
// Separate stone, roof and machinery artworks. No glazing is present in these images.
async function neutral(name,role){
 const w=512,h=512,a=Buffer.alloc(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let c=role==='equipment'?C.metal:role==='roof'?C.roof:C.stone;
  const joint=role==='equipment'?(y%36<2||x%170<2):(x%128<2||y%96<2);
  if(joint)c=role==='equipment'?C.dark:C.seam;
  else if(role==='equipment'&&y%36<5)c=C.light;
  const grain=((x*37+y*19)%13-6)*.22;
  const i=(y*w+x)*3;for(let k=0;k<3;k++)a[i+k]=Math.max(0,Math.min(255,Math.round(c[k]+grain)));
 }
 const png=await sharp(a,{raw:{width:w,height:h,channels:3}}).png().toBuffer();
 await fs.writeFile(out+'/'+name+'.png',png);return material(name,png,role,{artwork:'window-free-specific-material'});
}
const stone=await neutral('stone-panels','wall'),equipment=await neutral('equipment-louvers','equipment'),roof=await neutral('roof-paving','roof');
for(const mat of [stone,equipment])mat.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
const equipmentTop=material('equipment-top',roof.getBaseColorTexture().getImage(),'equipment',{artwork:'window-free-equipment-cap'});
const native=material('source-layout-illustrated',await image('native-atlas-illustrated'),'wall',{windowAllowed:true,placement:'original PLATEAU UV, stylized artwork',inferred:false});
const roofArt=material('roof-layout-illustrated',await image('roof-illustrated'),'roof',{artwork:'original roof atlas stylization, never window extension'});
const photoMats=new Map();
for(const a of sourceAssets.filter(x=>x.name.startsWith('photo-'))){
 const file=a.name+'-illustrated';
 try{photoMats.set(a.name,material(file,await image(file),'wall',{windowAllowed:true,placement:'source photographic UV crop, stylized artwork',sourcePhoto:a.name,photoCertified:false}));}catch(e){if(a.name!=='photo-c')throw e;}
}
// Use the approved detailed window artwork, including complete masonry joints.
// A finite atlas is made for each physical facade run. Its left/right 0.25 m
// collars are stone. Small columns never receive a glazing tile.
const approved=await fs.readFile('public/assets/tocho-landmark/wall-hour-20261018/wall-illustrated-v1.png');
const module=await sharp(approved).extract({left:48,top:188,width:880,height:181}).png().toBuffer();
const moduleRaw=await sharp(module).removeAlpha().raw().toBuffer();
const moduleW=880,moduleH=181,facades=new Map();
function geometry(p){const sem=p.listSemantics(),attrs=Object.fromEntries(sem.map(s=>[s,p.getAttribute(s)])),idx=p.getIndices()?.getArray()??Uint32Array.from({length:attrs.POSITION.getCount()},(_,i)=>i);return {sem,attrs,idx};}
function vertex(g,id){return Object.fromEntries(g.sem.map(s=>{const a=g.attrs[s],n=a.getElementSize();return[s,Array.from(a.getArray().slice(id*n,id*n+n))]}));}
function vector(a,b){return b.map((v,k)=>v-a[k]);}
function triNormal(v){const a=vector(v[0].POSITION,v[1].POSITION),b=vector(v[0].POSITION,v[2].POSITION),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],m=Math.hypot(...n);return m?n.map(x=>x/m):[0,1,0];}
function area(v){const a=vector(v[0].POSITION,v[1].POSITION),b=vector(v[0].POSITION,v[2].POSITION);return Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}
function projected(v,n,role){
 const tangent=Math.abs(n[1])>.8?[1,0,0]:[-n[2],0,n[0]],len=Math.hypot(...tangent),t=tangent.map(x=>x/len);
 return v.map(q=>({...q,TEXCOORD_0:role==='roof'?[(q.POSITION[0]+35)/70,(q.POSITION[2]+48)/120]:[(t[0]*q.POSITION[0]+t[2]*q.POSITION[2]+100)/4,(300-q.POSITION[1])/4]}));
}
function setGeometry(p,ts){
 for(const s of p.listSemantics())p.setAttribute(s,null);
 for(const s of Object.keys(ts[0][0])){const sz=ts[0][0][s].length,a=new Float32Array(ts.length*3*sz);let k=0;for(const t of ts)for(const v of t)for(const x of v[s])a[k++]=x;
  p.setAttribute(s,doc.createAccessor().setType(sz===1?'SCALAR':'VEC'+sz).setArray(a).setBuffer(buffer));}
 p.setIndices(null);return p;
}
function ownerMap(id,n){const a=new Array(n);for(const g of ownership.v106.primitiveInventory[id].groups)for(const [lo,hi]of g.faceRanges)for(let k=lo;k<=hi;k++)a[k]=g;assert(a.every(Boolean));return a;}
// Recover full finite wall extents across source primitives, avoiding phase resets
// at material boundaries. Only infer where the source-semantic audit permits it.
for(let id=0;id<parts.length;id++){
 if(!poor.has(id)&&!nativeWalls.has(id))continue;
 const g=geometry(parts[id]),owners=ownerMap(id,g.idx.length/3);
 for(let f=0;f<owners.length;f++){
  const o=owners[f];if(o.windowDecision!=='wallCandidateNeedsWindowEvidence')continue;
  const v=[0,1,2].map(k=>vertex(g,g.idx[f*3+k])),n=triNormal(v);if(Math.abs(n[1])>.15)continue;
  const poly=o.polygonIndices[0],key=String(poly),rec=facades.get(key)??{key,poly,positions:[],faces:[],normal:n};
  rec.positions.push(...v.map(q=>q.POSITION));rec.faces.push([id,f]);facades.set(key,rec);
 }
}
const facadeByFace=new Map();
for(const rec of facades.values()){
 rec.positions=sourceGeometry.polygons[rec.poly].rings.flatMap(r=>r.points);
 const n=rec.normal,t=[-n[2],0,n[0]],m=Math.hypot(...t);rec.t=t.map(x=>x/m);
 const s=rec.positions.map(p=>p[0]*rec.t[0]+p[2]*rec.t[2]);rec.lo=Math.min(...s);rec.hi=Math.max(...s);rec.width=rec.hi-rec.lo;
 rec.minY=Math.min(...rec.positions.map(p=>p[1]));rec.maxY=Math.max(...rec.positions.map(p=>p[1]));
 rec.bays=rec.width>=2.9?Math.max(1,Math.round(rec.width/3.35)):0;
 if(!rec.bays){rec.mat=stone;for(const [id,f]of rec.faces)facadeByFace.set(id+':'+f,rec);continue;}
 const w=Math.max(128,Math.min(2048,rec.bays*160)),h=Math.max(64,Math.min(4096,Math.ceil((rec.maxY-rec.minY)*32))),bytes=Buffer.alloc(w*h*3),collar=.25/rec.width;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const xf=x/(w-1),Y=rec.maxY-y/(h-1)*(rec.maxY-rec.minY),phase=((174-Y)/3.85%1+1)%1;
  const bay=xf*rec.bays,b=Math.floor(bay),u=bay-b;
  // Four complete groups of three lights alternate with two wider glass bays.
  const cell=b%6,edge=[0,149,278,429,572,702,880],xx=Math.min(moduleW-1,Math.floor(edge[cell]+u*(edge[cell+1]-edge[cell]))),yy=Math.min(moduleH-1,Math.floor(phase*moduleH));
  let c=Array.from(moduleRaw.slice((yy*moduleW+xx)*3,(yy*moduleW+xx)*3+3));
  const end=xf<collar||xf>1-collar,terminal=Y<rec.minY+.35||Y>rec.maxY-.35;
  if(end||terminal)c=(x%80<2||y%64<2)?C.seam:C.stone;
  for(let k=0;k<3;k++)bytes[(y*w+x)*3+k]=c[k];
 }
 const rings=sourceGeometry.polygons[rec.poly].rings;
 const paths=rings.map(r=>r.points.map((p,i)=>(i?'L':'M')+(p[0]*rec.t[0]+p[2]*rec.t[2])+','+(-p[1])).join(' ')+' Z').join(' ');
 const collarSvg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${rec.lo} ${-rec.maxY} ${rec.width} ${rec.maxY-rec.minY}" preserveAspectRatio="none"><path d="${paths}" fill="none" stroke="#a6a093" stroke-width="0.65" stroke-linejoin="miter"/></svg>`);
 const png=await sharp(bytes,{raw:{width:w,height:h,channels:3}}).composite([{input:collarSvg}]).png().toBuffer();
 const name='inferred-finite-wall-'+rec.key;await fs.writeFile(out+'/'+name+'.png',png);
 rec.mat=material(name,png,'wall',{windowAllowed:true,inferred:true,source:'approved detailed wall artwork; facade-specific finite bays',sourcePolygon:rec.poly,closedEndsMeters:.25,polygonBoundaryMasonryMeters:.325,bays:rec.bays});
 for(const [id,f]of rec.faces)facadeByFace.set(id+':'+f,rec);
}
let originalArea=0,finalArea=0,triangles=0,newWindowsOnDenied=0;
const roleTotals={},changed=[];
for(let id=0;id<parts.length;id++){
 const p=parts[id],mesh=p.listParents().find(x=>x.propertyType==='Mesh'),g=geometry(p),owners=ownerMap(id,g.idx.length/3),groups=new Map();
 for(let f=0;f<owners.length;f++){
  const o=owners[f],original=[0,1,2].map(k=>vertex(g,g.idx[f*3+k])),n=triNormal(original),a=area(original);originalArea+=a;
  let v=original,mat=native,role='wall',method='original-atlas-stylized';
  const install=o.semantic==='BuildingInstallation'||o.candidateTypes?.includes('BuildingInstallation');
  const horizontal=Math.abs(n[1])>.8;
  if(install){role='equipment';mat=horizontal?equipmentTop:equipment;v=projected(v,n,horizontal?'roof':'equipment');method='source-CityGML-equipment-no-windows';}
  else if(o.semantic==='GroundSurface'){role='other';mat=roof;v=projected(v,n,'roof');method='ground-paving-no-windows';}
  else if(roofs.has(id)){role='roof';mat=roofArt;method='source-roof-layout-stylized';}
  else if(horizontal||o.semantic==='RoofSurface'||o.candidateTypes?.includes('RoofSurface')){role='roof';mat=roof;v=projected(v,n,'roof');method='roof-paving-no-windows';}
  else if(photoAsset.has(id)&&photoMats.has(photoAsset.get(id).name)){
   const a=photoAsset.get(id),c=a.crop;mat=photoMats.get(a.name);method='photo-layout-stylized';
   v=v.map(q=>({...q,TEXCOORD_0:[(q.TEXCOORD_0[0]*a.sourceWidth-c.left)/c.width,(q.TEXCOORD_0[1]*a.sourceHeight-c.top)/c.height]}));
  }else if(id===13||id===14){mat=native;method='native-layout-upper-pier';}
  else if(poor.has(id)||nativeWalls.has(id)){
   const rec=facadeByFace.get(id+':'+f);
   if(rec?.bays){mat=rec.mat;method='finite-wall-extension';
    v=v.map(q=>({...q,TEXCOORD_0:[(q.POSITION[0]*rec.t[0]+q.POSITION[2]*rec.t[2]-rec.lo)/rec.width,(rec.maxY-q.POSITION[1])/(rec.maxY-rec.minY)]}));
    if(o.windowDecision!=='wallCandidateNeedsWindowEvidence')newWindowsOnDenied++;
   }else{mat=stone;v=projected(v,n,'wall');method='stone-narrow-or-unknown-no-windows';}
  }else if(id===20||id===27){mat=stone;v=projected(v,n,'wall');method='stone-trim-no-windows';}
  const k=mat.getName()+':'+role;let group=groups.get(k);if(!group){group={mat,role,method,triangles:[],area:0,sourceFaces:[]};groups.set(k,group);}group.triangles.push(v);group.area+=a;group.sourceFaces.push(f);
  triangles++;finalArea+=area(v);roleTotals[role]??={triangles:0,area:0};roleTotals[role].triangles++;roleTotals[role].area+=a;
 }
 mesh.removePrimitive(p);
 for(const group of groups.values()){
  const np=setGeometry(doc.createPrimitive(),group.triangles).setMaterial(group.mat).setExtras({surfaceRole:group.role,sourcePrimitive:id,method:group.method,photoCertified:false});mesh.addPrimitive(np);
  records.push({sourcePrimitive:id,role:group.role,method:group.method,material:group.mat.getName(),triangles:group.triangles.length,area:group.area,sourceFaces:group.sourceFaces});
 }
 changed.push({sourcePrimitive:id,groups:groups.size,triangles:g.idx.length/3});
}
assert.equal(triangles,298489);assert.equal(newWindowsOnDenied,0);assert(Math.abs(originalArea-finalArea)<.00001);
const report={createdAt:new Date().toISOString(),scope:'都庁第一本庁舎全体。承認壁面と同系統のイラスト化、部材別材質、写真の弱い壁面の有限パターン延長。',source,sourceSHA256:hash(await fs.readFile(source)),humanAppearanceApproved:false,photoCertified:false,triangles,originalArea,finalArea,areaDifference:Math.abs(originalArea-finalArea),newWindowsOnDenied,roleTotals,materials:materials.size,facades:[...facades.values()].map(r=>({sourcePolygon:r.poly,width:r.width,bays:r.bays,minY:r.minY,maxY:r.maxY,collarMeters:.25})),changed,records,limitations:['AI style transfer preserves intended image layout but is not a metric photo registration certification.','Source CityGML semantics identify installations, not individual windows. Inferred window pattern comes from the approved wall art.','Unresolved semantic faces receive no newly inferred windows. Existing photographic/native layouts may retain source-specific imperfect registrations.']};
doc.getRoot().setExtras({wholeIllustrated:{createdAt:report.createdAt,humanAppearanceApproved:false,photoCertified:false}});
await doc.transform(prune({keepAttributes:true}));
const file=out+'/tocho-whole-illustrated-v1.glb';await io.write(file,doc);report.output={file,sha256:hash(await fs.readFile(file)),bytes:(await fs.stat(file)).size};
await fs.writeFile(audit+'/build-report.json',JSON.stringify(report,null,2));
await fs.writeFile(out+'/build-report.json',JSON.stringify({...report,records:undefined},null,2));
console.log(JSON.stringify({...report,records:undefined,changed:undefined,facades:undefined},null,2));
