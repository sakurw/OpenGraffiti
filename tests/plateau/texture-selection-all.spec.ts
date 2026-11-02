import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
for(const area of ['tocho','tokyo-tower'])test(`whole-city wall selection preserves comparison and coverage for ${area}`,async({page})=>{
 const original=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${area}.json`,'utf8'));
 const report=JSON.parse(await readFile(`public/assets/texture-poc/experimental/selection/wall-coverage-all/${area}.json`,'utf8'));
 expect(report.scope.kind).toBe('all-buildings');expect(report.scope.buildingIds).toBeNull();
 expect(report.totalBuildings).toBe(area==='tocho'?1600:1258);expect(report.areaTotalBuildings).toBe(report.totalBuildings);
 expect(report.buildings.map(b=>b.buildingId)).toEqual(original.buildings.map(b=>b.buildingId));
 for(let i=0;i<report.buildings.length;i++){
  const b=report.buildings[i],old=original.buildings[i];
  expect(b.triangles).toBe(old.triangles);expect(b.projectedArea).toBeCloseTo(old.projectedArea,7);
  expect(b.sourceIds.every(id=>report.sources.some(s=>s.id===id))).toBe(true);
  const d=b.selectionDiagnostic;expect(d.attempts).toBeGreaterThanOrEqual(0);
  expect(d.depthSupportedSamples).toBeLessThanOrEqual(d.depthSamples);
  const accepted=d.walls.reduce((s,w)=>s+w.rankedPhotos.reduce((n,p)=>n+p.acceptedSamples,0),0);
  expect(d.attempts).toBe(accepted+Object.values(d.rejections).reduce((s:number,n:number)=>s+n,0));
  for(const w of d.walls){expect(w.samples).toBeLessThanOrEqual(32);expect(w.usedPhotos.every(p=>b.sourceIds.includes(p.id))).toBe(true);}
 }
 const building=area==='tocho'?'bldg_04af6636-576b-435c-bcad-a9fc951ad59e':'bldg_433bc5b3-db73-4644-ac24-a28d51b7ecd5';
 const frames:any[]=[],cameras:string[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const variant of ['original','wall-coverage-all']){
  await page.goto(`/texture-city?capture=1${variant?'&selection='+variant:''}`);
  await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
  if(area!=='tocho'){await page.getByLabel('比較地域').selectOption(area);await expect(page.getByRole('status')).toContainText('都市モデル読込完了');}
  if(variant==='wall-coverage-all'){await expect(page.locator('.city-selection-diagnostic')).toContainText('全棟を対象');await expect(page.locator('.city-selection-diagnostic')).not.toContainText('指定 3 棟');}
  await page.getByLabel('SNAP追加投影の建物').selectOption(building);
  const canvas=page.locator('.city-compare-stage canvas');await expect(canvas).toHaveAttribute('data-snap-experimental','loaded');
  await page.getByRole('button',{name:'SNAP写真の方向から見る'}).click();
  const loaded=page.waitForResponse(r=>r.url().endsWith(variant==='wall-coverage-all'?`/selection/wall-coverage-all/${area}-mapillary.glb`:`/${area}-mapillary.glb`)&&r.status()===200);
  await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();await loaded;
  await expect(canvas).toHaveAttribute('data-experimental','loaded',{timeout:60000});
  cameras.push((await canvas.getAttribute('data-camera'))!);
  const url=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());frames.push(await sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true}));
  await canvas.screenshot({path:`test-results/texture-selection-all-${area}-${variant||'original'}-panels.png`});
 }
 expect(cameras[0]).toBe(cameras[1]);expect(frames[0].info).toEqual(frames[1].info);
 const changed=[0,0,0],{width,height,channels}=frames[0].info,col=Math.floor(width/3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(frames[0].data[i+k]-frames[1].data[i+k])>3))changed[Math.min(2,Math.floor(x/col))]++;
 }
 expect(changed[0]).toBe(0);expect(changed[1]).toBe(0);expect(changed[2]).toBeGreaterThan(500);expect(errors).toEqual([]);
 console.log({area,changed,camera:cameras[0]});
});
