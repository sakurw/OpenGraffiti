// Same ECEF and east/up/south frame as the adopted official B3DM model.
export const datumOffset=37;
const lat=35.6896*Math.PI/180,lon=139.6917*Math.PI/180,e2=6.6943799901413165e-3;
function ecef(phi,lambda,h){const r=6378137/Math.sqrt(1-e2*Math.sin(phi)**2);return [(r+h)*Math.cos(phi)*Math.cos(lambda),(r+h)*Math.cos(phi)*Math.sin(lambda),(r*(1-e2)+h)*Math.sin(phi)];}
const origin=ecef(lat,lon,0),east=[-Math.sin(lon),Math.cos(lon),0],up=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],south=[Math.sin(lat)*Math.cos(lon),Math.sin(lat)*Math.sin(lon),-Math.cos(lat)];
export function toLocal(latitude,longitude,height){const p=ecef(latitude*Math.PI/180,longitude*Math.PI/180,height+datumOffset).map((v,i)=>v-origin[i]),dot=a=>a.reduce((s,v,i)=>s+v*p[i],0);return [dot(east),dot(up),dot(south)];}
export const frameMetadata={origin:[139.6917,35.6896,0],axes:['east','up','south'],ellipsoid:'WGS84',sourceCRS:'EPSG:6697',sourceHeightToNativeEllipsoidMeters:datumOffset,note:'37m matches this official native 3D Tiles conversion; not a universal geoid model.'};
