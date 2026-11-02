// Coordinates follow the long axis of the actual twin-tower geometry.
export function guardianField(points:{x:number;y:number;z:number}[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),H=hi-lo,top=points.filter(p=>p.y>lo+H*.7),cx=top.reduce((s,p)=>s+p.x,0)/top.length,cz=top.reduce((s,p)=>s+p.z,0)/top.length;
 let xx=0,zz=0,xz=0;for(const p of top){xx+=(p.x-cx)**2;zz+=(p.z-cz)**2;xz+=(p.x-cx)*(p.z-cz);}const a=.5*Math.atan2(2*xz,xx-zz),ax=Math.cos(a),az=Math.sin(a),span=Math.max(...points.map(p=>Math.abs((p.x-cx)*ax+(p.z-cz)*az)));
 const navy=[18,21,44],pink=[255,52,120],teal=[20,212,188],gold=[255,213,64],cream=[255,244,214];
 return (x:number,y:number,z:number)=>{const u=((x-cx)*ax+(z-cz)*az)/span,v=(-(x-cx)*az+(z-cz)*ax)/span,h=(y-lo)/H,angle=Math.atan2(v,u);let c=u<0?teal:pink;
 // The tower tips are two luminous horns; the intervening void is real architecture.
 if(h>.82){c=gold;if(Math.sin(h*95+u*9)>.45)c=navy;return c;}
 if(h>.69)c=navy;
 // Oversize eyes sit below the ears on the broad body, mirrored through its depth.
 const eye=Math.hypot((Math.abs(u)-.47)/.30,(h-.60)/.083);
 if(eye<1.22)c=navy;if(eye<1)c=cream;if(eye<.52)c=navy;
 if(Math.hypot((Math.abs(u)-.40)/.065,(h-.625)/.018)<1)c=cream;
 // A bold diamond nose and an encircling grin, with solid stencil teeth.
 if(Math.abs(u)/.19+Math.abs(h-.465)/.043<1)c=navy;
 const mouth=.34+.065*u*u,md=Math.abs(h-mouth);
 if(md<.066&&Math.abs(u)<.85)c=navy;
 if(md<.041&&Math.abs(u)<.78){const tooth=((u+1)*8)%1;if(tooth<.65&&Math.abs(h-mouth)>.012)c=cream;}
 // Cheek bolts, wrapping lower collar and drips use the same spatial coordinates.
 if(Math.abs(u)>.65&&h>.46&&h<.54&&Math.abs(((h*24+Math.abs(u)*2)%1)-.5)<.12)c=gold;
 if(h<.23){const f=((h*13-angle/6.283)%1+1)%1;c=f<.4?navy:f<.52?cream:u<0?teal:pink;}
 if(h>.24&&h<.30&&Math.sin(u*61)> .92)c=navy;
 const speck=Math.sin(x*32.17+y*21.31+z*17.77)*43758.5453;
 if(h>.70&&h<.81&&speck-Math.floor(speck)>.985)c=gold;
 return c;
 };
}
