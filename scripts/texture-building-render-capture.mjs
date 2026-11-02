// Capture RGB, depth, and world-position buffers from a PLATEAU GLB.
// This is the runtime stage consumed by texture-building-render-backproject.py.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const [model = 'public/assets/datasets/plateau-2025-v1/models/tocho.glb', out = 'data/texture-city/render-capture', cameraFile] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const root = resolve('.');
const server = createServer(async (req, res) => {
  const path = resolve(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1)));
  if (!path.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const ext = path.split('.').pop();
    res.setHeader('Content-Type', ext === 'js' ? 'text/javascript' : ext === 'html' ? 'text/html' : ext === 'glb' ? 'model/gltf-binary' : 'application/octet-stream');
    res.end(await readFile(path));
  }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolveServer) => server.listen(0, resolveServer));
const port = server.address().port;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on('console', (message) => console.error('browser-console:', message.text()));
page.on('pageerror', (error) => console.error('browser-error:', error.message));

const html = `<!doctype html><base href="http://127.0.0.1:${port}/"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><canvas id="c"></canvas><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {GLTFLoader} from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
window.start = async () => {
 const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer:true});
 const scene = new THREE.Scene();
 const camera = new THREE.PerspectiveCamera(45, 4/3, 0.1, 5000);
 const loader = new GLTFLoader();
 loader.setMeshoptDecoder(MeshoptDecoder);
 const gltf = await loader.loadAsync('${model.replaceAll('\\','/') }');
 scene.background = new THREE.Color(0x202020);
 scene.add(gltf.scene);
// Use a deterministic feature-capture material. Source GLB materials can be
// missing, transparent, or unsuitable for feature extraction. The capture is
// only used for geometry/photo matching, not final texture output.
gltf.scene.traverse((object) => {
  if (!object.isMesh) return;
  object.material = new THREE.MeshBasicMaterial({ color: 0xb0b0b0 });
});
 const box = new THREE.Box3().setFromObject(gltf.scene);
 const center = box.getCenter(new THREE.Vector3());
 const externalCamera = ${cameraFile ? `JSON.parse(await (await fetch('${cameraFile.replaceAll('\\\\','/')}')).text())` : 'null'};
 if (externalCamera?.view && externalCamera?.projection) {
   camera.projectionMatrix.fromArray(externalCamera.projection);
   camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
   camera.matrixWorld.fromArray(externalCamera.view).invert();
   camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
 } else if (externalCamera?.position) {
   camera.position.fromArray(externalCamera.position);
   camera.lookAt(center);
 } else {
 const size = box.getSize(new THREE.Vector3());
 if (!Number.isFinite(size.length()) || size.length() === 0) throw new Error('empty model bounds');
 const distance = Math.max(size.x, size.y, size.z) * 2.5;
 camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.35, distance));
 camera.lookAt(center);
 }
 camera.updateMatrixWorld();
 const vertexDiagnostic = [];
 gltf.scene.traverse((object) => {
   if (!object.isMesh) return;
   const position = object.geometry.getAttribute('position');
   if (!position) return;
   const limit = position.count;
   for (let i = 0; i < limit; i++) {
     const local = new THREE.Vector3().fromBufferAttribute(position, i);
     const world = local.clone().applyMatrix4(object.matrixWorld);
     const view = world.clone().applyMatrix4(camera.matrixWorldInverse);
     const clip = new THREE.Vector4(view.x, view.y, view.z, 1).applyMatrix4(camera.projectionMatrix);
     vertexDiagnostic.push({mesh: object.name || '', uuid: object.uuid, geometryUuid: object.geometry.uuid, index: i, world: world.toArray(), view: view.toArray(), clip: clip.toArray()});
   }
 });
 renderer.setSize(1024,768,false);
 const target = new THREE.WebGLRenderTarget(1024,768,{depthBuffer:true});
 target.depthTexture = new THREE.DepthTexture(1024,768);
 renderer.setRenderTarget(target);
 renderer.render(scene,camera);
 // Render the RGB capture to the visible canvas. The previous implementation
 // only rendered into the offscreen depth target, so toDataURL() captured the
 // untouched black canvas and prevented feature extraction.
 renderer.setRenderTarget(null);
 renderer.render(scene,camera);
 const rgb = renderer.domElement.toDataURL('image/png');
 const xyzScene = new THREE.Scene();
 gltf.scene.traverse((object) => {
   if (!object.isMesh) return;
   const material = new THREE.ShaderMaterial({
     vertexShader: 'varying vec3 worldPosition; void main(){ worldPosition=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
     fragmentShader: 'varying vec3 worldPosition; void main(){ gl_FragColor=vec4(worldPosition,1.0); }'
   });
   const mesh = new THREE.Mesh(object.geometry, material);
   mesh.matrixWorld.copy(object.matrixWorld);
   mesh.matrixAutoUpdate = false;
   xyzScene.add(mesh);
 });
 const xyzTarget = new THREE.WebGLRenderTarget(1024,768,{type:THREE.FloatType});
 renderer.setRenderTarget(xyzTarget);
 renderer.render(xyzScene,camera);
 const xyzPixels = new Float32Array(1024 * 768 * 4);
 renderer.readRenderTargetPixels(xyzTarget, 0, 0, 1024, 768, xyzPixels);

 const depthScene = new THREE.Scene();
 gltf.scene.traverse((object) => {
   if (!object.isMesh) return;
   const material = new THREE.ShaderMaterial({
     vertexShader: 'void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
     fragmentShader: 'void main(){ gl_FragColor=vec4(gl_FragCoord.z,0.0,0.0,1.0); }'
   });
   const mesh = new THREE.Mesh(object.geometry, material);
   mesh.matrixWorld.copy(object.matrixWorld);
   mesh.matrixAutoUpdate = false;
   depthScene.add(mesh);
 });
 const depthTarget = new THREE.WebGLRenderTarget(1024,768,{type:THREE.FloatType});
 renderer.setRenderTarget(depthTarget);
 renderer.render(depthScene,camera);
 const depthPixels = new Float32Array(1024 * 768 * 4);
 renderer.readRenderTargetPixels(depthTarget, 0, 0, 1024, 768, depthPixels);

 const idScene = new THREE.Scene();
 let nextTriangleId = 1;
 const triangleIdRanges = [];
 let nextPrimitiveId = 0;
 let nextMeshIndex = 0;
 gltf.scene.traverse((object) => {
   if (!object.isMesh) return;
   const meshIndex = nextMeshIndex++;
  const primitiveId = nextPrimitiveId++;
  // GLTFLoader splits glTF primitives into render Mesh objects. Preserve the
  // original glTF mesh association when available so later audits can use
  // source primitive identity instead of relying on traversal order.
  const gltfAssociation = gltf.parser?.associations?.get(object) ?? null;
   const sourceGeometry = object.geometry;
   const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
   const positionCount = geometry.getAttribute('position').count;
   const triangleIds = new Float32Array(positionCount);
   for (let i = 0; i < positionCount; i++) triangleIds[i] = Math.floor(i / 3) + nextTriangleId;
   geometry.setAttribute('triangleId', new THREE.BufferAttribute(triangleIds, 1));
   const material = new THREE.ShaderMaterial({
     vertexShader: 'attribute float triangleId; flat out float vTriangleId; void main(){ vTriangleId=triangleId; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
     fragmentShader: 'flat in float vTriangleId; void main(){ float triangleId=vTriangleId; gl_FragColor=vec4(floor(triangleId/65536.0)/255.0, floor(mod(triangleId,65536.0)/256.0)/255.0, mod(triangleId,256.0)/255.0, 1.0); }'
   });
   const mesh = new THREE.Mesh(geometry, material);
   mesh.matrixWorld.copy(object.matrixWorld);
   mesh.matrixAutoUpdate = false;
   idScene.add(mesh);
   const count = geometry.getAttribute('position').count / 3;
   const positionAttribute = geometry.getAttribute('position');
   const triangleVertices = [];
   const sourceTriangles = [];
   for (let triangleIndex = 0; triangleIndex < count; triangleIndex++) {
     const vertices = [];
     for (let corner = 0; corner < 3; corner++) {
       const local = new THREE.Vector3().fromBufferAttribute(positionAttribute, triangleIndex * 3 + corner);
       vertices.push(local.applyMatrix4(object.matrixWorld).toArray());
     }
     triangleVertices.push(vertices);
     if (sourceGeometry.index) {
       sourceTriangles.push([
         sourceGeometry.index.getX(triangleIndex * 3),
         sourceGeometry.index.getX(triangleIndex * 3 + 1),
         sourceGeometry.index.getX(triangleIndex * 3 + 2),
       ]);
     } else {
       sourceTriangles.push([triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2]);
     }
   }
   triangleIdRanges.push({
     mesh: object.uuid,
     meshIndex,
     meshName: object.name || '',
     geometryUuid: object.geometry.uuid,
     primitiveId,
     // Keep the parser association as a small plain record. The full Three.js
     // object graph is not serializable and is not needed for provenance.
     gltfAssociation: gltfAssociation ? {
       type: gltfAssociation.type ?? null,
       index: gltfAssociation.index ?? null,
       meshes: gltfAssociation.meshes ?? null,
       primitives: gltfAssociation.primitives ?? null,
       nodes: gltfAssociation.nodes ?? null,
     } : null,
     // GLTFLoader creates one Mesh per primitive in this capture path, so the
     // primitive index within the original mesh is zero. Keep it separate from
     // the global render-only primitiveId.
     semanticPrimitiveId: 0,
     indexed: !!object.geometry.index,
     indexCount: object.geometry.index ? object.geometry.index.count : object.geometry.getAttribute('position').count,
     sourceTriangleCount: object.geometry.index ? object.geometry.index.count / 3 : object.geometry.getAttribute('position').count / 3,
     sourceTriangles,
     nonIndexedTriangleCount: count,
     triangleVertices,
     start: nextTriangleId,
     count,
   });
   nextTriangleId += count;
 });
 const idTarget = new THREE.WebGLRenderTarget(1024,768,{type:THREE.UnsignedByteType});
 renderer.setRenderTarget(idTarget);
 renderer.render(idScene,camera);
 const triangleIdPixels = new Uint8Array(1024 * 768 * 4);
 renderer.readRenderTargetPixels(idTarget, 0, 0, 1024, 768, triangleIdPixels);
 const xyzAvailable = !!xyzTarget.texture;
 window.__worldPositionBuffer = Array.from(xyzPixels);
 window.__depthBuffer = Array.from(depthPixels);
 window.__triangleIdBuffer = Array.from(triangleIdPixels);
 window.__vertexDiagnostic = vertexDiagnostic;
 window.__capture = {rgb, depthAvailable: !!target.depthTexture, gpuDepthAvailable: true, worldPositionAvailable: xyzAvailable, worldPositionBytes: xyzPixels.byteLength, depthBytes: depthPixels.byteLength, triangleIdRanges, vertexDiagnosticCount: vertexDiagnostic.length, camera:{
   position:camera.position.toArray(),
   projection:camera.projectionMatrix.toArray(),
   view:camera.matrixWorldInverse.toArray(),
   near:camera.near,
   far:camera.far,
   fov:camera.fov,
   aspect:camera.aspect,
   resolution:[1024,768]
 }};
};
</script>`;
await writeFile(resolve(out, 'capture.html'), html);
await page.goto(`http://127.0.0.1:${port}/${out.replaceAll('\\','/')}/capture.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.start === 'function');

await page.evaluate(() => window.start());
const result = await page.evaluate(() => window.__capture);
const vertexDiagnostic = await page.evaluate(() => window.__vertexDiagnostic);
await writeFile(resolve(out, 'camera.json'), JSON.stringify(result.camera, null, 2));
await writeFile(resolve(out, 'gpu-vertex-diagnostic.json'), JSON.stringify(vertexDiagnostic, null, 2));
await writeFile(resolve(out, 'rgb-data-url.txt'), result.rgb);
// Keep a normal image artifact for downstream feature extraction. The
// previous pipeline stored only the data URL, which made the matcher unable
// to consume the capture directly.
const rgbPng = Buffer.from(result.rgb.split(',')[1], 'base64');
await writeFile(resolve(out, 'render.png'), rgbPng);
 await writeFile(resolve(out, 'render-contract.json'), JSON.stringify({rgb:true, depthTexture:result.depthAvailable, gpuDepth:true, worldPosition:result.worldPositionAvailable, triangleId:true, resolution:[1024,768]}, null, 2));
const worldPositionBuffer = await page.evaluate(() => window.__worldPositionBuffer);
if (worldPositionBuffer) {
  await writeFile(resolve(out, 'world-position.f32'), Buffer.from(new Float32Array(worldPositionBuffer).buffer));
}
const depthBuffer = await page.evaluate(() => window.__depthBuffer);
if (depthBuffer) {
  await writeFile(resolve(out, 'gpu-depth.f32'), Buffer.from(new Float32Array(depthBuffer).buffer));
}
const triangleIdBuffer = await page.evaluate(() => window.__triangleIdBuffer);
if (triangleIdBuffer) {
  await writeFile(resolve(out, 'triangle-id.rgba8'), Buffer.from(new Uint8Array(triangleIdBuffer).buffer));
  await writeFile(resolve(out, 'triangle-id-ranges.json'), JSON.stringify(result.triangleIdRanges, null, 2));
}
await browser.close();
server.close();
console.log(JSON.stringify({status:'rgb-capture-prototype', output:out}));
