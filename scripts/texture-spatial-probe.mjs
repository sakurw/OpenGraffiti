// Inspect official SfM evidence before changing camera registration. No pixels or poses replaced.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'node:zlib';
const token=process.env.MAPILLARY_ACCESS_TOKEN,id=process.argv[2];
if(!token||!/^\d+$/.test(id||''))throw Error('Access token and numeric image ID required');
const root='data/texture-city/spatial';await mkdir(root,{recursive:true});
const r=await fetch(`https://graph.mapillary.com/${id}?fields=id,sfm_cluster,mesh,atomic_scale,quality_score,altitude`,{headers:{Authorization:`OAuth ${token}`},signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error(`Spatial metadata HTTP ${r.status}`);
const data=await r.json();if(data.id!==id)throw Error('Image ID mismatch');
const report={id,sourcePage:`https://www.mapillary.com/app/?pKey=${id}`,atomicScale:data.atomic_scale,qualityScore:data.quality_score,originalAltitude:data.altitude,clusterId:data.sfm_cluster?.id,resources:{}};
for(const [kind,item] of [['cluster',data.sfm_cluster],['mesh',data.mesh]]){
 if(!item?.url){report.resources[kind]={available:false};continue;}
 const url=new URL(item.url);if(url.protocol!=='https:'||!['.fbcdn.net','.mapillary.com'].some(s=>url.hostname.endsWith(s)))throw Error('Unexpected spatial asset host');
 let response;try{response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});}catch{report.resources[kind]={available:false,error:'Spatial asset request failed'};continue;}
 if(!response.ok){report.resources[kind]={available:false,status:response.status};continue;}
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>100000000)throw Error('Spatial asset exceeds probe size limit');
 await writeFile(`${root}/${id}.${kind}.bin`,bytes);
 const summary={available:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 if(kind==='cluster'){
  const clusters=JSON.parse(unzipSync(bytes,{maxOutputLength:200000000}).toString('utf8'));
  await writeFile(`${root}/${id}.cluster.json`,JSON.stringify(clusters));
  summary.reconstructions=clusters.map(c=>({keys:Object.keys(c),points:Object.keys(c.points||{}).length,shots:Object.keys(c.shots||{}).length,reference:c.reference_lla}));
 }
 report.resources[kind]=summary;
}
// Do not persist or print signed CDN URLs or API authorization material.
await writeFile(`${root}/${id}.json`,JSON.stringify(report,null,2));console.log(report);
