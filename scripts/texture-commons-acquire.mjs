// Real independently sourced photos for the ground-photo + SNAP branch.
// Acquisition is not evidence of ground level or facade correspondence.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root='data/texture-city/photos/commons';await mkdir(root,{recursive:true});
const option=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const survey=JSON.parse(await readFile(option('discovery')||'public/assets/texture-poc/city-survey.json','utf8'));
// Mapillary mirrors are not independent comparison inputs.
const requestedIds=option('ids')?.split(',');
const candidates=survey.photos.filter(p=>p.provider==='commons'&&!/Mapillary/i.test(p.title||'')&&(!requestedIds||requestedIds.includes(p.id.split('/')[1]))).slice(0,Number(option('limit')||Infinity));
const report={candidates:candidates.length,downloaded:0,cached:0,rejectedLicense:0,failed:0};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let notBefore=0;try{notBefore=JSON.parse(await readFile(`${root}/rate-limit.json`,'utf8')).notBefore||0;}catch(e){if(e.code!=='ENOENT')throw e;}
async function get(url){for(let i=0;i<4;i++){
 while(Date.now()<notBefore){console.log(JSON.stringify({status:'rate-limit-wait',resumeAt:new Date(notBefore).toISOString()}));await pause(Math.min(30000,notBefore-Date.now()));}
 await pause(2000);
 const r=await fetch(url,{headers:{'User-Agent':'OpenGraffitiLocalResearch/0.1 (facade comparison)'},signal:AbortSignal.timeout(45000)});if(r.ok)return r;
 if(r.status===429){const value=r.headers.get('retry-after'),seconds=Number(value);notBefore=Math.max(Date.now()+600000,Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(value)||0);await writeFile(`${root}/rate-limit.json`,JSON.stringify({notBefore,reason:'HTTP 429 Retry-After'}));}
 if((r.status!==429&&r.status<500)||i===3)throw Error('HTTP '+r.status);if(r.status!==429)await pause(10000*2**i);
}}
for(let offset=0;offset<candidates.length;offset+=50){
 const list=candidates.slice(offset,offset+50),key=list.map(p=>p.id.split('/')[1]).join('|');let pages=list.every(p=>p.imageInfo)?{}:undefined;
 const cache=`${root}/batch-${offset}.json`;
 try{const c=JSON.parse(await readFile(cache,'utf8'));if(c.key===key)pages=c.pages;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!pages){await pause(9000);const url=new URL('https://commons.wikimedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'1600',pageids:key}).toString();const data=await (await get(url)).json();pages=data.query?.pages;if(!pages)throw Error('Unexpected Commons response');await writeFile(cache,JSON.stringify({key,pages}));}
 let next=0;await Promise.all(Array.from({length:1},async()=>{while(next<list.length){const candidate=list[next++],id=candidate.id.split('/')[1],path=`${root}/${id}`;
  try{
   let existing;try{existing=JSON.parse(await readFile(path+'.json','utf8'));const bytes=await readFile(path+'.jpg');if(existing.status==='downloaded'&&createHash('sha256').update(bytes).digest('hex')===existing.sha256){report.cached++;continue;}}catch{}
   const info=candidate.imageInfo||pages[id]?.imageinfo?.[0],meta=info?.extmetadata,license=meta?.LicenseShortName?.value||'';
   if(!/^(CC BY(?:-SA)? [\d.]+|CC0|Public domain)$/i.test(license)){report.rejectedLicense++;await writeFile(path+'.skip.json',JSON.stringify({id,title:candidate.title,license,status:'license-not-accepted'}));continue;}
   const url=new URL(info.thumburl||info.url);if(!['upload.wikimedia.org','thumb.wikimedia.org'].includes(url.hostname)||url.protocol!=='https:')throw Error('Unexpected image host');
   const source=Buffer.from(await (await get(url)).arrayBuffer());
   await writeFile(path+'.source',source);
   const converted=await sharp(source).rotate().jpeg({quality:95}).toBuffer();
   const size=await sharp(converted).metadata();await writeFile(path+'.jpg',converted);
   const strip=s=>(s||'').replace(/<[^>]*>/g,'');
   await writeFile(path+'.json',JSON.stringify({id,provider:'commons',title:candidate.title,sourcePage:info.descriptionurl,originalImageUrl:info.url,author:strip(meta.Artist?.value),credit:strip(meta.Credit?.value),license,licenseUrl:meta.LicenseUrl?.value,captureDate:strip(meta.DateTimeOriginal?.value),description:strip(meta.ImageDescription?.value),sourceBytesSha256:createHash('sha256').update(source).digest('hex'),sha256:createHash('sha256').update(converted).digest('hex'),downloadSize:[size.width,size.height],candidateLocation:{lat:candidate.lat,lon:candidate.lon},processing:'EXIF orientation applied; JPEG quality 95',status:'downloaded',registration:'unregistered',groundPhotoVerified:false},null,2));report.downloaded++;
  }catch(e){report.failed++;await writeFile(path+'.error.json',JSON.stringify({id,error:/^HTTP \d+$/.test(e.message)?e.message:'Image acquisition failed'}));}
 }}));console.log(JSON.stringify({...report,processed:Math.min(offset+50,candidates.length)}));
}
await writeFile(`${root}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.failed)process.exitCode=2;
