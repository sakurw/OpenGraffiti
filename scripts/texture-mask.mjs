// Binary masks need one bit per pixel, not a resident byte for every photograph.
export function packMask(data){
 const bits=new Uint8Array(Math.ceil(data.length/8));
 for(let i=0;i<data.length;i++)if(data[i]>=200)bits[i>>>3]|=1<<(i&7);
 return bits;
}
export function maskContains(bits,index){return (bits[index>>>3]&(1<<(index&7)))!==0;}
