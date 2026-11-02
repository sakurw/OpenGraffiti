import {readFile} from 'node:fs/promises';
import path from 'node:path';
export async function loadSnapCase(id=process.argv[2]||'park-tower-west'){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw Error('Invalid SNAP case ID');
 const file=id==='park-tower-west'?'scripts/texture-snap-registration.json':`scripts/texture-snap-cases/${id}.json`;
 const c=JSON.parse(await readFile(file,'utf8'));
 if(c.caseId!==id||!['tocho','tokyo-tower'].includes(c.areaId)||!/^\d+$/.test(c.sourceId))throw Error('Invalid SNAP case');
 const relative=path.relative(path.resolve('data/plateau'),path.resolve(c.geometryPath));
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Geometry outside PLATEAU sources');
 if(!Number.isFinite(c.minimumHeight))throw Error('Missing minimumHeight');
 return c;
}
