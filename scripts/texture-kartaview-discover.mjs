// Discover an additional ground-photo source without changing either comparison input.
// The nearby endpoint finds sequences, not verified wall-image correspondences.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import pathUtil from 'node:path';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';
const root='data/texture-city/kartaview';await mkdir(root,{recursive:true});
const valueArg=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const path=pathUtil.resolve(valueArg('output')??`${root}/discovery.json`);
if(!path.startsWith(pathUtil.resolve(root)+pathUtil.sep))throw Error('Discovery output must be in data/texture-city/kartaview');
const catalog=JSON.parse(await readFile('shared/generated/plateau.json','utf8'));
let state={queries:[],sequences:[],photos:[],errors:[]};
try{state=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const photos=new Map(state.photos.map(p=>[p.id,p]));
const requestedArea=valueArg('area')||'tocho';
const padding=Number(valueArg('padding')??.0012),gridSize=Number(valueArg('grid')??8),zoomLevel=Number(valueArg('zoom')??18);
if(!Number.isFinite(padding)||padding<0||padding>.02)throw Error('Padding must be 0..0.02 degrees');
if(!Number.isInteger(gridSize)||gridSize<2||gridSize>20)throw Error('Grid must be 2..20');
if(!Number.isInteger(zoomLevel)||zoomLevel<14||zoomLevel>20)throw Error('Zoom must be 14..20');
const requestedAreas=requestedArea==='all'?['tocho','tokyo-tower']:[requestedArea];
if(requestedAreas.some(id=>!['tocho','tokyo-tower'].includes(id)))throw Error('Specify --area=tocho, --area=tokyo-tower, or --area=all');
const areas=catalog.areas.filter(a=>requestedAreas.includes(a.id)).map(a=>{
 if(!Array.isArray(a.bounds)||a.bounds.length!==4)throw Error(`Missing PLATEAU bounds for ${a.id}`);
 const [minX,maxX,minZ,maxZ]=a.bounds;
 const corners=[[minX,minZ],[minX,maxZ],[maxX,minZ],[maxX,maxZ]].map(([x,z])=>proj4(CRS,GEO,[x+a.origin[0],a.origin[1]-z]));
 const lngs=corners.map(p=>p[0]),lats=corners.map(p=>p[1]),pad=padding;
 return {id:a.id,bbox:[Math.min(...lngs)-pad,Math.min(...lats)-pad,Math.max(...lngs)+pad,Math.max(...lats)+pad],origin:a.origin,bounds:a.bounds};
});
state.areas=areas;state.source='https://kartaview.org/doc/photos';
state.license={name:'CC-BY-SA-4.0',terms:'https://kartaview.org/terms',attribution:'© Grab and KartaView Contributors'};
state.independence='unverified: KartaView supports Mapillary syncing; do not count as an independent comparison until duplicates are checked';
async function save(){state.photos=[...photos.values()];await writeFile(path+'.partial',JSON.stringify(state,null,2));await rename(path+'.partial',path);}
async function request(endpoint){
 await new Promise(r=>setTimeout(r,600));
 const response=await fetch('https://api.openstreetcam.org/2.0/'+endpoint,{signal:AbortSignal.timeout(20000)});
 if(response.status===429)throw Object.assign(Error('Rate limited; stop acquisition'),{stop:true});
 if(!response.ok)throw Error(`HTTP ${response.status}`);
 const d=await response.json();
 if(d.status?.apiCode===601)return {data:[],hasMoreData:false};
 if(d.status?.apiCode!==600)throw Error(`API ${Number(d.status?.apiCode)}`);
 if(!d.result)throw Error('Missing result');return d.result;
}
const sequenceIds=new Set(state.sequences.map(s=>s.id));
for(const a of areas){
 const [w,s,e,n]=a.bbox,points=[];
 const grid=gridSize;
 for(let x=0;x<grid;x++)for(let y=0;y<grid;y++)points.push([w+(e-w)*(x+.5)/grid,s+(n-s)*(y+.5)/grid]);
 points.push([(w+e)/2,(s+n)/2]);
 for(const [lng,lat] of points){
  const key=`${a.id}/${lat.toFixed(7)}/${lng.toFixed(7)}`;
  const cached=state.queries.find(q=>q.key===key&&q.status==='ok');
  if(cached){for(const id of cached.sequenceIds)sequenceIds.add(id);continue;}
  const q={key,area:a.id,lat,lng,zoomLevel};
  try{
   const data=await request('photo/?'+new URLSearchParams({lat,lng,zoomLevel,join:'sequence',orderBy:'id',orderDirection:'desc'}));
   if(!Array.isArray(data.data))throw Error('Expected photo array');
   const ids=[...new Set(data.data.map(p=>String(p.sequence?.id||p.sequenceId||'')).filter(id=>/^\d+$/.test(id)))];
   for(const id of ids)sequenceIds.add(id);
   state.queries.push({...q,status:'ok',count:data.data.length,sequenceIds:ids,at:new Date().toISOString()});
  }catch(e){if(e.stop){await save();throw e;}state.errors.push({...q,error:/^(HTTP|API) \d+$/.test(e.message)?e.message:'Discovery request failed'});}
  await save();console.log(JSON.stringify({area:a.id,queries:state.queries.length,sequences:sequenceIds.size,errors:state.errors.length}));
 }
}
for(const id of sequenceIds){
 let record=state.sequences.find(s=>s.id===id);
 if(record?.complete)continue;
 try{
  if(!record){const d=await request('sequence/'+id);if(d.data?.id!==id)throw Error('Wrong sequence');record={id,metadata:d.data,pages:[],complete:false};state.sequences.push(record);await save();}
  for(let page=1;page<=200;page++){
   const old=record.pages.find(p=>p.page===page);if(old){if(!old.hasMoreData){record.complete=true;break;}continue;}
   const d=await request('photo/?'+new URLSearchParams({sequenceId:id,page,itemsPerPage:150}));
   if(!Array.isArray(d.data))throw Error('Expected sequence photos');
   if(d.data.some(p=>p.sequenceId!==id))throw Error('Photo belongs to another sequence');
   const first=d.data[0]?.id;
   if(first&&record.pages.some(p=>p.first===first))throw Error('Repeated page; pagination not trustworthy');
   for(const p of d.data){
    const lat=Number(p.lat),lng=Number(p.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
    const areaIds=areas.filter(a=>lng>=a.bbox[0]&&lng<=a.bbox[2]&&lat>=a.bbox[1]&&lat<=a.bbox[3]).map(a=>a.id);
    if(areaIds.length)photos.set(p.id,{...p,areaIds});
   }
   const more=d.hasMoreData===true||d.hasMoreData===1||d.hasMoreData==='1';
   if(d.hasMoreData!==undefined&&![true,false,0,1,'0','1'].includes(d.hasMoreData))throw Error('Unknown pagination flag');
   const hasMoreData=d.hasMoreData===undefined?d.data.length===150:more;
   record.pages.push({page,count:d.data.length,first,hasMoreData});
   if(!hasMoreData)record.complete=true;
   await save();console.log(JSON.stringify({sequence:id,page,regionalPhotos:photos.size,complete:record.complete}));
   if(record.complete)break;
  }
 }catch(e){state.errors.push({sequence:id,error:/^(HTTP|API) \d+$/.test(e.message)?e.message:'Sequence acquisition or validation failed'});await save();if(e.stop)throw e;}
}
state.finishedAt=new Date().toISOString();state.discoveryParameters={paddingDegrees:padding,grid:gridSize,zoomLevel};state.note='Grid-based sequence discovery is not exhaustive. Regional frames are candidates only; none are registered or applied. Incomplete sequences and query failures stay explicit.';
await save();console.log(JSON.stringify({queries:state.queries.length,sequences:state.sequences.length,completeSequences:state.sequences.filter(s=>s.complete).length,photos:photos.size,errors:state.errors.length}));
