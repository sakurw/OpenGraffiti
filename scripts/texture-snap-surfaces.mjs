// Build real existing wall triangles for the independently registered SNAP image.
import {readFile,writeFile} from 'node:fs/promises';
import {BufferGeometry,Float32BufferAttribute,Vector3,Matrix4,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {triangulate,sub,cross,dot} from './plateau-geometry.mjs';
import {quadrant} from './plateau-surfaces.mjs';
import {loadSnapCase} from './texture-snap-case.mjs';
import {imageRegionFilter} from './texture-snap-image-regions.mjs';
const input=await loadSnapCase(),root='data/texture-city/registration',fit=JSON.parse(await readFile(`${root}/${input.caseId}.json`,'utf8'));
if(fit.buildingId!==input.buildingId||fit.sourceId!==input.sourceId||fit.areaId!==input.areaId)throw Error('Stale camera registration');
const g=JSON.parse(await readFile(input.geometryPath,'utf8'));
const b=g.buildings.find(b=>b.id===fit.buildingId);if(!b)throw Error('Building missing');
const rotationVector=new Vector3(...fit.rotationVector),rotation=new Matrix4().makeRotationAxis(rotationVector.clone().normalize(),rotationVector.length());
const translation=new Vector3(...fit.translationVector),cam=new Vector3(...fit.cameraPosition);
const k=fit.cameraMatrix;
const project=v=>{const p=new Vector3(...v).applyMatrix4(rotation).add(translation);return p.z>0?[k[0][0]*p.x/p.z+k[0][2],k[1][1]*p.y/p.z+k[1][2]]:null;};
const allowedImage=imageRegionFilter(input.imageRegions,fit.imageSize);
const imageBorder=input.surfaceImageBorderPixels??24,minimumPixelsPerMetre=input.minimumEffectivePixelsPerMetre??3;
const positions=[];for(const building of g.buildings)for(const p of building.polygons){const t=triangulate(p.rings.map(r=>r.points));for(const i of t.indices)positions.push(...t.points[i]);}
const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geometry),ray=new Ray(cam),direction=new Vector3();
function visible(p){direction.set(...p).sub(cam);const len=direction.length();ray.direction.copy(direction).normalize();return !bvh.raycastFirst(ray,DoubleSide,.05,len-.08);}
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
function* split(t,depth=0){const lengths=t.map((p,i)=>Math.hypot(...sub(p,t[(i+1)%3]))),max=Math.max(...lengths);if(max<=4||depth>=10){yield t;return;}const i=lengths.indexOf(max),a=t[i],b=t[(i+1)%3],c=t[(i+2)%3],m=mid(a,b);yield*split([a,m,c],depth+1);yield*split([m,b,c],depth+1);}
function above(points,height){const out=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ai=a[1]>=height,bi=b[1]>=height;if(ai)out.push(a);if(ai!==bi){const t=(height-a[1])/(b[1]-a[1]);out.push(a.map((v,k)=>v+t*(b[k]-v)));}}return out;}
const surfaces=[];let rejected=0,imageRegionRejected=0,borderRejected=0,occlusionRejected=0,resolutionRejected=0;
for(const wall of b.walls){
 const t=triangulate(wall.rings.map(r=>r.points));if(!t.indices.length)continue;
 const center=t.points[0].map((_,k)=>t.points.reduce((s,p)=>s+p[k],0)/t.points.length),view=sub(fit.cameraPosition,center);
 if(dot(t.normal,view)/Math.hypot(...view)<.3)continue;
 const triangles=[],pixelsPerMetre=[];let eligibleArea=0;
 for(let i=0;i<t.indices.length;i+=3){const clipped=above(t.indices.slice(i,i+3).map(j=>t.points[j]),input.minimumHeight);
  for(let j=1;j+1<clipped.length;j++)for(const tri of split([clipped[0],clipped[j],clipped[j+1]])){
   const worldArea=Math.hypot(...cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])))/2;if(worldArea<.01)continue;eligibleArea+=worldArea;
   const samples=[...tri,tri[0].map((_,k)=>tri.reduce((s,p)=>s+p[k],0)/3),...tri.map((p,k)=>mid(p,tri[(k+1)%3]))];
   const projected=samples.map(project);if(projected.some(uv=>!uv||uv[0]<imageBorder||uv[0]>fit.imageSize[0]-imageBorder||uv[1]<imageBorder||uv[1]>fit.imageSize[1]-imageBorder)){rejected++;borderRejected++;continue;}
   if(samples.some(p=>!visible(p))){rejected++;occlusionRejected++;continue;}
   if(!allowedImage(projected)){rejected++;imageRegionRejected++;continue;}
   const q=projected.slice(0,3),pixelArea=Math.abs((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2,ppm=Math.sqrt(pixelArea/worldArea);
   if(!Number.isFinite(ppm)||ppm<minimumPixelsPerMetre){rejected++;resolutionRejected++;continue;}
   triangles.push(tri);pixelsPerMetre.push(ppm);
  }
 }
 if(!triangles.length)continue;
 const origin=t.points[0],right=new Vector3(t.normal[2],0,-t.normal[0]).normalize().toArray(),up=cross(t.normal,right);
 const plane=v=>[dot(sub(v,origin),right),dot(sub(v,origin),up)],all=triangles.flat().map(plane);
 const bounds=[Math.min(...all.map(v=>v[0])),Math.max(...all.map(v=>v[0])),Math.min(...all.map(v=>v[1])),Math.max(...all.map(v=>v[1]))];
 const [lo,hi,bottom,top]=bounds,width=hi-lo,height=top-bottom;if(width<.02||height<.02)continue;
 const corners=[[lo,bottom],[hi,bottom],[hi,top],[lo,top]].map(([u,v])=>origin.map((x,k)=>x+right[k]*u+up[k]*v));
 const points=corners.map(project);if(points.some(p=>!p))continue;
 const area=triangles.reduce((s,tri)=>s+Math.hypot(...cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])))/2,0),sortedPpm=[...pixelsPerMetre].sort((a,b)=>a-b),q=quadrant(t.normal);
 surfaces.push({polygonId:wall.id,groupKey:`${fit.buildingId}|direction-${q}`,quadrant:q,normal:t.normal,positions:triangles.flat(2),uv:triangles.flat().flatMap(p=>{const [u,v]=plane(p);return [(u-lo)/width,(top-v)/height];}),width,height,imagePoints:points,area,eligibleArea,coverageRatio:eligibleArea?area/eligibleArea:0,effectivePixelsPerMetre:{min:sortedPpm[0],median:sortedPpm[Math.floor(sortedPpm.length/2)]}});
}
geometry.dispose();
await writeFile(`${root}/${fit.caseId}-surfaces.json`,JSON.stringify({fit,surfaces,minimumHeight:input.minimumHeight,imageBorder,minimumPixelsPerMetre,rejected,imageRegionRejected,borderRejected,occlusionRejected,resolutionRejected,acceptedOcclusionContradictions:0,imageRegions:input.imageRegions,registration:'estimated-unverified'}));
console.log({surfaces:surfaces.length,triangles:surfaces.reduce((s,p)=>s+p.positions.length/9,0),area:surfaces.reduce((s,p)=>s+p.area,0),rejected,borderRejected,occlusionRejected,imageRegionRejected,resolutionRejected,minimumPixelsPerMetre});
