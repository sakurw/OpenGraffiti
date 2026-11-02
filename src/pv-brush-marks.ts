import type {Brush} from './pv-paint';
import {ShapeUtils,Vector2} from 'three';
export interface BrushMark {x:number;y:number;radius:number;opacity:number;shape?:{x:number;y:number}[];shapes?:{x:number;y:number}[][]}
// Generate particles once per screen stamp. Every face receives the same marks.
export function brushMarks(brush:Brush,x:number,y:number,seed:number,start=true):BrushMark[]{
 let state=seed|0;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;},radius=brush.size/2;
 const angle=brush.angle===undefined&&brush.variant==='chisel'?-.5:(brush.angle??-30)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),transform=([a,b]:number[])=>({x:x+(a*c-b*s)*radius,y:y+(a*s+b*c)*radius});
 if(brush.variant==='stencil'){
  const outline=brush.stencil==='arrow'?[[-1,-.3],[.15,-.3],[.15,-.8],[1,0],[.15,.8],[.15,.3],[-1,.3]]:brush.stencil==='bolt'?[[0,-1],[.7,-1],[.15,-.15],[.65,-.15],[-.65,1],[-.15,.15],[-.6,.15]]:Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?.43:1;return [Math.cos(a)*r,Math.sin(a)*r];});
  const points=outline.map(p=>new Vector2(p[0],p[1])),triangles=ShapeUtils.triangulateShape(points,[]);
  return [{x,y,radius:radius*Math.max(...outline.map(([a,b])=>Math.hypot(a,b)))+1,opacity:1,shapes:triangles.map(t=>t.map(i=>transform(outline[i])))}];
 }
 if(brush.tool==='spray'||brush.variant==='stipple'||brush.grain>1||brush.density<100){
  const splatter=brush.variant==='splatter',coarse=brush.variant==='coarse'?3:brush.variant==='mist'?.5:splatter?2.5:1,grain=Math.max(splatter?.04:.008,brush.grain*.009*coarse),n=Math.max(1,Math.round(brush.density*.35/coarse)),marks:BrushMark[]=Array.from({length:n},()=>{const a=random()*Math.PI*2,r=Math.pow(random(),.5+(brush.tool==='spray'?(brush.concentration??0)/35:0))*radius;let dx=Math.cos(a)*r,dy=Math.sin(a)*r;if(['marker','chisel'].includes(brush.variant)){dy*=brush.variant==='marker'?.22:.3;[dx,dy]=[dx*c-dy*s,dx*s+dy*c];}return {x:x+dx,y:y+dy,radius:Math.max(.3,radius*grain)*(splatter?.6+random()*3:1),opacity:1};});
  if(brush.tool==='spray'&&brush.variant==='drip'&&start){const length=brush.dripLength??60;for(let i=0;i<Math.max(1,Math.round(brush.density*.03));i++){const px=x+(random()-.5)*radius,py=y+random()*radius*.3,fall=length*(.4+random()*.6),width=Math.max(.7,radius*.06);marks.push({x:px,y:py+fall/2,radius:fall/2+width,opacity:1,shape:[{x:px-width,y:py},{x:px+width,y:py},{x:px+width*.45,y:py+fall},{x:px-width*.45,y:py+fall}]},{x:px,y:py+fall,radius:width,opacity:1});}}
  return marks;
 }
 if(brush.variant==='soft'||brush.variant==='mist'){const steps=8,alpha=brush.reveal?1:parseInt(brush.color.slice(7,9)||'ff',16)/255;return Array.from({length:steps},(_,i)=>({x,y,radius:radius*(steps-i)/steps,opacity:1/(steps-alpha*i)}));}
 if(brush.variant==='chisel'||brush.variant==='marker'){const thickness=brush.variant==='marker'?.22:.3;return [{x,y,radius:radius*1.05,opacity:1,shape:[[-1,-thickness],[1,-thickness],[1,thickness],[-1,thickness]].map(transform)}];}
 return [{x,y,radius,opacity:1}];
}
