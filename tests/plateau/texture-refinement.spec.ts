import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
test('newly projected refinement fragment is visible without changing other panels',async({page})=>{
 const root='public/assets/texture-poc/experimental/selection/';
 const baseline=JSON.parse(await readFile(root+'wall-coverage-all/tokyo-tower.json','utf8'));
 const report=JSON.parse(await readFile(root+'wall-coverage-refine2/tokyo-tower.json','utf8'));
 const old=new Map(baseline.buildings.map(b=>[b.buildingId,b.triangles]));
 const candidates=report.buildings.filter(b=>!old.get(b.buildingId)&&b.triangles).sort((a,b)=>b.projectedArea-a.projectedArea);
 expect(candidates.length).toBe(10);
 await page.goto('/texture-city?capture=1&selection=wall-coverage-refine2');
 await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByLabel('比較地域').selectOption('tokyo-tower');
 await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await expect(page.locator('.city-selection-diagnostic')).toContainText('指定 51 棟');
 await expect(page.locator('.city-refinement-diagnostic')).toContainText('最大2段階');
 await page.getByLabel('比較建物').selectOption(candidates[0].buildingId);
 const canvas=page.locator('.city-compare-stage canvas');
 const capture=async()=>sharp(Buffer.from((await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const before=await capture(),camera=await canvas.getAttribute('data-camera');
 const loaded=page.waitForResponse(r=>r.url().endsWith('/wall-coverage-refine2/tokyo-tower-mapillary.glb')&&r.ok());
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();await loaded;
 await expect(canvas).toHaveAttribute('data-experimental','loaded');
 await expect(page.locator('.city-projection-diagnostic')).toContainText('一部に暫定投影あり');
 const after=await capture();expect(before.info).toEqual(after.info);expect(await canvas.getAttribute('data-camera')).toBe(camera);
 const changed=[0,0,0],{width,height,channels}=before.info,col=Math.floor(width/3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(before.data[i+k]-after.data[i+k])>3))changed[Math.min(2,Math.floor(x/col))]++;
 }
 expect(changed[0]).toBe(0);expect(changed[1]).toBe(0);expect(changed[2]).toBeGreaterThan(20);
 await canvas.screenshot({path:'test-results/texture-refinement-new-building-panels.png'});
 console.log({building:candidates[0].buildingId,area:candidates[0].projectedArea,changed,camera});
});
