import assert from 'node:assert/strict';
import {inspectProvenance} from './texture-commons-provenance-audit.mjs';
const photo=(title,software)=>({pageId:1,title,imageInfo:{metadata:[{name:'Software',value:software}]}});
assert.deepEqual(inspectProvenance(photo('Photo - panoramio.jpg','Microsoft Windows Photo Viewer 6.1')).flags,[]);
assert.deepEqual(inspectProvenance(photo('Photo.jpg','Adobe Photoshop 25.6')).flags,[]);
assert.deepEqual(inspectProvenance(photo('Photo.jpg','Microsoft ICE v1.4.4.0')).flags,['panorama-software-projection-not-established']);
assert.deepEqual(inspectProvenance(photo('Photo cropped.jpg','')).flags,['documented-cropped-derivative']);
console.log('Commons provenance: panorama software, cropped derivatives and false-positive controls passed');
