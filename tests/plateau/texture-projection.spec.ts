import {test,expect} from '@playwright/test';
import {textureReportUrl} from '../../shared/texture-selection.mjs';
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
import sharp from 'sharp';
test('terrain-supported photos are visible on a restored LOD1 building',async({page})=>{
 const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 const report=JSON.parse(await readFile('public/assets/texture-poc/experimental/tocho.json','utf8'));
 const terrainIds=new Set(report.sources.filter(s=>s.height.method.startsWith('GSI-')).map(s=>s.id));
 const lod1Ids=new Set(catalog.buildings.filter(b=>b.areaId==='tocho'&&b.lod===1).map(b=>b.id));
 const candidate=report.buildings.filter(b=>lod1Ids.has(b.buildingId)&&b.sourceIds.some(id=>terrainIds.has(id))).sort((a,b)=>b.projectedArea-a.projectedArea)[0];expect(candidate).toBeTruthy();
 await page.goto('/texture-city?capture=1');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByLabel('比較建物').selectOption(candidate.buildingId);
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
 const canvas=page.locator('.city-compare-stage canvas');await expect(canvas).toHaveAttribute('data-experimental','loaded',{timeout:60000});
 await expect(page.locator('.city-building')).toContainText('LOD1');await expect(page.locator('.city-projection-diagnostic')).toContainText('一部に暫定投影あり');
 await page.screenshot({path:'test-results/texture-terrain-lod1.png',fullPage:true});
 console.log({terrainLod1:candidate.buildingId,projectedArea:candidate.projectedArea});
});
test('experimental GLBs contain real textured triangles and every building is accounted for',async()=>{
 const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 for(const area of ['tokyo-tower','tocho']){
  const report=JSON.parse(await readFile('public'+textureReportUrl(area),'utf8'));
  expect(report.registration).toBe('estimated-unverified');
  expect(report.maskPolicy).toBe('Cityscapes AND ADE20K building-family agreement');
  expect(report.skippedPhotos).toEqual([]);
  expect(report.candidatePolicy).toContain('No top-six truncation');
  expect(report.orientationPolicy).toContain('display-oriented thumbnail UV');
  expect(Object.values(report.eligibleOrientations).reduce((s:number,n:number)=>s+n,0)).toBe(report.eligiblePhotos);
  for(const s of report.sources){expect([1,3,6,8]).toContain(s.exifOrientation);expect(s.originalSize.every((v:number)=>Number.isFinite(v)&&v>0)).toBe(true);}
  expect(report.buildings.some(b=>b.diagnostic.acceptedBeyondSix>0)).toBe(true);
  for(const b of report.buildings){expect(b.diagnostic.acceptedBeyondSix).toBeLessThanOrEqual(b.triangles);if(b.diagnostic.acceptedBeyondSix)expect(b.diagnostic.maxAcceptedRank).toBeGreaterThan(6);}
  const terrainSources=report.sources.filter(s=>s.height.method.startsWith('GSI-'));
  expect(terrainSources.length).toBeGreaterThan(0);expect(report.terrain.usedPhotos).toBe(terrainSources.length);
  for(const s of terrainSources){expect(s.height.source).toMatch(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem5a_png\/15\/\d+\/\d+\.png$/);expect(s.height.height-s.height.groundHeight).toBeCloseTo(1.65,8);expect(s.cameraPosition[1]).toBeCloseTo(s.height.height,8);}
  expect(report.buildings.length).toBe(catalog.buildings.filter(b=>b.areaId===area).length);
  expect(report.projectedBuildings).toBeGreaterThan(1);
  for(const b of report.buildings){expect(b.projectedArea).toBeGreaterThanOrEqual(0);expect(b.projectedArea).toBeLessThanOrEqual(catalog.buildings.find(x=>x.id===b.buildingId).wallArea+.01);expect(b.diagnostic.attempts).toBe(b.triangles+Object.values(b.diagnostic.rejections).reduce((s:number,n:number)=>s+n,0));expect(b.outcome==='partially-projected').toBe(b.triangles>0);}
  const doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]).read('public'+report.model);
  let count=0;for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
   count+=p.getAttribute('POSITION')!.getCount()/3;
   expect(p.getAttribute('TEXCOORD_0')!.getCount()).toBe(p.getAttribute('POSITION')!.getCount());
   const texture=p.getMaterial()!.getBaseColorTexture()!;
   const decoded=await sharp(texture.getImage()!).metadata();
   const source=report.sources.find(s=>s.id===texture.getName());
   expect(source).toBeTruthy();expect(decoded.width).toBe(source.imageCrop.width);expect(decoded.height).toBe(source.imageCrop.height);expect(decoded.channels).toBeGreaterThanOrEqual(3);
   expect(p.getMaterial()!.getAlphaMode()).toBe('MASK');
  }
  expect(count).toBe(report.projectedTriangles);
  expect(doc.getRoot().listTextures()).toHaveLength(report.usedPhotos);
  if(area==='tocho'){
   expect(report.buildings.some(b=>b.outcome==='no-wall-geometry')).toBe(false);
   const lod1Ids=new Set(catalog.buildings.filter(b=>b.areaId===area&&b.lod===1).map(b=>b.id));
   expect(report.buildings.filter(b=>lod1Ids.has(b.buildingId)&&b.triangles>0).length).toBeGreaterThan(0);
   const ceilingPhoto=report.sources.find(s=>s.id==='1283779498724440');
   if(ceilingPhoto){
    const texture=doc.getRoot().listTextures().find(t=>t.getName()===ceilingPhoto.id)!;
    const {data,info}=await sharp(texture.getImage()!).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const crop=ceilingPhoto.imageCrop;
    for(const [x,y] of [[100,100],[1800,100]]){
     if(x<crop.left||y<crop.top||x>=crop.left+crop.width||y>=crop.top+crop.height)continue;
     expect(data[((y-crop.top)*info.width+x-crop.left)*4+3]).toBe(0);
    }
   }
  }
  for(const s of report.sources){expect(s.author).toBeTruthy();expect(s.license).toBe('CC-BY-SA-4.0');expect(s.sourceSha256).toMatch(/^[a-f0-9]{64}$/);}
 }
});
test('actual provisional textures load only when explicitly enabled',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/texture-city?capture=1');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 const canvas=page.locator('.city-compare-stage canvas');
 const capture=async()=>{
  // Read the framebuffer, not a CSS screenshot: paragraph wrapping moves the
  // stage onto fractional pixels and compositor resampling blurs screenshots.
  const url=await canvas.evaluate((el:HTMLCanvasElement)=>el.toDataURL('image/png'));
  return sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
 };
 await expect(canvas).not.toHaveAttribute('data-experimental','loaded');
 for(const area of ['tocho','tokyo-tower']){
  await page.getByLabel('比較地域').selectOption(area);
  await expect(page.getByRole('button',{name:'暫定投影面積が最大の建物を見る'})).toBeVisible();
  await page.getByRole('button',{name:'暫定投影面積が最大の建物を見る'}).click();
  await expect(canvas).toHaveAttribute('data-experimental','loaded',{timeout:60000});
  await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
  await page.screenshot({path:`test-results/texture-projection-${area}.png`,fullPage:true});
  const enabled=await capture();
  const beforeCamera=await canvas.getAttribute('data-camera');
  const beforeCanvas=await canvas.elementHandle();
  await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).uncheck();
  await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
  const disabled=await capture();
  expect(await canvas.evaluate((el,original)=>el===original,beforeCanvas)).toBe(true);
  expect(await canvas.getAttribute('data-camera')).toBe(beforeCamera);await beforeCanvas?.dispose();
  console.log({beforeCamera,afterCamera:await canvas.getAttribute('data-camera'),size:enabled.info});
  await sharp(enabled.data,{raw:enabled.info}).png().toFile(`test-results/${area}-enabled-canvas.png`);
  await sharp(disabled.data,{raw:disabled.info}).png().toFile(`test-results/${area}-disabled-canvas.png`);
  expect(enabled.info).toEqual(disabled.info);
  const {width,height,channels}=enabled.info,col=Math.floor(width/3);let changed=0,originalChanged=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const offset=(y*width+x)*channels;
   if(Math.abs(enabled.data[offset]-disabled.data[offset])+Math.abs(enabled.data[offset+1]-disabled.data[offset+1])+Math.abs(enabled.data[offset+2]-disabled.data[offset+2])>20){if(x<col)originalChanged++;if(x>=2*col)changed++;}
  }
  // The same canvas/context/camera is retained; the original panel must not change.
  console.log({area,originalChanged,projectedPanelChanged:changed});
  expect(originalChanged).toBe(0);expect(changed).toBeGreaterThan(100);
 }
 expect(errors).toEqual([]);
});
