import {readFile,readdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const root='data/texture-city/photos/mapillary',counts={},examples=[];
for(const f of await readdir(root))if(/^\d+\.json$/.test(f)){
 const p=JSON.parse(await readFile(`${root}/${f}`,'utf8')),image=await sharp(`${root}/${p.id}.jpg`).metadata();
 const key=`${p.camera_type}/JPEG-${image.orientation??'absent'}/API-${p.exif_orientation??'absent'}`;counts[key]=(counts[key]||0)+1;
 if(image.orientation&&image.orientation!==1)examples.push({id:p.id,type:p.camera_type,orientation:image.orientation,size:[image.width,image.height],apiSize:[p.width,p.height]});
}
await writeFile('data/texture-city/orientation-audit.json',JSON.stringify({counts,examples},null,2));console.log({counts,nonUpright:examples.length,examples:examples.slice(0,5)});
