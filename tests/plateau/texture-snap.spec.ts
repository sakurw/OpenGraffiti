import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import sharp from 'sharp';

test('independent SNAP photo is attached to existing Park Tower wall geometry',async()=>{
 const report=JSON.parse(await readFile('public/assets/texture-poc/experimental/snap/cases/park-tower-west.json','utf8'));
 const aggregate=JSON.parse(await readFile('public/assets/texture-poc/experimental/tocho-snap.json','utf8'));
 expect(aggregate.buildings.find(b=>b.caseId==='park-tower-west').projectedArea).toBe(report.buildings[0].projectedArea);
 expect(report.registration).toBe('estimated-unverified');
 expect(report.sources[0].id).toBe('139946227');expect(report.sources[0].url).toContain('commons.wikimedia.org');
 expect(report.snapCommit).toBe('d194f8891eddb965af1894e5cc6b67541ca7f307');
 const g=JSON.parse(await readFile('data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json','utf8'));
 const building=g.buildings.find(b=>b.id===report.buildings[0].buildingId),ids=new Set(building.walls.map(w=>w.id));
 const doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit]).read('public'+report.model);
 let count=0;
 for(const mesh of doc.getRoot().listMeshes()){
  expect(ids.has(mesh.getName())).toBe(true);
  for(const p of mesh.listPrimitives()){
   const position=p.getAttribute('POSITION')!.getArray()!;count+=position.length/9;
   for(let i=1;i<position.length;i+=3)expect(position[i]).toBeGreaterThanOrEqual(129.99);
   expect(p.getAttribute('TEXCOORD_0')!.getCount()).toBe(p.getAttribute('POSITION')!.getCount());
   expect(p.getMaterial()!.getName()).toBe('snap-experimental');
   const image=await sharp(p.getMaterial()!.getBaseColorTexture()!.getImage()!).metadata();expect(image.width).toBeGreaterThan(0);
  }
 }
 expect(count).toBe(report.polygons.reduce((s,p)=>s+p.triangles,0));
 expect(report.buildings[0].projectedArea).toBeGreaterThan(10000);
 const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 expect(catalog.buildings.find(b=>b.id===building.id).snap.appliedArea).toBe(0);
});

test('SNAP toggle changes only the independent photo panel and preserves camera',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/texture-city?capture=1');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByRole('button',{name:'追加SNAPの建物を見る'}).click();
 const canvas=page.locator('.city-compare-stage canvas');
 await expect(canvas).toHaveAttribute('data-snap-experimental','loaded',{timeout:60000});
 await expect(canvas).toHaveAttribute('data-depth-mode','logarithmic');
 await page.getByRole('button',{name:'SNAP写真の方向から見る'}).click();
 const camera=await canvas.getAttribute('data-camera');
 const capture=async()=>{const url=await canvas.evaluate((el:HTMLCanvasElement)=>el.toDataURL('image/png'));return sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});};
 const enabled=await capture();await page.screenshot({path:'test-results/texture-independent-snap.png',fullPage:true});
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).uncheck();
 await expect(canvas).toHaveAttribute('data-snap-experimental','disabled');expect(await canvas.getAttribute('data-camera')).toBe(camera);
 const disabled=await capture(),counts=[0,0,0],{width,height,channels}=enabled.info;
 expect(disabled.info).toEqual(enabled.info);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(k=>Math.abs(enabled.data[i+k]-disabled.data[i+k])>3))counts[Math.min(2,Math.floor(x/Math.floor(width/3)))]++;
 }
 expect(counts[0]).toBe(0);expect(counts[2]).toBe(0);expect(counts[1]).toBeGreaterThan(500);
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).check();
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
 await expect(canvas).toHaveAttribute('data-experimental','loaded',{timeout:60000});
 await expect(canvas).toHaveAttribute('data-snap-experimental','loaded');
 expect(await canvas.getAttribute('data-camera')).toBe(camera);
 await page.screenshot({path:'test-results/texture-independent-snap-comparison.png',fullPage:true});
 expect(errors).toEqual([]);console.log({snapPanelChanged:counts[1],otherPanelsChanged:counts[0]+counts[2]});
});
