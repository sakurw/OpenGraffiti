// Export deterministic render inputs for geometry-guided texture registration.
//
// This is the bridge between PLATEAU geometry and the existing Python
// correspondence pipeline. The output contract is:
//   RGB render
//   depth buffer
//   world position buffer
//
// The registration pipeline must still validate the resulting pose.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [model, output = 'data/texture-city/render-export'] = process.argv.slice(2);
if (!model) {
  console.error('Usage: node scripts/texture-building-render-export.mjs <model.glb> [output]');
  process.exit(1);
}

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(resolve(model));
const root = document.getRoot();

let vertices = 0;
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    if (position) vertices += position.getCount();
  }
}

await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'scene-contract.json'), JSON.stringify({
  status: 'geometry-loaded',
  model: resolve(model),
  vertices,
  requiredNextStage: [
    'WebGL framebuffer RGB capture',
    'depth attachment capture',
    'world-position attachment capture'
  ],
  note: 'Geometry loading is verified. Pixel buffers require the runtime renderer.'
}, null, 2));

console.log(JSON.stringify({ status: 'geometry-loaded', vertices, output }));
