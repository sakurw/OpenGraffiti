import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
for(const mode of ['msls'])for(const area of ['tocho','tokyo-tower'])test(`actual ${mode} SNAP GLB is independently visible for ${area}`,async({page})=>{
 const report=JSON.parse(await readFile(`public/assets/texture-poc/experimental/snap-${mode}/${area}.json`,'utf8'));
 const label='MSLSデータセット＋SNAP';
 expect(report.scope.kind).toBe('all-buildings');expect(report.coverage.length).toBe(area==='tocho'?1600:1258);
 expect(report.projectedBuildings).toBe(report.coverage.filter(b=>b.projectedArea>0).length);
 if(!report.projectedBuildings){await page.goto(`/texture-city?snap=msls&area=${area}`);await expect(page.getByRole('status')).toContainText('都市モデル読込完了');await expect(page.getByRole('checkbox',{name:`${label}の追加投影を表示（位置合わせ・独立性未確認）`})).toBeDisabled();return;}
 const target=[...report.buildings].sort((a,b)=>b.projectedArea-a.projectedArea)[0];expect(target).toBeTruthy();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/texture-city?snap=${mode}&selection=wall-coverage-refine2-all&capture=1`);
 await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 if(area!=='tocho'){await page.getByLabel('比較地域').selectOption(area);await expect(page.getByRole('status')).toContainText('都市モデル読込完了');}
 await expect(page.locator('.city-snap-experiment')).toContainText('撮影の独立性は未確認');
 await expect(page.getByRole('link',{name:'MSLSの実反映結果と出典'})).toHaveAttribute('href',`/assets/texture-poc/experimental/snap-${mode}/${area}.json`);
 const loaded=page.waitForResponse(r=>r.url().endsWith(report.model)&&r.ok());
 await page.getByLabel('SNAP追加投影の建物').selectOption(target.buildingId);await loaded;
 const canvas=page.locator('.city-compare-stage canvas');await expect(canvas).toHaveAttribute('data-snap-experimental','loaded');
 await page.getByRole('button',{name:'SNAP写真の方向から見る'}).click();
 const camera=await canvas.getAttribute('data-camera');
 const capture=async()=>{await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));const url=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());return sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});};
 const on=await capture();await canvas.screenshot({path:`test-results/${mode}-snap-${area}-on.png`});
 await page.getByRole('checkbox',{name:`${label}の追加投影を表示（位置合わせ・独立性未確認）`}).uncheck();
 await expect(canvas).toHaveAttribute('data-snap-experimental','disabled');const off=await capture();
 await canvas.screenshot({path:`test-results/${mode}-snap-${area}-off.png`});
 expect(await canvas.getAttribute('data-camera')).toBe(camera);expect(on.info).toEqual(off.info);
 const changed=[0,0,0],{width,height,channels}=on.info,col=Math.floor(width/3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(on.data[i+k]-off.data[i+k])>3))changed[Math.min(2,Math.floor(x/col))]++;}
 console.log({area,target:target.buildingId,projectedArea:target.projectedArea,changed,camera});
 expect(changed[0]).toBe(0);expect(changed[2]).toBe(0);expect(changed[1]).toBeGreaterThan(20);
 await page.getByRole('checkbox',{name:`${label}の追加投影を表示（位置合わせ・独立性未確認）`}).check();
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();await expect(canvas).toHaveAttribute('data-experimental','loaded');
 expect(await canvas.getAttribute('data-camera')).toBe(camera);expect(errors).toEqual([]);
 await canvas.screenshot({path:`test-results/${mode}-snap-${area}-comparison.png`});
});


test('MSLS source gallery exposes both areas and original images',async({page})=>{
 await page.goto('/msls-review.html');await expect(page.getByRole('status')).toContainText('363枚');
 const im=page.locator('#image');await expect(im).toBeVisible();await expect.poll(()=>im.evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBe(640);
 const first=await im.getAttribute('src');await page.getByRole('button',{name:'次の写真'}).click();await expect(im).not.toHaveAttribute('src',first!);
 await page.locator('#area').selectOption('tocho');await expect(page.getByRole('status')).toContainText('571枚');await expect(page.locator('#model')).toHaveAttribute('src',/area=tocho/);
 await expect(page.frameLocator('#model').getByRole('status')).toContainText('都市モデル読込完了');
 await expect(page.frameLocator('#model').locator('.city-compare-stage canvas')).toBeInViewport();
 await page.screenshot({path:'test-results/msls-source-gallery.png',fullPage:true});
});
