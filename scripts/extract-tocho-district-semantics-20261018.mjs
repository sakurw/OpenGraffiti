import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { SaxesParser } from 'saxes';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = 'data/plateau/plateau-13104-shinjuku-ku-2025/udx/bldg';
const outputFile = 'data/texture-city/tocho-district-illustrated-20261018/semantics.json';
const surfaceTypes = new Set(['WallSurface', 'RoofSurface', 'GroundSurface', 'ClosureSurface',
  'OuterCeilingSurface', 'OuterFloorSurface', 'InteriorWallSurface', 'CeilingSurface', 'FloorSurface']);
const isBuilding = tag => /^https?:\/\/www\.opengis\.net\/citygml\/building\//.test(tag.uri);
const isGml = tag => /^https?:\/\/www\.opengis\.net\/gml(?:\/|$)/.test(tag.uri);
const idOf = tag => Object.values(tag.attributes).find(a => a.local === 'id' && isGml(a))?.value ?? null;

// Retain only ancestry, small building summaries and the requested explicit-ID map.
// Polygon coordinates and appearance text are never accumulated.
export async function extractSemantics(stream, polygons = Object.create(null)) {
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  const stats = { polygonCount: 0, explicitPolygonCount: 0, anonymousPolygonCount: 0,
    installationPolygonCount: 0, unclassifiedPolygonCount: 0, byType: {}, buildings: [] };
  parser.on('opentag', tag => {
    const parent = stack.at(-1);
    const frame = { building: parent?.building ?? null, surface: parent?.surface ?? null,
      installation: parent?.installation ?? false, capture: null, text: '' };
    if (isBuilding(tag)) {
      if (tag.local === 'Building') {
        frame.building = { buildingId: idOf(tag), name: null, measuredHeight: null,
          explicitPolygonCount: 0, installationPolygonCount: 0, byType: {} };
        stats.buildings.push(frame.building);
        frame.surface = null;
        frame.installation = false;
      }
      // BuildingPart polygons retain the owning top-level Building ID.
      if (surfaceTypes.has(tag.local)) frame.surface = tag.local;
      if (tag.local === 'BuildingInstallation' || tag.local === 'IntBuildingInstallation') frame.installation = true;
      if (tag.local === 'measuredHeight') frame.capture = 'measuredHeight';
    }
    if (isGml(tag) && tag.local === 'name' && frame.building && stack.length && parent?.building === frame.building) {
      // Only the Building's direct name, not names of its nested features.
      if (parent.isBuildingRoot) frame.capture = 'name';
    }
    frame.isBuildingRoot = isBuilding(tag) && tag.local === 'Building';
    stack.push(frame);
    if (!isGml(tag) || tag.local !== 'Polygon') return;
    stats.polygonCount++;
    const id = idOf(tag);
    if (!id) { stats.anonymousPolygonCount++; return; }
    const record = { type: frame.surface ?? (frame.installation ? 'BuildingInstallation' : null),
      installation: frame.installation, buildingId: frame.building?.buildingId ?? null };
    if (Object.hasOwn(polygons, id)) throw new Error(`Duplicate explicit polygon ID: ${id}`);
    polygons[id] = record;
    stats.explicitPolygonCount++;
    if (record.installation) stats.installationPolygonCount++;
    if (record.type === null) stats.unclassifiedPolygonCount++;
    const key = record.type ?? 'Unclassified';
    stats.byType[key] = (stats.byType[key] ?? 0) + 1;
    if (frame.building) {
      frame.building.explicitPolygonCount++;
      frame.building.installationPolygonCount += Number(record.installation);
      frame.building.byType[key] = (frame.building.byType[key] ?? 0) + 1;
    }
  });
  parser.on('text', text => {
    const frame = stack.at(-1);
    if (frame?.capture) frame.text += text;
  });
  parser.on('closetag', () => {
    const frame = stack.pop();
    if (!frame.capture || !frame.building) return;
    const value = frame.text.trim();
    if (frame.capture === 'name') frame.building.name ??= value;
    if (frame.capture === 'measuredHeight' && value && Number.isFinite(Number(value))) {
      frame.building.measuredHeight = Math.max(frame.building.measuredHeight ?? 0, Number(value));
    }
  });
  for await (const chunk of stream) parser.write(chunk);
  parser.close();
  return stats;
}

export async function main() {
  const directory = path.join(root, sourceDirectory);
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('gml')).sort();
  if (!files.length) throw new Error(`No GML files in ${directory}`);
  const additionalPath = path.join(root, path.dirname(outputFile), 'additional-geometry.json');
  const additional = await fs.readFile(additionalPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { sources: [] };
    throw error;
  });
  const expectedSources = new Map((additional.sources ?? []).map(source => [path.basename(source.path), source]));
  for (const name of expectedSources.keys()) {
    if (!files.includes(name)) throw new Error(`Awaiting additional geometry source GML: ${name}`);
  }
  const polygons = Object.create(null);
  const sourceFiles = [];
  for (const name of files) {
    const relativePath = `${sourceDirectory}/${name}`;
    const absolutePath = path.join(root, relativePath);
    const before = await fs.stat(absolutePath);
    const hash = createHash('sha256');
    let checksum = 0, bytes = 0;
    async function* input() {
      const decoder = new StringDecoder('utf8');
      for await (const chunk of createReadStream(absolutePath, { highWaterMark: 64 * 1024 })) {
        hash.update(chunk);
        checksum = crc32(chunk, checksum);
        bytes += chunk.length;
        yield decoder.write(chunk);
      }
      yield decoder.end();
    }
    const stats = await extractSemantics(input(), polygons);
    const sha256 = hash.digest('hex');
    const after = await fs.stat(absolutePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source changed while reading: ${name}`);
    const expected = expectedSources.get(name);
    if (expected && (bytes !== expected.bytes || checksum !== expected.crc32 || sha256 !== expected.sha256)) {
      throw new Error(`Source size/CRC32/SHA256 mismatch against additional-geometry.json: ${name}`);
    }
    sourceFiles.push({ path: relativePath, bytes, crc32: checksum, sha256,
      verifiedAgainstAdditionalGeometry: Boolean(expected), ...stats });
    console.log(JSON.stringify({ sourceFile: name, ...stats, buildings: stats.buildings.length }));
  }
  const currentFiles = (await fs.readdir(directory)).filter(name => name.endsWith('gml')).sort();
  if (JSON.stringify(currentFiles) !== JSON.stringify(files)) throw new Error('GML inventory changed during extraction; rerun to include new meshes.');
  const result = { polygons, sourceFiles, polygonCount: Object.keys(polygons).length,
    classification: { surface: 'Nearest CityGML building boundary surface ancestor (WallSurface, RoofSurface, GroundSurface, ClosureSurface, OuterCeilingSurface, OuterFloorSurface, InteriorWallSurface, CeilingSurface, FloorSurface)',
      installation: 'Any BuildingInstallation or IntBuildingInstallation ancestor, independent of surface type',
      buildingId: 'Owning top-level bldg:Building gml:id, including BuildingPart descendants',
      unclassified: 'type:null means no semantic surface or installation ancestor; main must use wallset/geometric fallback',
      anonymous: 'Polygons without explicit gml:id are counted but omitted; no coordinate hashes are invented' },
    tallBuildings: sourceFiles.flatMap(source => source.buildings.filter(b => b.measuredHeight >= 60)
      .map(building => ({ sourceFile: source.path, ...building }))) };
  await fs.mkdir(path.dirname(path.join(root, outputFile)), { recursive: true });
  await fs.writeFile(path.join(root, outputFile), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ outputFile, polygonCount: result.polygonCount, tallBuildings: result.tallBuildings }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
