// Download official per-image SfM meshes, without persisting signed URLs.
import {readFile,readdir,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeSpatialMesh} from './texture-spatial-depth.mjs';
const token=process.env.MAPILLARY_ACCESS_TOKEN;if(!token)throw Error('MAPILLARY_ACCESS_TOKEN required');
const root='data/texture-city/spatial';await mkdir(root,{recursive:true});
const photos=[];for(const f of await readdir('data/texture-city/photos/mapillary'))if(/^\d+\.json$/.test(f)){const p=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${f}`,'utf8'));if(['perspective','spherical','equirectangular'].includes(p.camera_type)&&p.computed_rotation?.length===3)photos.push(p);}
const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8)||photos.length);if(!Number.isSafeInteger(limit)||limit<1)throw Error('Invalid limit');
const selected=photos.slice(0,limit),totals={requested:selected.length,cached:0,downloaded:0,notProvided:0,failed:0};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function atomic(path,value){await writeFile(path+'.partial',value);await rename(path+'.partial',path);}
let notBefore=0;
async function request(url,authenticated=false){for(let attempt=0;attempt<4;attempt++){
 while(Date.now()<notBefore)await new Promise(r=>setTimeout(r,Math.min(30000,notBefore-Date.now())));
 let response;try{response=await fetch(url,{headers:authenticated?{Authorization:`OAuth ${token}`}:{},redirect:'error',signal:AbortSignal.timeout(45000)});}catch{if(attempt===3)throw Error('Spatial request failed');await new Promise(r=>setTimeout(r,2000*2**attempt));continue;}
 if(response.ok)return response;
 if(response.status===429){const value=response.headers.get('retry-after'),seconds=Number(value);notBefore=Math.max(Date.now()+30000,Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(value)||0);}
 if((response.status!==429&&response.status<500)||attempt===3)throw Error(`Spatial HTTP ${response.status}`);
 if(response.status!==429)await new Promise(r=>setTimeout(r,2000*2**attempt));
 }throw Error('Spatial request exhausted');}
const pending=[];
for(const p of selected){let cached=false;try{const m=JSON.parse(await readFile(`${root}/${p.id}.json`,'utf8'));if(m.resources?.mesh?.available){const b=await readFile(`${root}/${p.id}.mesh.bin`);cached=hash(b)===m.resources.mesh.sha256;}else if(m.resources?.mesh?.reason==='not-provided')cached=true;}catch{}if(cached)totals.cached++;else pending.push(p);}
for(let offset=0;offset<pending.length;offset+=50){
 const batch=pending.slice(offset,offset+50),ids=batch.map(p=>p.id),url=new URL('https://graph.mapillary.com/images');url.search=new URLSearchParams({image_ids:ids.join(','),fields:'id,mesh,atomic_scale,quality_score'}).toString();
 const response=await (await request(url,true)).json();if(!Array.isArray(response.data))throw Error('Invalid spatial metadata response');const metas=new Map(response.data.map(m=>[m.id,m]));let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<batch.length){const p=batch[next++],m=metas.get(p.id);try{
  if(!m)throw Error('Missing spatial metadata');
  const record={id:p.id,sourcePage:p.sourcePage,sourceSha256:p.sha256,atomicScale:m.atomic_scale,qualityScore:m.quality_score,resources:{mesh:{available:false,reason:'not-provided'}}};
  if(m.mesh?.url){const asset=new URL(m.mesh.url);if(asset.protocol!=='https:'||!['.fbcdn.net','.mapillary.com'].some(s=>asset.hostname.endsWith(s)))throw Error('Unexpected mesh host');
   const bytes=Buffer.from(await (await request(asset)).arrayBuffer());if(bytes.length>10000000)throw Error('Spatial mesh too large');const mesh=decodeSpatialMesh(bytes);
   await atomic(`${root}/${p.id}.mesh.bin`,bytes);record.resources.mesh={available:true,bytes:bytes.length,sha256:hash(bytes),vertices:mesh.vertices.length/3,triangles:mesh.faces.length/3};totals.downloaded++;
  }else totals.notProvided++;
  await atomic(`${root}/${p.id}.json`,JSON.stringify(record,null,2));
 }catch(e){totals.failed++;await atomic(`${root}/${p.id}.error.json`,JSON.stringify({id:p.id,error:/^Spatial HTTP \d+$/.test(e.message)?e.message:'Spatial acquisition or validation failed'}));}
 }}));console.log(totals);
}
await atomic(`${root}/acquisition-report.json`,JSON.stringify({...totals,completedAt:new Date().toISOString()},null,2));console.log(totals);if(totals.failed)process.exitCode=2;
