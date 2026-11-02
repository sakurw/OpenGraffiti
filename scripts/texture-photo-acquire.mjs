// Resumable acquisition of real regional photographs. Downloaded is NOT applied.
// Credentials only come from the environment; never log API bodies or signed URLs.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const token=process.env.MAPILLARY_ACCESS_TOKEN;
if(!token)throw Error('MAPILLARY_ACCESS_TOKEN is required in this process');
const base='data/texture-city/photos/mapillary';
await mkdir(base,{recursive:true});
const survey=JSON.parse(await readFile('public/assets/texture-poc/city-survey.json','utf8'));
let extra=[];for(const path of ['data/texture-city/discovery.json',...(process.argv.includes('--include-flat')?['data/texture-city/discovery-flat.json']:[])])try{const discovered=JSON.parse(await readFile(path,'utf8'));extra.push(...(process.argv.includes('--all-discovered')?discovered.photos.map(p=>p.id):discovered.selectedIds||[]));}catch(e){if(e.code!=='ENOENT')throw e;}
const ids=[...new Set([...survey.photos.filter(p=>p.provider==='mapillary').map(p=>p.id.split('/')[1]),...extra])];
const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1]||ids.length);
if(!Number.isInteger(limit)||limit<1)throw Error('Invalid limit');
const fields='id,computed_geometry,geometry,computed_rotation,computed_altitude,camera_type,camera_parameters,thumb_2048_url,creator,captured_at,compass_angle,computed_compass_angle,width,height,exif_orientation,is_pano,sequence';
const totals={requested:Math.min(limit,ids.length),cached:0,downloaded:0,failed:0};
let next=0;
async function atomic(path,content){await writeFile(path+'.partial',content);await rename(path+'.partial',path);}
async function request(url,authenticated){
 for(let attempt=0;attempt<4;attempt++){
  try{
   const r=await fetch(url,{headers:authenticated?{Authorization:`OAuth ${token}`}:{},signal:AbortSignal.timeout(45000)});
   if(r.ok)return r;
   if(r.status!==429&&r.status<500)throw Object.assign(Error(`HTTP ${r.status}`),{terminal:true});
   if(attempt===3)throw Error(`HTTP ${r.status}`);
  }catch(e){if(e.terminal||attempt===3)throw e;}
  await new Promise(resolve=>setTimeout(resolve,2000*2**attempt));
 }
}
async function acquire(id){
 if(!/^\d+$/.test(id))throw Error('Invalid image ID');
 const prefix=`${base}/${id}`;
 try{
  const m=JSON.parse(await readFile(prefix+'.json','utf8'));
  const bytes=await readFile(prefix+'.jpg');
  if(m.status==='downloaded'&&createHash('sha256').update(bytes).digest('hex')===m.sha256){totals.cached++;return;}
 }catch{/* Missing or interrupted cache is refetched. */}
 try{
  const m=await (await request(`https://graph.mapillary.com/${id}?fields=${fields}`,true)).json();
  if(m.id!==id||!m.thumb_2048_url)throw Object.assign(Error('Missing image metadata'),{terminal:true});
  const url=new URL(m.thumb_2048_url);
  if(url.protocol!=='https:'||!(url.hostname.endsWith('.fbcdn.net')||url.hostname.endsWith('.mapillary.com')))throw Error('Unexpected image host');
  const bytes=Buffer.from(await (await request(url,false)).arrayBuffer());
  const image=await sharp(bytes).metadata();
  if(image.format!=='jpeg'||!image.width||!image.height)throw Error('Invalid JPEG');
  // Signed CDN URLs expire and are not needed for reproducible attribution.
  delete m.thumb_2048_url;
  const record={...m,status:'downloaded',downloadedAt:new Date().toISOString(),sourcePage:`https://www.mapillary.com/app/?pKey=${id}`,license:'CC-BY-SA-4.0',sha256:createHash('sha256').update(bytes).digest('hex'),downloadSize:[image.width,image.height],bytes:bytes.length,registration:'unregistered'};
  await atomic(prefix+'.jpg',bytes);
  await atomic(prefix+'.json',JSON.stringify(record,null,2));
  totals.downloaded++;
 }catch(e){
  totals.failed++;
  // Only explicitly constructed messages may be persisted; fetch errors can contain URLs.
  const safe=/^HTTP \d+$/.test(e.message)?e.message:'Acquisition or validation failed';
  await atomic(prefix+'.error.json',JSON.stringify({id,status:'error',error:safe,at:new Date().toISOString()}));
 }
}
await Promise.all(Array.from({length:4},async()=>{while(next<totals.requested){const i=next++;await acquire(ids[i]);if((totals.cached+totals.downloaded+totals.failed)%25===0)console.log(JSON.stringify(totals));}}));
await atomic(`${base}/acquisition-report.json`,JSON.stringify({...totals,completedAt:new Date().toISOString(),note:'Real photo acquisition only. Camera poses and visible building correspondence still require validation.'},null,2));
console.log(JSON.stringify(totals));
if(totals.failed)process.exitCode=2;
