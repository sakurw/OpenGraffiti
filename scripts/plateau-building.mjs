import {createHash} from 'node:crypto';
import {descendants,polygon,frame} from './plateau-geometry.mjs';

// Anonymous CityGML polygons are distinct surfaces, not one `undefined` key.
// Synthetic IDs depend on source geometry; existing source IDs are untouched.
export function buildingGeometry(b,lod,origin){
 const all=descendants(b,'gml:Polygon');
 for(const p of all)if(!p.a['gml:id']){
  const signature=descendants(p,'gml:posList').map(n=>n.text.trim().replace(/\s+/g,' ')).join('|');
  p.a['gml:id']=`${b.a['gml:id']}-anonymous-${createHash('sha256').update(signature).digest('hex').slice(0,24)}`;
 }
 const polygons=new Map(all.map(p=>[p.a['gml:id'],p])),used=new Map();
 for(const scope of [`bldg:lod${lod}MultiSurface`,`bldg:lod${lod}Solid`,`bldg:lod${lod}Geometry`])for(const node of descendants(b,scope)){
  for(const p of descendants(node,'gml:Polygon'))used.set(p.a['gml:id'],p);
  for(const r of descendants(node,'gml:surfaceMember')){
   const id=r.a['xlink:href']?.replace(/^#/,'');
   if(polygons.has(id))used.set(id,polygons.get(id));
  }
 }
 const geom=[...used.values()].map(p=>polygon(p,origin)).filter(Boolean),walls=[];
 for(const ws of descendants(b,'bldg:WallSurface'))for(const node of ws.c.filter(c=>c.t===`bldg:lod${lod}MultiSurface`))for(const pn of descendants(node,'gml:Polygon')){
  const p=polygon(pn,origin);if(p){p.surfaceId=ws.a['gml:id'];p.openings=descendants(ws,'bldg:opening').length;walls.push(p);}
 }
 // LOD1 has a real Solid but no semantic WallSurface. Use only its vertical faces.
 if(lod===1&&!walls.length)for(const p of geom){
  const n=frame(p.rings[0].points).normal;
  if(Math.hypot(...n)>.9&&Math.abs(n[1])<Math.sin(Math.PI/18))walls.push({...p,surfaceId:p.id,openings:0,classification:'derived-lod1-vertical-solid-face'});
 }
 return {geom,walls};
}
