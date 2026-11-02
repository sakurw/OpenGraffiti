import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';
import {readFile,writeFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read('data/texture-city/tocho-photographic-v75-noflip.glb');
const atlas=JSON.parse(await readFile('data/texture-city/tocho-wall-atlas-16471-corrected.json','utf8'));
const lookup=new Map(); let id=0;
for(const [mi,m] of doc.getRoot().listMeshes().entries()) for(const [pi,p] of m.listPrimitives().entries()) {const idx=p.getIndices(); if(!idx)continue; for(let off=0;off<idx.getCount();off+=3){lookup.set(`${mi}:${pi}:${off}`,id++);}}
let hit=0; for(const a of atlas.mappings) if(lookup.has(`${a.meshIndex}:${a.primitiveId}:${a.indexOffset}`)) hit++;
console.log(JSON.stringify({tri:id,atlas:atlas.mappings.length,hit}));
