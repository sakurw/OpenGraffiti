import test from 'node:test';
import assert from 'node:assert/strict';
import {xml,polygon,triangulate,project,CRS,GEO,cross,sub} from '../scripts/plateau-geometry.mjs';
import proj4 from 'proj4';
test('EPSG6677 origin and axis conversion',()=>{const origin=proj4(GEO,CRS,[139.745433,35.658581]);assert.deepEqual(project(35.658581,139.745433,10,[...origin,0]),[0,10,0]);assert.ok(project(35.6587,139.745433,10,[...origin,0])[2]<0);assert.ok(project(35.658581,139.7456,10,[...origin,0])[0]>0);});
test('triangulation preserves a window hole',()=>{const rings=[[[0,0,0],[8,0,0],[8,4,0],[0,4,0]],[[2,1,0],[2,3,0],[4,3,0],[4,1,0]]];const t=triangulate(rings);let area=0;for(let i=0;i<t.indices.length;i+=3){const [a,b,c]=t.indices.slice(i,i+3).map(j=>t.points[j]);area+=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;}assert.equal(area,28);});
test('XML parser preserves source polygon and ring IDs',()=>{const p=polygon(xml('<gml:Polygon gml:id="p"><gml:exterior><gml:LinearRing gml:id="r"><gml:posList>35.6 139.7 0 35.6 139.71 0 35.6 139.71 4 35.6 139.7 0</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>'),[0,0,0]);assert.equal(p.id,'p');assert.equal(p.rings[0].id,'r');assert.equal(p.rings[0].points.length,3);});
