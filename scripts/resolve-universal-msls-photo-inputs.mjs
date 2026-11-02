import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

const jobsPath = 'public/assets/universal-all-areas/photo-registration-jobs.json';
const photosPath = 'data/texture-city/msls/photos.json';
const locationsPath = 'data/texture-city/msls/locations.json';
const snapRoot = 'data/texture-city/msls/snap-prepared';
const photoRoot = 'data/texture-city/photos/msls';
const outputPath = 'public/assets/universal-all-areas/msls-photo-input-resolution.json';

const [jobsFile, photos, locationsFile] = await Promise.all([
  readFile(jobsPath, 'utf8'),
  readFile(photosPath, 'utf8').then(JSON.parse),
  readFile(locationsPath, 'utf8').then(JSON.parse),
]);

const jobs = JSON.parse(jobsFile).jobs;
const photoById = new Map(photos.map((p) => [p.id, p]));
const locationById = new Map((locationsFile.locations ?? []).map((p) => [p.id, p]));
const snapEntries = await readdir(snapRoot);

function resolveImage(job) {
  const photo = photoById.get(job.imageId);
  if (!photo) return { status: 'photo-metadata-missing' };

  const location = locationById.get(job.imageId);
  const entry = photo.image?.entry;
  const candidates = [
    `${snapRoot}/${job.imageId}`,
    `${snapRoot}/${photo.id}`,
    ...snapEntries.filter((entry) => entry.startsWith(`${photo.id}-`)).map((entry) => `${snapRoot}/${entry}`),
  ];
  const directory = candidates.find((p) => existsSync(p)) ?? null;
  const preparedPath = directory && existsSync(`${directory}/image.png`) ? `${directory}/image.png` : null;
  const fallbackPath = existsSync(`${photoRoot}/${job.imageId}.jpg`) ? `${photoRoot}/${job.imageId}.jpg` : null;
  const path = preparedPath ?? fallbackPath;

  return {
    status: path ? 'resolved' : 'metadata-resolved-image-path-pending',
    imageId: photo.id,
    sequenceId: photo.sequenceId,
    sequenceIndex: photo.sequenceIndex,
    entry,
    locationId: location?.id ?? null,
    coordinates: location?.coordinates ?? [photo.lng ?? photo.lon, photo.lat],
    resolvedPath: path,
    preparedDirectory: directory,
    sourcePage: photo.sourcePage,
    license: photo.license,
  };
}

const limit = Number(process.argv[2] ?? jobs.length);
const records = jobs.slice(0, limit).map((job) => ({
  surfaceId: job.surfaceId,
  buildingId: job.buildingId,
  ...resolveImage(job),
}));

await writeFile(outputPath, JSON.stringify({
  method: 'msls-composite-key-resolution-v2',
  records,
  resolved: records.filter((r) => r.status === 'resolved').length,
  metadataResolved: records.filter((r) => r.status.includes('metadata')).length,
  missing: records.filter((r) => r.status.includes('missing')).length,
}, null, 2), 'utf8');

console.log(JSON.stringify({ records: records.length, outputPath }));
