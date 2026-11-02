import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';

const source=path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v30-20261017.glb');
const canonical=new Set([
  '30,46,60','65,88,107','106,129,141','140,161,169',
  '169,185,189','202,212,212','204,200,188','65,164,219',
  '145,216,249','94,174,210','119,152,158','70,108,126',
  '36,89,134','83,136,166',
]);
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(source),parts=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const seen=new Map(),report=[];
for(let id=0;id<parts.length;id++){
  const p=parts[id],semantic=p.getExtras()?.semantic,tex=p.getMaterial()?.getBaseColorTexture();
  if(!tex||seen.has(tex)){if(tex)seen.get(tex).parts.push(id);continue;}
  const {data,info}=await sharp(tex.getImage()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const colors=new Map();let alphaZero=0,alphaPartial=0,alphaOpaque=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const index=4*(y*info.width+x),a=data[index+3];
    const key=[data[index],data[index+1],data[index+2]].join(',');
    let rec=colors.get(key);if(!rec){rec={key,total:0,opaque:0,transparent:0,partial:0,first:[x,y],alphaSamples:{}};colors.set(key,rec);}
    rec.total++;
    if(a===0){rec.transparent++;alphaZero++;}else if(a===255){rec.opaque++;alphaOpaque++;}else{rec.partial++;alphaPartial++;}
    rec.alphaSamples[a]=(rec.alphaSamples[a]??0)+1;
  }
  const record={parts:[id],semantic,width:info.width,height:info.height,
    alpha:{zero:alphaZero,partial:alphaPartial,opaque:alphaOpaque},
    unexpected:[...colors.values()].filter(c=>!canonical.has(c.key)).sort((a,b)=>b.total-a.total),
    canonical:[...colors.values()].filter(c=>canonical.has(c.key)).sort((a,b)=>b.total-a.total).map(({key,total})=>({key,total}))};
  seen.set(tex,record);report.push(record);
}
const out=path.resolve('data/texture-city/tocho-style-pilot-20261015/v31-palette-source-audit-20261018.json');
if(fs.existsSync(out))throw Error('Refusing to overwrite '+out);
fs.writeFileSync(out,JSON.stringify({source,at:new Date().toISOString(),textures:report},null,2));
console.log(JSON.stringify({out,unexpected:report.filter(r=>r.unexpected.length).map(r=>({semantic:r.semantic,parts:r.parts,unexpected:r.unexpected.map(({key,total,opaque,transparent,partial,first})=>({key,total,opaque,transparent,partial,first}))}))},null,2));
