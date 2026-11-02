import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { readFile, writeFile, rename, mkdir, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { progress } from '../shared/catalog.mjs';
import { walls, sections, areas, dimensions, fixtureMode, datasetVersion } from './catalog.mjs';
import { prepareAssets, seedScenario } from './seed.mjs';
import { decode, encode, fadePixels, imageHash } from './render.mjs';
import {ensureWall,wallGeometry} from './lazy-walls.mjs';

const root=resolve(process.env.MOCK_DATA_DIR || (fixtureMode?'data':'data/'+datasetVersion)), imageDir=join(root,'images');
await mkdir(root,{recursive:true});
if(!fixtureMode)await prepareAssets(imageDir,walls);else {try { await access(join(imageDir,`${walls.at(-1).id}-base.png`)); } catch { await prepareAssets(imageDir,walls); }}
const stateFile=join(root,'state.json');
let db;
try { db=JSON.parse(await readFile(stateFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; const s=seedScenario(walls,fixtureMode); db={active:s.id,scenarios:{[s.id]:s}}; }
// A restart pauses the demo so a presentation resumes at its saved state.
const current=()=>db.scenarios[db.active];
const demoNow=(s=current())=>s.now+(s.playing?(Date.now()-s.anchor)*s.speed:0);
current().playing=false;
async function save() { const temp=stateFile+'.tmp'; await writeFile(temp,JSON.stringify(db)); await rename(temp,stateFile); }
await save();
let queue=Promise.resolve();
function mutate(fn) { const next=queue.then(async()=>{const before=structuredClone(db); try{return await fn();}catch(e){db=before;throw e;}}); queue=next.catch(()=>{}); return next; }
const app=Fastify({bodyLimit:15*1024*1024,logger:false});
const token=process.env.OPEN_GRAFFITI_DEMO_TOKEN || 'graffiti-demo';
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,statusCode:status});
const auth=req=>{if(req.headers.authorization!==`Bearer ${token}`)throw error('TOKEN_INVALID','操作用トークンを確認してください。',401);};
app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode||500).send({code:e.code||'SERVER_ERROR',message:e.statusCode?e.message:'保存できませんでした。編集を保持して再試行してください。'}));
// Standalone viewer modules must be served before SPA fallback and with JS MIME.
app.get('/vendor/:file',async(req,reply)=>reply.type('application/javascript').send(await readFile(join(resolve('public/vendor'),req.params.file))));
await app.register(staticPlugin,{root:imageDir,prefix:'/images/',decorateReply:true});
// The standalone comparison page is intentionally served by the local mock
// server as well as Vite. Limit the dependency exposure to Three.js only so
// its import map works from http://127.0.0.1:3100 without relying on Vite.
await app.register(staticPlugin,{root:resolve('node_modules/three'),prefix:'/node_modules/three/',decorateReply:false});
await app.register(staticPlugin,{root:resolve('public/vendor'),prefix:'/vendor/',decorateReply:false});
// Serve landmark comparison assets (GLB, screenshots, audit files). Without
// this route the SPA fallback returns index.html for /assets requests, causing
// GLTFLoader to receive HTML instead of binary data.
// Vite's compiled JS/CSS and city assets share this URL prefix. Look in the
// build first so a missing public file does not become an HTML SPA response.
await app.register(staticPlugin,{root:[resolve('dist/assets'),resolve('public/assets')],prefix:'/assets/',decorateReply:false});
// Serve standalone inspection artifacts (for example Tocho GLB viewers) from
// public while keeping API and application routes above them.
app.get('/tocho-v129-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v129-viewer.html'))));
app.get('/tocho-v130-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v130-viewer.html'))));
app.get('/tocho-v132-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v132-viewer.html'))));
app.get('/tocho-v133-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v133-viewer.html'))));
app.get('/data/texture-city/:file',async(req,reply)=>{
  const publicFile=resolve('public/data/texture-city/'+req.params.file);
  const dataFile=resolve('data/texture-city/'+req.params.file);
  try { return reply.send(await readFile(publicFile)); }
  catch(e) { if(e.code!=='ENOENT') throw e; }
  const body=await readFile(dataFile);
  if(req.params.file.endsWith('.html')) return reply.type('text/html').send(body);
  if(req.params.file.endsWith('.json')) return reply.type('application/json').send(body);
  return reply.type('model/gltf-binary').send(body);
});
app.get('/tocho-wall-canonical-hybrid-v2-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-wall-canonical-hybrid-v2-viewer.html'))));
app.get('/tocho-wall-canonical-hybrid-v2.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-wall-canonical-hybrid-v2.glb'))));
app.get('/tocho-photoreal-v129-hybrid.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v129-hybrid.glb'))));
app.get('/tocho-photoreal-v129-triangle-split.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v129-triangle-split.glb'))));
app.get('/tocho-photoreal-v149-wall-direct-split.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v149-wall-direct-split.glb'))));
app.get('/tocho-6697-current-verified-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-6697-current-verified-viewer.html'))));
app.get('/tocho-6697-current-photoreal.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-6697-current-photoreal.glb'))));
app.get('/tocho-landmark-photographic-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-landmark-photographic-viewer.html'))));
app.get('/tocho-photographic-landmark-final.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-photographic-landmark-final.glb'))));
app.get('/tocho-landmark-comparison.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-landmark-comparison.html'))));
app.get('/tocho-landmark-web-final.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-landmark-web-final.html'))));
app.get('/tocho-landmark-final-review.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-landmark-final-review.html'))));
app.get('/tocho-landmark-final-review/:file',async(req,reply)=>{
  const file=req.params.file;
  if(!file.endsWith('.glb')) return reply.code(404).send();
  return reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/'+file)));
});
app.get('/tocho-v148-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v148-viewer.html'))));
app.get('/tocho-v152-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v152-viewer.html'))));
app.get('/tocho-v135-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v135-viewer.html'))));
app.get('/tocho-v147-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v147-viewer.html'))));
app.get('/tocho-v135-wall-direct-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v135-wall-direct-viewer.html'))));
app.get('/tocho-v135-wall-direct.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-v135-wall-direct.glb'))));
app.get('/tocho-v155-photoreal-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v155-photoreal-viewer.html'))));
app.get('/tocho-photoreal-v155.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v155.glb'))));
app.get('/tocho-photoreal-v168-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-photoreal-v168-viewer.html'))));
app.get('/tocho-photoreal-v168-corrected-atlas.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v168-corrected-atlas.glb'))));
app.get('/tocho-v173-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v173-viewer.html'))));
app.get('/tocho-photoreal-v173-v168-atlas-preserve.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v173-v168-atlas-preserve.glb'))));
app.get('/tocho-v157-v135-registry-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v157-v135-registry-viewer.html'))));
app.get('/tocho-photoreal-v157-v135-registry.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-photoreal-v157-v135-registry.glb'))));
app.get('/tocho-semantic-upper-bound-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-semantic-upper-bound-viewer.html'))));
app.get('/tocho-semantic-upper-bound-test.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-semantic-upper-bound-test.glb'))));
app.get('/tocho-v90-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-v90-viewer.html'))));
app.get('/tocho-v90-rebuild-test.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v90-rebuild-test.glb'))));
app.get('/tocho-v91-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-v91-viewer.html'))));
app.get('/tocho-v91-rebuild-test.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v91-rebuild-test.glb'))));
app.get('/tocho-v91-applied-uv-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-v91-applied-uv-viewer.html'))));
app.get('/tocho-v91-applied-uv-material-split.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v91-applied-uv-material-split.glb'))));
app.get('/tocho-v91-original-material-corrected-uv.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v91-original-material-corrected-uv.glb'))));
app.get('/tocho-v91-original-material-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-v91-original-material-viewer.html'))));
app.get('/tocho-v92-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-v92-viewer.html'))));
app.get('/tocho-v92-material-split.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v92-material-split.glb'))));
app.get('/tocho-v93-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-v93-viewer.html'))));
app.get('/tocho-v93-preserve-normal.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v93-preserve-normal.glb'))));
app.get('/tocho-corner-split-v108-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-corner-split-v108-viewer.html'))));
app.get('/tocho-corner-split-v108.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-corner-split-v108.glb'))));
app.get('/tocho-photoreal-v191-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-photoreal-v191-viewer.html'))));
app.get('/tocho-photoreal-v191-atlas0.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v191-atlas0.glb'))));
app.get('/tocho-photo-only-debug-v197-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-photo-only-debug-v197-viewer.html'))));
app.get('/tocho-photo-only-debug-v198-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-photo-only-debug-v198-viewer.html'))));
app.get('/tocho-photo-only-debug-v199-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-photo-only-debug-v199-viewer.html'))));
app.get('/v200-compare.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/v200-compare.html'))));
app.get('/tocho-photoreal-v196-render-first-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-photoreal-v196-render-first-viewer.html'))));
// Keep module dependencies available from the standalone demo when dist is the
// served root. Fastify static fallback must not turn JS module requests into
// index.html responses.
const publicRoot=resolve('dist');
try { await access(join(publicRoot,'index.html')); await app.register(staticPlugin,{root:publicRoot,prefix:'/',decorateReply:false}); app.setNotFoundHandler(async(req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({message:'APIがありません'}):reply.type('text/html').send(await readFile(join(publicRoot,'index.html')))); } catch { /* Vite serves development pages. */ }
const contexts=new Map(), renderCache=new Map(), rawCache=new Map();
async function raw(file) { if(!rawCache.has(file)){if(rawCache.size>=8)rawCache.delete(rawCache.keys().next().value);rawCache.set(file,await decode(join(imageDir,file)));} return rawCache.get(file); }
async function render(wall,rev,p) {
 if(wall.lazy)await ensureWall(wall,datasetVersion,imageDir);
 const [WIDTH,HEIGHT]=dimensions(wall);const key=`${rev.image}:${p}`;
 if(renderCache.has(key))return renderCache.get(key);
 const a=await raw(rev.image), b=await raw(`${wall.id}-base.png`);
 const pixels=fadePixels(a.data,b.data,WIDTH,HEIGHT,p);
 const image=await encode(pixels,WIDTH,HEIGHT);
 const result={image,hash:imageHash(pixels,WIDTH,HEIGHT)};
 if(renderCache.size>40)renderCache.delete(renderCache.keys().next().value);
 renderCache.set(key,result); return result;
}
const wallMap=new Map(walls.map(w=>[w.id,w]));
const getWall=id=>{const w=wallMap.get(id);if(!w)throw error('WALL_NOT_FOUND','壁が見つかりません。',404);return w;};
function snapshot(){const s=current();return {scenarioId:s.id,startedAt:s.startedAt,now:demoNow(),playing:s.playing,speed:s.speed,stateVersion:s.version,walls:walls.map(w=>({...w,revisions:s.walls[w.id]})),sections,areas,datasetVersion,fixture:fixtureMode,mock:true};}
app.get('/api/v1/bootstrap',async()=>snapshot());
app.get('/api/v1/clock',async()=>({scenarioId:current().id,stateVersion:current().version,now:demoNow(),playing:current().playing,speed:current().speed}));
app.get('/api/v1/walls/:id/geometry',async req=>wallGeometry(getWall(req.params.id),datasetVersion));
for(const kind of ['base','mask'])app.get('/api/v1/walls/:id/'+kind,async(req,reply)=>{const w=getWall(req.params.id);if(w.lazy)await ensureWall(w,datasetVersion,imageDir);return reply.type('image/png').send(await readFile(join(imageDir,w.id+'-'+kind+'.png')));});
app.post('/api/v1/session',async req=>{auth(req);return {authorized:true};});
app.post('/api/v1/walls/:id/edit-context',async req=>{
 const w=getWall(req.params.id),s=current(),r=s.walls[w.id].at(-1),at=demoNow(s),p=progress(r,at),out=await render(w,r,p);
 const id=randomUUID(),context={id,scenarioId:s.id,wallId:w.id,revisionId:r.id,revisionNo:r.no,asOf:at,progress:p,hash:out.hash,expiresAt:Date.now()+30*60*1000};
 contexts.set(id,context); if(contexts.size>200)contexts.delete(contexts.keys().next().value);
 return {...context,image:`/api/v1/renders/${r.id}?p=${p}`,width:dimensions(w)[0],height:dimensions(w)[1],mask:w.maskImage};
});
app.get('/api/v1/renders/:id',async(req,reply)=>{
 const s=current();let w,r; for(const wall of walls){const rev=s.walls[wall.id].find(r=>r.id===req.params.id);if(rev){w=wall;r=rev;break;}}
 if(!r)throw error('REVISION_NOT_FOUND','履歴が見つかりません。',404);
 let p=req.query.p===undefined?progress(r,Number(req.query.at)||demoNow()):Number(req.query.p);
 if(!Number.isInteger(p)||p<0||p>1000)throw error('INVALID_PROGRESS','退色時点が不正です。'); if(r.no===0)p=1000;
 const out=await render(w,r,p);return reply.header('Cache-Control','private, no-cache').header('X-Image-Hash',out.hash).type('image/png').send(out.image);
});
app.post('/api/v1/walls/:id/publications',req=>mutate(async()=>{
 auth(req);const w=getWall(req.params.id),s=current(),body=req.body||{};const [WIDTH,HEIGHT]=dimensions(w);
 if(typeof body.key!=='string'||!/^[\da-f-]{36}$/i.test(body.key))throw error('INVALID_KEY','公開キーが不正です。');
 const requestHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 const previous=s.attempts[body.key];if(previous){if(previous.hash!==requestHash)throw error('KEY_REUSED','公開要求が変わっています。',409);return previous.result;}
 const ctx=contexts.get(body.contextId);
 if(!ctx||ctx.expiresAt<Date.now())throw error('CONTEXT_EXPIRED','下地の有効期限が切れました。最新下地を再取得してください。',422);
 if(ctx.scenarioId!==s.id)throw error('STALE_SCENARIO','デモがリセットされました。下地を再取得してください。',409);
 const latest=s.walls[w.id].at(-1);
 if(ctx.wallId!==w.id||ctx.revisionId!==latest.id)throw error('WALL_REVISION_CONFLICT','この壁に新しい作品が公開されました。',409);
 for(const [key,max]of[['title',80],['author',32]]){const v=typeof body[key]==='string'?body[key].normalize('NFKC').trim():'';if(!v||[...v].length>max||/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(v))throw error('INVALID_TEXT','タイトルは1〜80文字、表示名は1〜32文字で入力してください。');body[key]=v;}
 if(latest.no>=20)throw error('HISTORY_LIMIT','この壁の履歴は20件に達しました。デモをリセットしてください。',422);
 if(typeof body.png!=='string'||!body.png.startsWith('data:image/png;base64,'))throw error('INVALID_PNG','PNG形式の画像が必要です。');
 const bytes=Buffer.from(body.png.split(',')[1],'base64');if(bytes.length>10*1024*1024)throw error('IMAGE_TOO_LARGE','画像が10MBを超えています。',413);
 let decoded;try{decoded=await decode(bytes);}catch{throw error('INVALID_PNG','画像を読み込めません。');}
 if(decoded.info.width!==WIDTH||decoded.info.height!==HEIGHT)throw error('INVALID_SIZE','画像サイズが一致しません。');
 const base=await raw(`${w.id}-base.png`);for(let i=0;i<decoded.data.length;i+=4){const expected=base.data[i+3];if(decoded.data[i+3]!==expected||(!expected&&(decoded.data[i]||decoded.data[i+1]||decoded.data[i+2])))throw error('INVALID_MASK','壁面マスク外または開口部への描画は公開できません。');}
 const hash=imageHash(decoded.data,WIDTH,HEIGHT);if(hash===ctx.hash)throw error('EMPTY_ARTWORK','下地に描画がありません。',422);
 const image=`${hash}.png`;await writeFile(join(imageDir,image),await encode(decoded.data,WIDTH,HEIGHT));
 const time=Math.max(demoNow(s),latest.start+1);latest.end=time;
 const revision={id:randomUUID(),no:latest.no+1,start:time,end:null,title:body.title,author:body.author,image,hash,createdAt:Date.now(),source:{no:latest.no,asOf:ctx.asOf,progress:ctx.progress,hash:ctx.hash}};
 s.walls[w.id].push(revision);s.now=time;s.anchor=Date.now();s.version++;
 const result={revision,scenarioId:s.id};s.attempts[body.key]={hash:requestHash,result};await save();return result;
}));
app.post('/api/v1/demo/command',req=>mutate(async()=>{auth(req);const s=current(),b=req.body||{};const now=demoNow(s);s.now=now;s.anchor=Date.now();if(b.command==='play')s.playing=true;else if(b.command==='pause')s.playing=false;else if(b.command==='start'){s.now=Math.max(...Object.values(s.walls).map(rs=>rs.at(-1).start));s.playing=false;}else throw error('INVALID_COMMAND','操作が不正です。');s.version++;await save();return snapshot();}));
app.post('/api/v1/demo/reset',req=>mutate(async()=>{auth(req);if(req.body?.confirmation!=='リセット')throw error('CONFIRMATION_REQUIRED','リセットと入力してください。');const s=seedScenario(walls,fixtureMode);db.scenarios[s.id]=s;db.active=s.id;await save();return snapshot();}));
app.get('/api/v1/backup',async(req,reply)=>{auth(req);const available=new Set(await readdir(imageDir));return reply.header('Content-Disposition','attachment; filename="opengraffiti-mock-backup.json"').send({schemaVersion:2,datasetVersion,baseAssets:'public/assets/datasets/'+datasetVersion,db,images:Object.fromEntries(await Promise.all([...new Set(Object.values(db.scenarios).flatMap(s=>Object.values(s.walls).flatMap(rs=>rs.map(r=>r.image))))].filter(f=>available.has(f)).map(async f=>[f,(await readFile(join(imageDir,f))).toString('base64')])))});});
if(process.env.MOCK_TEST_MODE==='1')app.post('/api/v1/test/shutdown',async()=>{setTimeout(()=>{app.close().then(()=>process.exit(0));},100);return {closing:true};});
app.get('/tocho-v149-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v149-viewer.html'))));
app.get('/tocho-v150-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v150-viewer.html'))));
app.get('/tocho-v151-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v151-viewer.html'))));
app.get('/tocho-v65-surface-preserve-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v65-surface-preserve-viewer.html'))));
app.get('/tocho-v163-v85-split-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v163-v85-split-viewer.html'))));
app.get('/tocho-photoreal-v163-v85-split.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v163-v85-split.glb'))));
app.get('/tocho-v166-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v166-viewer.html'))));
app.get('/tocho-photoreal-v166-v163-map-preserve.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-photoreal-v166-v163-map-preserve.glb'))));
app.get('/tocho-v167-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v167-viewer.html'))));
app.get('/tocho-v171-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-v171-viewer.html'))));
app.get('/tocho-photoreal-v167-primitive-link.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('public/tocho-photoreal-v167-primitive-link.glb'))));
app.get('/tocho-v129-direct-test.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-v129-direct-test.glb'))));
app.get('/tocho-photoreal-v171-preserve-material.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v171-preserve-material.glb'))));
app.get('/tocho-photographic-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-photographic-viewer.html'))));
app.get('/tocho-photoreal-v190-public-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('data/texture-city/tocho-photoreal-v190-public-viewer.html'))));
app.get('/tocho-photoreal-v190-material-split-v91.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v190-material-split-v91.glb'))));
app.get('/tocho-photoreal-v193-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-photoreal-v193-viewer.html'))));
app.get('/tocho-photoreal-v193-position-candidate-bridge.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v193-position-candidate-bridge.glb'))));
app.get('/tocho-photoreal-v194-uv-yflip-viewer.html',async(req,reply)=>reply.type('text/html').send(await readFile(resolve('public/tocho-photoreal-v194-uv-yflip-viewer.html'))));
app.get('/tocho-photoreal-v194-uv-yflip.glb',async(req,reply)=>reply.type('model/gltf-binary').send(await readFile(resolve('data/texture-city/tocho-photoreal-v194-uv-yflip.glb'))));
await app.listen({port:Number(process.env.PORT||3100),host:'127.0.0.1'});
console.log('OpenGraffiti mock API: http://127.0.0.1:'+Number(process.env.PORT||3100));



