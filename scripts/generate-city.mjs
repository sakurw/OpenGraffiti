import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { walls } from '../shared/catalog.mjs';
// The fixture is original geometry, deliberately not labelled PLATEAU or LOD3.
globalThis.FileReader=class { readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});} };
const scene=new T.Group();scene.name='Original mock streetscape';
const mats={};
function mat(color){return mats[color]??=new T.MeshStandardMaterial({color,roughness:0.95});}
function box(x,y,z,w,h,d,color){const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);scene.add(m);return m;}
box(0,-.3,0,145,.5,125,'#cdd2c0');
box(0,0,3,140,.1,11,'#6a7771');box(-38,.03,0,9,.1,120,'#6a7771');box(39,.03,0,9,.1,120,'#6a7771');
box(0,.06,13,135,.15,6,'#dce0d0');box(0,.06,-5,135,.15,5,'#dce0d0');
for(let x=-65;x<68;x+=6)box(x,.08,3,2.8,.03,.14,'#e8e5cd');
for(let z=-3;z<10;z+=1.4){box(-34,.1,z,5,.02,.65,'#eeecdb');box(34,.1,z,5,.02,.65,'#eeecdb');}
for(let i=0;i<12;i++){
 const w=walls[i],x=w.position[0],z=w.position[2]-4;
 const height=6+(i*7%9);box(x,height/2,z,9,height,8,['#d6d6c8','#afbab1','#c5b9a6','#b0bdb5'][i%4]);
 box(x,height+.2,z,9.4,.4,8.4,'#e9e7d8');
 for(let y=6;y<height-1;y+=2)for(let dx=-3;dx<=3;dx+=2)box(x+dx,y,z+4.03,1.1,1.2,.08,'#728d89');
 box(x+2,height+.8,z,2,1.2,2,'#a5aea6');
 const overlay=new T.Mesh(new T.PlaneGeometry(8,4),new T.MeshBasicMaterial({color:'#d2d3c8',side:T.FrontSide}));
 const uv=overlay.geometry.getAttribute('uv');for(let j=0;j<uv.count;j++)uv.setY(j,1-uv.getY(j));
 overlay.name=w.id;overlay.position.set(...w.position);overlay.position.z+=.002;overlay.userData={openGraffiti:{wallId:w.id}};scene.add(overlay);
}
for(let i=0;i<24;i++){const x=-62+(i%8)*17,z=i<8?-39:i<16?42:57,h=8+(i*13%23);box(x,h/2,z,10+(i%3)*2,h,9,'#bac4b9');box(x,h+.2,z,11+(i%3)*2,.4,10,'#dde0d2');}
function rod(a,b,r,color){const dir=new T.Vector3().subVectors(b,a),m=new T.Mesh(new T.CylinderGeometry(r,r,dir.length(),6),mat(color));m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize());scene.add(m);}
const towerX=15,towerZ=-37;
for(let level=0;level<5;level++){const y1=level*9,y2=(level+1)*9,r1=8*(1-level/6),r2=8*(1-(level+1)/6),color=level%2?'#e9e5d9':'#e47652';for(let k=0;k<4;k++){const a=k*Math.PI/2+Math.PI/4,b=(k+1)*Math.PI/2+Math.PI/4;const v=(r,y,t)=>new T.Vector3(towerX+Math.cos(t)*r,y,towerZ+Math.sin(t)*r);rod(v(r1,y1,a),v(r2,y2,a),.35,color);rod(v(r1,y1,a),v(r2,y2,b),.15,color);rod(v(r1,y1,b),v(r2,y2,a),.15,color);rod(v(r2,y2,a),v(r2,y2,b),.22,color);}}
box(towerX,27,towerZ,7,2.2,7,'#eee8d4');rod(new T.Vector3(towerX,45,towerZ),new T.Vector3(towerX,58,towerZ),.4,'#e57655');
for(let i=0;i<24;i++){const x=-64+(i%12)*11.5,z=i<12?24:-22;box(x,1.2,z,.35,2.4,.35,'#788374');const tree=new T.Mesh(new T.IcosahedronGeometry(2.3,1),mat(i%2?'#829b7a':'#97ad81'));tree.position.set(x,3.7,z);scene.add(tree);}
for(let i=0;i<8;i++){box(-25+i*8,.6,2,3,1.1,1.5,['#e9d6b2','#b4c9c2','#eee8de'][i%3]);box(-25+i*8,1.3,2,1.6,.5,1.3,'#a3b7b1');}
await mkdir('public/models',{recursive:true});
const glb=await new GLTFExporter().parseAsync(scene,{binary:true});
await writeFile('public/models/mock-city.glb',Buffer.from(glb));
console.log(`Generated original mock-city.glb: ${glb.byteLength} bytes, 12 wall primitives`);
