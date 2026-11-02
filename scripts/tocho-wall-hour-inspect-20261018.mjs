import fs from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const out='data/texture-city/tocho-wall-hour-20261018';
await fs.mkdir(out,{recursive:true});
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb');
const ps=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
console.log('nodes',doc.getRoot().listNodes().map(n=>({name:n.getName(),matrix:n.getMatrix()})));
const records=[];
for(let id=0;id<ps.length;id++){
 const p=ps[id],a=p.getAttribute('POSITION').getArray();
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<a.length;i++) {min[i%3]=Math.min(min[i%3],a[i]);max[i%3]=Math.max(max[i%3],a[i]);}
 const rec={id,min,max,triangles:(p.getIndices()?.getCount()??a.length/3)/3,extras:p.getExtras(),material:p.getMaterial()?.getName()};
 records.push(rec);
 if(id>=2&&id<=16)console.log(JSON.stringify(rec));
}
await fs.writeFile(out+'/primitives.json',JSON.stringify(records,null,2));
for(const id of [2,7,13])await fs.writeFile(out+`/photo-primitive-${id}.png`,ps[id].getMaterial().getBaseColorTexture().getImage());
