import fs from 'node:fs/promises';
import sharp from 'sharp';
import crypto from 'node:crypto';
const out='public/assets/tocho-district-photo-v2-20261018',dir='data/texture-city/tocho-district-photo-v2-20261018';
const profiles=JSON.parse(await fs.readFile(out+'/photo-profiles.json','utf8'));
const reports=[];
for(const p of profiles.buildings){
 if(!p.artwork)continue;
 // Cropping/packing only; no recoloring, invented paint, or image stylization.
 const original=await fs.readFile(p.generationSource),meta=await sharp(original).metadata();
 const declaredFloors=p.moduleCrop?.originalFloors??p.floors;
 const {data,info}=await sharp(original).resize(64,meta.height,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const rows=[];for(let y=0;y<info.height;y++){let sum=0;for(let x=0;x<64;x++){const k=(y*64+x)*info.channels;sum+=.2126*data[k]+.7152*data[k+1]+.0722*data[k+2];}rows.push(sum/64);}
 const active=[];for(let y=0;y<info.height;y++){let v=0;for(let x=0;x<64;x++){const k=(y*64+x)*info.channels,l=.2126*data[k]+.7152*data[k+1]+.0722*data[k+2];v+=(l-rows[y])**2;}if(Math.sqrt(v/64)>12)active.push(y);}
 const lo=active[0]??0,hi=active.at(-1)??meta.height-1;
 let best={score:Infinity,lag:Math.round((hi-lo+1)/declaredFloors)};
 const a=Math.max(40,Math.floor((hi-lo+1)/declaredFloors*.65)),b=Math.min(Math.floor((hi-lo+1)*.65),Math.ceil((hi-lo+1)/declaredFloors*1.35));
 for(let lag=a;lag<=b;lag++){let error=0,count=0;for(let y=lo;y+lag<=hi;y++){error+=(rows[y]-rows[y+lag])**2;count++;}const score=error/Math.max(1,count);if(score<best.score)best={score,lag};}
 // Use an interior full cycle so outer image margins never repeat as white bands.
 let period=Math.max(1,Math.min(best.lag,meta.height));const center=Math.max(0,Math.min(meta.height-period,Math.round((lo+hi-period)/2)));
 let top=center,phaseScore=-Infinity;
 for(let y=Math.max(lo,Math.round(center-period*.45));y<=Math.min(meta.height-period,Math.round(center+period*.45));y++){
  let mean=0,n=0;for(let d=-4;d<=4;d++)if(rows[y+d]!==undefined){mean+=rows[y+d];n++;}
  const score=mean/n-.005*Math.abs(y-center);
  if(score>phaseScore){phaseScore=score;top=y;}
 }
 const sorted=[...rows].sort((a,b)=>a-b),threshold=sorted[Math.floor(sorted.length*.2)]+.6*(sorted[Math.floor(sorted.length*.8)]-sorted[Math.floor(sorted.length*.2)]);
 const runs=[];let run=null;for(let y=lo;y<=hi;y++){if(rows[y]>=threshold&&run===null)run=y;if((rows[y]<threshold||y===hi)&&run!==null){if(y-run>=8){const mid=Math.round((run+y)/2);if(mid+period<=meta.height)runs.push({mid,length:y-run});}run=null;}}
 if(runs.length)top=runs.sort((a,b)=>(Math.abs(a.mid-center)-.2*a.length)-(Math.abs(b.mid-center)-.2*b.length))[0].mid;
 let moduleFloors=1;
 if(declaredFloors<=2){top=0;period=meta.height;moduleFloors=declaredFloors;
  if([20,57].includes(p.index)){const occupied=rows.map((v,i)=>v<225?i:-1).filter(i=>i>=0);if(occupied.length){top=Math.max(0,occupied[0]-2);period=Math.min(meta.height-top,occupied.at(-1)-top+3);}}
 }
 const file=out+'/'+p.artwork;await sharp(original).extract({left:0,top,width:meta.width,height:period}).png().toFile(file);
 p.moduleCrop={source:p.generationSource,rect:{left:0,top,width:meta.width,height:period},selection:'row rhythm autocorrelation within declared floor-count bounds; crop only',originalFloors:declaredFloors,error:best.score};
 p.floors=moduleFloors;p.artworkDimensions=[meta.width,period];p.artworkSha256=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
 reports.push({buildingId:p.buildingId,index:p.index,rect:p.moduleCrop.rect,error:best.score});
}
await fs.writeFile(out+'/photo-profiles.json',JSON.stringify(profiles,null,2));
await fs.writeFile(dir+'/photo-profiles.json',JSON.stringify(profiles,null,2));
await fs.writeFile(dir+'/module-crops.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports));
