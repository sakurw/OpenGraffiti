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
const recipe={version:1,title:'NEON TIDE · 夜を泳ぐ',author:'OpenGraffiti / Codex',buildingId:'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7',face:'north',description:'A monumental coral koi, crescent moon and turquoise tidal ribbons. Coordinates are normalized to the building facade; widths are fractions of its projected width. Existing round brush and star stencil only, with RGBA palette colors and five normal layers.',strokes};
await fs.mkdir('public/artworks',{recursive:true});await fs.writeFile('public/artworks/tocho-neon-tide.recipe.json',JSON.stringify(recipe,null,2));console.log({strokes:strokes.length,layers:5});
