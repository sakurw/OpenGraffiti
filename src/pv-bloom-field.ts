export function bloomField(points:{x:number;y:number;z:number}[]){
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),H=hi-lo,body=points.filter(p=>p.y>lo+H*.3&&p.y<lo+H*.8),cx=body.reduce((s,p)=>s+p.x,0)/body.length,cz=body.reduce((s,p)=>s+p.z,0)/body.length;
 const mix=(a:number[],b:number[],t:number)=>a.map((v,i)=>Math.round(v+(b[i]-v)*Math.max(0,Math.min(1,t))));
 return(x:number,y:number,z:number)=>{const h=(y-lo)/H,theta=Math.atan2(z-cz,x-cx),wave=theta*3+h*3.7+Math.sin(h*6)*.45,phase=Math.atan2(Math.sin(wave),Math.cos(wave)),p=Math.abs(phase)/Math.PI,width=.16+.78*Math.sin(Math.PI*Math.max(0,Math.min(1,h)))**.65;
 let c=mix([7,16,38],[29,25,69],h),t=p/width;
 if(t<1){const hue=(Math.sin(theta+h*5)+1)/2,base=mix([14,198,181],[150,71,218],hue);c=mix([9,39,77],base,Math.sin(Math.PI*t*.85)**.65);c=mix(c,[255,101,143],Math.max(0,Math.sin(h*5.8-1.2))*.48);if(t>.955)c=[250,211,133];
 const vein=Math.abs(Math.sin(t*25-h*12));if(vein<.055&&t>.18&&t<.88)c=mix(c,[255,224,163],.67);
 if(t<.024)c=[255,229,177];}
 const eye=Math.hypot(phase/.42,(h-.64)/.095);if(eye<1&&eye>.72)c=[244,199,112];if(eye<.72)c=mix([8,35,64],[40,229,212],eye/.72);if(eye<.29)c=[8,18,41];
 const grain=Math.sin(x*37.1+y*19.7+z*29.9)*43758.5453,noise=grain-Math.floor(grain);c=mix(c,noise>.5?[255,239,202]:[3,10,26],.045);
 if(t>1.06&&noise>.995)c=[243,214,159];
 if(h<.13){const ripple=Math.abs(Math.sin(Math.hypot(x-cx,z-cz)*.29-h*16));c=mix([8,32,52],[21,130,139],ripple);if(ripple<.07)c=[241,205,137];}
 return c;
 };
}
