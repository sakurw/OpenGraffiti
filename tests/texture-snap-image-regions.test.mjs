import test from 'node:test';
import assert from 'node:assert/strict';
import {imageRegionFilter} from '../scripts/texture-snap-image-regions.mjs';
test('SNAP regions scale source coordinates and reject foreground samples',()=>{
 const f=imageRegionFilter({referenceSize:[100,100],polygons:[[[10,10],[80,10],[80,90],[10,90]]]},[200,300]);
 assert.equal(f([[20,30],[160,270],[90,150]]),true);
 assert.equal(f([[90,150],[180,150]]),false);
 assert.equal(f([[NaN,150]]),false);
 assert.equal(f([]),false);
 assert.equal(imageRegionFilter(null,[200,300])([[180,150]]),true);
 assert.throws(()=>imageRegionFilter({referenceSize:[100,100],polygons:[[[0,0],[10,0],[10,10]]]},[0,300]),/image size/);
});
test('a retained SNAP triangle must fit within one convex reviewed region',()=>{
 const f=imageRegionFilter({referenceSize:[100,100],polygons:[[[0,0],[40,0],[40,40],[0,40]],[[60,60],[100,60],[100,100],[60,100]]]},[100,100]);
 assert.equal(f([[10,10],[30,10],[10,30]]),true);
 assert.equal(f([[10,10],[80,80],[90,90]]),false);
 assert.throws(()=>imageRegionFilter({referenceSize:[100,100],polygons:[[[0,0],[100,0],[30,30],[0,100]]]},[100,100]),/convex/);
 assert.throws(()=>imageRegionFilter({referenceSize:[100,100],polygons:[[[0,0],[10,10],[20,20]]]},[100,100]),/Degenerate/);
});
