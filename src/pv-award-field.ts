// Original street-art overlay: continuous world-space paint with four readable typographic hits.
export function awardField(points:{x:number;y:number;z:number}[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),cx=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,cz=(Math.min(...points.map(p=>p.z))+Math.max(...points.map(p=>p.z)))/2;
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d')!;ctx.textAlign='center';ctx.lineJoin='miter';ctx.miterLimit=3;
 const word=(text:string,y:number,size:number,color:string)=>{ctx.save();ctx.translate(512,y);ctx.transform(1,-.055,-.13,1,0,0);ctx.font=`900 ${size}px Impact, Arial Black, sans-serif`;ctx.lineWidth=30;ctx.strokeStyle='#101216';ctx.strokeText(text,0,0,870);ctx.fillStyle=color;ctx.fillText(text,0,0,870);ctx.restore();};
 word('PLATEAU',220,174,'#f4f3de');word('AWARD',480,275,'#f4f3de');word('2026',850,370,'#e5ff36');
 // Overspray and hard-edged paint cuts stay static, so they do not add animation load.
 ctx.strokeStyle='#101216';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(60,610);ctx.lineTo(960,561);ctx.stroke();
 const data=ctx.getImageData(0,0,1024,1024).data,fract=(v:number)=>v-Math.floor(v),ink=[16,18,22],pink=[255,39,100],acid=[229,255,54],blue=[40,76,245],white=[244,243,222];
 return(x:number,y:number,z:number)=>{const h=(y-lo)/(hi-lo),angle=Math.atan2(z-cz,x-cx),u=fract(-angle/(Math.PI/2)+4.5),zig=Math.abs(fract(angle/Math.PI+.17)*2-1),band=fract(h*2.35+zig*.68);
 let c=band<.18?pink:band<.37?acid:band<.53?blue:ink;
 // Broad angular ribbons wrap corners, with a crisp dark gap and a thin off-white edge.
 if(band>.365&&band<.387)c=ink;if(band>.525&&band<.536)c=white;
 const grain=fract(Math.sin(Math.floor(x*2.4)*127.1+Math.floor(y*2.4)*311.7+Math.floor(z*2.4)*74.7)*43758.5453);
 if(band>.54&&band<.59&&grain>.79)c=pink;
 // Halftone is restricted to the plinth; large solid shapes carry the silhouette.
 if(h<.24&&c===acid&&Math.hypot(fract(x*.32)-.5,fract(y*.32+z*.32)-.5)<.14)c=ink;
 if(h>.31&&h<.9){const tx=Math.floor(u*1023),ty=Math.floor((.9-h)/.59*1023),i=(ty*1024+tx)*4;if(data[i+3]>128)c=[data[i],data[i+1],data[i+2]];}
 return c;
 };
}
