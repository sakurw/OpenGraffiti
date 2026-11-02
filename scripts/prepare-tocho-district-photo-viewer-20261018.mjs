import fs from 'node:fs/promises';
import {configureStableDepth} from './tocho-depth-viewer-utils-20261018.mjs';
const base='tocho-district-photo-v2-20261018';
let html=await fs.readFile('public/tocho-district-illustrated-review-20261018.html','utf8');
html=html.replaceAll('tocho-district-illustrated-20261018',base);
html=html.replace('<title>都庁と周辺街区｜イラスト都市ビュー</title>','<title>都庁と周辺街区｜実写真に基づく建物別テクスチャ</title>');
html=html.replace('都庁と、そのまわり。','建物ごとの写真から。');
html=html.replace('3D 街区ビュー','写真根拠を点検');
html=html.replace('<h2 id="building-name"></h2><p id="building-id"></p>','<h2 id="building-name"></h2><p id="building-id"></p><p id="photo-evidence"></p><a id="photo-source-link" href="/tocho-district-photo-sources-20261018.html" target="_blank" rel="noopener">この建物の写真・生成画像を見る</a>');
html=html.replace('id="provenance">出典情報を読み込み中です。','id="provenance">出典情報を読み込み中です。');
html=html.replace('街区データの詳細</a>', '街区データの詳細</a> · <a href="/tocho-district-photo-sources-20261018.html" target="_blank" rel="noopener">83棟の根拠写真・生成画像</a>');
html=html.replace('      let districtBox = null,', `      let photoProfiles = new Map();
      try { const data = await fetch('/assets/${base}/photo-profiles.json').then(r => { if(!r.ok) throw Error('photo profiles '+r.status); return r.json(); }); photoProfiles = new Map(data.buildings.map(p => [p.buildingId, p])); } catch(error) { fail('写真根拠の読込', error); }
      let districtBox = null,`);
html=html.replace("$('building-name').textContent = building.name || '名称未設定の建物'; $('building-id').textContent = building.id || '';", `const photo = photoProfiles.get(building.id);
        $('building-name').textContent = photo?.name || building.name || '名称未設定の建物'; $('building-id').textContent = building.id || '';
        const label = {'street-photo':'地上実写真から建物別に生成','native-photo-pattern':'この建物のPLATEAU写真で読める模様から生成','approved-central':'確認済みの都庁第一本庁舎','insufficient':'写真の壁面根拠が不足 · 窓割りを推測で追加していません'};
        $('photo-evidence').textContent = [label[photo?.evidenceStatus] || '根拠を点検中', photo?.observed, photo?.inferred && '推測：'+photo.inferred].filter(Boolean).join(' / ');
        $('photo-source-link').href = '/tocho-district-photo-sources-20261018.html?building='+encodeURIComponent(building.id);`);
html=html.replace("$('building-name').textContent = photo?.name || building.name || '名称未設定の建物';", `const knownNames={
 'bldg_97587988-3e50-452d-a887-1e6411aca704':'SHUKNOVA',
 'bldg_7e9c0c6b-e707-43eb-8ead-ba50333f188b':'新宿中央公園 エコギャラリー新宿',
 'bldg_2db57f3c-7924-433a-bd38-5a18466c3d6b':'熊野神社前交番',
 'bldg_9eabfa88-e9b7-402d-b38a-08a5f2544e21':'ハイアット リージェンシー 東京',
 'bldg_89e585dc-50ee-485f-bed1-ce0101523b1e':'新宿第一生命ビルディング'
 }; $('building-name').textContent = photo?.name || knownNames[building.id] || building.name || '名称未設定の建物';`);
html=html.replace('#selection { position: fixed;', '#selection { max-height: 55dvh; overflow:auto; position: fixed;');
html=html.replace('#selection p { font-size:', '#photo-source-link { display:block; margin:8px 0; font-size:11px; } #photo-evidence { line-height:1.6; } #selection p { font-size:');
html=html.replace("'街区全体を表示中 · 建物を選択できます'", "`建物別生成 ${[...photoProfiles.values()].filter(p=>p.artwork).length}棟 · 写真根拠不足 ${[...photoProfiles.values()].filter(p=>p.evidenceStatus==='insufficient').length}棟 · 都庁第一は既存版`");
html=html.replace("$('focus-selection').onclick = () => { if (selected) fit(selected.box, directions.tocho, 'selection'); };", "$('focus-selection').onclick = () => { if (selected) fit(selected.box, directions.tocho, 'selection'); };\n      const requestedBuilding = new URLSearchParams(location.search).get('building');\n      const requestedEntry = buildingBoxes.find(e => e.building.id === requestedBuilding);\n      if (requestedEntry) { select(requestedEntry.building, requestedEntry.box); fit(requestedEntry.box, directions.tocho, 'selection'); }");
await fs.writeFile('public/tocho-district-photo-v2-review-20261018.html',configureStableDepth(html));
console.log('Created photo-conditioned district viewer');
