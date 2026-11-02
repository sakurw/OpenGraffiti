import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('public'),port=3111;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.jpg':'image/jpeg','.png':'image/png'};
http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');const name=decodeURIComponent(url.pathname==='/'?'/universal-all-areas.html':url.pathname);
  const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error('invalid path');
  const bytes=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found')}}).listen(port,'127.0.0.1',()=>console.log(`Universal all-areas viewer: http://127.0.0.1:${port}/universal-all-areas.html`));
