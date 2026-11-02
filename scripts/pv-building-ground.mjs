import cdt2d from 'cdt2d';
import cleanPSLG from 'clean-pslg';
// Elevated connector 5da56097 crosses lower native bottom faces (~14m separation).
// A single walkable ground cannot meet both levels; preserve that original elevated structure.
// Constraints come from original bottom faces, not axis-aligned building boxes.
export function buildingGround(source,manifest,field,fallback){
 const by=new Map(manifest.buildings.flatMap(b=>b.parts.map(p=>[p,b]))),floors=[],contacts=[];
 for(const mesh of source.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
  const b=by.get(p.getMaterial().getExtras().partKey);if(!b||b.id==='bldg_5da56097-5f78-481b-bcb6-a50a2d6aaad1')continue;const a=p.getAttribute('POSITION').getArray(),ix=p.getIndices()?.getArray(),vertices=ix?Array.from(ix,i=>Array.from(a.slice(i*3,i*3+3))).flat():a;
  for(let i=0;i<vertices.length;i+=9){if(Math.max(vertices[i+1],vertices[i+4],vertices[i+7])>b.bounds[1]+.1)continue;const t=[0,3,6].map(j=>Array.from(vertices.slice(i+j,i+j+3))),area=(t[1][0]-t[0][0])*(t[2][2]-t[0][2])-(t[1][2]-t[0][2])*(t[2][0]-t[0][0]);if(Math.abs(area)<1e-5)continue;floors.push({id:b.id,t,area});contacts.push({id:b.id,triangle:t});
  }
 }
 const points=[],edges=[],add=p=>{points.push([p[0],p[2]]);return points.length-1;};
 // 8m background spacing plus exact footprint edges: fewer faces than the old 4m grid.
 const x0=field.minX,z0=field.minZ,x1=x0+field.nx*field.step,z1=z0+field.nz*field.step;
 for(let z=z0;z<=z1;z+=8)for(let x=x0;x<=x1;x+=8)points.push([x,z]);
 const outer=[[x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1]].map(add);outer.forEach((v,i)=>edges.push([v,outer[(i+1)%4]]));
 for(const {t} of floors){const ids=t.map(add);ids.forEach((v,i)=>edges.push([v,ids[(i+1)%3]]));}

 const bins=new Map(),binSize=64;
 if(floors.length>1000)for(const floor of floors){const xs=floor.t.map(p=>p[0]),zs=floor.t.map(p=>p[2]);for(let z=Math.floor((Math.min(...zs)-128)/binSize);z<=Math.floor((Math.max(...zs)+128)/binSize);z++)for(let x=Math.floor((Math.min(...xs)-128)/binSize);x<=Math.floor((Math.max(...xs)+128)/binSize);x++){const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(floor);}}
 function anchored(x,z){let inside=Infinity,nearest=Infinity,edgeHeight=0;const perBuilding=new Map();for(const {id,t,area} of (bins.size?bins.get(Math.floor(x/binSize)+','+Math.floor(z/binSize))||[]:floors)){const [a,b,c]=t,u=((b[0]-x)*(c[2]-z)-(b[2]-z)*(c[0]-x))/area,v=((c[0]-x)*(a[2]-z)-(c[2]-z)*(a[0]-x))/area,w=1-u-v;if(u>=-1e-7&&v>=-1e-7&&w>=-1e-7)inside=Math.min(inside,u*a[1]+v*b[1]+w*c[1]);for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],dx=b[0]-a[0],dz=b[2]-a[2],q=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1))),d=Math.hypot(x-a[0]-q*dx,z-a[2]-q*dz);const old=perBuilding.get(id);if(!old||d<old.d)perBuilding.set(id,{d,y:a[1]+q*(b[1]-a[1])});if(d<nearest-1e-7||(Math.abs(d-nearest)<1e-7&&a[1]+q*(b[1]-a[1])<edgeHeight)){nearest=d;edgeHeight=a[1]+q*(b[1]-a[1]);}}}if(Number.isFinite(inside))return inside;if(!perBuilding.size||nearest>=32)return fallback(x,z);const neighbors=[...perBuilding.values()].sort((a,b)=>a.d-b.d).slice(0,6);let sum=0,weight=0;for(const p of neighbors){const w=1/(p.d+.0001)**4;sum+=p.y*w;weight+=w;}edgeHeight=sum/weight;const blend=Math.min(1,nearest/32),smooth=blend*blend*(3-2*blend);return edgeHeight*(1-smooth)+fallback(x,z)*smooth;}
 cleanPSLG(points,edges);const cells=cdt2d(points,edges,{exterior:true,interior:true});
 const vertices=points.flatMap(([x,z])=>[x,anchored(x,z),z]);
 // cdt2d is CCW in x/z; reverse winding for upward-facing x/y/z triangles.
 return {vertices,triangles:cells.flatMap(t=>[t[0],t[2],t[1]]),contacts,floorTriangles:floors.length};
}
