import {build} from '../.tools/plateau-official-viewer/node_modules/esbuild/lib/main.js';
await build({entryPoints:['scripts/tocho-nine-blocks-own-viewer-20261018.js'],outfile:'public/assets/tocho-nine-blocks-20261018/viewer.js',bundle:true,format:'esm',platform:'browser',sourcemap:true,nodePaths:['.tools/plateau-official-viewer/node_modules']});
