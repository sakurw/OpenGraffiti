import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const dir='data/texture-city/tocho-district-photo-v3-20261018';
await fs.mkdir(dir,{recursive:true});
const file='public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb';
const bytes=await fs.readFile(file),doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
const seen=new Map();let triangles=0,duplicates=0,degenerate=0;
for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
 const pos=p.getAttribute('POSITION'),a=pos.getArray(),ix=p.getIndices()?.getArray(),count=ix?.length??pos.getCount();
 for(let i=0;i<count;i+=3){
  const vertices=[0,1,2].map(k=>{const j=(ix?ix[i+k]:i+k)*3;return [a[j],a[j+1],a[j+2]];});
  const vs=vertices.map(v=>v.map(x=>Math.round(x*1e5)).join(',')).sort();
  if(new Set(vs).size<3)degenerate++;
  const key=vs.join('|');if(seen.has(key))duplicates++;else seen.set(key,triangles);
  triangles++;
 }
}
const levels=2**24-1,near=.1,far=20000;
const depthPrecision=[500,1000,2000].map(distance=>({distanceMeters:distance,legacyLinearStepMeters:distance**2*(far-near)/(far*near*levels),logarithmicStepMeters:(distance+1)*Math.log(8001)/levels}));
const result={at:new Date().toISOString(),asset:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),triangles,duplicateTrianglesAt10Micrometers:duplicates,degeneratePositionKeys:degenerate,depthPrecision,precisionAssumption:'24-bit fixed depth, approximate local quantization; legacy fitted near .1 and far>=20000; log example far8000. Actual GPU depth bits and clipping are captured separately in browser.',evidence:'Existing ownership audit documents photographic surfaces offset about .065m from coarse geometry; a depth step exceeding that can cause z-fighting.',fix:'Logarithmic depth with adaptive clipping; anisotropic filtering for oblique fine texture detail. No surface deletion, no disabled depth test, no geometry changes.',requiresBrowserValidation:true};
await fs.writeFile(dir+'/depth-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
