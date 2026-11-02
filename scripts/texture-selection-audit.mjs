// Compare actual GLBs: coverage must not be lost by reordering candidates.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
const area=process.argv[2];assert.ok(['tocho','tokyo-tower'].includes(area));
const root='public/assets/texture-poc/experimental',io=new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]);
const original=JSON.parse(await readFile(`${root}/${area}.json`,'utf8'));
const all=process.argv[3]==='--all';if(process.argv[3]&&!all)throw Error('Unknown comparison scope');
const reports=all?[original,JSON.parse(await readFile(`${root}/selection/wall-coverage-all/${area}.json`,'utf8'))]:await Promise.all(['triangle-first','wall-coverage'].map(async method=>JSON.parse(await readFile(`${root}/selection/${method}/${area}.json`,'utf8'))));
const models=[];
for(const report of reports){
 const triangles=new Map(),edges=new Map(),doc=await io.read('public'+report.model);
 for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
  const p=primitive.getAttribute('POSITION').getArray();assert.ok(p instanceof Float32Array);assert.equal(p.length%9,0);
  const photo=primitive.getMaterial().getBaseColorTexture().getName();
  for(let i=0;i<p.length;i+=9){
   const key=Buffer.from(p.buffer,p.byteOffset+i*4,36).toString('base64');triangles.set(key,(triangles.get(key)||0)+1);
   const vertices=[0,3,6].map(j=>Buffer.from(p.buffer,p.byteOffset+(i+j)*4,12).toString('base64'));
   for(let j=0;j<3;j++){
    const edge=[vertices[j],vertices[(j+1)%3]].sort().join('|'),entry=edges.get(edge)||{count:0,photos:new Set()};entry.count++;entry.photos.add(photo);edges.set(edge,entry);
   }
  }
 }
 const total=[...triangles.values()].reduce((s,n)=>s+n,0);assert.equal(total,report.projectedTriangles);
 models.push({triangles,total,sharedEdges:[...edges.values()].filter(e=>e.count>1).length,seams:[...edges.values()].filter(e=>e.count>1&&e.photos.size>1).length});
}
assert.deepEqual([...models[0].triangles].sort(),[...models[1].triangles].sort(),'Selection must preserve the entire accepted triangle multiset');
assert.deepEqual(reports[0].buildings.map(b=>b.buildingId),reports[1].buildings.map(b=>b.buildingId));
for(const b of reports[1].buildings){
 const before=reports[0].buildings.find(p=>p.buildingId===b.buildingId),published=original.buildings.find(p=>p.buildingId===b.buildingId);
 assert.equal(b.triangles,before.triangles);assert.equal(b.triangles,published.triangles);assert.ok(Math.abs(b.projectedArea-before.projectedArea)<1e-7);
 assert.ok(Math.abs(before.projectedArea-published.projectedArea)<1e-7);
}
const result={area,scope:reports[1].scope,triangles:models[1].total,coveragePreserved:true,
 variants:reports.map((r,i)=>({method:r.photoSelection||'triangle-first',photos:r.usedPhotos,sharedEdges:models[i].sharedEdges,photoSeams:models[i].seams,buildings:r.buildings.map(b=>({id:b.buildingId,area:b.projectedArea,photos:b.sourceIds.length}))})),
 note:'Seams count exact shared triangle edges with different source images. It does not measure photometric alignment or verify building correspondence.'};
await writeFile(`data/texture-city/selection-audit-${area}${all?'-all':''}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,variants:result.variants.map(v=>({...v,buildings:v.buildings.length}))},null,2));
