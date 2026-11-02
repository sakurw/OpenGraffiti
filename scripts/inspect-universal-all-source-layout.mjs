import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit]).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.readBinary(await readFile('public/assets/datasets/plateau-2025-v4/models/tocho.glb'));
const list=doc.getRoot().listMeshes();
for(const mesh of list.slice(0,5))for(const p of mesh.listPrimitives()){
 const pos=p.getAttribute('POSITION').getArray(),uv=p.getAttribute('TEXCOORD_0')?.getArray(),normal=p.getAttribute('NORMAL')?.getArray(),indices=p.getIndices()?.getArray();
 const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<pos.length;i+=3)for(let j=0;j<3;j++){mins[j]=Math.min(mins[j],pos[i+j]);maxs[j]=Math.max(maxs[j],pos[i+j]);}
 console.log(JSON.stringify({mesh:mesh.getName(),material:p.getMaterial()?.getName(),vertices:pos.length/3,indices:indices?.length,uv:uv?.length,normals:normal?.length,bounds:[mins,maxs],texture:p.getMaterial()?.getBaseColorTexture()?.getName()}));
}
