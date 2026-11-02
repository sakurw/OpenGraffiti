import {manifest,revisions,saveRevision,now,isPlaying,clockCommand,type Revision} from './pv-data';
import {PVScene,type Brush} from './pv-scene';
interface Stroke {layer:string;color:string;width:number;points:number[][];variant?:string;stencil?:Brush['stencil'];angle?:number}
interface Recipe {title:string;author:string;buildingId:string;strokes:Stroke[]}
let pending:Promise<string>|undefined;
export function seedMural(){return pending??=create().finally(()=>pending=undefined);}
async function create(){const recipe:Recipe=await fetch('/artworks/tocho-neon-tide.recipe.json').then(r=>{if(!r.ok)throw Error('アートの描画手順を読み込めません。');return r.json();}),m=await manifest(),existing=await revisions(),saved=existing.find(r=>r.id==='tocho-neon-tide-v1');
 if(saved){localStorage.setItem('og-pv-latest-at',String(saved.at));clockCommand('reset');return recipe.buildingId;}
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-2000px;top:0;width:960px;height:1280px';document.body.append(host);const brush:Brush={tool:'brush',color:'#122e46ff',size:28,density:100,grain:0,variant:'solid',reveal:false,tolerance:24};
 const scene=new PVScene(host,{manifest:m,view:'edit',selected:recipe.buildingId,side:'left',face:'north',revisions:existing,brush,onSelect:()=>{},onRoad:()=>{},onReady:()=>{},onError:()=>{},onDraft:()=>{},onCompass:()=>{}});
 try{await scene.ready;const frame=scene.replayFrame();let layer='';for(let i=0;i<recipe.strokes.length;i++){const s=recipe.strokes[i];if(s.layer!==layer){if(layer)scene.layerAction('add');scene.layerAction('rename',undefined,s.layer);layer=s.layer;}scene.replayStroke({...brush,color:s.color,size:s.width*frame.width,variant:s.variant||'solid',stencil:s.stencil,angle:s.angle},s.points.map(([x,y])=>({x:frame.left+x*frame.width,y:frame.top+y*frame.height})));if(i%5===0)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
 const capture=await scene.capture(),at=now(),revision:Revision={...capture,id:'tocho-neon-tide-v1',buildingId:recipe.buildingId,title:recipe.title,author:recipe.author,at,createdAt:new Date().toISOString(),thumbnail:scene.thumbnail(recipe.buildingId,'north')};await saveRevision(revision);localStorage.setItem('og-pv-latest-at',String(at));if(isPlaying())clockCommand('toggle');clockCommand('reset');return recipe.buildingId;
 }finally{scene.dispose();host.remove();}
}
