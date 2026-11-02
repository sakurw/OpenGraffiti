import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
import sharp from 'sharp';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {triangulate,CRS,GEO} from './plateau-geometry.mjs';

// Per-polygon building color inference. GPS/heading candidates are never
// described as registered facade photos. GSI tile pixels are roof-only priors.
const output='public/assets/universal-all-areas';
await mkdir(output,{recursive:true});
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const mix=(a,b,w)=>a.map((x,i)=>x*w+b[i]*(1-w));
const median=values=>{const sorted=values.sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const haversine=(a,b)=>{const r=Math.PI/180,dlat=(b[0]-a[0])*r,dlon=(b[1]-a[1])*r,x=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlon/2)**2;return 12742000*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
const tile=(lat,lon,z=18)=>{const n=2**z,x=(lon+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;return {z,x:Math.floor(x),y:Math.floor(y),px:(x%1)*256,py:(y%1)*256};};
const tileCache=new Map();
const sourceRoot='data/texture-city/universal-all-buildings';
const visibilityPath='test-results/universal-all-ground-visibility-audit.json';
const visibilityAudit=existsSync(visibilityPath)?JSON.parse(await readFile(visibilityPath,'utf8')):null;
const visibilityByArea=new Map((visibilityAudit?.areas??[]).map(a=>[a.area,new Map(a.buildings.map(b=>[b.buildingId,new Map(b.images.map(i=>[String(i.imageId),i]))]))]));
await mkdir(`${sourceRoot}/gsi`,{recursive:true});
async function roofPixel(lat,lon){
  const t=tile(lat,lon),key=`${t.z}-${t.x}-${t.y}`;
  if(!tileCache.has(key))tileCache.set(key,(async()=>{
    for(const layer of ['ort','seamlessphoto']){
      const file=`${sourceRoot}/gsi/${layer}-${key}.jpg`;
      try{
        let data;
        if(existsSync(file))data=await readFile(file);
        else{
          const response=await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${t.z}/${t.x}/${t.y}.jpg`,{signal:AbortSignal.timeout(7000)});
          if(!response.ok)continue;
          data=Buffer.from(await response.arrayBuffer());
          await writeFile(file,data);
        }
        const raw=await sharp(data).resize(256,256).removeAlpha().raw().toBuffer();
        return {raw,file,layer};
      }catch{}
    }
    return null;
  })());
  const entry=await tileCache.get(key);if(!entry)return null;
  const rgb=[];
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const x=clamp(Math.floor(t.px)+dx,0,255),y=clamp(Math.floor(t.py)+dy,0,255),i=(y*256+x)*3;
    const v=[entry.raw[i],entry.raw[i+1],entry.raw[i+2]].map(v=>v/255);
    if(Math.min(...v)>.045&&Math.max(...v)<.96)rgb.push(v);
  }
  if(!rgb.length)return null;
  const color=[0,1,2].map(c=>median(rgb.map(r=>r[c])));
  // Reduce color cast, and mildly flatten illumination.
  const lum=color[0]*.2126+color[1]*.7152+color[2]*.0722;
  return {color:mix(color,[lum,lum,lum],.86),file:entry.file,layer:entry.layer};
}
const priorReport=JSON.parse(await readFile('data/texture-city/universal-ten-buildings/source-maximized.json','utf8'));
const groundDonors=priorReport.buildings.filter(b=>b.inference?.groundCorrectedConsensus?.rgb).map(b=>({point:[b.position.lat,b.position.lon],color:b.inference.groundCorrectedConsensus.rgb,sources:b.inference.groundCorrectedConsensus.sourceCount??0,buildingId:b.buildingId}));
const photoColors=new Map();
const photoRoot='data/texture-city/universal-ten-buildings/images/mapillary';
async function photoColor(id){
 if(photoColors.has(id))return photoColors.get(id);
 const image=`${photoRoot}/${id}.jpg`;
 if(!existsSync(image)){photoColors.set(id,null);return null;}
 try{
  const metadata=await sharp(image).metadata();
  const crop={left:Math.floor(metadata.width*.22),top:Math.floor(metadata.height*.28),width:Math.max(1,Math.floor(metadata.width*.56)),height:Math.max(1,Math.floor(metadata.height*.45))};
  const {data,info}=await sharp(image).extract(crop).resize(48,48).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const pixels=[];
  for(let i=0;i<data.length;i+=info.channels){
   const c=[data[i],data[i+1],data[i+2]].map(v=>v/255),l=c[0]*.2126+c[1]*.7152+c[2]*.0722;
   if(l<.13||l>.88||c[2]>c[0]*1.2&&c[2]>c[1]*1.1||c[1]>c[0]*1.25&&c[1]>c[2]*1.1)continue;
   pixels.push(c);
  }
  const result=pixels.length>=160?[0,1,2].map(k=>median(pixels.map(p=>p[k]))):null;
  photoColors.set(id,result);return result;
 }catch{photoColors.set(id,null);return null;}
}
function photoConsensus(candidates){
 // A weak neighborhood albedo estimate, never a certified facade color.
 if(candidates.length<2)return null;
 const totalWeight=candidates.reduce((sum,c)=>sum+c.weight,0);
 const rgb=[0,1,2].map(k=>{const ordered=[...candidates].sort((a,b)=>a.rgb[k]-b.rgb[k]);let cumulative=0;for(const c of ordered){cumulative+=c.weight;if(cumulative>=totalWeight/2)return c.rgb[k];}return ordered.at(-1).rgb[k];});
 const disagreement=candidates.reduce((sum,c)=>sum+c.weight*Math.sqrt(c.rgb.reduce((v,n,k)=>v+(n-rgb[k])**2,0)),0)/totalWeight;
 if(disagreement>.32)return null;
 return {rgb,disagreement,imageIds:candidates.map(c=>c.imageId),candidateAssessments:candidates.map(c=>({imageId:c.imageId,assessment:c.assessment,weight:c.weight})),unobstructedCandidates:candidates.filter(c=>c.assessment==='no-bbox-occluder-found').length};
}
const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);
const manifest={method:'universal-building-per-polygon-v3-ground-photo-candidate-estimation',generatedAt:new Date().toISOString(),scope:'all buildings in two PLATEAU geometry extracts',limitations:['Ground-image color estimates are based on unregistered geographic image candidates. Actual facade identity, occlusion and camera geometry are not certified. These remain low-confidence neighborhood proxies.','GSI coordinate samples provide roof context, not registered wall texture.','Original PLATEAU texture appearance remains in the baseline and appearance-stabilized comparison models. This inferred-color model reconstructs PLATEAU polygon geometry with vertex colors; original GLB UV and texture detail are not transferred.'],areas:[]};
for(const [areaId,geometryPath] of [['tocho','data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json'],['tokyo-tower','data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json']]){
 const geometry=JSON.parse(await readFile(geometryPath,'utf8'));
 const discoveryFile=`${sourceRoot}/ground/${areaId}-discovery.json`;
 const discovery=existsSync(discoveryFile)?JSON.parse(await readFile(discoveryFile,'utf8')):null;
 const candidateById=new Map(discovery?.buildings.map(b=>[b.buildingId,b.candidates])??[]);
 const areaVisibility=visibilityByArea.get(areaId)??new Map();
 const document=new Document(),buffer=document.createBuffer(),scene=document.createScene(areaId),unlit=document.createExtension(KHRMaterialsUnlit);
 const material=document.createMaterial('universal-vertex-albedo').setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
 const summary={buildings:0,polygons:0,triangles:0,groundNeighborhoodInference:0,photoCandidateColorInference:0,gsiRoofInference:0,plateauSemanticInference:0,attributePriorFallback:0,failedTriangulations:0,missingSurfaces:0};
 const report=[];
 for(const building of geometry.buildings){
   const center=[0,1,2].map(i=>(building.min[i]+building.max[i])/2);
   const [lon,lat]=proj4(CRS,GEO,[center[0]+geometry.origin[0],geometry.origin[1]-center[2]]);
   const roof=await roofPixel(lat,lon);
   const donor=groundDonors.map(d=>({...d,distance:haversine([lat,lon],d.point)})).sort((a,b)=>a.distance-b.distance)[0];
   const wallEvidence=donor?.distance<=170?donor:null;
   const imageCandidates=[];
   const imageAssessments=areaVisibility.get(building.id)??new Map();
   const rankedCandidates=(candidateById.get(building.id)??[]).filter(c=>c.distanceMetres<=110&&c.score>=.18).map(c=>{
     const assessment=imageAssessments.get(String(c.imageId))?.assessment??'not-screened';
     const weight=Math.max(.05,c.score)*(assessment==='potential-bbox-occlusion'?.30:assessment==='no-bbox-occluder-found'?1:.45);
     return {...c,assessment,weight};
   }).sort((a,b)=>b.weight-a.weight);
   for(const candidate of rankedCandidates.slice(0,8)){
    const rgb=await photoColor(candidate.imageId);
    if(rgb)imageCandidates.push({imageId:candidate.imageId,rgb,score:candidate.score,weight:candidate.weight,assessment:candidate.assessment});
   }
   const imageEstimate=photoConsensus(imageCandidates);
   const height=building.max[1]-building.min[1],walls=new Set(building.walls.map(w=>w.id));
   const positions=[],colors=[],indices=[],records=[];
   for(const polygon of building.polygons){
     let shape;try{shape=triangulate(polygon.rings.map(r=>r.points));}catch{summary.failedTriangulations++;continue;}
     if(!shape.indices.length){summary.failedTriangulations++;continue;}
     const isWall=walls.has(polygon.id);
     const isRoof=!isWall&&Math.abs(shape.normal[1])>.47;
     const isEquipment=!isWall&&!isRoof;
     let rgb,provenance,confidence,sourceImage;
     if(isWall&&imageEstimate){rgb=imageEstimate.rgb;provenance='unregistered-multiple-ground-photo-color-inference';confidence=clamp(.30-imageEstimate.disagreement*.30,.17,.30);sourceImage=imageEstimate.imageIds;summary.photoCandidateColorInference++;}
     else if(isWall&&wallEvidence){rgb=wallEvidence.color;provenance='external-ground-neighborhood-color-inference';confidence=clamp(.38*(1-wallEvidence.distance/220),.12,.38);sourceImage=`pilot:${wallEvidence.buildingId}`;summary.groundNeighborhoodInference++;}
     else if(isRoof&&roof){rgb=roof.color;provenance='gsi-coordinate-roof-color-inference';confidence=.43;sourceImage=roof.file;summary.gsiRoofInference++;}
     else if(isEquipment&&roof){rgb=mix(roof.color,[.46,.48,.48],.62);provenance='gsi-context-equipment-attribute-inference';confidence=.29;sourceImage=roof.file;summary.plateauSemanticInference++;}
     else if(isWall){rgb=height>24?[.60,.63,.64]:[.66,.65,.62];provenance='wall-attribute-color-prior';confidence=.17;sourceImage=null;summary.attributePriorFallback++;}
     else {rgb=isEquipment?[.47,.48,.47]:[.58,.59,.56];provenance=isEquipment?'equipment-attribute-color-prior':'roof-attribute-color-prior';confidence=.16;sourceImage=null;summary.attributePriorFallback++;}
     const start=positions.length/3;
     for(const point of shape.points){positions.push(...point);colors.push(...rgb.map(v=>clamp(v)));}
     indices.push(...shape.indices.map(i=>start+i));
     records.push({polygonId:polygon.id,semanticClass:isWall?'WallSurface':isRoof?'RoofSurface':'OuterBuildingInstallation',provenance,confidence,sourceImage,directlyObserved:false});
     summary.polygons++;summary.triangles+=shape.indices.length/3;
   }
   if(positions.length){
     const accessor=(name,type,values,ArrayType)=>document.createAccessor(name).setType(type).setArray(new ArrayType(values)).setBuffer(buffer);
     const primitive=document.createPrimitive().setAttribute('POSITION',accessor('positions','VEC3',positions,Float32Array)).setAttribute('COLOR_0',accessor('colors','VEC3',colors,Float32Array)).setIndices(accessor('indices','SCALAR',indices,Uint32Array)).setMaterial(material);
     const node=document.createNode(building.id).setMesh(document.createMesh(building.id).addPrimitive(primitive)).setExtras({buildingId:building.id,center,polygonCount:records.length});scene.addChild(node);
   }
   report.push({buildingId:building.id,position:{lat,lon},roofImage:roof?.file??null,groundPhotoEstimate:imageEstimate?{rgb:imageEstimate.rgb,imageIds:imageEstimate.imageIds,disagreement:imageEstimate.disagreement,registration:'unverified-neighborhood-proxy',candidateAssessments:imageEstimate.candidateAssessments,unobstructedCandidates:imageEstimate.unobstructedCandidates}:null,groundDonor:wallEvidence?{buildingId:wallEvidence.buildingId,distanceMetres:wallEvidence.distance,photoCount:wallEvidence.sources}:null,polygons:records});
   summary.buildings++;
   if(summary.buildings%250===0)console.log(`${areaId}: ${summary.buildings}/${geometry.buildings.length}`);
 }
 const model=`${output}/${areaId}-building-inferred.glb`;
 await io.write(model,document);
 const evidenceFile=`${output}/${areaId}-building-evidence.json`;
 await writeFile(evidenceFile,JSON.stringify({areaId,summary,buildings:report}));
 manifest.areas.push({areaId,buildingCount:geometry.buildings.length,model:`/assets/universal-all-areas/${areaId}-building-inferred.glb`,evidence:`/assets/universal-all-areas/${areaId}-building-evidence.json`,summary});
 console.log(JSON.stringify({areaId,summary}));
}
await writeFile(`${output}/per-building-report.json`,JSON.stringify(manifest,null,2));
