import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const PHOTO_QUALITY_POLICY='exclude-known-visual-quality-below-0.2-v1';
export function classifyPhotoQuality(score){
 if(score===null||score===undefined||score===0)return 'unscored';
 if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>1)throw Error('Invalid photo quality score');
 return score<.2?'low-quality':'not-rejected-by-score';
}
export async function photoQualityEvidence(photo,{root='data/texture-city/spatial'}={}){
 if(!/^\d+$/.test(photo.id))throw Error('Invalid quality photo ID');
 let bytes;try{bytes=await readFile(`${root}/${photo.id}.json`);}catch(e){if(e.code==='ENOENT')return {status:'unscored',score:null,key:'not-acquired'};throw e;}
 const m=JSON.parse(bytes);
 if(m.id!==photo.id||(m.sourceSha256&&m.sourceSha256!==photo.sha256))throw Error('Quality source identity mismatch');
 return {status:classifyPhotoQuality(m.qualityScore),score:m.qualityScore??null,key:createHash('sha256').update(bytes).digest('hex'),identity:m.sourceSha256?'source-hash-bound':'legacy-image-id'};
}
