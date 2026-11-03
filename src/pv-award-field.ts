// A non-periodic, rising gesture in world space; angular distance keeps paint continuous at corners.
export function awardField(points:{x:number;y:number;z:number}[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),cx=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,cz=(Math.min(...points.map(p=>p.z))+Math.max(...points.map(p=>p.z)))/2;
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d')!;ctx.textAlign='center';ctx.lineJoin='round';
 const word=(text:string,y:number,size:number,color:string)=>{ctx.save();ctx.translate(512,y);ctx.transform(1,-.19,-.22,1,0,0);ctx.font=`900 ${size}px Impact, Arial Black, sans-serif`;ctx.lineWidth=34;ctx.strokeStyle='#101216';ctx.strokeText(text,0,0,840);ctx.fillStyle=color;ctx.fillText(text,0,0,840);ctx.restore();};
 word('PLATEAU',270,174,'#f4f3de');word('AWARD',530,275,'#f4f3de');word('2026',900,350,'#e5ff36');
 const data=ctx.getImageData(0,0,1024,1024).data,fract=(v:number)=>v-Math.floor(v),wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a)),ink=[14,18,26],pink=[255,35,95],acid=[227,255,39],blue=[37,87,253],white=[246,242,219];
 return(x:number,y:number,z:number)=>{const h=(y-lo)/(hi-lo),angle=Math.atan2(z-cz,x-cx),noise=fract(Math.sin(Math.floor(x*3)*127.1+Math.floor(y*3)*311.7+Math.floor(z*3)*74.7)*43758.5453);let c=ink;
 // One huge sweeping pink gesture, an intersecting cobalt stroke, and a tapered acid kick.
 const gestures=[{start:-.12,end:1.12,a:-4.8,turn:10.4,bend:1.65,width:1.05,color:pink},{start:.04,end:.96,a:2.3,turn:-7.8,bend:-1.4,width:.51,color:blue},{start:.12,end:1.05,a:-3.8,turn:9.1,bend:.9,width:.46,color:acid},{start:.35,end:1.08,a:3.4,turn:4.8,bend:-1,width:1.4,color:pink}];
 for(const g of gestures){const t=(h-g.start)/(g.end-g.start);if(t<=0||t>=1)continue;const center=g.a+t*g.turn+g.bend*Math.sin(t*Math.PI*1.5),distance=wrap(angle-center),width=g.width*Math.sin(Math.PI*t)**.65*(1-.58*t),edge=Math.abs(distance)/width;
 if(edge<1)c=g.color;else if(edge<1.24&&noise>.78+(edge-1)*.8)c=g.color;
 // Long broken bristle trails peel away from the main sweep.
 if(distance>width*1.4&&distance<width*1.54&&t>.23&&t<.87&&noise>.18)c=white;
 }
 // Accelerating off-white slashes, all aimed upward; no repeated chevron border.
 const slash=wrap(angle-(-2.2+h*8+Math.sin(h*5)));if(h>.18&&h<.79&&Math.abs(slash)<.045*(.85-h))c=white;
 // Sparse paint splashes behind the ascending gesture, varying in scale and direction.
 const burst=wrap(angle-(-4+h*10));if(h>.08&&h<.9&&Math.abs(burst)<1.3&&noise>.992)c=h>.5?acid:pink;
 // Two staggered title compositions, instead of four identical labels around the tower.
 const front=wrap(angle+Math.PI/2),back=wrap(angle-Math.PI/2),a=Math.abs(front)<Math.abs(back)?front:back,isFront=Math.abs(front)<Math.abs(back),top=isFront?.86:.7,bottom=isFront?.39:.23;
 if(Math.abs(a)<.7&&h>bottom&&h<top){const u=.5-a/1.4,ty=Math.floor((top-h)/(top-bottom)*1023),tx=Math.floor(u*1023),i=(ty*1024+tx)*4;if(data[i+3]>128)c=[data[i],data[i+1],data[i+2]];}
 return c;
 };
}
