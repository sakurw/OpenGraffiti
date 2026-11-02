/** Verify which v32 surfaces really reach the display at its problem corners. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from '@playwright/test';

const target = path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb');
const expected = '1703bb6f0e02a809137c2eab0bc65d5d4c2759082a45fefb7f0b0d4622aeb8c6';
const digest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
if (digest !== expected) throw new Error(`v32 provenance mismatch: ${digest}`);
const outdir = path.resolve('data/texture-city/tocho-style-pilot-20261015/v32-corner-ownership-20261018');
if (fs.existsSync(outdir)) throw Error(`Do not overwrite existing evidence: ${outdir}`);
const htmlPath = 'public/tocho-stylized-full-compare-v32-20261018.html';
const html = fs.readFileSync(htmlPath,'utf8');
if (!html.includes('state.ready=true;')) throw Error('Cannot inspect page state: instrumentation anchor moved');
const browser = await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1600,height:980},deviceScaleFactor:1});
  const errors=[],responses=[];
  page.on('pageerror',err=>errors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  page.on('response',response=>{if(response.url().includes('.glb'))responses.push({url:response.url(),status:response.status()});});
  await page.route('**/tocho-stylized-full-compare-v32-20261018.html*',route=>
    route.fulfill({status:200,contentType:'text/html;charset=utf-8',
      body:html.replace('state.ready=true;','window.__V32_INSPECT__={panes,THREE};state.ready=true;')}));
  const url='http://127.0.0.1:3110/tocho-stylized-full-compare-v32-20261018.html?model=v32';
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__TOCHO_STYLIZED_FULL__?.ready,{timeout:120000});
  const bound=await page.evaluate(()=>window.__TOCHO_STYLIZED_FULL__);
  const asset='/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb';
  if(bound.version!=='v32'||!bound.modelUrls.after.endsWith(asset)||
     bound.models.after.meshes!==51 ||!responses.some(r=>r.status===200&&r.url.endsWith(asset)))
    throw Error(`Could not certify loaded v32 artifact: ${JSON.stringify({bound,responses})}`);

  const cases={
    eastCorner:[[432,105],[438,105],[440,105],[442,105],[443,105],[444,105],[445,105],
      [448,105],[443,100],[443,110],[450,160],[435,180],[510,220]],
    westCorner:[[165,245],[177,285],[517,155],[539,195],[546,215],[532,235],
      [525,155],[535,160],[540,190],[546,215],[555,250]],
  };
  fs.mkdirSync(outdir,{recursive:true});
  const records={};
  for(const [view,samples] of Object.entries(cases)){
    await page.locator(`[data-view="${view}"]`).click();
    const r=await page.evaluate(({samples})=>{
      const {THREE:T,panes}=window.__V32_INSPECT__,p=panes[1];
      const meshes=[];p.scene.traverse(m=>{if(m.isMesh)meshes.push(m)});
      if(meshes.length!==51)throw Error(`Unexpected primitives ${meshes.length}`);
      p.camera.updateMatrixWorld(true);p.scene.updateMatrixWorld(true);
      const c=p.renderer.domElement,gl=p.renderer.getContext();
      const pix=([x,y])=>{let data=new Uint8Array(4);
        gl.readPixels(x,c.height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data];};
      p.renderer.render(p.scene,p.camera);
      const original=samples.map(pix), originalMats=meshes.map(m=>m.material);
      const oldTone=p.renderer.toneMapping,oldOutput=p.renderer.outputColorSpace;
      p.renderer.toneMapping=T.NoToneMapping;p.renderer.outputColorSpace=T.SRGBColorSpace;
      const modes={};
      for(const sideMode of ['native','double']){
        const ids=meshes.map((mesh,i)=>new T.MeshBasicMaterial({
          color:new T.Color().setRGB((i+1)/255,77/255,155/255,T.SRGBColorSpace),
          side:sideMode==='double'?T.DoubleSide:originalMats[i].side,
          depthTest:originalMats[i].depthTest,depthWrite:originalMats[i].depthWrite,
          polygonOffset:originalMats[i].polygonOffset,
          polygonOffsetFactor:originalMats[i].polygonOffsetFactor,
          polygonOffsetUnits:originalMats[i].polygonOffsetUnits,
          toneMapped:false}));
        meshes.forEach((m,i)=>m.material=ids[i]);
        p.renderer.render(p.scene,p.camera);
        modes[sideMode]={pixels:samples.map(pix),ownerMap:c.toDataURL('image/png')};
        ids.forEach(m=>m.dispose());
      }
      meshes.forEach((m,i)=>m.material=originalMats[i]);
      p.renderer.toneMapping=oldTone;p.renderer.outputColorSpace=oldOutput;
      p.renderer.render(p.scene,p.camera);
      const ray=new T.Raycaster();
      const samplesOut=samples.map((xy,i)=>{
        const [x,y]=xy;
        ray.setFromCamera(new T.Vector2((x+.5)/c.width*2-1,1-(y+.5)/c.height*2),p.camera);
        const hits=ray.intersectObjects(meshes,false).slice(0,8).map(hit=>{
          const n=hit.face?.normal?.clone()?.transformDirection(hit.object.matrixWorld);
          return {primitive:meshes.indexOf(hit.object),face:hit.faceIndex,
            side:hit.object.material.side,depthTest:hit.object.material.depthTest,
            depthWrite:hit.object.material.depthWrite,transparent:hit.object.material.transparent,
            dist:Number(hit.distance.toFixed(5)),uv:hit.uv?.toArray(),
            frontFacing:n?ray.ray.direction.dot(n)<0:null};
        });
        const encode=rgba=>Math.abs(rgba[1]-77)<=2&&Math.abs(rgba[2]-155)<=2?rgba[0]-1:null;
        return {xy,originalRGB:original[i],nativeOwner:encode(modes.native.pixels[i]),
          doubledOwner:encode(modes.double.pixels[i]),hits};
      });
      return {canvas:[c.width,c.height],samples:samplesOut,materials:meshes.map((m,i)=>({
        id:i,side:m.material.side,depthWrite:m.material.depthWrite,depthTest:m.material.depthTest,
        transparent:m.material.transparent,alphaTest:m.material.alphaTest})),
        ownerImages:{native:modes.native.ownerMap,double:modes.double.ownerMap}};
    },{samples});
    for(const [mode,data] of Object.entries(r.ownerImages)){
      fs.writeFileSync(path.join(outdir,`${view}-${mode}-owners.png`),Buffer.from(data.split(',')[1],'base64'));
    }
    delete r.ownerImages;
    records[view]=r;
  }
  const report={at:new Date().toISOString(),model:target,sha256:digest,url,loaded:bound.version,
    modelResponses:responses,errors,records};
  fs.writeFileSync(path.join(outdir,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:path.join(outdir,'report.json'),hash:digest,
    errors,materials:records.eastCorner.materials.map(m=>[m.id,m.side,m.transparent]),
    samples:Object.fromEntries(Object.entries(records).map(([k,r])=>[k,r.samples.map(s=>({
      xy:s.xy,native:s.nativeOwner,double:s.doubledOwner,nearest:s.hits.slice(0,3).map(h=>
        ({id:h.primitive,face:h.face,front:h.frontFacing,distance:h.dist}))}))]))},null,2));
}finally{await browser.close()}
