// Stage-specific visual audit. The comparison baseline is a local dataset artifact,
// not a fixture that should silently be regenerated from the new output.
import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {Vector3,Box3,Ray} from 'three';

for(const area of ['tokyo-tower','tocho'])test(`additional ground photos display on a previously empty building: ${area}`,async({page})=>{
 const path=`data/texture-city/flat-baseline-${area}.json`;
 test.skip(!existsSync(path),'Requires the preserved pre-acquisition dataset baseline');
 const before=JSON.parse(await readFile(path,'utf8'));
 const after=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${area}.json`,'utf8'));
 const empty=new Set(before.buildings.filter(b=>!b.triangles).map(b=>b.buildingId));
 const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 const local=catalog.buildings.filter(b=>b.areaId===area);
 const clearView=(id:string)=>{const b=local.find(b=>b.id===id),center=new Vector3(...b.center),span=Math.max(...b.max.map((v:number,i:number)=>v-b.min[i]),15),camera=center.clone().add(new Vector3(1,.6,.8).normalize().multiplyScalar(span*2.7));
  const ray=new Ray(camera,center.clone().sub(camera).normalize()),point=new Vector3();
  return !local.some(other=>other.id!==id&&ray.intersectBox(new Box3(new Vector3(...other.min),new Vector3(...other.max)),point)&&point.distanceTo(camera)<camera.distanceTo(center)-span/2);
 };
 const recovered=after.buildings.filter(b=>empty.has(b.buildingId)&&b.triangles>0&&clearView(b.buildingId)).sort((a,b)=>b.projectedArea-a.projectedArea)[0];
 expect(recovered).toBeTruthy();
 await page.goto('/texture-city?capture=1');
 await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByLabel('比較地域',{exact:true}).selectOption(area);
 await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByLabel('比較建物').selectOption(recovered.buildingId);
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
 await expect(page.locator('.city-compare-stage canvas')).toHaveAttribute('data-experimental','loaded',{timeout:60000});
 await expect(page.locator('.city-projection-diagnostic')).toContainText('一部に暫定投影あり');
 await page.screenshot({path:`test-results/texture-flat-recovered-${area}.png`,fullPage:true});
 console.log({area,recoveredBuilding:recovered.buildingId,projectedArea:recovered.projectedArea,photos:recovered.sourceIds.length});
});
