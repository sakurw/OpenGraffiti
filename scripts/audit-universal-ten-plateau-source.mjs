import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {SaxesParser} from 'saxes';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {triangulate} from './plateau-geometry.mjs';

const selection=JSON.parse(await readFile('scripts/universal-ten-building-selection.json','utf8'));
const geometry=JSON.parse(await readFile(selection.geometryPath,'utf8'));
const reportPath='public/assets/universal-ten-building/report.json';
const report=JSON.parse(await readFile(reportPath,'utf8'));
const datasetRoot=path.dirname(selection.geometryPath);
const gmlPath=selection.cityGmlPath;
const selectedBuildings=new Map(selection.buildings.map(item=>[item.buildingId,geometry.buildings.find(building=>building.id===item.buildingId)]));
const selectedPolygons=new Map();
for(const [buildingId,building] of selectedBuildings){
 if(!building)throw Error(`Selected PLATEAU building is absent: ${buildingId}`);
 for(const polygon of building.polygons)selectedPolygons.set(polygon.id,{buildingId,building,polygon});
}

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const attribute=(tag,name)=>{const value=tag.attributes?.[name];return typeof value==='object'&&value?value.value:value;};
const sourceMappings=new Map();
let parameterizedTexture=null,targetId=null,capture=null;
const parser=new SaxesParser({xmlns:false});
parser.on('opentag',tag=>{
 if(tag.name==='app:ParameterizedTexture'){parameterizedTexture={image:null};return;}
 if(!parameterizedTexture)return;
 if(tag.name==='app:imageURI'){capture={kind:'image',text:''};return;}
 if(tag.name==='app:target'){targetId=String(attribute(tag,'uri')??'').replace(/^#/,'');return;}
 if(tag.name==='app:textureCoordinates'&&targetId&&selectedPolygons.has(targetId))capture={kind:'uv',targetId,ringId:String(attribute(tag,'ring')??'').replace(/^#/,''),text:''};
});
parser.on('text',text=>{if(capture)capture.text+=text;});
parser.on('closetag',tag=>{
 const name=typeof tag==='string'?tag:tag.name;
 if(name==='app:imageURI'&&capture?.kind==='image'){parameterizedTexture.image=capture.text.trim();capture=null;return;}
 if(name==='app:textureCoordinates'&&capture?.kind==='uv'){
  const values=capture.text.trim().split(/\s+/).filter(Boolean).map(Number),existing=sourceMappings.get(capture.targetId)??{image:parameterizedTexture.image,rings:{}};
  if(existing.image!==parameterizedTexture.image)throw Error(`Multiple PLATEAU source images target ${capture.targetId}`);
  existing.rings[capture.ringId]=values;sourceMappings.set(capture.targetId,existing);capture=null;return;
 }
 if(name==='app:target')targetId=null;
 if(name==='app:ParameterizedTexture'){parameterizedTexture=null;targetId=null;capture=null;}
});
parser.write(await readFile(gmlPath,'utf8')).close();

const manifests=[];
for(const name of await readdir(datasetRoot))if(/^download-.*\.json$/i.test(name))manifests.push(JSON.parse(await readFile(path.join(datasetRoot,name),'utf8')));
const manifestFiles=new Map(manifests.flatMap(manifest=>(manifest.files??[]).map(file=>[file.path.replaceAll('\\','/'),{...file,archiveUrl:manifest.url}])));
const gmlRelative=path.relative(datasetRoot,gmlPath).replaceAll('\\','/'),gmlManifest=manifestFiles.get(gmlRelative),gmlBytes=await readFile(gmlPath),gmlSha256=hash(gmlBytes);
if(!gmlManifest||gmlManifest.sha256!==gmlSha256)throw Error('The local CityGML does not match its PLATEAU download manifest');

const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);
let polygonCount=0,mappedPolygons=0,modelTexturedPolygons=0,imageByteMatches=0,manifestImageMatches=0,indexMismatches=0,missingMappings=0,maxPositionError=0,maxUvError=0;
const uniqueImages=new Map();
for(const item of selection.buildings){
 const building=selectedBuildings.get(item.buildingId),center=[0,1,2].map(axis=>(building.min[axis]+building.max[axis])/2),translation=[center[0],building.min[1],center[2]],modelPath=`public/assets/universal-ten-building/building-${String(item.ordinal).padStart(2,'0')}-plateau-appearance.glb`,document=await io.read(modelPath),nodes=new Map(document.getRoot().listNodes().filter(node=>node.getExtras()?.polygonId).map(node=>[node.getExtras().polygonId,node]));
 for(const polygon of building.polygons){
  polygonCount++;const node=nodes.get(polygon.id);if(!node)throw Error(`Baseline GLB is missing ${polygon.id}`);
  const primitive=node.getMesh()?.listPrimitives()[0],position=primitive?.getAttribute('POSITION'),indices=primitive?.getIndices(),shape=triangulate(polygon.rings.map(ring=>ring.points));
  if(!position||!indices)throw Error(`Baseline GLB geometry is incomplete: ${polygon.id}`);
  const modelPositions=position.getArray();for(let index=0;index<shape.points.length;index++)for(let axis=0;axis<3;axis++)maxPositionError=Math.max(maxPositionError,Math.abs(modelPositions[index*3+axis]-(shape.points[index][axis]-translation[axis])));
  const modelIndices=indices.getArray();if(modelIndices.length!==shape.indices.length||modelIndices.some((value,index)=>value!==shape.indices[index]))indexMismatches++;
  const source=sourceMappings.get(polygon.id),geometryTexture=geometry.textures?.[polygon.id],modelTexture=primitive.getMaterial()?.getBaseColorTexture(),modelUv=primitive.getAttribute('TEXCOORD_0');
  if(!source){
   if(geometryTexture||modelTexture||modelUv)missingMappings++;
   continue;
  }
  mappedPolygons++;
  if(!geometryTexture||geometryTexture.image!==source.image)throw Error(`Geometry extraction changed the PLATEAU image reference: ${polygon.id}`);
  const expectedUv=[];
  for(const ring of polygon.rings){
   const gmlValues=source.rings[ring.id],jsonValues=geometryTexture.rings?.[ring.id];
   if(!gmlValues||!jsonValues||gmlValues.length<ring.points.length*2||jsonValues.length<ring.points.length*2)throw Error(`PLATEAU UV ring is incomplete: ${ring.id}`);
   for(let index=0;index<ring.points.length*2;index++)if(Math.abs(gmlValues[index]-jsonValues[index])>1e-12)throw Error(`Geometry extraction changed PLATEAU UV values: ${ring.id}`);
   for(let index=0;index<ring.points.length;index++)expectedUv.push(gmlValues[index*2],1-gmlValues[index*2+1]);
  }
  if(!modelTexture||!modelUv)throw Error(`Baseline GLB did not retain the PLATEAU texture: ${polygon.id}`);
  modelTexturedPolygons++;const modelUvValues=modelUv.getArray();if(modelUvValues.length!==expectedUv.length)throw Error(`Baseline GLB UV length changed: ${polygon.id}`);
  for(let index=0;index<expectedUv.length;index++)maxUvError=Math.max(maxUvError,Math.abs(modelUvValues[index]-expectedUv[index]));
  if(node.getExtras().sourceImage!==source.image)throw Error(`Baseline GLB provenance changed: ${polygon.id}`);
  const sourcePath=path.join(datasetRoot,'udx','bldg',...source.image.split('/')),sourceBytes=await readFile(sourcePath),sourceHash=hash(sourceBytes),embeddedBytes=modelTexture.getImage(),embeddedHash=hash(embeddedBytes),manifestPath=`udx/bldg/${source.image}`,manifest=manifestFiles.get(manifestPath);
  if(embeddedHash!==sourceHash)throw Error(`Baseline GLB image bytes changed: ${source.image}`);imageByteMatches++;
  if(!manifest||manifest.sha256!==sourceHash)throw Error(`PLATEAU image does not match its download manifest: ${source.image}`);manifestImageMatches++;
  uniqueImages.set(source.image,{sha256:sourceHash,bytes:sourceBytes.length,manifestSha256:manifest.sha256});
 }
}

const passed=polygonCount===selectedPolygons.size&&mappedPolygons===sourceMappings.size&&modelTexturedPolygons===mappedPolygons&&!missingMappings&&!indexMismatches&&maxPositionError<=.0001&&maxUvError<=1e-6;
if(!passed)throw Error('PLATEAU source identity audit failed');
const audit={status:'source-identical',auditedAt:new Date().toISOString(),source:{datasetId:'plateau-13104-shinjuku-ku-2025',officialArchiveUrl:gmlManifest.archiveUrl,cityGml:gmlRelative,cityGmlBytes:gmlBytes.length,cityGmlSha256:gmlSha256,manifestSha256:gmlManifest.sha256},scope:{buildings:selection.buildings.length,polygons:polygonCount,mappedPolygons,unmappedPolygons:polygonCount-mappedPolygons,uniqueSourceImages:uniqueImages.size},checks:{cityGmlManifestMatch:true,polygonImageReferencesMatch:true,uvValuesMatch:true,embeddedImageBytesMatch:true,textureManifestMatch:true,geometryMatches:true,indexMismatches,missingMappings,imageByteMatches,manifestImageMatches,maxPositionError,maxUvError,arbitraryImagesApplied:0},images:Object.fromEntries(uniqueImages)};
await writeFile('public/assets/universal-ten-building/plateau-source-audit.json',JSON.stringify(audit,null,2));
await writeFile('test-results/universal-ten-building-plateau-source-audit.json',JSON.stringify(audit,null,2));
report.plateauSourceAudit={status:audit.status,path:'/assets/universal-ten-building/plateau-source-audit.json',cityGmlSha256:gmlSha256,mappedPolygons,uniqueSourceImages:uniqueImages.size,arbitraryImagesApplied:0};
await writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(audit,null,2));
