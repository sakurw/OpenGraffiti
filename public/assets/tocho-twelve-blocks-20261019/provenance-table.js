const summary=document.getElementById('provenance-summary'),tbody=document.getElementById('building-evidence'),search=document.getElementById('building-search');
try{
 const response=await fetch('/assets/tocho-twelve-blocks-20261019/texture-provenance.json');if(!response.ok)throw Error('監査データを読み込めません');const report=await response.json();
 const labels={street_photo:'街路実写真の生成記録',native_plateau_photo_pattern:'PLATEAU写真資料の生成記録',same_building_photo_inference:'同一建物の追加写真から推測',source_limited_pattern:'資料不足・模様を推測',central_mixed_photo_and_inference:'都庁：実写真・推測等の混用',hash_palette_procedural:'個別写真なし・汎用の推測模様',unresolved:'出典未解決'};
 summary.textContent='全127棟が建物別の実写真から生成されているわけではありません。'+Object.entries(report.counts).filter(([,n])=>n).map(([k,n])=>(labels[k]??k)+' '+n+'棟').join(' ／ ')+'。写真資料がある建物も、未観測面の推測・手続き模様を含み、全表面の写真再現を保証しません。記録・ファイル・ハッシュの監査であり、過去の画像生成呼出し自体は再実行していません。';
 const rows=report.buildings.map(b=>{
  const tr=document.createElement('tr');tr.dataset.buildingId=b.buildingId;tr.dataset.category=b.category;
  const name=document.createElement('td'),title=document.createElement('strong'),id=document.createElement('code');title.textContent=b.name||b.displayName||'名称未記録';id.textContent=b.buildingId;name.append(title,document.createElement('br'),id);const block=document.createElement('div');block.textContent='街区 '+b.blockId;name.append(block);
  const category=document.createElement('td');category.textContent=labels[b.category]??b.category;
  const details=document.createElement('td');const known=b.sources??[];const files=known.flatMap(s=>[s.file,s.original]).filter(x=>x?.path);const checks=document.createElement('div');checks.textContent=files.length?'参照ファイル '+files.length+'件／欠損 '+files.filter(f=>!f.exists).length+'／保存済みハッシュ不一致 '+files.filter(f=>f.hashMatches===false).length:'建物別の写真入力・生成画像なし';details.append(checks);
  const limit=document.createElement('div');limit.textContent=b.category==='hash_palette_procedural'?'建物IDから配色し、既定の窓間隔を形状に合わせています。':b.category==='source_limited_pattern'?'写真の解像度・遮蔽等が不足し、壁面の開口・部材は確認できません。':'写真資料と生成記録あり。未観測面・間隔・加工を含むため、全表面の再現証明ではありません。';details.append(limit);
  const links=(b.sourceURLs??[]).filter(u=>/^https?:/.test(u));if(links[0]){const a=document.createElement('a');a.href=links[0];a.target='_blank';a.rel='noopener noreferrer';a.textContent='写真資料の出典';details.append(a);}
  const more=document.createElement('details'),head=document.createElement('summary');head.textContent='入力と加工記録';more.append(head);for(const f of files){const line=document.createElement('div');line.textContent=f.path+' | SHA-256 '+(f.sha256??'未取得')+' | '+(f.hashMatches===true?'記録と一致':f.hashMatches===false?'不一致':'今回の値・過去比較なし');more.append(line);}for(const l of b.claimLimits??[]){const line=document.createElement('p');line.textContent=l;more.append(line);}details.append(more);
  tr.append(name,category,details);return tr;
 });
 function render(){const q=search.value.trim().toLowerCase();tbody.replaceChildren(...rows.filter(r=>!q||r.textContent.toLowerCase().includes(q)));tbody.dataset.total=String(report.buildingCount);tbody.dataset.visible=String(tbody.children.length);}
 search.addEventListener('input',render);render();
}catch(e){summary.textContent='監査表の読込エラー：'+e.message;summary.dataset.failed='true';}
