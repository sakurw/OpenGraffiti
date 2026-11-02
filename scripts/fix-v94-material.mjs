import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const input='data/texture-city/tocho-photoreal-v94-final-uv.glb';
const out='data/texture-city/tocho-photoreal-v94-material-fixed.glb';
const doc=await io.read(input);
let count=0;
for(const m of doc.getRoot().listMaterials()){
 m.setMetallicFactor(0).setRoughnessFactor(1);
 count++;
}
await io.write(out,doc);
console.log(JSON.stringify({materials:count,out}));
