import fs from 'node:fs/promises';
const strokes=[],add=(layer,color,width,points,extra={})=>strokes.push({layer,color,width,points,...extra}),curve=(fn,n=45)=>Array.from({length:n+1},(_,i)=>fn(i/n)),arc=(x,y,rx,ry,a=0,b=Math.PI*2)=>curve(t=>[x+rx*Math.cos(a+(b-a)*t),y+ry*Math.sin(a+(b-a)*t)]),C={navy:'#122e46ff',teal:'#28d9c4ff',blue:'#137da9ff',coral:'#ff5a79ff',gold:'#ffd76aff',cream:'#fff0cbff'};
// Every entry is an ordinary round-brush drag or a stencil click. No image upload.
for(const x of [.25,.5,.75])add('01 · MIDNIGHT',C.navy,.42,[[x,.12],[x,.95]]);
add('02 · MOON',C.gold,.65,[[.5,.19]]);add('02 · MOON',C.navy,.58,[[.64,.165]]);
for(let j=0;j<6;j++)add('03 · TIDAL FLOW',j%2?C.teal:C.blue,.045,curve(t=>[.12+.76*t,.76+j*.031+Math.sin(t*Math.PI*2+j*.5)*.027]));
const spine=t=>[.5+Math.sin(t*Math.PI*1.65-.4)*.19,.32+t*.48];
// Fish silhouette, then hand-reproducible colour bands and overlapping scales.
for(const outline of [true,false])for(let i=44;i>=0;i--){const t=i/44,p=spine(t),w=.08+Math.sin(Math.PI*t)*.30;add('04 · KOI',outline?C.navy:C.coral,w+(outline?.07:0),[p]);}
add('04 · KOI',C.coral,.055,[[.61,.73],[.25,.87],[.53,.80],[.85,.86],[.61,.73]]);
for(let j=0;j<9;j++)add('04 · KOI',j%3===0?C.gold:C.coral,.055,[[.6,.735],[.27+j*.069,.855]]);
add('04 · KOI',C.cream,.12,curve(t=>{const p=spine(t*.72+.08);return [p[0]-.035,p[1]];}));
for(let row=0;row<12;row++){const t=.12+row*.054,p=spine(t);for(const dx of [-.075,.035])add('05 · DETAILS',C.gold,.018,arc(p[0]+dx,p[1],.055,.012,.15,Math.PI-.15));}
add('05 · DETAILS',C.navy,.043,[[.465,.342]]);add('05 · DETAILS',C.cream,.018,[[.459,.339]]);
add('05 · DETAILS',C.cream,.016,curve(t=>[.43-t*.15,.35+Math.sin(t*Math.PI)*.024]));
for(const [x,y,s]of [[.24,.22,.15],[.78,.29,.13],[.22,.55,.10],[.78,.62,.10],[.3,.09,.09]])add('05 · DETAILS',C.gold,s,[[x,y]],{variant:'stencil',stencil:'star',angle:0});
add('05 · DETAILS',C.cream,.024,arc(.38,.93,.065,.018));add('05 · DETAILS',C.cream,.024,arc(.57,.93,.065,.018,.4,Math.PI*2-.3));add('05 · DETAILS',C.cream,.022,[[.59,.932],[.64,.932],[.64,.947]]);add('05 · DETAILS',C.coral,.018,[[.25,.965],[.73,.955]]);

const north=strokes.map(s=>({...s,face:'north'}));strokes.length=0;
// Paint each orientation by rotating the same native model, just as in the editor.
// North is replayed last, preserving its approved composition at crossings.
function ribbon(layer,phase=0){for(let j=0;j<7;j++)add(layer,j%2?C.teal:C.blue,.028,curve(t=>[-.08+1.16*t,.78+j*.027+Math.sin(t*Math.PI*3+phase+j*.4)*.022]));}
function fish(layer,cx,scale,color,mirror=1){const spine=t=>[cx+Math.sin(t*Math.PI*1.8-.3)*.12*mirror,.28+t*.44];for(const outline of [true,false])for(let i=35;i>=0;i--){const t=i/35,p=spine(t);add(layer,outline?C.navy:color,(.035+Math.sin(t*Math.PI)*.17+(outline?.035:0))*scale,[p]);}const tail=spine(1);add(layer,color,.04,[[tail[0],tail[1]],[tail[0]-.13,.83],[tail[0],.77],[tail[0]+.13,.82],[tail[0],tail[1]]]);for(let row=0;row<9;row++){const p=spine(.12+row*.07);for(const dx of [-.033,.025])add(layer,C.gold,.012,arc(p[0]+dx,p[1],.03,.009,.1,Math.PI-.1));}const head=spine(.02);add(layer,C.cream,.02,[[head[0]-.013,head[1]-.003]]);add(layer,C.navy,.011,[[head[0]-.013,head[1]-.004]]);add(layer,C.cream,.009,curve(t=>[head[0]+mirror*t*.08,head[1]+.014+Math.sin(t*Math.PI)*.014]));}
for(const face of ['east','south','west']){const start=strokes.length,layer=face==='east'?'EAST · 双流':face==='west'?'WEST · 星の潮':'SOUTH · 昇る鯉';for(let x=-.03;x<1.09;x+=.12)add(layer,C.navy,.21,[[x,.015],[x,1.02]]);ribbon(layer,face==='west'?1.2:0);
 if(face==='south'){// A companion koi ascends beneath a full moon.
  fish(layer,.5,1.4,C.teal,-1);add(layer,C.gold,.4,[[.5,.16]]);add(layer,C.cream,.035,arc(.5,.16,.23,.051));
 }else{fish(layer,.25,1,face==='east'?C.coral:C.teal);fish(layer,.74,1,face==='east'?C.teal:C.coral,-1);add(layer,C.gold,.19,[[.25,.17]]);add(layer,C.navy,.17,[[.29,.15]]);add(layer,C.gold,.16,[[.74,.17]],{variant:'stencil',stencil:'star',angle:0});for(let j=0;j<5;j++)add(layer,C.cream,.012,curve(t=>[.06+.88*t,.54+j*.025+Math.sin(t*Math.PI*2)*.018]));}
 for(const [x,y]of [[.12,.28],[.88,.33],[.5,.48],[.12,.7],[.88,.68]])add(layer,C.gold,.07,[[x,y]],{variant:'stencil',stencil:'star',angle:0});add(layer,C.cream,.018,arc(.45,.948,.035,.013));add(layer,C.cream,.018,arc(.55,.948,.035,.013,.3,Math.PI*2-.3));add(layer,C.coral,.012,[[.37,.974],[.63,.969]]);for(let i=start;i<strokes.length;i++)strokes[i].face=face;
}
const roofStart=strokes.length,roof='ROOF · 潮の羅針盤';for(let x=-.1;x<1.15;x+=.12)add(roof,C.navy,.22,[[x,-.1],[x,1.1]]);for(const [r,c]of [[.36,C.teal],[.28,C.blue],[.2,C.gold]])add(roof,c,.025,arc(.5,.5,r,r));add(roof,C.gold,.27,[[.5,.5]],{variant:'stencil',stencil:'star',angle:0});for(let i=0;i<8;i++){const a=i*Math.PI/4;add(roof,C.cream,.016,[[.5+Math.cos(a)*.39,.5+Math.sin(a)*.39],[.5+Math.cos(a)*.47,.5+Math.sin(a)*.47]]);}for(let i=roofStart;i<strokes.length;i++)strokes[i].face='roof';strokes.push(...north);
const recipe={version:5,baseCoat:C.navy,title:'NEON TIDE · 夜を泳ぐ — 360°',author:'OpenGraffiti / Codex',buildingId:'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7',description:'All-around mural: companion koi on east/west twin towers, southern ascending koi and moon, rooftop tidal compass, approved northern koi replayed last. Ordinary round brush and star stencil only; rotate the building between faces. Normalized facade coordinates and projected-width brush sizes.',strokes};
await fs.mkdir('public/artworks',{recursive:true});await fs.writeFile('public/artworks/tocho-neon-tide-v5.recipe.json',JSON.stringify(recipe,null,2));console.log({strokes:strokes.length,faces:[...new Set(strokes.map(s=>s.face))],layers:10});
