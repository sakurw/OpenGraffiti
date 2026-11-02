import fs from 'node:fs/promises';
import path from 'node:path';
const dir='data/texture-city/tocho-district-photo-v2-20261018';
const native=JSON.parse(await fs.readFile(dir+'/native-photo-sources.json','utf8'));
// Human inspection of contact-01..11. A source resolution label alone does
// not establish that the picture actually shows the facade.
const inspected=[
 [10,1,false,'Plain muted gray painted service door/wall, very sparse seams. No windows visible; do not invent any.'],
 [11,1,false,'Muted red-brown brick lower course below gray opaque panels. Do not copy the ladder/pipes from other faces. No glazing.'],
 [14,1,false,'Small gray service facade with one recessed dark doorway, heavy simple lintel, no repeated office windows.'],
 [16,1,true,'One horizontal dark glazing band separated by a broad light-gray concrete band. Simple low-rise building, not a tower grid.'],
 [22,2,true,'Broad dark charcoal horizontal glazing band, slender pale-gray vertical piers, small transom grid above. Remove antenna/railings projected in foreground.'],
 [26,1,true,'Light beige facade with small isolated dark rectangular windows in a sparse rhythm. Roof and railings must be excluded.'],
 [31,1,true,'Broad recessed dark gray glass band, narrow vertical frames, pale gray small square window strip above. No roof or background.'],
 [43,1,false,'Opaque gray service wall, subtle rectangular panel joints, no clearly visible windows. Exclude adjacent roof diagonals.'],
 [50,1,true,'Broad dark horizontal glazed window band with pale horizontal fascia and slender gray mullions. Not tall triple windows.'],
 [51,1,true,'Light warm-gray smooth masonry wall with small separated square dark windows, broad solid wall surrounds. Exclude projected vertical corner from third face.'],
 [58,1,true,'Dark horizontal glazed low-rise entrance facade, widely spaced pale vertical piers, fine black mullions, no tree texture.'],
 [59,1,true,'Pale concrete gallery band with closely spaced very slender vertical slit windows and small transoms. Long low-rise rhythm, no tower square-window grid.'],
 [60,2,false,'White/very light gray service panels, narrow dark vertical joints, upper short vent grille. No residential windows.'],
 [62,2,true,'Pale stone low-rise wall with paired narrow vertical windows above horizontal dark glazing. Strong horizontal stone bands.'],
 [64,1,true,'Small low-rise dark metal-framed rectangular storefront windows under a pale concrete lintel, broad horizontal glass, not tower windows.'],
 [72,2,false,'Plain pale warm-gray concrete wall, sparse vertical panel seams, no windows established.'],
 [73,2,true,'Low-rise dark horizontal glazing band, slender black vertical framing, pale concrete spandrel below; no trees or reflections of neighboring buildings.'],
 [75,2,true,'Warm light tan masonry wall with small individual square dark windows in a sparse row, thick wall surrounds.'],
 [77,1,false,'Small pale gray service hut, ONE dark louver grille in opaque panels, no glazed windows, no bright diagonal foreground rails.'],
 [80,1,false,'Plain muted gray metal-clad service wall, narrow vertical seams and subtle grain, no windows.']
];
const style=path.resolve('public/assets/tocho-landmark/wall-hour-20261018/wall-illustrated-v1.png');
const jobs=inspected.map(([i,w,windows,observed])=>{
 const b=native.buildings[i],wall=b.walls[w-1];
 return {key:b.buildingId,buildingId:b.buildingId,index:i,sourcePaths:[path.resolve(wall.file)],sourcePolygon:wall.sourceGMLPolygon,quality:wall.quality,windows,observed,bays:4,floors:2,bayWidth:3,floorHeight:3.2,baseColor:[164,162,151],stylePath:style,
 prompt:`Generate ONE square orthographic building-specific illustrated facade material from reference1, its own rectified real photograph. Reference2 controls fine drawing style ONLY: detailed anime background architecture, restrained neutral light, thin charcoal outlines, subtle fine grain, muted gray slate glass. Reference1 is low resolution; preserve ONLY the observed material/pattern described here: ${observed} Remove foreground trees, pipes, perspective, neighboring buildings and photographic lighting casts. Fill the square with a clean reusable material module consisting of exactly FOUR complete structural bays across and TWO floor rhythms vertically. Keep the same pattern family, color and glazing proportions as this particular building. ${windows?'Glazing only as observed, no generic triple tall window pattern.':'DO NOT create glazed windows. Window-free service/masonry material only.'} No text, sky, trees, street, roof, signs, white borders or collage. This is inferred drawing from a limited own-wall source, not an exact reconstruction.`};
});
const special=[
 ['koban',1,'park-photos/koban-front.jpg',false,'Off-white round police box: cylindrical light gray painted wall, horizontal metal guardrails and pale columns. Create ONLY its opaque painted wall/metal material, no office window grid. No columns or railings painted onto equipment.',4,2,[191,192,183]],
 ['eco',20,'park-photos/eco-front.jpg',true,'Pale ochre/cream rough stucco, square yellow-cream piers, wide dark brown framed rectangular glazing at lower storeys. Preserve cream colonnade and large horizontal dark glazing, no tower window grid. Exclude trees and solar panel.',4,2,[195,188,151]],
 ['shuknova',57,'park-photos/shuknova-west.jpg',true,'LOW TWO-STOREY SHUKNOVA building in FOREGROUND ONLY. Dark charcoal vertical siding, large dark metal-framed storefront glass, muted red-brown brick piers. Background tall salmon towers are other buildings, exclude entirely. No signs/text.',4,2,[141,130,116]],
 ['council-north',69,'native-inputs/'+native.buildings[69].buildingId+'--wall-2.png',true,'Own Assembly NORTH gallery wing: pale gray stone piers, grouped narrow vertical subdivided windows, dark gray horizontal spandrel bands, delicate stone joints. Exclude roofs, people, flags, foreground trees.',4,4,[180,178,162]],
 ['council-west',63,'native-inputs/'+native.buildings[63].buildingId+'--wall-1.png',true,'Own Assembly WEST connection/gallery: pale gray stone piers and grouped narrow vertical dark window lights with fine horizontal subdivisions, large lower recessed dark entrance bays. Exclude Tokyo signs, flags, roof, trees, people.',4,4,[180,178,162]],
 ['council-south2',39,'native-inputs/'+native.buildings[39].buildingId+'--wall-1.png',true,'Own Assembly SOUTH gallery wing: pale gray stone piers, alternating broader horizontal glazing and grouped narrow vertical slit windows, dark gray spandrel strips. No generic tower office grid. Exclude roofs, flags, trees.',4,4,[180,178,162]],
 ['council-hall',79,'landmark-photos/assembly-11.jpg',true,'Tokyo Metropolitan ASSEMBLY main low-rise hall in FOREGROUND ONLY, NOT TOWERS behind. Pale gray speckled stone, tall paired slender dark gray glazing, gray-brown horizontal spandrel strips. Use lower square courtyard facade. Exclude circular roof, sky, flags, people and paving.',4,4,[180,178,162]]
];
for(const [key,i,file,windows,observed,bays,floors,baseColor]of special){const b=native.buildings[i];jobs.push({key,buildingId:b.buildingId,index:i,sourcePaths:[path.resolve(dir,file)],windows,observed,bays,floors,bayWidth:3,floorHeight:3.5,baseColor,quality:'street-photo',stylePath:style,prompt:`Create ONE square orthographic reusable illustrated facade MATERIAL for the specific building shown in reference1. ${observed} Reference2 is approved detailed anime architectural STYLE only: fine charcoal linework, soft neutral stone, slate muted glass, subtle fine grain. ${bays} complete bays by ${floors} floors of the observed material pattern. No perspective, no roof, street, text, signage, trees, collage, borders, or neighboring buildings. ${windows?'Use only this building own glazing rhythm.':'No glazed windows at all; plain opaque wall material.'} Finite full bays end in masonry.`});}
await fs.writeFile(dir+'/art-jobs.json',JSON.stringify(jobs,null,2));
console.log(JSON.stringify(jobs));
