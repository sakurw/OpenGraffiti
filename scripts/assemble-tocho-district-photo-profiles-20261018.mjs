import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const dir='data/texture-city/tocho-district-photo-v2-20261018',out='public/assets/tocho-district-photo-v2-20261018';
await fs.mkdir(out+'/artwork',{recursive:true});
const native=JSON.parse(await fs.readFile(dir+'/native-photo-sources.json','utf8'));
const scope=JSON.parse(await fs.readFile('data/texture-city/tocho-district-illustrated-20261018/scope.json','utf8'));
const landmarks=JSON.parse(await fs.readFile(dir+'/landmark-sources.json','utf8'));
const park=JSON.parse(await fs.readFile(dir+'/park-sources.json','utf8'));
const jobs=JSON.parse(await fs.readFile(dir+'/art-jobs.json','utf8'));
const results=JSON.parse(await fs.readFile(dir+'/generated-results.json','utf8'));
const byResult=new Map(results.map(x=>[x.key,x]));
const profiles=native.buildings.map((b,index)=>({buildingId:b.buildingId,index,name:b.name??'',artwork:null,bays:4,floors:2,bayWidth:3,floorHeight:3.2,windowAllowed:false,evidenceStatus:'insufficient',sourcePaths:b.walls.map(w=>w.file),nativeResolutionQuality:b.quality,observed:'元画像を点検済み。ただし壁の模様を特定するには解像度不足、遮蔽、または写り込みがある。',inferred:'壁面は窓を加えない仮の無地材。写真に基づく再現済みとは扱わない。',baseColor:[167,164,153],photoCoverageCertified:false}));
for(const j of jobs){const r=byResult.get(j.key);if(!r)throw Error('Missing generation '+j.key);const p=profiles.find(p=>p.buildingId===j.buildingId);Object.assign(p,{artwork:'artwork/'+p.buildingId+'.png',bays:j.bays,floors:j.floors,bayWidth:j.bayWidth,floorHeight:j.floorHeight,windowAllowed:j.windows,evidenceStatus:j.quality==='street-photo'?'street-photo':'native-photo-pattern',sourcePaths:j.sourcePaths,sourcePolygon:j.sourcePolygon,observed:j.observed,inferred:'写真で見える部材と模様をイラスト化。他方向への延長・窓間隔は意匠推測であり実測復元ではない。',baseColor:j.baseColor,generationPrompt:j.prompt,generationSource:r.path});}
const major=[
 ['sumitomo',74,6,5,3.3,3.65,[211,207,192],'明るい石材の格子と個別の小窓。青い連続ガラス壁を撤回。'],
 ['ns',55,6,5,3.05,3.9,[181,174,159],'灰ベージュ石材に横長の小窓。ガラス面は別部材であり全面同模様ではない。'],
 ['daiichi',68,6,5,2.7,3.55,[184,156,140],'淡いサーモン色の石材、小さな正方形の窓、太い無窓の端部。'],
 ['hyatt',34,6,4,3.15,3.6,[190,159,140],'暖色の外壁と小さな正方形窓、窓際のカーテン、広い壁の余白。'],
 ['tocho2',30,4,4,5.7,3.9,[189,185,170],'明るい石材の柱・水平帯と横長ガラス面。元画像下部の別構造物を除外。'],
 ['council-south',53,4,4,4.7,4.1,[182,178,165],'議会側廊の細い縦窓群と横長窓、石材の縦柱・横帯。']
];
for(const [key,index,bays,floors,bayWidth,floorHeight,baseColor,observed]of major){const r=byResult.get(key);if(!r)throw Error('Missing major '+key);const p=profiles[index];Object.assign(p,{artwork:'artwork/'+p.buildingId+'.png',bays,floors,bayWidth,floorHeight,baseColor,windowAllowed:true,evidenceStatus:'street-photo',sourcePaths:landmarks.photosByBuildingId[p.buildingId]?.map(p=>p.path)??p.sourcePaths,observed,inferred:'写真の部材・窓形・色に基づくイラスト。見えない方向、窓の実寸間隔と階数の一部は推測。',generationSource:r.path,generationPrompt:r.prompt});}
for(const p of profiles){if(!p.artwork)continue;await fs.copyFile(p.generationSource,out+'/'+p.artwork);const meta=await sharp(out+'/'+p.artwork).metadata();p.artworkDimensions=[meta.width,meta.height];p.artworkSha256=crypto.createHash('sha256').update(await fs.readFile(out+'/'+p.artwork)).digest('hex');}
// Approved Tocho1 is kept byte-for-byte; this profile is for evidence display.
profiles.push({buildingId:'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7',name:'東京都庁第一本庁舎',artwork:null,evidenceStatus:'approved-central',windowAllowed:true,observed:'既存の実写真に基づく確認用モデルを保持。',inferred:'未観測面への意匠推測を含む。',sourcePaths:['public/assets/tocho-landmark/wall-hour-20261018/wall-illustrated-v1.png'],approvedAsset:'public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb'});
const result={scopePath:'data/texture-city/tocho-district-illustrated-20261018/scope.json',selectedBuildingIds:scope.selectedBuildingIds,buildings:profiles,createdAt:new Date().toISOString(),counts:Object.fromEntries(['street-photo','native-photo-pattern','insufficient','approved-central'].map(k=>[k,profiles.filter(p=>p.evidenceStatus===k).length])),notes:['83棟を固定した範囲。全棟の壁面写真が揃ったとは主張しない。','写真不足面の窓割りを共通の高層ビル模様で埋めない。','追加写真はsource manifestで建物ID・著者・ライセンスと対応付ける。']};
await fs.writeFile(out+'/photo-profiles.json',JSON.stringify(result,null,2));
await fs.writeFile(dir+'/photo-profiles.json',JSON.stringify(result,null,2));
await fs.copyFile('data/texture-city/tocho-district-illustrated-20261018/scope-map.png',out+'/scope-map.png');
await fs.writeFile(out+'/artwork-provenance.json',JSON.stringify({generatedAt:result.createdAt,records:profiles.filter(p=>p.artwork).map(p=>({buildingId:p.buildingId,sourcePaths:p.sourcePaths,observed:p.observed,inferred:p.inferred,prompt:p.generationPrompt,sha256:p.artworkSha256})),landmarkSources:landmarks,parkSources:park},null,2));
console.log(JSON.stringify(result.counts));
