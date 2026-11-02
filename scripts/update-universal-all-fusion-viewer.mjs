import {readFile,writeFile} from 'node:fs/promises';
const path='public/universal-all-areas.html';
let html=await readFile(path,'utf8');
function change(from,to){if(!html.includes(from))throw Error(`Missing expected viewer segment: ${from.slice(0,100)}`);html=html.replace(from,to);}
change('<button data-mode="appearance" aria-pressed="true">元テクスチャ保持・色調補正</button>',
 '<button data-mode="fusion" aria-pressed="true">外部写真色推定＋元テクスチャ保持</button><button data-mode="appearance" aria-pressed="false">PLATEAU色調補正のみ</button>');
change('<button data-mode="inferred" aria-pressed="false">属性・航空画像による推定色</button>',
 '<button data-mode="inferred" aria-pressed="false">外部写真・属性の推定色（UVなし）</button>');
change('<h2 id="right-title">元テクスチャ保持・色調補正（全棟）</h2>',
 '<h2 id="right-title">外部写真色推定＋元テクスチャ保持（全棟）</h2>');
change('let generation=0,syncing=false,selectedArea=\'tocho\',selectedMode=\'appearance\';',
 'let generation=0,syncing=false,selectedArea=\'tocho\',selectedMode=\'fusion\';');
change("document.getElementById('right-title').textContent=mode==='appearance'?'元テクスチャ保持・色調補正（全棟）':'属性・航空画像による推定色（全棟）';",
 "document.getElementById('right-title').textContent=mode==='fusion'?'外部写真色推定＋元テクスチャ保持（全棟）':mode==='appearance'?'PLATEAU色調補正のみ（全棟）':'写真候補・属性の推定色（UVなし）';");
change("const [report,perBuilding]=await Promise.all([fetch('/assets/universal-all-areas/report.json').then(r=>r.json()),fetch('/assets/universal-all-areas/per-building-report.json').then(r=>{if(!r.ok)throw Error('建物別モデル未生成');return r.json()})]);",
 "const [report,perBuilding,fusion]=await Promise.all([fetch('/assets/universal-all-areas/report.json').then(r=>r.json()),fetch('/assets/universal-all-areas/per-building-report.json').then(r=>{if(!r.ok)throw Error('建物別モデル未生成');return r.json()}),fetch('/assets/universal-all-areas/photo-fusion-report.json').then(r=>{if(!r.ok)throw Error('写真補正モデル未生成');return r.json()})]);");
change("if(!entry||!inferred)throw Error('area missing');const models=await Promise.all([entry.baseline,mode==='appearance'?entry.model:inferred.model]",
 "if(!entry||!inferred)throw Error('area missing');const photoEntry=fusion.areas.find(a=>a.area===area);if(!photoEntry)throw Error('photo fusion missing');const models=await Promise.all([entry.baseline,mode==='fusion'?photoEntry.model:mode==='appearance'?entry.model:inferred.model]");
change("geometryUvIdentical:mode==='appearance',perBuilding:true", "geometryUvIdentical:mode!=='inferred',photoFusedBuildings:photoEntry.buildingsWithEligiblePhotoAlbedo,perBuilding:true");
change("${mode==='appearance'?'元UV保持':'推定色'}", "${mode==='inferred'?'元UVなし':'元UV保持'} / 写真推定 ${photoEntry.buildingsWithEligiblePhotoAlbedo.toLocaleString()}棟");
change("load('tocho');", "load('tocho','fusion');");
change('テクスチャ保持版は元PLATEAUの画像・形状・UVを維持して色調を補正。推定色版は全棟のポリゴンを再構成し、GSI航空画像の屋根色、10棟の地上画像候補からの近隣外壁色、属性による補完を使用。全棟の個別写真照合・写真のカメラ幾何登録は未実施です。推定色版と元GLBのUVは一致しません。',
 '写真色推定＋元テクスチャ保持版は、PLATEAU元モデルの形状・UV・窓・設備・画像を維持して、Mapillary候補画像の複数写真から推定した壁色を弱く補正。写真内の建物特定・カメラ幾何登録は未実施のため、直接観測色とは扱いません。推定色（UVなし）版は航空画像と地上画像・属性による補完を表示します。');
await writeFile(path,html);
console.log('fusion mode added to '+path);
