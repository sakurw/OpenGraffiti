// Rebuild the local MSLS photo cache from the historically tracked, deleted
// public/assets/texture-poc/msls snapshot without restoring that deleted tree.
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const recoveryRoot = process.argv[2];
if (!recoveryRoot) throw new Error('Usage: node scripts/texture-msls-recover-tracked.mjs <recovery-root>');

const sourceRoot = path.resolve(recoveryRoot, 'public/assets/texture-poc/msls');
const imageRoot = path.join(sourceRoot, 'images');
const manifestRecord = JSON.parse(await readFile(path.join(sourceRoot, 'photos.json'), 'utf8'));
const manifest = Array.isArray(manifestRecord) ? manifestRecord : manifestRecord.photos;
if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('Invalid tracked MSLS manifest');

const photoRoot = path.resolve('data/texture-city/photos/msls');
const mslsRoot = path.resolve('data/texture-city/msls');
await mkdir(photoRoot, {recursive: true});
await mkdir(mslsRoot, {recursive: true});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
for (const row of manifest) {
  const source = path.join(imageRoot, `${row.id}.jpg`);
  const bytes = await readFile(source);
  const sha256 = digest(bytes);
  if (sha256 !== row.sha256) throw new Error(`Source hash mismatch: ${row.id}`);
  const [width, height] = row.size ?? [];
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error(`Invalid image size: ${row.id}`);
  const record = {
    id: row.id,
    key: row.id,
    provider: 'msls',
    areaIds: row.areas,
    sequenceId: row.sequence,
    sequenceIndex: Number(row.frame),
    status: 'downloaded',
    sha256,
    downloadSize: [width, height],
    exifOrientation: 1,
    shotDate: row.date,
    lat: Number(row.lat),
    lng: Number(row.lon),
    lon: Number(row.lon),
    ca: Number(row.heading),
    compassAngle: Number(row.heading),
    gpsAccuracy: null,
    sourcePage: 'https://github.com/mapillary/mapillary_sls',
    license: 'CC BY-NC-SA (dataset LICENSE.txt links to by-nc/4.0; contradictory wording retained)',
    projection: 'UNCONFIRMED',
    pano: 'False',
    registration: 'unregistered',
    image: {archive: row.archive, entry: row.entry},
    recoveredFromTrackedSnapshot: true,
  };
  if (!record.areaIds?.length || !record.sequenceId || !Number.isFinite(record.sequenceIndex) ||
      !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
    throw new Error(`Incomplete tracked metadata: ${row.id}`);
  }
  await copyFile(source, path.join(photoRoot, `${row.id}.jpg`));
  await writeFile(path.join(photoRoot, `${row.id}.json`), JSON.stringify(record, null, 2));
  records.push(record);
}

const license = await readFile(path.join(sourceRoot, 'LICENSE.txt'));
await writeFile(path.join(mslsRoot, 'LICENSE.txt'), license);
await writeFile(path.join(mslsRoot, 'photos.json'), JSON.stringify(records, null, 2));
console.log(JSON.stringify({photos: records.length, sequences: new Set(records.map(p => p.sequenceId)).size,
  areas: Object.fromEntries([...new Set(records.flatMap(p => p.areaIds))].sort().map(area => [area, records.filter(p => p.areaIds.includes(area)).length]))}));
