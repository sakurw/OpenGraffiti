import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:3100';
const pagePath = '/universal-texture-demo.html';
const caseId = 'shinjuku-mitsui-no2-southeast';
const extendedWallId = 'poly-8acbeef3-2647-45e4-9116-8a96c1fd851a';
const narrowObservedWallId = 'poly-3519d115-dc78-4c6e-af6f-8ff0772a50f2';
const required = [
  pagePath,
  '/vendor/three.module.js',
  '/vendor/GLTFLoader.js',
  '/vendor/meshopt_decoder.module.js',
  '/vendor/OrbitControls.js',
  `/assets/texture-poc/experimental/snap/cases/${caseId}.json`,
  `/assets/texture-poc/experimental/snap/${caseId}-geometry-only.glb`,
  `/assets/texture-poc/experimental/snap/${caseId}-evidence.glb`,
  `/assets/texture-poc/experimental/snap/${caseId}-raw.glb`,
  `/assets/texture-poc/experimental/snap/${caseId}-quality.glb`,
  `/assets/texture-poc/experimental/snap/${caseId}-semantic.glb`,
  `/assets/texture-poc/experimental/snap/${caseId}.glb`,
  `/assets/texture-poc/experimental/snap/${caseId}-source.jpg`,
  `/assets/texture-poc/experimental/snap/${caseId}-source-6006153.jpg`
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', error => errors.push(error.message));

const statuses = {};
for (const path of required) {
  const response = await page.request.get(base + path);
  statuses[path] = response.status();
  if (!response.ok()) throw new Error(`${path} returned HTTP ${response.status()}`);
}
const reportResponse = await page.request.get(base + `/assets/texture-poc/experimental/snap/cases/${caseId}.json`);
const report = await reportResponse.json();
if (report.registration !== 'estimated-held-out-validated') throw new Error(`Unexpected registration status: ${report.registration}`);
if (!report.independentValidation?.passed) throw new Error('Independent camera validation did not pass');
if (report.independentValidation.selectedIndependentEdges < 3) throw new Error('Independent validation has too few held-out edges');
if (!report.qualityGates?.passed) throw new Error('Facade color quality gates did not pass');
if (report.sources?.length !== 2 || report.sourceCollection?.commons?.acquiredExactMatches !== 2) throw new Error('Two exact-building Commons sources were not recorded');
if (report.sourceCollection.commons.discovered < 590 || report.sourceCollection.commons.licenseAccepted < 580) throw new Error('Widened Commons discovery was not recorded');
if (!report.sources.find(source => source.role === 'unregistered-palette-validation')?.paletteValidation?.passed) throw new Error('Secondary palette validation did not pass');
if (!report.sourceDuplicateAudit?.unique) throw new Error('Source duplicate audit did not pass');
if (report.sourceCollection?.kartaview?.usableForColor !== 0) throw new Error('Rejected KartaView night frames were incorrectly counted as color evidence');
if (report.sourceCollection.kartaview.discovered < 1100 || report.sourceCollection.kartaview.acquired < 420 || report.sourceCollection.kartaview.shortlisted !== 15) throw new Error('Expanded KartaView discovery and audit were not recorded');
if (report.albedoNormalization.correctedDirectionalMedianDeltaE >= report.albedoNormalization.rawDirectionalMedianDeltaE) throw new Error('Directional color harmonization did not improve Delta E');
if (report.albedoNormalization.correctedDirectionalMedianDeltaE > report.qualityGates.maximumCorrectedDirectionalMedianDeltaE) throw new Error('Corrected directional color mismatch exceeds the gate');
if (!(report.colorCoverage?.observedWallRatio > 0 && report.colorCoverage?.observedWallRatio < 1)) throw new Error('Observed/inferred wall coverage is not explicitly partitioned');
if (!report.provenanceClasses?.some(item => item.id === 'observed-photo-albedo-normalized') || !report.provenanceClasses?.some(item => item.id === 'same-surface-observed-pattern-extension') || !report.provenanceClasses?.some(item => item.id === 'ground-photo-pattern-with-plateau-appearance-support') || !report.provenanceClasses?.some(item => item.id === 'plateau-appearance-solid-wall') || !report.provenanceClasses?.some(item => item.id === 'plateau-appearance-robust-palette')) throw new Error('Observed, same-surface extension, inferred, solid-wall, and PLATEAU appearance provenance classes are missing');
const semanticEvidence = report.semanticEvidence;
if (semanticEvidence?.polygonClassCounts?.WallSurface !== 26 || semanticEvidence?.polygonClassCounts?.RoofSurface !== 14 || semanticEvidence?.polygonClassCounts?.GroundSurface !== 1 || semanticEvidence?.polygonClassCounts?.OuterBuildingInstallation !== 140) throw new Error(`Unexpected semantic polygon counts: ${JSON.stringify(semanticEvidence?.polygonClassCounts)}`);
if (semanticEvidence.appearanceEvidence?.coverageRatio < 0.85 || semanticEvidence.appearanceEvidence?.texturedPolygons !== 161) throw new Error('PLATEAU appearance evidence coverage is missing or too low');
if (semanticEvidence.appearanceEvidence?.sourceImages?.length !== 4 || report.sourcePreviews?.length !== 6) throw new Error('Ground-photo and PLATEAU appearance evidence previews are incomplete');
if (semanticEvidence.evidenceExpandedCoverage?.directAppearancePolygons !== 161 || semanticEvidence.evidenceExpandedCoverage?.sameSemanticObjectTransferredPolygons !== 19 || semanticEvidence.evidenceExpandedCoverage?.supportedPolygons !== 180 || semanticEvidence.evidenceExpandedCoverage?.priorOnlyPolygons !== 1) throw new Error(`Unexpected expanded evidence coverage: ${JSON.stringify(semanticEvidence.evidenceExpandedCoverage)}`);
const wallEligibility = semanticEvidence.wallPatternEligibility?.counts;
if (wallEligibility?.eligible !== 6 || wallEligibility?.['suppressed-on-recessed-or-service-wall'] !== 3 || wallEligibility?.['suppressed-on-parapet-or-short-wall'] !== 17) throw new Error(`Unexpected wall-pattern eligibility: ${JSON.stringify(wallEligibility)}`);
const effectiveWallEligibility = semanticEvidence.effectiveWallPatternEligibility?.counts;
if (effectiveWallEligibility?.eligible !== 7 || effectiveWallEligibility?.['suppressed-on-recessed-or-service-wall'] !== 2 || effectiveWallEligibility?.['suppressed-on-parapet-or-short-wall'] !== 17) throw new Error(`Unexpected evidence-aware wall-pattern eligibility: ${JSON.stringify(effectiveWallEligibility)}`);
if (semanticEvidence.sameSurfaceExtensions?.length !== 1) throw new Error(`Expected one same-WallSurface evidence extension: ${JSON.stringify(semanticEvidence.sameSurfaceExtensions)}`);
const sameSurfaceExtension = semanticEvidence.sameSurfaceExtensions[0];
if (sameSurfaceExtension.polygonId !== extendedWallId || sameSurfaceExtension.directObservedRatio < .4 || sameSurfaceExtension.directObservedArea < 800 || sameSurfaceExtension.extendedArea < 1000) throw new Error(`Same-WallSurface extension does not preserve the expected direct evidence and extension boundary: ${JSON.stringify(sameSurfaceExtension)}`);
if (semanticEvidence.sameSurfaceExtensions.some(item => item.polygonId === narrowObservedWallId)) throw new Error('A narrow weakly observed wall was incorrectly expanded');
if (report.colorCoverage?.sameSurfaceExtensionPolygons !== 1 || report.colorCoverage?.sameSurfaceExtendedArea < 1000) throw new Error(`Same-WallSurface extension coverage is missing: ${JSON.stringify(report.colorCoverage)}`);
if (semanticEvidence.plateauSemantics?.windowPolygonCount !== 0 || semanticEvidence.sourceLimits?.individualWindowGeometryAvailable !== false) throw new Error('Missing window geometry was not explicitly represented');
if (semanticEvidence.installationGroups?.length !== 2 || semanticEvidence.installationGroups.some(item => item.exactEquipmentTypeAvailable !== false)) throw new Error('BuildingInstallation groups or their unresolved functions are not explicit');
if (semanticEvidence.installationGroups.some(item => !item.palette?.renderRgb || Math.max(...item.palette.renderRgb) - Math.min(...item.palette.renderRgb) > 0.04 || !/chroma reduced/.test(item.palette.stylingPolicy))) throw new Error('Equipment palettes are not subdued evidence-derived industrial colors');
if (!semanticEvidence.facadePatterns?.every(item => item.glazingBandDetected && item.individualWindowsResolved === false)) throw new Error('Facade element hypotheses are missing or incorrectly claim individual windows');
if (report.surfaceQuality?.length !== report.colorCoverage.basePolygons || !report.qualityByProvenance?.length) throw new Error('Per-surface quality audit is incomplete');
for (const preview of report.sourcePreviews) {
  const response = await page.request.get(base + preview.url);
  if (!response.ok()) throw new Error(`${preview.url} returned HTTP ${response.status()}`);
}

await page.goto(base + pagePath, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const views = window.__universalComparison?.views;
  return views?.geometry?.loaded && views?.reconstructed?.loaded;
}, null, { timeout: 60_000 });
await page.waitForFunction(expected => [...document.querySelectorAll('#source-photos img')].length === expected && [...document.querySelectorAll('#source-photos img')].every(image => image.complete && image.naturalWidth > 0), report.sourcePreviews.length, { timeout: 30_000 });

const initial = await page.evaluate(() => {
  const state = window.__universalComparison;
  return {
    canvases: document.querySelectorAll('canvas').length,
    sourceImages: document.querySelectorAll('#source-photos img').length,
    geometry: {
      meshes: state.views.geometry.meshCount,
      texturedMaterials: state.views.geometry.texturedMaterialCount,
      camera: state.views.geometry.camera.position.toArray()
    },
    reconstructed: {
      meshes: state.views.reconstructed.meshCount,
      texturedMaterials: state.views.reconstructed.texturedMaterialCount,
      camera: state.views.reconstructed.camera.position.toArray(),
      wallPatternAudit: (() => {const rows=[];state.views.reconstructed.root.traverse(object=>{if(object.isMesh&&object.userData?.semanticClass==='WallSurface'){const materials=Array.isArray(object.material)?object.material:[object.material];rows.push({polygonId:object.userData.polygonId,geometryEligible:object.userData.geometryFacadePatternEligible,eligible:object.userData.facadePatternEligible,policy:object.userData.windowPatternPolicy,extension:object.userData.sameSurfaceExtension,provenance:object.userData.provenance,textured:materials.some(material=>Boolean(material?.map))});}});return rows;})()
    },
    modelErrors: state.errors
  };
});

if (initial.canvases !== 2) throw new Error(`Expected 2 canvases, got ${initial.canvases}`);
if (initial.sourceImages !== report.sourcePreviews.length) throw new Error(`Expected ${report.sourcePreviews.length} source previews, got ${initial.sourceImages}`);
if (initial.geometry.meshes < 1 || initial.reconstructed.meshes < 1) throw new Error('One or both GLB models contain no rendered meshes');
if (initial.geometry.meshes !== initial.reconstructed.meshes) throw new Error(`Geometry and reconstructed models do not contain the same mesh count (${initial.geometry.meshes} vs ${initial.reconstructed.meshes})`);
if (initial.geometry.texturedMaterials !== 0) throw new Error('Geometry-only side still contains displayed texture materials');
if (initial.reconstructed.texturedMaterials !== 7) throw new Error(`Expected 7 evidence-aware textured wall materials, got ${initial.reconstructed.texturedMaterials}`);
if (initial.reconstructed.wallPatternAudit.length !== 26) throw new Error('Clean model wall-pattern audit is incomplete');
if (initial.reconstructed.wallPatternAudit.filter(item => item.eligible).length !== 7 || initial.reconstructed.wallPatternAudit.some(item => item.eligible !== item.textured)) throw new Error(`Window pattern was applied outside evidence-aware eligible facades: ${JSON.stringify(initial.reconstructed.wallPatternAudit)}`);
const extendedWall = initial.reconstructed.wallPatternAudit.find(item => item.polygonId === extendedWallId);
if (!extendedWall || extendedWall.geometryEligible !== false || extendedWall.eligible !== true || extendedWall.textured !== true || extendedWall.provenance !== 'same-surface-observed-pattern-extension' || extendedWall.extension?.directObservedRatio < .4 || extendedWall.extension?.extendedArea < 1000) throw new Error(`Direct evidence did not override geometric suppression on its same WallSurface: ${JSON.stringify(extendedWall)}`);
const narrowObservedWall = initial.reconstructed.wallPatternAudit.find(item => item.polygonId === narrowObservedWallId);
if (!narrowObservedWall || narrowObservedWall.geometryEligible !== false || narrowObservedWall.eligible !== false || narrowObservedWall.textured !== false || narrowObservedWall.extension) throw new Error(`Weak narrow-wall evidence was incorrectly expanded: ${JSON.stringify(narrowObservedWall)}`);
if (initial.modelErrors.length || errors.length) throw new Error(`Browser errors: ${[...initial.modelErrors, ...errors].join(' | ')}`);

await page.screenshot({ path: 'test-results/universal-comparison-http.png', fullPage: true });
const extensionPick = await page.evaluate(targetPolygonId => {
  const state = window.__universalComparison;
  let target = null;
  state.views.reconstructed.root.traverse(object => { if (object.isMesh && object.userData?.polygonId === targetPolygonId) target = object; });
  if (!target) return { error: 'target mesh missing' };
  target.geometry.computeBoundingBox();
  const center = target.geometry.boundingBox.getCenter(target.position.clone());
  target.localToWorld(center);
  center.project(state.views.reconstructed.camera);
  const rect = state.views.reconstructed.renderer.domElement.getBoundingClientRect();
  const clientX = rect.left + (center.x + 1) * rect.width / 2;
  const clientY = rect.top + (1 - center.y) * rect.height / 2;
  const picked = state.views.reconstructed.pickAt(clientX, clientY);
  return { picked, panelText: document.querySelector('#surface-info')?.textContent, clientX, clientY };
}, extendedWallId);
if (extensionPick.picked?.polygonId !== extendedWallId || !/面内補完/.test(extensionPick.panelText) || !/直接観測 43%/.test(extensionPick.panelText)) throw new Error(`Same-WallSurface extension is not inspectable in the 3D comparison: ${JSON.stringify(extensionPick)}`);
await page.screenshot({ path: 'test-results/universal-comparison-same-surface-extension.png', fullPage: true });

await page.locator('#show-quality').click();
await page.waitForFunction(() => window.__universalComparison?.activeVariant === 'quality', null, { timeout: 60_000 });
const qualityView = await page.evaluate(() => ({variant:window.__universalComparison.activeVariant,meshes:window.__universalComparison.views.reconstructed.meshCount,texturedMaterials:window.__universalComparison.views.reconstructed.texturedMaterialCount,errors:window.__universalComparison.errors}));
if (qualityView.meshes <= initial.geometry.meshes || qualityView.errors.length) throw new Error(`Quality model did not expose observed-region overlays: ${JSON.stringify(qualityView)}`);
await page.screenshot({ path: 'test-results/universal-comparison-quality.png', fullPage: true });

await page.locator('#show-semantic').click();
await page.waitForFunction(() => window.__universalComparison?.activeVariant === 'semantic', null, { timeout: 60_000 });
const semanticView = await page.evaluate(() => ({variant:window.__universalComparison.activeVariant,meshes:window.__universalComparison.views.reconstructed.meshCount,texturedMaterials:window.__universalComparison.views.reconstructed.texturedMaterialCount,errors:window.__universalComparison.errors}));
if (semanticView.meshes !== initial.geometry.meshes || semanticView.errors.length) throw new Error(`Semantic model did not load correctly: ${JSON.stringify(semanticView)}`);
const texturedCanvas = page.locator('#textured canvas');
const semanticBox = await texturedCanvas.boundingBox();
if (!semanticBox) throw new Error('Semantic canvas has no interactive bounds');
await page.mouse.click(semanticBox.x + semanticBox.width / 2, semanticBox.y + semanticBox.height / 2);
await page.waitForFunction(() => Boolean(window.__universalComparison?.lastPicked?.polygonId), null, { timeout: 10_000 });
const pickedSurface = await page.evaluate(() => window.__universalComparison.lastPicked);
if (!pickedSurface.semanticClass || typeof pickedSurface.confidence !== 'number' || !pickedSurface.semanticSource) throw new Error(`Surface picking did not expose semantic evidence: ${JSON.stringify(pickedSurface)}`);
await page.screenshot({ path: 'test-results/universal-comparison-semantics.png', fullPage: true });
await page.locator('#show-universal').click();
await page.waitForFunction(() => window.__universalComparison?.activeVariant === 'clean', null, { timeout: 60_000 });

await page.locator('#show-raw').click();
await page.waitForFunction(() => window.__universalComparison?.activeVariant === 'raw' && window.__universalComparison?.views?.reconstructed?.loaded, null, { timeout: 60_000 });
const rawControl = await page.evaluate(() => ({
  variant: window.__universalComparison.activeVariant,
  meshes: window.__universalComparison.views.reconstructed.meshCount,
  texturedMaterials: window.__universalComparison.views.reconstructed.texturedMaterialCount,
  errors: window.__universalComparison.errors
}));
if (rawControl.meshes < initial.geometry.meshes || rawControl.texturedMaterials < 1 || rawControl.errors.length) throw new Error(`Raw projection control did not load correctly: ${JSON.stringify(rawControl)}`);
await page.screenshot({ path: 'test-results/universal-comparison-raw-control.png', fullPage: true });
await page.locator('#show-corrected').click();
await page.waitForFunction(() => window.__universalComparison?.activeVariant === 'corrected', null, { timeout: 60_000 });
const evidenceOverlay = await page.evaluate(() => ({
  variant: window.__universalComparison.activeVariant,
  meshes: window.__universalComparison.views.reconstructed.meshCount,
  texturedMaterials: window.__universalComparison.views.reconstructed.texturedMaterialCount,
  errors: window.__universalComparison.errors
}));
if (evidenceOverlay.meshes < initial.geometry.meshes || evidenceOverlay.texturedMaterials < 1 || evidenceOverlay.errors.length) throw new Error(`Corrected evidence overlay did not load correctly: ${JSON.stringify(evidenceOverlay)}`);
await page.screenshot({ path: 'test-results/universal-comparison-evidence-overlay.png', fullPage: true });
await page.locator('#show-universal').click();
await page.waitForFunction(() => window.__universalComparison?.activeVariant === 'clean', null, { timeout: 60_000 });

const left = page.locator('#plain canvas');
const box = await left.boundingBox();
if (!box) throw new Error('Geometry canvas has no interactive bounds');
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.62, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1800);
const movedCamera = await page.evaluate(() => window.__universalComparison.views.geometry.camera.position.toArray());
if (movedCamera.every((value, index) => Math.abs(value - initial.geometry.camera[index]) < 1e-6)) throw new Error('Orbit drag did not move the 3D camera');
const synchronizedCamera = await page.evaluate(() => window.__universalComparison.views.reconstructed.camera.position.toArray());
if (synchronizedCamera.some((value, index) => Math.abs(value - movedCamera[index]) > 1e-6)) throw new Error(`The comparison cameras did not stay synchronized: ${JSON.stringify({movedCamera,synchronizedCamera})}`);
await page.screenshot({ path: 'test-results/universal-comparison-orbit-tested.png', fullPage: true });

const directFile = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const directErrors = [];
directFile.on('console', message => {
  if (message.type() === 'error') directErrors.push(message.text());
});
directFile.on('pageerror', error => directErrors.push(error.message));
await directFile.goto(pathToFileURL(resolve('public/universal-texture-demo.html')).href);
await directFile.waitForURL(base + pagePath, { timeout: 15_000 });
await directFile.waitForFunction(() => window.__universalComparison?.views?.geometry?.loaded && window.__universalComparison?.views?.reconstructed?.loaded, null, { timeout: 60_000 });
if (directErrors.some(error => /CORS|file:\/\/\/E:\/vendor|Unsafe attempt/i.test(error))) throw new Error(`Direct-file redirect produced CORS errors: ${directErrors.join(' | ')}`);

const result = {
  verdict: 'comparison-ready',
  url: base + pagePath,
  httpResources: statuses,
  registration: report.registration,
  independentValidation: report.independentValidation,
  colorCoverage: report.colorCoverage,
  sourceCollection: report.sourceCollection,
  sourceDuplicateAudit: report.sourceDuplicateAudit,
  albedoNormalization: report.albedoNormalization,
  colorQualityGates: report.qualityGates,
  render: initial,
  sameSurfaceExtensionPick: extensionPick,
  rawProjectionControl: rawControl,
  correctedEvidenceOverlay: evidenceOverlay,
  qualityView,
  semanticView,
  pickedSurface,
  orbitControl: { tested: true, cameraMoved: true, comparisonCamerasSynchronized: true },
  directFileRedirect: { tested: true, finalUrl: directFile.url(), corsErrors: 0 },
  screenshot: 'test-results/universal-comparison-http.png'
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
