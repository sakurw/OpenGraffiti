import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const dir='data/texture-city/tocho-whole-illustrated-20261018',out='public/assets/tocho-landmark/whole-illustrated-20261018';
const report=JSON.parse(await fs.readFile(dir+'/build-report.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(report.output.file);
const beforeBytes=report.output.bytes,ops=[];
for(const tex of doc.getRoot().listTextures()){
 const original=tex.getImage(),m=await sharp(original).metadata();
 if(m.width*m.height<1024*1024)continue;
 const bytes=await sharp(original).jpeg({quality:92,chromaSubsampling:'4:4:4',mozjpeg:true}).toBuffer();
 tex.setImage(bytes).setMimeType('image/jpeg');ops.push({name:tex.getName(),width:m.width,height:m.height,before:original.length,after:bytes.length});
}
await io.write(report.output.file,doc);
report.packaging={createdAt:new Date().toISOString(),opaqueLargeTextures:'JPEG quality 92, 4:4:4; PNG originals preserved as sidecars',beforeBytes,operations:ops};
report.output.sha256=crypto.createHash('sha256').update(await fs.readFile(report.output.file)).digest('hex');report.output.bytes=(await fs.stat(report.output.file)).size;
await fs.writeFile(dir+'/build-report.json',JSON.stringify(report,null,2));await fs.writeFile(out+'/build-report.json',JSON.stringify({...report,records:undefined},null,2));
console.log(JSON.stringify({beforeBytes,afterBytes:report.output.bytes,textures:ops.length}));
