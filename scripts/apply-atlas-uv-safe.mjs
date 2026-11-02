import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [input, atlas, mappingFile, output]=process.argv.slice(2);
const mapping=JSON.parse(await readFile(mappingFile,'utf8'));
const map=new Map();
for(const m of mapping.mappings){map.set(m.indexOffset ?? m.triangleId*3,m);}
const io=new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(input);
const tex=doc.createTexture('photo-atlas').setImage(await readFile(atlas)).setMimeType('image/png');
const mat=doc.createMaterial('photo-atlas').setBaseColorTexture(tex).setDoubleSided(true);
let updated=0;
for(const mesh of doc.getRoot().listMeshes()){
 for(const prim of mesh.listPrimitives()){
  const idx=prim.getIndices(); if(!idx) continue;
  const old=prim.getAttribute('TEXCOORD_0'); if(!old) continue;
  const uv=[]; const conflict=new Map(); let ok=0;
  for(let i=0;i<idx.getCount();i+=3){const m=map.get(i); if(!m) continue; ok++; for(let c=0;c<3;c++){const v=idx.getScalar(i+c); const p=m.atlasUV[c]; if(conflict.has(v)){const q=conflict.get(v); if(q[0]!==p[0]||q[1]!==p[1]) continue;} conflict.set(v,p);}}
  if(ok===0) continue;
  for(let v=0;v<old.getCount();v++){const p=conflict.get(v); if(p){uv.push(p[0],p[1]);}else{uv.push(old.getScalar(v*2),old.getScalar(v*2+1));}}
  prim.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)));
  prim.setMaterial(mat); updated++;
 }
}
await io.write(output,doc);
console.log(JSON.stringify({updated}));
