import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {triangulate,dot,sub} from './plateau-geometry.mjs';

const audit='data/texture-city/tocho-district-illustrated-20261018',out='public/assets/tocho-district-illustrated-20261018';
await fs.mkdir(out,{recursive:true});
const scope=JSON.parse(await fs.readFile(audit+'/scope.json','utf8'));
const files=scope.geometryFiles??['data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json'];
const geo={buildings:[],textures:{}};
for(const file of files){const g=JSON.parse(await fs.readFile(file,'utf8'));geo.origin??=g.origin;assert.deepEqual(g.origin,geo.origin);geo.buildings.push(...g.buildings);Object.assign(geo.textures,g.textures);}
geo.buildings=[...new Map(geo.buildings.map(b=>[b.id,b])).values()];
const chosen=new Set(scope.selectedBuildingIds),buildings=geo.buildings.filter(b=>chosen.has(b.id));
assert.equal(chosen.size,buildings.length,'Every selected building must exist');
const central='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';assert(chosen.has(central));
const semantics=JSON.parse(await fs.readFile(audit+'/semantics.json','utf8')).polygons;
const motifPath=out+'/architectural-modules.png';
const motifs=[];
// Inspected actual artwork boundaries, not the requested equal-band positions:
// generation did not obey exact band heights. Crop complete floor modules.
for(const crop of [{top:0,height:277,bays:4},{top:355,height:201,bays:4},{top:835,height:111,bays:16},{top:1132,height:269,bays:4}]){
 const {data,info}=await sharp(motifPath).extract({left:0,top:crop.top,width:1003,height:crop.height}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 motifs.push({data,width:info.width,height:info.height,bays:crop.bays,floors:1});
}
const {data:tochoModule,info:tochoInfo}=await sharp('public/assets/tocho-landmark/wall-hour-20261018/wall-illustrated-v1.png').extract({left:48,top:188,width:880,height:181}).removeAlpha().raw().toBuffer({resolveWithObject:true});
motifs.push({data:tochoModule,width:tochoInfo.width,height:tochoInfo.height,bays:6,floors:1});
const rawCache=new Map();
async function sourceImage(image){
 if(!image)return null;
 if(!rawCache.has(image)){
  try{rawCache.set(image,await sharp('data/plateau/plateau-13104-shinjuku-ku-2025/udx/bldg/'+image).removeAlpha().raw().toBuffer({resolveWithObject:true}));}catch{rawCache.set(image,null);}
 }return rawCache.get(image);
}
function area(t){let a=0;for(let k=0;k<t.indices.length;k+=3){const [p,q,r]=t.indices.slice(k,k+3).map(i=>t.points[i]),u=sub(q,p),v=sub(r,p);a+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return a;}
function dims(p,t){const tangent=[-t.normal[2],0,t.normal[0]],d=Math.hypot(...tangent);const u=d>.1?tangent.map(x=>x/d):[1,0,0],pts=p.rings.flatMap(r=>r.points),lo=Math.min(...pts.map(p=>dot(p,u))),hi=Math.max(...pts.map(p=>dot(p,u))),minY=Math.min(...pts.map(p=>p[1])),maxY=Math.max(...pts.map(p=>p[1]));return {u,lo,hi,minY,maxY,width:hi-lo,height:maxY-minY};}
// Read the actual source polygon through its original UVs, rather than using
// the packed atlas bounding rectangle (which can contain somebody else's roof).
async function analyze(b){
 let candidates=b.walls.map(p=>{const t=triangulate(p.rings.map(r=>r.points));return{p,t,a:area(t)};}).filter(c=>geo.textures[c.p.id]&&Math.abs(c.t.normal[1])<.12).sort((a,b)=>b.a-a.a);
 const c=candidates[0];const fallback={sourceImage:null,measured:false,floorHeight:b.max[1]-b.min[1]>60?3.65:3.1,bayWidth:2.9,mean:[139,144,139],contrast:0};
 if(!c)return fallback;
 const a=geo.textures[c.p.id],im=await sourceImage(a.image);if(!im)return {...fallback,sourceImage:a.image};
 const uv=c.p.rings.flatMap(r=>{const v=a.rings[r.id];return r.points.map((_,i)=>v?[v[2*i],1-v[2*i+1]]:null);});if(uv.some(x=>!x))return fallback;
 const d=dims(c.p,c.t),W=96,H=192,lum=new Float32Array(W*H),mask=new Uint8Array(W*H);let sums=[0,0,0],ss=0,count=0;
 const xy=c.t.points.map(p=>[dot(p,d.u),p[1]]);
 for(let k=0;k<c.t.indices.length;k+=3){const ids=c.t.indices.slice(k,k+3),[aa,bb,cc]=ids.map(i=>xy[i]);const den=(bb[1]-cc[1])*(aa[0]-cc[0])+(cc[0]-bb[0])*(aa[1]-cc[1]);if(Math.abs(den)<1e-8)continue;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const at=y*W+x;if(mask[at])continue;const q=[d.lo+(x+.5)/W*d.width,d.maxY-(y+.5)/H*d.height],w1=((bb[1]-cc[1])*(q[0]-cc[0])+(cc[0]-bb[0])*(q[1]-cc[1]))/den,w2=((cc[1]-aa[1])*(q[0]-cc[0])+(aa[0]-cc[0])*(q[1]-cc[1]))/den,w3=1-w1-w2;if(Math.min(w1,w2,w3)<-.00001)continue;
   const tex=[0,1].map(j=>uv[ids[0]][j]*w1+uv[ids[1]][j]*w2+uv[ids[2]][j]*w3);const sx=Math.max(0,Math.min(im.info.width-1,Math.round(tex[0]*im.info.width))),sy=Math.max(0,Math.min(im.info.height-1,Math.round(tex[1]*im.info.height))),ix=(sy*im.info.width+sx)*im.info.channels,rgb=[0,1,2].map(j=>im.data[ix+j]);if(Math.max(...rgb)<12)continue;const l=(rgb[0]+rgb[1]+rgb[2])/3;lum[at]=l;mask[at]=1;count++;ss+=l*l;rgb.forEach((v,i)=>sums[i]+=v);
  }
 }
 if(count<100)return {...fallback,sourceImage:a.image};
 const mean=sums.map(x=>x/count),contrast=Math.sqrt(Math.max(0,ss/count-(mean.reduce((s,x)=>s+x,0)/3)**2));
 const rows=Array.from({length:H},(_,y)=>{let s=0,n=0;for(let x=0;x<W;x++)if(mask[y*W+x]){s+=lum[y*W+x];n++;}return n?s/n:0;});
 let best=null;for(let lag=2;lag<Math.min(H/3,40);lag++){const meters=lag/H*d.height;if(meters<2.7||meters>4.4)continue;let err=0,n=0;for(let y=1;y+lag<H;y++)if(rows[y]&&rows[y+lag]){err+=(rows[y]-rows[y+lag])**2;n++;}const score=n?err/n:Infinity;if(!best||score<best.score)best={score,meters};}
 return {sourceImage:a.image,sourcePolygon:c.p.id,measured:true,sampledPixels:count,mean:mean.map(x=>+x.toFixed(1)),contrast:+contrast.toFixed(2),floorHeight:best?+best.meters.toFixed(2):fallback.floorHeight,bayWidth:2.9,rhythmConfidence:best?'bounded-source-autocorrelation':'architectural-prior',photoRegistrationCertified:false};
}
function recipe(b,a){
 const h=b.max[1]-b.min[1];let motif= h>65?3:0,bay=2.8,floor=a.floorHeight;
 if(b.name.includes('第二本')){motif=4;bay=3.35;floor=3.85;}
 else if(b.name.includes('プラザ')){motif=0;bay=2.65;floor=3.35;}
 else if(b.name.includes('モノリス')){motif=1;bay=3;floor=3.7;}
 else if(b.name.includes('ＫＤＤＩ')){motif=0;bay=1.85;floor=3.5;}
 else if(b.name.includes('ＮＳ')){motif=3;bay=3.3;floor=3.9;}
 else if(b.name.includes('住友')){motif=2;bay=2.6;floor=3.65;}
 else if(h>80&&a.mean[2]>a.mean[0]+6){motif=2;bay=2.6;}
 else if(h>60&&a.contrast<18){motif=1;bay=3.1;}
 return {motif,bayWidth:bay,floorHeight:floor,windowInference:'source pattern family and architectural prior; not surveyed window geometry'};
}
const doc=new Document(),buf=doc.createBuffer(),scene=doc.createScene('都庁 ±1街区 — illustrated district'),unlit=doc.createExtension(KHRMaterialsUnlit);
function solid(name,color,role){return doc.createMaterial(name).setBaseColorFactor([...color,1]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtras({surfaceRole:role,windowAllowed:false}).setExtension('KHR_materials_unlit',unlit.createUnlit());}
const mats={stone:solid('neutral stone — no windows',[.61,.59,.54],'stone'),roof:solid('roof waterproofing',[.62,.65,.62],'roof'),equipment:solid('equipment metal — no glazing',[.43,.48,.49],'equipment'),ground:solid('ground surfaces',[.74,.73,.67],'ground')};
// Window-free engineering materials retain physical scale and their own seams.
for(const role of ['stone','roof','equipment']){
 const size=256,data=Buffer.alloc(size*size*3),c=role==='stone'?[167,162,149]:role==='roof'?[173,179,166]:[120,132,133];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const seam=role==='equipment'?(y%32<2||x%128<2):(x%128<2||y%128<2),grain=((x*13+y*29)%11-5)*.18;for(let j=0;j<3;j++)data[(y*size+x)*3+j]=Math.max(0,Math.min(255,c[j]+grain-(seam?26:0)));}
 const png=await sharp(data,{raw:{width:size,height:size,channels:3}}).png().toBuffer(),tx=doc.createTexture(role+' material').setImage(png).setMimeType('image/png');mats[role].setBaseColorFactor([1,1,1,1]).setBaseColorTexture(tx);mats[role].getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
}
const pending=[],records=[],analysis=[];let ignoredDegenerate=0;
for(const b of buildings){
 if(b.id===central)continue;
 const a=await analyze(b),r=recipe(b,a),wallIds=new Set(b.walls.map(p=>p.id));analysis.push({id:b.id,name:b.name,analysis:a,recipe:r});
 for(const p of b.polygons){
  const t=triangulate(p.rings.map(r=>r.points));if(!t.indices.length){ignoredDegenerate++;continue;}
  const s=semantics[p.id],d=dims(p,t),ar=area(t);let role;
  if(s?.installation||s?.type==='BuildingInstallation')role='equipment';
  else if(s?.type==='RoofSurface')role='roof';
  else if(s?.type==='GroundSurface')role='ground';
  else if(wallIds.has(p.id)&&Math.abs(t.normal[1])<.15)role='wall';
  else role=Math.abs(t.normal[1])>.7?'roof':'equipment';
  // Small piers, parapets, signs and closures never get a window cell.
  const windows=role==='wall'&&d.width>=2.3&&d.height>=2.6&&ar>=8&&b.max[1]-b.min[1]>=4.5;
  const q={b,p,t,d,role,windows,material:windows?null:mats[role==='wall'?'stone':role],uv:null};
  if(windows){
   const W=Math.max(48,Math.min(1536,Math.ceil(d.width*18))),H=Math.max(48,Math.min(2048,Math.ceil(d.height*18))),pix=Buffer.alloc(W*H*3),m=motifs[r.motif],bays=Math.max(1,Math.round((d.width-.6)/r.bayWidth));
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const px=(x+.5)/W*d.width,Y=d.maxY-(y+.5)/H*d.height;
    const tx=((px-.3)/(d.width-.6)*bays/m.bays%1+1)%1,ty=(((b.max[1]-.35-Y)/r.floorHeight/m.floors)%1+1)%1;
    const sx=Math.min(m.width-1,Math.floor(tx*m.width)),sy=Math.min(m.height-1,Math.floor(ty*m.height));
    const cap=px<.3||px>d.width-.3||Y<d.minY+.28||Y>d.maxY-.28;
    for(let j=0;j<3;j++)pix[(y*W+x)*3+j]=cap?[167,162,149][j]:m.data[(sy*m.width+sx)*3+j];
   }
   // Inward masonry collar around EVERY actual source ring, including holes
   // and stepped boundaries; not merely the rectangular texture extents.
   const paths=p.rings.map(r=>'M'+r.points.map(v=>`${(dot(v,d.u)-d.lo)/d.width*W},${(d.maxY-v[1])/d.height*H}`).join('L')+'Z').join('');
   const collar=.6*Math.min(W/d.width,H/d.height),svg=`<svg width="${W}" height="${H}"><path d="${paths}" fill="none" stroke="#a7a295" stroke-width="${collar}" stroke-linejoin="miter"/></svg>`;
   q.art=await sharp(pix,{raw:{width:W,height:H,channels:3}}).composite([{input:Buffer.from(svg)}]).png().toBuffer();q.W=W;q.H=H;q.bays=bays;pending.push(q);
  }
  records.push(q);
 }
 console.log('Prepared',b.name||b.id,analysis.length,'/',buildings.length-1);
}
// Finite facade images in padded 4096 atlases; no wrapping into another face.
pending.sort((a,b)=>b.H-a.H||b.W-a.W);const pages=[];let page={x:0,y:0,row:0,items:[]};pages.push(page);const pad=6,size=4096;
for(const q of pending){if(page.x+q.W+2*pad>size){page.x=0;page.y+=page.row;page.row=0;}if(page.y+q.H+2*pad>size){page={x:0,y:0,row:0,items:[]};pages.push(page);}q.rect={x:page.x+pad,y:page.y+pad,w:q.W,h:q.H,page:pages.length-1};page.items.push(q);page.x+=q.W+2*pad;page.row=Math.max(page.row,q.H+2*pad);}
for(let i=0;i<pages.length;i++){
 const items=[];for(const q of pages[i].items)items.push({input:await sharp(q.art).extend({top:pad,bottom:pad,left:pad,right:pad,extendWith:'copy'}).png().toBuffer(),left:q.rect.x-pad,top:q.rect.y-pad});
 const bytes=await sharp({create:{width:size,height:size,channels:3,background:'#a7a295'}}).composite(items).jpeg({quality:93,chromaSubsampling:'4:4:4'}).toBuffer();await fs.writeFile(`${out}/facades-${i}.jpg`,bytes);
 const tx=doc.createTexture('closed facade atlas '+i).setImage(bytes).setMimeType('image/jpeg'),mat=solid('illustrated wall atlas '+i,[1,1,1],'wall');mat.setBaseColorTexture(tx).setExtras({surfaceRole:'wall',windowAllowed:true,inferred:true});mat.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);for(const q of pages[i].items)q.material=mat;
}
const groups=new Map();
for(const q of records){
 const key=q.b.id+'|'+q.material.getName();if(!groups.has(key))groups.set(key,{building:q.b,mat:q.material,pos:[],norm:[],uv:[],ix:[],polygonIds:[],role:q.role});const h=groups.get(key),offset=h.pos.length/3;h.pos.push(...q.t.points.flat());h.norm.push(...q.t.points.flatMap(()=>q.t.normal));
 for(const p of q.t.points){if(q.windows){const u=(dot(p,q.d.u)-q.d.lo)/q.d.width,v=(q.d.maxY-p[1])/q.d.height;assert(u>=-.001&&u<=1.001&&v>=-.001&&v<=1.001);h.uv.push((q.rect.x+u*q.rect.w)/size,(q.rect.y+v*q.rect.h)/size);}else h.uv.push(dot(p,q.d.u)/4,Math.abs(q.t.normal[1])>.7?p[2]/4:p[1]/4);}
 h.ix.push(...q.t.indices.map(i=>i+offset));h.polygonIds.push(q.p.id);
}
function primitive(h){const p=doc.createPrimitive().setMaterial(h.mat).setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(h.pos)).setBuffer(buf)).setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(new Float32Array(h.norm)).setBuffer(buf)).setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(h.uv)).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(h.ix)).setBuffer(buf));
 if(h.building){const color=new Float32Array(h.pos.length);for(let i=0;i<h.norm.length;i+=3){const shade=.78+.22*Math.max(0,-h.norm[i]*.43+h.norm[i+1]*.8+h.norm[i+2]*.4);color[i]=color[i+1]=color[i+2]=shade;}p.setAttribute('COLOR_0',doc.createAccessor().setType('VEC3').setArray(color).setBuffer(buf));}return p;}
for(const [key,h]of groups){scene.addChild(doc.createNode(h.building.name||h.building.id).setMesh(doc.createMesh(key).addPrimitive(primitive(h))).setExtras({buildingId:h.building.id,name:h.building.name,sourcePolygonIds:h.polygonIds,surfaceRole:h.role}));}
const roads=JSON.parse(await fs.readFile(scope.renderRoadsFile??audit+'/render-roads.json','utf8'));const roadItems=Array.isArray(roads)?roads:roads.polygons??roads.roads;
const roadMat=solid('PLATEAU surveyed road',[.48,.52,.53],'road'),roadH={mat:roadMat,pos:[],norm:[],uv:[],ix:[]};
let roadCount=0;
for(const p of roadItems){const rings=p.rings?.map(r=>r.points??r)??[p.points];if(!rings[0]?.length)continue;const t=triangulate(rings);if(!t.indices.length)continue;const o=roadH.pos.length/3;roadH.pos.push(...t.points.flat());roadH.norm.push(...t.points.flatMap(()=>t.normal));roadH.uv.push(...t.points.flatMap(()=>[0,0]));roadH.ix.push(...t.indices.map(i=>i+o));roadCount++;}
if(roadH.ix.length)scene.addChild(doc.createNode('PLATEAU roads').setMesh(doc.createMesh().addPrimitive(primitive(roadH))).setExtras({surfaceRole:'road'}));
const bounds={min:[0,1,2].map(i=>Math.min(...buildings.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.max(...buildings.map(b=>b.max[i])))};
// A restrained ground backdrop interpolates known road/building-base heights.
// It is labelled as interpolated context, never presented as surveyed DEM.
const X=bounds.min[0]-30,Z=bounds.min[2]-30,XX=bounds.max[0]+30,ZZ=bounds.max[2]+30;
const supports=buildings.map(b=>[(b.min[0]+b.max[0])/2,b.min[1],(b.min[2]+b.max[2])/2]);
for(let i=0;i<roadH.pos.length;i+=30){const p=roadH.pos.slice(i,i+3);if(p.length===3&&p[1]>5)supports.push(p);}
const base={mat:solid('interpolated ground context',[.83,.83,.76],'display-base'),pos:[],norm:[],uv:[],ix:[]},NX=Math.ceil((XX-X)/8),NZ=Math.ceil((ZZ-Z)/8);
for(let z=0;z<=NZ;z++)for(let x=0;x<=NX;x++){
 const px=X+x/NX*(XX-X),pz=Z+z/NZ*(ZZ-Z),near=supports.map(p=>({p,d:(p[0]-px)**2+(p[2]-pz)**2})).sort((a,b)=>a.d-b.d).slice(0,6);let sw=0,sy=0;for(const {p,d}of near){const w=1/Math.max(4,d);sw+=w;sy+=p[1]*w;}
 let py=sy/sw-.35;for(const b of buildings)if(px>=b.min[0]-1&&px<=b.max[0]+1&&pz>=b.min[2]-1&&pz<=b.max[2]+1)py=Math.min(py,b.min[1]-.15);
 base.pos.push(px,py,pz);base.norm.push(0,1,0);base.uv.push(x/NX,z/NZ);
}
for(let z=0;z<NZ;z++)for(let x=0;x<NX;x++){const a=z*(NX+1)+x,b=a+1,c=a+NX+1,d=c+1;base.ix.push(a,c,b,b,c,d);}
scene.addChild(doc.createNode('Interpolated context (not surveyed DEM)').setMesh(doc.createMesh().addPrimitive(primitive(base))));
const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]),bytes=await io.writeBinary(doc);await fs.writeFile(out+'/district.glb',bytes);
const manifest={version:'20261018-illustrated-district-v1',buildingCount:buildings.length,buildings:buildings.map(b=>({id:b.id,name:b.name,min:b.min,max:b.max,lod:b.lod,inferred:b.id!==central})),bounds,scopeLabel:"都庁を中心に周囲1街区（中央公園を含む8街区）",selectionPolygonXZ:scope.selectionPolygonXZ,source:'Project PLATEAU 新宿区 2025 CityGML / EPSG:6677',origin:geo.origin,notes:['都庁第一本庁舎は確認済みの全体モデルを保持。周辺は元画像のパターン解析と部材別推測で描画。','窓の位置は意匠推測を含み、実測再現ではありません。','設備・屋根には窓を適用せず、壁の外周と穴は石材で閉じています。','道路はPLATEAU形状。地面は道路・建物基部の標高から補間した背景で、実測DEMではありません。'],roadPolygons:roadCount,neighborTriangles:records.reduce((s,q)=>s+q.t.indices.length/3,0),facadeAtlases:pages.length,assetBytes:bytes.length,humanAppearanceApproved:false};
await fs.writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2));
const report={...manifest,scope,geometryFiles:files,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),analysis,ignoredDegenerate,polygons:records.map(q=>({buildingId:q.b.id,id:q.p.id,role:q.role,windows:q.windows,semantic:semantics[q.p.id]??null,triangles:q.t.indices.length/3,bays:q.bays,rect:q.rect})),checks:{allSelectedBuildingsPresent:buildings.length===chosen.size,centralNotDuplicated:!records.some(q=>q.b.id===central),windowsOnInstallation:records.filter(q=>q.windows&&(semantics[q.p.id]?.installation||semantics[q.p.id]?.type==='BuildingInstallation')).length,windowsOnNonWall:records.filter(q=>q.windows&&q.role!=='wall').length,sourcePolygonRingsPreserved:true,facadeUVWithinFiniteBounds:true}};
assert.equal(report.checks.windowsOnInstallation,0);assert.equal(report.checks.windowsOnNonWall,0);
await fs.writeFile(audit+'/build-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...manifest,buildings:undefined,notes:undefined,checks:report.checks}));
