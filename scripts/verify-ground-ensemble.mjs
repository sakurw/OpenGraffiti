import assert from 'node:assert/strict';
import {validateGroundCamera,projectGroundPhotoSet,withinConvexHull} from './texture-ground-camera.mjs';
import {createGroundSurfaceTester} from './texture-ground-surface.mjs';
import {sceneBvh} from './texture-ground-visibility.mjs';
const camera=(z,f,cx=500)=>({cameraModel:'pinhole',cameraPosition:[0,0,z],rotationMatrix:[[1,0,0],[0,1,0],[0,0,1]],
  translationVector:[0,0,-z],cameraMatrix:[[f,0,cx],[0,f,500],[0,0,1]],distortionCoefficients:[0,0,0,0,0],kind:'training-noise',converged:true});
const r={...camera(0,1000),positionValidation:'projection-ensemble',requiresPerSurfaceEnsembleValidation:true,worldCameraPositionVerified:false,
  imageSize:[1000,1000],referenceSize:[1000,1000],validatedControlHullReferencePixels:[[0,0],[1000,0],[1000,1000],[0,1000]],
  gates:{maximumProjectionSpreadReferencePixels:4},projectionEnsemble:Array.from({length:64},()=>camera(-10,2000)),
  projectionEnsembleValidation:{heldOutWorstRmsPixels:0,heldOutWorstMaxPixels:0},
  supportedHeightRangeMetres:[-10,10],mask:new Uint8Array(1000*1000).fill(255),margin:18};
validateGroundCamera(r);
assert.equal(projectGroundPhotoSet(r,[1,2,10]).maximumSpread,0,'A 10m pose shift can preserve a plane projection exactly');
assert.equal(projectGroundPhotoSet(r,[1,2,20]).reason,'projection-ensemble-spread','Nonplanar extrapolation must fail');
assert.equal(projectGroundPhotoSet(r,[6,0,10]).reason,'outside-validated-control-hull');
assert.equal(withinConvexHull([.5,.5],[[0,0],[0,1],[1,1],[1,0]]),true);
assert.throws(()=>validateGroundCamera({...r,projectionEnsemble:r.projectionEnsemble.slice(1)}),/Missing training-only/);
assert.throws(()=>validateGroundCamera({...r,requiresPerSurfaceEnsembleValidation:false}),/surface-only/);
assert.throws(()=>validateGroundCamera({...r,gates:{maximumProjectionSpreadReferencePixels:8}}),/Changed projection/);
assert.throws(()=>validateGroundCamera({...r,referenceSize:[NaN,1000]}),/Invalid image dimensions/);
assert.throws(()=>validateGroundCamera({...r,validatedControlHullReferencePixels:[[0,0],[1,1],[2,2]]}),/Degenerate control hull/);
const poly=z=>({id:'plane-'+z,rings:[{points:[[-5,-5,z],[5,-5,z],[5,5,z],[-5,5,z]]}]});
const self=sceneBvh([{id:'target',polygons:[poly(10)]}]);
const scene=sceneBvh([{id:'target',polygons:[poly(10)]},{id:'occluder',polygons:[poly(-5)]}]);
const triangle=[[-1,-1,10],[1,-1,10],[0,1,10]],normal=[0,0,-1];
const test=createGroundSurfaceTester(self.bvh),blocked=createGroundSurfaceTester(scene.bvh);
assert.ok(test(r,triangle,normal).uv,'Stable visible region should pass');
assert.equal(blocked(r,triangle,normal).reason,'occlusion','One hypothetical camera behind an obstruction invalidates the cell');
assert.ok(blocked({...r,positionValidation:'gps-consistency'},triangle,normal).uv,'The nominal camera alone cannot detect this blocker');
const shifted={...r,projectionEnsemble:Array.from({length:64},()=>camera(-10,2000,503)),mask:r.mask.slice()};
shifted.mask[400*1000+403]=0;
assert.equal(test(shifted,triangle,normal).reason,'facade-mask','Every camera must stay inside the valid mask');
assert.ok(test({...shifted,positionValidation:'gps-consistency'},triangle,normal).uv,'Nominal mask remains clear');
self.geometry.dispose();scene.geometry.dispose();
console.log('Projection ensemble: plane invariance, extrapolation, hull, mandatory contract, unchanged spread gate, every-camera occlusion and masks passed');
