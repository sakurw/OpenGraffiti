import sharp from 'sharp';
export async function packAtlas(paths,root,save,area){
 const size=2048,pad=4,items=[];
 for(const image of paths){const info=await sharp(root+'/'+image).metadata();const ratio=Math.min(1,512/Math.max(info.width,info.height));items.push({image,width:Math.max(1,Math.round(info.width*ratio)),height:Math.max(1,Math.round(info.height*ratio)),originalWidth:info.width,originalHeight:info.height});}
 items.sort((a,b)=>b.height-a.height||a.image.localeCompare(b.image));
 const pages=[];let page={items:[],x:0,y:0,row:0};pages.push(page);const map=new Map();
 for(const item of items){const w=item.width+pad*2,h=item.height+pad*2;if(page.x+w>size){page.x=0;page.y+=page.row;page.row=0;}if(page.y+h>size){page={items:[],x:0,y:0,row:0};pages.push(page);}const placed={...item,x:page.x+pad,y:page.y+pad,page:pages.length-1};page.items.push(placed);map.set(item.image,placed);page.x+=w;page.row=Math.max(page.row,h);}
 const buffers=[];for(let i=0;i<pages.length;i++){const inputs=[];for(const item of pages[i].items){const input=await sharp(root+'/'+item.image).resize(item.width,item.height).extend({top:pad,bottom:pad,left:pad,right:pad,extendWith:'copy'}).png().toBuffer();inputs.push({input,left:item.x-pad,top:item.y-pad});}
  const bytes=await sharp({create:{width:size,height:size,channels:3,background:'#b8bab2'}}).composite(inputs).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();await save('textures/'+area+'-atlas-'+i+'.jpg',bytes);buffers.push(bytes);
 }
 return {map,buffers,size,pages:pages.length,resized:items.filter(i=>i.width!==i.originalWidth||i.height!==i.originalHeight)};
}
