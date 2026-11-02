import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import sharp from 'sharp';
const id='bldg_433bc5b3-db73-4644-ac24-a28d51b7ecd5';
test('Mori JP SNAP uses its independent photo on real upper wall geometry',async()=>{
 const report=JSON.parse(await readFile('public/assets/texture-poc/experimental/tokyo-tower-snap.json','utf8'));
 const building=report.buildings.find(b=>b.buildingId===id);
 expect(building.sourceIds).toEqual(['153194777']);expect(building.minimumHeight).toBe(200);
 expect(report.cases[0].camera.rmsPixels).toBeNull();expect(report.cases[0].camera.controls).toBe(0);
 const g=JSON.parse(await readFile('data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json','utf8'));
 const original=g.buildings.find(b=>b.id===id),walls=new Set(original.walls.map(w=>w.id));
 const doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit]).read('public'+report.model);let triangles=0;
 for(const n of doc.getRoot().listNodes())if(n.getMesh()){
  expect(n.getExtras().buildingId).toBe(id);expect(walls.has(n.getName())).toBe(true);
  for(const p of n.getMesh()!.listPrimitives()){
   const pos=p.getAttribute('POSITION')!.getArray()!;triangles+=pos.length/9;
   for(let i=1;i<pos.length;i+=3)expect(pos[i]).toBeGreaterThanOrEqual(199.99);
   expect(p.getAttribute('TEXCOORD_0')!.getCount()).toBe(pos.length/3);
   const image=await sharp(p.getMaterial()!.getBaseColorTexture()!.getImage()!).metadata();expect(image.width).toBeGreaterThan(0);
  }
 }
 expect(triangles).toBe(20115);expect(report.polygons).toHaveLength(17);
 expect(building.projectedArea).toBeCloseTo(11780.673097,3);
 const c=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 expect(c.buildings.find(b=>b.id===id).snap.appliedArea).toBe(0);
});
test('Tokyo SNAP and Mapillary can be shown together without altering the original panel',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/texture-city?capture=1');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByLabel('比較地域').selectOption('tokyo-tower');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByRole('button',{name:'追加SNAPの建物を見る'}).click();
 const canvas=page.locator('.city-compare-stage canvas');await expect(canvas).toHaveAttribute('data-snap-experimental','loaded');
 await page.getByRole('button',{name:'SNAP写真の方向から見る'}).click();
 const camera=await canvas.getAttribute('data-camera');
 const capture=async()=>{const url=await canvas.evaluate((e:HTMLCanvasElement)=>e.toDataURL());return sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});};
 const enabled=await capture();
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).uncheck();
 await expect(canvas).toHaveAttribute('data-snap-experimental','disabled');const disabled=await capture();
 const changed=[0,0,0],{width,height,channels}=enabled.info;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(enabled.data[i+k]-disabled.data[i+k])>3))changed[Math.min(2,Math.floor(x/Math.floor(width/3)))]++;
 }
 expect(changed[0]).toBe(0);expect(changed[2]).toBe(0);expect(changed[1]).toBeGreaterThan(500);
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).check();
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
 await expect(canvas).toHaveAttribute('data-experimental','loaded');expect(await canvas.getAttribute('data-camera')).toBe(camera);
 await page.screenshot({path:'test-results/texture-mori-snap-comparison.png',fullPage:true});
 expect(errors).toEqual([]);console.log({changed,camera});
});
