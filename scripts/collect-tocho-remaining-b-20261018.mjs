import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const root='data/texture-city/tocho-district-photo-v3-20261018/remaining-b';
const profilePath='public/assets/tocho-district-photo-v2-20261018/photo-profiles.json';
const nativePath='data/texture-city/tocho-district-photo-v2-20261018/native-photo-sources.json';
const profiles=JSON.parse(await fs.readFile(profilePath));
const native=JSON.parse(await fs.readFile(nativePath));
await fs.mkdir(`${root}/inspection`,{recursive:true});
await fs.mkdir(`${root}/artwork`,{recursive:true});
await fs.mkdir(`${root}/source-collection`,{recursive:true});
const entries=[];
for(const b of profiles.buildings.filter(b=>b.index>33&&b.evidenceStatus==='insufficient')){
 const n=native.buildings.find(n=>n.buildingId===b.buildingId);
 const refs=b.sourcePaths.filter(p=>p.includes('native-inputs/'));
 const tiles=[];
 for(let i=0;i<refs.length;i++) tiles.push({input:await sharp(refs[i]).resize(384,256,{fit:'contain',background:'#ffffff',kernel:'nearest'}).png().toBuffer(),left:i*384,top:0});
 const sheet=`${root}/inspection/${b.index}.png`;
 await sharp({create:{width:Math.max(1,refs.length)*384,height:256,channels:3,background:'#ffffff'}}).composite(tiles).png().toFile(sheet);
 const sourceEvidence=[];
 for(const p of refs){let w=n.walls.find(w=>w.file===p);sourceEvidence.push({path:p,sha256:crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex'),role:'exact same-building native WallSurface polygon photo; appearance only; window semantics unconfirmed',sourceImagePath:w.sourceImagePath,sourceImageSha256:w.sourceImageSha256,sourceGML:w.sourceGML,polygonId:w.sourceGMLPolygon,nativeUV:w.nativeUV,analysis:w.analysis});}
 const entry={buildingId:b.buildingId,index:b.index,name:b.name,sourcePaths:refs,sourceEvidence,inspectionPath:sheet,evidenceStatus:'source-limited-inference',observed:'Same-building original native wall texels; individual windows, bays, floors and calibrated albedo cannot be confirmed at this resolution.',inferred:'Conservative opaque illustrated surface extrapolation to unobserved walls; no inferred window grid, floor count or physical material identity.',windowAllowed:false,photoCoverageCertified:false,roofEvidence:b.roofEvidence,selectedImage:null,profileSuggestions:{windowAllowed:false,bays:null,floors:null,bayWidth:null,floorHeight:null,baseColor:null,photoCoverageCertified:false}};
 entries.push(entry);
}
await fs.writeFile(`${root}/jobs.json`,JSON.stringify({schemaVersion:1,profilePath,nativePath,entries},null,2));
console.log(JSON.stringify(entries.map(e=>({index:e.index,buildingId:e.buildingId,inspectionPath:e.inspectionPath}))));
