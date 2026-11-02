import {mkdir,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const version='v24.20.0',name=`node-${version}-win-x64`,root=resolve('.tools'),exe=resolve(root,name,'node.exe');
try{await access(exe);console.log(execFileSync(exe,['--version'],{encoding:'utf8'}).trim());process.exit(0);}catch{}
await mkdir(root,{recursive:true});
const [archive,checksums]=await Promise.all([fetch(`https://nodejs.org/dist/${version}/${name}.zip`),fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)]);
if(!archive.ok||!checksums.ok)throw new Error('Official Node download unavailable');
const bytes=Buffer.from(await archive.arrayBuffer()),expected=(await checksums.text()).split('\n').find(l=>l.trim().endsWith(`${name}.zip`))?.split(/\s+/)[0];
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Node SHA-256 mismatch');
await writeFile(resolve(root,name+'.zip'),bytes);
execFileSync('tar.exe',['-xf',resolve(root,name+'.zip'),'-C',root],{stdio:'inherit',windowsHide:true});
console.log(execFileSync(exe,['--version'],{encoding:'utf8'}).trim());
