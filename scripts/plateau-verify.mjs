import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {bakeWall,overlayGeometry} from '../server/wall-bake.mjs';
import {dot,sub,triangulate} from './plateau-geometry.mjs';
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8')),root='public/assets/datasets/'+catalog.datasetVersion,manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
for(const f of manifest.files){const b=await readFile(root+'/'+f.path);assert.equal(b.length,f.bytes,f.path);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256,f.path);}
await MeshoptDecoder.ready;const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit]).registerDependencies({'meshopt.decoder':MeshoptDecoder}),allIds=new Set(catalog.walls.map(w=>w.id)),pickIds=new Set(),samples=[],areas=[];
assert.equal(allIds.size,catalog.walls.length);
for(const area of catalog.areas){
 const recipes=JSON.parse(await readFile(root+'/recipes/'+area.id+'.json','utf8')),doc=await io.read('public'+area.model);
 let pickFaces=0,maxPlaneError=0,maxSourceUvError=0,maxAtlasUvError=0,maxProjectionUvError=0;
 const atlas=JSON.parse(await readFile(root+'/textures/'+area.id+'-layout.json','utf8')),atlasMap=new Map(atlas.entries.map(e=>[e.image,e]));
 const groupKeys=new Set();
 const original=JSON.parse(await readFile('data/plateau/'+area.dataset+'/'+(area.id==='tocho'?'53394525':'53393599')+'-geometry.json','utf8'));
 const originalPolygons=new Map(original.buildings.flatMap(b=>b.walls).map(p=>[p.id,p]));
 for(const n of doc.getRoot().listNodes()){const ranges=n.getExtras().wallFaces||[];let end=0;const index=n.getMesh()?.listPrimitives()[0]?.getIndices();for(const r of ranges){assert.ok(allIds.has(r.wallId));assert.ok(r.start>=end);end=r.start+r.count;assert.ok(end*3<=index.getCount());pickIds.add(r.wallId);pickFaces+=r.count;const originalPolygon=originalPolygons.get(r.polygonId),t=triangulate(originalPolygon.rings.map(r=>r.points)),texture=original.textures[r.polygonId],a=atlasMap.get(texture.image),sourceUV=originalPolygon.rings.flatMap(r=>texture.rings[r.id].slice(0,r.points.length*2));const uv=n.getMesh().listPrimitives()[0].getAttribute('TEXCOORD_0'),v=[0,0];for(let i=0;i<r.count*3;i++){const vertex=index.getScalar(r.start*3+i),position=[0,0,0];n.getMesh().listPrimitives()[0].getAttribute('POSITION').getElement(vertex,position);const tri=t.indices.slice(Math.floor(i/3)*3,Math.floor(i/3)*3+3);const j=tri.reduce((best,j)=>Math.hypot(...sub(t.points[j],position))<Math.hypot(...sub(t.points[best],position))?j:best,tri[0]);assert.ok(Math.hypot(...sub(t.points[j],position))<.002,'triangle correspondence');uv.getElement(vertex,v);const expected=[(a.x+Math.max(0,Math.min(1,sourceUV[j*2]))*a.width)/atlas.size,(a.y+Math.max(0,Math.min(1,1-sourceUV[j*2+1]))*a.height)/atlas.size];maxAtlasUvError=Math.max(maxAtlasUvError,Math.abs(v[0]-expected[0])*atlas.size,Math.abs(v[1]-expected[1])*atlas.size);}}}
 for(const w of catalog.walls.filter(w=>w.areaId===area.id)){
  const r=recipes[w.id];assert.ok(r);assert.ok(w.source.lod>=2);const g=overlayGeometry(r);
  assert.equal(r.projection,'orthographic-visible');assert.ok(r.visiblePolygons.length);for(const p of r.visiblePolygons)for(let i=0;i<p.points.length;i++){const v=p.points[i],expected=[(dot(v,r.u)-r.lo[0])/r.width,(r.hi[1]-v[1])/r.height];maxProjectionUvError=Math.max(maxProjectionUvError,Math.abs(expected[0]-p.canvasUV[i*2]),Math.abs(expected[1]-p.canvasUV[i*2+1]));}
  const key=w.source.buildingId+'|'+w.source.quadrant;assert.ok(!groupKeys.has(key));groupKeys.add(key);assert.ok(r.panels.length);for(let i=0;i<g.uvs.length;i++)assert.ok(Number.isFinite(g.uvs[i])&&g.uvs[i]>=-1e-5&&g.uvs[i]<=1.00001);for(const p of r.panels)maxPlaneError=Math.max(maxPlaneError,p.maxDeviation);
  for(const p of r.polygons){const source=originalPolygons.get(p.id);assert.ok(source);const uv=source.rings.flatMap(r=>original.textures[p.id].rings[r.id].slice(0,r.points.length*2)).map((v,i)=>i%2?1-v:v);assert.equal(uv.length,p.sourceUV.length);for(let i=0;i<uv.length;i++)maxSourceUvError=Math.max(maxSourceUvError,Math.abs(uv[i]-p.sourceUV[i]));}
 }
 assert.ok(maxProjectionUvError<1e-6);assert.ok(maxPlaneError<=.051);assert.equal(maxSourceUvError,0);assert.ok(maxAtlasUvError<.01,'atlas UV error '+maxAtlasUvError);
 const ws=catalog.walls.filter(w=>w.areaId===area.id);const chosen=[ws[0],ws.find(w=>w.source.lod>=3),ws.find(w=>w.validation.holeCount>0),ws.find(w=>w.width/w.height<.3),ws.find(w=>w.width/w.height>4)].filter(Boolean);
 for(const w of new Set(chosen)){const b=await bakeWall(recipes[w.id],async path=>sharp('public'+path).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true}));let outside=0;for(let i=0;i<b.data.length;i+=4){assert.equal(b.data[i+3],b.mask[i+3]);assert.ok(b.mask[i+3]===0||b.mask[i+3]===255);if(!b.mask[i+3]){outside++;assert.equal(b.data[i]+b.data[i+1]+b.data[i+2],0);}}samples.push({wallId:w.id,lod:w.source.lod,width:b.width,height:b.height,outsidePixels:outside});}
 areas.push({id:area.id,buildingCount:area.buildingCount,texturedBuildings:area.texturedBuildings,wallCount:ws.length,pickTriangles:pickFaces,maxPlaneErrorMeters:maxPlaneError,maxSourceUvError,maxAtlasUvPixelError:maxAtlasUvError,maxProjectionUvError});
}
assert.equal(pickIds.size,allIds.size,'Every paintable wall must be selectable from its original GLB triangles');
for(const s of catalog.sections){assert.ok(s.length>=25);assert.ok(s.wallIds.length);assert.equal(s.wallIds.length,new Set(s.layout.map(l=>l.wallId)).size);for(const l of s.layout){assert.ok(allIds.has(l.wallId));assert.ok(l.visibleSamples>=2);assert.ok(l.distance<=65);}}
const report={datasetVersion:catalog.datasetVersion,manifestFiles:manifest.files.length,walls:catalog.walls.length,pickableWalls:pickIds.size,roadSections:catalog.sections.length,excludedWalls:catalog.excludedWalls,areas,bakedSamples:samples,limits:'Full source UV/GLB pick coverage; selected baking samples only. Not full GPU photometric or road visibility acceptance.'};
await writeFile('data/plateau/verification-v4.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
