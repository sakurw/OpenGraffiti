import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import sharp from 'sharp';
import {loadSnapCase} from './texture-snap-case.mjs';
import {triangulate,sub,cross} from './plateau-geometry.mjs';
import {quadrant} from './plateau-surfaces.mjs';

const input=await loadSnapCase();
const root='data/texture-city/registration';
const record=JSON.parse(await readFile(`${root}/${input.caseId}-surfaces.json`,'utf8'));
const textures=JSON.parse(await readFile(`${root}/${input.caseId}-rectified/report.json`,'utf8'));
const sourceManifest=JSON.parse(await readFile(`${root}/${input.caseId}-sources.json`,'utf8'));
const semanticManifest=JSON.parse(await readFile(`${root}/${input.caseId}-semantics.json`,'utf8'));
const geometry=JSON.parse(await readFile(input.geometryPath,'utf8'));
const building=geometry.buildings.find(item=>item.id===input.buildingId);
if(!building)throw Error('SNAP building is missing from PLATEAU geometry');
const {fit,surfaces}=record;
const source=JSON.parse(await readFile(`data/texture-city/photos/commons/${fit.sourceId}.json`,'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
if(fit.buildingId!==input.buildingId||fit.sourceId!==input.sourceId||fit.areaId!==input.areaId||textures.caseId!==input.caseId)throw Error('Stale SNAP case inputs');
if(fit.sourceSha256!==source.sha256||textures.sourceSha256!==source.sha256)throw Error('SNAP source mismatch');
if(sourceManifest.caseId!==input.caseId||sourceManifest.buildingId!==input.buildingId||!sourceManifest.paletteValidationPassed||!sourceManifest.duplicateAudit?.unique)throw Error('Source manifest quality gate failed');
if(semanticManifest.caseId!==input.caseId||semanticManifest.buildingId!==input.buildingId)throw Error('Semantic manifest does not match the SNAP case');
for(const item of sourceManifest.sources){const bytes=await readFile(`data/texture-city/photos/commons/${item.sourceId}.jpg`);if(sha256(bytes)!==item.sourceSha256)throw Error(`Source manifest hash mismatch: ${item.sourceId}`);}

const registrationBytes=await readFile(`${root}/${input.caseId}.json`);
const registrationSha256=createHash('sha256').update(registrationBytes).digest('hex');
let validation=null;
try{validation=JSON.parse(await readFile(`${root}/${input.caseId}-validation.json`,'utf8'));}catch(error){if(error?.code!=='ENOENT')throw error;}
const validationMatches=Boolean(validation&&validation.caseId===input.caseId&&validation.sourceSha256===source.sha256&&validation.registrationSha256===registrationSha256);
const independentlyValidated=Boolean(validationMatches&&validation.passed);
const registrationStatus=independentlyValidated?'estimated-held-out-validated':'estimated-unverified';
const output='public/assets/texture-poc/experimental/snap';
await mkdir(output,{recursive:true});

async function verifiedBytes(path,expected,label){const bytes=await readFile(path);if(sha256(bytes)!==expected)throw Error(`${label} hash mismatch`);return bytes;}
for(const group of textures.groups??[]){
 await verifiedBytes(group.texture,group.sha256,'SNAP albedo atlas');
 await verifiedBytes(group.rawTexture,group.rawSha256,'SNAP raw atlas');
 await verifiedBytes(group.inferredTexture,group.inferredSha256,'SNAP inferred tile');
}
for(const pattern of semanticManifest.facadePatterns??[])await verifiedBytes(pattern.semanticTexture,pattern.semanticSha256,'semantic facade tile');
for(const item of textures.textures??[])await verifiedBytes(item.texture,item.sha256,'SNAP surface texture');

const wallIds=new Set(building.walls.map(wall=>wall.id));
const areaOf=(points,indices)=>{let area=0;for(let i=0;i<indices.length;i+=3)area+=Math.hypot(...cross(sub(points[indices[i+1]],points[indices[i]]),sub(points[indices[i+2]],points[indices[i]])))/2;return area;};
const fullAreaByPolygon=new Map();
let fullWallArea=0,fullSurfaceArea=0,baseTriangleCount=0;
for(const polygon of building.polygons){
 const data=triangulate(polygon.rings.map(ring=>ring.points));
 if(!data.indices.length)continue;
 const area=areaOf(data.points,data.indices);fullAreaByPolygon.set(polygon.id,area);fullSurfaceArea+=area;baseTriangleCount+=data.indices.length/3;
 if(wallIds.has(polygon.id))fullWallArea+=area;
}
const observedArea=surfaces.reduce((sum,surface)=>sum+surface.area,0);
const observedAreaByPolygon=new Map();
for(const surface of surfaces)observedAreaByPolygon.set(surface.polygonId,(observedAreaByPolygon.get(surface.polygonId)??0)+surface.area);
const availableQuadrants=[...new Set(textures.groups.map(group=>group.quadrant))];
const circularDistance=(left,right)=>Math.min(Math.abs(left-right),4-Math.abs(left-right));
const nearestGroup=q=>textures.groups.filter(group=>availableQuadrants.includes(group.quadrant)).sort((a,b)=>circularDistance(q,a.quadrant)-circularDistance(q,b.quadrant))[0];
const groupByKey=new Map(textures.groups.map(group=>[group.groupKey,group]));
const semanticByPolygon=new Map(semanticManifest.polygons.map(item=>[item.polygonId,item]));
const patternByGroup=new Map(semanticManifest.facadePatterns.map(item=>[item.groupKey,item]));
const sameSurfaceExtensions=new Map();
for(const [polygonId,directArea] of observedAreaByPolygon){
 const semantic=semanticByPolygon.get(polygonId),fullArea=fullAreaByPolygon.get(polygonId)??0,ratio=fullArea?directArea/fullArea:0,metrics=semantic?.planExposureMetrics;
 if(independentlyValidated&&semantic?.semanticClass==='WallSurface'&&!semantic.facadePatternEligible&&metrics?.horizontalWidthMetres>=4.5&&directArea>=100&&ratio>=.25){
  sameSurfaceExtensions.set(polygonId,{polygonId,directObservedArea:directArea,fullSurfaceArea:fullArea,directObservedRatio:ratio,extendedArea:Math.max(0,fullArea-directArea),confidence:Math.min(.78,.62+ratio*.22),basis:'held-out-validated registered photo visibly covers at least 25% of this same WallSurface; extend its facade pattern only within this polygon'});
 }
}

async function inferredSolidColor(){
 const colors=[];
 for(const group of textures.groups){
  const stats=await sharp(group.inferredTexture).stats();
  colors.push(stats.channels.slice(0,3).map(channel=>channel.mean/255));
 }
 let mean=[0,1,2].map(channel=>colors.reduce((sum,color)=>sum+color[channel],0)/colors.length);
 const secondary=sourceManifest.sources.find(item=>item.paletteValidation?.passed)?.paletteValidation?.medianRgb;
 if(secondary)mean=mean.map((value,index)=>value*.82+secondary[index]*.18);
 const neutral=mean.reduce((sum,value)=>sum+value,0)/3;
 return mean.map(value=>Math.max(.08,Math.min(.78,(value*.55+neutral*.45)*.72)));
}
const solidSrgb=await inferredSolidColor();
const srgbToLinear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
const solidLinear=[...solidSrgb.map(srgbToLinear),1];
const asLinear=rgb=>[...rgb.map(value=>srgbToLinear(Math.max(0,Math.min(1,value)))),1];
const semanticColors={WallSurface:[.30,.55,.78],RoofSurface:[.90,.58,.20],GroundSurface:[.38,.40,.40],OuterBuildingInstallation:[.60,.40,.72],UnclassifiedSurface:[.65,.65,.65]};
const qualityColor=confidence=>{const value=Math.max(0,Math.min(1,confidence));return value<.5?[.82,.24,.18].map((start,index)=>start+([.95,.72,.20][index]-start)*(value/.5)):[.95,.72,.20].map((start,index)=>start+([.18,.67,.35][index]-start)*((value-.5)/.5));};
const blendColor=(left,right,leftWeight=.62)=>left.map((value,index)=>value*leftWeight+right[index]*(1-leftWeight));

function assignmentFor(polygon,data){
 const semantic=semanticByPolygon.get(polygon.id)??{semanticClass:'UnclassifiedSurface',semanticSubtype:'unresolved',semanticSource:'missing',semanticConfidence:.2,colorEvidence:'none',colorConfidence:.15};
 const isWall=wallIds.has(polygon.id),q=isWall?quadrant(data.normal):null,group=isWall?nearestGroup(q):null;
 if(isWall){
  const distance=circularDistance(q,group.quadrant),pattern=patternByGroup.get(group.groupKey),palette=semanticManifest.palettes[semantic.paletteKey];
  const direct=semantic.appearanceEvidence?.medianRgb,groupColor=palette?.renderRgb??palette?.medianRgb;
  const color=direct&&groupColor?blendColor(direct,groupColor):direct??groupColor??solidSrgb;
  const extension=sameSurfaceExtensions.get(polygon.id),effectiveFacadePatternEligible=Boolean(semantic.facadePatternEligible||extension);
  const applyPattern=Boolean(effectiveFacadePatternEligible&&pattern?.glazingBandDetected);
  if(applyPattern){
   const confidence=extension?.confidence??Math.max(distance===0?.52:.44,semantic.colorConfidence??0);
   const provenance=extension?'same-surface-observed-pattern-extension':'ground-photo-pattern-with-plateau-appearance-support';
   const colorEvidence=extension?'held-out-validated-photo-visible-region-extended-within-same-wall':'registered-ground-photo-pattern-with-direct-plateau-appearance-support';
   const effectiveWindowPatternPolicy=extension?'registered-photo-overrides-geometric-suppression-and-extends-within-same-wall':semantic.windowPatternPolicy;
   return {semantic,group,confidence,provenance,colorEvidence,directlyObserved:Boolean(direct),distance,pattern,applyPattern,color,effectiveFacadePatternEligible,effectiveWindowPatternPolicy,extension};
  }
  const confidence=direct?(semantic.colorConfidence??.62):groupColor?.5:.22;
  const provenance=direct?'plateau-appearance-solid-wall':groupColor?'same-facade-class-color-transfer':'semantic-class-prior-only';
  return {semantic,group,confidence,provenance,colorEvidence:semantic.colorEvidence,directlyObserved:Boolean(direct),distance,pattern:null,applyPattern:false,color,effectiveFacadePatternEligible:false,effectiveWindowPatternPolicy:semantic.windowPatternPolicy,extension:null};
 }
 const palette=semanticManifest.palettes[semantic.paletteKey];
 const hasDirect=Boolean(semantic.appearanceEvidence),hasGroup=Boolean(palette);
 const confidence=hasDirect?(semantic.colorConfidence??.64):hasGroup?.5:(semantic.colorConfidence??.22);
 const provenance=hasDirect?'plateau-appearance-robust-palette':hasGroup?'plateau-appearance-group-transfer':'semantic-class-prior-only';
 const fallback=semantic.semanticClass==='GroundSurface'?[.30,.31,.30]:solidSrgb;
 return {semantic,group:null,confidence,provenance,colorEvidence:semantic.colorEvidence,directlyObserved:hasDirect,distance:null,pattern:null,applyPattern:false,color:palette?.renderRgb??palette?.medianRgb??fallback,effectiveFacadePatternEligible:false,effectiveWindowPatternPolicy:null,extension:null};
}

function makeDocument(variant){
 const doc=new Document(),buffer=doc.createBuffer(),unlit=doc.createExtension(KHRMaterialsUnlit);
 const label=variant==='clean'?'Universal source-derived semantic building color':variant==='corrected'?'Albedo-normalized photo evidence overlay':variant==='raw'?'Raw photographic projection control':variant==='quality'?'Per-surface color-confidence view':variant==='semantic'?'PLATEAU semantic-class view':'PLATEAU geometry-only comparison';
 const scene=doc.createScene(label),materials=new Map();
 const accessor=(name,type,data)=>doc.createAccessor(name).setType(type).setArray(data).setBuffer(buffer);
 const geometryMaterial=doc.createMaterial('geometry-only').setBaseColorFactor([.68,.68,.68,1]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
 const colorMaterial=(key,rgb)=>{if(materials.has(key))return materials.get(key);const material=doc.createMaterial(key).setBaseColorFactor(asLinear(rgb)).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());materials.set(key,material);return material;};
 const materialFor=async(kind,group)=>{
  if(variant==='geometry')return geometryMaterial;
  const key=`${kind}:${group.groupKey}`;if(materials.has(key))return materials.get(key);
  const pattern=patternByGroup.get(group.groupKey);
  const path=kind==='observed'?(variant==='raw'?group.rawTexture:group.texture):(pattern?.semanticTexture??group.inferredTexture);
  const expected=kind==='observed'?(variant==='raw'?group.rawSha256:group.sha256):(pattern?.semanticSha256??group.inferredSha256);
  const texture=doc.createTexture(key).setImage(await verifiedBytes(path,expected,key)).setMimeType('image/png');
  const material=doc.createMaterial(key).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
  if(kind==='observed'){
   if(variant==='corrected')material.setAlphaMode('BLEND');
   else material.setAlphaMode('MASK').setAlphaCutoff(.5);
  }
  materials.set(key,material);return material;
 };
 const addPrimitive=async({name,positions,indices=null,uv=null,material,extras})=>{
  const primitive=doc.createPrimitive().setAttribute('POSITION',accessor(`${name}-positions`,'VEC3',new Float32Array(positions)));
  if(indices)primitive.setIndices(accessor(`${name}-indices`,'SCALAR',new Uint32Array(indices)));
  if(uv)primitive.setAttribute('TEXCOORD_0',accessor(`${name}-uv`,'VEC2',new Float32Array(uv)));
  primitive.setMaterial(material);
  const mesh=doc.createMesh(name).addPrimitive(primitive);
  scene.addChild(doc.createNode(name).setMesh(mesh).setExtras(extras));
 };
 return {doc,geometryMaterial,colorMaterial,materialFor,addPrimitive};
}

async function buildVariant(variant){
 const context=makeDocument(variant);
 for(const polygon of building.polygons){
  const data=triangulate(polygon.rings.map(ring=>ring.points));if(!data.indices.length)continue;
  const isWall=wallIds.has(polygon.id),assignment=assignmentFor(polygon,data),semantic=assignment.semantic;
  let material,uv=null;
  if(variant==='geometry')material=context.geometryMaterial;
  else if(variant==='quality')material=context.colorMaterial(`quality-${assignment.confidence.toFixed(2)}`,qualityColor(assignment.confidence));
  else if(variant==='semantic')material=context.colorMaterial(`semantic-${semantic.semanticClass}`,semanticColors[semantic.semanticClass]??semanticColors.UnclassifiedSurface);
  else if(isWall&&assignment.applyPattern){
   const group=assignment.group,tile=group.albedoMetrics.repeatTile;
   material=await context.materialFor('inferred',group);
   uv=data.points.flatMap(point=>{
    const groupU=point[0]*group.u[0]+point[1]*group.u[1]+point[2]*group.u[2];
    return [(groupU-group.lo[0])/tile.bayPeriodMetres,(group.hi[1]-point[1])/tile.floorPeriodMetres];
   });
  }else material=context.colorMaterial(`palette-${semantic.paletteKey}-${assignment.provenance}-${assignment.color.map(value=>value.toFixed(3)).join('-')}`,assignment.color);
  const extras={buildingId:fit.buildingId,polygonId:polygon.id,provenance:assignment.provenance,confidence:assignment.confidence,colorEvidence:assignment.colorEvidence,semanticClass:semantic.semanticClass,semanticSubtype:semantic.semanticSubtype,semanticSource:semantic.semanticSource,semanticConfidence:semantic.semanticConfidence,subtypeConfidence:semantic.subtypeConfidence,parentInstallationId:semantic.parentInstallationId,exactEquipmentTypeAvailable:semantic.exactEquipmentTypeAvailable,individualWindowGeometryAvailable:semantic.individualWindowGeometryAvailable,geometryFacadePatternEligible:Boolean(semantic.facadePatternEligible),facadePatternEligible:Boolean(assignment.effectiveFacadePatternEligible),windowPatternPolicy:assignment.effectiveWindowPatternPolicy,windowPatternPolicyConfidence:assignment.extension?.confidence??semantic.windowPatternPolicyConfidence,sameSurfaceExtension:assignment.extension,planExposureMetrics:semantic.planExposureMetrics,evidenceGroup:assignment.group?.groupKey,evidenceDirectionDistance:assignment.distance,facadeElementHypothesis:assignment.applyPattern?'periodic-glazing-band':assignment.effectiveWindowPatternPolicy??'unresolved',facadeElementConfidence:assignment.applyPattern?assignment.pattern?.facadeElements?.find(item=>item.class==='periodic-glazing-band')?.confidence:semantic.windowPatternPolicyConfidence,registration:registrationStatus};
  await context.addPrimitive({name:`base-${polygon.id}`,positions:data.points.flat(),indices:data.indices,uv,material,extras});
 }
 if(variant==='quality')for(const surface of surfaces){
  const semantic=semanticByPolygon.get(surface.polygonId),positions=surface.positions.map((value,index)=>value+surface.normal[index%3]*.04);
  await context.addPrimitive({name:`quality-observed-${surface.polygonId}`,positions,material:context.colorMaterial('quality-observed-photo',qualityColor(independentlyValidated?.86:.62)),extras:{buildingId:fit.buildingId,polygonId:surface.polygonId,provenance:'observed-photo-albedo-normalized',confidence:independentlyValidated?.86:.62,colorEvidence:'registered-ground-photo-direct-visible-region',semanticClass:semantic?.semanticClass,semanticSubtype:semantic?.semanticSubtype,semanticSource:semantic?.semanticSource,semanticConfidence:semantic?.semanticConfidence,subtypeConfidence:semantic?.subtypeConfidence,individualWindowGeometryAvailable:false,facadeElementHypothesis:'observed-photo-region',registration:registrationStatus}});
 }
 if(variant==='corrected'||variant==='raw')for(const surface of surfaces){
  const group=groupByKey.get(surface.groupKey);if(!group)throw Error('Missing SNAP direction atlas');
  const groupUv=[];
  for(let i=0;i<surface.positions.length;i+=3){
   const point=surface.positions.slice(i,i+3),u=point[0]*group.u[0]+point[1]*group.u[1]+point[2]*group.u[2];
   groupUv.push((u-group.lo[0])/group.width,(group.hi[1]-point[1])/group.height);
  }
  const positions=surface.positions.map((value,index)=>value+surface.normal[index%3]*.035);
  const material=await context.materialFor('observed',group);
  await context.addPrimitive({name:`observed-${surface.polygonId}`,positions,uv:groupUv,material,extras:{buildingId:fit.buildingId,polygonId:surface.polygonId,groupKey:surface.groupKey,provenance:variant==='raw'?'observed-photo-raw':'observed-photo-albedo-normalized',confidence:independentlyValidated?.86:.62,sourcePage:source.sourcePage,registration:registrationStatus}});
 }
 const sourceCredits=sourceManifest.sources.map(item=>`${item.author}, ${item.license}, ${item.sourcePage}`).join('; palette validation: ');
 const description=variant==='clean'?'source-derived semantic full-building color':variant==='corrected'?'illumination-normalized observed color plus semantic inference':variant==='raw'?'raw photo control plus semantic inference':variant==='quality'?'per-surface confidence visualization':variant==='semantic'?'CityGML semantic-class visualization':'geometry-only comparison generated from the exact full-building base triangles';
 const copyright=`PLATEAU / Tokyo 2025; photos © ${sourceCredits}; rectified with PLATEAU SNAP ${textures.snapCommit}; ${description} by OpenGraffiti.`;
 context.doc.getRoot().getAsset().copyright=copyright;
 return context.doc;
}

const cleanDoc=await buildVariant('clean');
const correctedDoc=await buildVariant('corrected');
const rawDoc=await buildVariant('raw');
const qualityDoc=await buildVariant('quality');
const semanticDoc=await buildVariant('semantic');
const geometryDoc=await buildVariant('geometry');
const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);
const model=`/assets/texture-poc/experimental/snap/${fit.caseId}.glb`;
const evidenceModel=`/assets/texture-poc/experimental/snap/${fit.caseId}-evidence.glb`;
const rawModel=`/assets/texture-poc/experimental/snap/${fit.caseId}-raw.glb`;
const qualityModel=`/assets/texture-poc/experimental/snap/${fit.caseId}-quality.glb`;
const semanticModel=`/assets/texture-poc/experimental/snap/${fit.caseId}-semantic.glb`;
const geometryModel=`/assets/texture-poc/experimental/snap/${fit.caseId}-geometry-only.glb`;
const sourcePreview=`/assets/texture-poc/experimental/snap/${fit.caseId}-source.jpg`;
const groundPhotoPreviews=sourceManifest.sources.map((item,index)=>({sourceId:item.sourceId,role:item.role,sourceKind:'ground-photo',url:index===0?sourcePreview:`/assets/texture-poc/experimental/snap/${fit.caseId}-source-${item.sourceId}.jpg`,author:item.author,license:item.license}));
const appearancePreviews=(semanticManifest.appearanceEvidence.sourceImages??[]).map((item,index)=>({sourceId:item.sourceId,role:item.role,sourceKind:'plateau-appearance',url:`/assets/texture-poc/experimental/snap/${fit.caseId}-${item.sourceId}.jpg`,author:'PLATEAU / Tokyo 2025',license:item.license,sourcePath:item.sourcePath,sourceSha256:item.sha256}));
const sourcePreviews=[...groundPhotoPreviews,...appearancePreviews];
await io.write('public'+model,cleanDoc);
await io.write('public'+evidenceModel,correctedDoc);
await io.write('public'+rawModel,rawDoc);
await io.write('public'+qualityModel,qualityDoc);
await io.write('public'+semanticModel,semanticDoc);
await io.write('public'+geometryModel,geometryDoc);
for(const preview of groundPhotoPreviews)await copyFile(`data/texture-city/photos/commons/${preview.sourceId}.jpg`,'public'+preview.url);
for(const preview of appearancePreviews){await verifiedBytes(preview.sourcePath,preview.sourceSha256,preview.role);await copyFile(preview.sourcePath,'public'+preview.url);}

const qualityBuckets=new Map(),surfaceQuality=[];
for(const polygon of building.polygons){
 const data=triangulate(polygon.rings.map(ring=>ring.points));if(!data.indices.length)continue;
 const area=areaOf(data.points,data.indices),assignment=assignmentFor(polygon,data),semantic=assignment.semantic;
 const bucket=qualityBuckets.get(assignment.provenance)??{provenance:assignment.provenance,polygonCount:0,area:0,confidenceArea:0};
 bucket.polygonCount++;bucket.area+=area;bucket.confidenceArea+=area*assignment.confidence;qualityBuckets.set(assignment.provenance,bucket);
  surfaceQuality.push({polygonId:polygon.id,area,provenance:assignment.provenance,colorConfidence:assignment.confidence,semanticClass:semantic.semanticClass,semanticSubtype:semantic.semanticSubtype,semanticConfidence:semantic.semanticConfidence,subtypeConfidence:semantic.subtypeConfidence,colorEvidence:assignment.colorEvidence,parentInstallationId:semantic.parentInstallationId,exactEquipmentTypeAvailable:semantic.exactEquipmentTypeAvailable,individualWindowGeometryAvailable:semantic.individualWindowGeometryAvailable,geometryFacadePatternEligible:Boolean(semantic.facadePatternEligible),facadePatternEligible:Boolean(assignment.effectiveFacadePatternEligible),windowPatternPolicy:assignment.effectiveWindowPatternPolicy,windowPatternPolicyConfidence:assignment.extension?.confidence??semantic.windowPatternPolicyConfidence,sameSurfaceExtension:assignment.extension,planExposureMetrics:semantic.planExposureMetrics});
}
const qualityByProvenance=[...qualityBuckets.values()].map(item=>({...item,meanConfidence:item.area?item.confidenceArea/item.area:0}));
qualityByProvenance.push({provenance:'observed-photo-albedo-normalized',polygonCount:surfaces.length,area:observedArea,confidenceArea:observedArea*(independentlyValidated?.86:.62),meanConfidence:independentlyValidated?.86:.62,overlaysInferredBase:true});
const weightedColorConfidence=qualityByProvenance.filter(item=>!item.overlaysInferredBase).reduce((sum,item)=>sum+item.confidenceArea,0)/fullSurfaceArea;
const sameSurfaceExtensionReport=[...sameSurfaceExtensions.values()];
const effectiveWallPatternCounts=surfaceQuality.filter(item=>item.semanticClass==='WallSurface').reduce((counts,item)=>{const key=item.facadePatternEligible?'eligible':item.windowPatternPolicy;counts[key]=(counts[key]??0)+1;return counts;},{});
const sameSurfaceExtendedArea=sameSurfaceExtensionReport.reduce((sum,item)=>sum+item.extendedArea,0);

const report={
 caseId:fit.caseId,areaId:fit.areaId,model,evidenceModel,rawModel,qualityModel,semanticModel,geometryModel,sourcePreview,sourcePreviews,projectedBuildings:1,registration:registrationStatus,
 method:`Full PLATEAU building color model: ground-photo facade pattern, same-WallSurface evidence extension, level-aware exterior-wall eligibility, CityGML semantic surfaces, stabilized PLATEAU appearance palettes, muted installation color, confidence-labeled inference, and optional held-out-validated photo evidence overlay${independentlyValidated?' with held-out structural-edge validation':''}`,
 snapCommit:textures.snapCommit,
 buildings:[{buildingId:fit.buildingId,projectedArea:observedArea,sourceIds:[fit.sourceId],outcome:'observed-plus-inferred-full-building-color',camera:{position:fit.cameraPosition},minimumHeight:record.minimumHeight}],
 sources:sourceManifest.sources.map(item=>({id:item.sourceId,url:item.sourcePage,author:item.author,license:item.license,sourceSha256:item.sourceSha256,role:item.role,confidence:item.confidence,registration:item.registration,paletteValidation:item.paletteValidation})),
 sourceCollection:sourceManifest.funnel,sourceDuplicateAudit:sourceManifest.duplicateAudit,sourcePolicy:sourceManifest.policy,
 camera:{position:fit.cameraPosition,rmsPixels:fit.rmsPixels,trainingPointRmsPixels:fit.trainingPointRmsPixels,heldOutPointRmsPixels:fit.heldOutPointRmsPixels,trainingLineResidualMedianPixels:fit.trainingLineResidualMedianPixels,heldOutLineResidualMedianPixels:fit.heldOutLineResidualMedianPixels,controls:fit.worldPoints.length,registrationMethod:fit.registration,cameraMatrix:fit.cameraMatrix,rotationVector:fit.rotationVector,accuracy:fit.accuracy||'Input-control residual only; no independent held-out accuracy measurement'},minimumHeight:record.minimumHeight,
 independentValidation:validationMatches?{method:validation.method,selectedIndependentEdges:validation.selectedIndependentEdges,medianAbsoluteOffsetPixels:validation.medianAbsoluteOffsetPixels,p90AbsoluteOffsetPixels:validation.p90AbsoluteOffsetPixels,maximumAbsoluteOffsetPixels:validation.maximumAbsoluteOffsetPixels,thresholds:validation.thresholds,passed:validation.passed,registrationSha256:validation.registrationSha256}:{passed:false,status:validation?'stale-registration-or-source':'missing'},
 colorCoverage:{fullBuildingSurfaceArea:fullSurfaceArea,fullWallArea,observedWallArea:observedArea,inferredWallArea:Math.max(0,fullWallArea-observedArea),observedWallRatio:fullWallArea?observedArea/fullWallArea:0,sameSurfaceExtendedArea,sameSurfaceExtensionPolygons:sameSurfaceExtensionReport.length,basePolygons:building.polygons.length,baseTriangles:baseTriangleCount,observedOverlayTriangles:surfaces.reduce((sum,surface)=>sum+surface.positions.length/9,0),weightedFullBuildingColorConfidence:weightedColorConfidence,evidenceExpandedCoverage:semanticManifest.evidenceExpandedCoverage,inferenceConfidence:{sameSurfaceObservedPatternExtension:[.62,.78],sameDirection:.52,secondaryPhotoSupportedDirection:.44,plateauAppearanceDirectRange:[.45,.8],plateauAppearanceGroupTransfer:.5,semanticPriorOnly:.22}},
 semanticEvidence:{buildingAttributes:semanticManifest.buildingAttributes,plateauSemantics:semanticManifest.plateauSemantics,sourceLimits:semanticManifest.sourceLimits,appearanceEvidence:semanticManifest.appearanceEvidence,evidenceExpandedCoverage:semanticManifest.evidenceExpandedCoverage,wallPatternEligibility:semanticManifest.wallPatternEligibility,effectiveWallPatternEligibility:{counts:effectiveWallPatternCounts,rule:'Geometric eligibility is the default. A held-out-validated registered photo covering at least 25% and 100 m² of the same WallSurface overrides geometric suppression only for that polygon.'},sameSurfaceExtensions:sameSurfaceExtensionReport,installationGroups:semanticManifest.installations.map(item=>({installationId:item.installationId,polygonCount:item.polygonCount,dimensionsMetres:item.dimensionsMetres,shapeHypothesis:item.shapeHypothesis,hypothesisConfidence:item.hypothesisConfidence,exactEquipmentTypeAvailable:item.exactEquipmentTypeAvailable,palette:semanticManifest.palettes[`installation:${item.installationId}`]})),facadePatterns:semanticManifest.facadePatterns.map(item=>({groupKey:item.groupKey,glazingBandDetected:item.glazingBandDetected,glazingBandContrastDeltaE76:item.glazingBandContrastDeltaE76,facadeElements:item.facadeElements,individualWindowsResolved:item.individualWindowsResolved})),polygonClassCounts:semanticManifest.plateauSemantics.polygonClassCounts},
 albedoNormalization:textures.albedoNormalization,
 textureAtlases:(textures.groups??[]).map(group=>({groupKey:group.groupKey,quadrant:group.quadrant,size:group.size,pixelsPerMetre:group.pixelsPerMetre,paintedPixelRatio:group.paintedPixelRatio,surfaceCount:group.surfaceCount,rawTexture:group.rawTexture,correctedTexture:group.texture,inferredTexture:group.inferredTexture,semanticTexture:patternByGroup.get(group.groupKey)?.semanticTexture,albedoMetrics:group.albedoMetrics})),
 qualityGates:{imageBorderPixels:record.imageBorder,minimumPixelsPerMetre:record.minimumPixelsPerMetre,borderRejected:record.borderRejected,occlusionRejected:record.occlusionRejected,imageRegionRejected:record.imageRegionRejected,resolutionRejected:record.resolutionRejected,acceptedOcclusionContradictions:record.acceptedOcclusionContradictions,maximumCorrectedDirectionalMedianDeltaE:10,minimumDetailEdgeCorrelation:.82,maximumClippedLuminanceRatio:.01,paletteValidationPassed:sourceManifest.paletteValidationPassed,sourceDuplicateAuditPassed:sourceManifest.duplicateAudit.unique,passed:Boolean(sourceManifest.paletteValidationPassed&&sourceManifest.duplicateAudit.unique&&textures.albedoNormalization?.correctedDirectionalMedianDeltaE<=10&&textures.groups.every(group=>group.albedoMetrics.detailEdgeCorrelation>=.82&&group.albedoMetrics.clippedLuminanceRatio<=.01))},
 ...(record.imageRegions?{imageRegions:record.imageRegions,imageRegionRejected:record.imageRegionRejected}:{}),
 polygons:surfaces.map(surface=>({polygonId:surface.polygonId,area:surface.area,triangles:surface.positions.length/9})),
 surfaceQuality,
 qualityByProvenance,
 provenanceClasses:[
  {id:'observed-photo-albedo-normalized',confidence:independentlyValidated?.86:.62,meaning:'optional held-out-validated camera projection with low-frequency illumination removal and cross-direction color harmonization'},
  {id:'same-surface-observed-pattern-extension',confidenceRange:[.62,.78],meaning:'a held-out-validated visible region is extended only over the unobserved remainder of the same WallSurface'},
  {id:'ground-photo-pattern-with-plateau-appearance-support',confidenceRange:[.52,.8],meaning:'repeated facade pattern is restricted to geometrically exposed walls; the wall appearance atlas supplies an independent color-support measurement'},
  {id:'plateau-appearance-solid-wall',confidenceRange:[.45,.8],meaning:'parapet, recessed or service wall receives stable solid color from its own PLATEAU appearance pixels without a window pattern'},
  {id:'plateau-appearance-robust-palette',confidenceRange:[.45,.8],meaning:'roof or installation color from PLATEAU appearance imagery after grouped robust-median reduction; installation chroma is muted for stable display'},
  {id:'plateau-appearance-group-transfer',confidence:.5,meaning:'same CityGML installation group palette transferred to a polygon without usable source pixels'},
  {id:'semantic-class-prior-only',confidence:.22,meaning:'surface class is known but no usable color observation exists'}
 ],
 warnings:[
  independentlyValidated?`Camera is fitted to manually read controls and passed held-out structural-edge validation (${validation.selectedIndependentEdges} edges, median ${validation.medianAbsoluteOffsetPixels}px, p90 ${validation.p90AbsoluteOffsetPixels}px); this is not survey-grade calibration.`:'Camera is manually estimated or fitted to manually read controls, not surveyed; source-to-wall alignment remains approximate.',
  `Direct registered ground-photo evidence covers ${(observedArea/fullWallArea*100).toFixed(1)}% of wall area. PLATEAU appearance directly supports ${semanticManifest.evidenceExpandedCoverage.directAppearancePolygons} polygons and same-object transfer supports ${semanticManifest.evidenceExpandedCoverage.sameSemanticObjectTransferredPolygons}; ${semanticManifest.evidenceExpandedCoverage.supportedPolygons}/${building.polygons.length} base polygons have image-derived color evidence.`,
  `${sameSurfaceExtensionReport.length} geometrically suppressed wall was overridden by held-out-validated evidence on that same polygon; ${sameSurfaceExtendedArea.toFixed(1)} m² outside the directly visible patch is filled with a separately labeled same-surface extension.`,
  `The widened Commons search produced ${sourceManifest.funnel.commons.discovered} candidates; two license-compatible exact-building images were acquired. One is geometrically registered and one independently validates the palette (ΔE76 ${sourceManifest.sources.find(item=>item.paletteValidation)?.paletteValidation.deltaE76ToRegisteredTarget.toFixed(1)}). KartaView produced ${sourceManifest.funnel.kartaview.discovered} candidates, but all ${sourceManifest.funnel.kartaview.shortlisted} audited frames were excluded: ${sourceManifest.funnel.kartaview.reason}`,
  `Window bands are deterministic image-pattern hypotheses applied to ${effectiveWallPatternCounts.eligible??0} facades: ${semanticManifest.wallPatternEligibility.counts.eligible??0} pass the geometric rule and ${sameSurfaceExtensionReport.length} additional same-WallSurface case passes the direct-evidence override. Remaining recessed, service, parapet and short walls stay suppressed; CityGML contains zero Window/Door opening polygons.`,
  'The two outer BuildingInstallation groups are explicit CityGML objects. Their exact equipment functions remain unresolved, so rendering preserves measured luminance while reducing chroma toward unobtrusive industrial neutral.',
  'Original image and PLATEAU geometry are unchanged.'
 ]
};
await mkdir(`${output}/cases`,{recursive:true});
await writeFile(`${output}/cases/${fit.caseId}.json`,JSON.stringify(report,null,2));
console.log({...report,polygons:report.polygons.length});
