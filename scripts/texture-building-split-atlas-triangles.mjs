import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [input, atlasFile, mappingFile, output] = process.argv.slice(2);
if (!input || !atlasFile || !mappingFile || !output) process.exit(1);

const mapping = JSON.parse(await readFile(mappingFile, 'utf8'));
const byRenderTriangle = new Map(mapping.mappings
  .filter(m => m.meshIndex !== undefined && m.primitiveId !== undefined && m.indexOffset !== undefined)
  .map(m => [`${m.meshIndex}:${m.primitiveId}:${m.indexOffset}`, m]));

const io = new NodeIO()
  .registerExtensions([KHRMaterialsUnlit, EXTMeshoptCompression])
  .registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder});
const doc = await io.read(input);

const tex = doc.createTexture('photographic-atlas')
  .setImage(await readFile(atlasFile))
  .setMimeType('image/png');
const unlit = doc.createExtension(KHRMaterialsUnlit);
const atlasMat = doc.createMaterial('photographic-atlas')
  .setBaseColorTexture(tex)
  .setDoubleSided(true)
  .setExtension('KHR_materials_unlit', unlit.createUnlit());

const accessor = (name, type, data, ArrayType = Float32Array) =>
  doc.createAccessor(name).setType(type).setArray(new ArrayType(data));

let split = 0;
let atlasTriangles = 0;
for (const [meshIndex, mesh] of doc.getRoot().listMeshes().entries()) {
  for (const [primitiveId, primitive] of [...mesh.listPrimitives()].entries()) {
    const index = primitive.getIndices();
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (!index || !uv) continue;

    const groups = [[], []];
    const triangleMappings = new Map();
    for (let i = 0; i < index.getCount(); i += 3) {
      const m = byRenderTriangle.get(`${meshIndex}:${primitiveId}:${i}`);
      if (m) triangleMappings.set(i, m);
      groups[m ? 0 : 1].push(i);
    }
    if (!groups[0].length) continue;

    for (const [atlasGroup, offsets] of groups.entries()) {
      if (!offsets.length) continue;
      const positions = primitive.getAttribute('POSITION');
      const normals = primitive.getAttribute('NORMAL');
      const outPos = [], outNorm = [], outUv = [], outIndex = [];
      // Atlas UV is defined per triangle corner. Keep photographic triangles split to avoid shared-vertex UV conflicts.
      const vertexMap = atlasGroup === 0 ? null : new Map();
      for (const off of offsets) {
        const m = triangleMappings.get(off);
        for (let j = 0; j < 3; j++) {
          const old = index.getScalar(off + j);
          let next = vertexMap ? vertexMap.get(old) : undefined;
          if (next === undefined) {
            next = outPos.length / 3;
            if (vertexMap) vertexMap.set(old, next);
            outPos.push(...positions.getElement(old, []));
            if (normals) outNorm.push(...normals.getElement(old, []));
            if (atlasGroup !== 0) outUv.push(...uv.getElement(old, []));
            else outUv.push(0, 0);
          }
          outIndex.push(next);
        }
        if (atlasGroup === 0) {
          if (!m) continue;
          // Atlas UVs follow the source vertexIds order. Match them back to
          // the actual GLB triangle corner order before writing UVs.
          const base = outUv.length - 6;
          for (let n = 0; n < 3; n++) {
            const sourceVertex = index.getScalar(off + n);
            const uvIndex = (m.vertexIds || []).indexOf(sourceVertex);
            const p = uvIndex >= 0 ? m.atlasUV[uvIndex] : m.atlasUV[n];
            outUv[base + n * 2] = p[0];
            outUv[base + n * 2 + 1] = p[1];
          }
          atlasTriangles++;
        }
      }
      const p = doc.createPrimitive()
        .setAttribute('POSITION', accessor('split-position', 'VEC3', outPos));
      if (outNorm.length) p.setAttribute('NORMAL', accessor('split-normal', 'VEC3', outNorm));
      p.setAttribute('TEXCOORD_0', accessor('split-uv', 'VEC2', outUv))
        .setIndices(accessor('split-index', 'SCALAR', outIndex, Uint32Array))
        .setMaterial(atlasGroup === 0 ? atlasMat : primitive.getMaterial());
      mesh.addPrimitive(p);
    }
    mesh.removePrimitive(primitive);
    split++;
  }
}

await io.write(output, doc);
await writeFile(`${output}.split-report.json`, JSON.stringify({split, atlasTriangles}, null, 2));
console.log(JSON.stringify({split, atlasTriangles}));


