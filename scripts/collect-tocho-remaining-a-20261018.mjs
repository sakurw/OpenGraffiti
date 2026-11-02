import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const out='data/texture-city/tocho-district-photo-v3-20261018/remaining-a';
fs.mkdirSync(out,{recursive:true});
if(process.argv.includes('--inspect')){
 const results=JSON.parse(fs.readFileSync(path.join(out,'results.json'))).results;
 const tiles=[];
 for(let i=0;i<results.length;i++){const r=results[i];const left=i%5*230,top=Math.floor(i/5)*250;tiles.push({input:await sharp(r.selectedImage.path).resize(220,220).png().toBuffer(),left,top:top+25});tiles.push({input:Buffer.from(`<svg width="220" height="25"><rect width="220" height="25" fill="white"/><text x="5" y="19" font-size="18">index ${r.index}</text></svg>`),left,top});}
 await sharp({create:{width:1150,height:Math.ceil(results.length/5)*250,channels:3,background:'white'}}).composite(tiles).png().toFile(path.join(out,'output-inspection.png'));
 console.log('Inspection only: resized copies, original artwork untouched.');process.exit(0);
}
if(process.argv.includes('--finalize')){
 const plans=JSON.parse(fs.readFileSync(path.join(out,'plans.json')));
 const generations=JSON.parse(fs.readFileSync(path.join(out,'generation-records.json')));
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 const results=[];
 for(const g of generations){
  const p=plans.find(x=>x.index===g.index);
  const match=g.outputHint.match(/as (C:\\[^\r\n]+?\.png) by default/);
  if(!match)throw Error('Missing saved output '+g.index);
  const dest=path.join(out,'artwork',p.buildingId+'.png');fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(!fs.existsSync(dest))fs.copyFileSync(match[1],dest);
  const meta=await sharp(dest).metadata();
  const mappings=p.nativeMapping.walls.map(w=>({path:w.file,sourceImagePath:w.sourceImagePath,sourceImageSha256:w.sourceImageSha256,sourceGML:w.sourceGML,sourceGMLPolygon:w.sourceGMLPolygon,nativeUV:w.nativeUV,effectiveUVpixels:w.effectiveUVpixels,photoCoverageClaim:false}));
  const result={buildingId:p.buildingId,index:p.index,sourcePaths:p.sourcePaths,sourceMappingEvidence:mappings,evidenceStatus:'source-limited-inference',observed:g.observed,inferred:'Individually generated opaque surface conditioned on this exact building native photo samples. Physical wall material, openings, hidden elevations, and calibrated albedo remain unknown. Extending this image to hidden faces is permitted design inference, not observed photo coverage.',windowAllowed:false,photoCoverageCertified:false,bays:null,floors:null,referenceRoles:p.referenceRoles,prompt:g.prompt,generationMethod:'built-in imagegen; one independent call per building; own native wall photos only',generationSource:match[1],selectedImage:{path:dest.replaceAll('\\','/'),sha256:hash(dest),width:meta.width,height:meta.height},sha:hash(dest),profileSuggestions:{artwork:dest.replaceAll('\\','/'),windowAllowed:false,evidenceStatus:'source-limited-inference',baseColor:p.baseColor,baseColorBasis:'Existing v2 fallback RGB retained as uncalibrated prior; generated image carries own-photo conditioned appearance. Not a new measurement.',bays:null,floors:null,bayWidth:null,floorHeight:null,pitch:null,pattern:'opaque-sparse-photo-conditioned',applyToHiddenFaces:true,hiddenFacesStatus:'inferred',roofEvidence:p.roofEvidence?.photo?.path,roofUsedAsWallProof:false},inspection:{referenceInspection:'inspection-'+(Math.floor(plans.indexOf(p)/6)+1)+'.png',status:'own photos inspected before generation; generated outputs require visual audit'}};
  if(g.visualReview)result.inspection={...result.inspection,status:'reviewed',outputInspection:'output-inspection.png',...g.visualReview};
  results.push(result);
 }
 results.sort((a,b)=>a.index-b.index);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({schemaVersion:1,scope:'pending profiles numeric index <=33',expectedCount:plans.length,completedCount:results.length,allBuildingIdsDistinct:new Set(results.map(x=>x.buildingId)).size===results.length,sourceLimitations:'No extra ground photographs with verified exact-building mapping were assigned. Native UV identity proves source association, not clear facade visibility. Roof photographs are evidence only, not wall proof.',results},null,2));
 const errors=[];let originalHashChecks=0;
 for(const r of results){for(const ref of r.referenceRoles){if(!ref.path.includes(r.buildingId))errors.push('Cross-building reference '+r.index);if(hash(ref.path)!==ref.sha256)errors.push('Reference hash mismatch '+r.index);}for(const m of r.sourceMappingEvidence){if(fs.existsSync(m.sourceImagePath)){originalHashChecks++;if(hash(m.sourceImagePath)!==m.sourceImageSha256)errors.push('Original atlas hash mismatch '+r.index);}}if(hash(r.selectedImage.path)!==r.selectedImage.sha256)errors.push('Artwork hash mismatch '+r.index);}
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({completedCount:results.length,expectedCount:plans.length,originalHashChecks,exactOwnReferenceChecks:results.reduce((s,r)=>s+r.referenceRoles.length,0),uniqueArtworkHashes:new Set(results.map(r=>r.sha)).size,errors,fullyGenerated:results.length===plans.length,renderedModelChecked:false},null,2));
 console.log(JSON.stringify({expected:plans.length,completed:results.length,missing:plans.filter(p=>!results.some(r=>r.buildingId===p.buildingId)).map(p=>p.index)}));
 process.exit(0);
}
const profiles=JSON.parse(fs.readFileSync('public/assets/tocho-district-photo-v2-20261018/photo-profiles.json')).buildings.filter(p=>p.index<=33&&p.evidenceStatus==='insufficient');
const native=JSON.parse(fs.readFileSync('data/texture-city/tocho-district-photo-v2-20261018/native-photo-sources.json'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const plans=profiles.map(p=>({...p,referenceRoles:p.sourcePaths.map(file=>({path:file,role:'exact-building native wall UV photo; appearance evidence only; no window semantics',sha256:hash(file)})),nativeMapping:native.buildings.find(b=>b.buildingId===p.buildingId)}));
fs.writeFileSync(path.join(out,'plans.json'),JSON.stringify(plans,null,2));
for(let start=0;start<plans.length;start+=6){const batch=plans.slice(start,start+6);const tiles=[];for(let r=0;r<batch.length;r++){const p=batch[r];const label=Buffer.from(`<svg width="1200" height="28"><rect width="1200" height="28" fill="white"/><text x="5" y="20" font-size="16">index ${p.index} ${p.buildingId} | wall 1 | wall 2 | wall 3 | own roof</text></svg>`);tiles.push({input:label,left:0,top:r*225});for(let c=0;c<4;c++){const file=c<3?p.sourcePaths[c]:p.roofEvidence?.photo?.path;if(!file)continue;tiles.push({input:await sharp(file).resize(290,190,{fit:'contain',background:'#dddddd',kernel:'nearest'}).png().toBuffer(),left:c*300,top:r*225+30});}}await sharp({create:{width:1200,height:batch.length*225,channels:3,background:'white'}}).composite(tiles).png().toFile(path.join(out,`inspection-${start/6+1}.png`));}
console.log(JSON.stringify({count:plans.length,indices:plans.map(p=>p.index),out}));
