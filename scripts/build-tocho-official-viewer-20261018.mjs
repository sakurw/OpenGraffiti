import {build} from '../.tools/plateau-official-viewer/node_modules/esbuild/lib/main.js';
await build({entryPoints:['scripts/tocho-official-tiles-viewer-20261018.js'],outfile:'public/assets/plateau-official-shinjuku-2025/viewer.js',bundle:true,format:'esm',platform:'browser',sourcemap:true,minify:false,nodePaths:['.tools/plateau-official-viewer/node_modules']});
