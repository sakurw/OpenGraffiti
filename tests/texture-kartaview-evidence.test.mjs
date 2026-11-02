import test from 'node:test';
import assert from 'node:assert/strict';
import {kartaviewCameraEvidence} from '../scripts/texture-kartaview-evidence.mjs';
const k={hFoV:62.054133519825292,vFoV:48.562920191021867};
test('missing KartaView intrinsics are not converted into known zero values',()=>{
 const e=kartaviewCameraEvidence({downloadSize:[1920,1080],cameraParameters:{hFoV:null}});
 assert.equal(e.horizontalFoV,null);assert.equal(e.status,'missing-or-invalid-intrinsics');
});
test('KartaView sensor FoV does not silently stretch video or portrait photos',()=>{
 for(const downloadSize of [[1920,1080],[1936,2592]]){
  const e=kartaviewCameraEvidence({downloadSize,sequenceMetadata:{cameraParameters:k}});
  assert.equal(e.status,'aspect-inconsistent-requires-calibration');assert.equal(e.registration,'unregistered');
 }
});
test('consistent aspect is only a consistency check, not a calibrated camera',()=>{
 const e=kartaviewCameraEvidence({downloadSize:[4000,3000],cameraParameters:k});
 assert.equal(e.status,'aspect-consistent-unverified');assert.equal(e.registration,'unregistered');
 assert.throws(()=>kartaviewCameraEvidence({downloadSize:[0,1080]}),/Invalid/);
});
