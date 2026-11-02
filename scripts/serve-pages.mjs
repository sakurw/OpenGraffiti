// Deliberately use a real 404, as GitHub Pages does, instead of an SPA fallback.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist-pages');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.glb':'model/gltf-binary'};
createServer(async(req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(!pathname.startsWith('/OpenGraffiti/')){res.writeHead(404);res.end();return;}
 const path=resolve(root,pathname.slice('/OpenGraffiti/'.length)||'index.html');
 if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\')){res.writeHead(403);res.end();return;}
 try{await stat(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(await readFile(path));}
 catch{res.writeHead(404,{'Content-Type':'text/html'});res.end(await readFile(root+'/404.html'));}
}).listen(3115,'127.0.0.1',()=>console.log('Pages preview: http://127.0.0.1:3115/OpenGraffiti/'));
