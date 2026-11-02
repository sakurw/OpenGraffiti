/** Read final GPU triangle/depth around the v32 east-corner seam.
 * Unlike isolated mesh tests, every other mesh still participates in depth testing.
 * The protected v32 artifact and prior diagnostic evidence are never rewritten.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from '@playwright/test';

const artifact=path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb');
const expectedSHA='1703bb6f0e02a809137c2eab0bc65d5d4c2759082a45fefb7f0b0d4622aeb8c6';
const actualSHA=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
if(actualSHA!==expectedSHA)throw Error(`Model was changed: ${actualSHA}`);
const out=path.resolve('data/texture-city/tocho-style-pilot-20261015/v32-east-final-gpu-face-depth-20261018.json');
if(fs.existsSync(out))throw Error(`Refusing overwrite: ${out}`);
const html=fs.readFileSync('public/tocho-stylized-full-compare-v32-20261018.html','utf8');
if(!html.includes('state.ready=true;'))throw Error('Page instrumentation anchor missing');
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1600,height:980},deviceScaleFactor:1});
  const errors=[],responses=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.url().endsWith('.glb'))responses.push({url:r.url(),status:r.status()});});
  const url='http://127.0.0.1:3110/tocho-stylized-full-compare-v32-20261018.html?model=v32';
  await page.route('**/tocho-stylized-full-compare-v32-20261018.html*',route=>route.fulfill({status:200,contentType:'text/html;charset=utf-8',body:html.replace('state.ready=true;','window.__V32_GPU_TRI__={panes,THREE};state.ready=true;')}));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__TOCHO_STYLIZED_FULL__?.ready,{timeout:120000});
  const state=await page.evaluate(()=>window.__TOCHO_STYLIZED_FULL__);
  if(state.version!=='v32'||state.models.after.meshes!==51||!state.modelUrls.after.endsWith('tocho-stylized-full-pixel-v32-20261018.glb')||!responses.some(r=>r.status===200&&r.url.endsWith('tocho-stylized-full-pixel-v32-20261018.glb')))
    throw Error('Loaded model not certified v32');
  await page.locator('[data-view="eastCorner"]').click();
  const data=await page.evaluate(()=>{
    const {panes,THREE:T}=window.__V32_GPU_TRI__,p=panes[1],c=p.renderer.domElement,gl=p.renderer.getContext();
    const meshes=[];p.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
    if(meshes.length!==51)throw Error(`Unexpected ${meshes.length} meshes`);
    const original=meshes.map(m=>({geometry:m.geometry,material:m.material,visible:m.visible}));
    const origTone=p.renderer.toneMapping,origSpace=p.renderer.outputColorSpace;
    p.renderer.toneMapping=T.NoToneMapping;p.renderer.outputColorSpace=T.LinearSRGBColorSpace;
    p.camera.updateMatrixWorld(true);p.scene.updateMatrixWorld(true);
    const vs=`precision highp float;
      uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;
      in vec3 position;flat out int f;
      void main(){f=gl_VertexID/3;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
    const fs=`precision highp float;precision highp int;
      flat in int f;uniform int pId;uniform int mode;out vec4 outColor;
      void main(){uint u=mode==0?uint(pId*100000+f+1):uint(floor(gl_FragCoord.z*16777215.0+0.5));
      outColor=vec4(float(u&255u),float((u>>8u)&255u),float((u>>16u)&255u),255.)/255.;}`;
    const inspect=[17,27],debug=[];
    meshes.forEach((m,id)=>{
      if(inspect.includes(id)){
        if(m.geometry.index===null)throw Error('Expected indexed geometry '+id);
        m.geometry=m.geometry.toNonIndexed();
        m.material=new T.RawShaderMaterial({vertexShader:vs,fragmentShader:fs,glslVersion:T.GLSL3,side:T.DoubleSide,depthTest:true,depthWrite:true,uniforms:{pId:{value:id},mode:{value:0}}});
        debug.push(m.material);
      }else m.material=new T.MeshBasicMaterial({color:0x000000,side:T.DoubleSide,depthTest:true,depthWrite:true,toneMapped:false});
    });
    const samples=[];
    for(let y=102;y<=108;y++)for(let x=438;x<=448;x++)samples.push([x,y]);
    const rgba=(x,y)=>{const p=new Uint8Array(4);gl.readPixels(x,c.height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
    const passes=[];
    for(let mode=0;mode<=1;mode++){
      debug.forEach(m=>m.uniforms.mode.value=mode);
      p.renderer.render(p.scene,p.camera);
      passes.push(samples.map(([x,y])=>{
        const b=rgba(x,y);return b[0]+(b[1]<<8)+(b[2]<<16);
      }));
    }
    meshes.forEach((m,i)=>{m.geometry=original[i].geometry;m.material.dispose();m.material=original[i].material;m.visible=original[i].visible;});
    p.renderer.toneMapping=origTone;p.renderer.outputColorSpace=origSpace;p.renderer.render(p.scene,p.camera);
    const ray=new T.Raycaster();
    const screenTriangle=(id,faceIndex)=>{
      if(faceIndex===null||faceIndex<0)return null;
      const m=meshes[id],index=m.geometry.index,pos=m.geometry.getAttribute('position');
      if(index&&faceIndex*3+2>=index.count)return null;
      const tri=[];for(let n=0;n<3;n++){
        const vi=index?index.getX(faceIndex*3+n):faceIndex*3+n;
        const v=new T.Vector3().fromBufferAttribute(pos,vi).applyMatrix4(m.matrixWorld).project(p.camera);
        tri.push([(v.x+1)*c.width/2,(1-v.y)*c.height/2,v.z]);
      }return tri;
    };
    const rows=samples.map((xy,i)=>{
      const [x,y]=xy,encoded=passes[0][i],owner=encoded?Math.floor(encoded/100000):null;
      const face=encoded?encoded%100000-1:null;
      ray.setFromCamera(new T.Vector2((x+.5)*2/c.width-1,1-(y+.5)*2/c.height),p.camera);
      const hits=ray.intersectObjects(meshes,false).slice(0,5).map(h=>({id:meshes.indexOf(h.object),face:h.faceIndex,d:Number(h.distance.toFixed(5)),uv:h.uv?.toArray()}));
      return {xy,gpuOwner:owner,gpuFace:face,gpuDepth24:passes[1][i],gpuDepth:passes[1][i]/16777215,
        nearest:hits[0]||null,hits:hits.filter(h=>h.id===17||h.id===27),
        gpuTriangle:owner!==null?screenTriangle(owner,face):null};
    });
    return {canvas:[c.width,c.height],webgl2:gl instanceof WebGL2RenderingContext,depthBits:gl.getParameter(gl.DEPTH_BITS),rows,
      cpuFace17_17091:screenTriangle(17,17091),cpuFace27_49060:screenTriangle(27,49060)};
  });
  const report={at:new Date().toISOString(),model:artifact,sha256:actualSHA,url,version:state.version,responses,errors,...data};
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,sha256:actualSHA,errors,webgl2:data.webgl2,depthBits:data.depthBits,
    main:data.rows.filter(r=>r.xy[1]===105).map(r=>({xy:r.xy,owner:r.gpuOwner,face:r.gpuFace,depth:r.gpuDepth,nearest:r.nearest?.id,nearestFace:r.nearest?.face,nearDist:r.nearest?.d,gpuTri:r.xy[0]===443?r.gpuTriangle:undefined})),
    face17:data.cpuFace17_17091,face27:data.cpuFace27_49060},null,2));
}finally{await browser.close();}
