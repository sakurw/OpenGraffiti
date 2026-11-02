import fs from 'node:fs/promises';
const asset='tocho-district-plateau-v4-20261018';
const base='public/assets/'+asset;
const manifest=JSON.parse(await fs.readFile(base+'/manifest.json','utf8'));
const scope=JSON.parse(await fs.readFile('data/texture-city/'+asset+'/scope.json','utf8'));
manifest.blocks=scope.blocks;
manifest.scopeLabel='都庁の南北・斜めを含む周囲1街区（8街区）';
await fs.writeFile(base+'/manifest.json',JSON.stringify(manifest,null,2));
let html=await fs.readFile('public/tocho-district-photo-v3-review-20261018.html','utf8');
html=html.replaceAll('tocho-district-photo-v3-20261018',asset)
.replace('/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb',manifest.centralViewerAsset.url)
.replace('<title>都庁と周辺街区｜建物別素材と推測補完</title>','<title>都庁と周辺街区｜PLATEAU原典形状</title>')
.replace('写真を手掛かりに、街区へ。','PLATEAUの形状に、街区の素材を。')
.replace('写真根拠を点検','原典形状を維持')
.replace('街区データの詳細</a>','街区データの詳細</a> · <a href="/assets/tocho-district-plateau-v4-20261018/verification.json" target="_blank" rel="noopener">原典形状の照合結果</a>')
.replace('83棟の写真・観察・推測','既存83棟の写真・観察・推測')
.replace('<p id="photo-evidence"></p>','<p id="geometry-evidence">形状：PLATEAU原典の三角形を変更せず表示。名称未設定の小建物も原典のIDを保持しています。</p><p id="photo-evidence"></p>')
.replace('<div class="compass panel"',`<section class="panel" id="model-tools" aria-label="形状と街区の確認"><button id="material-toggle" aria-pressed="false">原典形状を単色で確認</button><label for="block-focus">街区へ移動</label><select id="block-focus"><option value="">全体</option></select></section><div class="compass panel"`)
.replace('</style>',`#model-tools {position:fixed;right:20px;top:22px;margin-right:80px;padding:7px;display:flex;gap:7px;align-items:center;font-size:11px;} #model-tools select {max-width:180px;padding:6px;border:1px solid #cbd5c7;border-radius:5px;background:#fffef8;color:#36594d;} @media(max-width:640px){#model-tools{top:110px;left:10px;right:10px;margin:0;flex-wrap:wrap;}#model-tools button{padding:4px 7px;font-size:11px;min-height:28px;}#model-tools select{max-width:200px;}#selection{top:192px;}} </style>`)
.replace('const progressItems = {};',`const originalMaterials=new Map();
      const plainMaterial=new THREE.MeshStandardMaterial({color:0xb6b6b0,side:THREE.DoubleSide,roughness:1,metalness:0});
      let plain=false;
      $('material-toggle').onclick=()=>{plain=!plain;for(const root of roots)root.traverse(object=>{if(!object.isMesh)return;let n=object,building=false;while(n){if(n.userData?.buildingId)building=true;n=n.parent;}if(!building)return;if(!originalMaterials.has(object))originalMaterials.set(object,object.material);object.material=plain?plainMaterial:originalMaterials.get(object);});$('material-toggle').setAttribute('aria-pressed',String(plain));$('material-toggle').textContent=plain?'建物別テクスチャに戻す':'原典形状を単色で確認';canvas.dataset.materialView=plain?'native-plain':'illustrated';};
      $('block-focus').onchange=()=>{const block=manifest?.blocks?.find(b=>b.id===$('block-focus').value);if(!block){choose('home');return;}const ids=new Set(block.selectedBuildingIds);const box=new THREE.Box3();for(const b of manifest.buildings)if(ids.has(b.id))box.union(readBox(b));const views={'block-C':[-1,.9,1],'block-N':[-1,.9,-1],'block-NE':[1,.9,-1],'block-E':[1,.9,.4],'block-SE':[1,.9,1],'block-S':[-1,.9,1],'block-SW':[-1,.9,1],'block-W':[-1,.9,.4]};if(!box.isEmpty())fit(box,views[block.id]||directions.home,'block');};
      const progressItems = {};`)
.replace("manifest = data; districtBox = box;",`manifest = data; districtBox = box;
          const names={'C':'中央・都庁第一','N':'北','NE':'北東','E':'東','SE':'南東','S':'南','SW':'南西','W':'西','NW':'北西'};
          for(const block of data.blocks||[]){const option=document.createElement('option');option.value=block.id;option.textContent=block.positions.map(p=>names[p]||p).join('・')+'（'+block.selectedBuildingIds.length+'棟）';$('block-focus').append(option);}`)
.replace("$('status').textContent = `建物別生成 ${[...photoProfiles.values()].filter(p=>p.artwork).length}棟 · 推測補完 ${[...photoProfiles.values()].filter(p=>['native-photo-inference','source-limited-inference','photo-inferred'].includes(p.evidenceStatus)).length}棟 · 都庁第一も表示`;", "$('status').textContent = `PLATEAU原典形状 ${manifest.buildingCount}棟 · 建物別テクスチャ適用`; ")
.replace("'approved-central':'既存の都庁第一本庁舎・表示精度修正版'","'approved-central':'都庁第一・PLATEAU原典形状に意匠を適用'");
await fs.writeFile('public/tocho-district-plateau-v4-review-20261018.html',html);
console.log('Created native-geometry review with material and block controls');
