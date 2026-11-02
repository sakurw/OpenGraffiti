import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
const local=resolve('.tools/node-v24.20.0-win-x64/node.exe');
const node=process.platform==='win32'&&existsSync(local)?local:process.execPath;
const command=process.argv[2],rest=process.argv.slice(3);
if(command==='build'){
 for(const script of ['node_modules/typescript/bin/tsc','node_modules/vite/bin/vite.js']){const result=spawnSync(node,[script,script.includes('tsc')?'-b':'build'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
}else{
 const scripts={dev:'scripts/dev.mjs',start:'server/index.mjs',e2e:'node_modules/@playwright/test/cli.js'};
 const args=command==='test'?['--test','tests/domain.test.mjs','tests/plateau-geometry.test.mjs','tests/plateau-building.test.mjs','tests/expanded-city.test.mjs','tests/facade-groups.test.mjs','tests/facade-visibility.test.mjs','tests/texture-camera.test.mjs','tests/texture-checkpoint.test.mjs','tests/texture-spatial-depth.test.mjs','tests/texture-snap-aggregate.test.mjs','tests/texture-snap-image-regions.test.mjs','tests/texture-photo-quality.test.mjs','tests/texture-photo-selection.test.mjs','tests/texture-selection-routing.test.mjs']:command==='e2e'?[scripts.e2e,'test',...rest]:[scripts[command],...rest];
 if(command==='test')args.push('tests/texture-refinement.test.mjs','tests/texture-kartaview-evidence.test.mjs','tests/texture-motion-heading.test.mjs','tests/texture-translation-search.test.mjs');
 if(!args[0])throw new Error('Unknown command');
 const child=spawn(node,args,{stdio:'inherit'});child.on('exit',code=>{process.exitCode=code||0;});process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
}
