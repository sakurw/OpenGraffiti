import * as T from 'three';
// Meter-scale procedural material detail. Source geometry and coverage stay intact.
export const groundDetailGLSL=`
float pvHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float pvNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(pvHash(i),pvHash(i+vec2(1.,0.)),f.x),mix(pvHash(i+vec2(0.,1.)),pvHash(i+vec2(1.)),f.x),f.y);}
vec3 pvSurfaceDetail(vec3 color,vec3 world,float road){
 vec2 p=world.xz;float footprint=max(length(fwidth(p)),.001);
 float aggregate=pvHash(floor(p*180.))-.5,stone=pvNoise(p*3.)-.5;
 float fine=1.-smoothstep(.002,.018,footprint);
 vec3 asphalt=color*(1.+aggregate*.13*fine+stone*.035*(1.-smoothstep(.1,.6,footprint)));
 vec2 tile=p/vec2(.6,.3);tile.x+=mod(floor(tile.y),2.)*.5;
 vec2 edge=min(fract(tile),1.-fract(tile))*vec2(.6,.3),aa=max(fwidth(p),vec2(.001));
 float joint=1.-smoothstep(.003,.003+max(aa.x,aa.y),min(edge.x,edge.y));
 float tileVariation=pvHash(floor(tile))-.5;
 vec3 paving=color*(1.+tileVariation*.065*(1.-smoothstep(.06,.4,footprint))+aggregate*.06*fine);
 paving*=1.-joint*.15*(1.-smoothstep(.12,.5,footprint));
 return mix(paving,asphalt,road);
}
`;
export function detailedSoilMaterial(){const m=new T.MeshBasicMaterial({color:'#67736e',side:T.DoubleSide});m.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 pvSoilWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\npvSoilWorld=(modelMatrix*vec4(transformed,1.)).xyz;');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 pvSoilWorld;'+groundDetailGLSL).replace('#include <color_fragment>','#include <color_fragment>\nfloat strata=pvNoise(vec2(pvSoilWorld.x*.08,pvSoilWorld.y*.7));diffuseColor.rgb*=.96+strata*.08;');};m.customProgramCacheKey=()=> 'pv-soil-detail-v1';return m;}
