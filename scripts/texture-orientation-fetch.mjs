import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
const token=process.env.MAPILLARY_ACCESS_TOKEN;if(!token)throw Error('MAPILLARY_ACCESS_TOKEN is required');
const root='data/texture-city/photos/mapillary',output='data/texture-city/orientation';await mkdir(output,{recursive:true});
const items=[];for(const f of await readdir(root))if(/^\d+\.json$/.test(f)){const p=JSON.parse(await readFile(`${root}/${f}`,'utf8'));if(process.argv.includes('--all-cameras')||p.camera_type==='perspective')items.push(p);}
const limit=process.argv[2]==='all'?items.length:Number(process.argv[2]||20);if(!Number.isInteger(limit)||limit<1||limit>items.length)throw Error('Invalid sample count');
const selected=Array.from({length:limit},(_,i)=>items[Math.floor(i*items.length/limit)]),counts={},nonUpright=[];
let next=0,done=0;await Promise.all(Array.from({length:3},async()=>{while(next<selected.length){const p=selected[next++];let meta;try{meta=JSON.parse(await readFile(`${output}/${p.id}.json`,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;
 const response=await fetch(`https://graph.mapillary.com/${p.id}?fields=id,exif_orientation,width,height`,{headers:{Authorization:`OAuth ${token}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Orientation metadata HTTP ${response.status}`);meta=await response.json();if(meta.id!==p.id)throw Error('Image ID mismatch');await writeFile(`${output}/${p.id}.json`,JSON.stringify(meta,null,2));
}
counts[meta.exif_orientation]=(counts[meta.exif_orientation]||0)+1;if(meta.exif_orientation!==1)nonUpright.push({id:p.id,orientation:meta.exif_orientation,original:[meta.width,meta.height],download:p.downloadSize});
done++;if(done%200===0)console.log({done,total:selected.length,counts});
}}));
await writeFile(`${output}/report.json`,JSON.stringify({sample:selected.length,counts,nonUpright},null,2));console.log({sample:selected.length,counts,nonUprightCount:nonUpright.length});
