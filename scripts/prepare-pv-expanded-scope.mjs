import fs from 'node:fs/promises';
import proj4 from 'proj4';
import {toLocal} from './pv-official-frame.mjs';
import {CRS,GEO,xml,descendants,polygon} from './plateau-geometry.mjs';
const out='public/assets/pv-expanded-source-20261102',base='public/assets/tocho-twelve-blocks-20261019',native='public/assets/plateau-official-shinjuku-2025/model',scope=JSON.parse(await fs.readFile(base+'/scope.json')),oldIds=new Set(scope.selectedBuildingIds),extent=850;
await fs.mkdir(out,{recursive:true});
const local=([x,z])=>{const [lon,lat]=proj4(CRS,GEO,[scope.origin[0]+x,scope.origin[1]-z]);return toLocal(lat,lon,-37).filter((_,i)=>i!==1);};
scope.selectionPolygonXZ=[[-extent,-extent],[extent,-extent],[extent,extent],[-extent,extent]];scope.selectionPolygonENU=scope.selectionPolygonXZ.map(local);scope.version='expanded-native-1700m-20261102';
const dir=(await fs.readdir(native)).find(d=>d.endsWith('_bldg_3dtiles_13104_shinjuku-ku_lod2'));
for(const file of await fs.readdir(native+'/'+dir+'/data')){
 if(!file.endsWith('.b3dm'))continue;const bytes=await fs.readFile(native+'/'+dir+'/data/'+file),start=28+bytes.readUInt32LE(12)+bytes.readUInt32LE(16),bt=JSON.parse(bytes.subarray(start,start+bytes.readUInt32LE(20)).toString().trim()),binary=start+bytes.readUInt32LE(20),val=(k,i)=>Array.isArray(bt[k])?bt[k][i]:bt[k]?.componentType==='DOUBLE'?bytes.readDoubleLE(binary+bt[k].byteOffset+i*8):bt[k]?.componentType==='FLOAT'?bytes.readFloatLE(binary+bt[k].byteOffset+i*4):NaN;
 for(let i=0;i<(bt.gml_id?.length||0);i++){const id=bt.gml_id[i];if(oldIds.has(id))continue;const xy=proj4(GEO,CRS,[val('_x',i),val('_y',i)]),x=xy[0]-scope.origin[0],z=-(xy[1]-scope.origin[1]);if(!Number.isFinite(x)||Math.abs(x)>extent||Math.abs(z)>extent)continue;
  scope.tiles[file]??={batchIds:[],buildingIds:[]};scope.tiles[file].batchIds.push(i);scope.tiles[file].buildingIds.push(id);scope.buildings[id]??={id,name:bt['gml:name']?.[i]||'',centerXZ:[x,z],centerENU:local([x,z]),blockId:'expanded',height:val('bldg:measuredHeight',i)||val('_zmax',i)-val('_zmin',i),minHeight:val('_zmin',i),maxHeight:val('_zmax',i),tiles:[]};
 }
}
scope.selectedBuildingIds=Object.keys(scope.buildings);scope.counts.buildings=scope.selectedBuildingIds.length;scope.expansion={originalBuildings:127,extentMetres:1700,method:'Whole native LOD2 batches, original 127 definitions retained; finest descendant filtering performed by native index builder.'};await fs.writeFile(out+'/scope.json',JSON.stringify(scope,null,2));
const old=JSON.parse(await fs.readFile('data/texture-city/tocho-district-illustrated-20261018/roads.json')),roads=[...old.roads],seen=new Set(roads.map(r=>r.sourceRoadId+':'+r.polygonIndex));
for(const file of await fs.readdir('data/plateau/plateau-13104-shinjuku-ku-2025/udx/tran')){if(!file.endsWith('.gml'))continue;const text=await fs.readFile('data/plateau/plateau-13104-shinjuku-ku-2025/udx/tran/'+file,'utf8');for(const match of text.matchAll(/<tran:Road\b[^>]*gml:id="([^"]+)"[^>]*>([\s\S]*?)<\/tran:Road>/g)){const lod=match[2].match(/<tran:lod1MultiSurface\b[^>]*>[\s\S]*?<\/tran:lod1MultiSurface>/);if(!lod)continue;let i=0;for(const node of descendants(xml(lod[0]),'gml:Polygon')){const index=i++,p=polygon(node,scope.origin);if(!p||seen.has(match[1]+':'+index))continue;const ps=p.rings.flatMap(r=>r.points);if(Math.max(...ps.map(p=>p[0]))< -extent||Math.min(...ps.map(p=>p[0]))>extent||Math.max(...ps.map(p=>p[2]))< -extent||Math.min(...ps.map(p=>p[2]))>extent)continue;seen.add(match[1]+':'+index);roads.push({sourceMesh:file.slice(0,8),sourceRoadId:match[1],name:'',polygonIndex:index,lod:1,rings:p.rings});}}}
await fs.writeFile(out+'/road-source.json',JSON.stringify({...old,roads}));console.log({buildings:scope.selectedBuildingIds.length,roads:roads.length,out});
