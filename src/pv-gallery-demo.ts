import {manifest,saveRevision,revisions,now,isPlaying,clockCommand,type Revision} from './pv-data';
import {PVScene} from './pv-scene';
// Explicit sample import only; stable IDs keep repeated imports idempotent.
let pending:Promise<string>|undefined;
export function seedGallery(){return pending??=createSamples().finally(()=>pending=undefined);}
async function createSamples(){const m=await manifest(),building=m.buildings.find(b=>b.name.includes('第一本庁舎'))!,existing=await revisions(),at=Math.max(now(),...existing.map(r=>r.at))+1,items:Revision[]=[];
 for(let i=0;i<3;i++){const maps:Record<string,string>={};for(const key of building.parts){const c=document.createElement('canvas');c.width=c.height=2048;const x=c.getContext('2d')!;x.lineWidth=16+i*8;x.strokeStyle=['#ff487f','#62b9fc','#f5d45a'][i];for(let j=0;j<9;j++){x.beginPath();x.arc(400+j*150,500+i*200,100+i*20,0,Math.PI*1.7);x.stroke();}maps[key]=c.toDataURL();}items.push({id:'pv-gallery-demo-'+i,buildingId:building.id,at:at-(2-i)*20000,title:['サンプル 01 · PINK FLOW','サンプル 02 · BLUE LINE','サンプル 03 · GOLD RINGS'][i],author:'PVテストデータ',createdAt:new Date().toISOString(),maps,thumbnail:''});}
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;width:640px;height:640px';document.body.append(host);const scene=new PVScene(host,{manifest:m,view:'history',selected:building.id,side:'left',face:'north',revisions:[],brush:{tool:'brush',color:'#ff487fff',size:28,density:100,grain:0,variant:'solid',reveal:false,tolerance:24},onSelect:()=>{},onRoad:()=>{},onReady:()=>{},onError:message=>{throw Error(message);},onDraft:()=>{},onCompass:()=>{}});
 try{await scene.ready;for(const item of items){await scene.setRevisions([item]);item.thumbnail=scene.thumbnail(building.id,'north');await saveRevision(item);}localStorage.setItem('og-pv-latest-at',String(at));if(isPlaying())clockCommand('toggle');clockCommand('start');}finally{scene.dispose();host.remove();}return building.id;
}
