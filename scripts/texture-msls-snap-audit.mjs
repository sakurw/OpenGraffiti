// Audit real GLB bytes against rectified source pixels and the complete catalog.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import sharp from 'sharp';
const area=process.argv[2];assert.ok(['tocho','tokyo-tower'].includes(area));
const root='data/texture-city/msls',hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(`${root}/snap-surfaces-${area}.json`),surfaces=JSON.parse(bytes),reportBytes=await readFile(`public/assets/texture-poc/experimental/snap-msls/${area}.json`),report=JSON.parse(reportBytes),rectified=JSON.parse(await readFile(`${root}/snap-rectified-${area}/report.json`,'utf8'));
assert.equal(report.inputSurfaceSha256,hash(bytes));assert.equal(rectified.surfaceRecordSha256,hash(bytes));
assert.equal(report.snapCommit,'d194f8891eddb965af1894e5cc6b67541ca7f307');
assert.equal(report.qualityGates?.acceptedOcclusionContradictions,0);assert.equal(surfaces.qualityGates?.acceptedOcclusionContradictions,0);
assert.match(report.visibilityPolicy??'',/continuous per-wall/);assert.match(rectified.visibilityPolicy??'',/continuous per-wall/);
assert.equal(rectified.rgbResamplingStagesToFinalAtlas,1);assert.match(rectified.rgbResamplingPolicy??'',/directly/);assert.match(rectified.cornerMappingPolicy??'',/bottom-left/);
const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8')),expected=catalog.buildings.filter(b=>b.areaId===area);
assert.equal(report.scope.kind,'all-buildings');assert.equal(report.totalBuildings,expected.length);
assert.deepEqual(report.coverage.map(b=>b.buildingId).sort(),expected.map(b=>b.id).sort());
if(!report.model){assert.equal(report.projectedBuildings,0);assert.equal(report.buildings.length,0);assert.equal(report.polygons.length,0);assert.equal(report.sources.length,0);assert.ok(report.coverage.every(b=>b.projectedArea===0));console.log({area,totalBuildings:expected.length,projectedBuildings:0,passed:true});process.exit(0);}
const modelBytes=await readFile('public'+report.model),doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit]).readBinary(modelBytes),byBuilding=new Map(),colors=[],sourceImages=new Map(),visibilityMasks=new Map(),provenanceByGroup=new Map();let triangles=0,directTransforms=0,orientationSignChanges=0,maxCornerReprojection=0;
const sourceMappingsFor=surface=>surface.sourceMappings??[{sourceId:surface.sourceId,imagePoints:surface.imagePoints,visibilityMask:surface.visibilityMask}];
const sourceIdsFor=surface=>sourceMappingsFor(surface).map(m=>m.sourceId);
const scalarPixel=(im,x,y)=>{x=Math.max(0,Math.min(im.info.width-1,Math.round(x)));y=Math.max(0,Math.min(im.info.height-1,Math.round(y)));return im.data[(y*im.info.width+x)*im.info.channels];};
const groupsBySurface=new Map();for(const group of rectified.groups??[]){
 for(const key of group.surfaceKeys??[]){assert.ok(!groupsBySurface.has(key),'Surface assigned to multiple texture planes');groupsBySurface.set(key,group);assert.ok(group.maxPlaneDeviationMetres<=rectified.planeClustering.offsetToleranceMetres+1e-9);assert.ok(group.maxNormalAngleDegrees<=rectified.planeClustering.normalToleranceDegrees+1e-9);}
 assert.ok(group.provenanceMap);const provenanceBytes=await readFile(group.provenanceMap.path);assert.equal(hash(provenanceBytes),group.provenanceMap.sha256);const provenance=await sharp(provenanceBytes).greyscale().raw().toBuffer({resolveWithObject:true});assert.deepEqual([provenance.info.width,provenance.info.height],group.size);provenanceByGroup.set(group.textureGroupKey,provenance);
 const counts=Object.fromEntries((group.sourceIds??[]).map(id=>[id,0]));for(let y=0;y<provenance.info.height;y++)for(let x=0;x<provenance.info.width;x++){const index=scalarPixel(provenance,x,y);if(!index)continue;const id=group.provenanceMap.indexToSourceId[index];assert.ok(id&&counts[id]!==undefined,'Unknown atlas provenance source');counts[id]++;}
 for(const id of group.sourceIds??[])assert.equal(counts[id],group.sourceUsagePixels?.[id]??0,'Atlas provenance usage count mismatch');
}
for(const s of report.sources){
 const photo=surfaces.photos.find(p=>p.id===s.id);assert.equal(s.sourceSha256,photo.sourceSha256);assert.equal(s.provider,'msls');
 assert.equal(hash(await readFile(`data/texture-city/photos/msls/${s.id}.jpg`)),s.sourceSha256);
 assert.equal(hash(await readFile(photo.alignmentSource)),s.alignmentSha256);assert.ok(photo.anchorErrorMetres<=10);
 const image=await readFile(photo.imagePath);assert.equal(hash(image),photo.imageSha256);
 sourceImages.set(s.id,await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true}));
}
const pixel=(im,x,y)=>{x=Math.max(0,Math.min(im.info.width-1,Math.round(x)));y=Math.max(0,Math.min(im.info.height-1,Math.round(y)));const offset=(y*im.info.width+x)*4;return Array.from(im.data.slice(offset,offset+4));};
const projectHomography=(h,[x,y])=>{const w=h[2][0]*x+h[2][1]*y+h[2][2];return [(h[0][0]*x+h[0][1]*y+h[0][2])/w,(h[1][0]*x+h[1][1]*y+h[1][2])/w];};
const checkTransform=transform=>{assert.deepEqual(transform.cornerOrder,['bottom-left','bottom-right','top-right','top-left']);assert.equal(transform.sourcePoints.length,4);assert.equal(transform.destinationPoints.length,4);for(let i=0;i<4;i++){const q=projectHomography(transform.homography,transform.sourcePoints[i]),d=transform.destinationPoints[i],error=Math.hypot(q[0]-d[0],q[1]-d[1]);assert.ok(error<=.051,'Semantic corner mapping drift');maxCornerReprojection=Math.max(maxCornerReprojection,error);}assert.ok(transform.cornerReprojectionMaxPixels<=.051);orientationSignChanges+=transform.orientationSignChanged?1:0;directTransforms++;};
for(const node of doc.getRoot().listNodes())if(node.getMesh()){
 const meta=node.getExtras(),surface=surfaces.surfaces.find(s=>s.key===node.getName()),textureRecord=rectified.textures.find(t=>t.key===node.getName()),group=groupsBySurface.get(node.getName());assert.ok(surface&&textureRecord&&group);
 const mappings=sourceMappingsFor(surface),sourceIds=sourceIdsFor(surface);assert.ok(mappings.length>0);assert.deepEqual(textureRecord.sourceIds,sourceIds);assert.deepEqual(meta.sourceIds,sourceIds);assert.equal(meta.sourceId,sourceIds[0]);
 for(const mapping of mappings){
  const photo=surfaces.photos.find(p=>p.id===mapping.sourceId);assert.ok(photo);assert.ok(photo.registeredBuildingIds?.includes(surface.buildingId),'Source is not locally registered to textured building');
  const visibility=mapping.visibilityMask;assert.ok(visibility);const visibilityBytes=await readFile(visibility.path);assert.equal(hash(visibilityBytes),visibility.sha256);assert.ok(visibility.visibleRatio>=0&&visibility.visibleRatio<=1);assert.ok(visibility.reasonCounts);assert.equal(hash(await readFile(visibility.reasonPath)),visibility.reasonSha256);assert.equal(Object.values(visibility.reasonCounts).reduce((a,b)=>a+b,0),visibility.geometryPixels);assert.equal(visibility.reasonCounts.visible,visibility.visiblePixels);
  if(!visibilityMasks.has(visibility.path))visibilityMasks.set(visibility.path,await sharp(visibilityBytes).greyscale().raw().toBuffer({resolveWithObject:true}));
  assert.equal(meta.sourceSha256s?.[mapping.sourceId],photo.sourceSha256);
 }
 assert.equal(textureRecord.rgbResamplingStages,1);assert.ok(textureRecord.finalAtlasPixelsPerMetre>0);assert.ok(textureRecord.sourceAreaPixelsPerMetreMinimum>0);assert.ok(textureRecord.sourceAreaPixelsPerMetreMedian>0);
 assert.deepEqual(textureRecord.transforms.map(t=>t.sourceId),sourceIds);for(const row of textureRecord.transforms)checkTransform(row.transform);
 assert.deepEqual(textureRecord.atlasTransforms.map(t=>t.sourceId),sourceIds);for(const row of textureRecord.atlasTransforms)checkTransform(row.transform);
 assert.equal(group.rgbResamplingStages,1);assert.ok(group.sourceAreaPixelsPerMetreMinimum>0);assert.ok(group.sourceAreaPixelsPerMetreMedian>0);
 assert.equal(meta.buildingId,surface.buildingId);assert.equal(meta.groupKey,surface.groupKey);assert.equal(meta.textureGroupKey,group.textureGroupKey);assert.equal(group.groupKey,surface.groupKey);assert.ok(sourceIds.every(id=>group.sourceIds.includes(id)));assert.equal(textureRecord.textureGroupKey,group.textureGroupKey);
 const primitives=node.getMesh().listPrimitives();assert.equal(primitives.length,1);const primitive=primitives[0],p=primitive.getAttribute('POSITION').getArray(),uv=primitive.getAttribute('TEXCOORD_0').getArray();
 assert.equal(primitive.getIndices(),null);assert.deepEqual(p,new Float32Array(surface.positions.map((v,i)=>v+surface.normal[i%3]*.025)));
 const expectedUv=[];for(let i=0;i<surface.positions.length;i+=3){const q=surface.positions.slice(i,i+3),u=q[0]*group.u[0]+q[1]*group.u[1]+q[2]*group.u[2];expectedUv.push((u-group.lo[0])/group.width,(group.hi[1]-q[1])/group.height);}assert.deepEqual(uv,new Float32Array(expectedUv));
 assert.equal(hash(await readFile(textureRecord.path)),textureRecord.sha256);assert.equal(primitive.getMaterial().getAlphaMode(),'MASK');const image=primitive.getMaterial().getBaseColorTexture().getImage();assert.equal(hash(image),group.sha256);
 const texture=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true}),provenance=provenanceByGroup.get(group.textureGroupKey);assert.ok(provenance);
 byBuilding.set(meta.buildingId,(byBuilding.get(meta.buildingId)||0)+surface.area);triangles+=p.length/9;
 const stride=Math.max(1,Math.ceil(p.length/9/100));
 for(let t=0;t<p.length/9;t+=stride){
  const xyz=[0,1,2].map(k=>(surface.positions[t*9+k]+surface.positions[t*9+k+3]+surface.positions[t*9+k+6])/3),tex=[0,1].map(k=>(uv[t*6+k]+uv[t*6+k+2]+uv[t*6+k+4])/3),surfaceUv=[0,1].map(k=>(surface.uv[t*6+k]+surface.uv[t*6+k+2]+surface.uv[t*6+k+4])/3);
  const b=pixel(texture,tex[0]*(texture.info.width-1),tex[1]*(texture.info.height-1));if(b[3]<128)continue;
  const sourceIndex=scalarPixel(provenance,tex[0]*(provenance.info.width-1),tex[1]*(provenance.info.height-1)),sourceId=group.provenanceMap.indexToSourceId[sourceIndex];assert.ok(sourceId,'Painted atlas pixel lacks provenance');const mapping=mappings.find(row=>row.sourceId===sourceId);assert.ok(mapping,'Atlas provenance is not valid for this wall');
  const visibility=visibilityMasks.get(mapping.visibilityMask.path);assert.ok(scalarPixel(visibility,surfaceUv[0]*(visibility.info.width-1),surfaceUv[1]*(visibility.info.height-1))>=128,'Atlas provenance points to a source invalid at this wall pixel');
  const photo=surfaces.photos.find(p=>p.id===sourceId),source=sourceImages.get(sourceId);assert.ok(photo&&source);const v=photo.camFromWorld.map(r=>r[0]*xyz[0]+r[1]*xyz[1]+r[2]*xyz[2]+r[3]),k=photo.cameraMatrix,q=[k[0][0]*v[0]/v[2]+k[0][2],k[1][1]*v[1]/v[2]+k[1][2]];
  const a=pixel(source,...q);
  colors.push((Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3);
 }
}
assert.deepEqual([...byBuilding.keys()].sort(),report.buildings.map(b=>b.buildingId).sort());assert.equal(report.projectedBuildings,byBuilding.size);
for(const row of report.coverage){const area=byBuilding.get(row.buildingId)||0;assert.ok(Math.abs(area-row.projectedArea)<1e-6);assert.ok(area<=expected.find(b=>b.id===row.buildingId).wallArea+.01);}
colors.sort((a,b)=>a-b);const median=colors[Math.floor(colors.length/2)];assert.ok(colors.length>0);assert.ok(median<25,'Rectified source pixel correspondence failed');
const result={area,modelSha256:hash(modelBytes),reportSha256:hash(reportBytes),totalBuildings:expected.length,projectedBuildings:byBuilding.size,triangles,sourceColorSamples:colors.length,medianSourceColorError:median,p95SourceColorError:colors[Math.floor(colors.length*.95)],
 textureAtlases:rectified.groups?.length??0,directTransforms,orientationSignChanges,maxCornerReprojectionPixels:maxCornerReprojection,rgbResamplingStagesToFinalAtlas:rectified.rgbResamplingStagesToFinalAtlas,acceptedOcclusionContradictions:report.qualityGates.acceptedOcclusionContradictions,
 note:'Verifies artifact, one-stage direct source-to-atlas RGB mapping, semantic corner correspondence, coplanar physical-plane atlas UVs, pixel provenance, local building-registration membership, visibility-mask validity and source pixel correspondence; NOT surveyed camera accuracy, complete facade restoration or independent capture.'};
await writeFile(`${root}/snap-audit-${area}.json`,JSON.stringify(result,null,2));console.log(result);
