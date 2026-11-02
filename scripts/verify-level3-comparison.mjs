import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const URL = process.env.LEVEL3_COMPARISON_URL || 'http://127.0.0.1:3100/level3-comparison.html';
const TMP = 'C:/Users/sakur/AppData/Local/Temp';
const reportPath = 'public/assets/level3-demo/verification.json';
const metadataPath = 'public/assets/level3-demo/comparison.json';
const fullShot = `${TMP}/opengraffiti-level3-4way-full.png`;
const referenceShot = `${TMP}/opengraffiti-level3-4way-reference.png`;

const panes = [
  { key: 'neutral', canvas: `${TMP}/opengraffiti-level3-neutral.png` },
  { key: 'phase123', canvas: `${TMP}/opengraffiti-level3-phase123.png` },
  { key: 'recommended', canvas: `${TMP}/opengraffiti-level3-recommended.png` },
  { key: 'recommendedPlus', canvas: `${TMP}/opengraffiti-level3-recommendedPlus.png` },
];

function distanceRgb(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function rawRgb(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function cornerBackground(image) {
  const patch = Math.max(8, Math.min(28, Math.floor(Math.min(image.width, image.height) * 0.04)));
  const starts = [
    [0, 0],
    [image.width - patch, 0],
    [0, image.height - patch],
    [image.width - patch, image.height - patch],
  ];
  const sum = [0, 0, 0];
  let count = 0;
  for (const [sx, sy] of starts) {
    for (let y = sy; y < sy + patch; y += 1) {
      for (let x = sx; x < sx + patch; x += 1) {
        const i = (y * image.width + x) * image.channels;
        sum[0] += image.data[i];
        sum[1] += image.data[i + 1];
        sum[2] += image.data[i + 2];
        count += 1;
      }
    }
  }
  return sum.map((value) => value / count);
}

async function foregroundStats(path) {
  const image = await rawRgb(path);
  const bg = cornerBackground(image);
  let foreground = 0;
  let chromatic = 0;
  const pixels = image.width * image.height;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * image.channels;
      const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
      if (distanceRgb(rgb, bg) > 12) foreground += 1;
      if (Math.max(...rgb) - Math.min(...rgb) > 8) chromatic += 1;
    }
  }
  return {
    width: image.width,
    height: image.height,
    backgroundRgb: bg.map((value) => +value.toFixed(1)),
    foregroundRatio: +(foreground / pixels).toFixed(4),
    chromaticRatio: +(chromatic / pixels).toFixed(4),
  };
}

async function pairDifference(pathA, pathB) {
  const a = await rawRgb(pathA);
  const b = await rawRgb(pathB);
  if (Math.abs(a.width - b.width) > 2 || Math.abs(a.height - b.height) > 2) {
    throw new Error(`canvas size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let meaningful = 0;
  let total = 0;
  const pixels = width * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (y * a.width + x) * a.channels;
      const bi = (y * b.width + x) * b.channels;
      const d = (
        Math.abs(a.data[ai] - b.data[bi])
        + Math.abs(a.data[ai + 1] - b.data[bi + 1])
        + Math.abs(a.data[ai + 2] - b.data[bi + 2])
      ) / 3;
      total += d;
      if (d > 10) meaningful += 1;
    }
  }
  return {
    meaningfulDifferenceRatio: +(meaningful / pixels).toFixed(4),
    meanAbsoluteRgbDifference: +(total / pixels).toFixed(3),
  };
}

async function prepareForOcr(inputPath, outputPath) {
  const meta = await sharp(inputPath).metadata();
  await sharp(inputPath)
    .resize({ width: Math.max(1800, (meta.width || 300) * 6), kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toFile(outputPath);
}

function compactOcr(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});

const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const pageErrors = [];
const failedResponses = [];

page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});
page.on('requestfailed', (request) => {
  failedResponses.push(`requestfailed ${request.url()} ${request.failure()?.errorText || ''}`.trim());
});

let response;
let state;
try {
  response = await page.goto(URL, { waitUntil: 'commit', timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.dataset.comparisonReady === 'true', null, { timeout: 90_000 });
  await page.waitForTimeout(1_000);

  state = await page.evaluate(() => {
    const readPane = (key) => {
      const pane = document.querySelector(`#pane-${key}`);
      const canvas = document.querySelector(`#view-${key} canvas`);
      return {
        loaded: pane?.dataset.loaded,
        meshCount: Number(pane?.dataset.meshCount || 0),
        triangleCount: Number(pane?.dataset.triangleCount || 0),
        baseMeshCount: Number(pane?.dataset.baseMeshCount || 0),
        baseTriangleCount: Number(pane?.dataset.baseTriangleCount || 0),
        sEnhanced: pane?.dataset.sEnhanced,
        sMaterialCount: Number(pane?.dataset.sMaterialCount || 0),
        sGlassMeshCount: Number(pane?.dataset.sGlassMeshCount || 0),
        sInteriorMeshCount: Number(pane?.dataset.sInteriorMeshCount || 0),
        macroWeathering: pane?.dataset.macroWeathering,
        glassCellVariation: pane?.dataset.glassCellVariation,
        structuredEnvironmentReflection: pane?.dataset.structuredEnvironmentReflection,
        glassInteriorVariation: pane?.dataset.glassInteriorVariation,
        glassInteriorParallax: pane?.dataset.glassInteriorParallax,
        glassOpticalWaviness: pane?.dataset.glassOpticalWaviness,
        facadeProfileBevel: pane?.dataset.facadeProfileBevel,
        status: document.querySelector(`#status-${key}`)?.textContent,
        canvasWidth: canvas?.width || 0,
        canvasHeight: canvas?.height || 0,
      };
    };
    const reference = document.querySelector('.reference img');
    return {
      ready: document.documentElement.dataset.comparisonReady,
      overall: document.querySelector('#overall')?.textContent,
      neutral: readPane('neutral'),
      phase123: readPane('phase123'),
      recommended: readPane('recommended'),
      recommendedPlus: readPane('recommendedPlus'),
      reference: {
        complete: reference?.complete === true,
        width: reference?.naturalWidth || 0,
        height: reference?.naturalHeight || 0,
      },
    };
  });

  await page.screenshot({ path: fullShot, fullPage: true });
  for (const pane of panes) {
    await page.locator(`#view-${pane.key} canvas`).screenshot({ path: pane.canvas });
    pane.statusRaw = `${TMP}/opengraffiti-level3-${pane.key}-status.png`;
    pane.statusOcr = `${TMP}/opengraffiti-level3-${pane.key}-status-ocr.png`;
    await page.locator(`#status-${pane.key}`).screenshot({ path: pane.statusRaw });
  }
  await page.locator('.reference img').screenshot({ path: referenceShot });
} finally {
  await browser.close();
}

const foreground = {};
for (const pane of panes) foreground[pane.key] = await foregroundStats(pane.canvas);
const differences = {
  neutralToPhase123: await pairDifference(panes[0].canvas, panes[1].canvas),
  phase123ToRecommended: await pairDifference(panes[1].canvas, panes[2].canvas),
  recommendedToRecommendedPlus: await pairDifference(panes[2].canvas, panes[3].canvas),
};

for (const pane of panes) await prepareForOcr(pane.statusRaw, pane.statusOcr);
const worker = await createWorker('eng');
const ocr = {};
for (const pane of panes) {
  const result = await worker.recognize(pane.statusOcr);
  ocr[pane.key] = {
    text: compactOcr(result.data.text),
    confidence: +result.data.confidence.toFixed(1),
  };
}
await worker.terminate();

const models = [state.neutral, state.phase123, state.recommended, state.recommendedPlus];
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const networkPass = response?.status() === 200 && pageErrors.length === 0 && failedResponses.length === 0;
const modelPass = state.ready === 'true' && models.every((model) => (
  model.loaded === 'true'
  && model.meshCount > 0
  && model.triangleCount > 0
  && model.canvasWidth > 0
  && model.canvasHeight > 0
));
const geometryPass = state.neutral.triangleCount === metadata.originalTriangles
  && state.phase123.triangleCount === metadata.renderedTriangles
  && state.recommended.triangleCount === metadata.renderedTriangles
  && state.recommendedPlus.baseTriangleCount === metadata.renderedTriangles
  && state.recommendedPlus.triangleCount > state.recommendedPlus.baseTriangleCount
  && state.recommendedPlus.meshCount > state.recommendedPlus.baseMeshCount
  && metadata.building?.id === 'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7'
  && metadata.building?.lod === 2;
const sourceImagePass = state.reference.complete && state.reference.width > 0 && state.reference.height > 0;
const visiblePass = Object.values(foreground).every((item) => item.foregroundRatio > 0.035);
const distinctPass = differences.neutralToPhase123.meaningfulDifferenceRatio > 0.01
  && differences.neutralToPhase123.meanAbsoluteRgbDifference > 1
  && differences.phase123ToRecommended.meaningfulDifferenceRatio > 0.002
  && differences.phase123ToRecommended.meanAbsoluteRgbDifference > 0.2
  && differences.recommendedToRecommendedPlus.meaningfulDifferenceRatio > 0.002
  && differences.recommendedToRecommendedPlus.meanAbsoluteRgbDifference > 0.15;
const ocrPass = Object.values(ocr).every((item) => /mesh/i.test(item.text) && /triangle/i.test(item.text));
const semanticPass = Object.keys(metadata.palette || {}).length >= 15
  && Object.keys(metadata.phase123ClassTriangles || {}).length >= 15
  && (metadata.descriptorStats?.windowEligiblePolygons || 0) > 0
  && (metadata.descriptorStats?.windowExcludedPolygons || 0) > 0
  && (metadata.descriptorStats?.nonWallPolygons || 0) > 0;
const evidencePass = (metadata.descriptorStats?.evidenceMatchedPolygons || 0) > 0
  && (metadata.descriptorStats?.evidenceWallCoverage || 0) > 0.90
  && (metadata.sPriorityRealism?.dataAssessment?.plateauAlignedPolygons || 0) >= 140
  && (metadata.recommendedEvidenceStats?.alignedTriangles || 0) > 0
  && (metadata.recommendedEvidenceStats?.semanticOverrides || 0) > 0;
const sPriorityPass = state.recommendedPlus.sEnhanced === 'true'
  && state.recommendedPlus.sMaterialCount > 0
  && state.recommendedPlus.sGlassMeshCount > 0
  && state.recommendedPlus.sInteriorMeshCount === state.recommendedPlus.sGlassMeshCount
  && metadata.sPriorityRealism?.runtimeAugmentation === true
  && metadata.sPriorityRealism?.sourceModel === 'recommended'
  && metadata.methodProfiles?.recommendedPlus?.includes('7-procedural-micro-normal')
  && metadata.methodProfiles?.recommendedPlus?.includes('8-spatial-roughness')
  && metadata.methodProfiles?.recommendedPlus?.includes('9-physical-glass')
  && metadata.methodProfiles?.recommendedPlus?.includes('10-contact-joint-shadow')
  && metadata.methodProfiles?.recommendedPlus?.includes('11-macro-weathering-aperiodic-roughness')
  && metadata.methodProfiles?.recommendedPlus?.includes('12-glass-floor-bay-reflection-variation')
  && metadata.methodProfiles?.recommendedPlus?.includes('13-structured-environment-reflection')
  && metadata.methodProfiles?.recommendedPlus?.includes('14-glass-interior-depth-variation')
  && metadata.methodProfiles?.recommendedPlus?.includes('15-glass-optical-waviness')
  && metadata.methodProfiles?.recommendedPlus?.includes('16-facade-profile-bevel')
  && state.recommendedPlus.macroWeathering === 'true'
  && state.recommendedPlus.glassCellVariation === 'true'
  && state.recommendedPlus.structuredEnvironmentReflection === 'true'
  && state.recommendedPlus.glassInteriorVariation === 'true'
  && state.recommendedPlus.glassInteriorParallax === 'true'
  && state.recommendedPlus.glassOpticalWaviness === 'true'
  && state.recommendedPlus.facadeProfileBevel === 'true';

const checks = {
  networkPass,
  modelPass,
  geometryPass,
  sourceImagePass,
  visiblePass,
  distinctPass,
  ocrPass,
  semanticPass,
  evidencePass,
  sPriorityPass,
};

const verification = {
  verifiedAt: new Date().toISOString(),
  url: URL,
  viewport: { width: 1366, height: 768 },
  http: response?.status(),
  state,
  checks,
  foreground,
  differences,
  ocr,
  metadataSummary: {
    building: metadata.building,
    originalTriangles: metadata.originalTriangles,
    renderedTriangles: metadata.renderedTriangles,
    descriptorStats: metadata.descriptorStats,
    recommendedEvidenceStats: metadata.recommendedEvidenceStats,
    sPriorityRealism: metadata.sPriorityRealism,
  },
  errors: pageErrors,
  failedResponses,
  artifacts: {
    fullShot,
    referenceShot,
    neutralCanvas: panes[0].canvas,
    phase123Canvas: panes[1].canvas,
    recommendedCanvas: panes[2].canvas,
    recommendedPlusCanvas: panes[3].canvas,
  },
};

console.log(JSON.stringify(verification, null, 2));
if (!Object.values(checks).every(Boolean)) process.exit(2);
await writeFile(reportPath, `${JSON.stringify(verification, null, 2)}\n`);
