import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectGroundPhoto,validateGroundCamera} from './texture-ground-camera.mjs';

const results=[];
for(const id of ['145064071','145089656']) {
  const r=JSON.parse(await readFile(`data/texture-city/commons/control-registration/${id}.json`,'utf8'));
  validateGroundCamera(r);
  assert.ok(r.accepted);
  let maxError=0;
  for(let i=0;i<r.controls.length;i++) {
    const actual=projectGroundPhoto(r,r.controls[i].world);
    const expected=r.projectedControls[i].map((v,j)=>v*r.imageSize[j]/r.referenceSize[j]);
    const error=Math.hypot(...actual.map((v,j)=>v-expected[j]));maxError=Math.max(maxError,error);
    assert.ok(error<1e-8,'JavaScript differs from OpenCV camera projection');
  }
  results.push({source:id,cameraModel:r.cameraModel??'pinhole',controls:r.controls.length,maxPixelError:maxError});
}
const identity={cameraModel:'pinhole',rotationMatrix:[[1,0,0],[0,1,0],[0,0,1]],translationVector:[0,0,0],cameraMatrix:[[1000,0,500],[0,1000,500],[0,0,1]]};
assert.equal(projectGroundPhoto(identity,[0,0,-1]),null);
assert.throws(()=>validateGroundCamera({...identity,cameraModel:'fisheye'}));
assert.throws(()=>validateGroundCamera({...identity,distortionCoefficients:[.1,0,0,0,0]}));
assert.throws(()=>validateGroundCamera({...identity,cameraModel:'simple-radial',distortionCoefficients:[.1,.1,0,0,0]}));
console.log(JSON.stringify({passed:true,results}));
