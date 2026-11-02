// A trajectory tangent is a hypothesis for a forward-facing vehicle camera,
// never a replacement for measured camera orientation or image registration.
export function angularDifference(a,b){return ((a-b+540)%360+360)%360-180;}
function point(p){
 if(!p||typeof p!=='object')return null;
 if(p.lat===null||p.lng===null||p.lat===''||p.lng==='')return null;
 const lat=Number(p.lat),lng=Number(p.lng);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?[lng,lat]:null;
}
function relativeTime(p){
 // Z is used solely to compute differences between timezone-less values in
 // one sequence, not to claim that their original timestamps were UTC.
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(p?.shotDate||''))return NaN;
 return Date.parse(p.shotDate.replace(' ','T')+'Z');
}
function vector(a,b){return [(b[0]-a[0])*111320*Math.cos((a[1]+b[1])/2*Math.PI/180),(b[1]-a[1])*111320];}
const bearing=v=>(Math.atan2(v[0],v[1])*180/Math.PI+360)%360;
export function motionHeading(sequence,index){
 if(!Array.isArray(sequence)||!Number.isInteger(index)||index<0||index>=sequence.length)return {status:'unavailable',reason:'invalid-sequence-index'};
 const current=sequence[index],p=point(current),now=relativeTime(current);
 const unknown=reason=>({status:'unavailable',reason});
 if(!p||!Number.isFinite(now))return unknown('invalid-position-or-relative-time');
 const neighbours=[];
 for(const step of [-1,1]){
  let found=null;
  for(let i=index+step;i>=0&&i<sequence.length;i+=step){
   const item=sequence[i];if(item.sequenceId!==current.sequenceId)break;
   const q=point(item),dt=step*(relativeTime(item)-now);
   if(!q||!Number.isFinite(dt))continue;
   if(dt<=0)continue;if(dt>15000)break;
   const distance=Math.hypot(...vector(p,q));
   if(distance>100)break;
   if(distance>=20){found={item,point:q,distance,seconds:dt/1000};break;}
  }
  if(!found)return unknown('no-20m-neighbour-within-15s');neighbours.push(found);
 }
 const [before,after]=neighbours,incoming=bearing(vector(before.point,p)),outgoing=bearing(vector(p,after.point));
 const turn=Math.abs(angularDifference(outgoing,incoming));
 if(turn>20)return unknown('turning-or-noisy-GPS');
 const heading=bearing(vector(before.point,after.point));
 const raw=current.heading===null||current.heading===undefined||current.heading===''?NaN:Number(current.heading);
 return {status:'straight-motion-prior-unverified',heading,turnDegrees:turn,
  neighbours:neighbours.map(n=>({id:n.item.id,distance:n.distance,seconds:n.seconds})),
  apiHeading:Number.isFinite(raw)?(raw%360+360)%360:null,
  apiDifference:Number.isFinite(raw)?angularDifference(raw,heading):null,
  note:'Assumes forward-facing capture along a locally straight trajectory. GPS, camera yaw/pitch/roll, intrinsics and capture independence remain unverified.'};
}
