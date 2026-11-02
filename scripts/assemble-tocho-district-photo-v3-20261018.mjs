import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const old='public/assets/tocho-district-photo-v2-20261018',out='public/assets/tocho-district-photo-v3-20261018',audit='data/texture-city/tocho-district-photo-v3-20261018';
const profiles=JSON.parse(await fs.readFile(old+'/photo-profiles.json','utf8'));
const a=JSON.parse(await fs.readFile(audit+'/remaining-a/results.json','utf8'));
const b=JSON.parse(await fs.readFile(audit+'/remaining-b/results.json','utf8'));
const results=[...a.results,...b.entries];assert.equal(results.length,46);
for(const file of ['remaining-a/ground-match/replacement-sports.json','remaining-b/ground-match/replacement.json']){
 let replacement;try{replacement=JSON.parse(await fs.readFile(audit+'/'+file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const index=results.findIndex(r=>r.buildingId===replacement.buildingId);assert(index>=0,'Replacement outside remaining46');
 assert(replacement.selectedImage?.path&&replacement.selectedImage?.sha256&&replacement.sourcePaths?.length&&replacement.observed&&replacement.inferred,'Incomplete replacement provenance');
 results[index]={...results[index],...replacement,evidenceStatus:'photo-inferred'};
}
const byId=new Map(results.map(r=>[r.buildingId,r]));assert.equal(byId.size,46);
await fs.mkdir(out+'/artwork',{recursive:true});
const provenance=[];
for(const p of profiles.buildings){
 if(p.evidenceStatus==='approved-central')continue;
 if(p.artwork){await fs.copyFile(old+'/'+p.artwork,out+'/'+p.artwork);continue;}
 const r=byId.get(p.buildingId);assert(r,'Missing remaining building '+p.buildingId);
 const bytes=await fs.readFile(r.selectedImage.path),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 assert.equal(sha,r.selectedImage.sha256);
 const stats=await sharp(bytes).flatten({background:'#ffffff'}).removeAlpha().stats();
 p.artwork='artwork/'+p.buildingId+'.png';await fs.writeFile(out+'/'+p.artwork,bytes);
 Object.assign(p,{artworkSha256:sha,evidenceStatus:r.evidenceStatus,sourcePaths:r.sourcePaths,observed:r.observed,inferred:r.inferred,windowAllowed:false,facadeMode:'full-closed-face',artworkMapping:'single-face',baseColor:stats.channels.slice(0,3).map(c=>Math.round(c.mean)),baseColorBasis:'Generated own-photo-conditioned surface average, uncalibrated appearance, not measured albedo',bays:1,floors:1,bayWidth:3,floorHeight:3.2,photoCoverageCertified:false,generationMethod:r.generationMethod??r.selectedImage.tool,sourceMappingEvidence:r.sourceMappingEvidence??r.sourceEvidence,sourcePhotoDetails:r.sourcePhotoDetails??[],identityEvidence:r.identityEvidence??null,inferenceLimitations:'Source-limited: openings, physical material, and unobserved elevations are unconfirmed. No office-window grid added. Roofs never prove wall details.'});
 if(r.name||r.identityEvidence?.subject)p.name=r.name||({'bldg_e8f2f9e8-c821-4024-b1fb-0ee3915e4cfa':'スポーツコーナー トイレ','bldg_841ee649-4d3e-4e24-80fe-c27d38a52086':'水の広場リンレイトイレ'}[p.buildingId]??r.identityEvidence.subject);
 if(r.evidenceStatus==='photo-inferred')p.featureOneFace={secondaryUV:r.secondaryUV??(p.buildingId==='bldg_e8f2f9e8-c821-4024-b1fb-0ee3915e4cfa'?[.8,.05,.97,.9]:[.65,.1,.95,.9]),basis:'One door-bearing wall chosen by largest eligible wall area. Orientation and placement are inferred; all other faces extend the same generated plain wall region without repeating doors.'};
 provenance.push(r);
}
assert.equal(profiles.buildings.filter(p=>p.artwork).length,82);
profiles.version='photo-v3-20261018';profiles.generatedAt=new Date().toISOString();
profiles.centralAsset={path:'public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb',sha256:'36097e9604a487d6173052a3f49d1a87815af48fc809f40928df920693f259a6'};
profiles.inferencePolicy='Own-building observations only; hidden faces inferred from same-building appearance. 83 displayed does not mean 83 ground-photo-certified.';
await fs.writeFile(out+'/photo-profiles.json',JSON.stringify(profiles,null,2));
await fs.writeFile(audit+'/remaining-generation-provenance.json',JSON.stringify({count:46,results:provenance},null,2));
await fs.copyFile(old+'/scope-map.png',out+'/scope-map.png');
const baselineProvenance=JSON.parse(await fs.readFile(old+'/artwork-provenance.json','utf8'));
await fs.writeFile(out+'/artwork-provenance.json',JSON.stringify({schemaVersion:3,generatedAt:new Date().toISOString(),baseline:baselineProvenance,additionalOwnArtwork:provenance,buildingCount:83,ownArtworkBuildings:82,photoCoverageCertified:false},null,2));
console.log(JSON.stringify({buildings:profiles.buildings.length,artwork:82,existingPreserved:36,newInferred:46}));
