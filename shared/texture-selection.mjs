// The original result stays addressable for reproducible before/after comparisons.
export const DEFAULT_TEXTURE_SELECTION='wall-coverage-all';
const selections=['triangle-first','wall-coverage','triangle-first-all','wall-coverage-all','wall-coverage-refine2','wall-coverage-refine2-all'];
export function resolveTextureSelection(requested){
 if(requested==='original')return '';
 return selections.includes(requested)?requested:DEFAULT_TEXTURE_SELECTION;
}
export function textureReportUrl(area,selection=DEFAULT_TEXTURE_SELECTION){
 if(!['tocho','tokyo-tower'].includes(area)||selection&&!selections.includes(selection))throw Error('Invalid texture report');
 return `/assets/texture-poc/experimental/${selection?`selection/${selection}/`:''}${area}.json`;
}
