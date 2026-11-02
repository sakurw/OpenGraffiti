// Official regional photo discovery. Subdivide capped searches instead of
// assuming that a response without a paging cursor is exhaustive.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const token=process.env.MAPILLARY_ACCESS_TOKEN;if(!token)throw Error('MAPILLARY_ACCESS_TOKEN required');
const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
const flat=process.argv.includes('--flat');
const path=flat?'data/texture-city/discovery-flat.json':'data/texture-city/discovery.json';await mkdir('data/texture-city',{recursive:true});
let state={queries:[],photos:[],selectedIds:[]};try{state=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const photos=new Map(state.photos.map(p=>[p.id,p]));
async function save(){state.photos=[...photos.values()];await writeFile(path,JSON.stringify(state));}
async function visit(area,bbox,depth=0){
 const key=area+'/'+bbox.map(n=>n.toFixed(7)).join(',');let q=state.queries.find(q=>q.key===key&&q.status==='ok');
 if(!q){
  const url=new URL('https://graph.mapillary.com/images');url.search=new URLSearchParams({bbox:bbox.join(','),is_pano:flat?'false':'true',fields:'id,computed_geometry,captured_at,camera_type,sequence,compass_angle',limit:'100'}).toString();
  let data;
  for(let attempt=0;attempt<4;attempt++){
   const r=await fetch(url,{headers:{Authorization:`OAuth ${token}`},signal:AbortSignal.timeout(45000)});
   if(r.ok){data=await r.json();break;}
   if(r.status>=500){data={data:[],forceSplit:true};break;}
   if((r.status!==429&&r.status<500)||attempt===3)throw Error(`Discovery HTTP ${r.status}`);
   await new Promise(resolve=>setTimeout(resolve,2000*2**attempt));
  }
  if(!Array.isArray(data?.data))throw Error('Invalid image search response');
  q={key,area,bbox,depth,status:'ok',limit:100,count:data.data.length,atLimit:data.data.length>=100||!!data.forceSplit,serverFailureSubdivided:!!data.forceSplit,queriedAt:new Date().toISOString()};
  state.queries.push(q);for(const p of data.data)photos.set(p.id,p);await save();console.log(JSON.stringify({area,depth,count:q.count,atLimit:q.atLimit,total:photos.size}));
 }
 if(q.atLimit){
  if(depth>=8){q.unresolvedCap=true;await save();return;}
  const [w,s,e,n]=bbox,x=(w+e)/2,y=(s+n)/2;
  for(const child of [[w,s,x,y],[x,s,e,y],[w,y,x,n],[x,y,e,n]])await visit(area,child,depth+1);
 }
}
for(const area of catalog.areas){
 const bs=catalog.buildings.filter(b=>b.areaId===area.id),bounds=[Math.min(...bs.map(b=>b.lon))-.001,Math.min(...bs.map(b=>b.lat))-.001,Math.max(...bs.map(b=>b.lon))+.001,Math.max(...bs.map(b=>b.lat))+.001];
 const [w,s,e,n]=bounds;
 for(let x=0;x<4;x++)for(let y=0;y<3;y++)await visit(area.id,[w+(e-w)*x/4,s+(n-s)*y/3,w+(e-w)*(x+1)/4,s+(n-s)*(y+1)/3]);
}
// One recent photo per 20m cell (and 45-degree viewing sector for flat photos).
// Opposite-facing street photographs must not replace each other. Preserve
// every discovered record so a later
// coverage pass can choose another pose; this is sampling, not facade validation.
const cells=new Map();for(const p of photos.values()){
 const ll=p.computed_geometry?.coordinates;if(!ll)continue;
 const direction=flat?(Number.isFinite(p.compass_angle)?Math.floor(((p.compass_angle%360+360)%360)/45):'unknown/'+p.id):'pano';
 const key=[Math.floor(ll[0]*111320*Math.cos(35.68*Math.PI/180)/20),Math.floor(ll[1]*111320/20),direction].join('/');
 const old=cells.get(key);if(!old||p.captured_at>old.captured_at)cells.set(key,p);
}
state.selectedIds=[...cells.values()].map(p=>p.id);state.completedAt=new Date().toISOString();state.note=`Official ${flat?'non-panorama':'panorama'} searches, capped boxes subdivided; sampled at 20m${flat?' and 45-degree viewing sectors':''} for initial acquisition. No facade registration implied.`;await save();
console.log(JSON.stringify({discovered:photos.size,selected:state.selectedIds.length,queries:state.queries.length,unresolved:state.queries.filter(q=>q.unresolvedCap).length}));
