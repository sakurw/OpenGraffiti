import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
for(const area of ['tocho','tokyo-tower'])test(`full refinement adds previously missing ${area} geometry in the comparison view`,async({page})=>{
 const root='public/assets/texture-poc/experimental/selection/';
 const original=JSON.parse(await readFile(`${root}wall-coverage-all/${area}.json`,'utf8'));
 const report=JSON.parse(await readFile(`${root}wall-coverage-refine2-all/${area}.json`,'utf8'));
 expect(report.scope.kind).toBe('all-buildings');expect(report.scope.buildingIds).toBeNull();
 expect(report.totalBuildings).toBe(area==='tocho'?1600:1258);expect(report.refinement.depth).toBe(2);
 expect(report.buildings.map(b=>b.buildingId)).toEqual(original.buildings.map(b=>b.buildingId));
 const newBuildings=[];
 for(let i=0;i<report.buildings.length;i++){
  const b=report.buildings[i],old=original.buildings[i];
  expect(b.triangles).toBe(old.triangles+b.refinement.addedTriangles);
  expect(b.projectedArea).toBeCloseTo(old.projectedArea+b.refinement.addedArea,6);
  expect(b.refinement.maxDepth).toBeLessThanOrEqual(2);
  if(!old.triangles&&b.triangles)newBuildings.push(b);
 }
 expect(newBuildings.length).toBeGreaterThan(0);
 const target=newBuildings.sort((a,b)=>b.projectedArea-a.projectedArea)[0];
 const frames:any[]=[],cameras:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const selection='wall-coverage-refine2-all';
  await page.goto(`/texture-city?capture=1&selection=${selection}`);
  await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
  if(area!=='tocho'){await page.getByLabel('比較地域').selectOption(area);await expect(page.getByRole('status')).toContainText('都市モデル読込完了');}
  await expect(page.locator('.city-selection-diagnostic')).toContainText('全棟を対象');
  if(selection.includes('refine'))await expect(page.locator('.city-refinement-diagnostic')).toContainText('最大2段階');
  await page.getByLabel('比較建物').selectOption(target.buildingId);
  await page.getByRole('button',{name:'Mapillary撮影位置から見る'}).click();
  const canvas=page.locator('.city-compare-stage canvas');
  const capture=async()=>{
   cameras.push((await canvas.getAttribute('data-camera'))!);
   const url=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());frames.push(await sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true}));
  };
  await capture();
  await canvas.screenshot({path:`test-results/texture-refinement-all-${area}-disabled-panels.png`});
  const loaded=page.waitForResponse(r=>r.url().endsWith(`/${selection}/${area}-mapillary.glb`)&&r.ok());
  await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();await loaded;
  await expect(canvas).toHaveAttribute('data-experimental','loaded',{timeout:60000});
  await expect(page.getByRole('link',{name:'この表示の暫定結果・カメラ推定条件',includeHidden:true})).toHaveAttribute('href',`/assets/texture-poc/experimental/selection/${selection}/${area}.json`);
  await capture();
  await canvas.screenshot({path:`test-results/texture-refinement-all-${area}-${selection}-panels.png`});
 expect(cameras[0]).toBe(cameras[1]);expect(frames[0].info).toEqual(frames[1].info);
 const changed=[0,0,0],{width,height,channels}=frames[0].info,col=Math.floor(width/3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(frames[0].data[i+k]-frames[1].data[i+k])>3))changed[Math.min(2,Math.floor(x/col))]++;
 }
 expect(changed[0]).toBe(0);expect(changed[1]).toBe(0);expect(changed[2]).toBeGreaterThan(20);expect(errors).toEqual([]);
 console.log({area,newBuildings:newBuildings.length,target:target.buildingId,newArea:target.projectedArea,changed,camera:cameras[0]});
});
