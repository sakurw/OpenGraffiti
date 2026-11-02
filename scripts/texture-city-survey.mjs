// Nearby discovery only: location proximity never proves that a building or wall is pictured.
import {readFile,writeFile} from 'node:fs/promises';
const root='public/assets/texture-poc',catalog=JSON.parse(await readFile(root+'/city-catalog.json','utf8'));
const cells=new Map();for(const b of catalog.buildings){const key=`${b.areaId}/${Math.floor(b.center[0]/400)}/${Math.floor(b.center[2]/400)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(b);}
let prior={queries:[],photos:[]};try{prior=JSON.parse(await readFile(root+'/city-survey.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const queries=[],photos=new Map(prior.photos.map(p=>[p.id,p]));
for(const [cell,buildings] of cells){
 const lat=buildings.reduce((s,b)=>s+b.lat,0)/buildings.length,lon=buildings.reduce((s,b)=>s+b.lon,0)/buildings.length;
 for(const provider of ['commons','mapillary']){
  const url=provider==='commons'?`https://commons.wikimedia.org/w/api.php?action=query&format=json&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=600&gsnamespace=6&gslimit=50`:`https://michiyomi.dev/v1/scenes/nearby?lat=${lat}&lon=${lon}&radius_m=600&limit=50`;
  let record=prior.queries.find(q=>q.cell===cell&&q.provider===provider&&q.status==='ok'&&q.lat===lat&&q.lon===lon);
  const cached=!!record;
  record??={cell,provider,lat,lon,radius:600,limit:50,queriedAt:new Date().toISOString(),status:'ok',candidates:[]};
  if(!cached){
  await new Promise(resolve=>setTimeout(resolve,9000));
  try{
   const response=await fetch(url,{headers:{'User-Agent':'OpenGraffitiLocalResearch/0.1 (facade image feasibility study)'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`HTTP ${response.status}`);const data=await response.json();
   const list=provider==='commons'?data.query?.geosearch:data.results;if(!Array.isArray(list))throw Error('Unexpected response');
   record.atLimit=list.length>=50;record.snapshot=data.snapshot||null;
   for(const p of list){const id=provider+'/'+(p.pageid||p.id);record.candidates.push(id);photos.set(id,provider==='commons'?{id,provider,lat:p.lat,lon:p.lon,title:p.title,url:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(p.title),verification:'not-reviewed'}:{id,provider,lat:p.lat,lon:p.lon,year:p.capture_year,url:p.image_page,verification:'not-reviewed'});}
  }catch(e){record.status='error';record.error=String(e);}
  }
  queries.push(record);
  for(const b of buildings){const item=b[provider==='commons'?'snap':'mapillary'];if(item.survey!=='applied')item.survey=record.status==='error'?'search-error':'candidates-unverified';item.queryCell=cell;}
 }
 console.log(cell+' '+queries.slice(-2).map(q=>q.provider+':'+q.candidates.length+' '+q.status).join(' / '));
}
function distance(a,b){const dy=(a.lat-b.lat)*111320,dx=(a.lon-b.lon)*111320*Math.cos(a.lat*Math.PI/180);return Math.hypot(dx,dy);}
for(const b of catalog.buildings)for(const p of ['snap','mapillary']){
 const item=b[p],provider=p==='snap'?'commons':'mapillary';
 item.candidates=[...photos.values()].filter(x=>x.provider===provider&&distance(b,x)<300).sort((a,c)=>distance(b,a)-distance(b,c)).slice(0,8).map(x=>({id:x.id,distance:Math.round(distance(b,x))}));
 if(item.survey==='candidates-unverified'&&!item.candidates.length)item.survey='no-nearby-candidate-in-sample';
}
catalog.survey={completedAt:new Date().toISOString(),queries:queries.length,errors:queries.filter(q=>q.status==='error').length,photoCandidates:photos.size,method:'400m grid; nearest 50 photos in 600m radius, up to 8 within 300m per building; not exhaustive and NOT verified facade coverage'};
await writeFile(root+'/city-survey.json',JSON.stringify({queries,photos:[...photos.values()],attribution:'Mapillary candidate metadata via michiyomi, © Mapillary contributors CC BY-SA 4.0. Commons file location metadata via Wikimedia Commons. No VLM narratives reproduced.'}));
await writeFile(root+'/city-catalog.json',JSON.stringify(catalog));console.log(JSON.stringify(catalog.survey));
