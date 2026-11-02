// Actual comparison GLB. Failed rectifications are not counted as applied.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {sub,cross} from './plateau-geometry.mjs';
const area=process.argv[2];if(!['tocho','tokyo-tower'].includes(area))throw Error('Specify area');
const bytes=await readFile(`data/texture-city/kartaview/snap-surfaces-${area}.json`),record=JSON.parse(bytes),textures=JSON.parse(await readFile(`data/texture-city/kartaview/snap-rectified-${area}/report.json`,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');if(textures.surfaceRecordSha256!==hash(bytes)||record.areaId!==area||textures.areaId!==area)throw Error('Stale rectified surfaces');
const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('KartaView + official SNAP / SfM provisional registration'),unlit=doc.createExtension(KHRMaterialsUnlit),buildings=new Map(),usedSources=new Set(),polygons=[];
const acc=(type,values)=>doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
for(const surface of record.surfaces){
 const item=textures.textures.find(t=>t.key===surface.key);if(!item)continue;
 const image=await readFile(item.path);if(hash(image)!==item.sha256||item.sourceId!==surface.sourceId||item.buildingId!==surface.buildingId)throw Error('SNAP texture identity mismatch');
 const photo=record.photos.find(p=>p.id===surface.sourceId);if(!photo)throw Error('Missing source');
 const texture=doc.createTexture(surface.key).setImage(image).setMimeType('image/png');
 const material=doc.createMaterial().setBaseColorTexture(texture).setAlphaMode('MASK').setAlphaCutoff(.5).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
 const primitive=doc.createPrimitive().setMaterial(material).setAttribute('POSITION',acc('VEC3',surface.positions.map((v,i)=>v+surface.normal[i%3]*.025))).setAttribute('TEXCOORD_0',acc('VEC2',surface.uv));
 scene.addChild(doc.createNode(surface.key).setMesh(doc.createMesh(surface.key).addPrimitive(primitive)).setExtras({buildingId:surface.buildingId,polygonId:surface.polygonId,sourceId:photo.id,sourceSha256:photo.sourceSha256,registration:'estimated-unverified'}));
 if(!buildings.has(surface.buildingId))buildings.set(surface.buildingId,{buildingId:surface.buildingId,projectedArea:0,sourceIds:[photo.id],camera:{position:photo.position,target:[0,0,0]},outcome:'partially-projected'});
 for(let i=0;i<surface.positions.length;i+=9){const t=[0,3,6].map(j=>surface.positions.slice(i+j,i+j+3)),area=Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;for(let k=0;k<3;k++)buildings.get(surface.buildingId).camera.target[k]+=area*(t[0][k]+t[1][k]+t[2][k])/3;}
 buildings.get(surface.buildingId).projectedArea+=surface.area;usedSources.add(photo.id);polygons.push({buildingId:surface.buildingId,polygonId:surface.polygonId,sourceId:photo.id,area:surface.area,triangles:surface.positions.length/9});
}
const sources=record.photos.filter(p=>usedSources.has(p.id)).map(p=>({id:p.id,url:p.sourcePage,author:p.author,license:p.license,sourceSha256:p.sourceSha256,provider:p.provider,independence:p.independence,anchorErrorMetres:p.anchorErrorMetres,alignmentSource:p.alignmentSource,alignmentSha256:p.alignmentSha256}));
for(const b of buildings.values())b.camera.target=b.camera.target.map(v=>v/b.projectedArea);
doc.getRoot().getAsset().copyright='PLATEAU / Tokyo 2025; © Grab and KartaView Contributors, CC-BY-SA-4.0; '+sources.map(p=>p.url).join('; ')+`; PLATEAU SNAP ${textures.snapCommit}; undistortion and provisional SfM projection by OpenGraffiti`;
const output='public/assets/texture-poc/experimental/snap-sfm';await mkdir(output,{recursive:true});
const model=buildings.size?`/assets/texture-poc/experimental/snap-sfm/${area}.glb`:'';
if(model)await new NodeIO().registerExtensions([KHRMaterialsUnlit]).write('public'+model,doc);
const report={areaId:area,model,totalBuildings:record.totalBuildings,scope:{kind:'all-buildings'},projectedBuildings:buildings.size,registration:buildings.size?'estimated-unverified':'not-applied',method:'KartaView ground photos, SfM cameras, GPS/road-height alignment, official SNAP rectification',snapCommit:textures.snapCommit,
 buildings:[...buildings.values()],sources,polygons,coverage:record.buildings.map(b=>({...b,projectedArea:buildings.get(b.buildingId)?.projectedArea||0,outcome:buildings.has(b.buildingId)?'partially-projected':'not-applied'})),
 failedRectifications:textures.failures,inputSurfaceSha256:hash(bytes),warnings:['Provisional alignment and semantic masks; not verified wall identity.','KartaView/Mapillary capture independence is unverified.','Original source photographs, existing SNAP/Mapillary models and artwork are unchanged.']};
await writeFile(`${output}/${area}.json`,JSON.stringify(report,null,2));console.log({area,projectedBuildings:buildings.size,surfaces:polygons.length,sources:sources.length,model});
