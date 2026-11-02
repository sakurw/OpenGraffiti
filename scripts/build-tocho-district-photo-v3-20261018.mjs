import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {triangulate,dot,sub} from './plateau-geometry.mjs';

const audit='data/texture-city/tocho-district-illustrated-20261018',reportDir='data/texture-city/tocho-district-photo-v3-20261018',out='public/assets/tocho-district-photo-v3-20261018';
// Deliberately no auto-run entrypoint elsewhere: main must explicitly launch this script.
await fs.mkdir(out,{recursive:true});
await fs.mkdir(reportDir,{recursive:true});
const scope=JSON.parse(await fs.readFile(audit+'/scope.json','utf8'));
const files=scope.geometryFiles??['data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json'];
const geo={buildings:[],textures:{}};
for(const file of files){const g=JSON.parse(await fs.readFile(file,'utf8'));geo.origin??=g.origin;assert.deepEqual(g.origin,geo.origin);geo.buildings.push(...g.buildings);Object.assign(geo.textures,g.textures);}
geo.buildings=[...new Map(geo.buildings.map(b=>[b.id,b])).values()];
const chosen=new Set(scope.selectedBuildingIds),buildings=geo.buildings.filter(b=>chosen.has(b.id));
assert.equal(chosen.size,buildings.length,'Every selected building must exist');
const central='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';assert(chosen.has(central));
const semantics=JSON.parse(await fs.readFile(audit+'/semantics.json','utf8')).polygons;
const profilePath=out+'/photo-profiles.json';
const profileBytes=await fs.readFile(profilePath),profileInput=JSON.parse(profileBytes);
const approvedCentral={path:'public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb',sha256:'36097e9604a487d6173052a3f49d1a87815af48fc809f40928df920693f259a6'};
const centralAsset=profileInput.centralAsset??approvedCentral;
assert(typeof centralAsset.path==='string'&&centralAsset.path.startsWith('public/'),'centralAsset.path must be a local public asset');
const centralRelative=path.relative(path.resolve('public'),path.resolve(centralAsset.path));
assert(centralRelative&&!centralRelative.startsWith('..')&&!path.isAbsolute(centralRelative),'Central asset escapes public directory');
assert(/^[a-f0-9]{64}$/.test(centralAsset.sha256),'centralAsset.sha256 is required');
assert.equal(crypto.createHash('sha256').update(await fs.readFile(centralAsset.path)).digest('hex'),centralAsset.sha256,'Central asset exact bytes changed');
const v2Root='public/assets/tocho-district-photo-v2-20261018';
const v2Profiles=JSON.parse(await fs.readFile(v2Root+'/photo-profiles.json','utf8')).buildings;
const existingArt=new Map(v2Profiles.filter(p=>p.buildingId!==central&&p.artwork).map(p=>[p.buildingId,p]));
assert.equal(existingArt.size,36,'Expected 36 existing own artworks');
const inferenceStatuses=['native-photo-inference','source-limited-inference','photo-inferred'];
const sourceEvidence=new Map();
assert(Array.isArray(profileInput.buildings),'photo-profiles.buildings must be an array');
const profiles=new Map(),artworks=new Map();
for(const p of profileInput.buildings){
 assert(chosen.has(p.buildingId),'Profile outside source scope: '+p.buildingId);
 assert(!profiles.has(p.buildingId),'Duplicate building profile: '+p.buildingId);
 if(p.buildingId===central){assert.equal(p.evidenceStatus,'approved-central');profiles.set(p.buildingId,p);continue;}
 assert(['street-photo','native-photo-pattern',...inferenceStatuses].includes(p.evidenceStatus),'Invalid evidenceStatus');
 assert.equal(typeof p.windowAllowed,'boolean');
 assert(Array.isArray(p.baseColor)&&p.baseColor.length===3&&p.baseColor.every(v=>Number.isFinite(v)&&v>=0&&v<=255),'RGB baseColor required');
 if(p.roofColor!==undefined)assert(Array.isArray(p.roofColor)&&p.roofColor.length===3&&p.roofColor.every(v=>Number.isFinite(v)&&v>=0&&v<=255),'RGB roofColor required');
 if(p.roofColor!==undefined){
  assert(typeof p.roofColorBasis==='string'&&p.roofColorBasis.trim(),'Explicit roofColorBasis required');
  if(p.roofEvidence){
   assert.equal(p.roofEvidence.review?.buildingId,p.buildingId,'Roof evidence belongs to another building');
   assert.equal(p.roofEvidence.review?.status,'reviewed');assert.equal(p.roofEvidence.review?.roofColorUsable,true);
   const owner=geo.buildings.find(b=>b.id===p.buildingId),roofId=p.roofEvidence.polygonId;
   assert(owner.polygons.some(q=>q.id===roofId)&&semantics[roofId]?.type==='RoofSurface','Roof color evidence must be own semantic roof polygon');
   const photo=p.roofEvidence.photo;assert(photo?.path&&photo.sha256,'Roof photo provenance required');
   assert.equal(crypto.createHash('sha256').update(await fs.readFile(photo.path)).digest('hex'),photo.sha256,'Roof evidence photo changed');
   assert.equal(p.roofEvidence.review.photoSha256,photo.sha256,'Roof review refers to different photo');
  }
 }
 if(p.masonrySideCap!==undefined)assert(Number.isFinite(p.masonrySideCap)&&p.masonrySideCap>=0,'masonrySideCap must be nonnegative meters');
 assert(Array.isArray(p.sourcePaths)&&typeof p.observed==='string'&&typeof p.inferred==='string','Explicit source evidence and inference required');
 assert(p.artwork,'Every neighbor requires own artwork: '+p.buildingId);
 if(!existingArt.has(p.buildingId))assert(inferenceStatuses.includes(p.evidenceStatus),'New artwork must retain inference status: '+p.buildingId);
 if(p.featureOneFace){const f=p.featureOneFace;assert.equal(p.windowAllowed,false,'featureOneFace requires opaque artwork');assert.equal(artworkMappingFor(p),'single-face');assert(Array.isArray(f.secondaryUV)&&f.secondaryUV.length===4&&f.secondaryUV.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&f.secondaryUV[0]<f.secondaryUV[2]&&f.secondaryUV[1]<f.secondaryUV[3],'Valid secondaryUV rectangle required');assert(typeof f.basis==='string'&&f.basis.trim(),'Explicit feature placement inference basis required');}
 if(p.artworkMapping!==undefined)assert(['single-face','physical-repeat'].includes(p.artworkMapping),'Unsupported artworkMapping');
 if(p.facadeMode==='full-closed-face')assert.equal(p.windowAllowed,false,'Full closed-face inference must be opaque');
 if(p.facadeMode!==undefined)assert(['full-closed-face','physical-repeat'].includes(p.facadeMode),'Unsupported facadeMode');
 const chain=[];
 for(const source of p.sourcePaths){
  const file=typeof source==='string'?source:source.path;
  assert(typeof file==='string'&&file,'Local photo source path required');
  const sha256=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if(typeof source==='object'&&source.sha256)assert.equal(sha256,source.sha256,'Source photo changed');
  chain.push({path:file,sha256});
 }
 assert(chain.length>0,'Own photo source chain required even for source-limited inference');
 sourceEvidence.set(p.buildingId,chain);
 if(p.artwork){
  assert(!path.isAbsolute(p.artwork)&&!p.artwork.includes(String.fromCharCode(92)),'Artwork must be output-relative POSIX path');
  const full=path.resolve(out,p.artwork),rel=path.relative(path.resolve(out),full);
  assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Artwork escapes output directory');
  for(const k of ['bays','floors'])assert(Number.isInteger(p[k])&&p[k]>0,'Positive integer '+k+' required');
  for(const k of ['bayWidth','floorHeight'])assert(Number.isFinite(p[k])&&p[k]>0,'Positive physical '+k+' required');
  const bytes=await fs.readFile(full),raw=await sharp(bytes).rotate().flatten({background:{r:p.baseColor[0],g:p.baseColor[1],b:p.baseColor[2]}}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
  const artworkHash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(p.artworkSha256)assert.equal(artworkHash,p.artworkSha256,'Profile artwork SHA mismatch');
  const old=existingArt.get(p.buildingId);
  if(old){assert.equal(p.evidenceStatus,old.evidenceStatus,'Existing evidence status changed');assert.equal(artworkHash,crypto.createHash('sha256').update(await fs.readFile(v2Root+'/'+old.artwork)).digest('hex'),'Existing own artwork changed');}
  artworks.set(p.buildingId,{data:raw.data,width:raw.info.width,height:raw.info.height,bays:p.bays,floors:p.floors,path:p.artwork,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 profiles.set(p.buildingId,p);
}
assert.equal(buildings.length,83,'Frozen v1 scope must contain all 83 buildings');
assert.deepEqual([...profiles.keys()].sort(),[...chosen].sort(),'Exactly all 83 selected profiles required');
assert.equal(artworks.size,82,'All 82 neighbors need own artwork');
assert.equal([...profiles.values()].filter(p=>p.buildingId!==central&&!existingArt.has(p.buildingId)).length,46);
function artworkMappingFor(p){return p.artworkMapping??(p.facadeMode==='full-closed-face'?'single-face':'physical-repeat');}
function materialSource(id){const p=profiles.get(id);return {buildingId:id,evidenceStatus:p.evidenceStatus,sourceChain:sourceEvidence.get(id),observed:p.observed,inferred:p.inferred,photoRegistrationCertified:false,sourceChainIsFullCertification:false};}
// There is no pattern-family lookup, neighbor borrowing, or native photo reclassification.
function area(t){let a=0;for(let k=0;k<t.indices.length;k+=3){const [p,q,r]=t.indices.slice(k,k+3).map(i=>t.points[i]),u=sub(q,p),v=sub(r,p);a+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return a;}
function dims(p,t){const tangent=[-t.normal[2],0,t.normal[0]],d=Math.hypot(...tangent);const u=d>.1?tangent.map(x=>x/d):[1,0,0],pts=p.rings.flatMap(r=>r.points),lo=Math.min(...pts.map(p=>dot(p,u))),hi=Math.max(...pts.map(p=>dot(p,u))),minY=Math.min(...pts.map(p=>p[1])),maxY=Math.max(...pts.map(p=>p[1]));return {u,lo,hi,minY,maxY,width:hi-lo,height:maxY-minY};}
function floorLayout(b,d,p){
 const pitch=p.floorHeight;
 if(!Number.isFinite(pitch)||pitch<=0)return {anchorY:null,startRow:0,endRow:0,floors:0,startY:d.minY,endY:d.minY,phaseTopY:d.maxY};
 const anchorY=b.min[1]+.28;
 const startRow=Math.ceil((d.minY+.28-anchorY)/pitch-1e-9);
 const endRow=Math.floor((d.maxY-.28-anchorY)/pitch+1e-9);
 const floors=Math.max(0,endRow-startRow);
 const phaseTopY=anchorY+Math.floor((b.max[1]-.28-anchorY)/pitch+1e-9)*pitch;
 return {anchorY,startRow,endRow,floors,startY:anchorY+startRow*pitch,endY:anchorY+endRow*pitch,phaseTopY};
}
function sideCapFor(b,profile){
 if(profile.masonrySideCap!==undefined)return {meters:profile.masonrySideCap,basis:'profile.masonrySideCap; architectural inference unless profile evidence measures it'};
 const wide=['bldg_9eabfa88-e9b7-402d-b38a-08a5f2544e21','bldg_89e585dc-50ee-485f-bed1-ce0101523b1e'].includes(b.id);
 return {meters:wide?3:.3,basis:wide?'Inferred 3m blank edge pier for Hyatt/Daiichi; not a photographically measured width':'Code default 0.3m closed side edge'};
}
function classificationGap(b,t){
 if(b.id!=='bldg_6e9c9041-3a29-47ac-aaa3-28429eddcca2')return null;
 return {code:'NSglassClassificationGap',confirmed:false,normal:t.normal,normalAzimuthDegrees:(Math.atan2(t.normal[0],-t.normal[2])*180/Math.PI+360)%360,
  inspectedSources:['data/texture-city/tocho-district-photo-v2-20261018/landmark-photos/ns-01.jpg','data/texture-city/tocho-district-photo-v2-20261018/landmark-photos/ns-03.jpg'],
  observed:'Stone-like panel faces with horizontal slit windows, broad reflective fields, narrow vertical gridded glazing, and different upper horizontal glazing bands.',
  gap:'No calibrated photo-to-polygon correspondence for these views. Geometry normals alone do not establish glass versus stone or upper glazing boundaries. Reflection and shadow must not be treated as a confirmed material boundary.',
  behavior:'Single own-building profile extended as inferred appearance; no per-polygon material variant or claim that all NS faces are correct.'};
}
const doc=new Document(),buf=doc.createBuffer(),scene=doc.createScene('都庁 ±1街区 — building-specific photo district v3'),unlit=doc.createExtension(KHRMaterialsUnlit);
function solid(name,color,role){return doc.createMaterial(name).setBaseColorFactor([...color,1]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtras({surfaceRole:role,windowAllowed:false}).setExtension('KHR_materials_unlit',unlit.createUnlit());}
const buildingMaterials=new Map();
async function materialsFor(b,profile){
 if(buildingMaterials.has(b.id))return buildingMaterials.get(b.id);
 const mats={};
 for(const role of ['stone','roof','equipment','ground']){
  const c=role==='roof'?(profile.roofColor??[173,179,166]):profile.baseColor,size=256,data=Buffer.alloc(size*size*3);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const seam=role==='equipment'?(y%32<2||x%128<2):(x%128<2||y%128<2);
   const grain=((x*13+y*29)%11-5)*.18;
   for(let j=0;j<3;j++)data[(y*size+x)*3+j]=Math.max(0,Math.min(255,c[j]+grain-(seam?26:0)));
  }
  const bytes=await sharp(data,{raw:{width:size,height:size,channels:3}}).png().toBuffer();
  const tx=doc.createTexture(b.id+' '+role+' window-free material').setImage(bytes).setMimeType('image/png');
  mats[role]=solid(b.id+' '+role,[1,1,1],role).setBaseColorTexture(tx).setExtras({...materialSource(b.id),buildingId:b.id,surfaceRole:role,windowAllowed:false,textured:false,generatedEngineeringPattern:true,baseColor:c,evidenceStatus:profile.evidenceStatus,sourceFreePattern:true,colorBasis:role==='roof'?(profile.roofColor?profile.roofColorBasis:'code-native engineering roof default; no accepted own-photo appearance color'):'profile.baseColor',patternInference:'Window-free code-generated engineering seams and grain; not photo-derived surface detail.'});
  mats[role].getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
 }
 buildingMaterials.set(b.id,mats);return mats;
}
function polygonRole(b,p,t){const s=semantics[p.id];if(s?.installation||s?.type==='BuildingInstallation')return 'equipment';if(s?.type==='RoofSurface')return 'roof';if(s?.type==='GroundSurface')return 'ground';if(b.walls.some(w=>w.id===p.id)&&Math.abs(t.normal[1])<.15)return 'wall';return Math.abs(t.normal[1])>.7?'roof':'equipment';}
function selectFeaturePrimary(b){const eligible=[];for(const p of b.polygons){const t=triangulate(p.rings.map(r=>r.points));if(!t.indices.length||polygonRole(b,p,t)!=='wall')continue;const d=dims(p,t),a=area(t);if(d.width>0&&d.height>0&&a>0)eligible.push({id:p.id,area:a});}eligible.sort((a,b)=>b.area-a.area||a.id.localeCompare(b.id));assert(eligible.length,'featureOneFace needs an eligible native wall');return eligible[0].id;}
function featureLayoutFor(d,m,secondaryUV){const capX=Math.min(.025,d.width*.1),capY=Math.min(.025,d.height*.1),available={startX:capX,endX:d.width-capX,startY:d.minY+capY,endY:d.maxY-capY},aspect=m.width/m.height,height=Math.min(available.endY-available.startY,(available.endX-available.startX)/aspect),width=height*aspect,centerX=(available.startX+available.endX)/2,centerY=(available.startY+available.endY)/2;return {box:{startX:centerX-width/2,endX:centerX+width/2,startY:centerY-height/2,endY:centerY+height/2},sourceUV:[0,0,1,1],artworkDimensions:[m.width,m.height],artworkAspect:aspect,artworkWidthMeters:width,artworkHeightMeters:height,secondaryUV,secondaryRepeatMeters:{width:width*(secondaryUV[2]-secondaryUV[0]),height:height*(secondaryUV[3]-secondaryUV[1])},edgeCapMeters:.025,collarStrokeMeters:.05,scaleAndOrientationInferred:true};}
const featurePrimary=new Map(),featureLayouts=new Map();
const pending=[],records=[],analysis=[];let ignoredDegenerate=0;
for(const b of buildings){
 if(b.id===central)continue;
 const profile=profiles.get(b.id),m=artworks.get(b.id),mats=await materialsFor(b,profile),wallIds=new Set(b.walls.map(p=>p.id));
 if(profile.featureOneFace){const id=selectFeaturePrimary(b);featurePrimary.set(b.id,id);const poly=b.polygons.find(p=>p.id===id),t=triangulate(poly.rings.map(r=>r.points));featureLayouts.set(b.id,featureLayoutFor(dims(poly,t),m,profile.featureOneFace.secondaryUV));}
 const r={bayWidth:profile.bayWidth,floorHeight:profile.floorHeight},sideCap=sideCapFor(b,profile);
 analysis.push({materialSource:materialSource(b.id),id:b.id,name:b.name,profile,artworkSha256:m?.sha256??null,photoRegistrationCertified:false});
 for(const p of b.polygons){
  const t=triangulate(p.rings.map(r=>r.points));if(!t.indices.length){ignoredDegenerate++;continue;}
  const s=semantics[p.id],d=dims(p,t),ar=area(t),role=polygonRole(b,p,t);
  // Small piers, parapets, signs and closures never get a window cell.
  const layout=floorLayout(b,d,profile);
  const windows=profile.windowAllowed&&profile.evidenceStatus!=='insufficient'&&!!m&&role==='wall'&&d.width>=2.3&&d.height>=2.6&&ar>=8&&(b.max[1]-b.min[1]>=4.5||profile.singleStoreyObserved===true)&&d.width>=r.bayWidth+2*sideCap.meters&&layout.floors>0;
  const textured=role==='wall'&&!!m&&profile.evidenceStatus!=='insufficient'&&(!profile.windowAllowed||windows)&&d.width>0&&d.height>0;
  const featureMapping=profile.featureOneFace&&textured?{primaryPolygonId:featurePrimary.get(b.id),isPrimary:p.id===featurePrimary.get(b.id),sourceUV:p.id===featurePrimary.get(b.id)?[0,0,1,1]:profile.featureOneFace.secondaryUV,basis:profile.featureOneFace.basis,orientationInferred:true,selection:'largest eligible native wall area; polygon ID breaks ties'}:null;
  const q={b,p,t,d,role,windows,textured,profile,sideCap,featureMapping,featureLayout:featureMapping?featureLayouts.get(b.id):null,classificationGap:role==='wall'?classificationGap(b,t):null,material:textured?null:mats[role==='wall'?'stone':role],uv:null};
  if(textured){
   const density=q.featureMapping?100:18;
   const W=Math.max(48,Math.min(1536,Math.ceil(d.width*density))),H=Math.max(48,Math.min(2048,Math.ceil(d.height*density))),pix=Buffer.alloc(W*H*3),bays=Math.max(0,Math.floor((d.width-2*sideCap.meters)/r.bayWidth)),floors=layout.floors;
   const opaqueCapX=Math.min(q.featureMapping?.025:sideCap.meters,d.width*.1),opaqueCapY=Math.min(q.featureMapping?.025:.28,d.height*.1);
   const startX=windows?sideCap.meters:opaqueCapX,startY=windows?layout.startY:d.minY+opaqueCapY,endY=windows?layout.endY:d.maxY-opaqueCapY,endX=windows?startX+bays*r.bayWidth:d.width-opaqueCapX;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const px=(x+.5)/W*d.width,Y=d.maxY-(y+.5)/H*d.height;
    const single=artworkMappingFor(profile)==='single-face';
    const tx=single?Math.max(0,Math.min(1,(px-startX)/Math.max(Number.EPSILON,endX-startX))):((px-startX)/(r.bayWidth*m.bays)%1+1)%1;
    const ty=single?Math.max(0,Math.min(1,(endY-Y)/Math.max(Number.EPSILON,endY-startY))):(((layout.phaseTopY-Y)/(r.floorHeight*m.floors))%1+1)%1;
    let sourceU=tx,sourceV=ty;
    if(q.featureMapping){const f=q.featureLayout,box=f.box,inside=q.featureMapping.isPrimary&&px>=box.startX&&px<box.endX&&Y>=box.startY&&Y<box.endY;
     if(inside){sourceU=(px-box.startX)/f.artworkWidthMeters;sourceV=(box.endY-Y)/f.artworkHeightMeters;}
     else{const u=((px-box.startX)/f.secondaryRepeatMeters.width%1+1)%1,v=((box.endY-Y)/f.secondaryRepeatMeters.height%1+1)%1;sourceU=f.secondaryUV[0]+u*(f.secondaryUV[2]-f.secondaryUV[0]);sourceV=f.secondaryUV[1]+v*(f.secondaryUV[3]-f.secondaryUV[1]);}
    }
    const sx=Math.min(m.width-1,Math.floor(sourceU*m.width)),sy=Math.min(m.height-1,Math.floor(sourceV*m.height));
    const cap=px<startX||px>=endX||Y<startY||Y>=endY;
    for(let j=0;j<3;j++)pix[(y*W+x)*3+j]=cap?profile.baseColor[j]:m.data[(sy*m.width+sx)*3+j];
   }
   // Inward masonry collar around EVERY actual source ring, including holes
   // and stepped boundaries; not merely the rectangular texture extents.
   const paths=p.rings.map(r=>'M'+r.points.map(v=>`${(dot(v,d.u)-d.lo)/d.width*W},${(d.maxY-v[1])/d.height*H}`).join('L')+'Z').join('');
   const collar=Math.max(q.featureMapping?1:2,Math.min(q.featureMapping?.05:.6,Math.min(d.width,d.height)*.2)*Math.min(W/d.width,H/d.height)),svg=`<svg width="${W}" height="${H}"><path d="${paths}" fill="none" stroke="rgb(${profile.baseColor.join(',')})" stroke-width="${collar}" stroke-linejoin="miter"/></svg>`;
   q.art=await sharp(pix,{raw:{width:W,height:H,channels:3}}).composite([{input:Buffer.from(svg)}]).png().toBuffer();q.W=W;q.H=H;q.bays=bays;q.floors=floors;q.artwork=m.path;q.artworkSha256=m.sha256;q.cellBounds={startX,endX,startY,endY,bayWidth:r.bayWidth,floorHeight:r.floorHeight,anchorY:layout.anchorY,startRow:layout.startRow,endRow:layout.endRow,phaseTopY:layout.phaseTopY};pending.push(q);
  }
  records.push(q);
 }
 console.log('Prepared',b.name||b.id,analysis.length,'/',buildings.length-1);
}
assert.equal(records.reduce((sum,q)=>sum+q.t.indices.length/3,0),8040,'All 8040 native neighbor triangles must be preserved');
for(const id of artworks.keys())assert(records.some(q=>q.b.id===id&&q.textured),'Own artwork not applied: '+id);
// Finite facade images in padded 4096 atlases; no wrapping into another face.
pending.sort((a,b)=>b.H-a.H||b.W-a.W);const pages=[];let page={x:0,y:0,row:0,items:[]};pages.push(page);const pad=6,size=4096;
for(const q of pending){if(page.x+q.W+2*pad>size){page.x=0;page.y+=page.row;page.row=0;}if(page.y+q.H+2*pad>size){page={x:0,y:0,row:0,items:[]};pages.push(page);}q.rect={x:page.x+pad,y:page.y+pad,w:q.W,h:q.H,page:pages.length-1};page.items.push(q);page.x+=q.W+2*pad;page.row=Math.max(page.row,q.H+2*pad);}
for(let i=0;i<pages.length;i++){
 const items=[];for(const q of pages[i].items)items.push({input:await sharp(q.art).extend({top:pad,bottom:pad,left:pad,right:pad,extendWith:'copy'}).png().toBuffer(),left:q.rect.x-pad,top:q.rect.y-pad});
 const bytes=await sharp({create:{width:size,height:size,channels:3,background:'#a7a295'}}).composite(items).jpeg({quality:93,chromaSubsampling:'4:4:4'}).toBuffer();await fs.writeFile(`${out}/facades-${i}.jpg`,bytes);
 const tx=doc.createTexture('closed facade atlas '+i).setImage(bytes).setMimeType('image/jpeg'),mat=solid('building-specific wall atlas '+i,[1,1,1],'wall');mat.setBaseColorTexture(tx).setExtras({surfaceRole:'wall',windowAllowed:true,inferred:true});mat.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);for(const ownerId of new Set(pages[i].items.map(q=>q.b.id)))for(const allowed of [false,true]){
  const members=pages[i].items.filter(q=>q.b.id===ownerId&&q.windows===allowed);if(!members.length)continue;
  const ownedMat=mat.clone().setName(ownerId+' own artwork atlas '+i+(allowed?' glazing':' opaque')).setExtras({...materialSource(ownerId),surfaceRole:'wall',windowAllowed:allowed,textured:true,artwork:artworks.get(ownerId).path,artworkSha256:artworks.get(ownerId).sha256,artworkMapping:artworkMappingFor(profiles.get(ownerId)),facadeMode:profiles.get(ownerId).facadeMode??(!profiles.get(ownerId).windowAllowed?'full-closed-face':'physical-repeat'),featureOneFace:profiles.get(ownerId).featureOneFace??null,featurePrimaryPolygonId:featurePrimary.get(ownerId)??null,featureLayout:featureLayouts.get(ownerId)??null});
  for(const q of members)q.material=ownedMat;
 }
 mat.dispose();
}
const groups=new Map();
for(const q of records){
 const key=q.b.id+'|'+q.material.getName();if(!groups.has(key))groups.set(key,{building:q.b,mat:q.material,pos:[],norm:[],uv:[],ix:[],polygonIds:[],role:q.role});const h=groups.get(key),offset=h.pos.length/3;h.pos.push(...q.t.points.flat());h.norm.push(...q.t.points.flatMap(()=>q.t.normal));
 for(const p of q.t.points){if(q.textured){const u=(dot(p,q.d.u)-q.d.lo)/q.d.width,v=(q.d.maxY-p[1])/q.d.height;assert(u>=-.001&&u<=1.001&&v>=-.001&&v<=1.001);h.uv.push((q.rect.x+u*q.rect.w)/size,(q.rect.y+v*q.rect.h)/size);}else h.uv.push(dot(p,q.d.u)/4,Math.abs(q.t.normal[1])>.7?p[2]/4:p[1]/4);}
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
const manifest={version:'20261018-photo-district-v3',profilePath,profileSha256:crypto.createHash('sha256').update(profileBytes).digest('hex'),scopePath:audit+'/scope.json',semanticsPath:audit+'/semantics.json',centralApprovedAsset:centralAsset,centralAsset,centralViewerAsset:{url:'/'+path.relative('public',centralAsset.path).split(path.sep).join('/'),sha256:centralAsset.sha256,external:true},evidenceCounts:Object.fromEntries([...new Set([...profiles.values()].filter(p=>p.buildingId!==central).map(p=>p.evidenceStatus))].sort().map(s=>[s,[...profiles.values()].filter(p=>p.buildingId!==central&&p.evidenceStatus===s).length])),allBuildingsPhotoSourced:false,pendingBuildingIds:[...profiles.values()].filter(p=>p.evidenceStatus==='insufficient').map(p=>p.buildingId),buildingCount:buildings.length,buildings:buildings.map(b=>({id:b.id,name:b.name,min:b.min,max:b.max,lod:b.lod,inferred:b.id!==central,evidenceStatus:b.id===central?'approved-central-asset':profiles.get(b.id).evidenceStatus})),bounds,scopeLabel:"都庁を中心に周囲1街区（中央公園を含む8街区）",selectionPolygonXZ:scope.selectionPolygonXZ,source:'Project PLATEAU 新宿区 2025 CityGML / EPSG:6677',origin:geo.origin,notes:['都庁第一本庁舎は確認済みの全体モデルを保持。周辺は建物専用profile/artworkで描画。写真根拠が限定された推論はsource-limited-inferenceとして明示。','窓の位置は意匠推測を含み、実測再現ではありません。','設備・屋根には窓を適用せず、壁の外周と穴は石材で閉じています。','道路はPLATEAU形状。地面は道路・建物基部の標高から補間した背景で、実測DEMではありません。'],roadPolygons:roadCount,neighborTriangles:records.reduce((s,q)=>s+q.t.indices.length/3,0),facadeAtlases:pages.length,assetBytes:bytes.length,humanAppearanceApproved:false};
manifest.ownArtworkBuildings=artworks.size;manifest.existingArtworkPreserved=existingArt.size;manifest.newInferenceArtworkBuildings=46;manifest.sourceChainIsFullCertification=false;
manifest.roofAppearanceEvidence=[...profiles.values()].filter(p=>p.buildingId!==central).map(p=>({buildingId:p.buildingId,color:p.roofColor??[173,179,166],colorAppliedFromOwnProfile:p.roofColor!==undefined,colorBasis:p.roofColorBasis??'Code-native engineering roof default; no accepted own-photo appearance color',roofEvidence:p.roofEvidence??null,patternBasis:'Code-generated engineering seams/grain; no added photographed detail; not calibrated material/albedo'}));
manifest.reviewedRoofColorBuildingCount=[...profiles.values()].filter(p=>p.roofColor!==undefined).length;
manifest.materialClassificationGaps=[...new Map(records.filter(q=>q.classificationGap).map(q=>[q.b.id,{buildingId:q.b.id,...q.classificationGap,normal:undefined,normalAzimuthDegrees:undefined}])).values()];
manifest.sourceFreeGaps={pendingBuildingIds:manifest.pendingBuildingIds,codeGenerated:['roof/equipment/ground seam and grain patterns','all face collars and caps','interpolated ground context'],roofDefault:[173,179,166],wallArtworkNeverAppliedToRoofs:true};
await fs.writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2));
const report={...manifest,scope,geometryFiles:files,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),analysis,ignoredDegenerate,polygons:records.map(q=>({buildingId:q.b.id,id:q.p.id,role:q.role,normal:q.t.normal,normalAzimuthDegrees:(Math.atan2(q.t.normal[0],-q.t.normal[2])*180/Math.PI+360)%360,materialClassificationGap:q.classificationGap,masonrySideCap:q.sideCap,windows:q.windows,textured:q.textured,semantic:semantics[q.p.id]??null,triangles:q.t.indices.length/3,bays:q.bays,rect:q.rect,floors:q.floors??0,artwork:q.artwork??null,artworkSha256:q.artworkSha256??null,cellBounds:q.cellBounds??null,featureMapping:q.featureMapping,featureLayout:q.featureLayout,physicalDimensions:{width:q.d.width,height:q.d.height},materialSource:materialSource(q.b.id),edgeClosure:{mode:'opaque-collar-all-source-rings',ringCount:q.p.rings.length,geometryChanged:false},profileEvidence:{evidenceStatus:q.profile.evidenceStatus,sourcePaths:q.profile.sourcePaths,observed:q.profile.observed,inferred:q.profile.inferred,windowAllowed:q.profile.windowAllowed,baseColor:q.profile.baseColor,roofColor:q.profile.roofColor??null,roofColorBasis:q.profile.roofColorBasis??null,masonrySideCap:q.profile.masonrySideCap??null},sourceFreeGaps:{pattern:q.textured?'Own artwork extended without per-face registration':'Code-generated seams/grain; no source image used',caps:'Profile base-color collar on all rings; code-generated, not photographed',roof:q.role==='roof'?{colorBasis:q.profile.roofColor?q.profile.roofColorBasis:'Code-native engineering roof default; no accepted own-photo appearance color',sourcePaths:q.profile.roofSourcePaths??[q.profile.roofEvidence?.photo?.path,q.profile.roofEvidence?.source?.localPath].filter(Boolean),observed:q.profile.roofObserved??q.profile.roofEvidence?.review?.appearance??null,inferred:q.profile.roofInferred??'Roof seams/grain generated by code; wall artwork never used'}:null},inferredExtension:q.textured?'Same-building artwork extended across this face; no per-face photo registration. Upper glazing/stone transitions and unseen elevations are inferred, not separately evidenced. '+q.profile.inferred:'Window-free code-generated engineering material; no glazing pattern added. Roof uses roofColor or explicit code-native default, never wall artwork.',rings:q.p.rings.map(r=>({id:r.id,vertexCount:r.points.length}))})),checks:{allSelectedBuildingsPresent:buildings.length===chosen.size,centralNotDuplicated:!records.some(q=>q.b.id===central),windowsOnInstallation:records.filter(q=>q.windows&&(semantics[q.p.id]?.installation||semantics[q.p.id]?.type==='BuildingInstallation')).length,windowsOnNonWall:records.filter(q=>q.windows&&q.role!=='wall').length,sourcePolygonRingsPreserved:true,facadeUVWithinFiniteBounds:true}};
for(const face of report.polygons){
 const profile=profiles.get(face.buildingId);
 if(face.featureMapping)face.featurePlacementInference=face.featureMapping.isPrimary?'Full artwork fitted once with preserved image aspect and centered inside largest eligible wall; blank-wall crop repeats outside the feature box at matching physical texel density. Placement, orientation and scale inferred, not photo registered.':'Only profile.secondaryUV blank-wall crop used; door not repeated. Crop selection is explicit inference.';
 face.artworkMapping=face.textured?(artworkMappingFor(profile)):null;
 if(face.textured&&artworkMappingFor(profile)==='single-face')face.inferredExtension='Own-building artwork fitted once within this face, no periodic door repetition; no per-face photo registration. '+profile.inferred;
}
assert.equal(report.checks.windowsOnInstallation,0);assert.equal(report.checks.windowsOnNonWall,0);
await fs.writeFile(reportDir+'/build-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({version:manifest.version,buildingCount:manifest.buildingCount,neighborTriangles:manifest.neighborTriangles,ownArtworkBuildings:artworks.size,evidenceCounts:manifest.evidenceCounts,facadeAtlases:pages.length,assetBytes:bytes.length,centralAsset:manifest.centralAsset,checks:report.checks}));
