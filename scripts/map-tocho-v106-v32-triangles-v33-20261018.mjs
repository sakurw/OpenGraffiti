/** Read-only geometry provenance map across v106 and v32 primitive splits. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';

const asset=path.resolve('public/assets/tocho-landmark');
const folder=path.resolve('data/texture-city/tocho-style-pilot-20261015/v33-diagnostics-20261018');
const sources={
  v106:'tocho-landmark-balanced-edges-v106-candidate-20261014.glb',
  v32:'tocho-stylized-full-pixel-v32-20261018.glb',
};
const output=path.join(folder,'v106-to-v32-position-face-map-v33.json');
if(fs.existsSync(output))throw Error('Refusing overwrite: '+output);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const [a,b]=await Promise.all(Object.values(sources).map(name=>io.read(path.join(asset,name))));
const parts=x=>x.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const A=parts(a),B=parts(b);
const key3=(arr,index)=>[Math.round(arr[3*index]*1000),Math.round(arr[3*index+1]*1000),Math.round(arr[3*index+2]*1000)].join(',');
function facetKey(keys){return [...keys].sort().join('|')}
const catalog=new Map(),sourceRecords=[],targetRecords=[],bySource=[],byTarget=[];
for(let id=0;id<A.length;id++){
  const p=A[id],P=p.getAttribute('POSITION')?.getArray(),T=p.getAttribute('TEXCOORD_0')?.getArray();
  const inds=p.getIndices()?.getArray()??Uint32Array.from({length:P.length/3},(_,i)=>i);
  const srcRec={id,triangles:inds.length/3,unique:0,duplicateTriangles:0};
  for(let j=0;j<inds.length;j+=3){
    const v=[inds[j],inds[j+1],inds[j+2]],vertices=v.map(k=>key3(P,k));
    const key=facetKey(vertices),arr=catalog.get(key)||[];
    if(arr.length)srcRec.duplicateTriangles++;
    else srcRec.unique++;
    arr.push({id,face:j/3,vertices,
      uv:T?v.map(k=>[T[2*k],T[2*k+1]]):null});
    catalog.set(key,arr);
  }
  sourceRecords.push(srcRec);
}
let match=0,miss=0,ambig=0,exactUV=0,nearUV=0,uvComparisons=0;
const unmatchedSamples=[],ambigSamples=[],matchedSamples=[];
for(let id=0;id<B.length;id++){
  const p=B[id],P=p.getAttribute('POSITION')?.getArray(),T=p.getAttribute('TEXCOORD_0')?.getArray();
  const inds=p.getIndices()?.getArray()??Uint32Array.from({length:P.length/3},(_,i)=>i);
  const counts=new Map(),record={id,role:p.getExtras()?.semantic??'unknown',triangles:inds.length/3,
    matched:0,unmatched:0,ambiguous:0,uniqueSourceIds:[],sources:[],sameUV:0,nearUV:0,uvCompared:0};
  const targetMap=[];
  for(let j=0;j<inds.length;j+=3){
    const v=[inds[j],inds[j+1],inds[j+2]],keys=v.map(k=>key3(P,k));
    const opts=catalog.get(facetKey(keys));
    if(!opts){record.unmatched++;miss++;if(unmatchedSamples.length<30)unmatchedSamples.push({id,face:j/3,keys});continue;}
    record.matched++;match++;
    if(opts.length>1){record.ambiguous++;ambig++;if(ambigSamples.length<12)ambigSamples.push({id,face:j/3,candidates:opts.map(o=>[o.id,o.face])});}
    const best=opts[0],stat=counts.get(best.id)??{id:best.id,faces:0,unique:0,ambiguous:0,uvSame:0,uvNear:0};
    stat.faces++;if(opts.length===1)stat.unique++;else stat.ambiguous++;
    if(T&&best.uv){
      const lookup=new Map(best.vertices.map((k,kk)=>[k,best.uv[kk]]));
      const diff=keys.map((k,kk)=>[T[2*v[kk]],T[2*v[kk]+1]].map((vv,d)=>Math.abs(vv-lookup.get(k)[d]))).flat();
      const max=Math.max(...diff);record.uvCompared++;uvComparisons++;
      if(max<1e-6){record.sameUV++;stat.uvSame++;exactUV++}
      if(max<.002){record.nearUV++;stat.uvNear++;nearUV++;}
    }
    counts.set(best.id,stat);
    if(matchedSamples.length<15)matchedSamples.push({target:[id,j/3],source:[best.id,best.face],sameUV:stat.uvSame>0});
  }
  record.sources=[...counts.values()].sort((x,y)=>y.faces-x.faces);
  record.uniqueSourceIds=record.sources.map(s=>s.id);
  record.matchRate=+(record.matched/record.triangles*100).toFixed(3);
  targetRecords.push(record);
}
const outputData={version:'v33-geometry-provenance',createdAt:new Date().toISOString(),
  sourceFiles:sources,hashes:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,sha(fs.readFileSync(path.join(asset,v)))])),
  note:'Triangles compared by sorted vertex POSITION rounded to 0.001 world units; duplicate matches cannot be treated as unique UV ownership.',
  sources:sourceRecords,targets:targetRecords,
  totals:{sourcePrimitives:A.length,sourceTriangles:sourceRecords.reduce((n,r)=>n+r.triangles,0),
    targetPrimitives:B.length,targetTriangles:match+miss,matched:match,unmatched:miss,ambiguous:ambig,
    matchingRate:+(match/(match+miss)*100).toFixed(3),exactUV,nearUV,uvComparisons},
  unmatchedSamples,ambigSamples,matchedSamples};
fs.writeFileSync(output,JSON.stringify(outputData,null,2));
console.log(JSON.stringify({output,totals:outputData.totals,
  targets:targetRecords.map(({id,role,triangles,matched,ambiguous,matchRate,sources})=>({id,role,triangles,matched,ambiguous,matchRate,top:sources.slice(0,3)}))}));
