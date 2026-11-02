// Procedural paint in cylindrical world coordinates: continuous around corners,
// with two readable compositions around the tower. No facade image projection.
export function sakuraField(points:{x:number;y:number;z:number}[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),H=hi-lo;
 const body=points.filter(p=>p.y>lo+H*.3&&p.y<lo+H*.8),cx=body.reduce((s,p)=>s+p.x,0)/body.length,cz=body.reduce((s,p)=>s+p.z,0)/body.length;
 const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
 const mix=(a:number[],b:number[],t:number)=>a.map((v,i)=>Math.round(v+(b[i]-v)*Math.max(0,Math.min(1,t))));
 // Angular positions and heights follow the rising branch, not mesh/UV islands.
 const flowers=[[-.78,.55,.076],[-.32,.65,.093],[.35,.72,.10],[.80,.82,.087],[-.16,.87,.074],[.33,.96,.062],[-.93,.77,.057],[.85,.59,.056]];
 return(x:number,y:number,z:number)=>{
  const h=(y-lo)/H,theta=Math.atan2(z-cz,x-cx),u=wrap(theta*2)/Math.PI;
  let c=mix([250,230,202],[255,248,229],h);
  // Vermilion sun behind the blossom: simple silhouette visible at PV distance.
  if(Math.hypot((u-.28)/.61,(h-.76)/.147)<1)c=[222,66,66];
  // A snow-capped Fuji on each side of the continuous panorama.
  const mountain=Math.min(.44,.48-Math.abs(u)*.34);
  if(h<mountain){c=u<0?[40,92,131]:[31,63,104];
   if(h>mountain-.072+.012*Math.cos(u*27))c=[255,249,230];
  }
  // Ink-blue water, cream foam and fine gold edging wrap the entire foot.
  const water=.185+.014*Math.sin(theta*9);
  if(h<water){c=[20,55,88];const wave=Math.sin(h*115+2*Math.sin(theta*9+h*8));
   if(wave>.82)c=[244,237,213];else if(wave>.67)c=[186,150,86];else if(wave<-.25)c=[42,108,140];}
  // Branch and smaller forks, deliberately large enough to read as a tree.
  if(h>.40){const branch=-.95+(h-.40)*3.2+.13*Math.sin(h*12),d=Math.abs(u-branch);
   if(d<.055*(1.35-h))c=[63,43,49];
   const fork=branch-(h-.60)*5;
   if(h>.60&&h<.9&&Math.abs(u-fork)<.025)c=[63,43,49];
  }
  for(const [fx,fy,r] of flowers){const dx=(u-fx)*.14,dy=h-fy,dist=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
   // Five lobes with a tiny notch at each petal tip: recognizable sakura.
   const petal=.76+.24*Math.cos(angle*5),notch=.065*Math.exp(-Math.pow(Math.sin(angle*2.5)/.12,2));
   const edge=r*(petal-notch);
   if(dist<edge){c=mix([214,55,105],[255,222,228],Math.min(1,dist/r*1.6));
    if(dist>edge-.0028)c=[255,245,231];
    if(dist<r*.20)c=[250,195,79];
    if(dist>r*.19&&dist<r*.43&&Math.abs(Math.sin(angle*10))<.08)c=[255,244,210];
   }
  }
  // Sparse drifting petals and restrained spray grain retain the painted feel.
  for(let i=0;i<7;i++){const px=Math.sin(i*21.7)*.9,py=.32+i*.075;
   if(Math.hypot((u-px)/.033,(h-py)/.012)<1)c=[231,113,144];}
  const n=Math.sin(x*37.1+y*19.7+z*29.9)*43758.5453,grain=n-Math.floor(n);
  return mix(c,grain>.5?[255,249,230]:[45,30,46],.025);
 };
}
