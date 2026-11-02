// Preserve public processed photographs byte-for-byte. No registration or application here.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const valueArg=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const discoveryPath=valueArg('discovery')??'data/texture-city/kartaview/discovery.json';
if(!/^data[\\/]texture-city[\\/]kartaview[\\/][\w.-]+\.json$/.test(discoveryPath))throw Error('Discovery must be a JSON file in data/texture-city/kartaview');
const discovery=JSON.parse(await readFile(discoveryPath,'utf8'));
if(!discovery.finishedAt||discovery.sequences.some(s=>!s.complete))throw Error('Finish discovery before acquisition');
const root='data/texture-city/photos/kartaview';await mkdir(root,{recursive:true});
const requested=Number(valueArg('limit')||discovery.photos.length);
if(!Number.isInteger(requested)||requested<1)throw Error('Invalid limit');
const sequenceArg=process.argv.find(a=>a.startsWith('--sequence='))?.slice(11);
const minIndexArg=process.argv.find(a=>a.startsWith('--min-sequence-index='))?.slice(21);
const maxIndexArg=process.argv.find(a=>a.startsWith('--max-sequence-index='))?.slice(21);
const requestedIds=(valueArg('ids')??'').split(',').filter(Boolean);
if(requestedIds.some(id=>!/^\d+$/.test(id)))throw Error('Invalid photo ID list');
const minIndex=minIndexArg===undefined?null:Number(minIndexArg),maxIndex=maxIndexArg===undefined?null:Number(maxIndexArg);
if(sequenceArg!==undefined&&!/^\d+$/.test(sequenceArg))throw Error('Invalid sequence');
if(minIndex!==null&&!Number.isInteger(minIndex))throw Error('Invalid minimum sequence index');
if(maxIndex!==null&&!Number.isInteger(maxIndex))throw Error('Invalid maximum sequence index');
if(minIndex!==null&&maxIndex!==null&&minIndex>maxIndex)throw Error('Minimum sequence index exceeds maximum');
// Interleave sequences so a bounded pilot does not contain only one night drive.
let eligible=discovery.photos.filter(p=>(!requestedIds.length||requestedIds.includes(String(p.id)))&&(sequenceArg===undefined||p.sequenceId===sequenceArg)&&(minIndex===null||Number(p.sequenceIndex)>=minIndex)&&(maxIndex===null||Number(p.sequenceIndex)<=maxIndex));
let ordered=[];
if(requestedIds.length){
 const byId=new Map(eligible.map(item=>[String(item.id),item]));ordered=requestedIds.map(id=>byId.get(id)).filter(Boolean);
 if(ordered.length!==requestedIds.length)throw Error('One or more requested IDs are absent from discovery');
}else if(sequenceArg!==undefined||minIndex!==null||maxIndex!==null){
 eligible.sort((a,b)=>Number(a.sequenceIndex)-Number(b.sequenceIndex));
 ordered=eligible;
}else{
 const groups=[...Map.groupBy(eligible,p=>p.sequenceId).values()];
 for(let i=0;i<Math.max(...groups.map(g=>g.length));i++)for(const group of groups)if(group[i])ordered.push(group[i]);
}
const photos=ordered.slice(0,requested),report={requested:photos.length,selection:{sequenceId:sequenceArg??null,minSequenceIndex:minIndex,maxSequenceIndex:maxIndex},cached:0,downloaded:0,errors:[],independence:'unverified',registration:'unregistered'};
if(!photos.length)throw Error('No discovery photos match acquisition filters');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function atomic(path,data){await writeFile(path+'.partial',data);await rename(path+'.partial',path);}
for(const p of photos){
 if(!/^\d+$/.test(p.id))throw Error('Invalid image ID');
 const prefix=`${root}/${p.id}`;
 try{
  const m=JSON.parse(await readFile(prefix+'.json','utf8')),bytes=await readFile(prefix+'.jpg');
  if(m.status==='downloaded'&&sha(bytes)===m.sha256){report.cached++;continue;}
 }catch(e){if(e.code&&e.code!=='ENOENT')throw e;}
 try{
  if(p.visibility!=='public'||p.status!=='active'||p.autoImgProcessingStatus!=='FINISHED')throw Error('Photo not publicly processed');
  const urlCandidates=[
   ['processed-cdn',p.imageProcUrl],
   ['processed-storage',p.fileurlProc],
   // Some older KartaView sequences have lost the `proc` object while the
   // official long-thumbnail object is still available.  It is still a
   // KartaView-hosted ground photograph, just at lower native resolution, so
   // keep it byte-for-byte and record the exact variant used.
   ['long-thumbnail-cdn',p.imageLthUrl],
   ['long-thumbnail-storage',p.fileurlLTh],
  ].filter(([,value])=>Boolean(value));
  const seen=new Set(),urls=[];
  for(const [variant,value] of urlCandidates){
   const url=new URL(value);
   if(seen.has(url.toString()))continue;
   seen.add(url.toString());urls.push({variant,url});
  }
  for(const {url} of urls){
   const official=url.protocol==='https:'&&(url.hostname==='cdn.kartaview.org'||/^storage\d+\.openstreetcam\.org$/.test(url.hostname));
   if(!official)throw Error('Unexpected processed image host');
  }
  let response=null,acquisitionUrl=null,acquisitionVariant=null,lastStatus=null;
  for(const {variant,url} of urls){
   await new Promise(r=>setTimeout(r,600));
   const candidate=await fetch(url,{signal:AbortSignal.timeout(30000)});
   lastStatus=candidate.status;
   if(candidate.status===429){report.errors.push({id:p.id,error:'HTTP 429; acquisition stopped'});response=null;break;}
   if(candidate.ok){response=candidate;acquisitionUrl=url.toString();acquisitionVariant=variant;break;}
  }
  if(!response){if(lastStatus===429)break;throw Error(`HTTP ${lastStatus??'unavailable'}`);}
  const bytes=Buffer.from(await response.arrayBuffer()),image=await sharp(bytes).metadata();
  if(image.format!=='jpeg'||!image.width||!image.height)throw Error('Unexpected image format');
  const sequence=discovery.sequences.find(s=>s.id===p.sequenceId)?.metadata;
  if(!sequence)throw Error('Missing sequence metadata');
  const meta={...p,provider:'kartaview',sequenceMetadata:sequence,status:'downloaded',downloadedAt:new Date().toISOString(),sha256:sha(bytes),bytes:bytes.length,downloadSize:[image.width,image.height],exifOrientation:image.orientation??null,
   sourcePage:`https://api.openstreetcam.org/2.0/photo/${p.id}`,acquisitionUrl,acquisitionVariant,license:discovery.license,
   processing:'Official KartaView JPEG preserved byte-for-byte; no local resampling or registration. acquisitionVariant records whether the processed image or long-thumbnail fallback was used.',registration:'unregistered',independence:'unverified; cross-platform duplicate check required'};
  await atomic(prefix+'.jpg',bytes);await atomic(prefix+'.json',JSON.stringify(meta,null,2));report.downloaded++;
 }catch(e){report.errors.push({id:p.id,error:/^HTTP \d+$/.test(e.message)?e.message:'Acquisition or validation failed'});}
 if((report.cached+report.downloaded+report.errors.length)%20===0)console.log(JSON.stringify({requested:report.requested,cached:report.cached,downloaded:report.downloaded,errors:report.errors.length}));
}
report.finishedAt=new Date().toISOString();const reportName=valueArg('report')??'acquisition-report.json';if(!/^[\w.-]+\.json$/.test(reportName))throw Error('Invalid report filename');await atomic(`${root}/${reportName}`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,errors:report.errors.length}));
if(report.errors.length)process.exitCode=2;
