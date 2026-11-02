import * as THREE from '../.tools/plateau-official-viewer/node_modules/three/build/three.module.js';
import {OrbitControls} from '../.tools/plateau-official-viewer/node_modules/three/examples/jsm/controls/OrbitControls.js';
import {TilesRenderer,WGS84_ELLIPSOID} from '../.tools/plateau-official-viewer/node_modules/3d-tiles-renderer/build/index.three.js';
import {GLTFExtensionsPlugin} from '../.tools/plateau-official-viewer/node_modules/3d-tiles-renderer/build/index.three-plugins.js';
import {DRACOLoader} from '../.tools/plateau-official-viewer/node_modules/three/examples/jsm/loaders/DRACOLoader.js';
const scopeBase=document.documentElement.dataset.scopeBase??'/assets/tocho-nine-blocks-20261018';
const comparison=document.documentElement.dataset.compare==='true';
const scope=await fetch(scopeBase+'/scope.json').then(r=>r.json());
const atlas=await fetch('/assets/plateau-official-shinjuku-2025/own-only/texture-overrides.json').then(r=>r.json());
const profileInput=await fetch('/assets/tocho-district-photo-v3-20261018/photo-profiles.json').then(r=>r.json());
const profiles=new Map(profileInput.buildings.map(p=>[p.buildingId,p]));
const status=document.getElementById('status'),errors=document.getElementById('errors'),scene=new THREE.Scene();scene.background=new THREE.Color('#eae8de');
const originalScene=comparison?new THREE.Scene():null;if(originalScene)originalScene.background=scene.background.clone();
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
document.getElementById('viewport').append(renderer.domElement);renderer.domElement.setAttribute('aria-label',comparison?`都庁中心の${scope.counts.blocks}街区。左が独自、右がPLATEAU標準テクスチャ。共通カメラで比較。`:`都庁中心の${scope.counts.blocks}街区。公式モデルの形状に独自テクスチャのみを適用。`);
const camera=new THREE.PerspectiveCamera(45,1,1,15000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=50;controls.maxDistance=3000;
const frame=WGS84_ELLIPSOID.getEastNorthUpFrame(THREE.MathUtils.degToRad(35.6896),THREE.MathUtils.degToRad(139.6917),0,new THREE.Matrix4());
const local=new THREE.Matrix4().makeRotationX(-Math.PI/2).multiply(frame.clone().invert()),world=new THREE.Group();world.matrixAutoUpdate=false;world.matrix.copy(local);scene.add(world);
const originalWorld=comparison?new THREE.Group():null;if(originalWorld){originalWorld.matrixAutoUpdate=false;originalWorld.matrix.copy(local);originalScene.add(originalWorld);}
const envelope=scope.selectionPolygonENU,ext=envelope.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1]),Math.max(a[2],p[0]),Math.max(a[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const maskCanvas=document.createElement('canvas');maskCanvas.width=maskCanvas.height=1024;const ctx=maskCanvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,1024,1024);ctx.beginPath();envelope.forEach(([x,z],i)=>ctx[i?'lineTo':'moveTo']((x-ext[0])/(ext[2]-ext[0])*1024,(z-ext[1])/(ext[3]-ext[1])*1024));ctx.closePath();ctx.fillStyle='white';ctx.fill();
const mask=new THREE.DataTexture(ctx.getImageData(0,0,1024,1024).data,1024,1024,THREE.RGBAFormat);mask.needsUpdate=true;mask.minFilter=mask.magFilter=THREE.LinearFilter;
const uniforms={ownEnabled:{value:1},scopeMask:{value:mask},scopeRect:{value:new THREE.Vector4(...ext)}};
const seen=new Set(),tileCounts=new Map(),tiles=[],materials=[],texturePromises=new Map();let failures=0,atlasMaterials=0;
const originalSeen=new Set(),originalTextureBuildings=new Set();let originalPhotoMaterials=0,sharedGeometryMeshes=0;
const textureLoader=new THREE.TextureLoader(),dracoLoader=new DRACOLoader().setDecoderPath('/assets/plateau-official-shinjuku-2025/draco/');
function report(){status.textContent=comparison?`独自 ${seen.size}/${scope.counts.buildings}棟 ｜ PLATEAU ${originalSeen.size}/${scope.counts.buildings}棟 · 同じ形状・視点`:`${scope.counts.blocks}街区 · 建物 ${seen.size}/${scope.counts.buildings}棟 · 独自テクスチャのみ（元写真なし）`;renderer.domElement.dataset.buildings=String(seen.size);renderer.domElement.dataset.expectedBuildings=String(scope.counts.buildings);renderer.domElement.dataset.ownAtlasMaterials=String(atlasMaterials);renderer.domElement.dataset.failed=String(failures);renderer.domElement.dataset.blocks=String(scope.counts.blocks);renderer.domElement.dataset.loadedBuildingTiles=String(tileCounts.get('buildings')??0);renderer.domElement.dataset.expectedBuildingTiles=String(scope.layerContentCounts.buildings);renderer.domElement.dataset.buildingIds=JSON.stringify([...seen].sort());if(comparison){renderer.domElement.dataset.originalBuildings=String(originalSeen.size);renderer.domElement.dataset.originalPhotoMaterials=String(originalPhotoMaterials);renderer.domElement.dataset.sharedCamera='true';renderer.domElement.dataset.originalTextureBuildings=String(originalTextureBuildings.size);renderer.domElement.dataset.sharedGeometryMeshes=String(sharedGeometryMeshes);}}
function fail(e){failures++;const li=document.createElement('li');li.textContent=String(e.message??e);errors.append(li);report();}
function material(color,clipped=false){const m=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide});m.userData.ownOnly=true;materials.push(m);
 m.onBeforeCompile=s=>{Object.assign(s.uniforms,uniforms);s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 ownUv;attribute vec3 ownColor;attribute float ownRole;attribute float ownShade;varying vec2 vOwnUv;varying vec3 vOwnColor;varying float vOwnRole;varying float vOwnShade;varying vec2 vDistrictXZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nvOwnUv=ownUv;vOwnColor=ownColor;vOwnRole=ownRole;vOwnShade=ownShade;vDistrictXZ=(modelMatrix*vec4(transformed,1.0)).xz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
uniform float ownEnabled;uniform sampler2D scopeMask;uniform vec4 scopeRect;varying vec2 vOwnUv;varying vec3 vOwnColor;varying float vOwnRole;varying float vOwnShade;varying vec2 vDistrictXZ;
// Integrate repeated strips across the pixel footprint. Hard step(fract(uv))
// aliases when a window becomes smaller than one screen pixel.
float stripIntegral(float x,float lo,float hi){return floor(x)*(hi-lo)+clamp(fract(x)-lo,0.0,hi-lo);}
float filteredStrip(float x,float lo,float hi,float footprint){float w=max(footprint,0.0001);return clamp((stripIntegral(x+w*0.5,lo,hi)-stripIntegral(x-w*0.5,lo,hi))/w,0.0,1.0);}
`);
  s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`${clipped?`vec2 districtUv=(vDistrictXZ-scopeRect.xy)/(scopeRect.zw-scopeRect.xy);if(any(lessThan(districtUv,vec2(0.0)))||any(greaterThan(districtUv,vec2(1.0)))||texture2D(scopeMask,districtUv).r<0.5)discard;`:''}
vec2 footprint=max(fwidth(vOwnUv),vec2(0.0001));vec3 ownBase=vOwnColor;
if(ownEnabled>0.5){
 if(vOwnRole>0.5&&vOwnRole<1.5){float windowMask=filteredStrip(vOwnUv.x,0.18,0.82,footprint.x)*filteredStrip(vOwnUv.y,0.20,0.78,footprint.y);vec3 glass=mix(vOwnColor,vec3(0.085,0.15,0.18),0.72);ownBase=mix(vOwnColor,glass,windowMask);float seam=filteredStrip(vOwnUv.x,0.0,0.025,footprint.x)+filteredStrip(vOwnUv.y,0.0,0.035,footprint.y);ownBase*=1.0-min(seam,1.0)*0.13;}
 else {float seam=max(filteredStrip(vOwnUv.x,0.0,0.018,footprint.x),filteredStrip(vOwnUv.y,0.0,0.018,footprint.y));ownBase*=1.0-seam*0.09;}
 #ifdef USE_MAP
 vec4 ownArt=texture2D(map,vMapUv);ownBase=mix(ownBase,ownArt.rgb,ownArt.a);
 #endif
}
diffuseColor=vec4(ownBase*vOwnShade,1.0);`);
 };m.customProgramCacheKey=()=>clipped?'own-only-clipped-filtered-v2':'own-only-building-filtered-v2';return m;
}
function modelMatrix(o,root){const m=new THREE.Matrix4();for(let p=o;p;p=p.parent){m.premultiply(p.matrix);if(p===root)break;}return local.clone().multiply(m);}
function hash(id){let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function tint(id){const p=profiles.get(id),palette=[[188,185,169],[173,179,172],[192,177,157],[165,175,180],[184,177,168],[176,185,178]],rgb=p?.baseColor??palette[hash(id)%palette.length];return new THREE.Color().setRGB(rgb[0]/255,rgb[1]/255,rgb[2]/255,THREE.SRGBColorSpace);}
function ownGeometry(mesh,root,entry,datum){
 const original=mesh.geometry,pos=original.getAttribute('position'),batch=original.getAttribute('_batchid')??original.getAttribute('_BATCHID')??original.getAttribute('batchId');
 if(!batch)throw Error('公式モデルの建物ID属性が見つかりません');
 const allowed=new Map(entry.batchIds.map((id,i)=>[id,entry.buildingIds[i]])),ix=original.index?.array??Array.from({length:pos.count},(_,i)=>i),selected=[];
 for(let i=0;i<ix.length;i+=3)if(allowed.has(Math.round(batch.getX(ix[i])))){selected.push(ix[i],ix[i+1],ix[i+2]);}
 if(!selected.length){mesh.visible=false;return null;}
 const g=original.clone();g.setIndex(selected);const expanded=g.toNonIndexed();g.dispose();const p=expanded.getAttribute('position'),bid=expanded.getAttribute('_batchid')??expanded.getAttribute('_BATCHID')??expanded.getAttribute('batchId'),transform=modelMatrix(mesh,root),groups=new Map(),triangles=[];
 for(let i=0;i<p.count;i+=3){const id=allowed.get(Math.round(bid.getX(i))),points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,i+j).applyMatrix4(transform)),normal=new THREE.Triangle(...points).getNormal(new THREE.Vector3());
  const u=new THREE.Vector3(normal.z,0,-normal.x).normalize();if(u.length()<.1)u.set(1,0,0);const key=[id,Math.round(normal.x*100),Math.round(normal.y*100),Math.round(normal.z*100),Math.round(normal.dot(points[0])*5)].join(':');
  const group=groups.get(key)??{id,u,normal,minU:Infinity,maxU:-Infinity,minY:Infinity,maxY:-Infinity,area:0};for(const q of points){const v=q.dot(u);group.minU=Math.min(group.minU,v);group.maxU=Math.max(group.maxU,v);group.minY=Math.min(group.minY,q.y);group.maxY=Math.max(group.maxY,q.y);}group.area+=new THREE.Triangle(...points).getArea();groups.set(key,group);triangles.push({i,id,points,group});seen.add(id);
 }
 const uv=new Float32Array(p.count*2),colors=new Float32Array(p.count*3),roles=new Float32Array(p.count),shades=new Float32Array(p.count),light=new THREE.Vector3(-.5,.8,.4).normalize();
 for(const t of triangles){const f=t.group,b=scope.buildings[t.id],profile=profiles.get(t.id),width=f.maxU-f.minU,height=f.maxY-f.minY,buildingHeight=Math.max(3,b.maxHeight-b.minHeight),floorHeight=profile?.floorHeight??3.5,bays=Math.max(1,Math.round(width/(profile?.bayWidth??3))),floors=Math.max(1,Math.round(buildingHeight/floorHeight));
  const roof=Math.abs(f.normal.y)>.65,wall=Math.abs(f.normal.y)<.2&&height>=4.8&&width>=2.4&&f.area>=18&&f.minY<b.maxHeight+datum-6&&profile?.windowAllowed!==false;
  const color=tint(t.id);if(roof)color.lerp(new THREE.Color('#8b9691'),.48);const shade=.81+.19*Math.max(0,f.normal.dot(light));
  for(let j=0;j<3;j++){const at=t.i+j,q=t.points[j];uv[at*2]=roof?q.x/2:(q.dot(f.u)-f.minU)/Math.max(width,.01)*bays;uv[at*2+1]=roof?q.z/2:(q.y-b.minHeight-datum)/buildingHeight*floors;colors.set([color.r,color.g,color.b],at*3);roles[at]=wall?1:roof?2:0;shades[at]=shade;}
 }
 expanded.setAttribute('ownUv',new THREE.BufferAttribute(uv,2));expanded.setAttribute('ownColor',new THREE.BufferAttribute(colors,3));expanded.setAttribute('ownRole',new THREE.BufferAttribute(roles,1));expanded.setAttribute('ownShade',new THREE.BufferAttribute(shades,1));expanded.computeBoundingSphere();mesh.geometry=expanded;return expanded;
}
function plainGeometry(mesh,root,type){const p=mesh.geometry.getAttribute('position'),transform=modelMatrix(mesh,root),uv=new Float32Array(p.count*2),colors=new Float32Array(p.count*3),roles=new Float32Array(p.count),shades=new Float32Array(p.count).fill(1),color=new THREE.Color(type==='roads'?'#8b9694':'#9ea7a0');for(let i=0;i<p.count;i++){const q=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(transform);uv.set([q.x/3,q.z/3],i*2);colors.set([color.r,color.g,color.b],i*3);}mesh.geometry=mesh.geometry.clone();mesh.geometry.setAttribute('ownUv',new THREE.BufferAttribute(uv,2));mesh.geometry.setAttribute('ownColor',new THREE.BufferAttribute(colors,3));mesh.geometry.setAttribute('ownRole',new THREE.BufferAttribute(roles,1));mesh.geometry.setAttribute('ownShade',new THREE.BufferAttribute(shades,1));}
function nativeMaterial(source){const m=new THREE.MeshBasicMaterial({color:source.color?.clone()??new THREE.Color('white'),map:source.map??null,side:THREE.DoubleSide,opacity:source.opacity??1,transparent:source.transparent??false,alphaTest:source.alphaTest??0});m.userData.plateauOriginal=true;if(m.map){m.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());originalPhotoMaterials++;}return m;}
for(const name of ['buildings','roads','bridges','equipment']){
 if(!scope.layerContentCounts[name])continue;
 const t=new TilesRenderer(scopeBase+'/'+name+'-tileset.json');t.registerPlugin(new GLTFExtensionsPlugin({dracoLoader,autoDispose:false}));tiles.push(t);tileCounts.set(name,0);world.add(t.group);t.setCamera(camera);t.errorTarget=1;t.displayActiveTiles=true;t.loadSiblings=true;t.lruCache.maxSize=500;t.lruCache.minSize=400;t.lruCache.maxBytesSize=2*1024**3;t.lruCache.minBytesSize=1024**3;
 t.addEventListener('load-tileset',({tileset})=>{t.ensureChildrenArePreprocessed(tileset.root,true);for(const child of tileset.root.children??[])t.requestTileContents(child);});
 t.addEventListener('load-model',({scene:root,url})=>{try{
  const file=url.split('/').pop().split('?')[0],entry=scope.tiles[file],ownEntry=atlas.tiles[file],sourceMaterials=[],sourceMeshes=[];root.updateMatrixWorld(true);
  root.traverse(o=>{if(!o.isMesh)return;
   if(comparison){sourceMaterials.push(o.material);sourceMeshes.push(o);}
   if(name==='buildings'){if(!entry){o.visible=false;return;}if(!ownGeometry(o,root,entry,ownEntry?.verticalDatumOffsetMeters??37))return;}else plainGeometry(o,root,name);
   // Replace the entire source material before the model can render: no photo flash.
   const m=material('#ffffff',name!=='buildings');o.material=m;
   if(name==='buildings'&&ownEntry?.images.length===1){const image=ownEntry.images[0];if(!texturePromises.has(image.url))texturePromises.set(image.url,textureLoader.loadAsync(image.url).then(tex=>{tex.flipY=false;tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return tex;}));texturePromises.get(image.url).then(tex=>{m.map=tex;m.needsUpdate=true;atlasMaterials++;report();}).catch(fail);}
  });if(comparison){const originalRoot=root.clone(true);let i=0;originalRoot.traverse(o=>{if(!o.isMesh)return;const own=sourceMeshes[i],source=sourceMaterials[i++];if(o.geometry!==own.geometry)throw Error('比較モデルの形状が一致しません');if(o.visible)sharedGeometryMeshes++;if(name==='buildings'&&o.visible){o.material=Array.isArray(source)?source.map(nativeMaterial):nativeMaterial(source);const batch=o.geometry.getAttribute('_batchid')??o.geometry.getAttribute('_BATCHID')??o.geometry.getAttribute('batchId'),allowed=new Set(entry.batchIds);for(let j=0;j<batch.count;j++){const b=Math.round(batch.getX(j));if(allowed.has(b)){const id=entry.buildingIds[entry.batchIds.indexOf(b)];originalSeen.add(id);if((Array.isArray(o.material)?o.material:[o.material]).some(m=>m.map))originalTextureBuildings.add(id);}}}});originalWorld.add(originalRoot);}
  tileCounts.set(name,tileCounts.get(name)+1);report();
 }catch(e){root.visible=false;fail(e);}});
 t.addEventListener('load-error',({error})=>fail(error));
}
let renderWidth=innerWidth,renderHeight=innerHeight;
function resize(){const rect=comparison?document.getElementById('viewport').getBoundingClientRect():{width:innerWidth,height:innerHeight};renderWidth=Math.max(1,Math.floor(rect.width));renderHeight=Math.max(1,Math.floor(rect.height));renderer.setSize(renderWidth,renderHeight);camera.aspect=renderWidth/(comparison?2:1)/renderHeight;camera.updateProjectionMatrix();for(const t of tiles)t.setResolutionFromRenderer(camera,renderer);}addEventListener('resize',resize);resize();
const target=new THREE.Vector3((ext[0]+ext[2])/2,90,(ext[1]+ext[3])/2),span=Math.max(ext[2]-ext[0],ext[3]-ext[1]);
const views={home:{p:[-span*1.05,span*1.15,span*1.45],t:target.toArray()},top:{p:[target.x,span*1.6,target.z+1],t:[target.x,60,target.z]},south:{p:[-440,650,850],t:[15,100,130]},tocho:{p:[-320,350,420],t:[0,175,0]}};
const addedBlock=scope.blocks.find(b=>b.id==='PLAZA+');if(addedBlock){const center=addedBlock.polygonENU.reduce((a,p)=>[a[0]+p[0]/addedBlock.polygonENU.length,a[1]+p[1]/addedBlock.polygonENU.length],[0,0]);views.added={p:[center[0]-260,340,center[1]+330],t:[center[0],100,center[1]]};}
for(const [viewId,blockId] of [['left','PLAZA-L'],['right','PLAZA-R']]){const b=scope.blocks.find(b=>b.id===blockId);if(b){const center=b.polygonENU.reduce((a,p)=>[a[0]+p[0]/b.polygonENU.length,a[1]+p[1]/b.polygonENU.length],[0,0]);views[viewId]={p:[center[0]+400,500,center[1]+500],t:[center[0],100,center[1]]};}}
function view(name){const v=views[name];camera.position.set(...v.p);controls.target.set(...v.t);if(name==='home'){const fit=Math.max(1,0.8/camera.aspect);camera.position.sub(controls.target).multiplyScalar(fit).add(controls.target);}controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));document.getElementById('style').onclick=()=>{uniforms.ownEnabled.value=1-uniforms.ownEnabled.value;document.getElementById('style').textContent=uniforms.ownEnabled.value?'無地表示に切替':'独自テクスチャを表示';};
view('home');report();
function update(){controls.update();world.updateMatrixWorld(true);for(const t of tiles)t.update();}
renderer.setAnimationLoop(()=>{update();if(comparison){const half=Math.floor(renderWidth/2);renderer.setScissorTest(true);renderer.setViewport(0,0,half,renderHeight);renderer.setScissor(0,0,half,renderHeight);renderer.render(scene,camera);originalWorld.updateMatrixWorld(true);renderer.setViewport(half,0,renderWidth-half,renderHeight);renderer.setScissor(half,0,renderWidth-half,renderHeight);renderer.render(originalScene,camera);renderer.setScissorTest(false);}else renderer.render(scene,camera);renderer.domElement.dataset.triangles=String(renderer.info.render.triangles);let foreign=0;scene.traverse(o=>{if(!o.isMesh||!o.visible)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m.userData.ownOnly||(m.map&&!String(m.map.image?.src??'').includes('/own-only/')))foreign++;}});renderer.domElement.dataset.sourcePhotoMaterials=String(foreign);});setInterval(update,250);
addEventListener('error',e=>fail(e.message));addEventListener('unhandledrejection',e=>fail(e.reason));
