import test from 'node:test';
import assert from 'node:assert/strict';
import {motionHeading,angularDifference} from '../scripts/texture-motion-heading.mjs';
const frame=(id,lat,lng,sec,heading=90)=>({id,sequenceId:'one',lat,lng,heading,shotDate:`2017-08-20 06:17:${String(sec).padStart(2,'0')}.000`});
test('straight movement exposes a wrong API heading without asserting camera calibration',()=>{
 const r=motionHeading([frame('a',35,139,0),frame('b',35.00025,139,3),frame('c',35.0005,139,6)],1);
 assert.equal(r.status,'straight-motion-prior-unverified');assert.equal(r.heading,0);assert.equal(r.apiDifference,90);
 assert.deepEqual(r.neighbours.map(n=>n.id),['a','c']);
});
test('stops, turns, long time gaps and sequence boundaries have no motion prior',()=>{
 const middle=frame('b',35,139,20);
 for(const rows of [
  [frame('a',35,139,18),middle,frame('c',35,139,22)],
  [frame('a',34.9997,139,18),middle,frame('c',35,139.0004,22)],
  [frame('a',34.9997,139,0),middle,frame('c',35.0003,139,40)],
  [{...frame('a',34.9997,139,18),sequenceId:'other'},middle,frame('c',35.0003,139,22)]
 ])assert.equal(motionHeading(rows,1).status,'unavailable');
});
test('missing values stay unknown and angular wraparound is signed and small',()=>{
 assert.equal(angularDifference(359,1),-2);assert.equal(angularDifference(1,359),2);
 const rows=[frame('a',35,139,0),frame('b',35.00025,139,3,null),frame('c',35.0005,139,6)];
 assert.equal(motionHeading(rows,1).apiHeading,null);
 assert.equal(motionHeading([{...rows[0],lat:null},rows[1],rows[2]],1).status,'unavailable');
 for(const [sequence,index] of [[[],0],[null,0],[[null],0],[rows,-1],[rows,3],[rows,.5]])assert.equal(motionHeading(sequence,index).status,'unavailable');
});
