import {readFile} from 'node:fs/promises';
import {xml,descendants,nums} from './plateau-geometry.mjs';
for(const [dataset,tile] of [['plateau-13103-minato-ku-2025','53393599'],['plateau-13104-shinjuku-ku-2025','53394525']]){
 const source=await readFile(`data/plateau/${dataset}/udx/tran/${tile}_tran_6697_op.gml`,'utf8');
 const counts={};
 for(const m of source.matchAll(/<tran:Road\b[^>]*>[\s\S]*?<\/tran:Road>/g)){
  const road=xml(m[0]),lod=[3,2,1].find(l=>descendants(road,`tran:lod${l}MultiSurface`).length);if(!lod)continue;
  const item=counts[lod]??={roads:0,positions:0,zeroHeight:0,min:Infinity,max:-Infinity};item.roads++;
  for(const scope of descendants(road,`tran:lod${lod}MultiSurface`))for(const list of descendants(scope,'gml:posList')){
   const values=nums(list.text);for(let i=2;i<values.length;i+=3){item.positions++;if(values[i]===0)item.zeroHeight++;item.min=Math.min(item.min,values[i]);item.max=Math.max(item.max,values[i]);}
  }
 }
 console.log(JSON.stringify({dataset,counts}));
}
