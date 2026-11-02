/** Inventory only: no mutation of any source GLB. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';

const home=path.resolve('public/assets/tocho-landmark');
const out=path.resolve('data/texture-city/tocho-style-pilot-20261015/v33-diagnostics-20261018');
fs.mkdirSync(out,{recursive:true});
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const sources={
  v106:'tocho-landmark-balanced-edges-v106-candidate-20261014.glb',
  v30:'tocho-stylized-full-pixel-v30-20261017.glb',
  v32:'tocho-stylized-full-pixel-v32-20261018.glb',
};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
for(const [version,file] of Object.entries(sources)){
  const doc=await io.read(path.join(home,file));
  const parts=doc.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives());
  const tiles=[],recs=[],unique=new Map();
  for(let id=0;id<parts.length;id++){
    const p=parts[id];
    const texture=p.getMaterial()?.getBaseColorTexture();
    const original=texture?.getImage();
    const role=p.getExtras()?.semantic??'unknown';
    const uv=p.getAttribute('TEXCOORD_0');
    if(!original)continue;
    const descriptor=await sharp(original).metadata();
    const uvRange=[Infinity,Infinity,-Infinity,-Infinity];
    if(uv){
      const data=uv.getArray();
      for(let j=0;j<data.length;j+=2){
        uvRange[0]=Math.min(uvRange[0],data[j]);
        uvRange[1]=Math.min(uvRange[1],data[j+1]);
        uvRange[2]=Math.max(uvRange[2],data[j]);
        uvRange[3]=Math.max(uvRange[3],data[j+1]);
      }
    }
    const record={id,role,material:p.getMaterial()?.getName(),geometryVertices:p.getAttribute('POSITION')?.getCount(),
      triangles:p.getIndices()?.getCount()/3,uvRange,sha:sha(original),
      width:descriptor.width,height:descriptor.height,wrapS:p.getMaterial().getBaseColorTextureInfo().getWrapS()};
    recs.push(record);
    if(!unique.has(record.sha)){
      const tile={firstId:id,ids:[],role,source:original,...descriptor,sha:record.sha};
      tiles.push(tile);unique.set(record.sha,tile);
    }
    unique.get(record.sha).ids.push(id);
  }
  const w=240,h=225,cols=5,rows=Math.ceil(tiles.length/cols);
  const svgChunks=[];
  const overlays=[];
  for(let t=0;t<tiles.length;t++){
    const tile=tiles[t],x=(t%cols)*w,y=Math.floor(t/cols)*h;
    const png=await sharp(tile.source).flatten({background:'#d6dbe0'})
      .resize(w-12,169,{fit:'contain',background:'#d6dbe0'})
      .png().toBuffer();
    overlays.push({input:png,left:x+6,top:y+50});
    const note=`id ${tile.ids.join(',')} | ${tile.role} | ${tile.width}x${tile.height}`;
    const escaped=note.replaceAll('&','&amp;').replaceAll('<','&lt;');
    svgChunks.push(`<text x="${x+7}" y="${y+20}" font-family="monospace" font-size="12" fill="#111">${escaped.slice(0,37)}</text>`);
    svgChunks.push(`<text x="${x+7}" y="${y+38}" font-family="monospace" font-size="11" fill="#333">${tile.sha.slice(0,20)}</text>`);
  }
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w*cols}" height="${h*rows}">${svgChunks.join('')}</svg>`);
  const jpg=path.join(out,`${version}-source-tiles-v33.jpg`);
  await sharp({create:{width:w*cols,height:h*rows,channels:3,background:'#e8edef'}})
    .composite([...overlays,{input:svg,left:0,top:0}]).jpeg({quality:87}).toFile(jpg);
  const json=path.join(out,`${version}-source-tiles-v33.json`);
  fs.writeFileSync(json,JSON.stringify({version,file,totalPrimitives:parts.length,uniqueTextureCount:tiles.length,records:recs,tiles:tiles.map(({source,...a})=>a)},null,2));
  console.log(JSON.stringify({version,primitives:parts.length,textures:tiles.length,jpg,json,roles:[...new Set(recs.map(r=>r.role))]}));
}
