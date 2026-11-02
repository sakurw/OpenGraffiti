import test from 'node:test';
import assert from 'node:assert/strict';
import {xml} from '../scripts/plateau-geometry.mjs';
import {buildingGeometry} from '../scripts/plateau-building.mjs';
const face=(points,id='')=>`<gml:surfaceMember><gml:Polygon${id?` gml:id="${id}"`:''}><gml:exterior><gml:LinearRing><gml:posList>${points}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>`;
test('anonymous solid faces remain distinct, retain real heights and yield vertical walls',()=>{
 const wall=face('35 139 10 35 139.001 10 35 139.001 20 35 139 20 35 139 10');
 const roof=face('35 139 20 35 139.001 20 35.001 139.001 20 35.001 139 20 35 139 20');
 const named=face('35.001 139 10 35.001 139.001 10 35.001 139.001 20 35.001 139 20 35.001 139 10','original-wall');
 const parse=s=>buildingGeometry(xml(`<bldg:Building gml:id="test"><bldg:lod1Solid>${s}</bldg:lod1Solid></bldg:Building>`),1,[0,0,0]);
 const a=parse(wall+roof+named),b=parse(named+roof+wall);
 assert.equal(a.geom.length,3);assert.equal(a.walls.length,2);
 assert.deepEqual(new Set(a.geom.map(p=>p.id)),new Set(b.geom.map(p=>p.id)));
 assert.ok(a.walls.some(p=>p.id==='original-wall'));
 assert.deepEqual([...new Set(a.walls.flatMap(p=>p.rings[0].points.map(v=>v[1])))].sort((a,b)=>a-b),[10,20]);
 assert.ok(a.walls.every(p=>p.classification==='derived-lod1-vertical-solid-face'));
});
