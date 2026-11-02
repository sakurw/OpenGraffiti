import fs from 'node:fs/promises';
import {Matrix4} from '../.tools/plateau-official-viewer/node_modules/three/build/three.module.js';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';
const out=process.argv[2]??'public/assets/tocho-nine-blocks-20261018',scope=JSON.parse(await fs.readFile(out+'/scope.json','utf8'));
const base='public/assets/plateau-official-shinjuku-2025/model',dirs=await fs.readdir(base);
const ll=scope.selectionPolygonXZ.map(([x,z])=>proj4(CRS,GEO,[scope.origin[0]+x,scope.origin[1]-z]));
const region=ll.reduce((b,p)=>[Math.min(b[0],p[0]*Math.PI/180),Math.min(b[1],p[1]*Math.PI/180),Math.max(b[2],p[0]*Math.PI/180),Math.max(b[3],p[1]*Math.PI/180)],[Infinity,Infinity,-Infinity,-Infinity]);
const sources=[['buildings','_bldg_3dtiles_13104_shinjuku-ku_lod2'],['roads','_tran_3dtiles_lod3'],['bridges','_brid_3dtiles_lod2'],['equipment','_frn_3dtiles_lod3']];
scope.layerContentCounts={};
for(const [name,suffix]of sources){const dir=dirs.find(x=>x.endsWith(suffix)),original=JSON.parse(await fs.readFile(base+'/'+dir+'/tileset.json','utf8')),children=[];
 // Source REPLACE nodes are alternative resolutions, not building fragments.
 // Keep a batch only at its finest selected descendant; preserve genuine siblings.
 if(name==='buildings'){
  const descendants=new Map();
  function collect(n){const below=(n.children??[]).flatMap(collect),uri=n.content?.uri??n.content?.url,file=uri?.split('/').pop();if(file)descendants.set(file,below);return file?[file,...below]:below;}
  collect(original.root);const candidates=scope.tiles,filtered={};let removed=0;
  for(const [file,entry] of Object.entries(candidates)){
   const replacedIds=new Set((descendants.get(file)??[]).flatMap(f=>candidates[f]?.buildingIds??[])),batchIds=[],buildingIds=[];
   entry.buildingIds.forEach((id,i)=>{if(replacedIds.has(id))removed++;else{batchIds.push(entry.batchIds[i]);buildingIds.push(id);}});
   if(batchIds.length)filtered[file]={batchIds,buildingIds};
  }
  const covered=new Set(Object.values(filtered).flatMap(e=>e.buildingIds));
  if(scope.selectedBuildingIds.some(id=>!covered.has(id)))throw Error('LOD filtering removed a required building');
  scope.tiles=filtered;scope.nativeLodSelection={mode:'finest descendant per building, original sibling contents retained',removedCoarseBatchOccurrences:removed,coveredBuildings:covered.size,ancestorBatchOverlaps:0};
  scope.counts.nativeBuildingTiles=Object.keys(filtered).length;
  for(const b of Object.values(scope.buildings))b.tiles=Object.keys(filtered).filter(file=>filtered[file].buildingIds.includes(b.id));
 }
 function visit(node,parent=new Matrix4()){
  const transform=parent.clone();if(node.transform)transform.multiply(new Matrix4().fromArray(node.transform));
  if(node.content){const uri=node.content.uri??node.content.url,file=uri.split('/').pop(),bv=node.content.boundingVolume??node.boundingVolume,r=bv.region;
   const hasReplacement=(node.children??[]).length>0;
   const hit=name==='buildings'?Boolean(scope.tiles[file]):!hasReplacement&&(!r||(r[0]<=region[2]&&r[2]>=region[0]&&r[1]<=region[3]&&r[3]>=region[1]));
   if(hit){const child={boundingVolume:{region:[region[0]-.00001,region[1]-.00001,region[2]+.00001,region[3]+.00001,0,450]},geometricError:0,refine:'ADD',content:{uri:'/assets/plateau-official-shinjuku-2025/model/'+dir+'/'+uri}};
    if(!transform.equals(new Matrix4()))child.transform=transform.toArray();children.push(child);}
  }for(const c of node.children??[])visit(c,transform);
 }visit(original.root);
 const result={asset:original.asset,geometricError:1e6,root:{boundingVolume:{region:[region[0]-.00001,region[1]-.00001,region[2]+.00001,region[3]+.00001,0,450]},geometricError:1e6,refine:'ADD',children}};
 await fs.writeFile(out+'/'+name+'-tileset.json',JSON.stringify(result));scope.layerContentCounts[name]=children.length;
}
await fs.writeFile(out+'/scope.json',JSON.stringify(scope,null,2));console.log(JSON.stringify(scope.layerContentCounts));
