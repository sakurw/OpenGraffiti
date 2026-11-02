import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const review=JSON.parse(await fs.readFile('docs/spatial-art-review.json','utf8'));
if(review.views.length!==13)throw Error('All 12 orbit views and roof require review');
for(const v of review.views){const hash=createHash('sha256').update(await fs.readFile(v.image)).digest('hex');if(v.sha256!==hash||!v.observation||!v.limitations||v.verdict!=='PASS')throw Error('Missing, stale or failed visual review: '+v.image);}
console.log('13 image-specific visual judgments verified. This verifies recorded review, not automated semantic vision.');
