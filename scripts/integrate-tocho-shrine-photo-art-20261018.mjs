import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const dir='data/texture-city/tocho-district-photo-v2-20261018',out='public/assets/tocho-district-photo-v2-20261018';
const p=JSON.parse(await fs.readFile(out+'/photo-profiles.json','utf8'));
const shrine=JSON.parse(await fs.readFile(dir+'/shrine-generated-results.json','utf8'));
const generated=JSON.parse(await fs.readFile(dir+'/generated-results.json','utf8'));
const definitions={
 'kumano-main-hall':['十二社熊野神社 本殿',[64,45,33],'暗い木材の柱・横梁と横板の壁。格子窓は別部材のため、この素材には含めない。'],
 'kumano-shrine-office':['十二社熊野神社 社務所',[173,164,142],'白い塗り壁と暗い木部の柱・梁。窓格子はこの無窓素材には含めない。'],
 'otori-sansha':['大鳥三社',[133,109,80],'風化した灰褐色の木板、閉じた木製両開き扉と金具。']
};
for(const j of shrine.jobs){
 if(j.status!=='generated-selected')throw Error('Not selected '+j.key);
 const b=p.buildings.find(b=>b.buildingId===j.buildingId);if(!b)throw Error('Not in frozen scope');
 const [name,baseColor,observed]=definitions[j.key],bytes=await fs.readFile(j.selectedImage.path);
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');if(sha!==j.selectedImage.sha256)throw Error('Selected image changed');
 Object.assign(b,{name,baseColor,observed,evidenceStatus:'street-photo',windowAllowed:false,artwork:'artwork/'+b.buildingId+'.png',artworkMapping:'single-face',bays:1,floors:1,bayWidth:3,floorHeight:3,masonrySideCap:.08,sourcePaths:j.sources.map(s=>s.localPath),generationSource:j.selectedImage.path,generationPrompt:j.prompt,artworkDimensions:[j.selectedImage.width,j.selectedImage.height],artworkSha256:sha,inferred:'同じ建物の写真で確認した木部・壁材をイラスト化。未観測面への拡張と部材の寸法は推測。各面へ一枚として収め、扉や柱を周期反復しない。格子窓の個別配置は未対応。',moduleCrop:{method:'full opaque material, single-face mapping',left:0,top:0,width:j.selectedImage.width,height:j.selectedImage.height,originalFloors:1}});
 await fs.writeFile(out+'/'+b.artwork,bytes);
 const result={key:j.key,buildingId:j.buildingId,path:j.selectedImage.path,prompt:j.prompt,sourcePaths:b.sourcePaths,iteration:1};
 const i=generated.findIndex(r=>r.key===j.key);if(i<0)generated.push(result);else generated[i]=result;
}
// Keep the actual selected retry prompt in each profile, too.
for(const r of generated){const b=p.buildings.find(b=>b.generationSource===r.path);if(b)b.generationPrompt=r.prompt;}
const sumitomo=p.buildings.find(b=>b.buildingId==='bldg_684ae520-48d2-4754-b87e-ac4e9e6711f3');
sumitomo.observed='明るい石材の細い格子と、独立した暗い小窓。';
p.counts=Object.fromEntries(['street-photo','native-photo-pattern','insufficient','approved-central'].map(k=>[k,p.buildings.filter(b=>b.evidenceStatus===k).length]));
await fs.writeFile(dir+'/generated-results.json',JSON.stringify(generated,null,2));
await fs.writeFile(out+'/photo-profiles.json',JSON.stringify(p,null,2));
await fs.writeFile(dir+'/photo-profiles.json',JSON.stringify(p,null,2));
console.log(JSON.stringify(p.counts));
