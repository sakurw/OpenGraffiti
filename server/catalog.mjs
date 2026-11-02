import {readFile} from 'node:fs/promises';
import * as fixture from '../shared/catalog.mjs';
export const fixtureMode=process.env.MOCK_FIXTURE==='1';
const real=fixtureMode?null:JSON.parse(await readFile(new URL('../shared/generated/plateau.json',import.meta.url),'utf8'));
export const walls=real?.walls||fixture.walls,sections=real?.sections||fixture.sections;
export const datasetVersion=real?.datasetVersion||'fixture-v1';
export const areas=real?.areas||[{id:'tokyo-tower',name:'オリジナル街区',model:'/models/mock-city.glb',drawable:true,camera:{position:[80,83,112],target:[0,12,-7]},bounds:[-75,75,-65,65],note:'検証専用オリジナルモデル',lod3Buildings:0}];
export const dimensions=w=>[w.canvasWidth||fixture.WIDTH,w.canvasHeight||fixture.HEIGHT];
