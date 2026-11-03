import type {SurfaceTriangle} from './pv-paint-surface';
// A non-periodic, rising gesture in world space; angular distance keeps paint continuous at corners.
export function awardField(points:{x:number;y:number;z:number}[],triangles:SurfaceTriangle[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),cx=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,cz=(Math.min(...points.map(p=>p.z))+Math.max(...points.map(p=>p.z)))/2;
 // Select the largest north-facing plane from the actual building, not an angular sector.
 const planes=new Map<string,{n:{x:number;y:number;z:number};d:number;area:number;points:typeof points}>();
 for(const t of triangles){const [a,b,c]=t.world,n=b.clone().sub(a).cross(c.clone().sub(a)),area=n.length()/2;n.normalize();if(Math.abs(n.y)>.15||Math.abs(n.z)<.8||(a.z+b.z+c.z)/3>=cz)continue;if(n.z<0)n.negate();const d=n.dot(a),key=[n.x.toFixed(3),n.y.toFixed(3),n.z.toFixed(3),d.toFixed(1)].join('/'),g=planes.get(key)||{n,d,area:0,points:[]};g.area+=area;g.points.push(a,b,c);planes.set(key,g);}
 const plane=[...planes.values()].sort((a,b)=>b.area-a.area)[0];
 if(!plane)throw new Error('Award artwork: the title facade could not be identified');
 const tangent={x:plane.n.z,z:-plane.n.x},positions=plane.points.map(p=>p.x*tangent.x+p.z*tangent.z),left=Math.min(...positions),right=Math.max(...positions),titleWidth=(right-left)*.9,titleCenter=(left+right)/2;
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d')!;ctx.textAlign='center';ctx.lineJoin='round';
 const word=(text:string,y:number,size:number,color:string)=>{ctx.save();ctx.translate(512,y);ctx.transform(1,-.19,-.22,1,0,0);ctx.font=`900 ${size}px Impact, Arial Black, sans-serif`;ctx.lineWidth=45;ctx.strokeStyle='#101216';ctx.strokeText(text,22,25,820);ctx.fillStyle='#2488ff';ctx.fillText(text,22,25,820);ctx.lineWidth=23;ctx.strokeText(text,0,0,820);ctx.fillStyle=color;ctx.fillText(text,0,0,820);ctx.restore();};
 word('PLATEAU',250,210,'#f4f3de');word('AWARD',560,330,'#f4f3de');word('2026',950,410,'#e5ff36');
 const data=ctx.getImageData(0,0,1024,1024).data,fract=(v:number)=>v-Math.floor(v),wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a)),ink=[14,18,26],pink=[255,35,95],acid=[227,255,39],blue=[37,87,253],white=[246,242,219];
 return(x:number,y:number,z:number)=>{const h=(y-lo)/(hi-lo),angle=Math.atan2(z-cz,x-cx),noise=fract(Math.sin(Math.floor(x*3)*127.1+Math.floor(y*3)*311.7+Math.floor(z*3)*74.7)*43758.5453);let c=ink;
 // One huge sweeping pink gesture, an intersecting cobalt stroke, and a tapered acid kick.
 const gestures=[{start:-.12,end:1.12,a:-4.8,turn:10.4,bend:1.65,width:1.05,color:pink},{start:.04,end:.96,a:2.3,turn:-7.8,bend:-1.4,width:.9,color:blue},{start:.12,end:1.05,a:-3.8,turn:9.1,bend:.9,width:.8,color:acid},{start:.35,end:1.08,a:3.4,turn:4.8,bend:-1,width:1.4,color:pink},{start:.4,end:1.15,a:1.9,turn:4.4,bend:-1.5,width:.95,color:acid}];
 for(const g of gestures){const t=(h-g.start)/(g.end-g.start);if(t<=0||t>=1)continue;const center=g.a+t*g.turn+g.bend*Math.sin(t*Math.PI*1.5),distance=wrap(angle-center),width=g.width*Math.sin(Math.PI*t)**.65*(1-.58*t),edge=Math.abs(distance)/width;
 if(edge<1)c=g.color;else if(edge<1.24&&noise>.78+(edge-1)*.8)c=g.color;
 // Long broken bristle trails peel away from the main sweep.
 if(distance>width*1.4&&distance<width*1.54&&t>.23&&t<.87&&noise>.18)c=white;
 }
 // Accelerating off-white slashes, all aimed upward; no repeated chevron border.
 const slash=wrap(angle-(-2.2+h*8+Math.sin(h*5)));if(h>.18&&h<.79&&Math.abs(slash)<.045*(.85-h))c=white;
 // Sparse paint splashes behind the ascending gesture, varying in scale and direction.
 const burst=wrap(angle-(-4+h*10));if(h>.08&&h<.9&&Math.abs(burst)<1.3&&noise>.992)c=h>.5?acid:pink;
 // Sharp accelerating paint blades and offset speed trails fill the side faces.
 for(let j=0;j<5;j++){const t=(h-(.06+j*.13))/.36;if(t<=0||t>=1)continue;const d=wrap(angle-(-.4+j*1.73+t*2.9));const w=.16*(1-t);if(Math.abs(d)<w)c=j%2?white:acid;else if(d>w+.08&&d<w+.1&&t<.72)c=blue;}
 // Typography is confined to this one plane, with a clear margin from every edge.
 const top=.9,bottom=.2,u=.5-(x*tangent.x+z*tangent.z-titleCenter)/titleWidth;
 if(Math.abs(plane.n.x*x+plane.n.y*y+plane.n.z*z-plane.d)<.2&&u>=0&&u<=1&&h>bottom&&h<top){const ty=Math.floor((top-h)/(top-bottom)*1023),tx=Math.floor(u*1023),i=(ty*1024+tx)*4;if(data[i+3]>128)c=[data[i],data[i+1],data[i+2]];}

 return c;
 };
}
