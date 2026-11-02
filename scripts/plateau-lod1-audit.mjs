import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {triangulate} from './plateau-geometry.mjs';
const root='data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry';
const before=JSON.parse(await readFile(root+'.before-anonymous-fix.json','utf8'));
const after=JSON.parse(await readFile(root+'.json','utf8'));
assert.deepEqual(before.origin,after.origin);assert.deepEqual(before.textures,after.textures);
assert.equal(before.buildings.length,after.buildings.length);
let restored=0,faces=0,walls=0;
for(let i=0;i<before.buildings.length;i++){
 const a=before.buildings[i],b=after.buildings[i];assert.equal(a.id,b.id);
 if(a.lod!==1){assert.deepEqual(b,a);continue;}
 assert.equal(a.polygons.length,1);assert.equal(a.walls.length,0);
 assert.ok(b.polygons.length>=4);assert.ok(b.walls.length>=3);assert.ok(b.max[1]>b.min[1]);
 assert.ok(b.polygons.some(p=>JSON.stringify(p.rings)===JSON.stringify(a.polygons[0].rings)));
 assert.equal(new Set(b.polygons.map(p=>p.id)).size,b.polygons.length);
 restored++;faces+=b.polygons.length;walls+=b.walls.length;
}
const oldCatalog=JSON.parse(await readFile('data/texture-city/catalog-before-lod1-fix.json','utf8'));
const newCatalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
assert.deepEqual(newCatalog.walls,oldCatalog.walls,'Existing paint wall IDs and recipes metadata must remain stable');
assert.deepEqual(newCatalog.sections,oldCatalog.sections);
await MeshoptDecoder.ready;
const doc=await new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit]).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read('public/assets/datasets/plateau-2025-v4/models/tocho.glb');
const expectedIndices=after.buildings.filter(b=>b.lod===1).flatMap(b=>b.polygons).reduce((s,p)=>s+triangulate(p.rings.map(r=>r.points)).indices.length,0);
const actualIndices=doc.getRoot().listNodes().filter(n=>n.getExtras().plateau?.lod===1).flatMap(n=>n.getMesh()?.listPrimitives()||[]).reduce((s,p)=>s+p.getIndices().getCount(),0);
assert.equal(actualIndices,expectedIndices,'Rendered GLB must include every restored LOD1 triangle');
const result={restoredBuildings:restored,restoredSolidFaces:faces,derivedVerticalFaces:walls,lod1RenderedTriangles:actualIndices/3,unchangedPaintWalls:newCatalog.walls.length,unchangedNamedLod2Buildings:after.buildings.length-restored};
await writeFile('data/texture-city/lod1-repair-audit.json',JSON.stringify(result,null,2));console.log(result);
