import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
const id='bldg_04af6636-576b-435c-bcad-a9fc951ad59e';
test('wall-photo priority preserves coverage in a clearly labelled subset comparison',async({page})=>{
 const images:any[]=[],cameras:string[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const method of ['triangle-first','wall-coverage']){
  const report=JSON.parse(await readFile(`public/assets/texture-poc/experimental/selection/${method}/tocho.json`,'utf8'));
  expect(report.scope.kind).toBe('subset');expect(report.totalBuildings).toBe(3);expect(report.areaTotalBuildings).toBe(1600);
  await page.goto(`/texture-city?capture=1&selection=${method}`);await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
  await expect(page.locator('.city-selection-diagnostic')).toContainText('指定 3 棟だけ');
  await page.getByLabel('SNAP追加投影の建物').selectOption(id);
  const canvas=page.locator('.city-compare-stage canvas');await expect(canvas).toHaveAttribute('data-snap-experimental','loaded');
  await page.getByRole('button',{name:'SNAP写真の方向から見る'}).click();
  await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
  await expect(canvas).toHaveAttribute('data-experimental','loaded');cameras.push((await canvas.getAttribute('data-camera'))!);
  const url=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  images.push(await sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true}));
  await canvas.screenshot({path:`test-results/texture-selection-${method}-panels.png`});
  await page.screenshot({path:`test-results/texture-selection-${method}.png`,fullPage:true});
 }
 expect(cameras[0]).toBe(cameras[1]);expect(images[0].info).toEqual(images[1].info);
 const changed=[0,0,0],{width,height,channels}=images[0].info,col=Math.floor(width/3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(images[0].data[i+k]-images[1].data[i+k])>3))changed[Math.min(2,Math.floor(x/col))]++;
 }
 expect(changed[0]).toBe(0);expect(changed[1]).toBe(0);expect(changed[2]).toBeGreaterThan(500);
 expect(errors).toEqual([]);console.log({changed,camera:cameras[0]});
});
