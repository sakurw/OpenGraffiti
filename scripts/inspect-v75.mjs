import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {readFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
for (const f of ['tocho-photographic-v75-noflip.glb','tocho-photographic-v84-remapped.glb']) {
 const doc=await io.read('data/texture-city/'+f);
 let extras=[];
 for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { if(p.getExtras()) extras.push(p.getExtras()); }
 console.log(f, 'meshes',doc.getRoot().listMeshes().length,'primitiveExtras',extras.length, JSON.stringify(extras[0]||null).slice(0,200));
}
