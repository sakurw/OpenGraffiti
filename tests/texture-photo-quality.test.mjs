import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPhotoQuality,photoQualityEvidence} from '../scripts/texture-photo-quality.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('quality selection retains unscored images and uses an inclusive 0.2 boundary',()=>{
 for(const q of [0,null,undefined])assert.equal(classifyPhotoQuality(q),'unscored');
 for(const q of [.001,.066,.079,.123,.173,.199999])assert.equal(classifyPhotoQuality(q),'low-quality');
 for(const q of [.2,.343,1])assert.equal(classifyPhotoQuality(q),'not-rejected-by-score');
 for(const q of [-1,1.1,NaN,Infinity,'0.1'])assert.throws(()=>classifyPhotoQuality(q),/Invalid/);
});
test('quality evidence binds exclusions to the acquired photo and fingerprints metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'graffiti-quality-')),photo={id:'123',sha256:'hash'};
 try{
  assert.equal((await photoQualityEvidence(photo,{root})).status,'unscored');
  const path=join(root,'123.json'),m={id:'123',sourceSha256:'hash',qualityScore:.066};
  await writeFile(path,JSON.stringify(m));const first=await photoQualityEvidence(photo,{root});assert.equal(first.status,'low-quality');
  m.qualityScore=.8;await writeFile(path,JSON.stringify(m));const next=await photoQualityEvidence(photo,{root});assert.notEqual(first.key,next.key);
  m.sourceSha256='other';await writeFile(path,JSON.stringify(m));await assert.rejects(photoQualityEvidence(photo,{root}),/identity mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
