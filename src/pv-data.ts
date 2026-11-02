import {siteUrl} from './site-url';
import {streetBuildings} from './pv-street';
import {flatManifest,type FlatLayout} from './pv-layout';
export interface Building {id:string;name:string;blockId:string;parts:string[];bounds:number[]}
export interface Manifest {roadCount?:number;version:number;model:string;modelSha256:string;sourceScopeSha256:string;buildingCount:number;sourcePhotoMaterials:number;bounds:number[][];envelope:number[][];buildings:Building[];layout?:FlatLayout}
export interface Revision {order?:number;id:string;buildingId:string;at:number;title:string;maps:Record<string,string>;thumbnail:string;author?:string;createdAt?:string;layers?:unknown[];faces?:Partial<Record<string,string>>}
export interface Road {id:string;name:string;start:[number,number];end:[number,number];left:string[];right:string[];heightSamples?:number[][];width?:number;sourceRoadId?:string;rings?:number[][][];path?:number[][]}
const requestedScope=new URLSearchParams(location.search).get('scope');
if(requestedScope==='original'||requestedScope==='expanded')localStorage.setItem('og-model-scope',requestedScope);
export const assetBase=siteUrl(localStorage.getItem('og-model-scope')==='original'?'/assets/pv-adopted-20261029':'/assets/pv-expanded-20261102');
let manifestPromise:Promise<Manifest>|undefined;
const requestedTerrain=new URLSearchParams(location.search).get('terrain');
export const terrainMode=requestedTerrain==='constrained'?'constrained':requestedTerrain==='flat'?'flat':localStorage.getItem('og-terrain-mode')==='constrained'?'constrained':'flat';
if(requestedTerrain==='flat'||requestedTerrain==='constrained')localStorage.setItem('og-terrain-mode',terrainMode);
export function manifest():Promise<Manifest>{return manifestPromise??=fetch(assetBase+'/manifest.json').then(async r=>{if(!r.ok)throw Error('採用モデルの情報を読み込めません。');const m:Manifest=await r.json();if(terrainMode!=='flat'||m.buildingCount===1)return m;const layout=await fetch(assetBase+'/flat-layout.json?v=1').then(r=>{if(!r.ok)throw Error('平坦化設定を読み込めません。');return r.json();});return flatManifest(m,layout);});}
const channel=new BroadcastChannel('opengraffiti-pv-20261029');
const listeners=new Set<()=>void>();
function announce(){listeners.forEach(fn=>fn());}
export function subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
interface Clock {at:number;anchor:number;playing:boolean}
function loadClock():Clock{try{return JSON.parse(localStorage.getItem('og-pv-clock')||'null')||{at:0,anchor:Date.now(),playing:true};}catch{return {at:0,anchor:Date.now(),playing:true};}}
let clock=loadClock();if(!localStorage.getItem('og-pv-clock'))localStorage.setItem('og-pv-clock',JSON.stringify(clock));
export function now(){return clock.at+(clock.playing?Date.now()-clock.anchor:0);}
export function isPlaying(){return clock.playing;}
export function clockCommand(command:'toggle'|'start'|'reset'|'back'|'forward'){
 const value=now();clock={at:command==='start'||command==='reset'?Number(localStorage.getItem('og-pv-latest-at'))||0:Math.max(0,value+(command==='back'?-1000:command==='forward'?1000:0)),anchor:Date.now(),playing:command==='reset'?false:command==='toggle'?!clock.playing:clock.playing};
 localStorage.setItem('og-pv-clock',JSON.stringify(clock));channel.postMessage({type:'clock',clock});announce();
}
channel.onmessage=e=>{if(e.data.type==='clock'){clock=e.data.clock;announce();}if(e.data.type==='revisions')announce();if(e.data.type==='request-clock')channel.postMessage({type:'clock',clock});};
channel.postMessage({type:'request-clock'});
window.addEventListener('storage',e=>{if(e.key==='og-pv-clock'){clock=loadClock();announce();}});
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open('opengraffiti-pv-native-model',1);req.onupgradeneeded=()=>req.result.createObjectStore('revisions',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
// Publication order is independent of the rewindable 15-second demo clock.
export function compareRevisions(a:Revision,b:Revision){return (a.order||0)-(b.order||0)||(Date.parse(a.createdAt||'')||0)-(Date.parse(b.createdAt||'')||0)||a.at-b.at||a.id.localeCompare(b.id);}
export async function revisions():Promise<Revision[]>{const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('revisions'),req=tx.objectStore('revisions').getAll();req.onsuccess=()=>resolve((req.result as Revision[]).sort(compareRevisions));req.onerror=()=>reject(req.error);tx.oncomplete=()=>d.close();});}
export async function saveRevision(rev:Revision){const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction('revisions','readwrite'),store=tx.objectStore('revisions'),read=store.getAll();read.onsuccess=()=>{rev.order=Math.max(0,...(read.result as Revision[]).map(r=>r.order||0))+1;store.put(rev);};tx.oncomplete=()=>{d.close();resolve();};tx.onerror=()=>{d.close();reject(tx.error);};tx.onabort=()=>{d.close();reject(tx.error);};});channel.postMessage({type:'revisions'});announce();}
export function fade(rev:Revision|undefined,time=now()){return rev?Math.max(0,Math.min(1,1-(time-rev.at)/15000)):0;}
export function name(b:Building,m:Manifest){return b.name||`建物 ${String(m.buildings.indexOf(b)+1).padStart(3,'0')}`;}
export function center(b:Building):[number,number,number]{return [(b.bounds[0]+b.bounds[3])/2,(b.bounds[1]+b.bounds[4])/2,(b.bounds[2]+b.bounds[5])/2];}

export async function roads(_m:Manifest):Promise<Road[]>{const r=await fetch(assetBase+'/roads.json?v=5');if(!r.ok)throw Error('道路を読み込めません。');return ((await r.json()).roads as Road[]).map(road=>{let sides:ReturnType<typeof streetBuildings>|undefined;return {...road,get left(){return (sides??=streetBuildings(_m.buildings,road)).left;},get right(){return (sides??=streetBuildings(_m.buildings,road)).right;}};});}
