import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import proj4 from 'proj4';
import {xml,descendants,first,nums,polygon,triangulate,dot,sub,CRS,GEO} from './plateau-geometry.mjs';
import {buildingGeometry} from './plateau-building.mjs';
const id=process.argv[2]||'plateau-13103-minato-ku-2025',mesh=process.argv[3]||'53393599';
const root=resolve('data/plateau',id),source=`udx/bldg/${mesh}_bldg_6697_op.gml`,s=await readFile(resolve(root,source),'utf8');
const [e,n]=proj4(GEO,CRS,mesh==='53393599'?[139.745433,35.658581]:[139.6917,35.6896]),origin=[e,n,0];
const buildings=[],textures={};
for(const m of s.matchAll(/<app:ParameterizedTexture\b[^>]*>[\s\S]*?<\/app:ParameterizedTexture>/g)){const t=xml(m[0]),image=first(t,'app:imageURI')?.text.trim();for(const target of descendants(t,'app:target')){const rings={};for(const tc of descendants(target,'app:textureCoordinates'))rings[tc.a.ring.replace(/^#/,'')]=nums(tc.text);textures[target.a.uri?.replace(/^#/,'')]={image,rings};}}
for(const m of s.matchAll(/<bldg:Building\b[^>]*>[\s\S]*?<\/bldg:Building>/g)){
 const b=xml(m[0]);const lod=[4,3,2,1].find(l=>descendants(b,`bldg:lod${l}Solid`).length||descendants(b,`bldg:lod${l}MultiSurface`).length)||1;
 const {geom,walls}=buildingGeometry(b,lod,origin);if(!geom.length)continue;const pts=geom.flatMap(p=>p.rings[0].points);const min=[0,1,2].map(i=>Math.min(...pts.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...pts.map(p=>p[i])));
 buildings.push({id:b.a['gml:id'],name:first(b,'gml:name')?.text||'',lod,min,max,walls,polygons:geom});
}
const candidates=[];for(const b of buildings.filter(b=>b.lod>=3))for(const p of b.walls){const f=triangulate(p.rings.map(r=>r.points)),xy=f.points.map(v=>[dot(sub(v,f.o),f.u),dot(sub(v,f.o),f.v)]),lo=[0,1].map(i=>Math.min(...xy.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...xy.map(p=>p[i]))),width=hi[0]-lo[0],height=hi[1]-lo[1];let area=0;for(let i=0;i<f.indices.length;i+=3){const [a,b,c]=f.indices.slice(i,i+3).map(i=>xy[i]);area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
 const distance=f.points.map(p=>Math.abs(dot(sub(p,f.o),f.normal))),rms=Math.sqrt(distance.reduce((a,v)=>a+v*v,0)/distance.length);const reasons=[];if(Math.abs(f.normal[1])>Math.sin(Math.PI/18))reasons.push('tilt');if(rms>.02||Math.max(...distance)>.05)reasons.push('nonplanar');if(width<4||height<2.5||area<12||width/height<.25||width/height>4)reasons.push('size');if(!textures[p.id])reasons.push('no-appearance');if(!p.surfaceId||!p.id)reasons.push('no-id');if(p.openings>8)reasons.push('openings');
 candidates.push({buildingId:b.id,surfaceId:p.surfaceId,polygonId:p.id,width,height,area,rms,maxDeviation:Math.max(...distance),normal:f.normal,origin:f.o,u:f.u,v:f.v,lo,hi,openingCount:p.openings,holeCount:p.rings.length-1,reasons,texture:textures[p.id],minHeight:Math.min(...f.points.map(p=>p[1]))});}
const report={id,source,crs:'EPSG:6677',axis:'X east,Y up,Z south',origin,buildings:buildings.length,lodCounts:Object.fromEntries([1,2,3,4].map(l=>[l,buildings.filter(b=>b.lod===l).length])),lod3:buildings.filter(b=>b.lod>=3).map(b=>({id:b.id,name:b.name,min:b.min,max:b.max,polygons:b.polygons.length,walls:b.walls.length})),candidates};
await writeFile(resolve(root,mesh+'-inspection.json'),JSON.stringify(report,null,2));await writeFile(resolve(root,mesh+'-geometry.json'),JSON.stringify({origin,buildings,textures}));
console.log(JSON.stringify({...report,candidates:candidates.filter(c=>!c.reasons.length).map(c=>({...c,texture:c.texture?.image}))},null,2));
