// Metadata consistency, not camera calibration. Never silently rotate/crop FoVs.
export function kartaviewCameraEvidence(photo){
 const k=photo.cameraParameters||photo.sequenceMetadata?.cameraParameters||{};
 const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 const horizontalFoV=number(k.hFoV),verticalFoV=number(k.vFoV),size=photo.downloadSize;
 if(!Array.isArray(size)||size.length!==2||size.some(v=>!Number.isFinite(v)||v<=0))throw Error('Invalid downloaded image size');
 const base={horizontalFoV,verticalFoV,imageAspect:size[0]/size[1],registration:'unregistered'};
 if(horizontalFoV===null||verticalFoV===null||horizontalFoV<=0||horizontalFoV>=180||verticalFoV<=0||verticalFoV>=180)return {...base,status:'missing-or-invalid-intrinsics'};
 const expectedAspect=Math.tan(horizontalFoV*Math.PI/360)/Math.tan(verticalFoV*Math.PI/360);
 const ratio=base.imageAspect/expectedAspect;
 return {...base,metadataAspect:expectedAspect,aspectRatioError:Math.abs(ratio-1),
  status:Math.abs(ratio-1)<=.02?'aspect-consistent-unverified':'aspect-inconsistent-requires-calibration',
  note:'A matching aspect alone does not establish focal length, principal point, distortion, roll, pitch, yaw or GPS accuracy.'};
}
