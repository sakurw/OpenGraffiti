import type {Manifest} from './pv-data';
import type {SurfaceField} from './pv-ground';
export interface FlatLayout {mode:'flat';height:number;minX:number;minZ:number;step:number;nx:number;nz:number;offsets:Record<string,number>;sourceModelSha256:string}
export function flatManifest(source:Manifest,layout:FlatLayout):Manifest{
 if(layout.sourceModelSha256!==source.modelSha256)throw Error('平坦化設定と建物モデルが一致しません。');
 const buildings=source.buildings.map(b=>{const offset=layout.offsets[b.id],bounds=[...b.bounds];if(!Number.isFinite(offset))throw Error('建物の平坦化設定が不足しています。');bounds[1]+=offset;bounds[4]+=offset;return {...b,bounds};}),bounds=source.bounds.map(b=>[...b]);bounds[0][1]=Math.min(...buildings.map(b=>b.bounds[1]));bounds[1][1]=Math.max(...buildings.map(b=>b.bounds[4]));
 return {...source,buildings,bounds,layout};
}
export function flatSurface(layout:FlatLayout):SurfaceField{
 const {minX:x,minZ:z,step,nx,nz,height:y}=layout,X=x+step*nx,Z=z+step*nz;
 return {version:6,minX:x,minZ:z,step,nx,nz,heights:Array((nx+1)*(nz+1)).fill(y),vertices:[x,y,z,X,y,z,x,y,Z,X,y,Z],triangles:[0,2,1,1,2,3]};
}
