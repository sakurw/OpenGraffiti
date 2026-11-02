import {readFile,writeFile} from 'node:fs/promises';
import {groupedSurfaces} from './facade-groups.mjs';
import {roadSections} from './plateau-roads.mjs';
for(const [id,mesh,area]of [['plateau-13103-minato-ku-2025','53393599','tokyo-tower'],['plateau-13104-shinjuku-ku-2025','53394525','tocho']].filter(x=>!process.argv[2]||x[2]===process.argv[2])){
 const root='data/plateau/'+id,g=JSON.parse(await readFile(root+'/'+mesh+'-geometry.json','utf8')),plan=groupedSurfaces(g);
 const selected=g.buildings;const needed=[...new Set(selected.flatMap(b=>b.polygons.map(p=>g.textures[p.id]?.image).filter(Boolean)).map(p=>'udx/bldg/'+p))];
 await writeFile(root+'/'+mesh+'-texture-paths.json',JSON.stringify(needed));
 console.log('Planning roads '+area+' / '+plan.walls.length+' walls');
 const roads=roadSections(await readFile(root+'/udx/tran/'+mesh+'_tran_6697_op.gml','utf8'),g,plan.panels);
 await writeFile(root+'/'+mesh+'-plan.json',JSON.stringify({id,mesh,area,origin:g.origin,buildingIds:selected.map(b=>b.id),...plan,...roads}));
 console.log(JSON.stringify({area,buildings:selected.length,textures:needed.length,walls:plan.walls.length,roads:roads.roads.length,rejected:plan.rejected}));
}
