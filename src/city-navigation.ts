import * as T from 'three';
import type {MapControls} from 'three/addons/controls/MapControls.js';
export const PAN_METERS_PER_PIXEL=.75,ZOOM_METERS_PER_PIXEL=.3;
export function installCityNavigation(camera:T.PerspectiveCamera,controls:MapControls,element:HTMLCanvasElement,objects:T.Object3D[]){
 controls.enablePan=false;controls.enableZoom=false;controls.enableDamping=false;
 let drag:{id:number;x:number;y:number}|null=null;
 const ray=new T.Raycaster(),ndc=new T.Vector2();
 function pan(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={id:e.pointerId,x:e.clientX,y:e.clientY};
  camera.updateMatrixWorld();const right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0);right.y=0;right.normalize();const forward=new T.Vector3().crossVectors(new T.Vector3(0,1,0),right).normalize();
  const delta=right.multiplyScalar(-dx*PAN_METERS_PER_PIXEL).addScaledVector(forward,dy*PAN_METERS_PER_PIXEL);camera.position.add(delta);controls.target.add(delta);controls.update();
 }
 const down=(e:PointerEvent)=>{if(e.button===2){drag={id:e.pointerId,x:e.clientX,y:e.clientY};element.setPointerCapture(e.pointerId);}};
 const up=(e:PointerEvent)=>{if(drag?.id===e.pointerId)drag=null;};
 const wheel=(e:WheelEvent)=>{e.preventDefault();const rect=element.getBoundingClientRect();ndc.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);camera.updateMatrixWorld();ray.setFromCamera(ndc,camera);
  const hit=ray.intersectObjects(objects,false)[0],view=camera.getWorldDirection(new T.Vector3()),distance=camera.position.distanceTo(controls.target);
  const normalizing=e.deltaMode===1?16:e.deltaMode===2?rect.height:1;let move=-e.deltaY*normalizing*ZOOM_METERS_PER_PIXEL;
  if(move>0)move=Math.min(move,Math.max(0,(hit?.distance??distance)-2));
  const delta=ray.ray.direction.clone().multiplyScalar(move),nextDistance=T.MathUtils.clamp(distance-move*ray.ray.direction.dot(view),2,2200);
  if(hit)element.dataset.zoomAnchor=hit.point.toArray().join(',');
  camera.position.add(delta);controls.target.copy(camera.position).addScaledVector(view,nextDistance);controls.update();
 };
 element.addEventListener('pointerdown',down);element.addEventListener('pointermove',pan);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',up);element.addEventListener('wheel',wheel,{passive:false});
 return()=>{element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',pan);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',up);element.removeEventListener('wheel',wheel);};
}
