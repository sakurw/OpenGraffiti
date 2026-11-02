import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {kartaviewCameraEvidence} from './texture-kartaview-evidence.mjs';
const root='data/texture-city/photos/kartaview',mapillaryRoot='data/texture-city/photos/mapillary';
const mapillaryHashes=new Map();
for(const f of await readdir(mapillaryRoot))if(/^\d+\.json$/.test(f)){
 const m=JSON.parse(await readFile(`${mapillaryRoot}/${f}`,'utf8'));
 if(m.status==='downloaded'&&m.sha256)mapillaryHashes.set(m.sha256,m.id);
}
const sources=[];
const maskBase='data/texture-city/kartaview/masks',maskFinal='data/texture-city/kartaview/facade-masks';
for(const [local,original] of [[maskBase,'data/texture-city/masks'],[maskFinal,'data/texture-city/facade-masks']]){
 try{assert.deepEqual(JSON.parse(await readFile(local+'/model.json','utf8')),JSON.parse(await readFile(original+'/model.json','utf8')),'Mask model revision or thresholds diverged');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const f of await readdir(root))if(/^\d+\.json$/.test(f)){
 const m=JSON.parse(await readFile(`${root}/${f}`,'utf8')),bytes=await readFile(`${root}/${m.id}.jpg`);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256);
 const image=await sharp(bytes).metadata();assert.deepEqual([image.width,image.height],m.downloadSize);
 assert.equal(m.license.name,'CC-BY-SA-4.0');assert.equal(m.registration,'unregistered');
 let mask={status:'not-created'};
 try{
  const provenance=JSON.parse(await readFile(`${maskFinal}/${m.id}.json`,'utf8'));
  const primary=JSON.parse(await readFile(`${maskBase}/${m.id}.json`,'utf8'));
  assert.equal(provenance.sourceSha256,m.sha256);assert.equal(primary.sourceSha256,m.sha256);
  assert.equal(provenance.policy,'intersect-cityscapes-building-and-ade20k-building-family-v2');
  const a=await sharp(`${maskBase}/${m.id}.png`).greyscale().raw().toBuffer({resolveWithObject:true});
  const b=await sharp(`${maskFinal}/${m.id}.png`).greyscale().raw().toBuffer({resolveWithObject:true});
  assert.equal(b.info.channels,1);assert.deepEqual([b.info.width,b.info.height],m.downloadSize);assert.deepEqual(a.info,b.info);
  let pixels=0;for(let i=0;i<b.data.length;i++){assert.ok(b.data[i]===0||b.data[i]===255);assert.ok(b.data[i]<=a.data[i]);if(b.data[i])pixels++;}
  assert.equal(pixels,provenance.afterPixels);mask={status:'source-and-subset-verified',pixels,policy:provenance.policy};
 }catch(e){if(e.code!=='ENOENT')throw e;}
 sources.push({id:m.id,sequenceId:m.sequenceId,areas:m.areaIds,sourceSha256:m.sha256,camera:kartaviewCameraEvidence(m),
  mask,byteIdenticalMapillaryId:mapillaryHashes.get(m.sha256)||null,independence:'unverified',shotDate:m.shotDate,captureTimezone:'not explicit in API value'});
}
const result={at:new Date().toISOString(),downloadedPhotos:sources.length,byteIdenticalMapillaryPhotos:sources.filter(s=>s.byteIdenticalMapillaryId).length,
 verifiedMasks:sources.filter(s=>s.mask.status==='source-and-subset-verified').length,
 cameraStatuses:Object.fromEntries([...Map.groupBy(sources,s=>s.camera.status)].map(([k,v])=>[k,v.length])),sources,
 note:'Snapshot of fully written local photos; acquisition may still be running. Byte inequality is NOT proof of independent capture. Aspect consistency is NOT camera calibration. No photos in this audit are applied.'};
await writeFile('data/texture-city/kartaview/photo-audit.json',JSON.stringify(result,null,2));console.log({...result,sources:result.sources.length});
