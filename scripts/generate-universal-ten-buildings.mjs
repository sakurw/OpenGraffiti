import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import proj4 from 'proj4';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {triangulate,sub,cross,CRS,GEO} from './plateau-geometry.mjs';

const selection=JSON.parse(await readFile('scripts/universal-ten-building-selection.json','utf8'));
const geometry=JSON.parse(await readFile(selection.geometryPath,'utf8'));
const semanticsReport=JSON.parse(await readFile('data/texture-city/universal-ten-buildings/semantics.json','utf8'));
const discovery=JSON.parse(await readFile('data/texture-city/universal-ten-buildings/source-discovery.json','utf8'));
const maximizedSources=JSON.parse(await readFile('data/texture-city/universal-ten-buildings/source-maximized.json','utf8'));
const output='public/assets/universal-ten-building';
const appearanceRoot=path.dirname(selection.cityGmlPath);
const reference=geometry.buildings.find(item=>item.id===selection.criteria.referenceBuildingId);
if(!reference)throw Error('Reference landmark is absent from geometry');
await mkdir(output,{recursive:true});

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clamp=(value,minimum=0,maximum=1)=>Math.max(minimum,Math.min(maximum,value));
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const rgbMedian=pixels=>[0,1,2].map(channel=>median(pixels.map(pixel=>pixel[channel])));
const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
const blend=(left,right,leftWeight=.65)=>left.map((value,index)=>value*leftWeight+right[index]*(1-leftWeight));
const mute=(rgb,amount=.72)=>{const neutral=luminance(rgb);return rgb.map(value=>value*(1-amount)+neutral*amount);};
const srgbToLinear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
const linearFactor=rgb=>[...rgb.map(value=>srgbToLinear(clamp(value))),1];
const toHex=rgb=>`#${rgb.map(value=>Math.round(clamp(value)*255).toString(16).padStart(2,'0')).join('')}`;
const geometryArea=shape=>{let sum=0;for(let index=0;index<shape.indices.length;index+=3){const [a,b,c]=shape.indices.slice(index,index+3).map(i=>shape.points[i]);sum+=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;}return sum;};
const localCenter=building=>[0,1,2].map(axis=>(building.min[axis]+building.max[axis])/2);
const referenceCenter=localCenter(reference);
const pointInRing=(point,ring)=>{let inside=false;for(let left=0,right=ring.length-1;left<ring.length;right=left++){const [xi,yi]=ring[left],[xj,yj]=ring[right];if(((yi>point[1])!==(yj>point[1]))&&(point[0]<(xj-xi)*(point[1]-yi)/(yj-yi+1e-20)+xi))inside=!inside;}return inside;};
const pointInRings=(point,rings)=>pointInRing(point,rings[0])&&!rings.slice(1).some(ring=>pointInRing(point,ring));
const distanceToSegment=(point,start,end)=>{const direction=[end[0]-start[0],end[1]-start[1]],scale=direction[0]**2+direction[1]**2,ratio=scale<1e-12?0:clamp(((point[0]-start[0])*direction[0]+(point[1]-start[1])*direction[1])/scale);return Math.hypot(point[0]-start[0]-ratio*direction[0],point[1]-start[1]-ratio*direction[1]);};
function convexHull(points){
 const sorted=[...new Map(points.map(point=>[`${point[0].toFixed(4)},${point[1].toFixed(4)}`,point])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(sorted.length<=2)return sorted;
 const turn=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const lower=[];for(const point of sorted){while(lower.length>=2&&turn(lower.at(-2),lower.at(-1),point)<=0)lower.pop();lower.push(point);}
 const upper=[];for(const point of [...sorted].reverse()){while(upper.length>=2&&turn(upper.at(-2),upper.at(-1),point)<=0)upper.pop();upper.push(point);}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const quadrant=normal=>Math.abs(normal[0])>=Math.abs(normal[2])?(normal[0]>=0?0:2):(normal[2]>=0?1:3);
const imageCache=new Map();
async function loadAppearance(relative){
 if(imageCache.has(relative))return imageCache.get(relative);
 const file=path.join(appearanceRoot,...relative.split('/')),bytes=await readFile(file);
 const converted=await sharp(bytes).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
 const record={file,bytes,width:converted.info.width,height:converted.info.height,channels:converted.info.channels,data:converted.data,sha256:sha256(bytes)};
 imageCache.set(relative,record);return record;
}
async function sampleAppearance(polygonId){
 const texture=geometry.textures?.[polygonId];if(!texture)return null;
 const rings=Object.values(texture.rings??{}).map(values=>{const pairs=[];for(let index=0;index<values.length;index+=2)pairs.push([values[index],values[index+1]]);if(pairs.length>1&&Math.hypot(pairs[0][0]-pairs.at(-1)[0],pairs[0][1]-pairs.at(-1)[1])<1e-8)pairs.pop();return pairs;}).filter(ring=>ring.length>=3);
 if(!rings.length)return null;
 const image=await loadAppearance(texture.image),all=rings.flat();
 const minU=clamp(Math.min(...all.map(point=>point[0]))),maxU=clamp(Math.max(...all.map(point=>point[0]))),minV=clamp(Math.min(...all.map(point=>point[1]))),maxV=clamp(Math.max(...all.map(point=>point[1])));
 if(maxU-minU<1e-6||maxV-minV<1e-6)return null;
 const grid=48,cells=new Map(),pixels=[];
 for(let row=0;row<grid;row++)for(let column=0;column<grid;column++){
  const u=minU+(maxU-minU)*(column+.5)/grid,v=minV+(maxV-minV)*(row+.5)/grid;
  if(!pointInRings([u,v],rings))continue;
  const x=Math.max(0,Math.min(image.width-1,Math.round(u*(image.width-1)))),y=Math.max(0,Math.min(image.height-1,Math.round((1-v)*(image.height-1)))),offset=(y*image.width+x)*image.channels;
  const rgb=[image.data[offset],image.data[offset+1],image.data[offset+2]].map(value=>value/255);
  if(Math.max(...rgb)<.045||Math.min(...rgb)>.975)continue;
  pixels.push(rgb);cells.set(`${column},${row}`,luminance(rgb));
 }
 if(pixels.length<12)return null;
 const ordered=[...pixels].sort((left,right)=>luminance(left)-luminance(right)),portion=Math.max(4,Math.floor(ordered.length*.28));
 const darkRgb=rgbMedian(ordered.slice(0,portion)),lightRgb=rgbMedian(ordered.slice(-portion)),medianRgb=rgbMedian(pixels),contrast=luminance(lightRgb)-luminance(darkRgb);
 let edgePairs=0,edges=0;
 for(const [key,value] of cells){const [column,row]=key.split(',').map(Number);for(const neighbor of [`${column+1},${row}`,`${column},${row+1}`])if(cells.has(neighbor)){edgePairs++;if(Math.abs(value-cells.get(neighbor))>.055)edges++;}}
 const insideRatio=pixels.length/(grid*grid),estimatedPixels=Math.max(pixels.length,Math.round((maxU-minU)*(maxV-minV)*image.width*image.height*insideRatio));
 const confidence=clamp(.56+Math.min(.16,Math.log10(Math.max(10,estimatedPixels))*.035)+Math.min(.08,contrast*.28),.5,.82);
 const left=Math.max(0,Math.floor(minU*(image.width-1))),top=Math.max(0,Math.floor((1-maxV)*(image.height-1))),right=Math.min(image.width,Math.ceil(maxU*(image.width-1))+1),bottom=Math.min(image.height,Math.ceil((1-minV)*(image.height-1))+1);
 return {sourceImage:texture.image,sourcePath:image.file,sourceSha256:image.sha256,validSampleCount:pixels.length,estimatedPixelCount:estimatedPixels,medianRgb,darkRgb,lightRgb,contrast,edgeDensity:edgePairs?edges/edgePairs:0,colorConfidence:confidence,crop:{left,top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)}};
}
function plateauTextureMapping(polygon){
 const texture=geometry.textures?.[polygon.id];if(!texture?.image)return null;
 const uv=[];
 for(const ring of polygon.rings){
  const values=texture.rings?.[ring.id];
  if(!values||values.length<ring.points.length*2)return null;
  for(let index=0;index<ring.points.length;index++)uv.push(clamp(values[index*2]),clamp(1-values[index*2+1]));
 }
 return {sourceImage:texture.image,uv};
}
function fallbackSemantic(record,building){
 if(record.isWall)return {semanticClass:'WallSurface',semanticSource:'PLATEAU geometry wall membership',semanticConfidence:.96};
 const vertical=Math.abs(record.shape.normal[1]),centerY=record.center[1];
 if(centerY<=building.min[1]+.5)return {semanticClass:'GroundSurface',semanticSource:'geometry fallback at building minimum',semanticConfidence:.72};
 if(vertical>.55)return {semanticClass:'RoofSurface',semanticSource:'geometry fallback from horizontal normal',semanticConfidence:.72};
 return {semanticClass:'OuterBuildingInstallation',semanticSource:'geometry fallback for non-wall roof object',semanticConfidence:.42,exactEquipmentTypeAvailable:false};
}
function patternPng(assignment,record){
 const rows=Math.max(2,Math.min(18,Math.round(record.height/3.25))),bays=Math.max(1,Math.min(18,Math.round(record.width/3.1)));
 const base=toHex(assignment.baseRgb),glass=toHex(assignment.glassRgb),line=toHex(blend(assignment.baseRgb,[1,1,1],.72));
 let shapes=`<rect width="128" height="128" fill="${base}"/>`;
 const rowHeight=128/rows;
 for(let row=0;row<rows;row++){
  const y=row*rowHeight+rowHeight*.16,height=rowHeight*.57;
  shapes+=`<rect x="2" y="${y.toFixed(2)}" width="124" height="${height.toFixed(2)}" rx="0.5" fill="${glass}"/>`;
  shapes+=`<rect x="2" y="${(y+height*.10).toFixed(2)}" width="124" height="${Math.max(.35,height*.06).toFixed(2)}" fill="${line}" opacity="0.35"/>`;
  for(let bay=1;bay<bays;bay++){const x=2+124*bay/bays;shapes+=`<rect x="${(x-.45).toFixed(2)}" y="${y.toFixed(2)}" width="0.9" height="${height.toFixed(2)}" fill="${base}" opacity="0.88"/>`;}
 }
 return sharp(Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`)).png().toBuffer();
}
async function evidencePreview(records,targetPath){
 const chosen=records.filter(record=>record.appearance).sort((left,right)=>(right.semantic.semanticClass==='WallSurface')-(left.semantic.semanticClass==='WallSurface')||right.appearance.estimatedPixelCount-left.appearance.estimatedPixelCount).slice(0,4);
 const tiles=[];
 for(let index=0;index<4;index++){
  const record=chosen[index%chosen.length];
  if(!record)break;
  const crop=record.appearance.crop;
  const image=await sharp(record.appearance.sourcePath).extract(crop).resize(320,180,{fit:'cover'}).modulate({saturation:.75}).jpeg({quality:86}).toBuffer();
  const caption=Buffer.from(`<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect y="150" width="320" height="30" fill="#10252b" opacity=".82"/><text x="10" y="170" fill="white" font-family="sans-serif" font-size="13">${record.semantic.semanticClass} / appearance evidence ${index+1}</text></svg>`);
  tiles.push(await sharp(image).composite([{input:caption}]).jpeg({quality:88}).toBuffer());
 }
 const composites=tiles.map((input,index)=>({input,left:(index%2)*320,top:Math.floor(index/2)*180}));
 await sharp({create:{width:640,height:360,channels:3,background:'#dfe7e2'}}).composite(composites).jpeg({quality:88}).toFile(targetPath);
}
async function externalEvidencePreview(sourceReport,targetPath){
 const evidence=sourceReport.inference.evidence.slice(0,4),tiles=[];
 for(let index=0;index<4;index++){
  const item=evidence[index%evidence.length];if(!item)break;
  const image=await sharp(item.file).resize(320,180,{fit:'cover'}).modulate({saturation:.82}).jpeg({quality:86}).toBuffer(),caption=Buffer.from(`<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect y="150" width="320" height="30" fill="#10252b" opacity=".84"/><text x="10" y="170" fill="white" font-family="sans-serif" font-size="13">${item.provider} candidate ${index+1}</text></svg>`);
  tiles.push(await sharp(image).composite([{input:caption}]).jpeg({quality:88}).toBuffer());
 }
 if(!tiles.length)return null;
 await sharp({create:{width:640,height:360,channels:3,background:'#dfe7e2'}}).composite(tiles.map((input,index)=>({input,left:(index%2)*320,top:Math.floor(index/2)*180}))).jpeg({quality:88}).toFile(targetPath);return targetPath;
}

const semanticByBuilding=new Map(semanticsReport.buildings.map(item=>[item.buildingId,item]));
const discoveryByBuilding=new Map(discovery.buildings.map(item=>[item.buildingId,item]));
const maximizedByBuilding=new Map(maximizedSources.buildings.map(item=>[item.buildingId,item]));
const batchBuildings=[];
const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);
for(const item of selection.buildings){
 const building=geometry.buildings.find(candidate=>candidate.id===item.buildingId),semanticBuilding=semanticByBuilding.get(item.buildingId),sourceDiscovery=discoveryByBuilding.get(item.buildingId),expandedSources=maximizedByBuilding.get(item.buildingId);
 if(!building||!semanticBuilding||!sourceDiscovery||!expandedSources)throw Error(`Incomplete input for ${item.buildingId}`);
 const center=localCenter(building),distance=Math.hypot(center[0]-referenceCenter[0],center[2]-referenceCenter[2]),height=building.max[1]-building.min[1],rawAppearanceCoverage=building.polygons.filter(polygon=>geometry.textures?.[polygon.id]).length/building.polygons.length;
 if(building.name||semanticBuilding.name||building.lod!==selection.criteria.lod||height<selection.criteria.heightMetres[0]||height>selection.criteria.heightMetres[1]||distance<selection.criteria.distanceMetres[0]||distance>selection.criteria.distanceMetres[1]||rawAppearanceCoverage<selection.criteria.minimumAppearanceCoverage)throw Error(`Selection policy failed for ${item.buildingId}`);
 const walls=new Set(building.walls.map(wall=>wall.id)),exactSemantics=semanticBuilding.polygonSemantics;
 const records=[];
 for(const polygon of building.polygons){
  const shape=triangulate(polygon.rings.map(ring=>ring.points));if(!shape.indices.length)continue;
  const points=shape.points,minimum=[0,1,2].map(axis=>Math.min(...points.map(point=>point[axis]))),maximum=[0,1,2].map(axis=>Math.max(...points.map(point=>point[axis]))),record={polygon,shape,isWall:walls.has(polygon.id),area:geometryArea(shape),minimum,maximum,center:[0,1,2].map(axis=>(minimum[axis]+maximum[axis])/2),width:Math.max(maximum[0]-minimum[0],maximum[2]-minimum[2]),height:maximum[1]-minimum[1]};
  record.semantic=exactSemantics[polygon.id]??fallbackSemantic(record,building);
  record.plateauTexture=plateauTextureMapping(polygon);
  record.appearance=await sampleAppearance(polygon.id);
  records.push(record);
 }
 for(const record of records.filter(candidate=>candidate.isWall)){
  const middle=record.center[1],levelPoints=records.filter(candidate=>candidate.isWall&&candidate.minimum[1]-1e-6<=middle&&candidate.maximum[1]+1e-6>=middle).flatMap(candidate=>candidate.shape.points.map(point=>[point[0],point[2]])),hull=convexHull(levelPoints),wallCenter=[record.center[0],record.center[2]];
  record.hullInset=hull.length>=2?Math.min(...hull.map((point,index)=>distanceToSegment(wallCenter,point,hull[(index+1)%hull.length]))):Infinity;
  record.quadrant=quadrant(record.shape.normal);
 }
 const classPalettes=new Map();
 for(const [semanticClass,classRecords] of Map.groupBy(records.filter(record=>record.appearance),record=>record.semantic.semanticClass))classPalettes.set(semanticClass,rgbMedian(classRecords.map(record=>record.appearance.medianRgb)));
 const patternDonors=[];
 for(const record of records.filter(candidate=>candidate.isWall&&candidate.appearance)){
  record.patternEligible=record.width>=4.5&&record.height>=5.5&&record.hullInset<=2.25&&record.appearance.contrast>=.055&&record.appearance.edgeDensity>=.018;
  if(record.patternEligible)patternDonors.push(record);
 }
 const assignments=[];
 for(const record of records){
  const semanticClass=record.semantic.semanticClass,classPalette=classPalettes.get(semanticClass),direct=record.appearance,groundConsensus=expandedSources.inference.groundConsensus,roofConsensus=expandedSources.inference.roofConsensus,groundRgb=groundConsensus?.rgb,roofRgb=roofConsensus?.rgb;
  let assignment;
  if(record.isWall){
   const donor=!direct&&record.width>=4.5&&record.height>=5.5&&record.hullInset<=2.25?patternDonors.filter(candidate=>candidate.quadrant===record.quadrant).sort((left,right)=>right.appearance.colorConfidence-left.appearance.colorConfidence)[0]:null;
   const source=direct??donor?.appearance,applyPattern=Boolean((direct&&record.patternEligible)||donor);
   if(source&&applyPattern){
    const palette=classPalette??source.medianRgb,baseRgb=blend(source.lightRgb,palette,.58),glassSeed=blend(source.darkRgb,palette,.82),glassLuma=luminance(glassSeed),baseLuma=luminance(baseRgb),glassRgb=baseLuma-glassLuma<.075?glassSeed.map(value=>value*.72):glassSeed;
    assignment={provenance:direct?'plateau-appearance-derived-facade-pattern':'same-building-direction-pattern-transfer',confidence:direct?source.colorConfidence*.9:.48,colorEvidence:direct?'direct-plateau-appearance-uv-samples':'same-building-same-direction-image-pattern',pattern:true,baseRgb,glassRgb,sourceImage:source.sourceImage,directlyObserved:Boolean(direct),patternPolicy:direct?'geometry-eligible-direct-image-pattern':'geometry-eligible-directional-transfer'};
   }else if(direct){
    assignment={provenance:'plateau-appearance-solid-wall',confidence:direct.colorConfidence,colorEvidence:'direct-plateau-appearance-uv-samples',pattern:false,baseRgb:blend(direct.medianRgb,classPalette??direct.medianRgb,.68),sourceImage:direct.sourceImage,directlyObserved:true,patternPolicy:record.hullInset>2.25?'suppressed-on-recessed-wall':'insufficient-image-periodicity'};
   }else if(classPalette||groundRgb){
    const baseRgb=classPalette&&groundRgb?blend(classPalette,groundRgb,.62):classPalette??groundRgb,estimatedPattern=Boolean(!donor&&groundConsensus?.sourceCount>=3&&groundConsensus.edgeDensity>=.035&&record.width>=4.5&&record.height>=5.5&&record.hullInset<=2.25),glassRgb=baseRgb.map(value=>value*.67);
    assignment={provenance:classPalette&&groundRgb?'same-building-palette-plus-external-ground-consensus':classPalette?'same-building-wall-palette-transfer':'external-ground-multi-image-consensus-inference',confidence:classPalette ? 0.5 : clamp(.34+(groundConsensus?.sourceCount??0)*.012,.34,.48),colorEvidence:classPalette&&groundRgb?'plateau-class-palette-and-gps-heading-consensus':classPalette?'same-building-wall-appearance-palette':'gps-heading-multi-image-consensus',pattern:estimatedPattern,baseRgb,glassRgb,sourceImage:groundRgb?`external-ground-consensus:${groundConsensus.sourceCount}`:null,directlyObserved:false,patternPolicy:estimatedPattern?'geometry-and-multi-image-inferred-facade-pattern':'no-direct-surface-image',inferenceSourceCount:groundConsensus?.sourceCount??0};
   }else assignment={provenance:'semantic-class-prior-only',confidence:.22,colorEvidence:'semantic-prior',pattern:false,baseRgb:[.46,.49,.48],sourceImage:null,directlyObserved:false,patternPolicy:'no-image-evidence'};
  }else if(direct){
   const equipment=semanticClass==='OuterBuildingInstallation',color=equipment?mute(direct.medianRgb):blend(direct.medianRgb,classPalette??direct.medianRgb,.72);
   assignment={provenance:'plateau-appearance-robust-palette',confidence:direct.colorConfidence,colorEvidence:'direct-plateau-appearance-uv-samples',pattern:false,baseRgb:color,sourceImage:direct.sourceImage,directlyObserved:true,stylingPolicy:equipment?'preserve luminance and reduce chroma 72%':'robust palette stabilization'};
  }else if(semanticClass==='RoofSurface'&&(classPalette||roofRgb)){
   assignment={provenance:classPalette&&roofRgb?'same-semantic-plus-gsi-roof-consensus':'gsi-orthophoto-roof-inference',confidence:classPalette ? 0.5 : 0.4,colorEvidence:classPalette&&roofRgb?'plateau-class-palette-and-gsi-orthophoto':'gsi-orthophoto-coordinate-sample',pattern:false,baseRgb:classPalette&&roofRgb?blend(classPalette,roofRgb,.58):classPalette??roofRgb,sourceImage:roofRgb?`gsi-roof-consensus:${roofConsensus.sourceCount}`:null,directlyObserved:false,inferenceSourceCount:roofConsensus?.sourceCount??0};
  }else if(classPalette||groundRgb||roofRgb){
   const inferred=classPalette??groundRgb??roofRgb,color=semanticClass==='OuterBuildingInstallation'?mute(inferred):inferred;
   assignment={provenance:classPalette?'same-semantic-class-palette-transfer':'external-image-attribute-inference',confidence:classPalette ? 0.5 : 0.35,colorEvidence:classPalette?'same-building-semantic-class-image-palette':'external-image-consensus',pattern:false,baseRgb:color,sourceImage:groundRgb?`external-ground-consensus:${groundConsensus.sourceCount}`:roofRgb?`gsi-roof-consensus:${roofConsensus.sourceCount}`:null,directlyObserved:false,inferenceSourceCount:groundConsensus?.sourceCount??roofConsensus?.sourceCount??0};
  }else assignment={provenance:'semantic-class-prior-only',confidence:.22,colorEvidence:'semantic-prior',pattern:false,baseRgb:semanticClass==='GroundSurface'?[.35,.36,.34]:[.48,.49,.47],sourceImage:null,directlyObserved:false};
 record.assignment=assignment;assignments.push(assignment);
 }
 for(const record of records){
  const semanticClass=record.semantic.semanticClass,groundConsensus=expandedSources.inference.groundConsensus,roofConsensus=expandedSources.inference.roofConsensus,groundRgb=groundConsensus?.rgb,roofRgb=roofConsensus?.rgb;
  let assignment;
  if(record.isWall&&groundRgb){
   const sourceCount=groundConsensus.sourceCount??0,providerCount=Object.keys(groundConsensus.providers??{}).length,pattern=sourceCount>=3&&groundConsensus.edgeDensity>=.035&&record.width>=4.5&&record.height>=5.5&&record.hullInset<=2.25,baseRgb=groundRgb,glassRgb=blend(groundRgb,[.08,.13,.16],.44);
   assignment={provenance:'external-first-ground-consensus',confidence:clamp(.38+Math.log10(Math.max(1,sourceCount))*.07+Math.min(.05,providerCount*.02),.38,.56),colorEvidence:'mapillary-kartaview-gps-heading-multi-image-consensus',pattern,baseRgb,glassRgb,sourceImage:`external-ground-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,patternPolicy:pattern?'external-consensus-plus-geometry-facade-pattern':'external-consensus-solid-wall',evidencePriority:'external-first'};
  }else if(semanticClass==='RoofSurface'&&roofRgb){
   const sourceCount=roofConsensus.sourceCount??0;
   assignment={provenance:'external-first-gsi-orthophoto-roof',confidence:clamp(.48+sourceCount*.025,.48,.58),colorEvidence:'gsi-coordinate-matched-orthophoto-consensus',pattern:false,baseRgb:roofRgb,sourceImage:`gsi-roof-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,evidencePriority:'external-first'};
  }else if(semanticClass==='GroundSurface'&&(roofRgb||groundRgb)){
   const sourceCount=roofRgb?(roofConsensus.sourceCount??0):(groundConsensus.sourceCount??0),color=roofRgb??groundRgb;
   assignment={provenance:'external-first-aerial-ground-context',confidence:.42,colorEvidence:roofRgb?'gsi-coordinate-matched-orthophoto-consensus':'external-ground-consensus',pattern:false,baseRgb:mute(color,.48),sourceImage:roofRgb?`gsi-roof-consensus:${sourceCount}`:`external-ground-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,evidencePriority:'external-first'};
  }else if(semanticClass==='OuterBuildingInstallation'&&(roofRgb||groundRgb)){
   const sourceCount=roofRgb?(roofConsensus.sourceCount??0):(groundConsensus.sourceCount??0),color=mute(roofRgb??groundRgb,.82).map(value=>value*.82);
   assignment={provenance:'external-first-equipment-context',confidence:.39,colorEvidence:roofRgb?'gsi-roof-context-plus-equipment-attribute':'external-ground-context-plus-equipment-attribute',pattern:false,baseRgb:color,sourceImage:roofRgb?`gsi-roof-consensus:${sourceCount}`:`external-ground-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,stylingPolicy:'external context luminance; chroma reduced 82%; equipment de-emphasized',evidencePriority:'external-first'};
  }else if(groundRgb||roofRgb){
   const sourceCount=groundRgb?(groundConsensus.sourceCount??0):(roofConsensus.sourceCount??0),color=groundRgb??roofRgb;
   assignment={provenance:'external-first-attribute-inference',confidence:.34,colorEvidence:'external-image-consensus-plus-semantic-class',pattern:false,baseRgb:semanticClass==='OuterBuildingInstallation'?mute(color,.82):color,sourceImage:groundRgb?`external-ground-consensus:${sourceCount}`:`gsi-roof-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,evidencePriority:'external-first'};
  }else{
   assignment={provenance:'external-first-semantic-prior-fallback',confidence:.18,colorEvidence:'semantic-prior-no-external-image',pattern:false,baseRgb:semanticClass==='GroundSurface'?[.35,.36,.34]:[.48,.49,.47],sourceImage:null,directlyObserved:false,inferenceSourceCount:0,evidencePriority:'semantic-fallback'};
  }
 record.externalFirstAssignment=assignment;
 }
 for(const record of records){
  const semanticClass=record.semantic.semanticClass,classPalette=classPalettes.get(semanticClass),direct=record.appearance,groundConsensus=expandedSources.inference.groundCorrectedConsensus,roofConsensus=expandedSources.inference.roofCorrectedConsensus,groundRgb=groundConsensus?.rgb,roofRgb=roofConsensus?.rgb;
  let assignment;
  if(semanticClass==='OuterBuildingInstallation'&&(direct||classPalette)){
   const sourceRgb=direct?.medianRgb??classPalette,baseRgb=mute(sourceRgb,.72);
   assignment={provenance:direct?'software-corrected-plateau-equipment-direct':'software-corrected-plateau-equipment-group-transfer',confidence:direct?direct.colorConfidence:.5,colorEvidence:direct?'plateau-equipment-appearance-robust-palette':'plateau-equipment-semantic-group-palette',pattern:false,baseRgb,sourceImage:direct?.sourceImage??'plateau-equipment-group-palette',directlyObserved:Boolean(direct),inferenceSourceCount:direct?1:0,stylingPolicy:'PLATEAU equipment luminance retained; chroma reduced 72%',evidencePriority:'external-first-with-plateau-equipment',softwareProcessing:'robust-median-plus-equipment-chroma-muting'};
  }else if(record.isWall&&groundRgb){
   const sourceCount=groundConsensus.sourceCount??0,pattern=sourceCount>=3&&record.width>=4.5&&record.height>=5.5&&record.hullInset<=2.25,baseRgb=groundRgb,glassRgb=blend(baseRgb,[.10,.15,.18],.55);
   assignment={provenance:'software-corrected-external-wall-albedo',confidence:clamp(.43+Math.log10(Math.max(1,sourceCount))*.065,.43,.57),colorEvidence:'retinex-flattened-exposure-harmonized-ground-consensus',pattern,baseRgb,glassRgb,sourceImage:`external-ground-corrected-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,patternPolicy:pattern?'corrected-albedo-plus-geometry-facade-pattern':'corrected-albedo-solid-wall',evidencePriority:'external-first-with-plateau-equipment',softwareProcessing:groundConsensus.method};
  }else if(semanticClass==='RoofSurface'&&roofRgb){
   const sourceCount=roofConsensus.sourceCount??0;
   assignment={provenance:'software-corrected-gsi-roof-albedo',confidence:clamp(.52+sourceCount*.025,.52,.61),colorEvidence:'retinex-flattened-coordinate-matched-gsi-consensus',pattern:false,baseRgb:roofRgb,sourceImage:`gsi-roof-corrected-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,evidencePriority:'external-first-with-plateau-equipment',softwareProcessing:roofConsensus.method};
  }else if(semanticClass==='GroundSurface'&&(roofRgb||groundRgb)){
   const sourceCount=roofRgb?(roofConsensus.sourceCount??0):(groundConsensus.sourceCount??0),baseRgb=mute(roofRgb??groundRgb,.4);
   assignment={provenance:'software-corrected-aerial-ground-context',confidence:.44,colorEvidence:'corrected-external-context',pattern:false,baseRgb,sourceImage:roofRgb?`gsi-roof-corrected-consensus:${sourceCount}`:`external-ground-corrected-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,evidencePriority:'external-first-with-plateau-equipment',softwareProcessing:(roofConsensus??groundConsensus).method};
  }else if(groundRgb||roofRgb){
   const sourceCount=groundRgb?(groundConsensus.sourceCount??0):(roofConsensus.sourceCount??0),baseRgb=groundRgb??roofRgb;
   assignment={provenance:'software-corrected-external-attribute-inference',confidence:.37,colorEvidence:'corrected-external-consensus-plus-semantic-class',pattern:false,baseRgb,sourceImage:groundRgb?`external-ground-corrected-consensus:${sourceCount}`:`gsi-roof-corrected-consensus:${sourceCount}`,directlyObserved:false,inferenceSourceCount:sourceCount,evidencePriority:'external-first-with-plateau-equipment',softwareProcessing:(groundConsensus??roofConsensus).method};
  }else{
   assignment={provenance:'software-corrected-semantic-prior-fallback',confidence:.18,colorEvidence:'semantic-prior-no-image',pattern:false,baseRgb:semanticClass==='GroundSurface'?[.35,.36,.34]:[.48,.49,.47],sourceImage:null,directlyObserved:false,inferenceSourceCount:0,evidencePriority:'semantic-fallback',softwareProcessing:'none'};
  }
  record.softwareCorrectedAssignment=assignment;
 }
 const slug=`building-${String(item.ordinal).padStart(2,'0')}`,translation=[center[0],building.min[1],center[2]],signature=createHash('sha256');
 for(const record of records){signature.update(record.polygon.id);signature.update(JSON.stringify(record.shape.points.map(point=>point.map((value,axis)=>value-translation[axis]))));signature.update(JSON.stringify(record.shape.indices));}
 const geometrySignature=signature.digest('hex');
 async function makeModel(mode){
 const document=new Document(),buffer=document.createBuffer(),unlit=document.createExtension(KHRMaterialsUnlit),scene=document.createScene(`${item.label} ${mode}`),materialCache=new Map();
  const accessor=(name,type,values,ArrayType=Float32Array)=>document.createAccessor(name).setType(type).setArray(new ArrayType(values)).setBuffer(buffer);
  const solidMaterial=(key,rgb)=>{if(materialCache.has(key))return materialCache.get(key);const material=document.createMaterial(key).setBaseColorFactor(linearFactor(rgb)).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());materialCache.set(key,material);return material;};
  const neutral=solidMaterial('geometry-only',[.66,.67,.66]);
  for(const record of records){
   const positions=record.shape.points.flatMap(point=>point.map((value,axis)=>value-translation[axis])),primitive=document.createPrimitive().setAttribute('POSITION',accessor(`${record.polygon.id}-position`,'VEC3',positions)).setIndices(accessor(`${record.polygon.id}-indices`,'SCALAR',record.shape.indices,Uint32Array));
   const activeAssignment=mode==='externalFirst'?record.externalFirstAssignment:mode==='softwareCorrected'?record.softwareCorrectedAssignment:record.assignment,isColored=mode==='colored'||mode==='externalFirst'||mode==='softwareCorrected';let material=neutral;
   if(mode==='plateau'&&record.plateauTexture){
    const key=`plateau:${record.plateauTexture.sourceImage}`;
    if(materialCache.has(key))material=materialCache.get(key);
    else{
     const image=await loadAppearance(record.plateauTexture.sourceImage),mimeType=path.extname(record.plateauTexture.sourceImage).toLowerCase()==='.png'?'image/png':'image/jpeg',texture=document.createTexture(record.plateauTexture.sourceImage).setImage(image.bytes).setMimeType(mimeType);
     material=document.createMaterial(key).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
     material.getBaseColorTextureInfo().setMinFilter(9729).setMagFilter(9729);materialCache.set(key,material);
    }
    primitive.setAttribute('TEXCOORD_0',accessor(`${record.polygon.id}-plateau-uv`,'VEC2',record.plateauTexture.uv));
   }else if(isColored&&activeAssignment.pattern){
    const textureBytes=await patternPng(activeAssignment,record),texture=document.createTexture(`${record.polygon.id}-${mode}-image-derived-pattern`).setImage(textureBytes).setMimeType('image/png');
    material=document.createMaterial(`${record.polygon.id}-facade-pattern`).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
    const pairs=[];for(let index=0;index<record.shape.flat.length;index+=2)pairs.push([record.shape.flat[index],record.shape.flat[index+1]]);
    const minU=Math.min(...pairs.map(pair=>pair[0])),maxU=Math.max(...pairs.map(pair=>pair[0])),minV=Math.min(...pairs.map(pair=>pair[1])),maxV=Math.max(...pairs.map(pair=>pair[1]));
    primitive.setAttribute('TEXCOORD_0',accessor(`${record.polygon.id}-uv`,'VEC2',pairs.flatMap(([u,v])=>[(u-minU)/Math.max(1e-6,maxU-minU),(v-minV)/Math.max(1e-6,maxV-minV)])));
   }else if(isColored)material=solidMaterial(`${activeAssignment.provenance}-${activeAssignment.baseRgb.map(value=>value.toFixed(3)).join('-')}`,activeAssignment.baseRgb);
   primitive.setMaterial(material);
   const plateauMapped=mode==='plateau'&&Boolean(record.plateauTexture),extras={buildingId:item.buildingId,label:item.label,polygonId:record.polygon.id,semanticClass:record.semantic.semanticClass,semanticSource:record.semantic.semanticSource,semanticConfidence:record.semantic.semanticConfidence,parentInstallationId:record.semantic.parentInstallationId??null,exactEquipmentTypeAvailable:record.semantic.exactEquipmentTypeAvailable??null,provenance:mode==='geometry'?'geometry-only':mode==='plateau'?(plateauMapped?'plateau-appearance-direct-uv':'plateau-appearance-unmapped'):activeAssignment.provenance,colorEvidence:mode==='geometry'?'none':mode==='plateau'?(plateauMapped?'original-plateau-appearance':'none'):activeAssignment.colorEvidence,confidence:mode==='geometry'?1:mode==='plateau'?(plateauMapped?1:0):activeAssignment.confidence,directlyObserved:mode==='plateau'?plateauMapped:mode==='geometry'?false:activeAssignment.directlyObserved,sourceImage:mode==='plateau'?record.plateauTexture?.sourceImage??null:mode==='geometry'?null:activeAssignment.sourceImage,inferenceSourceCount:isColored?activeAssignment.inferenceSourceCount??0:0,facadePatternApplied:isColored&&activeAssignment.pattern,facadePatternPolicy:isColored?activeAssignment.patternPolicy??null:null,evidencePriority:mode==='externalFirst'?'external-first':mode==='softwareCorrected'?'external-first-with-plateau-equipment-and-software-correction':mode==='colored'?'plateau-first-hybrid':mode,softwareProcessing:isColored?activeAssignment.softwareProcessing??'none':null,wallMetrics:record.isWall?{widthMetres:record.width,heightMetres:record.height,hullInsetMetres:record.hullInset,quadrant:record.quadrant}:null,stylingPolicy:isColored?activeAssignment.stylingPolicy??null:null};
   const mesh=document.createMesh(record.polygon.id).addPrimitive(primitive),node=document.createNode(record.polygon.id).setMesh(mesh).setExtras(extras);scene.addChild(node);
  }
  document.getRoot().getAsset().copyright='PLATEAU / Tokyo 2025; universal-building-color-v1 by OpenGraffiti. Nearby ground photos are candidates only and are not projected in this batch.';
  return document;
 }
 const geometryPath=`${output}/${slug}-geometry-only.glb`,plateauPath=`${output}/${slug}-plateau-appearance.glb`,coloredPath=`${output}/${slug}-universal.glb`,externalFirstPath=`${output}/${slug}-external-first.glb`,softwareCorrectedPath=`${output}/${slug}-software-corrected.glb`;
 await io.write(geometryPath,await makeModel('geometry'));await io.write(plateauPath,await makeModel('plateau'));await io.write(coloredPath,await makeModel('colored'));await io.write(externalFirstPath,await makeModel('externalFirst'));await io.write(softwareCorrectedPath,await makeModel('softwareCorrected'));
 const evidencePath=`${output}/${slug}-appearance-evidence.jpg`;await evidencePreview(records,evidencePath);
 const externalEvidencePath=`${output}/${slug}-external-evidence.jpg`;await externalEvidencePreview(expandedSources,externalEvidencePath);
 let groundCandidatePreview=null;
 const nearestAcquired=sourceDiscovery.kartaview.items.find(candidate=>candidate.acquired);
 if(nearestAcquired&&existsSync(`data/texture-city/photos/kartaview/${nearestAcquired.id}.jpg`)){groundCandidatePreview=`/assets/universal-ten-building/${slug}-kartaview-candidate.jpg`;await copyFile(`data/texture-city/photos/kartaview/${nearestAcquired.id}.jpg`,`public${groundCandidatePreview}`);}
 const mappedRecords=records.filter(record=>record.plateauTexture),directRecords=records.filter(record=>record.assignment.directlyObserved),directArea=directRecords.reduce((sum,record)=>sum+record.area,0),totalArea=records.reduce((sum,record)=>sum+record.area,0),patternRecords=records.filter(record=>record.assignment.pattern),weightedConfidence=records.reduce((sum,record)=>sum+record.area*record.assignment.confidence,0)/totalArea,preferredViewRecord=[...patternRecords,...records.filter(record=>record.isWall)].sort((left,right)=>right.area-left.area)[0],preferredViewDirection=preferredViewRecord?[preferredViewRecord.shape.normal[0],preferredViewRecord.shape.normal[2]]:[1,1];
 const provenanceCounts=Object.fromEntries([...Map.groupBy(records,record=>record.assignment.provenance)].map(([key,value])=>[key,value.length])),externalInferenceRecords=records.filter(record=>/external|gsi/i.test(record.assignment.provenance)),priorOnlyRecords=records.filter(record=>record.assignment.provenance==='semantic-class-prior-only'),externalFirstPatternRecords=records.filter(record=>record.externalFirstAssignment.pattern),externalFirstPriorRecords=records.filter(record=>record.externalFirstAssignment.provenance==='external-first-semantic-prior-fallback'),externalFirstWeightedConfidence=records.reduce((sum,record)=>sum+record.area*record.externalFirstAssignment.confidence,0)/totalArea,externalFirstProvenanceCounts=Object.fromEntries([...Map.groupBy(records,record=>record.externalFirstAssignment.provenance)].map(([key,value])=>[key,value.length])),softwarePatternRecords=records.filter(record=>record.softwareCorrectedAssignment.pattern),softwarePriorRecords=records.filter(record=>record.softwareCorrectedAssignment.provenance==='software-corrected-semantic-prior-fallback'),softwarePlateauEquipmentRecords=records.filter(record=>/software-corrected-plateau-equipment/.test(record.softwareCorrectedAssignment.provenance)),softwareExternalRecords=records.filter(record=>/software-corrected-(external|gsi|aerial)/.test(record.softwareCorrectedAssignment.provenance)),softwareWeightedConfidence=records.reduce((sum,record)=>sum+record.area*record.softwareCorrectedAssignment.confidence,0)/totalArea,softwareProvenanceCounts=Object.fromEntries([...Map.groupBy(records,record=>record.softwareCorrectedAssignment.provenance)].map(([key,value])=>[key,value.length]));
 const sourceImages=[...new Set(directRecords.map(record=>record.appearance?.sourceImage).filter(Boolean))];
 const [lon,lat]=proj4(CRS,GEO,[center[0]+geometry.origin[0],geometry.origin[1]-center[2]]);
 batchBuildings.push({ordinal:item.ordinal,label:item.label,buildingId:item.buildingId,plateauName:building.name,selection:{distanceFromTochoMetres:distance,heightMetres:height,lod:building.lod,appearanceMappedPolygonRatio:rawAppearanceCoverage,famousBuildingExcluded:true,reason:'PLATEAU name is empty; moderate-height ordinary-building range; absent from curated landmark IDs.'},position:{lat,lon,localCenter:center},attributes:{classCode:semanticBuilding.classCode,usageCode:semanticBuilding.usageCode,measuredHeightMetres:semanticBuilding.measuredHeightMetres,storeysAboveGround:semanticBuilding.storeysAboveGround,storeysBelowGround:semanticBuilding.storeysBelowGround,installationGroups:semanticBuilding.installations.length,windowPolygonCount:semanticBuilding.openingCounts.Window??0,doorPolygonCount:semanticBuilding.openingCounts.Door??0},models:{geometryOnly:`/assets/universal-ten-building/${slug}-geometry-only.glb`,plateauAppearance:`/assets/universal-ten-building/${slug}-plateau-appearance.glb`,universal:`/assets/universal-ten-building/${slug}-universal.glb`,externalFirst:`/assets/universal-ten-building/${slug}-external-first.glb`},previews:{appearanceEvidence:`/assets/universal-ten-building/${slug}-appearance-evidence.jpg`,externalEvidence:`/assets/universal-ten-building/${slug}-external-evidence.jpg`,groundCandidate:groundCandidatePreview},geometry:{polygonCount:records.length,wallCount:records.filter(record=>record.isWall).length,triangleCount:records.reduce((sum,record)=>sum+record.shape.indices.length/3,0),signature:geometrySignature,preferredViewDirection},sources:{plateauAppearance:{mappedPolygons:mappedRecords.length,directMappedPolygons:directRecords.length,directMappedArea:directArea,directAreaRatio:directArea/totalArea,sourceImageCount:sourceImages.length,sourceImages,license:'PLATEAU Site Policy'},expanded:{mapillary:expandedSources.mapillary,kartaview:expandedSources.kartaview,commons:{areaCandidates:expandedSources.commons.areaCandidates,acquired:expandedSources.commons.acquired,nearbyCandidates:expandedSources.commons.nearbyCandidates},gsi:expandedSources.gsi,inference:{groundSourceCount:expandedSources.inference.groundConsensus?.sourceCount??0,roofSourceCount:expandedSources.inference.roofConsensus?.sourceCount??0}},commons:{candidates:sourceDiscovery.commons.candidates,licenseAccepted:sourceDiscovery.commons.licenseAccepted,applied:0,reason:sourceDiscovery.commons.reason},kartaview:{candidates:sourceDiscovery.kartaview.candidates,acquired:sourceDiscovery.kartaview.acquired,applied:0,reason:sourceDiscovery.kartaview.reason,nearestCandidate:sourceDiscovery.kartaview.items[0]??null}},result:{patternedWalls:patternRecords.length,directPatternWalls:patternRecords.filter(record=>record.assignment.directlyObserved).length,transferredPatternWalls:patternRecords.filter(record=>!record.assignment.directlyObserved).length,externalInferenceSurfaces:externalInferenceRecords.length,semanticPriorOnlySurfaces:priorOnlyRecords.length,renderedSurfaces:records.length,unrenderedSurfaces:0,weightedColorConfidence:weightedConfidence,provenanceCounts,qualityTier:directArea/totalArea>=.8?'A':directArea/totalArea>=.6?'B':'C'},externalFirstResult:{patternedWalls:externalFirstPatternRecords.length,externalImageSurfaces:records.length-externalFirstPriorRecords.length,plateauImageSurfaces:0,semanticPriorOnlySurfaces:externalFirstPriorRecords.length,renderedSurfaces:records.length,unrenderedSurfaces:0,weightedColorConfidence:externalFirstWeightedConfidence,provenanceCounts:externalFirstProvenanceCounts},surfaceAudit:records.map(record=>({polygonId:record.polygon.id,semanticClass:record.semantic.semanticClass,area:record.area,provenance:record.assignment.provenance,confidence:record.assignment.confidence,directlyObserved:record.assignment.directlyObserved,inferenceSourceCount:record.assignment.inferenceSourceCount??0,patternApplied:record.assignment.pattern,patternPolicy:record.assignment.patternPolicy??null,sourceImage:record.assignment.sourceImage,wallMetrics:record.isWall?{widthMetres:record.width,heightMetres:record.height,hullInsetMetres:record.hullInset}:null})),externalFirstSurfaceAudit:records.map(record=>({polygonId:record.polygon.id,semanticClass:record.semantic.semanticClass,area:record.area,provenance:record.externalFirstAssignment.provenance,confidence:record.externalFirstAssignment.confidence,directlyObserved:false,inferenceSourceCount:record.externalFirstAssignment.inferenceSourceCount??0,patternApplied:record.externalFirstAssignment.pattern,patternPolicy:record.externalFirstAssignment.patternPolicy??null,sourceImage:record.externalFirstAssignment.sourceImage,wallMetrics:record.isWall?{widthMetres:record.width,heightMetres:record.height,hullInsetMetres:record.hullInset}:null}))});
 const batchRecord=batchBuildings.at(-1);
 batchRecord.models.softwareCorrected=`/assets/universal-ten-building/${slug}-software-corrected.glb`;
 batchRecord.sources.expanded.inference.groundCorrectedSourceCount=expandedSources.inference.groundCorrectedConsensus?.sourceCount??0;
 batchRecord.sources.expanded.inference.roofCorrectedSourceCount=expandedSources.inference.roofCorrectedConsensus?.sourceCount??0;
 batchRecord.sources.expanded.inference.softwareProcessing={ground:expandedSources.inference.groundCorrectedConsensus?{method:expandedSources.inference.groundCorrectedConsensus.method,rawCrossImageLuminanceStd:expandedSources.inference.groundCorrectedConsensus.rawCrossImageLuminanceStd,correctedCrossImageLuminanceStd:expandedSources.inference.groundCorrectedConsensus.correctedCrossImageLuminanceStd,meanRawLowFrequencyStd:expandedSources.inference.groundCorrectedConsensus.meanRawLowFrequencyStd,meanFlattenedLuminanceStd:expandedSources.inference.groundCorrectedConsensus.meanFlattenedLuminanceStd}:null,roof:expandedSources.inference.roofCorrectedConsensus?{method:expandedSources.inference.roofCorrectedConsensus.method,rawCrossImageLuminanceStd:expandedSources.inference.roofCorrectedConsensus.rawCrossImageLuminanceStd,correctedCrossImageLuminanceStd:expandedSources.inference.roofCorrectedConsensus.correctedCrossImageLuminanceStd}:null};
 batchRecord.softwareCorrectedResult={patternedWalls:softwarePatternRecords.length,externalImageSurfaces:softwareExternalRecords.length,plateauEquipmentSurfaces:softwarePlateauEquipmentRecords.length,plateauDirectEquipmentSurfaces:softwarePlateauEquipmentRecords.filter(record=>record.softwareCorrectedAssignment.directlyObserved).length,semanticPriorOnlySurfaces:softwarePriorRecords.length,renderedSurfaces:records.length,unrenderedSurfaces:0,weightedColorConfidence:softwareWeightedConfidence,provenanceCounts:softwareProvenanceCounts};
 batchRecord.softwareCorrectedSurfaceAudit=records.map(record=>({polygonId:record.polygon.id,semanticClass:record.semantic.semanticClass,area:record.area,provenance:record.softwareCorrectedAssignment.provenance,confidence:record.softwareCorrectedAssignment.confidence,directlyObserved:record.softwareCorrectedAssignment.directlyObserved,inferenceSourceCount:record.softwareCorrectedAssignment.inferenceSourceCount??0,patternApplied:record.softwareCorrectedAssignment.pattern,patternPolicy:record.softwareCorrectedAssignment.patternPolicy??null,sourceImage:record.softwareCorrectedAssignment.sourceImage,softwareProcessing:record.softwareCorrectedAssignment.softwareProcessing,wallMetrics:record.isWall?{widthMetres:record.width,heightMetres:record.height,hullInsetMetres:record.hullInset}:null}));
 console.log(JSON.stringify({ordinal:item.ordinal,label:item.label,polygons:records.length,direct:directRecords.length,patterns:patternRecords.length,softwarePatterns:softwarePatternRecords.length,plateauEquipment:softwarePlateauEquipmentRecords.length,confidence:Number(weightedConfidence.toFixed(3)),softwareConfidence:Number(softwareWeightedConfidence.toFixed(3))}));
}
const report={status:'generated',batchId:selection.batchId,methodVersion:selection.methodVersion,generatedAt:new Date().toISOString(),areaId:selection.areaId,selection:selection.criteria,sourceCollection:{...discovery.summary,expanded:maximizedSources.summary},policy:{comparisonBaseline:'PLATEAU original aerial and oblique-aerial appearance with the source UV coordinates.',directEvidence:'Exact PLATEAU UV mappings remain direct evidence. External ground images are direct only after geometry registration.',externalInference:'Mapillary and KartaView GPS/heading consensus may color otherwise unobserved walls. GSI coordinate-matched orthophoto may color otherwise unobserved roofs.',externalFirst:'The external-first variant ignores PLATEAU appearance colors. Ground-image consensus colors walls, coordinate-matched GSI imagery colors roofs, and semantic priors remain the final fallback.',unobserved:'Transfer same-building evidence, then external multi-image consensus, then semantic prior. Every surface receives a material.',equipment:'Keep CityGML BuildingInstallation membership, avoid unsupported function names, preserve observed luminance and reduce chroma.'},buildings:batchBuildings,summary:{buildings:batchBuildings.length,polygons:batchBuildings.reduce((sum,item)=>sum+item.geometry.polygonCount,0),directAppearancePolygons:batchBuildings.reduce((sum,item)=>sum+item.sources.plateauAppearance.directMappedPolygons,0),externalInferenceSurfaces:batchBuildings.reduce((sum,item)=>sum+item.result.externalInferenceSurfaces,0),semanticPriorOnlySurfaces:batchBuildings.reduce((sum,item)=>sum+item.result.semanticPriorOnlySurfaces,0),renderedSurfaces:batchBuildings.reduce((sum,item)=>sum+item.result.renderedSurfaces,0),unrenderedSurfaces:batchBuildings.reduce((sum,item)=>sum+item.result.unrenderedSurfaces,0),patternedWalls:batchBuildings.reduce((sum,item)=>sum+item.result.patternedWalls,0),meanWeightedConfidence:batchBuildings.reduce((sum,item)=>sum+item.result.weightedColorConfidence,0)/batchBuildings.length,externalFirst:{externalImageSurfaces:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.externalImageSurfaces,0),plateauImageSurfaces:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.plateauImageSurfaces,0),semanticPriorOnlySurfaces:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.semanticPriorOnlySurfaces,0),renderedSurfaces:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.renderedSurfaces,0),unrenderedSurfaces:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.unrenderedSurfaces,0),patternedWalls:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.patternedWalls,0),meanWeightedConfidence:batchBuildings.reduce((sum,item)=>sum+item.externalFirstResult.weightedColorConfidence,0)/batchBuildings.length},qualityTiers:Object.fromEntries([...Map.groupBy(batchBuildings,item=>item.result.qualityTier)].map(([key,value])=>[key,value.length]))},comparisonPage:'/universal-ten-building-demo.html',contactSheet:'/assets/universal-ten-building/contact-sheet.png',warnings:['The PLATEAU baseline preserves the source appearance exactly; oblique perspective, rooftop content and neighboring objects may therefore be visible on wall textures.', 'External ground images without camera-to-geometry registration are used only as low-confidence multi-image color and facade priors.', 'The external-first variant demonstrates source priority and is not a claim of registered facade texture accuracy.', 'Individual windows are procedural image-derived facade elements unless CityGML opening polygons exist.', 'No surface is left unrendered; final fallback is a low-confidence semantic material prior.']};
report.policy.softwareCorrected='Use external-first wall and roof albedo after masked Retinex, cross-image exposure harmonization and color-cast compression; retain PLATEAU robust palettes for OuterBuildingInstallation surfaces.';
report.summary.softwareCorrected={externalImageSurfaces:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.externalImageSurfaces,0),plateauEquipmentSurfaces:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.plateauEquipmentSurfaces,0),plateauDirectEquipmentSurfaces:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.plateauDirectEquipmentSurfaces,0),semanticPriorOnlySurfaces:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.semanticPriorOnlySurfaces,0),renderedSurfaces:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.renderedSurfaces,0),unrenderedSurfaces:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.unrenderedSurfaces,0),patternedWalls:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.patternedWalls,0),meanWeightedConfidence:batchBuildings.reduce((sum,item)=>sum+item.softwareCorrectedResult.weightedColorConfidence,0)/batchBuildings.length,meanRawCrossImageLuminanceStd:batchBuildings.reduce((sum,item)=>sum+(item.sources.expanded.inference.softwareProcessing.ground?.rawCrossImageLuminanceStd??0),0)/batchBuildings.length,meanCorrectedCrossImageLuminanceStd:batchBuildings.reduce((sum,item)=>sum+(item.sources.expanded.inference.softwareProcessing.ground?.correctedCrossImageLuminanceStd??0),0)/batchBuildings.length};
report.warnings.push('The software-corrected variant uses PLATEAU appearance only for semantic equipment surfaces; facade and roof colors remain external-image estimates.');
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary,null,2));
