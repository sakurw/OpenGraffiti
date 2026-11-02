"""Generate raster transfer patches for same WallSurface candidates."""
import argparse,json
from pathlib import Path
import cv2
import numpy as np

def main():
 p=argparse.ArgumentParser();p.add_argument('--photo',required=True);p.add_argument('--homography',required=True);p.add_argument('--output-dir',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 image=cv2.imread(a.photo,cv2.IMREAD_COLOR)
 if image is None: raise RuntimeError('photo not found')
 data=json.loads(Path(a.homography).read_text(encoding='utf-8'))
 out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True)
 patches=[]
 for item in data.get('candidates',[]):
  source=np.float32(item['sourcePhotoProjection']);target=np.float32(item['targetProjection'])
  m=cv2.getAffineTransform(source,target)
  warped=cv2.warpAffine(image,m,(image.shape[1],image.shape[0]))

  # Keep only the transferred target triangle. A full-frame warped image would
  # contaminate atlas pixels outside the validated WallSurface triangle.
  mask=np.zeros(image.shape[:2],dtype=np.uint8)
  cv2.fillConvexPoly(mask,np.int32(target),255)
  warped=cv2.bitwise_and(warped,warped,mask=mask)
  x,y,w,h=cv2.boundingRect(np.int32(target))
  patch=warped[y:y+h,x:x+w]
  patch_mask=mask[y:y+h,x:x+w]
  if patch.size == 0:
   continue
  rgba=cv2.cvtColor(patch,cv2.COLOR_BGR2BGRA)
  rgba[:,:,3]=patch_mask
  name=f"transfer-{item['targetTriangle']}.png";cv2.imwrite(str(out/name),rgba)
  patches.append({'targetTriangle':item['targetTriangle'],'sourceTriangle':item['sourceTriangle'],'patch':name,'wallId':item['wallId'],'bbox':[x,y,w,h]})
 result={'status':'surface-raster-transfer-patches','patchCount':len(patches),'patches':patches}
 Path(a.output).write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'status':result['status'],'patchCount':len(patches)}))
if __name__=='__main__': main()
