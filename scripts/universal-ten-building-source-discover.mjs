import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';

const selection=JSON.parse(await readFile('scripts/universal-ten-building-selection.json','utf8'));
const geometry=JSON.parse(await readFile(selection.geometryPath,'utf8'));
const karta=JSON.parse(await readFile(selection.kartaviewDiscoveryPath,'utf8'));
const outputDir='data/texture-city/universal-ten-buildings';
const outputPath=`${outputDir}/source-discovery.json`;
await mkdir(outputDir,{recursive:true});

const toRadians=value=>value*Math.PI/180;
const toDegrees=value=>value*180/Math.PI;
const angleDistance=(left,right)=>Math.abs(((left-right+540)%360)-180);
function haversine(left,right){
 const lat1=toRadians(left[0]),lat2=toRadians(right[0]),dLat=lat2-lat1,dLon=toRadians(right[1]-left[1]);
 const a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearing(from,to){
 const lat1=toRadians(from[0]),lat2=toRadians(to[0]),dLon=toRadians(to[1]-from[1]);
 return (toDegrees(Math.atan2(Math.sin(dLon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon)))+360)%360;
}
function buildingPosition(building){
 const center=[0,1,2].map(axis=>(building.min[axis]+building.max[axis])/2);
 const [lon,lat]=proj4(CRS,GEO,[center[0]+geometry.origin[0],geometry.origin[1]-center[2]]);
 return {center,lat,lon};
}
const acceptedLicense=value=>/^(CC0|CC BY|CC BY-SA|Public domain|PD)/i.test(value??'');
async function commonsCandidates(lat,lon){
 const query=new URLSearchParams({action:'query',format:'json',generator:'geosearch',ggsprimary:'all',ggsnamespace:'6',ggsradius:'250',ggscoord:`${lat}|${lon}`,ggslimit:'50',prop:'imageinfo',iiprop:'url|extmetadata|size'});
 const response=await fetch(`https://commons.wikimedia.org/w/api.php?${query}`,{headers:{'User-Agent':'OpenGraffiti universal-building research/1.0'},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Commons HTTP ${response.status}`);
 const json=await response.json();
 return Object.values(json.query?.pages??{}).map(page=>{
  const info=page.imageinfo?.[0]??{},meta=info.extmetadata??{};
  const license=meta.LicenseShortName?.value??null;
  return {pageId:page.pageid,title:page.title,url:info.descriptionurl??null,thumbUrl:info.thumburl??info.url??null,width:info.width??null,height:info.height??null,license,licenseAccepted:acceptedLicense(license),artist:meta.Artist?.value?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()??null,captureTime:meta.DateTimeOriginal?.value??null};
 });
}

const results=[];
for(const item of selection.buildings){
 const building=geometry.buildings.find(candidate=>candidate.id===item.buildingId);
 if(!building)throw Error(`Missing selected building: ${item.buildingId}`);
 const position=buildingPosition(building),target=[position.lat,position.lon];
 const nearby=karta.photos.filter(photo=>{
  const lat=Number(photo.lat),lon=Number(photo.lng),heading=Number(photo.heading??photo.headers);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(heading)||photo.visibility!=='public'||photo.status!=='active'||photo.autoImgProcessingStatus!=='FINISHED')return false;
  const distance=haversine([lat,lon],target),targetBearing=bearing([lat,lon],target);
  return distance<=120&&angleDistance(heading,targetBearing)<=65;
 }).map(photo=>{
  const point=[Number(photo.lat),Number(photo.lng)],distance=haversine(point,target),targetBearing=bearing(point,target);
  return {id:String(photo.id),sequenceId:String(photo.sequenceId),distanceMetres:Number(distance.toFixed(2)),headingDegrees:Number(photo.heading??photo.headers),targetBearingDegrees:Number(targetBearing.toFixed(2)),headingErrorDegrees:Number(angleDistance(Number(photo.heading??photo.headers),targetBearing).toFixed(2)),shotDate:photo.shotDate,qualityLevel:photo.qualityLevel??null,acquired:existsSync(`data/texture-city/photos/kartaview/${photo.id}.jpg`),sourcePage:`https://api.openstreetcam.org/2.0/photo/${photo.id}`};
 }).sort((left,right)=>left.distanceMetres-right.distanceMetres||left.headingErrorDegrees-right.headingErrorDegrees);
 let commons=[],commonsError=null;
 try{commons=await commonsCandidates(position.lat,position.lon);}catch(error){commonsError=error.message;}
 results.push({ordinal:item.ordinal,label:item.label,buildingId:item.buildingId,position:{lat:position.lat,lon:position.lon,localCenter:position.center},commons:{radiusMetres:250,candidates:commons.length,licenseAccepted:commons.filter(candidate=>candidate.licenseAccepted).length,items:commons,error:commonsError,applied:0,reason:'Geosearch proximity does not prove that an unnamed target building is depicted; no candidate is projected without automatic geometry registration.'},kartaview:{radiusMetres:120,headingToleranceDegrees:65,candidates:nearby.length,acquired:nearby.filter(candidate=>candidate.acquired).length,items:nearby.slice(0,20),applied:0,reason:'GPS and heading create candidates only. None is counted as direct evidence until target identity, occlusion and camera-to-geometry registration pass.'}});
 await new Promise(resolve=>setTimeout(resolve,250));
}
const report={batchId:selection.batchId,generatedAt:new Date().toISOString(),policy:'Candidate proximity never counts as building evidence. PLATEAU appearance UV imagery is the direct image source for this batch; ground candidates remain unapplied unless registered.',providers:{commons:{license:'per-file license',api:'https://commons.wikimedia.org/w/api.php'},kartaview:{license:karta.license,source:karta.source,independence:karta.independence},plateauAppearance:{license:'PLATEAU Site Policy',licenseUrl:'https://www.mlit.go.jp/plateau/site-policy/'}},buildings:results,summary:{commonsCandidates:results.reduce((sum,item)=>sum+item.commons.candidates,0),commonsLicenseAccepted:results.reduce((sum,item)=>sum+item.commons.licenseAccepted,0),kartaviewCandidates:results.reduce((sum,item)=>sum+item.kartaview.candidates,0),kartaviewAcquired:results.reduce((sum,item)=>sum+item.kartaview.acquired,0),groundImagesApplied:0}};
await writeFile(outputPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({outputPath,...report.summary,buildings:results.map(item=>({label:item.label,commons:item.commons.candidates,kartaview:item.kartaview.candidates,kartaviewAcquired:item.kartaview.acquired}))},null,2));
