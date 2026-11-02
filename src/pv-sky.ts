import * as T from 'three';
// A static daytime backdrop. No image fetch, animation or scene lighting changes.
export function createSky(){
 const material=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,depthTest:false,toneMapped:false,vertexShader:`varying vec3 vSkyPosition;void main(){vec4 world=modelMatrix*vec4(position,1.0);vSkyPosition=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,fragmentShader:`varying vec3 vSkyPosition;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){vec3 d=normalize(vSkyPosition-cameraPosition);float h=pow(max(d.y,0.0),.5);vec3 color=mix(vec3(.53,.70,.81),vec3(.14,.38,.66),h);vec2 uv=d.xz/max(d.y+.25,.25)*2.5;float n=noise(uv)*.65+noise(uv*2.1)*.35;float clouds=smoothstep(.58,.78,n)*smoothstep(.03,.22,d.y);color=mix(color,vec3(.90,.94,.96),clouds*.8);vec3 sun=normalize(vec3(-.65,.7,-.25));float glow=pow(max(dot(d,sun),0.0),64.0);color=mix(color,vec3(.97,.94,.80),glow*.65);gl_FragColor=vec4(color,1.0);#include <colorspace_fragment>
}`.replace(';#include',';\n#include')});
 const sky=new T.Mesh(new T.SphereGeometry(8000,16,8),material);sky.frustumCulled=false;sky.renderOrder=-10;return sky;
}
