import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {MeshoptDecoder} from 'meshoptimizer';import {readFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc=await io.read('data/texture-city/tocho-photographic-v75-noflip.glb');
let p=doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
console.log('v75 first',p.getElement(0,[]),p.getElement(1,[]),p.getElement(2,[]));
const s=JSON.parse(await readFile('data/texture-city/triangle-input-108038344-semantic.json','utf8'));
console.log('semantic first',s.vertices[0].world,s.vertices[1].world,s.vertices[2].world);
