import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [input, atlas, mappingFile, output] = process.argv.slice(2);
const mapping = JSON.parse(await readFile(mappingFile, 'utf8'));
// Mapping offsets are stored as index-buffer offsets. They are not triangle
// numbers and must not be matched against a primitive-local loop counter.
// Keep primitiveId in the key because GLTF resets index offsets per primitive.
const byIndexOffset = new Map(mapping.mappings.map(m => [m.indexOffset ?? m.triangleId * 3, m]));
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder});
const doc = await io.read(input);
const tex = doc.createTexture('photographic-atlas').setImage(await readFile(atlas)).setMimeType('image/png');
const mat = doc.createMaterial('photographic-atlas').setBaseColorTexture(tex).setDoubleSided(true);
let updated=0;
let indexBase = 0;
for (const mesh of doc.getRoot().listMeshes()) {
 for (const prim of mesh.listPrimitives()) {
  const idx=prim.getIndices(); const uv=prim.getAttribute('TEXCOORD_0');
  if(!idx||!uv) continue;
  const old=Array.from(uv.getArray());
  const values=old.slice();
  let changed=0;
  for(let i=0;i<idx.getCount();i+=3){
   const m=byIndexOffset.get(indexBase + i); if(!m) continue;
   for(let c=0;c<3;c++){
    const v=idx.getScalar(i+c);
    if(v*2+1<values.length){ values[v*2]=m.atlasUV[c][0]; values[v*2+1]=m.atlasUV[c][1]; changed++; }
 }
  indexBase += idx.getCount();
}
  if(changed){
   prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(values)));
   prim.setMaterial(mat); updated++;
  }
 }
}
await io.write(output,doc);
console.log(JSON.stringify({updated}));
