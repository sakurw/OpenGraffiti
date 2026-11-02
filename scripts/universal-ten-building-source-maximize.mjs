import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
import sharp from 'sharp';
import {CRS,GEO} from './plateau-geometry.mjs';

const token=process.env.MAPILLARY_ACCESS_TOKEN;
if(!token)throw Error('MAPILLARY_ACCESS_TOKEN required');
const selection=JSON.parse(await readFile('scripts/universal-ten-building-selection.json','utf8'));
const geometry=JSON.parse(await readFile(selection.geometryPath,'utf8'));
const karta=JSON.parse(await readFile(selection.kartaviewDiscoveryPath,'utf8'));
const root='data/texture-city/universal-ten-buildings',imageRoot=`${root}/images`;
for(const provider of ['mapillary','commons','gsi'])await mkdir(`${imageRoot}/${provider}`,{recursive:true});

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clamp=(value,minimum=0,maximum=1)=>Math.max(minimum,Math.min(maximum,value));
const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
const radians=value=>value*Math.PI/180;
const degrees=value=>value*180/Math.PI;
const signedAngle=(left,right)=>((left-right+540)%360)-180;
const angleDistance=(left,right)=>Math.abs(signedAngle(left,right));
function haversine(left,right){const lat1=radians(left[0]),lat2=radians(right[0]),dLat=lat2-lat1,dLon=radians(right[1]-left[1]),a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function bearing(from,to){const lat1=radians(from[0]),lat2=radians(to[0]),dLon=radians(to[1]-from[1]);return (degrees(Math.atan2(Math.sin(dLon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon)))+360)%360;}
const buildingRows=selection.buildings.map(item=>{
 const building=geometry.buildings.find(candidate=>candidate.id===item.buildingId);if(!building)throw Error(`Missing ${item.buildingId}`);
 const center=[0,1,2].map(axis=>(building.min[axis]+building.max[axis])/2),[lon,lat]=proj4(CRS,GEO,[center[0]+geometry.origin[0],geometry.origin[1]-center[2]]);
 return {...item,building,center,lat,lon,target:[lat,lon]};
});
const globalBounds=[Math.min(...buildingRows.map(item=>item.lon))-.0022,Math.min(...buildingRows.map(item=>item.lat))-.0022,Math.max(...buildingRows.map(item=>item.lon))+.0022,Math.max(...buildingRows.map(item=>item.lat))+.0022];

async function atomic(file,data){await writeFile(`${file}.partial`,data);await rename(`${file}.partial`,file);}
async function parallel(items,limit,operation){let index=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const current=index++;try{results[current]=await operation(items[current],current);}catch(error){results[current]={error:error.message};}}}));return results;}
async function fetchJson(url,options={}){for(let attempt=0;attempt<4;attempt++){const response=await fetch(url,{...options,signal:AbortSignal.timeout(45000)});if(response.ok)return response.json();if((response.status===429||response.status>=500)&&attempt<3){await new Promise(resolve=>setTimeout(resolve,1500*2**attempt));continue;}throw Error(`HTTP ${response.status}`);}throw Error('request failed');}
async function download(url,file,headers={}){
 if(existsSync(file)){const bytes=await readFile(file);return {file,bytes:bytes.length,sha256:sha256(bytes),cached:true};}
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer()),metadata=await sharp(bytes).metadata();if(!metadata.width||!metadata.height)throw Error('not an image');await atomic(file,bytes);return {file,bytes:bytes.length,sha256:sha256(bytes),width:metadata.width,height:metadata.height,format:metadata.format,cached:false};
}
async function palette(file,crop=null){
 const metadata=await sharp(file).metadata();let region=crop;
 if(region){region={left:Math.max(0,Math.min(metadata.width-1,Math.round(region.left))),top:Math.max(0,Math.min(metadata.height-1,Math.round(region.top))),width:Math.max(1,Math.min(metadata.width-Math.max(0,Math.min(metadata.width-1,Math.round(region.left))),Math.round(region.width))),height:Math.max(1,Math.min(metadata.height-Math.max(0,Math.min(metadata.height-1,Math.round(region.top))),Math.round(region.height)))};}
 const pipeline=region?sharp(file).extract(region):sharp(file);const {data,info}=await pipeline.resize(72,72,{fit:'fill'}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true}),blurred=await sharp(data,{raw:info}).blur(7).raw().toBuffer(),pixels=[],lumas=[],validOffsets=[];
 for(let offset=0;offset<data.length;offset+=info.channels){const rgb=[data[offset],data[offset+1],data[offset+2]].map(value=>value/255),lum=luminance(rgb),sky=rgb[2]>rgb[0]*1.17&&rgb[2]>rgb[1]*1.08&&lum>.42,vegetation=rgb[1]>rgb[0]*1.22&&rgb[1]>rgb[2]*1.08;if(lum>.07&&lum<.94&&!sky&&!vegetation){pixels.push(rgb);lumas.push(lum);validOffsets.push(offset);}}
 if(pixels.length<120)return null;
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];},rgb=[0,1,2].map(channel=>median(pixels.map(pixel=>pixel[channel]))),sorted=[...lumas].sort((a,b)=>a-b),contrast=sorted[Math.floor(sorted.length*.8)]-sorted[Math.floor(sorted.length*.2)],lowLumas=validOffsets.map(offset=>luminance([blurred[offset],blurred[offset+1],blurred[offset+2]].map(value=>value/255))),targetIllumination=median(lowLumas),correctedPixels=validOffsets.map((offset,index)=>{const original=pixels[index],gain=clamp((targetIllumination/Math.max(.06,lowLumas[index]))**.86,.55,1.85);return original.map(value=>clamp(value*gain,.025,.965));}),albedoRgb=[0,1,2].map(channel=>median(correctedPixels.map(pixel=>pixel[channel]))),mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length,std=values=>{const average=mean(values);return Math.sqrt(mean(values.map(value=>(value-average)**2)));};
 let pairs=0,edges=0;for(let y=0;y<71;y++)for(let x=0;x<71;x++){const a=(y*72+x)*info.channels,b=(y*72+x+1)*info.channels,c=((y+1)*72+x)*info.channels,la=(data[a]+data[a+1]+data[a+2])/765,lb=(data[b]+data[b+1]+data[b+2])/765,lc=(data[c]+data[c+1]+data[c+2])/765;pairs+=2;if(Math.abs(la-lb)>.09)edges++;if(Math.abs(la-lc)>.09)edges++;}
 return {rgb,albedoRgb,contrast,edgeDensity:edges/pairs,usablePixels:pixels.length,crop:region,illumination:{method:'masked-low-frequency-retinex',strength:.86,blurSigma:7,targetLuminance:targetIllumination,rawLowFrequencyStd:std(lowLumas),correctedLuminanceStd:std(correctedPixels.map(luminance))}};
}
function weightedConsensus(items){
 const usable=items.filter(item=>item.palette&&item.weight>0);if(!usable.length)return null;const total=usable.reduce((sum,item)=>sum+item.weight,0),rgb=[0,1,2].map(channel=>usable.reduce((sum,item)=>sum+item.palette.rgb[channel]*item.weight,0)/total);
 return {rgb,contrast:usable.reduce((sum,item)=>sum+item.palette.contrast*item.weight,0)/total,edgeDensity:usable.reduce((sum,item)=>sum+item.palette.edgeDensity*item.weight,0)/total,sourceCount:usable.length,totalWeight:total,providers:Object.fromEntries([...Map.groupBy(usable,item=>item.provider)].map(([provider,rows])=>[provider,rows.length]))};
}
function weightedMedian(items,value){
 const rows=items.map(item=>({value:value(item),weight:item.weight})).filter(item=>Number.isFinite(item.value)&&item.weight>0).sort((a,b)=>a.value-b.value),total=rows.reduce((sum,item)=>sum+item.weight,0);let running=0;for(const row of rows){running+=row.weight;if(running>=total/2)return row.value;}return rows.at(-1)?.value??0;
}
function harmonizedConsensus(items){
 const usable=items.filter(item=>item.palette?.albedoRgb&&item.weight>0);if(!usable.length)return null;
 const targetLuminance=weightedMedian(usable,item=>luminance(item.palette.albedoRgb)),corrected=usable.map(item=>{const source=item.palette.albedoRgb,sourceLuminance=Math.max(.04,luminance(source)),scale=clamp(targetLuminance/sourceLuminance,.62,1.62),exposure=source.map(value=>clamp(value*scale)),neutral=[targetLuminance,targetLuminance,targetLuminance],rgb=exposure.map((value,index)=>value*.72+neutral[index]*.28),exposureQuality=clamp(1-Math.abs(Math.log(sourceLuminance/Math.max(.04,targetLuminance)))/1.4,.24,1);return {...item,harmonizedRgb:rgb,weight:item.weight*exposureQuality};}),rgb=[0,1,2].map(channel=>weightedMedian(corrected,item=>item.harmonizedRgb[channel])),rawLuminances=usable.map(item=>luminance(item.palette.rgb)),correctedLuminances=corrected.map(item=>luminance(item.harmonizedRgb)),mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length,std=values=>{const average=mean(values);return Math.sqrt(mean(values.map(value=>(value-average)**2)));};
 return {rgb,sourceCount:usable.length,totalWeight:corrected.reduce((sum,item)=>sum+item.weight,0),providers:Object.fromEntries([...Map.groupBy(usable,item=>item.provider)].map(([provider,rows])=>[provider,rows.length])),method:'masked-retinex-plus-exposure-quantile-harmonization-plus-chroma-cast-compression',targetLuminance,rawCrossImageLuminanceStd:std(rawLuminances),correctedCrossImageLuminanceStd:std(correctedLuminances),meanRawLowFrequencyStd:mean(usable.map(item=>item.palette.illumination.rawLowFrequencyStd)),meanFlattenedLuminanceStd:mean(usable.map(item=>item.palette.illumination.correctedLuminanceStd))};
}

// Mapillary: exhaustively subdivide the shared search box whenever the 100-record cap is hit.
const mapillaryPhotos=new Map(),mapillaryQueries=[];
const mapillaryFailures=[];
function subdivide(bbox){const [w,s,e,n]=bbox,x=(w+e)/2,y=(s+n)/2;return [[w,s,x,y],[x,s,e,y],[w,y,x,n],[x,y,e,n]];}
async function discoverMapillary(bbox,depth=0){
 const url=new URL('https://graph.mapillary.com/images');url.search=new URLSearchParams({bbox:bbox.join(','),fields:'id,computed_geometry,captured_at,camera_type,sequence,compass_angle,is_pano',limit:'100'}).toString();
 let json;
 try{json=await fetchJson(url,{headers:{Authorization:`OAuth ${token}`}});}
 catch(error){
  mapillaryQueries.push({bbox,depth,count:null,error:error.message});
  if(depth<8){for(const child of subdivide(bbox))await discoverMapillary(child,depth+1);return;}
  mapillaryFailures.push({bbox,depth,error:error.message});return;
 }
 const rows=json.data??[];mapillaryQueries.push({bbox,depth,count:rows.length});for(const row of rows)mapillaryPhotos.set(String(row.id),row);
 if(rows.length>=100&&depth<8)for(const child of subdivide(bbox))await discoverMapillary(child,depth+1);
}
await discoverMapillary(globalBounds);
const mapillaryByBuilding=new Map(),selectedMapillary=new Map();
for(const building of buildingRows){
 const rows=[...mapillaryPhotos.values()].map(photo=>{const coordinates=photo.computed_geometry?.coordinates;if(!coordinates)return null;const point=[coordinates[1],coordinates[0]],distance=haversine(point,building.target),targetBearing=bearing(point,building.target),heading=Number(photo.compass_angle),pano=photo.is_pano===true||/spherical|equirectangular/i.test(photo.camera_type??''),headingError=pano?0:Number.isFinite(heading)?angleDistance(heading,targetBearing):180;if(distance>240||(!pano&&headingError>90))return null;const score=Math.exp(-distance/115)*(pano?0.82:Math.max(.08,Math.cos(radians(headingError))**2));return {...photo,point,distanceMetres:distance,targetBearingDegrees:targetBearing,headingDegrees:heading,headingErrorDegrees:headingError,pano,score};}).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,36);
 mapillaryByBuilding.set(building.buildingId,rows);for(const row of rows)selectedMapillary.set(String(row.id),row);
}
const mapillarySelected=[...selectedMapillary.values()];
const mapillaryMetadata=await parallel(mapillarySelected,6,async(photo)=>{const json=await fetchJson(`https://graph.mapillary.com/${photo.id}?`+new URLSearchParams({fields:'id,thumb_1024_url,computed_geometry,captured_at,camera_type,sequence,compass_angle,is_pano'}),{headers:{Authorization:`OAuth ${token}`}});const file=`${imageRoot}/mapillary/${photo.id}.jpg`,downloaded=await download(json.thumb_1024_url,file);const record={...photo,...json,file,downloaded,provider:'mapillary',sourcePage:`https://www.mapillary.com/app/?pKey=${photo.id}`,license:'Mapillary platform imagery; attribution required',registration:'candidate-only'};await atomic(`${imageRoot}/mapillary/${photo.id}.json`,JSON.stringify(record,null,2));return record;});
const mapillaryMetaById=new Map(mapillaryMetadata.filter(item=>!item.error).map(item=>[String(item.id),item]));

// Commons: collect the full 500-result geosearch pool and retain every license-compatible thumbnail.
const center={lat:buildingRows.reduce((sum,item)=>sum+item.lat,0)/buildingRows.length,lon:buildingRows.reduce((sum,item)=>sum+item.lon,0)/buildingRows.length};
const commonsQuery=new URLSearchParams({action:'query',format:'json',generator:'geosearch',ggsprimary:'all',ggsnamespace:'6',ggsradius:'1000',ggscoord:`${center.lat}|${center.lon}`,ggslimit:'500',prop:'imageinfo|coordinates',iiprop:'url|extmetadata|size',iiurlwidth:'1280'});
const commonsJson=await fetchJson(`https://commons.wikimedia.org/w/api.php?${commonsQuery}`,{headers:{'User-Agent':'OpenGraffiti universal-building research/2.0'}}),acceptedLicense=value=>/^(CC0|CC BY|CC BY-SA|Public domain|PD)/i.test(value??'');
const commonsCandidates=Object.values(commonsJson.query?.pages??{}).map(page=>{const info=page.imageinfo?.[0]??{},meta=info.extmetadata??{},license=meta.LicenseShortName?.value??null,coordinate=page.coordinates?.[0];return {id:String(page.pageid),title:page.title,descriptionUrl:info.descriptionurl??null,downloadUrl:info.thumburl??info.url??null,width:info.thumbwidth??info.width??null,height:info.thumbheight??info.height??null,lat:coordinate?.lat??null,lon:coordinate?.lon??null,license,licenseAccepted:acceptedLicense(license),artist:meta.Artist?.value?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()??null,captureTime:meta.DateTimeOriginal?.value??null,provider:'wikimedia-commons'};}).filter(item=>item.downloadUrl&&item.licenseAccepted);
const commonsDownloads=await parallel(commonsCandidates,6,async(item)=>{const extension=/\.png(?:\?|$)/i.test(item.downloadUrl)?'png':'jpg',file=`${imageRoot}/commons/${item.id}.${extension}`,downloaded=await download(item.downloadUrl,file,{'User-Agent':'OpenGraffiti universal-building research/2.0'}),record={...item,file,downloaded,registration:'neighborhood-candidate-only'};await atomic(`${imageRoot}/commons/${item.id}.json`,JSON.stringify(record,null,2));return record;});
const commonsAcquired=commonsDownloads.filter(item=>!item.error);

// GSI: acquire current orthophoto and seamless-photo tiles. Exact coordinates support roof-color inference only.
function tileFor(lat,lon,z=18){const n=2**z,xf=(lon+180)/360*n,yf=(1-Math.asinh(Math.tan(radians(lat)))/Math.PI)/2*n;return {z,x:Math.floor(xf),y:Math.floor(yf),pixelX:(xf-Math.floor(xf))*256,pixelY:(yf-Math.floor(yf))*256};}
const gsiLayers=[{id:'ort',extension:'jpg',title:'電子国土基本図（オルソ画像）'},{id:'seamlessphoto',extension:'jpg',title:'全国最新写真（シームレス）'},{id:'airphoto',extension:'png',title:'簡易空中写真'}],gsiTiles=new Map();
for(const building of buildingRows)for(const layer of gsiLayers){const tile=tileFor(building.lat,building.lon),key=`${layer.id}-${tile.z}-${tile.x}-${tile.y}`,file=`${imageRoot}/gsi/${key}.${layer.extension}`;if(!gsiTiles.has(key)){try{const downloaded=await download(`https://cyberjapandata.gsi.go.jp/xyz/${layer.id}/${tile.z}/${tile.x}/${tile.y}.${layer.extension}`,file);gsiTiles.set(key,{...layer,...tile,file,downloaded,provider:'gsi',sourcePage:'https://maps.gsi.go.jp/development/ichiran.html',attribution:'国土地理院'});}catch(error){gsiTiles.set(key,{...layer,...tile,error:error.message});}}}

const kartaRoot='data/texture-city/photos/kartaview',buildingReports=[];
for(const building of buildingRows){
 const mapillaryRows=mapillaryByBuilding.get(building.buildingId).map(row=>mapillaryMetaById.get(String(row.id))).filter(Boolean),kartaRows=karta.photos.map(photo=>{const point=[Number(photo.lat),Number(photo.lng)],heading=Number(photo.heading??photo.headers);if(!Number.isFinite(point[0])||!Number.isFinite(point[1])||!Number.isFinite(heading))return null;const distance=haversine(point,building.target),targetBearing=bearing(point,building.target),headingError=angleDistance(heading,targetBearing);if(distance>220||headingError>85)return null;const score=Math.exp(-distance/115)*Math.max(.06,Math.cos(radians(headingError))**2),file=`${kartaRoot}/${photo.id}.jpg`;return {...photo,id:String(photo.id),point,distanceMetres:distance,targetBearingDegrees:targetBearing,headingDegrees:heading,headingErrorDegrees:headingError,pano:false,score,file,provider:'kartaview',acquired:existsSync(file),sourcePage:`https://api.openstreetcam.org/2.0/photo/${photo.id}`};}).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,50),ground=[];
 for(const row of [...mapillaryRows,...kartaRows.filter(item=>item.acquired)]){
  try{const metadata=await sharp(row.file).metadata(),fov=row.pano?360:90,offset=signedAngle(row.targetBearingDegrees,row.headingDegrees||0),centerX=row.pano?((.5+offset/360)%1+1)%1:clamp(.5+offset/fov,.16,.84),crop={left:(centerX-.14)*metadata.width,top:.18*metadata.height,width:.28*metadata.width,height:.60*metadata.height},candidatePalette=await palette(row.file,crop),weight=row.score*(candidatePalette?.usablePixels??0)/5184;if(candidatePalette)ground.push({...row,palette:candidatePalette,weight});}catch{}
 }
 const groundConsensus=weightedConsensus(ground),groundCorrectedConsensus=harmonizedConsensus(ground),tileEntries=[];
 for(const layer of gsiLayers){const tile=tileFor(building.lat,building.lon),entry=gsiTiles.get(`${layer.id}-${tile.z}-${tile.x}-${tile.y}`);if(!entry?.file)continue;const resolution=Math.cos(radians(building.lat))*2*Math.PI*6378137/(256*2**tile.z),width=clamp((building.building.max[0]-building.building.min[0])/resolution*1.25,20,150),height=clamp((building.building.max[2]-building.building.min[2])/resolution*1.25,20,150),crop={left:tile.pixelX-width/2,top:tile.pixelY-height/2,width,height};try{const roofPalette=await palette(entry.file,crop);if(roofPalette)tileEntries.push({...entry,palette:roofPalette,crop});}catch{}
 }
 const roofItems=tileEntries.map(item=>({provider:'gsi',palette:item.palette,weight:item.id==='ort'?1:.7})),roofConsensus=weightedConsensus(roofItems),roofCorrectedConsensus=harmonizedConsensus(roofItems),commonsNearby=commonsAcquired.map(item=>{const distance=Number.isFinite(item.lat)&&Number.isFinite(item.lon)?haversine([item.lat,item.lon],building.target):null;return {...item,distanceMetres:distance};}).filter(item=>item.distanceMetres===null||item.distanceMetres<=1200);
 const evidence=[...ground.sort((a,b)=>b.weight-a.weight).slice(0,5).map(item=>({provider:item.provider,id:String(item.id),file:item.file,sourcePage:item.sourcePage,distanceMetres:item.distanceMetres,headingErrorDegrees:item.headingErrorDegrees,weight:item.weight})),...tileEntries.slice(0,2).map(item=>({provider:'gsi',id:item.id,file:item.file,sourcePage:item.sourcePage,weight:.5}))];
 buildingReports.push({ordinal:building.ordinal,label:building.label,buildingId:building.buildingId,position:{lat:building.lat,lon:building.lon},mapillary:{discovered:mapillaryPhotos.size,candidates:mapillaryByBuilding.get(building.buildingId).length,acquired:mapillaryRows.length,usableForInference:ground.filter(item=>item.provider==='mapillary').length,items:mapillaryRows.map(item=>({id:String(item.id),distanceMetres:item.distanceMetres,headingErrorDegrees:item.headingErrorDegrees,pano:item.pano,file:item.file,sourcePage:item.sourcePage}))},kartaview:{regionalDiscovery:karta.photos.length,candidates:kartaRows.length,acquired:kartaRows.filter(item=>item.acquired).length,usableForInference:ground.filter(item=>item.provider==='kartaview').length,items:kartaRows.map(item=>({id:item.id,distanceMetres:item.distanceMetres,headingErrorDegrees:item.headingErrorDegrees,acquired:item.acquired,file:item.acquired?item.file:null,sourcePage:item.sourcePage}))},commons:{areaCandidates:commonsCandidates.length,acquired:commonsAcquired.length,nearbyCandidates:commonsNearby.length,items:commonsNearby.slice(0,50).map(item=>({id:item.id,title:item.title,file:item.file,distanceMetres:item.distanceMetres,license:item.license,descriptionUrl:item.descriptionUrl}))},gsi:{layers:tileEntries.length,items:tileEntries.map(item=>({id:item.id,title:item.title,file:item.file,sourcePage:item.sourcePage,palette:item.palette}))},inference:{groundConsensus,groundCorrectedConsensus,roofConsensus,roofCorrectedConsensus,evidence}});
}

const summary={mapillaryDiscovered:mapillaryPhotos.size,mapillaryQueries:mapillaryQueries.length,mapillaryQueryFailures:mapillaryFailures.length,mapillarySelected:selectedMapillary.size,mapillaryAcquired:mapillaryMetaById.size,kartaviewRegionalDiscovery:karta.photos.length,kartaviewSelected:[...new Set(buildingReports.flatMap(item=>item.kartaview.items.map(row=>row.id)))].length,kartaviewAcquired:[...new Set(buildingReports.flatMap(item=>item.kartaview.items.filter(row=>row.acquired).map(row=>row.id)))].length,commonsCandidates:commonsCandidates.length,commonsAcquired:commonsAcquired.length,gsiTilesAcquired:[...gsiTiles.values()].filter(item=>item.file).length,buildingGroundConsensus:buildingReports.filter(item=>item.inference.groundConsensus).length,buildingRoofConsensus:buildingReports.filter(item=>item.inference.roofConsensus).length,buildingGroundCorrectedConsensus:buildingReports.filter(item=>item.inference.groundCorrectedConsensus).length,buildingRoofCorrectedConsensus:buildingReports.filter(item=>item.inference.roofCorrectedConsensus).length,totalAcquiredUnique:mapillaryMetaById.size+[...new Set(buildingReports.flatMap(item=>item.kartaview.items.filter(row=>row.acquired).map(row=>row.id)))].length+commonsAcquired.length+[...gsiTiles.values()].filter(item=>item.file).length};
const output={batchId:selection.batchId,generatedAt:new Date().toISOString(),policy:{collection:'Maximize public image collection around every ordinary target building.',directEvidence:'External photos remain candidates unless geometric registration succeeds.',inference:'Multi-image GPS/heading consensus may color unobserved walls; GSI orthophoto may color unobserved roofs.',noBlank:'Every surface must receive direct color, same-building transfer, external consensus, or semantic prior.'},providers:{mapillary:{api:'https://graph.mapillary.com/images',attribution:'Mapillary contributors'},kartaview:{source:karta.source,license:karta.license,attribution:karta.license?.attribution},commons:{api:'https://commons.wikimedia.org/w/api.php',license:'per-file'},gsi:{tiles:'https://cyberjapandata.gsi.go.jp/xyz/',attribution:'国土地理院',terms:'https://maps.gsi.go.jp/development/ichiran.html'}},summary,buildings:buildingReports};
await writeFile(`${root}/source-maximized.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify({output:`${root}/source-maximized.json`,summary,buildings:buildingReports.map(item=>({label:item.label,mapillary:item.mapillary.acquired,kartaview:item.kartaview.acquired,commons:item.commons.acquired,gsi:item.gsi.layers,groundConsensus:item.inference.groundConsensus?.sourceCount??0,roofConsensus:item.inference.roofConsensus?.sourceCount??0}))},null,2));
