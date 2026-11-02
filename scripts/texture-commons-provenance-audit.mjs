// Acquisition triage, not a license or camera-registration certificate.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function inspectProvenance(photo){
  const info=photo.imageInfo??{},metadata=Object.fromEntries((info.metadata??[]).map(row=>[row.name,row.value]));
  const software=String(metadata.Software??'').trim(),flags=[];
  if(/Microsoft\s+(?:ICE\b|Image Composite Editor)|\b(?:PTGui|Hugin|Autopano|PanoramaStudio)\b/i.test(software))flags.push('panorama-software-projection-not-established');
  if(/\bcropped\b/i.test(photo.title??''))flags.push('documented-cropped-derivative');
  const sourceFiles=[...String(info.extmetadata?.Credit?.value??'').matchAll(/title="(File:[^"]+)"/g)].map(m=>m[1]);
  return {sourceId:String(photo.pageId),title:photo.title,sourcePage:info.descriptionurl,software,flags,
    originalDimensions:[info.width,info.height],cameraMake:metadata.Make??null,cameraModel:metadata.Model??null,
    focalLength:metadata.FocalLength??null,equivalent35mmFocalLength:metadata.FocalLengthIn35mmFilm??null,
    exifCoordinate:{latitude:metadata.GPSLatitude??null,longitude:metadata.GPSLongitude??null,altitude:metadata.GPSAltitude??null},
    pageCoordinate:{latitude:info.extmetadata?.GPSLatitude??null,longitude:info.extmetadata?.GPSLongitude??null},
    declaredSourceFiles:[...new Set(sourceFiles)],license:photo.license??info.extmetadata?.LicenseShortName?.value??null,
    decision:flags.length?'inspect-original-projection-before-pinhole-fit':'no-declared-projection-risk-found-not-validated'};
}
async function main(){
  const discovery=process.argv[2]??'data/texture-city/commons/discovery-tocho.json';
  const output=process.argv[3]??'data/texture-city/commons/provenance-audit.json';
  const acquired=new Set((await readdir('data/texture-city/photos/commons')).filter(f=>f.endsWith('.jpg')).map(f=>f.slice(0,-4)));
  const data=JSON.parse(await readFile(discovery)),rows=data.photos.filter(p=>acquired.has(String(p.pageId))).map(inspectProvenance);
  const titles=new Map(data.photos.map(p=>[p.title.replaceAll('_',' '),String(p.pageId)]));
  for(const row of rows)row.declaredSourceCandidates=row.declaredSourceFiles.map(title=>({title,sourceId:titles.get(title.replaceAll('_',' '))??null}));
  const report={discovery,createdAt:new Date().toISOString(),photos:rows,
    warnings:['No metadata risk is not proof of an original perspective photograph.',
      'Photo editor names alone do not establish cropping or panorama stitching. Panoramio is a host name, not a projection.',
      'GPS altitude reference, capture viewpoint, geometric accuracy and reuse rights need separate verification.'],
    panoramaSoftwareReference:'https://www.microsoft.com/en-us/research/project/image-composite-editor/'};
  await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({photos:rows.length,flagged:rows.filter(r=>r.flags.length).map(r=>({id:r.sourceId,flags:r.flags})),output}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
