// Render PLATEAU depth from a calibrated landmark camera.
// The output resolution matches the source photograph coordinate system.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [cameraPath, output = 'data/texture-city/landmark-depth.f32', model = 'public/assets/datasets/plateau-2025-v1/models/tocho.glb'] = process.argv.slice(2);
const camera = JSON.parse(await readFile(cameraPath, 'utf8'));
const [width, height] = camera.resolution ?? [1920, 2560];

const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1)));
    const body = await readFile(file);
    if (file.endsWith('.js') || file.endsWith('.mjs')) res.setHeader('content-type', 'text/javascript');
    else if (file.endsWith('.glb')) res.setHeader('content-type', 'model/gltf-binary');
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height } });
const html = `<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {GLTFLoader} from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

window.run = async () => {
 const renderer = new THREE.WebGLRenderer();
 renderer.setSize(${width}, ${height}, false);
 const scene = new THREE.Scene();
 const cam = new THREE.PerspectiveCamera(45, ${width}/${height}, 0.1, 5000);
 const k = ${JSON.stringify(camera.cameraMatrix)};
 const fx=k[0][0], fy=k[1][1], cx=k[0][2], cy=k[1][2];
 const near=0.1, far=5000;
 const projection = new THREE.Matrix4().set(
   2*fx/${width}, 0, 1-2*cx/${width}, 0,
   0, 2*fy/${height}, 2*cy/${height}-1, 0,
   0, 0, -(far+near)/(far-near), -2*far*near/(far-near),
   0, 0, -1, 0
 );
 cam.projectionMatrix.copy(projection);
 // OpenCV solvePnP returns: X_camera = R * X_world + t.
 // Three.js needs the inverse transform in matrixWorld. Apply the pose used
 // by the calibrated photo camera before rendering the depth buffer.
 const rv = ${JSON.stringify(camera.rotationVector ?? [0,0,0])};
 const tv = ${JSON.stringify(camera.translationVector ?? [0,0,0])};
 const theta = Math.hypot(rv[0], rv[1], rv[2]);
 const cvRotation = new THREE.Matrix4();
 if (theta > 1e-12) {
   const axis = new THREE.Vector3(rv[0]/theta, rv[1]/theta, rv[2]/theta);
   cvRotation.makeRotationAxis(axis, theta);
 }
 const cvTranslation = new THREE.Vector3(tv[0], tv[1], tv[2]);
 const worldToCamera = new THREE.Matrix4().copy(cvRotation);
 worldToCamera.setPosition(cvTranslation);
 // OpenCV camera coordinates are x-right/y-down/z-forward. Convert to the
 // OpenGL convention used by Three.js before constructing the camera pose.
 const cvToGl = new THREE.Matrix4().set(
   1,0,0,0,
   0,-1,0,0,
   0,0,-1,0,
   0,0,0,1
 );
 worldToCamera.premultiply(cvToGl);
 const worldFromCamera = new THREE.Matrix4().copy(worldToCamera).invert();
 const cameraPosition = new THREE.Vector3().setFromMatrixPosition(worldFromCamera);
 const cameraQuaternion = new THREE.Quaternion().setFromRotationMatrix(worldFromCamera);
 cam.position.copy(cameraPosition);
 cam.quaternion.copy(cameraQuaternion);
 cam.updateMatrixWorld(true);
 const loader = new GLTFLoader();
 loader.setMeshoptDecoder(MeshoptDecoder);
 const gltf = await loader.loadAsync('/${model.replaceAll('\\', '/')}');
 scene.add(gltf.scene);
 const depthMaterial = new THREE.ShaderMaterial({vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'void main(){gl_FragColor=vec4(gl_FragCoord.z,0.,0.,1.);}'});
 gltf.scene.traverse((o)=>{ if(o.isMesh) o.material=depthMaterial; });
 const target = new THREE.WebGLRenderTarget(${width}, ${height}, {type:THREE.FloatType});
 renderer.setRenderTarget(target);
 renderer.render(scene, cam);
const pixels = new Float32Array(${width}*${height}*4);
renderer.readRenderTargetPixels(target,0,0,${width},${height},pixels);
// The depth gate consumes a single float depth plane. WebGL returns RGBA
// channels, so strip the duplicated unused channels before writing the file.
const depth = new Float32Array(${width}*${height});
for (let i = 0; i < depth.length; i++) depth[i] = pixels[i * 4];
return Array.from(depth);
};
</script>`;
const htmlPath = resolve(root, 'data/texture-city/landmark-depth-capture.html');
await writeFile(htmlPath, html);
const port = server.address().port;
page.on('pageerror', (error) => console.error('pageerror:', error.message));
page.on('console', (message) => console.error('console:', message.type(), message.text()));
await page.goto(`http://127.0.0.1:${port}/data/texture-city/landmark-depth-capture.html`);
await page.waitForFunction(() => window.run);
const pixels = await page.evaluate(() => window.run());
await writeFile(resolve(output), Buffer.from(new Float32Array(pixels).buffer));
await browser.close();
server.close();
console.log(JSON.stringify({output, width, height}));
