export function awardField(points:{x:number;y:number;z:number}[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),cx=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,cz=(Math.min(...points.map(p=>p.z))+Math.max(...points.map(p=>p.z)))/2;
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.textAlign='center';ctx.font='900 154px Arial';ctx.fillText('PLATEAU',512,270,920);ctx.font='900 198px Arial';ctx.fillText('AWARD',512,490,920);ctx.font='900 290px Arial';ctx.fillText('2026',512,820,920);const data=ctx.getImageData(0,0,1024,1024).data;
 return(x:number,y:number,z:number)=>{const h=(y-lo)/(hi-lo),angle=Math.atan2(z-cz,x-cx),u=((-angle/(Math.PI/2)+4.5)%1),phase=h*2.2+angle/Math.PI,band=((phase%1)+1)%1;let c=band<.18?[244,74,40]:band<.36?[255,174,34]:band<.54?[203,239,73]:[16,31,49];
 if(h>.39&&h<.86){c=[16,31,49];const tx=Math.floor(u*1023),ty=Math.floor((.86-h)/.47*1023);if(data[(ty*1024+tx)*4+3]>128)c=[250,246,226];}
 const contour=Math.abs(Math.sin(h*55+Math.sin(angle*4)*1.4));if((h<.35||h>.9)&&contour<.085)c=[245,244,213];
 return c;
 };
}

