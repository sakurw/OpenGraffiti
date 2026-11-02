// OpenCV-compatible camera projection shared by mesh baking and regression tests.
export function validateGroundCamera(r) {
  if (!['pinhole','simple-radial'].includes(r.cameraModel??'pinhole')) throw Error('Unsupported camera model');
  const d=r.distortionCoefficients??[0,0,0,0,0];
  if(d.length!==5 || !d.every(Number.isFinite) || d.slice(1).some(v=>v!==0)) throw Error('Invalid radial calibration');
  if((r.cameraModel??'pinhole')==='pinhole'&&d[0]!==0) throw Error('Pinhole model has lens distortion');
  for(const key of ['rotationMatrix','cameraMatrix'])if(!Array.isArray(r[key])||r[key].length!==3||r[key].some(row=>!Array.isArray(row)||row.length!==3||!row.every(Number.isFinite)))throw Error('Invalid camera matrix');
  if(!Array.isArray(r.translationVector)||r.translationVector.length!==3||!r.translationVector.every(Number.isFinite))throw Error('Invalid camera translation');
  if(!Array.isArray(r.cameraPosition)||r.cameraPosition.length!==3||!r.cameraPosition.every(Number.isFinite))throw Error('Invalid camera position');
  if(r.cameraMatrix[0][0]<=0||r.cameraMatrix[1][1]<=0)throw Error('Invalid focal length');
  if(r.positionValidation==='projection-ensemble'){
    if(r.requiresPerSurfaceEnsembleValidation!==true||r.worldCameraPositionVerified!==false)throw Error('Missing surface-only registration contract');
    if(!r.projectionEnsemble||r.projectionEnsemble.filter(c=>c.kind==='training-noise').length!==64)throw Error('Missing training-only projection ensemble');
    if(!r.validatedControlHullReferencePixels||r.validatedControlHullReferencePixels.length<3)throw Error('Missing observed control hull');
    const hull=r.validatedControlHullReferencePixels;
    if(hull.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw Error('Invalid control hull');
    const hullArea=Math.abs(hull.reduce((sum,p,i)=>{const q=hull[(i+1)%hull.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
    if(hullArea<1)throw Error('Degenerate control hull');
    for(const key of ['referenceSize','imageSize'])if(!Array.isArray(r[key])||r[key].length!==2||!r[key].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid image dimensions');
    for(const camera of r.projectionEnsemble){
      if(!camera.converged||camera.positionValidation)throw Error('Invalid ensemble member');
      validateGroundCamera(camera);
    }
    if(r.gates?.maximumProjectionSpreadReferencePixels!==4)throw Error('Changed projection spread gate');
    const validation=r.projectionEnsembleValidation;
    if(!Number.isFinite(validation?.heldOutWorstRmsPixels)||validation.heldOutWorstRmsPixels>6||!Number.isFinite(validation?.heldOutWorstMaxPixels)||validation.heldOutWorstMaxPixels>10)throw Error('Unvalidated ensemble held-out residuals');
  }else if(r.requiresPerSurfaceEnsembleValidation)throw Error('Unknown surface-only registration mode');
}

export function withinConvexHull(point,hull) {
  let sign=0;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],cross=(b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0]);
    if(Math.abs(cross)<1e-8)continue;
    const next=Math.sign(cross);if(sign&&sign!==next)return false;sign=next;
  }
  return true;
}

// One stable 3D-to-photo projection does not prove an accurate world camera.
// Conditional registrations must be evaluated with every training-only camera.
export function projectGroundPhotoSet(r,p) {
  const nominal=projectGroundPhoto(r,p);
  if(!nominal||!nominal.every(Number.isFinite))return {reason:'projection'};
  if(r.positionValidation!=='projection-ensemble')return {projections:[nominal],maximumSpread:0};
  const scales=r.referenceSize.map((size,i)=>size/r.imageSize[i]);
  const projections=[nominal];let maximumSpread=0;
  for(const camera of r.projectionEnsemble){
    const uv=projectGroundPhoto(camera,p);
    if(!uv||!uv.every(Number.isFinite))return {reason:'projection-ensemble-invalid'};
    const spread=Math.hypot(...uv.map((v,i)=>(v-nominal[i])*scales[i]));
    if(spread>4)return {reason:'projection-ensemble-spread'};
    maximumSpread=Math.max(maximumSpread,spread);projections.push(uv);
  }
  if(projections.some(uv=>!withinConvexHull(uv.map((v,i)=>v*scales[i]),r.validatedControlHullReferencePixels)))return {reason:'outside-validated-control-hull'};
  return {projections,maximumSpread};
}

export function projectGroundPhoto(r,p) {
  const v=r.rotationMatrix.map((row,i)=>row.reduce((s,x,j)=>s+x*p[j],r.translationVector[i]));
  if(v[2]<=0) return null;
  const x=v[0]/v[2],y=v[1]/v[2],scale=1+(r.distortionCoefficients?.[0]??0)*(x*x+y*y);
  const k=r.cameraMatrix;
  return [k[0][0]*x*scale+k[0][2],k[1][1]*y*scale+k[1][2]];
}
