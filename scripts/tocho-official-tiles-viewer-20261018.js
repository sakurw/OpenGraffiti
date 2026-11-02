import * as THREE from '../.tools/plateau-official-viewer/node_modules/three/build/three.module.js';
import {OrbitControls} from '../.tools/plateau-official-viewer/node_modules/three/examples/jsm/controls/OrbitControls.js';
import {TilesRenderer,WGS84_ELLIPSOID} from '../.tools/plateau-official-viewer/node_modules/3d-tiles-renderer/build/index.three.js';
import {GLTFExtensionsPlugin} from '../.tools/plateau-official-viewer/node_modules/3d-tiles-renderer/build/index.three-plugins.js';
import {DRACOLoader} from '../.tools/plateau-official-viewer/node_modules/three/examples/jsm/loaders/DRACOLoader.js';
const status=document.getElementById('status'), errors=document.getElementById('errors');
const scene=new THREE.Scene();scene.background=new THREE.Color('#e9ede9');
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
document.getElementById('viewport').append(renderer.domElement);
renderer.domElement.setAttribute('aria-label','PLATEAU公式配布モデル。ドラッグで回転、ホイールで拡大。');
const camera=new THREE.PerspectiveCamera(48,1,1,40000),controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=10;controls.maxDistance=18000;
scene.add(new THREE.HemisphereLight(0xffffff,0x8b9c9c,2));
const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-500,1000,400);scene.add(light);
const frame=WGS84_ELLIPSOID.getEastNorthUpFrame(THREE.MathUtils.degToRad(35.6896),THREE.MathUtils.degToRad(139.6917),0,new THREE.Matrix4());
const local=new THREE.Matrix4().makeRotationX(-Math.PI/2).multiply(frame.clone().invert());
const world=new THREE.Group();world.matrixAutoUpdate=false;world.matrix.copy(local);scene.add(world);
const base='/assets/plateau-official-shinjuku-2025/model/';
const prefix='13104_shinjuku-ku_pref_2025_citygml_1_op_';
const sources=[['建物',prefix+'bldg_3dtiles_13104_shinjuku-ku_lod2'],['道路',prefix+'tran_3dtiles_lod3'],['橋梁',prefix+'brid_3dtiles_lod2'],['都市設備',prefix+'frn_3dtiles_lod3']];
const tiles=[],counts=new Map(),originalMaps=new Map(),styleMaps=new Map(),pendingTextures=[];
let styled=true,loaded=0,failures=0,patchManifest=null;
try{const r=await fetch('/assets/plateau-official-shinjuku-2025/styled/texture-overrides.json');if(r.ok)patchManifest=await r.json();}catch{}
const textureLoader=new THREE.TextureLoader();
const replacementPromises=new Map();
function applyArtwork(root,url){
 const file=url.split('/').pop().split('?')[0],entry=patchManifest?.tiles[file];
 if(!entry||entry.images.length!==1)return;
 const image=entry.images[0];
 if(!replacementPromises.has(image.url))replacementPromises.set(image.url,textureLoader.loadAsync(image.url));
 replacementPromises.get(image.url).then(texture=>{
  root.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
   if(!m.map||originalMaps.has(m))continue;
   const original=m.map,replacement=original.clone();replacement.source=new THREE.Source(texture.image);replacement.needsUpdate=true;
   originalMaps.set(m,original);styleMaps.set(m,replacement);if(styled)m.map=replacement;m.needsUpdate=true;
  }});report();
 }).catch(e=>showError('生成テクスチャ: '+e.message));
}
const dracoLoader=new DRACOLoader().setDecoderPath('/assets/plateau-official-shinjuku-2025/draco/');
function report(){const text=[...counts].map(([name,n])=>name+' '+n+'タイル').join(' / ');status.textContent='公式配布モデルを直接表示 · '+text+' · 生成テクスチャ '+styleMaps.size+'材質';renderer.domElement.dataset.loadedModels=String(loaded);renderer.domElement.dataset.failed=String(failures);renderer.domElement.dataset.source='official-downloaded-3dtiles';renderer.domElement.dataset.styledMaterials=String(styleMaps.size);}
function showError(message){failures++;const p=document.createElement('li');p.textContent=message;errors.append(p);report();}
for(const [name,dir]of sources){
 const t=new TilesRenderer(base+dir+'/tileset.json');tiles.push(t);counts.set(name,0);world.add(t.group);t.setCamera(camera);t.errorTarget=6;
 t.registerPlugin(new GLTFExtensionsPlugin({dracoLoader,autoDispose:false}));
 t.lruCache.maxSize=1500;t.lruCache.minSize=1000;t.loadSiblings=false;t.loadAncestors=true;t.displayActiveTiles=true;
 t.addEventListener('load-tileset',({tileset})=>{
  // These spatial partitions contain separate features at parent and child nodes.
  // Keep native parent contents visible while their neighboring partitions load.
  const retain=node=>{node.refine='ADD';for(const child of node.children||[])retain(child);};retain(tileset.root);
  if(tileset.root?.content)t.requestTileContents(tileset.root);
 });
 t.addEventListener('load-model',({scene:root,url})=>{
  loaded++;counts.set(name,counts.get(name)+1);
  root.traverse(o=>{if(!o.isMesh)return;
   for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map){m.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}}
  });
  if(name==='建物')applyArtwork(root,url);
  report();
 });
 t.addEventListener('load-error',({url,error})=>showError(name+': '+url+' '+error.message));
}
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();for(const t of tiles)t.setResolutionFromRenderer(camera,renderer);}
addEventListener('resize',resize);resize();
const views={home:{p:[-950,1000,1400],t:[60,80,140]},south:{p:[-500,650,1100],t:[50,70,420]},north:{p:[-550,650,-950],t:[50,70,-270]},east:{p:[1100,850,450],t:[220,80,80]},tocho:{p:[-320,320,440],t:[0,170,0]}};
function view(name){const v=views[name];camera.position.set(...v.p);controls.target.set(...v.t);controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
document.getElementById('style').onclick=()=>{styled=!styled;for(const [material,map]of originalMaps){material.map=styled?(styleMaps.get(material)||map):map;material.needsUpdate=true;}document.getElementById('style').setAttribute('aria-pressed',String(styled));document.getElementById('style').textContent=styled?'公式写真テクスチャに切替':'生成テクスチャに切替';};
view('home');
renderer.setAnimationLoop(()=>{controls.update();world.updateMatrixWorld(true);for(const t of tiles)t.update();renderer.render(scene,camera);renderer.domElement.dataset.visibleTiles=String(tiles.reduce((s,t)=>s+t.visibleTiles.size,0));renderer.domElement.dataset.triangles=String(renderer.info.render.triangles);});
// Keep loading while this review is open in a background browser panel.
setInterval(()=>{world.updateMatrixWorld(true);for(const t of tiles)t.update();},250);
window.addEventListener('error',e=>showError(e.message));window.addEventListener('unhandledrejection',e=>showError(String(e.reason)));
