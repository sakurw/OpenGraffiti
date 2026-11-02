import type {SurfaceTriangle,SurfaceSeam} from './pv-paint-surface';
// Editor pixels stay in memory. PNG encoding happens only when publishing.
export const PAINT_SIZE=2048;
export interface Brush {tool:'brush'|'spray'|'eraser'|'fill';color:string;size:number;density:number;grain:number;variant:string;reveal:boolean;tolerance:number;angle?:number;stencil?:'star'|'arrow'|'bolt';concentration?:number;dripLength?:number}
export interface LayerInfo {id:string;name:string;visible:boolean;locked?:boolean}
type Pixels={color:HTMLCanvasElement;mask:HTMLCanvasElement};
type Layer=LayerInfo&{parts:Map<string,Pixels>};
type State={layers:Layer[];selected:string;count:number};
const canvas=()=>{const c=document.createElement('canvas');c.width=c.height=PAINT_SIZE;c.getContext('2d',{willReadFrequently:true});return c;};
const clone=(c:HTMLCanvasElement)=>{const d=canvas();d.getContext('2d')!.drawImage(c,0,0);return d;};
export class PaintDocument {
 layers:Layer[]=[{id:crypto.randomUUID(),name:'レイヤー 1',visible:true,parts:new Map()}];
 selected=this.layers[0].id;count=0;
 base=new Map<string,HTMLCanvasElement>();outputs=new Map<string,HTMLCanvasElement>();dirty=new Set<string>();
 bounds=new Map<string,{x:number;y:number;w:number;h:number}>();
 private copied=new Set<string>();private undo:State[]=[];private redo:State[]=[];private serial=2;
 constructor(private change:()=>void){}
 get info():LayerInfo[]{return this.layers.map(({id,name,visible})=>({id,name,visible}));}
 get undoCount(){return this.undo.length;}get redoCount(){return this.redo.length;}
 private snapshot():State{return {layers:this.layers.map(l=>({...l,parts:new Map(l.parts)})),selected:this.selected,count:this.count};}
 checkpoint(){this.copied.clear();this.undo.push(this.snapshot());if(this.undo.length>8)this.undo.shift();this.redo=[];this.count++;this.change();}
 undoStroke(redo=false){const from=redo?this.redo:this.undo,to=redo?this.undo:this.redo,s=from.pop();if(!s)return;to.push(this.snapshot());this.copied.clear();this.layers=s.layers;this.selected=s.selected;this.count=s.count;this.markAll();this.change();}
 private markAll(){this.bounds.clear();for(const k of this.outputs.keys())this.dirty.add(k);for(const l of this.layers)for(const k of l.parts.keys())this.dirty.add(k);}
 layerAction(action:string,id=this.selected,value?:string){const i=this.layers.findIndex(l=>l.id===id);if(action==='select'){this.copied.clear();this.selected=id;this.change();return;}if(i<0)return;if(action==='add'&&this.layers.length>=10)return;if(action==='delete'&&this.layers.length===1)return;this.checkpoint();if(action==='add'){const l={id:crypto.randomUUID(),name:`レイヤー ${this.serial++}`,visible:true,parts:new Map<string,Pixels>()};this.layers.push(l);this.selected=l.id;}if(action==='duplicate'&&this.layers.length<10){const l=this.snapshot().layers[i];l.id=crypto.randomUUID();l.name+=' コピー';this.layers.splice(i+1,0,l);this.selected=l.id;}if(action==='delete'){this.layers.splice(i,1);this.selected=this.layers.at(-1)!.id;}if(action==='visible')this.layers[i].visible=!this.layers[i].visible;if(action==='rename')this.layers[i].name=value?.trim()||this.layers[i].name;if(action==='up'&&i<this.layers.length-1)[this.layers[i],this.layers[i+1]]=[this.layers[i+1],this.layers[i]];if(action==='down'&&i>0)[this.layers[i],this.layers[i-1]]=[this.layers[i-1],this.layers[i]];this.markAll();this.change();}
 pixels(key:string){const l=this.layers.find(l=>l.id===this.selected)!;if(!l.visible)return;let p=l.parts.get(key);if(!p){p={color:canvas(),mask:canvas()};l.parts.set(key,p);this.copied.add(key);}else if(!this.copied.has(key)){p={color:clone(p.color),mask:clone(p.mask)};l.parts.set(key,p);this.copied.add(key);}return p;}
 // A new output has no retained pixels outside the dirty rectangle. Initialize
 // its entire saved base once; only subsequent composites may use partial bounds.
 compose(key:string){let out=this.outputs.get(key);if(!out){out=canvas();this.outputs.set(key,out);this.bounds.delete(key);}const ctx=out.getContext('2d')!,r=this.bounds.get(key)||{x:0,y:0,w:PAINT_SIZE,h:PAINT_SIZE};ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.clearRect(r.x,r.y,r.w,r.h);ctx.globalCompositeOperation='source-over';const base=this.base.get(key);if(base)ctx.drawImage(base,0,0);for(const l of this.layers){if(!l.visible)continue;const p=l.parts.get(key);if(!p)continue;ctx.globalCompositeOperation='destination-out';ctx.drawImage(p.mask,0,0);ctx.globalCompositeOperation='source-over';ctx.drawImage(p.color,0,0);}ctx.restore();return out;}
 // Each volumetric brush mark shares the same layers, copy-on-write and ROI uploads.
 stampThrough(key:string,points:{x:number;y:number}[],region:Path2D,brush:Brush,opacity=1){
  if(points.length<3)return;const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.max(0,Math.floor(Math.min(...xs)-2)),y=Math.max(0,Math.floor(Math.min(...ys)-2)),right=Math.min(PAINT_SIZE,Math.ceil(Math.max(...xs)+2)),bottom=Math.min(PAINT_SIZE,Math.ceil(Math.max(...ys)+2));if(right<=x||bottom<=y)return;
  const p=this.pixels(key);if(!p)return;const draw=(canvas:HTMLCanvasElement,remove:boolean)=>{const ctx=canvas.getContext('2d')!;ctx.save();ctx.globalCompositeOperation=remove?'destination-out':'source-over';ctx.globalAlpha=opacity;ctx.fillStyle=brush.reveal?'#fff':brush.color;ctx.fill(region);ctx.restore();};
  if(brush.tool==='eraser'){draw(p.color,true);draw(p.mask,true);}else{draw(brush.reveal?p.color:p.mask,true);draw(brush.reveal?p.mask:p.color,false);}const old=this.bounds.get(key);this.bounds.set(key,old?{x:Math.min(x,old.x),y:Math.min(y,old.y),w:Math.max(right,old.x+old.w)-Math.min(x,old.x),h:Math.max(bottom,old.y+old.h)-Math.min(y,old.y)}:{x,y,w:right-x,h:bottom-y});this.dirty.add(key);
 }
 fillSurface(seedKey:string,u:number,v:number,triangles:SurfaceTriangle[],seams:SurfaceSeam[],brush:Brush){
  const keys=[...new Set(triangles.map(t=>t.key))],size=PAINT_SIZE*PAINT_SIZE,indices=new Map(keys.map((k,i)=>[k,i]));
  const fields=keys.map(key=>{const mask=canvas(),ctx=mask.getContext('2d')!;ctx.fillStyle='#fff';for(const t of triangles.filter(t=>t.key===key)){ctx.beginPath();t.uv.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();}return {key,source:this.compose(key).getContext('2d')!.getImageData(0,0,PAINT_SIZE,PAINT_SIZE).data,allowed:ctx.getImageData(0,0,PAINT_SIZE,PAINT_SIZE).data,seen:new Uint8Array(size),result:ctx.createImageData(PAINT_SIZE,PAINT_SIZE),touched:false};});
  const pixel=(x:number,y:number)=>Math.max(0,Math.min(PAINT_SIZE-1,Math.floor(y)))*PAINT_SIZE+Math.max(0,Math.min(PAINT_SIZE-1,Math.floor(x))),start=indices.get(seedKey)!*size+pixel(u,v),seed=fields[indices.get(seedKey)!].source.slice(pixel(u,v)*4,pixel(u,v)*4+4),links=new Map<number,Set<number>>();
  for(const seam of seams){const ia=indices.get(seam.a.key)!,ib=indices.get(seam.b.key)!,steps=Math.max(1,Math.ceil(Math.max(seam.au[0].distanceTo(seam.au[1]),seam.bu[0].distanceTo(seam.bu[1]))*2)),inside=(points:SurfaceTriangle['uv'],edge:SurfaceTriangle['uv'])=>{const cx=points.reduce((s,p)=>s+p.x/3,0),cy=points.reduce((s,p)=>s+p.y/3,0),mx=(edge[0].x+edge[1].x)/2,my=(edge[0].y+edge[1].y)/2,d=Math.hypot(cx-mx,cy-my);return [(cx-mx)/Math.max(d,.001)*.65,(cy-my)/Math.max(d,.001)*.65];},na=inside(seam.a.uv,seam.au),nb=inside(seam.b.uv,seam.bu);
   for(let i=0;i<=steps;i++){const t=i/steps,point=(e:SurfaceTriangle['uv'],n:number[])=>pixel(e[0].x+(e[1].x-e[0].x)*t+n[0],e[0].y+(e[1].y-e[0].y)*t+n[1]),a=ia*size+point(seam.au,na),b=ib*size+point(seam.bu,nb);if(a===b)continue;for(const [x,y]of [[a,b],[b,a]]){if(!links.has(x))links.set(x,new Set());links.get(x)!.add(y);}}}
  const matches=(f:typeof fields[number],n:number)=>{if(n<0||n>=size||f.seen[n]||f.allowed[n*4+3]<32)return false;const j=n*4;if(seed[3]<8)return f.source[j+3]<=Math.max(8,brush.tolerance*.25);for(let k=0;k<4;k++)if(Math.abs(f.source[j+k]-seed[k])>brush.tolerance)return false;return true;};
  const stack=[start];while(stack.length){const value=stack.pop()!,fi=Math.floor(value/size),f=fields[fi],n=value-fi*size;if(!matches(f,n))continue;let left=n;while(left%PAINT_SIZE&&matches(f,left-1))left--;let above=false,below=false;for(let pos=left;pos<size&&Math.floor(pos/PAINT_SIZE)===Math.floor(left/PAINT_SIZE)&&matches(f,pos);pos++){f.seen[pos]=1;f.result.data[pos*4+3]=255;f.touched=true;for(const linked of links.get(fi*size+pos)||[])stack.push(linked);const up=matches(f,pos-PAINT_SIZE),down=matches(f,pos+PAINT_SIZE);if(up&&!above)stack.push(fi*size+pos-PAINT_SIZE);if(down&&!below)stack.push(fi*size+pos+PAINT_SIZE);above=up;below=down;}}
  for(const f of fields){if(!f.touched)continue;const p=this.pixels(f.key);if(!p)continue;const mask=canvas(),mc=mask.getContext('2d')!;mc.putImageData(f.result,0,0);
   // Expand the RESULT only for bilinear sampling at UV edges. Expanding the
   // flood domain joins unrelated packed UV islands and leaks outside contours.
   const edge=canvas();edge.getContext('2d')!.putImageData(f.result,0,0);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)mc.drawImage(edge,dx,dy);
   const color=canvas(),cc=color.getContext('2d')!;cc.fillStyle=brush.reveal?'#fff':brush.color;cc.fillRect(0,0,PAINT_SIZE,PAINT_SIZE);cc.globalCompositeOperation='destination-in';cc.drawImage(mask,0,0);const primary=brush.reveal?p.mask:p.color,other=brush.reveal?p.color:p.mask,oc=other.getContext('2d')!;oc.save();oc.globalCompositeOperation='destination-out';oc.drawImage(mask,0,0);oc.restore();primary.getContext('2d')!.drawImage(color,0,0);this.bounds.delete(f.key);this.dirty.add(f.key);}
 }

 serialize(){return this.layers.map(l=>({id:l.id,name:l.name,visible:l.visible,parts:Object.fromEntries([...l.parts].map(([k,p])=>[k,{color:p.color.toDataURL(),mask:p.mask.toDataURL()}]))}));}
}
