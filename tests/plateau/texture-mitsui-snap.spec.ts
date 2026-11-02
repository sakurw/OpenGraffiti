import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {Matrix4,Vector3} from 'three';
import sharp from 'sharp';
import {imageRegionFilter} from '../../scripts/texture-snap-image-regions.mjs';
import {triangulate} from '../../scripts/plateau-geometry.mjs';
const id='bldg_04af6636-576b-435c-bcad-a9fc951ad59e';

test('Mitsui SNAP actual GLB preserves both buildings and excludes unreviewed image regions',async()=>{
 const report=JSON.parse(await readFile('public/assets/texture-poc/experimental/tocho-snap.json','utf8'));
 expect(report.projectedBuildings).toBe(2);
 const current=JSON.parse(await readFile('public/assets/texture-poc/experimental/snap/cases/shinjuku-mitsui-no2-southeast.json','utf8'));
 const fit=JSON.parse(await readFile('data/texture-city/registration/shinjuku-mitsui-no2-southeast.json','utf8'));
 const g=JSON.parse(await readFile('data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json','utf8'));
 const original=g.buildings.find(b=>b.id===id),walls=new Map(original.walls.map(w=>[w.id,triangulate(w.rings.map(r=>r.points)).normal]));
 const bytes=await readFile('data/texture-city/photos/commons/126574094.jpg');
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(current.sources[0].sourceSha256);
 const source=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const allowed=imageRegionFilter(current.imageRegions,[source.info.width,source.info.height]);
 const rv=new Vector3(...fit.rotationVector),rotation=new Matrix4().makeRotationAxis(rv.clone().normalize(),rv.length()),k=fit.cameraMatrix;
 const project=(v:number[])=>{const p=new Vector3(...v).applyMatrix4(rotation).add(new Vector3(...fit.translationVector));return [k[0][0]*p.x/p.z+k[0][2],k[1][1]*p.y/p.z+k[1][2]];};
 const doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit]).read('public'+report.model);
 expect(doc.getRoot().listBuffers()).toHaveLength(1);
 const seen=new Set<string>();let count=0;const colorErrors:number[]=[];
 for(const n of doc.getRoot().listNodes())if(n.getMesh()){
  const buildingId=String(n.getExtras().buildingId);seen.add(buildingId);
  if(buildingId!==id)continue;
  expect(walls.has(n.getName())).toBe(true);const normal=walls.get(n.getName()) as number[];
  for(const p of n.getMesh()!.listPrimitives()){
   const pos=p.getAttribute('POSITION')!.getArray()!,uv=p.getAttribute('TEXCOORD_0')!.getArray()!;
   const texture=await sharp(p.getMaterial()!.getBaseColorTexture()!.getImage()!).removeAlpha().raw().toBuffer({resolveWithObject:true});
   count+=pos.length/9;
   for(let i=0;i<pos.length;i+=9){
    const vertices=[0,3,6].map(offset=>[0,1,2].map(j=>pos[i+offset+j]-normal[j]*.025));
    expect(vertices.every(v=>v[1]>=64.99)).toBe(true);
    expect(allowed(vertices.map(project))).toBe(true);
    if((i/9)%17!==0)continue;
    const center=[0,1,2].map(j=>vertices.reduce((s,v)=>s+v[j],0)/3),pixel=project(center);
    const texUV=[0,1].map(j=>(uv[i/3*2+j]+uv[i/3*2+2+j]+uv[i/3*2+4+j])/3);
    const read=(image:any,x:number,y:number)=>{const px=Math.max(0,Math.min(image.info.width-1,Math.round(x))),py=Math.max(0,Math.min(image.info.height-1,Math.round(y))),o=(py*image.info.width+px)*image.info.channels;return [0,1,2].map(j=>image.data[o+j]);};
    const a=read(source,pixel[0],pixel[1]),b=read(texture,texUV[0]*(texture.info.width-1),texUV[1]*(texture.info.height-1));
    colorErrors.push(a.reduce((s,v,j)=>s+Math.abs(v-b[j]),0)/3);
   }
  }
 }
 expect([...seen].sort()).toEqual(report.buildings.map(b=>b.buildingId).sort());
 expect(count).toBe(1376);expect(current.imageRegionRejected).toBeGreaterThan(0);
 expect(current.buildings[0].projectedArea).toBeCloseTo(2683.294028,3);
 colorErrors.sort((a,b)=>a-b);const median=colorErrors[Math.floor(colorErrors.length/2)];
 console.log({sourceColorSamples:colorErrors.length,medianColorError:median});expect(median).toBeLessThan(20);
 const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 expect(catalog.buildings.find(b=>b.id===id).snap.appliedArea).toBe(0);
});

test('Mitsui independent SNAP and Mapillary are visible on the same existing building',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/texture-city?capture=1');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await expect(page.getByLabel('SNAP追加投影の建物').locator('option')).toHaveCount(3);
 await page.getByLabel('SNAP追加投影の建物').selectOption(id);
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).check();
 const canvas=page.locator('.city-compare-stage canvas');await expect(canvas).toHaveAttribute('data-snap-experimental','loaded');
 await page.getByRole('button',{name:'SNAP写真の方向から見る'}).click();
 const camera=await canvas.getAttribute('data-camera');
 const capture=async()=>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const url=await canvas.evaluate((e:HTMLCanvasElement)=>e.toDataURL());return sharp(Buffer.from(url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});};
 const on=await capture();
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).uncheck();
 await expect(canvas).toHaveAttribute('data-snap-experimental','disabled');const off=await capture(),changed=[0,0,0];
 expect(off.info).toEqual(on.info);
 const {width,height,channels}=on.info;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*channels;if([0,1,2].some(j=>Math.abs(on.data[i+j]-off.data[i+j])>3))changed[Math.min(2,Math.floor(x/Math.floor(width/3)))]++;
 }
 console.log({changed,beforeCamera:camera,afterCamera:await canvas.getAttribute('data-camera')});
 if(changed[0]||changed[2])for(const [name,c] of [['on',on],['off',off]] as const)await writeFile(`test-results/texture-mitsui-${name}.png`,await sharp(c.data,{raw:{width,height,channels}}).png().toBuffer());
 expect(changed[0]).toBe(0);expect(changed[2]).toBe(0);expect(changed[1]).toBeGreaterThan(500);
 await page.getByRole('checkbox',{name:'独立地上写真＋SNAPの追加投影を表示（位置合わせ未確認）'}).check();
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
 await expect(canvas).toHaveAttribute('data-experimental','loaded');expect(await canvas.getAttribute('data-camera')).toBe(camera);
 await page.screenshot({path:'test-results/texture-mitsui-snap-comparison.png',fullPage:true});
 expect(errors).toEqual([]);console.log({changed,camera});
});
