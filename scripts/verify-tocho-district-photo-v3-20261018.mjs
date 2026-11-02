import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {triangulate} from './plateau-geometry.mjs';
const scopeDir='data/texture-city/tocho-district-illustrated-20261018',dir='data/texture-city/tocho-district-photo-v3-20261018',asset='public/assets/tocho-district-photo-v3-20261018';
const scope=JSON.parse(await fs.readFile(scopeDir+'/scope.json','utf8')),report=JSON.parse(await fs.readFile(dir+'/build-report.json','utf8')),manifest=JSON.parse(await fs.readFile(asset+'/manifest.json','utf8'));
const profileBytes=await fs.readFile(asset+'/photo-profiles.json'),profileInput=JSON.parse(profileBytes),profiles=new Map(profileInput.buildings.map(p=>[p.buildingId,p]));
assert.equal(profiles.size,profileInput.buildings.length,'Duplicate profile');
assert.equal(crypto.createHash('sha256').update(profileBytes).digest('hex'),report.profileSha256,'Profiles changed since build');
assert.equal(manifest.profileSha256,report.profileSha256);
assert.equal(crypto.createHash('sha256').update(await fs.readFile(asset+'/district.glb')).digest('hex'),report.sha256,'GLB changed since build');
const selected=new Set(scope.selectedBuildingIds),central='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
assert.equal(profiles.size,83);
assert.deepEqual([...profiles.keys()].sort(),[...selected].sort());
const v2Root='public/assets/tocho-district-photo-v2-20261018';
const v2Profiles=JSON.parse(await fs.readFile(v2Root+'/photo-profiles.json','utf8')).buildings;
const existingArt=new Map(v2Profiles.filter(p=>p.buildingId!==central&&p.artwork).map(p=>[p.buildingId,p]));
assert.equal(existingArt.size,36);
const inferenceStatuses=['native-photo-inference','source-limited-inference','photo-inferred'];
const sourceEvidence=new Map();
for(const p of profiles.values()){
 if(p.buildingId===central)continue;
 assert(['street-photo','native-photo-pattern',...inferenceStatuses].includes(p.evidenceStatus));
 assert(p.artwork,'Missing own artwork');
 if(p.facadeMode==='full-closed-face')assert.equal(p.windowAllowed,false);
 assert(!path.isAbsolute(p.artwork)&&!p.artwork.includes(String.fromCharCode(92)));
 const relative=path.relative(path.resolve(asset),path.resolve(asset,p.artwork));
 assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Artwork escapes output');
 const ownHash=crypto.createHash('sha256').update(await fs.readFile(asset+'/'+p.artwork)).digest('hex');
 if(p.artworkSha256)assert.equal(ownHash,p.artworkSha256);
 const old=existingArt.get(p.buildingId);
 if(old){assert.equal(p.evidenceStatus,old.evidenceStatus);assert.equal(ownHash,crypto.createHash('sha256').update(await fs.readFile(v2Root+'/'+old.artwork)).digest('hex'),'Existing own artwork changed');}
 else assert(inferenceStatuses.includes(p.evidenceStatus),'New artwork must be labelled inference');
 const chain=[];
 for(const source of p.sourcePaths){const file=typeof source==='string'?source:source.path;const sha256=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');if(typeof source==='object'&&source.sha256)assert.equal(sha256,source.sha256);chain.push({path:file,sha256});}
 assert(chain.length>0);sourceEvidence.set(p.buildingId,chain);
}
assert.equal([...profiles.values()].filter(p=>p.buildingId!==central&&!existingArt.has(p.buildingId)).length,46);
function artworkMappingFor(p){return p.artworkMapping??(p.facadeMode==='full-closed-face'?'single-face':'physical-repeat');}
function materialSource(id){const p=profiles.get(id);return {buildingId:id,evidenceStatus:p.evidenceStatus,sourceChain:sourceEvidence.get(id),observed:p.observed,inferred:p.inferred,photoRegistrationCertified:false,sourceChainIsFullCertification:false};}
const counts=Object.fromEntries([...new Set([...profiles.values()].filter(p=>p.buildingId!==central).map(p=>p.evidenceStatus))].sort().map(s=>[s,[...profiles.values()].filter(p=>p.buildingId!==central&&p.evidenceStatus===s).length]));
assert.deepEqual(report.evidenceCounts,counts);assert.deepEqual(manifest.evidenceCounts,counts);
assert.equal(report.allBuildingsPhotoSourced,false);assert.equal(manifest.allBuildingsPhotoSourced,false);
const buildings=new Map();for(const f of report.geometryFiles)for(const b of JSON.parse(await fs.readFile(f,'utf8')).buildings)if(selected.has(b.id))buildings.set(b.id,b);
assert.deepEqual(report.geometryFiles,scope.geometryFiles,'Use the frozen v1 geometry inputs');
assert.deepEqual(report.scope,scope,'Frozen v1 scope changed');
const semantics=JSON.parse(await fs.readFile(scopeDir+'/semantics.json','utf8')).polygons;
assert.equal(selected.size,83);assert.equal(selected.size,buildings.size);assert.equal(manifest.buildingCount,selected.size);
assert.deepEqual([...new Set(manifest.buildings.map(b=>b.id))].sort(),[...selected].sort());
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(asset+'/district.glb'),seen=new Map();
const reportedFaces=new Map(report.polygons.map(f=>[f.buildingId+'|'+f.id,f]));
assert.equal(reportedFaces.size,report.polygons.length,'Duplicate face evidence');
function triKey(tri){return tri.map(p=>p.map(v=>Math.fround(v).toString()).join(',')).sort().join('|');}
const expected=new Map();
for(const [id,b]of buildings){if(id===central)continue;const map=new Map();for(const p of b.polygons){const t=triangulate(p.rings.map(r=>r.points));for(let k=0;k<t.indices.length;k+=3){const key=triKey(t.indices.slice(k,k+3).map(i=>t.points[i]));map.set(key,(map.get(key)||0)+1);}}expected.set(id,map);}
const expectedFeaturePrimary=new Map(),expectedFeatureLayouts=new Map();
for(const [id,b]of buildings){const p=profiles.get(id);if(!p.featureOneFace)continue;const f=p.featureOneFace;assert.equal(p.windowAllowed,false);assert.equal(artworkMappingFor(p),'single-face');assert(Array.isArray(f.secondaryUV)&&f.secondaryUV.length===4&&f.secondaryUV.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&f.secondaryUV[0]<f.secondaryUV[2]&&f.secondaryUV[1]<f.secondaryUV[3]);assert(typeof f.basis==='string'&&f.basis.trim());const candidates=[];
 for(const poly of b.polygons){const sem=semantics[poly.id],t=triangulate(poly.rings.map(r=>r.points));if(!t.indices.length||sem?.installation||['BuildingInstallation','RoofSurface','GroundSurface'].includes(sem?.type)||!b.walls.some(w=>w.id===poly.id)||Math.abs(t.normal[1])>=.15)continue;
 const tangent=[-t.normal[2],0,t.normal[0]],length=Math.hypot(...tangent),u=tangent.map(v=>v/length),pts=poly.rings.flatMap(r=>r.points),xs=pts.map(v=>v.reduce((sum,x,k)=>sum+x*u[k],0)),ys=pts.map(v=>v[1]);if(Math.max(...xs)<=Math.min(...xs)||Math.max(...ys)<=Math.min(...ys))continue;let a=0;for(let k=0;k<t.indices.length;k+=3){const [v,w,z]=t.indices.slice(k,k+3).map(i=>t.points[i]),x=w.map((n,i)=>n-v[i]),y=z.map((n,i)=>n-v[i]);a+=Math.hypot(x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0])/2;}if(a>0)candidates.push({id:poly.id,area:a});}
 candidates.sort((a,b)=>b.area-a.area||a.id.localeCompare(b.id));assert(candidates.length);expectedFeaturePrimary.set(id,candidates[0].id);
 const primaryPoly=b.polygons.find(p=>p.id===candidates[0].id),t=triangulate(primaryPoly.rings.map(r=>r.points)),tangent=[-t.normal[2],0,t.normal[0]],len=Math.hypot(...tangent),u=len>.1?tangent.map(v=>v/len):[1,0,0],points=primaryPoly.rings.flatMap(r=>r.points),xs=points.map(p=>p.reduce((sum,v,i)=>sum+v*u[i],0)),ys=points.map(p=>p[1]),d={width:Math.max(...xs)-Math.min(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};d.height=d.maxY-d.minY;
 const {info}=await sharp(asset+'/'+p.artwork).rotate().raw().toBuffer({resolveWithObject:true}),aspect=info.width/info.height,capX=Math.min(.025,d.width*.1),capY=Math.min(.025,d.height*.1),availWidth=d.width-2*capX,availHeight=d.height-2*capY,height=Math.min(availHeight,availWidth/aspect),width=height*aspect,centerX=d.width/2,centerY=(d.minY+d.maxY)/2;
 const expectedLayout={box:{startX:centerX-width/2,endX:centerX+width/2,startY:centerY-height/2,endY:centerY+height/2},sourceUV:[0,0,1,1],artworkDimensions:[info.width,info.height],artworkAspect:aspect,artworkWidthMeters:width,artworkHeightMeters:height,secondaryUV:f.secondaryUV,secondaryRepeatMeters:{width:width*(f.secondaryUV[2]-f.secondaryUV[0]),height:height*(f.secondaryUV[3]-f.secondaryUV[1])},edgeCapMeters:.025,collarStrokeMeters:.05,scaleAndOrientationInferred:true};expectedFeatureLayouts.set(id,expectedLayout);
 const faces=report.polygons.filter(f=>f.buildingId===id&&f.textured),primary=faces.filter(f=>f.featureMapping?.isPrimary);assert.equal(primary.length,1,'Exactly one feature face required');assert.equal(primary[0].id,candidates[0].id,'Feature primary must be largest eligible native wall');
 for(const face of faces){assert.deepEqual(face.featureMapping,{primaryPolygonId:candidates[0].id,isPrimary:face.id===candidates[0].id,sourceUV:face.id===candidates[0].id?[0,0,1,1]:f.secondaryUV,basis:f.basis,orientationInferred:true,selection:'largest eligible native wall area; polygon ID breaks ties'});assert(face.featurePlacementInference);const plan=face.featureLayout;assert(plan);const close=(a,b)=>assert(Math.abs(a-b)<1e-7,'Feature layout mismatch');for(const key of ['startX','endX','startY','endY'])close(plan.box[key],expectedLayout.box[key]);for(const key of ['artworkAspect','artworkWidthMeters','artworkHeightMeters','edgeCapMeters','collarStrokeMeters'])close(plan[key],expectedLayout[key]);assert.deepEqual(plan.sourceUV,[0,0,1,1]);assert.deepEqual(plan.secondaryUV,f.secondaryUV);assert.deepEqual(plan.artworkDimensions,[info.width,info.height]);assert.equal(plan.scaleAndOrientationInferred,true);close((plan.box.endX-plan.box.startX)/(plan.box.endY-plan.box.startY),aspect);close(plan.secondaryRepeatMeters.width/(f.secondaryUV[2]-f.secondaryUV[0]),width);close(plan.secondaryRepeatMeters.height/(f.secondaryUV[3]-f.secondaryUV[1]),height);close(face.cellBounds.startX,Math.min(.025,face.physicalDimensions.width*.1));const nativeFace=b.polygons.find(p=>p.id===face.id),minY=Math.min(...nativeFace.rings.flatMap(r=>r.points.map(v=>v[1])));close(face.cellBounds.startY-minY,Math.min(.025,face.physicalDimensions.height*.1));}
}
let triangles=0;const appliedOwnArt=new Set();
for(const n of doc.getRoot().listNodes()){
 const id=n.getExtras().buildingId;if(!id){for(const p of n.getMesh()?.listPrimitives()??[])assert(['road','display-base'].includes(p.getMaterial().getExtras().surfaceRole),'Unexpected unowned mesh; central must remain external');continue;}assert(selected.has(id)&&id!==central);assert.deepEqual(n.getTranslation(),[0,0,0]);assert.deepEqual(n.getScale(),[1,1,1]);assert.deepEqual(n.getRotation(),[0,0,0,1]);assert.equal(n.getParentNode(),null);const actual=seen.get(id)??new Map();seen.set(id,actual);
 for(const p of n.getMesh().listPrimitives()){
  const a=p.getAttribute('POSITION'),ix=p.getIndices().getArray(),arr=a.getArray();assert([...arr].every(Number.isFinite));
  for(let k=0;k<ix.length;k+=3){const key=triKey([0,1,2].map(j=>Array.from(arr.slice(ix[k+j]*3,ix[k+j]*3+3))));actual.set(key,(actual.get(key)||0)+1);triangles++;}
  const uv=p.getAttribute('TEXCOORD_0').getArray();assert([...uv].every(Number.isFinite));
  assert.equal(p.getMaterial().getAlphaMode(),'OPAQUE');assert.equal(p.getMaterial().getDoubleSided(),true);
  const material=p.getMaterial().getExtras(),profile=profiles.get(id);assert(profile);
  for(const [key,value]of Object.entries(materialSource(id)))assert.deepEqual(material[key],value,'Material source metadata differs: '+key);
  if(material.textured){assert.deepEqual(material.featureOneFace,profile.featureOneFace??null);assert.equal(material.featurePrimaryPolygonId,expectedFeaturePrimary.get(id)??null);if(profile.featureOneFace){const plan=expectedFeatureLayouts.get(id);assert(material.featureLayout);assert(Math.abs(material.featureLayout.artworkWidthMeters-plan.artworkWidthMeters)<1e-7);assert(Math.abs(material.featureLayout.artworkHeightMeters-plan.artworkHeightMeters)<1e-7);}else assert.equal(material.featureLayout,null);appliedOwnArt.add(id);assert.equal(material.artwork,profile.artwork);assert.equal(material.artworkMapping,artworkMappingFor(profile));assert.equal(material.facadeMode,profile.facadeMode??(!profile.windowAllowed?'full-closed-face':'physical-repeat'));assert(profile.artwork&&profile.evidenceStatus!=='insufficient');assert.equal(material.surfaceRole,'wall');if(material.windowAllowed)assert(profile.windowAllowed);assert([...uv].every(v=>v>=0&&v<=1));}
  else {assert.equal(material.buildingId,id,'Borrowed another building material');assert.deepEqual(material.baseColor,material.surfaceRole==='roof'?(profile.roofColor??[173,179,166]):profile.baseColor);assert.equal(material.windowAllowed,false);if(material.surfaceRole==='roof')assert.equal(material.colorBasis,profile.roofColor?profile.roofColorBasis:'code-native engineering roof default; no accepted own-photo appearance color');}
  const faces=n.getExtras().sourcePolygonIds.map(faceId=>reportedFaces.get(id+'|'+faceId));
  assert(faces.length>0&&faces.every(Boolean));assert(faces.every(f=>f.textured===material.textured),'Report and GLB artwork mapping differ');assert(faces.every(f=>f.windows===material.windowAllowed),'Report and GLB glazing differ');
 }
}
assert.equal(appliedOwnArt.size,82,'Every neighbor must actually use artwork in the GLB');
assert.equal(triangles,8040);assert.equal(report.neighborTriangles,8040);assert.equal(manifest.neighborTriangles,8040);
assert.equal(seen.size,selected.size-1);for(const [id,want]of expected)assert.deepEqual([...seen.get(id)].sort(),[...want].sort(),'Native geometry changed: '+id);
const semanticReport=report.polygons.filter(p=>p.windows&&(p.role!=='wall'||p.semantic?.installation||['RoofSurface','GroundSurface','BuildingInstallation'].includes(p.semantic?.type)));assert.equal(semanticReport.length,0);
assert.equal(report.ownArtworkBuildings,82);assert.equal(manifest.ownArtworkBuildings,82);assert.equal(manifest.existingArtworkPreserved,36);assert.equal(manifest.newInferenceArtworkBuildings,46);assert.equal(manifest.sourceChainIsFullCertification,false);
const artworkHashes=new Map();
for(const p of profiles.values())if(p.artwork)assert(report.polygons.some(f=>f.buildingId===p.buildingId&&f.textured),'Generated own artwork was not applied: '+p.buildingId);
for(const face of report.polygons){
 const p=profiles.get(face.buildingId);assert(p,'Missing profile');
 assert.deepEqual(face.profileEvidence,{evidenceStatus:p.evidenceStatus,sourcePaths:p.sourcePaths,observed:p.observed,inferred:p.inferred,windowAllowed:p.windowAllowed,baseColor:p.baseColor,roofColor:p.roofColor??null,roofColorBasis:p.roofColorBasis??null,masonrySideCap:p.masonrySideCap??null});
 assert.deepEqual(face.materialSource,materialSource(face.buildingId));
 assert(typeof face.inferredExtension==='string'&&face.inferredExtension.length>0);
 const native=buildings.get(face.buildingId).polygons.find(p=>p.id===face.id);assert(native);
 assert.deepEqual(face.semantic,semantics[face.id]??null,'Semantic evidence changed');
 if(face.buildingId==='bldg_6e9c9041-3a29-47ac-aaa3-28429eddcca2'&&face.role==='wall'){assert.equal(face.materialClassificationGap?.code,'NSglassClassificationGap');assert.equal(face.materialClassificationGap.confirmed,false);}
 assert.deepEqual(face.edgeClosure,{mode:'opaque-collar-all-source-rings',ringCount:native.rings.length,geometryChanged:false});
 assert.deepEqual(face.rings,native.rings.map(r=>r.id===undefined?{vertexCount:r.points.length}:{id:r.id,vertexCount:r.points.length}));
 if(!face.textured){assert.equal(face.windows,false);continue;}
 assert.equal(face.artworkMapping,artworkMappingFor(p));
 assert.equal(face.role,'wall');assert(!face.semantic?.installation&&!['RoofSurface','GroundSurface','BuildingInstallation'].includes(face.semantic?.type));
 assert(p.evidenceStatus!=='insufficient'&&p.artwork,'Forbidden artwork fallback');
 if(p.windowAllowed)assert.equal(face.windows,true,'Glazing artwork on a gated small face');
 else assert.equal(face.windows,false,'Opaque artwork must not enable glazing');
 assert.equal(face.artwork,p.artwork,'Artwork belongs to another building');
 if(!artworkHashes.has(p.artwork))artworkHashes.set(p.artwork,crypto.createHash('sha256').update(await fs.readFile(asset+'/'+p.artwork)).digest('hex'));
 assert.equal(face.artworkSha256,artworkHashes.get(p.artwork),'Artwork changed since build');
 if(!face.windows){const cell=face.cellBounds,d=face.physicalDimensions;assert(cell.startX>=0&&cell.endX>cell.startX&&cell.endX<=d.width);assert(cell.endY>cell.startY,'Opaque low face must retain artwork interior');continue;}
 assert(Number.isInteger(face.floors)&&face.floors>0&&Number.isInteger(face.bays)&&face.bays>0);
 const sideCap=p.masonrySideCap??(['bldg_9eabfa88-e9b7-402d-b38a-08a5f2544e21','bldg_89e585dc-50ee-485f-bed1-ce0101523b1e'].includes(face.buildingId)?3:.3);
 assert.equal(face.masonrySideCap.meters,sideCap);assert.equal(face.cellBounds.startX,sideCap);
 assert.equal(face.cellBounds.bayWidth,p.bayWidth);assert.equal(face.cellBounds.floorHeight,p.floorHeight);
 const building=buildings.get(face.buildingId),anchorY=building.min[1]+.28,cell=face.cellBounds;
 assert(Math.abs(cell.anchorY-anchorY)<1e-7,'Floor anchor must be shared by this building');
 assert(Number.isInteger(cell.startRow)&&Number.isInteger(cell.endRow));
 assert.equal(face.floors,cell.endRow-cell.startRow);
 assert(Math.abs(cell.startY-(anchorY+cell.startRow*p.floorHeight))<1e-7);
 assert(Math.abs(cell.endY-(anchorY+cell.endRow*p.floorHeight))<1e-7);
 const ys=native.rings.flatMap(r=>r.points.map(p=>p[1]));
 assert(cell.startY>=Math.min(...ys)+.28-1e-7&&cell.endY<=Math.max(...ys)-.28+1e-7,'Incomplete floor at wall end');
 assert(Math.abs(cell.phaseTopY-(anchorY+Math.floor((building.max[1]-.28-anchorY)/p.floorHeight+1e-9)*p.floorHeight))<1e-7,'Artwork floor phase must be shared by this building');
 assert(face.cellBounds.endX<=face.physicalDimensions.width-sideCap+1e-6);
 assert(face.floors*p.floorHeight<=face.physicalDimensions.height-.56+1e-6);
}
const roofAppearanceEvidence=[...profiles.values()].filter(p=>p.buildingId!==central).map(p=>({buildingId:p.buildingId,color:p.roofColor??[173,179,166],colorAppliedFromOwnProfile:p.roofColor!==undefined,colorBasis:p.roofColorBasis??'Code-native engineering roof default; no accepted own-photo appearance color',roofEvidence:p.roofEvidence??null,patternBasis:'Code-generated engineering seams/grain; no added photographed detail; not calibrated material/albedo'}));
assert.deepEqual(report.roofAppearanceEvidence,roofAppearanceEvidence);assert.deepEqual(manifest.roofAppearanceEvidence,roofAppearanceEvidence);
for(const r of roofAppearanceEvidence){
 if(!r.colorAppliedFromOwnProfile||!r.roofEvidence)continue;
 const e=r.roofEvidence;assert.equal(e.review.buildingId,r.buildingId);assert.equal(e.review.status,'reviewed');assert.equal(e.review.roofColorUsable,true);
 assert(buildings.get(r.buildingId).polygons.some(p=>p.id===e.polygonId));assert.equal(semantics[e.polygonId]?.type,'RoofSurface');
 assert.equal(crypto.createHash('sha256').update(await fs.readFile(e.photo.path)).digest('hex'),e.photo.sha256);assert.equal(e.review.photoSha256,e.photo.sha256);
}
const approvedCentral={path:'public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb',sha256:'36097e9604a487d6173052a3f49d1a87815af48fc809f40928df920693f259a6'};
const centralAsset=profileInput.centralAsset??approvedCentral;
assert(typeof centralAsset.path==='string'&&centralAsset.path.startsWith('public/'));
const centralRelative=path.relative(path.resolve('public'),path.resolve(centralAsset.path));
assert(centralRelative&&!centralRelative.startsWith('..')&&!path.isAbsolute(centralRelative));
assert(/^[a-f0-9]{64}$/.test(centralAsset.sha256));
assert.equal(crypto.createHash('sha256').update(await fs.readFile(centralAsset.path)).digest('hex'),centralAsset.sha256,'Central asset exact bytes changed');
assert.deepEqual(manifest.centralAsset,centralAsset);assert.deepEqual(report.centralAsset,centralAsset);
assert.deepEqual(manifest.centralApprovedAsset,centralAsset);assert.deepEqual(report.centralApprovedAsset,centralAsset);
const viewerCentral={url:'/'+path.relative('public',centralAsset.path).split(path.sep).join('/'),sha256:centralAsset.sha256,external:true};
assert.deepEqual(manifest.centralViewerAsset,viewerCentral);assert.deepEqual(report.centralViewerAsset,viewerCentral);
const result={passed:true,featureOneFaceBuildings:expectedFeaturePrimary.size,featureAspectPreserved:true,secondaryPhysicalTexelDensityPreserved:true,featureSmallEdgeCapsChecked:true,featurePrimaryPolygonIds:Object.fromEntries(expectedFeaturePrimary),buildingCount:selected.size,neighborBuildingCount:seen.size,neighborTriangles:triangles,allSelectedBuildingsPresent:true,allNativeTrianglesPresentExactlyOnce:true,centralConfiguredAssetExactBytes:true,centralExternal:true,centralAsset,ownArtworkBuildings:82,existingArtworkPreserved:36,newInferenceArtworkBuildings:46,sourceChainIsFullCertification:false,windowsOnEquipmentOrRoof:0,finiteWindowUVs:true,profileOwnershipChecked:true,profileEvidenceCounts:report.evidenceCounts,allBuildingsPhotoSourced:false,appearanceApproval:'requires actual rendering and user review',at:new Date().toISOString()};await fs.writeFile(dir+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
