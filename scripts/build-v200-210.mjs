import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const input='public/assets/datasets/plateau-2025-v4/models/tocho.glb';
const output='data/texture-city/tocho-photo-only-debug-v200-order-210.glb';
const atlas=JSON.parse(await readFile('data/texture-city/tocho-canonical-render-atlas-v32-provenance.json','utf8')).mappings;
const order=[2,1,0];
const direct=new Map(atlas.map(x=>[`${x.meshIndex}/${x.primitiveId}/${x.indexOffset}`,x]));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(input);
const tex=doc.createTexture('debug-indexoffset-atlas').setImage(await readFile('data/texture-city/tocho-canonical-render-atlas-v32.png')).setMimeType('image/png');
const mat=doc.createMaterial('debug-indexoffset-photo').setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true);
const acc=(t,a,T=Float32Array)=>doc.createAccessor().setType(t).setArray(new T(a));
let total=0,kept=0,mi=0;
for(const mesh of doc.getRoot().listMeshes()){
 let pi=0;
 for(const prim of [...mesh.listPrimitives()]){
  const idx=prim.getIndices(),pos=prim.getAttribute('POSITION');
  if(!idx||!pos){pi++;continue;}
  const P=[],U=[],I=[];
  for(let off=0;off<idx.getCount();off+=3){
   total++; const m=direct.get(`${mi}/${pi}/${off}`); if(!m) continue; kept++;
   for(let c=0;c<3;c++){const p=pos.getElement(idx.getScalar(off+c),[]);P.push(...p);U.push(...m.atlasUV[order[c]]);I.push(I.length);}
  }
  if(I.length){mesh.removePrimitive(prim);mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION',acc('VEC3',P)).setAttribute('TEXCOORD_0',acc('VEC2',U)).setIndices(acc('SCALAR',I,Uint32Array)).setMaterial(mat));}
  pi++;
 }
 mi++;
}
await io.write(output,doc); await writeFile(output+'.report.json',JSON.stringify({total,kept},null,2)); console.log(JSON.stringify({output,total,kept}));

