import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const out='public/assets/tocho-district-photo-v2-20261018',dir='data/texture-city/tocho-district-photo-v2-20261018';
const p=JSON.parse(await fs.readFile(out+'/photo-profiles.json','utf8'));
const roofs=JSON.parse(await fs.readFile(dir+'/own-roof-materials.json','utf8'));
let applied=0;
for(const b of p.buildings){
 const r=roofs.buildings.find(r=>r.buildingId===b.buildingId);if(!r)continue;
 b.roofEvidence={status:r.status,photo:r.photo,source:r.source,polygonId:r.polygonId,observed:r.materialConditioning.roof,review:r.visualReview};
 if(r.materialConditioning.roof.roofColorUsable){
  b.roofColor=r.colors.robustMedianRGB;
  b.roofColorBasis='Own semantic RoofSurface native UV photo; reviewed appearance color, not calibrated physical material. Seams are code-native inference.';applied++;
 }
 if(b.artwork)b.artworkSha256=crypto.createHash('sha256').update(await fs.readFile(out+'/'+b.artwork)).digest('hex');
 if([34,68].includes(b.index))b.masonrySideCap=2.6;
}
p.counts.photoRoofAppearanceColors=applied;
p.acceptance={all83WallPhotoGrounded:false,wallPhotoMissing:p.buildings.filter(b=>b.evidenceStatus==='insufficient').map(b=>b.buildingId),humanAppearanceApproved:false};
await fs.writeFile(out+'/photo-profiles.json',JSON.stringify(p,null,2));
await fs.writeFile(dir+'/photo-profiles.json',JSON.stringify(p,null,2));
// The profile's current crop is authoritative after manual single-storey fixes.
const finalCrops=p.buildings.filter(b=>b.artwork).map(b=>({buildingId:b.buildingId,index:b.index,rect:b.moduleCrop,artworkSha256:b.artworkSha256,mapping:b.artworkMapping??'physical-repeat'}));
await fs.writeFile(dir+'/module-crops.json',JSON.stringify(finalCrops,null,2));
// Final provenance includes the actual selected retry prompts and module crops.
await fs.writeFile(out+'/artwork-provenance.json',JSON.stringify({createdAt:new Date().toISOString(),profiles:p,generated:JSON.parse(await fs.readFile(dir+'/generated-results.json','utf8')),crops:JSON.parse(await fs.readFile(dir+'/module-crops.json','utf8')),landmarks:JSON.parse(await fs.readFile(dir+'/landmark-sources.json','utf8')),park:JSON.parse(await fs.readFile(dir+'/park-sources.json','utf8'))},null,2));
console.log(JSON.stringify(p.counts));
