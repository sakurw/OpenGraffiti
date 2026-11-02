// Local-only review: real dataset photos alongside the existing 3D comparison.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='public/assets/texture-poc/msls',photos=JSON.parse(await readFile('data/texture-city/msls/photos.json','utf8'));
await mkdir(root+'/images',{recursive:true});
for(const p of photos){
 if(!/^[A-Za-z0-9_-]+$/.test(p.id))throw Error('Invalid ID');
 const bytes=await readFile(`data/texture-city/photos/msls/${p.id}.jpg`);if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('Source changed');
 await writeFile(`${root}/images/${p.id}.jpg`,bytes);
}
await copyFile('data/texture-city/msls/LICENSE.txt',root+'/LICENSE.txt');
const summary={source:'Mapillary Street-Level Sequences',sourcePage:'https://github.com/mapillary/mapillary_sls',scope:'Local evaluation, not permission to publish',
 photos:photos.map(p=>({id:p.id,areas:p.areaIds,sequence:p.sequenceId,frame:p.sequenceIndex,date:p.shotDate,lat:Number(p.lat),lon:Number(p.lon),heading:Number(p.ca),size:p.downloadSize,sha256:p.sha256,archive:p.image.archive,entry:p.image.entry,applied:false}))};
await writeFile(root+'/photos.json',JSON.stringify(summary,null,2));
console.log({images:photos.length,report:root+'/photos.json'});
