import fs from 'node:fs/promises';
import sharp from 'sharp';
import proj4 from 'proj4';
import {xml,descendants,polygon,CRS,GEO} from './plateau-geometry.mjs';
import {Matrix4,Vector3,MathUtils} from '../.tools/plateau-official-viewer/node_modules/three/build/three.module.js';
import {WGS84_ELLIPSOID} from '../.tools/plateau-official-viewer/node_modules/3d-tiles-renderer/build/index.three.js';
const out=process.argv[2]??'public/assets/tocho-nine-blocks-20261018';await fs.mkdir(out,{recursive:true});
const prior=JSON.parse(await fs.readFile('data/texture-city/tocho-district-illustrated-20261018/scope.json','utf8'));
const roads=[];
for(const mesh of ['53394525','53394524','53394534','53394535']){
 const text=await fs.readFile('data/plateau/plateau-13104-shinjuku-ku-2025/udx/tran/'+mesh+'_tran_6697_op.gml','utf8');
 for(const match of text.matchAll(/<tran:lod1MultiSurface\b[^>]*>[\s\S]*?<\/tran:lod1MultiSurface>/g)){
  for(const n of descendants(xml(match[0]),'gml:Polygon')){const p=polygon(n,prior.origin);if(p)roads.push(p);}
 }
}
const bounds=[-750,-750,550,650],cell=.5,rw=Math.round((bounds[2]-bounds[0])/cell),rh=Math.round((bounds[3]-bounds[1])/cell);
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" viewBox="${bounds.join(' ').replace(/(.*)/,'')}${bounds[0]} ${bounds[1]} ${bounds[2]-bounds[0]} ${bounds[3]-bounds[1]}"><rect x="${bounds[0]}" y="${bounds[1]}" width="${bounds[2]-bounds[0]}" height="${bounds[3]-bounds[1]}" fill="black"/>${roads.map(r=>`<path d="${r.rings.map(r=>r.points.map((p,i)=>(i?'L':'M')+[p[0],p[2]].join(',')).join(' ')+'Z').join(' ')}" fill="white" stroke="white" stroke-width="0.5" fill-rule="evenodd"/>`).join('')}</svg>`;
const raster=await sharp(Buffer.from(svg)).greyscale().raw().toBuffer(),labels=new Int32Array(rw*rh),queue=new Int32Array(rw*rh),components=[];
for(let start=0;start<labels.length;start++){
 if(labels[start]||raster[start]>=128)continue;
 const id=components.length+1;let head=0,tail=1;queue[0]=start;labels[start]=id;let minX=rw,minZ=rh,maxX=0,maxZ=0,sx=0,sz=0,edge=false;
 while(head<tail){const p=queue[head++],x=p%rw,z=Math.floor(p/rw);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);sx+=x;sz+=z;if(!x||!z||x===rw-1||z===rh-1)edge=true;
  for(const q of [x?p-1:-1,x<rw-1?p+1:-1,z?p-rw:-1,z<rh-1?p+rw:-1])if(q>=0&&!labels[q]&&raster[q]<128){labels[q]=id;queue[tail++]=q;}
 }components.push({id,area:tail*cell*cell,bounds:[minX*cell+bounds[0],minZ*cell+bounds[1],(maxX+1)*cell+bounds[0],(maxZ+1)*cell+bounds[1]],center:[(sx/tail+.5)*cell+bounds[0],(sz/tail+.5)*cell+bounds[1]],touchesEdge:edge});
}
const labelAt=([x,z])=>labels[Math.floor((z-bounds[1])/cell)*rw+Math.floor((x-bounds[0])/cell)];
// The park is one indivisible road-bounded block. NW is the next real block
// north of the park, rather than counting the same park twice or inventing a road.
const positions=[['C',[0,0]],['N',[-40,-180]],['NE',[80,-205]],['E',[117,-16]],['SE',[152,163]],['S',[30,190]],['SW',[-80,210]],['W',[-210,-60]],['NW',[-210,-310]]];
if(process.argv[3])positions.push(['PLAZA+',JSON.parse(process.argv[3])]);
if(process.argv[4])positions.push(...JSON.parse(process.argv[4]));
const chosen=new Set(positions.map(([,p])=>labelAt(p)));
console.log(JSON.stringify(positions.map(([position,p])=>({position,seed:p,component:components[labelAt(p)-1]})),null,2));
if(chosen.size!==positions.length||chosen.has(0)||[...chosen].some(id=>components[id-1].touchesEdge))throw Error('Distinct enclosed street blocks required');
function area(r){return r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;}
function dist(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function simplify(a,t=.75){if(a.length<=2)return a;let max=0,index=0;for(let i=1;i<a.length-1;i++){const d=dist(a[i],a[0],a.at(-1));if(d>max){max=d;index=i;}}return max>t?simplify(a.slice(0,index+1),t).slice(0,-1).concat(simplify(a.slice(index),t)):[a[0],a.at(-1)];}
function contour(mask){const edges=new Map(),stride=rw+1;const add=(a,b)=>{if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b);};
 for(let z=0;z<rh;z++)for(let x=0;x<rw;x++){const p=z*rw+x;if(!mask[p])continue;const v=z*stride+x;if(!z||!mask[p-rw])add(v,v+1);if(x===rw-1||!mask[p+1])add(v+1,v+1+stride);if(z===rh-1||!mask[p+rw])add(v+1+stride,v+stride);if(!x||!mask[p-1])add(v+stride,v);}
 const loops=[];while(edges.size){const start=edges.keys().next().value;let at=start,loop=[];do{loop.push([(at%stride)*cell+bounds[0],Math.floor(at/stride)*cell+bounds[1]]);const next=edges.get(at),to=next.pop();if(!next.length)edges.delete(at);at=to;}while(at!==start);if(loop.length>3)loops.push(loop);}
 const ring=loops.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)))[0];let split=1;for(let i=2;i<ring.length;i++)if(Math.hypot(...ring[i].map((v,j)=>v-ring[0][j]))>Math.hypot(...ring[split].map((v,j)=>v-ring[0][j])))split=i;return simplify(ring.slice(0,split+1)).slice(0,-1).concat(simplify(ring.slice(split).concat([ring[0]])));
}
const blocks=positions.map(([id,p])=>({...components[labelAt(p)-1],id,polygonXZ:contour(Uint8Array.from(labels,v=>v===labelAt(p)?1:0)),buildingIds:[]}));
const owner=new Int32Array(labels);let head=0,tail=0;for(let i=0;i<owner.length;i++)if(owner[i])queue[tail++]=i;
while(head<tail){const p=queue[head++],x=p%rw,z=Math.floor(p/rw);for(const q of [x?p-1:-1,x<rw-1?p+1:-1,z?p-rw:-1,z<rh-1?p+rw:-1])if(q>=0&&!owner[q]){owner[q]=owner[p];queue[tail++]=q;}}
const selectionPolygonXZ=contour(Uint8Array.from(owner,v=>chosen.has(v)?1:0));
const frame=WGS84_ELLIPSOID.getEastNorthUpFrame(MathUtils.degToRad(35.6896),MathUtils.degToRad(139.6917),0,new Matrix4());
const toLocal=new Matrix4().makeRotationX(-Math.PI/2).multiply(frame.clone().invert());
function enu([x,z]){const [lon,lat]=proj4(CRS,GEO,[prior.origin[0]+x,prior.origin[1]-z]),xyz=proj4(GEO,'+proj=geocent +ellps=GRS80 +units=m +no_defs',[lon,lat,0]);const v=new Vector3(...xyz).applyMatrix4(toLocal);return [v.x,v.z];}
function inside(p,r){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const scope={version:`road-blocks-${positions.length}-own-only`,origin:prior.origin,centralBuildingId:prior.centralBuildingId,blocks:blocks.map(b=>({...b,polygonENU:b.polygonXZ.map(enu)})),selectionPolygonXZ,selectionPolygonENU:selectionPolygonXZ.map(enu),selectedBuildingIds:[],buildings:{},tiles:{},notes:[`${positions.length} distinct road-bounded components. Central park stays whole; NW is the next real street block north of the park.`,'Native source geometry retained; complete building batches selected, roads clipped only at the outer display perimeter.','No PLATEAU photographs are used as render materials. Additional own textures are inferred, not newly photo-confirmed.']};
const native='public/assets/plateau-official-shinjuku-2025/model',dir=(await fs.readdir(native)).find(x=>x.endsWith('_bldg_3dtiles_13104_shinjuku-ku_lod2'));
for(const file of await fs.readdir(native+'/'+dir+'/data')){if(!file.endsWith('.b3dm'))continue;const b=await fs.readFile(native+'/'+dir+'/data/'+file),ft=b.readUInt32LE(12)+b.readUInt32LE(16),bt=JSON.parse(b.subarray(28+ft,28+ft+b.readUInt32LE(20)).toString().trim());
 const binaryStart=28+ft+b.readUInt32LE(20);const value=(key,i)=>{const a=bt[key];if(Array.isArray(a))return a[i];if(a?.componentType==='DOUBLE')return b.readDoubleLE(binaryStart+a.byteOffset+i*8);if(a?.componentType==='FLOAT')return b.readFloatLE(binaryStart+a.byteOffset+i*4);return undefined;};
 const selected=[];
 for(let i=0;i<bt.gml_id.length;i++){
  const lon=Number(value('_x',i)),lat=Number(value('_y',i));
  const p=proj4(GEO,CRS,[lon,lat]),local=[p[0]-prior.origin[0],-(p[1]-prior.origin[1])];
  if(!Number.isFinite(local[0])||!inside(local,selectionPolygonXZ))continue;
  const id=bt.gml_id[i],block=blocks.find(x=>inside(local,x.polygonXZ))??blocks.reduce((a,b)=>Math.hypot(local[0]-a.center[0],local[1]-a.center[1])<Math.hypot(local[0]-b.center[0],local[1]-b.center[1])?a:b);
  selected.push(i);scope.buildings[id]??={id,name:bt['gml:name']?.[i]??'',centerXZ:local,centerENU:enu(local),blockId:block.id,height:Number(value('bldg:measuredHeight',i))||Number(value('_zmax',i))-Number(value('_zmin',i)),minHeight:value('_zmin',i),maxHeight:value('_zmax',i),tiles:[]};scope.buildings[id].tiles.push(file);
 }
 if(selected.length)scope.tiles[file]={batchIds:selected,buildingIds:selected.map(i=>bt.gml_id[i])};
}
scope.selectedBuildingIds=Object.keys(scope.buildings);for(const b of scope.blocks)b.buildingIds=scope.selectedBuildingIds.filter(id=>scope.buildings[id].blockId===b.id);
if(!scope.selectedBuildingIds.includes(scope.centralBuildingId))throw Error('Native batch coordinates did not locate Tocho');
scope.counts={blocks:positions.length,buildings:scope.selectedBuildingIds.length,nativeBuildingTiles:Object.keys(scope.tiles).length};
await fs.writeFile(out+'/scope.json',JSON.stringify(scope,null,2));
const e=selectionPolygonXZ.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1]),Math.max(a[2],p[0]),Math.max(a[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]),W=1100,H=Math.round((e[3]-e[1])/(e[2]-e[0])*W),scale=W/(e[2]-e[0]);
const d=r=>r.map((p,i)=>(i?'L':'M')+[(p[0]-e[0])*scale,(p[1]-e[1])*scale]).join(' ')+'Z';
const map=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f5f3eb"/>${blocks.map(b=>`<path d="${d(b.polygonXZ)}" fill="${b.id==='C'?'#e7b58c':'#d5dfce'}" stroke="#667665" stroke-width="1"/>`).join('')}${scope.selectedBuildingIds.map(id=>{const b=scope.buildings[id],p=b.centerXZ;return `<circle cx="${(p[0]-e[0])*scale}" cy="${(p[1]-e[1])*scale}" r="${id===scope.centralBuildingId?8:3}" fill="#456b6c"/>`;}).join('')}${blocks.map(b=>`<text x="${(b.center[0]-e[0])*scale}" y="${(b.center[1]-e[1])*scale}" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="25" fill="#243a36" stroke="#fff" stroke-width="4" paint-order="stroke">${b.id}</text>`).join('')}<path d="${d(selectionPolygonXZ)}" fill="none" stroke="#b85c38" stroke-width="4"/></svg>`;
await fs.writeFile(out+'/scope-map.svg',map);await sharp(Buffer.from(map)).png().toFile(out+'/scope-map.png');console.log(JSON.stringify(scope.counts));
