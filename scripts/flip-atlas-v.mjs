import { NodeIO } from '@gltf-transform/core';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions';
const [input, output]=process.argv.slice(2);
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit]).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(input);
let count=0;
for (const mat of doc.getRoot().listMaterials()) {
 if (!mat.getName().includes('photographic')) continue;
 for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  if (prim.getMaterial()!==mat) continue;
  const uv=prim.getAttribute('TEXCOORD_0'); if(!uv) continue;
  const src=uv.getArray(); const arr=new Float32Array(src.length);
  for(let i=0;i<src.length;i+=2){arr[i]=src[i];arr[i+1]=1-src[i+1];}
  prim.setAttribute('TEXCOORD_0',doc.createAccessor('flipped-uv').setType('VEC2').setArray(arr));
  count++;
 }
}
await io.write(output,doc); console.log({count});
