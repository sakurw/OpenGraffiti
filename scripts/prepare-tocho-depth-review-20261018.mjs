import fs from 'node:fs/promises';
import {configureStableDepth} from './tocho-depth-viewer-utils-20261018.mjs';
const html=await fs.readFile('public/tocho-district-photo-v2-review-20261018.html','utf8');
await fs.writeFile('public/tocho-depth-review-20261018.html',configureStableDepth(html,{qa:true}));
console.log('Created same-asset depth comparison viewer');
