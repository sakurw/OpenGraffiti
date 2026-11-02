// Reusable Commons discovery by category and/or geolocation. Candidates are not
// accepted image evidence: facade identity, camera pose and visibility come later.
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(v => {
  const at = v.indexOf('=');
  if (!v.startsWith('--') || at < 3) throw Error('Use --name=value arguments');
  return [v.slice(2, at), v.slice(at + 1)];
}));
const category = args.category;
const searchQueries = (args.search ?? '').split('|').map(value => value.trim()).filter(Boolean);
const lat = Number(args.lat), lon = Number(args.lon);
if (!category && !searchQueries.length && !(Number.isFinite(lat) && Number.isFinite(lon))) throw Error('Supply --category, --search, or --lat and --lon');
const depth = Number(args.depth ?? 1);
if (!Number.isInteger(depth) || depth < 0 || depth > 3) throw Error('Depth must be 0..3');
const output = path.resolve(args.output ?? 'data/texture-city/commons/discovery.json');
const root = path.resolve('data/texture-city/commons');
if (!output.startsWith(root + path.sep)) throw Error('Discovery output must be in data/texture-city/commons');
await mkdir(root + '/api-cache', {recursive: true});
const hash = v => createHash('sha256').update(v).digest('hex');
async function atomic(file, value) {
  await writeFile(file + '.partial', JSON.stringify(value, null, 2));
  await rename(file + '.partial', file);
}
async function api(params) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({action: 'query', format: 'json', formatversion: '2', ...params});
  const cache = `${root}/api-cache/${hash(url.href)}.json`;
  try { return JSON.parse(await readFile(cache, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    response = await fetch(url, {headers: {'User-Agent': 'OpenGraffitiLocalResearch/0.2 (local facade reconstruction)'}, signal: AbortSignal.timeout(45000)});
    if (response.status !== 429 && response.status < 500) break;
    const retry = response.headers.get('retry-after');
    const seconds = Number(retry);
    const wait = retry && Number.isFinite(seconds) ? seconds * 1000 : retry && Number.isFinite(Date.parse(retry)) ? Date.parse(retry) - Date.now() : 10000 * (attempt + 1);
    if (wait > 60000) throw Error(`Commons requested a longer pause: ${wait}ms`);
    console.log(JSON.stringify({stage: 'retry', status: response.status, waitMs: Math.max(5000, wait)}));
    await new Promise(r => setTimeout(r, Math.max(5000, wait)));
  }
  if (!response.ok) throw Error(`Commons HTTP ${response.status}; Retry-After=${response.headers.get('retry-after')}`);
  const data = await response.json();
  if (data.error) throw Error(`Commons API ${data.error.code}`);
  await atomic(cache, data);
  return data;
}
const candidates = new Map();
const add = (p, origin) => {
  if (p.ns !== 6 || !/\.(jpe?g|png|tiff?)$/i.test(p.title)) return;
  const entry = candidates.get(p.pageid) ?? {id: `commons/${p.pageid}`, pageId: p.pageid, provider: 'commons', title: p.title, discoveredBy: []};
  entry.discoveredBy.push(origin);
  candidates.set(p.pageid, entry);
};
const categories = [], visited = new Set();
const queue = category ? [{title: category.startsWith('Category:') ? category : `Category:${category}`, depth: 0}] : [];
for (let i = 0; i < queue.length; i++) {
  const item = queue[i];
  if (visited.has(item.title)) continue;
  visited.add(item.title);
  let continuation;
  do {
    const result = await api({list: 'categorymembers', cmtitle: item.title, cmlimit: '500', ...continuation});
    for (const p of result.query.categorymembers) {
      add(p, item.title);
      if (p.ns === 14 && item.depth < depth) queue.push({title: p.title, depth: item.depth + 1});
    }
    continuation = result.continue;
  } while (continuation);
  categories.push(item);
  console.log(JSON.stringify({stage: 'category', categories: categories.length, candidates: candidates.size}));
}
if (Number.isFinite(lat) && Number.isFinite(lon)) {
  const result = await api({list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: args.radius ?? '1000', gsnamespace: '6', gslimit: '500'});
  for (const p of result.query.geosearch) add(p, {kind: 'geosearch', lat: p.lat, lon: p.lon, distance: p.dist});
}
for (const query of searchQueries) {
  let continuation;
  do {
    const result = await api({list: 'search', srsearch: query, srnamespace: '6', srlimit: '500', ...continuation});
    for (const p of result.query.search) add(p, {kind: 'text-search', query});
    continuation = result.continue;
  } while (continuation);
  console.log(JSON.stringify({stage: 'search', query, candidates: candidates.size}));
}
const photos = [...candidates.values()];
// extmetadata is comparatively expensive; request ten files per cached batch.
for (let i = 0; i < photos.length; i += 10) {
  const batch = photos.slice(i, i + 10);
  const result = await api({pageids: batch.map(p => p.pageId).join('|'), prop: 'imageinfo', iiprop: 'url|size|sha1|mime|extmetadata|metadata', iiurlwidth: '1600'});
  for (const page of result.query.pages) {
    const photo = candidates.get(page.pageid), info = page.imageinfo?.[0];
    if (!photo || !info) continue;
    photo.imageInfo = info;
    const m = info.extmetadata ?? {};
    photo.license = m.LicenseShortName?.value ?? '';
    photo.licenseAccepted = /^(CC BY(?:-SA)? [\d.]+|CC0|Public domain)$/i.test(photo.license);
    photo.lat = Number(m.GPSLatitude?.value) || null;
    photo.lon = Number(m.GPSLongitude?.value) || null;
  }
  await atomic(output, {provider: 'commons', endpoint: 'https://commons.wikimedia.org/w/api.php', categories, photos, status: 'discovery-in-progress'});
}
await atomic(output, {provider: 'commons', endpoint: 'https://commons.wikimedia.org/w/api.php', categories, searchQueries, photos, finishedAt: new Date().toISOString(), status: 'candidates-only', note: 'Category, search text and geotags locate candidates; they do not establish ground viewpoint, building identity, registration or visible wall area.'});
console.log(JSON.stringify({output, candidates: photos.length, acceptedLicense: photos.filter(p => p.licenseAccepted).length}));
