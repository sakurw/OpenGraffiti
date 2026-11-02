// Crop only unused pixels, preserving source coordinates and a two-pixel border.
export function cropTextureRegion(uv,width,height){
 if(!uv.length||uv.length%2||!uv.every(Number.isFinite)||width<1||height<1)throw Error('Invalid UV crop input');
 let minU=1,minV=1,maxU=0,maxV=0;for(let i=0;i<uv.length;i+=2){minU=Math.min(minU,uv[i]);maxU=Math.max(maxU,uv[i]);minV=Math.min(minV,uv[i+1]);maxV=Math.max(maxV,uv[i+1]);}
 if(minU<0||minV<0||maxU>1||maxV>1)throw Error('UV outside image');
 const left=Math.max(0,Math.floor(minU*width)-2),top=Math.max(0,Math.floor(minV*height)-2);
 const right=Math.min(width,Math.ceil(maxU*width)+2),bottom=Math.min(height,Math.ceil(maxV*height)+2);
 const rect={left,top,width:right-left,height:bottom-top};
 return {rect,uv:uv.map((v,i)=>(v*(i%2?height:width)-(i%2?top:left))/(i%2?rect.height:rect.width))};
}
