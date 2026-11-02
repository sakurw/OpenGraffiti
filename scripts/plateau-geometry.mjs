import {SaxesParser} from 'saxes';
import proj4 from 'proj4';
import earcut from 'earcut';
export const CRS='+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
export const GEO='+proj=longlat +ellps=GRS80 +no_defs';
export function xml(text){let root;const stack=[];const p=new SaxesParser({xmlns:false});p.on('opentag',tag=>{const n={t:tag.name,a:tag.attributes,c:[],text:''};if(stack.length)stack.at(-1).c.push(n);else root=n;stack.push(n);});p.on('text',s=>{if(stack.length)stack.at(-1).text+=s;});p.on('closetag',()=>stack.pop());p.write(text).close();return root;}
export function descendants(n,t){const out=[];function walk(x){if(x.t===t)out.push(x);for(const c of x.c)walk(c);}walk(n);return out;}
export const first=(n,t)=>descendants(n,t)[0];
export const nums=s=>s.trim().split(/\s+/).map(Number);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>{const d=Math.hypot(...a);return d>1e-12?a.map(v=>v/d):[0,0,0];};
export const project=(lat,lon,z,origin)=>{const [e,n]=proj4(GEO,CRS,[lon,lat]);return [e-origin[0],z-origin[2],-(n-origin[1])].map(v=>Math.round(v*1000)/1000||0);};
export function frame(points){let normal=[0,0,0];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}normal=norm(normal);let u=norm(cross([0,1,0],normal));if(Math.hypot(...u)<.1)u=[1,0,0];const v=norm(cross(normal,u)),o=points[0];return {normal,u,v,o};}
export function triangulate(rings){const f=frame(rings[0]),flat=[],holes=[],points=[];for(let r=0;r<rings.length;r++){if(r)holes.push(points.length);for(const p of rings[r]){flat.push(dot(sub(p,f.o),f.u),dot(sub(p,f.o),f.v));points.push(p);}}let indices=earcut(flat,holes,2);for(let i=0;i<indices.length;i+=3){const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]];if(dot(cross(sub(b,a),sub(c,a)),f.normal)<0)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];}return {...f,points,indices,flat,deviation:earcut.deviation?earcut.deviation(flat,holes,2,indices):0};}
export function polygon(n,origin){const rings=descendants(n,'gml:LinearRing').map(r=>{const v=nums(first(r,'gml:posList')?.text||'');const points=[];for(let i=0;i<v.length;i+=3)points.push(project(v[i],v[i+1],v[i+2],origin));if(points.length>1&&Math.hypot(...sub(points[0],points.at(-1)))<.001)points.pop();return {id:r.a['gml:id'],points};});if(!rings.length||rings[0].points.length<3)return null;return {id:n.a['gml:id'],rings};}
