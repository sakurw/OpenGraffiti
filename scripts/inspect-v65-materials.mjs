import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc=await io.read('data/texture-city/tocho-photographic-v65-surface-preserve.glb');
console.log(JSON.stringify({materials:doc.getRoot().listMaterials().map(m=>({name:m.getName(),tex:!!m.getBaseColorTexture()})),textures:doc.getRoot().listTextures().map(t=>({name:t.getName(),size:t.getImage()?.length||0,mime:t.getMimeType()})),meshes:doc.getRoot().listMeshes().length},null,2));
