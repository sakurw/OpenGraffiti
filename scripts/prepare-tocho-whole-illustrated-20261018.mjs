import fs from 'node:fs/promises';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const dir='data/texture-city/tocho-whole-illustrated-20261018';await fs.mkdir(dir,{recursive:true});await fs.mkdir('public/assets/tocho-landmark/whole-illustrated-20261018',{recursive:true});
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb');
const ps=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const records=[];
for(const [name,ids]of [['photo-a',[2,3,4,5,6]],['photo-b',[7,8,9,10,11,12,16]],['photo-c',[13,14]]]){
 const tex=ps[ids[0]].getMaterial().getBaseColorTexture(),image=tex.getImage(),m=await sharp(image).metadata();
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const id of ids){const uv=ps[id].getAttribute('TEXCOORD_0').getArray();for(let i=0;i<uv.length;i+=2){x0=Math.min(x0,uv[i]*m.width);y0=Math.min(y0,uv[i+1]*m.height);x1=Math.max(x1,uv[i]*m.width);y1=Math.max(y1,uv[i+1]*m.height);}}
 const crop={left:Math.max(0,Math.floor(x0)-32),top:Math.max(0,Math.floor(y0)-32)};crop.width=Math.min(m.width-crop.left,Math.ceil(x1)-crop.left+32);crop.height=Math.min(m.height-crop.top,Math.ceil(y1)-crop.top+32);
 const file=`${dir}/${name}-source.png`;await sharp(image).extract(crop).png().toFile(file);records.push({name,ids,sourceWidth:m.width,sourceHeight:m.height,crop,file});
}
for(const [name,id]of [['native-atlas',1],['roof-a',22],['roof-b',28],['stone',20],['stripes',21]]){
 const tex=ps[id].getMaterial().getBaseColorTexture();const file=`${dir}/${name}-source.png`;await sharp(tex.getImage()).png().toFile(file);const m=await sharp(tex.getImage()).metadata();records.push({name,ids:[id],file,width:m.width,height:m.height});
}
await fs.writeFile(dir+'/source-assets.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records));
