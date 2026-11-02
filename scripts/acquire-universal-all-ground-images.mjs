import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import sharp from 'sharp';

// Shared image download pool, selected once for all buildings. All photos are
// geographic candidates only; acquisition does not certify their subject.
const token=process.env.MAPILLARY_ACCESS_TOKEN;
if(!token)throw Error('MAPILLARY_ACCESS_TOKEN is required');
const root='data/texture-city/universal-ten-buildings/images/mapillary';
const output='data/texture-city/universal-all-buildings/ground';
await mkdir(root,{recursive:true});
const limitArg=process.argv.indexOf('--limit');
const limit=limitArg<0?3000:Math.max(1,Number(process.argv[limitArg+1])||3000);
const selection=new Map();
for(const area of ['tocho','tokyo-tower']){
 const data=JSON.parse(await readFile(`${output}/${area}-discovery.json`,'utf8'));
 for(const building of data.buildings){
  // Three mutually ranked observations at most per building; duplicates are
  // downloaded once and may be reused for several nearby buildings.
  for(const photo of building.candidates.filter(c=>c.score>=.13).slice(0,3)){
   const old=selection.get(photo.imageId);
   if(!old||old.score<photo.score)selection.set(photo.imageId,photo);
  }
 }
}
const ordered=[...selection.values()].sort((a,b)=>b.score-a.score).slice(0,limit);
const report={generatedAt:new Date().toISOString(),uniqueSelected:selection.size,limitedTo:ordered.length,downloaded:0,alreadyPresent:0,failed:0,errors:[]};
let index=0;
const atomic=async(file,bytes)=>{await writeFile(file+'.partial',bytes);await rename(file+'.partial',file);};
async function acquire(row){
 const name=String(row.imageId),image=`${root}/${name}.jpg`,metadata=`${root}/${name}.json`;
 if(existsSync(image)&&existsSync(metadata)){report.alreadyPresent++;return;}
 try{
  const response=await fetch(`https://graph.mapillary.com/${encodeURIComponent(name)}?fields=id,thumb_256_url,computed_geometry,compass_angle,captured_at,is_pano`,{headers:{Authorization:`OAuth ${token}`},signal:AbortSignal.timeout(16000)});
  if(!response.ok)throw Error(`metadata HTTP ${response.status}`);
  const data=await response.json();
  if(!data.thumb_256_url)throw Error('no permitted thumbnail');
  const jpeg=await fetch(data.thumb_256_url,{signal:AbortSignal.timeout(16000)});
  if(!jpeg.ok)throw Error(`thumbnail HTTP ${jpeg.status}`);
  const bytes=Buffer.from(await jpeg.arrayBuffer()),info=await sharp(bytes).metadata();
  if(!info.width||!info.height)throw Error('invalid image');
  await atomic(image,bytes);
  await atomic(metadata,JSON.stringify({...data,provider:'mapillary',file:image,registration:'unverified-candidate',sourcePage:`https://www.mapillary.com/app/?pKey=${name}`,license:'Mapillary terms; attribution required'}));
  report.downloaded++;
 }catch(error){report.failed++;if(report.errors.length<80)report.errors.push({imageId:name,error:error.message});}
}
await Promise.all(Array.from({length:6},async()=>{while(index<ordered.length){await acquire(ordered[index++]);if(index%100===0)console.log(JSON.stringify({processed:index,...Object.fromEntries(['downloaded','alreadyPresent','failed'].map(k=>[k,report[k]]))}));}}));
await atomic(`${output}/image-acquisition-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
