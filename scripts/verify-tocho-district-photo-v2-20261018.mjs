import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {triangulate} from './plateau-geometry.mjs';
const scopeDir='data/texture-city/tocho-district-illustrated-20261018',dir='data/texture-city/tocho-district-photo-v2-20261018',asset='public/assets/tocho-district-photo-v2-20261018';
const scope=JSON.parse(await fs.readFile(scopeDir+'/scope.json','utf8')),report=JSON.parse(await fs.readFile(dir+'/build-report.json','utf8')),manifest=JSON.parse(await fs.readFile(asset+'/manifest.json','utf8'));
const profileBytes=await fs.readFile(asset+'/photo-profiles.json'),profiles=new Map(JSON.parse(profileBytes).buildings.map(p=>[p.buildingId,p]));
assert.equal(crypto.createHash('sha256').update(profileBytes).digest('hex'),report.profileSha256,'Profiles changed since build');
assert.equal(crypto.createHash('sha256').update(await fs.readFile(asset+'/district.glb')).digest('hex'),report.sha256,'GLB changed since build');
const selected=new Set(scope.selectedBuildingIds),central='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
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
let triangles=0;
for(const n of doc.getRoot().listNodes()){
 const id=n.getExtras().buildingId;if(!id)continue;assert(selected.has(id)&&id!==central);assert.deepEqual(n.getTranslation(),[0,0,0]);assert.deepEqual(n.getScale(),[1,1,1]);const actual=seen.get(id)??new Map();seen.set(id,actual);
 for(const p of n.getMesh().listPrimitives()){
  const a=p.getAttribute('POSITION'),ix=p.getIndices().getArray(),arr=a.getArray();assert([...arr].every(Number.isFinite));
  for(let k=0;k<ix.length;k+=3){const key=triKey([0,1,2].map(j=>Array.from(arr.slice(ix[k+j]*3,ix[k+j]*3+3))));actual.set(key,(actual.get(key)||0)+1);triangles++;}
  const uv=p.getAttribute('TEXCOORD_0').getArray();assert([...uv].every(Number.isFinite));
  const material=p.getMaterial().getExtras(),profile=profiles.get(id);assert(profile);
  if(material.textured){assert(profile.artwork&&profile.evidenceStatus!=='insufficient');assert.equal(material.surfaceRole,'wall');if(material.windowAllowed)assert(profile.windowAllowed);assert([...uv].every(v=>v>=0&&v<=1));}
  else {assert.equal(material.buildingId,id,'Borrowed another building material');assert.deepEqual(material.baseColor,material.surfaceRole==='roof'?(profile.roofColor??[173,179,166]):profile.baseColor);assert.equal(material.windowAllowed,false);if(material.surfaceRole==='roof')assert.equal(material.colorBasis,profile.roofColor?profile.roofColorBasis:'code-native engineering roof default; no accepted own-photo appearance color');}
  const faces=n.getExtras().sourcePolygonIds.map(faceId=>reportedFaces.get(id+'|'+faceId));
  assert(faces.length>0&&faces.every(Boolean));assert(faces.every(f=>f.textured===material.textured),'Report and GLB artwork mapping differ');assert(faces.every(f=>f.windows===material.windowAllowed),'Report and GLB glazing differ');
 }
}
assert.equal(seen.size,selected.size-1);for(const [id,want]of expected)assert.deepEqual([...seen.get(id)].sort(),[...want].sort(),'Native geometry changed: '+id);
const semanticReport=report.polygons.filter(p=>p.windows&&(p.role!=='wall'||p.semantic?.installation||['RoofSurface','GroundSurface','BuildingInstallation'].includes(p.semantic?.type)));assert.equal(semanticReport.length,0);
const artworkHashes=new Map();
for(const p of profiles.values())if(p.artwork)assert(report.polygons.some(f=>f.buildingId===p.buildingId&&f.textured),'Generated own artwork was not applied: '+p.buildingId);
for(const face of report.polygons){
 const p=profiles.get(face.buildingId);assert(p,'Missing profile');
 assert.deepEqual(face.profileEvidence,{evidenceStatus:p.evidenceStatus,sourcePaths:p.sourcePaths,observed:p.observed,inferred:p.inferred,windowAllowed:p.windowAllowed,baseColor:p.baseColor,roofColor:p.roofColor??null,roofColorBasis:p.roofColorBasis??null,masonrySideCap:p.masonrySideCap??null});
 assert(typeof face.inferredExtension==='string'&&face.inferredExtension.length>0);
 const native=buildings.get(face.buildingId).polygons.find(p=>p.id===face.id);assert(native);
 assert.deepEqual(face.semantic,semantics[face.id]??null,'Semantic evidence changed');
 if(face.buildingId==='bldg_6e9c9041-3a29-47ac-aaa3-28429eddcca2'&&face.role==='wall'){assert.equal(face.materialClassificationGap?.code,'NSglassClassificationGap');assert.equal(face.materialClassificationGap.confirmed,false);}
 assert.deepEqual(face.rings,native.rings.map(r=>r.id===undefined?{vertexCount:r.points.length}:{id:r.id,vertexCount:r.points.length}));
 if(!face.textured){assert.equal(face.windows,false);continue;}
 assert.equal(face.role,'wall');assert(!face.semantic?.installation&&!['RoofSurface','GroundSurface','BuildingInstallation'].includes(face.semantic?.type));
 assert(p.evidenceStatus!=='insufficient'&&p.artwork,'Forbidden artwork fallback');
 if(p.windowAllowed)assert.equal(face.windows,true,'Glazing artwork on a gated small face');
 else assert.equal(face.windows,false,'Opaque artwork must not enable glazing');
 assert.equal(face.artwork,p.artwork,'Artwork belongs to another building');
 if(!artworkHashes.has(p.artwork))artworkHashes.set(p.artwork,crypto.createHash('sha256').update(await fs.readFile(asset+'/'+p.artwork)).digest('hex'));
 assert.equal(face.artworkSha256,artworkHashes.get(p.artwork),'Artwork changed since build');
 if(!face.windows)continue;
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
const centralFile='public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb',centralHash=crypto.createHash('sha256').update(await fs.readFile(centralFile)).digest('hex');assert.equal(centralHash,'36097e9604a487d6173052a3f49d1a87815af48fc809f40928df920693f259a6');
const result={passed:true,buildingCount:selected.size,neighborBuildingCount:seen.size,neighborTriangles:triangles,allSelectedBuildingsPresent:true,allNativeTrianglesPresentExactlyOnce:true,centralApprovedAssetUnchanged:true,windowsOnEquipmentOrRoof:0,finiteWindowUVs:true,profileOwnershipChecked:true,profileEvidenceCounts:report.evidenceCounts,allBuildingsPhotoSourced:false,appearanceApproval:'requires actual rendering and user review',at:new Date().toISOString()};await fs.writeFile(dir+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
