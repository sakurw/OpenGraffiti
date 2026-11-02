import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { chromium } from '@playwright/test';

const root=process.cwd();
const variant='v32';
const url=`http://127.0.0.1:3110/tocho-stylized-full-compare-v32-20261018.html?model=${variant}`;
const outDir=path.join(root,`public/assets/tocho-landmark/stylized-full-${variant}-20261018/browser-audit`);
const outReport=path.join(root,`data/texture-city/tocho-style-pilot-20261015/full-${variant}-browser-audit.json`);
const consoleErrors=[],httpFailures=[],failedRequests=[],pageErrors=[],glbResponses=[];
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:980},deviceScaleFactor:1});
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('response',r=>{if(r.status()>=400)httpFailures.push({status:r.status(),url:r.url()});if(r.url().includes('.glb'))glbResponses.push({url:r.url(),status:r.status()})});
  page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
  if(!response?.ok())throw new Error('Review page HTTP status '+response?.status());
  await page.waitForFunction(()=>window.__TOCHO_STYLIZED_FULL__?.ready||window.__TOCHO_STYLIZED_FULL__?.errors?.length>0,{timeout:120000});
  const loaded=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__TOCHO_STYLIZED_FULL__)));
  if(!loaded.ready||loaded.errors.length)throw new Error(`GLB/browser not ready: ${JSON.stringify(loaded)}`);
  if(loaded.version!=='v32'||!loaded.modelUrls.after.endsWith('/tocho-stylized-full-pixel-v32-20261018.glb')||!glbResponses.some(r=>r.status===200&&r.url.endsWith('/tocho-stylized-full-pixel-v32-20261018.glb')))throw new Error('v32 GLB delivery/selection not proven: '+JSON.stringify({version:loaded.version,modelUrls:loaded.modelUrls,glbResponses}));
  fs.mkdirSync(outDir,{recursive:true});
  const checks=[];
  for(const view of ['overall','northDetail','roof','southwest','upper','northeast','eastCorner','westCorner']){
    await page.locator(`[data-view="${view}"]`).click();
    await page.waitForTimeout(300);
    const beforePath=path.join(outDir,`before-${view}.png`);
    const afterPath=path.join(outDir,`after-${view}.png`);
    await page.locator('#before canvas').screenshot({path:beforePath});
    await page.locator('#after canvas').screenshot({path:afterPath});
    if(view==='overall')await page.screenshot({path:path.join(outDir,'full-review.png'),fullPage:true});
    const left=await sharp(beforePath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const right=await sharp(afterPath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(left.data.length!==right.data.length)throw new Error('Mismatched canvas image sizes');
    const {width,height,channels}=left.info;
    let changed=0;
    for(let i=0;i<left.data.length;i+=channels){
      const delta=Math.abs(left.data[i]-right.data[i])+Math.abs(left.data[i+1]-right.data[i+1])+Math.abs(left.data[i+2]-right.data[i+2]);
      if(delta>24)changed++;
    }
    checks.push({view,width,height,changedPixels:changed,changePercent:+(changed/(width*height)*100).toFixed(2),beforePath,afterPath});
  }
  // Test actual mouse interaction and synchronization (not just button-triggered viewpoints).
  const canvas=page.locator('#before canvas'),box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.56,box.y+box.height*.48);
  await page.mouse.down();await page.mouse.move(box.x+box.width*.67,box.y+box.height*.52,{steps:8});await page.mouse.up();
  const state=await page.evaluate(()=>({version:window.__TOCHO_STYLIZED_FULL__.version,
    view:window.__TOCHO_STYLIZED_FULL__.view,renderCount:window.__TOCHO_STYLIZED_FULL__.renderCount}));
  const report={date:new Date().toISOString(),url,variant,httpStatus:response.status(),ready:loaded.ready,
    models:loaded.models,glbResponses,checks,dragState:state,consoleErrors,httpFailures,failedRequests,pageErrors,
    result:'unverified'};
  report.result=checks.every(c=>c.changePercent>1) && ![consoleErrors,httpFailures,failedRequests,pageErrors].some(x=>x.length)
    ?'eight-view-webgl-pass-human-aesthetic-review-pending':'fail-see-details';
  fs.mkdirSync(path.dirname(outReport),{recursive:true});
  fs.writeFileSync(outReport,JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,url,models:report.models,checks:checks.map(({beforePath,afterPath,...r})=>r),errors:[...consoleErrors,...pageErrors],httpFailures,failedRequests,report:outReport}));
  if(report.result.startsWith('fail'))process.exitCode=2;
}catch(e){
  fs.mkdirSync(path.dirname(outReport),{recursive:true});
  fs.writeFileSync(outReport,JSON.stringify({date:new Date().toISOString(),url,variant,result:'execution-failed',error:String(e),consoleErrors,httpFailures,failedRequests,pageErrors},null,2));
  console.error(String(e));process.exitCode=1;
}finally{await browser?.close()}


