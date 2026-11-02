import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [input, atlas, mappingFile, output] = process.argv.slice(2);
const mapping = JSON.parse(await readFile(mappingFile,'utf8'));
const records = mapping.records ?? mapping.mappings ?? [];
const byPrim = new Map();
for (const r of records) {
  const key = `${r.meshIndex}:${r.primitiveId}`;
  if (!byPrim.has(key)) byPrim.set(key, new Map());
  byPrim.get(key).set(r.indexOffset ?? r.triangleId * 3, r);
}
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc = await io.read(input);
const tex = doc.createTexture('photographic-atlas').setImage(await readFile(atlas)).setMimeType('image/png');
let meshIndex = 0;
let updated = 0;
let changedTriangles = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  let primitiveId = 0;
  for (const prim of mesh.listPrimitives()) {
    const map = byPrim.get(`${meshIndex}:${primitiveId}`);
    const idx = prim.getIndices();
    const oldUv = prim.getAttribute('TEXCOORD_0');
    if (!map || !idx || !oldUv) { primitiveId++; continue; }
    const values = Array.from(oldUv.getArray());
    let changed = 0;
    for (let i=0;i<idx.getCount();i+=3) {
      const rec = map.get(i);
      if (!rec) continue;
      for (let c=0;c<3;c++) {
        const v = idx.getScalar(i+c);
        if (v*2+1 < values.length) {
          values[v*2] = rec.atlasUV[c][0];
          values[v*2+1] = rec.atlasUV[c][1];
          changed++;
        }
      }
      changedTriangles++;
    }
    if (changed) {
      prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(values)));
      // keep original materials; atlas is assigned only through new material when requested by export stage
      updated++;
    }
    primitiveId++;
  }
  meshIndex++;
}
await io.write(output, doc);
console.log(JSON.stringify({updated, changedTriangles}));
