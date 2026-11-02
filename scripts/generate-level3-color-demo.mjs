import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { triangulate } from './plateau-geometry.mjs';

const geometryPath = 'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';
const plateauRecipePath = 'public/assets/datasets/plateau-2025-v4/recipes/tocho.json';
const sourceImagePath = process.env.LEVEL3_MAPILLARY_SOURCE
  || 'public/assets/level3-demo/mapillary-reference.jpg';
const outDir = 'public/assets/level3-demo';
const targetBuildingId = 'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const floorHeight = 4.15;
const floorOrigin = 0.55;
const windowBand = [0.28, 0.74];
const spandrelBand = [0.16, 0.86];
const bayWidth = 3.15;
const bayOrigin = -0.8;
const mullionBand = [0.13, 0.87];
const semanticMaterials = [
  'stone', 'concrete', 'tile', 'clearGlass', 'darkGlass', 'opaqueGlass',
  'mullion', 'spandrel', 'metalPanel', 'louver', 'door', 'column', 'beam',
  'parapet', 'roofEquipment', 'pipeDuct', 'railing', 'recess', 'signage', 'unknown',
];
const windowClasses = new Set(['clearGlass', 'darkGlass', 'opaqueGlass', 'recess']);
const metalClasses = new Set(['mullion', 'metalPanel', 'louver', 'door', 'pipeDuct', 'railing', 'signage']);
const attributePbrSettings = {
  stone: { roughness: 0.91, metallic: 0 },
  concrete: { roughness: 0.96, metallic: 0 },
  tile: { roughness: 0.76, metallic: 0 },
  clearGlass: { roughness: 0.25, metallic: 0.05 },
  darkGlass: { roughness: 0.28, metallic: 0.06 },
  opaqueGlass: { roughness: 0.44, metallic: 0.02 },
  mullion: { roughness: 0.30, metallic: 0.34 },
  spandrel: { roughness: 0.48, metallic: 0.10 },
  metalPanel: { roughness: 0.41, metallic: 0.28 },
  louver: { roughness: 0.38, metallic: 0.32 },
  door: { roughness: 0.44, metallic: 0.18 },
  column: { roughness: 0.88, metallic: 0 },
  beam: { roughness: 0.86, metallic: 0 },
  parapet: { roughness: 0.91, metallic: 0 },
  recess: { roughness: 0.42, metallic: 0 },
  roofEquipment: { roughness: 0.84, metallic: 0.03 },
  pipeDuct: { roughness: 0.36, metallic: 0.30 },
  railing: { roughness: 0.29, metallic: 0.42 },
  signage: { roughness: 0.47, metallic: 0.12 },
  unknown: { roughness: 0.83, metallic: 0 },
};
const sPriorityProfiles = {
  stone: { normalAmp: 0.016, normalFreq: 5.8, roughAmp: 0.055, jointStrength: 0.050 },
  concrete: { normalAmp: 0.022, normalFreq: 4.3, roughAmp: 0.070, jointStrength: 0.045 },
  tile: { normalAmp: 0.012, normalFreq: 7.0, roughAmp: 0.050, jointStrength: 0.075 },
  clearGlass: { normalAmp: 0.0035, normalFreq: 2.4, roughAmp: 0.035, jointStrength: 0.155 },
  darkGlass: { normalAmp: 0.0045, normalFreq: 2.2, roughAmp: 0.040, jointStrength: 0.165 },
  opaqueGlass: { normalAmp: 0.006, normalFreq: 3.0, roughAmp: 0.045, jointStrength: 0.140 },
  mullion: { normalAmp: 0.007, normalFreq: 8.5, roughAmp: 0.045, jointStrength: 0.090 },
  spandrel: { normalAmp: 0.009, normalFreq: 5.4, roughAmp: 0.050, jointStrength: 0.085 },
  metalPanel: { normalAmp: 0.008, normalFreq: 6.5, roughAmp: 0.055, jointStrength: 0.070 },
  louver: { normalAmp: 0.009, normalFreq: 7.2, roughAmp: 0.050, jointStrength: 0.080 },
  door: { normalAmp: 0.008, normalFreq: 5.5, roughAmp: 0.045, jointStrength: 0.070 },
  column: { normalAmp: 0.013, normalFreq: 5.2, roughAmp: 0.050, jointStrength: 0.040 },
  beam: { normalAmp: 0.012, normalFreq: 5.0, roughAmp: 0.050, jointStrength: 0.045 },
  parapet: { normalAmp: 0.015, normalFreq: 4.8, roughAmp: 0.055, jointStrength: 0.050 },
  recess: { normalAmp: 0.006, normalFreq: 3.2, roughAmp: 0.045, jointStrength: 0.180 },
  roofEquipment: { normalAmp: 0.010, normalFreq: 5.2, roughAmp: 0.050, jointStrength: 0.0 },
  pipeDuct: { normalAmp: 0.006, normalFreq: 7.8, roughAmp: 0.050, jointStrength: 0.0 },
  railing: { normalAmp: 0.004, normalFreq: 8.5, roughAmp: 0.040, jointStrength: 0.0 },
  signage: { normalAmp: 0.006, normalFreq: 5.5, roughAmp: 0.040, jointStrength: 0.0 },
  unknown: { normalAmp: 0.010, normalFreq: 4.6, roughAmp: 0.050, jointStrength: 0.0 },
};

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mod = (v, m) => ((v % m) + m) % m;
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v) => {
  const d = Math.hypot(...v) || 1;
  return v.map((n) => n / d);
};
const lerpPoint = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const luminance = (rgb) => (rgb[0] + rgb[1] + rgb[2]) / 3;
const saturation = (rgb) => Math.max(...rgb) - Math.min(...rgb);
const srgbToLinear = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toLinear4 = (rgb) => [...rgb.map((v) => srgbToLinear(clamp(v))), 1];
const rgbHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('')}`;

function setLuminance(rgb, target) {
  const current = luminance(rgb) || 1;
  return rgb.map((v) => clamp(v * target / current));
}

function medianRgb(samples, fallback, minSamples = 8) {
  if (samples.length < minSamples) return fallback;
  return [0, 1, 2].map((channel) => {
    const values = samples.map((rgb) => rgb[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] / 255;
  });
}

function expandSemanticPalette(base) {
  const stone = base.stone;
  const glass = base.glass;
  const metal = base.metal;
  const concrete = setLuminance(mix(stone, [0.54, 0.56, 0.57], 0.66), 0.56);
  return {
    stone,
    concrete,
    tile: setLuminance(mix(stone, [0.66, 0.60, 0.55], 0.28), 0.60),
    clearGlass: glass,
    darkGlass: setLuminance(mix(glass, [0.22, 0.28, 0.34], 0.55), 0.31),
    opaqueGlass: base.opaqueGlass,
    mullion: setLuminance(metal, 0.31),
    spandrel: setLuminance(mix(metal, stone, 0.46), 0.41),
    metalPanel: setLuminance(metal, 0.39),
    louver: setLuminance(metal, 0.28),
    door: [0.20, 0.23, 0.25],
    column: setLuminance(mix(stone, concrete, 0.58), 0.59),
    beam: setLuminance(mix(stone, concrete, 0.62), 0.53),
    parapet: setLuminance(concrete, 0.58),
    roofEquipment: base.roofEquipment,
    pipeDuct: setLuminance(mix(metal, [0.50, 0.52, 0.53], 0.45), 0.48),
    railing: setLuminance(metal, 0.24),
    recess: base.recess,
    signage: [0.30, 0.34, 0.38],
    unknown: [0.48, 0.49, 0.50],
  };
}

async function deriveMapillaryPalette(path) {
  let image;
  try {
    image = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    console.warn(`Mapillary reference could not be read (${error.message}); using audited fallback palette.`);
    return {
      sourceAvailable: false,
      sourcePath: path,
      sampleCounts: { stone: 0, glass: 0 },
      sourceMedians: { stone: [0.62, 0.63, 0.64], glass: [0.55, 0.59, 0.63] },
      stone: [0.62, 0.63, 0.63],
      glass: [0.39, 0.43, 0.47],
      metal: [0.34, 0.36, 0.38],
      opaqueGlass: [0.47, 0.50, 0.53],
      recess: [0.21, 0.23, 0.25],
      roofEquipment: [0.46, 0.47, 0.46],
    };
  }

  const { data, info } = image;
  // Central facade ROI. Excludes most sky, foreground trees, and the red sculpture.
  const left = Math.floor(info.width * 0.36);
  const right = Math.floor(info.width * 0.78);
  const top = Math.floor(info.height * 0.19);
  const bottom = Math.floor(info.height * 0.70);
  const stoneSamples = [];
  const glassSamples = [];
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // Mid-tones only: discard deep shadows and blown highlights/reflections.
      if (lum >= 105 && lum <= 205 && spread <= 30) stoneSamples.push([r, g, b]);
      // Cool, mid-tone pixels are a stable cue for reflected facade glazing.
      if (lum >= 90 && lum <= 205 && b - r >= 7 && b - g >= 2 && spread <= 55) glassSamples.push([r, g, b]);
    }
  }

  const stoneMedian = medianRgb(stoneSamples, [0.62, 0.63, 0.64], 64);
  const glassMedian = medianRgb(glassSamples, [0.55, 0.59, 0.63], 64);
  // Preserve source hue but canonicalize illumination. Reflections make photographed glass too bright.
  const neutral = luminance(stoneMedian);
  const stone = setLuminance(mix(stoneMedian, [neutral, neutral, neutral], 0.45), 0.62);
  const glassBase = setLuminance(glassMedian, 0.43);
  const glass = [clamp(glassBase[0] - 0.015), clamp(glassBase[1]), clamp(glassBase[2] + 0.02)];
  const metal = setLuminance(mix(stone, [0.31, 0.34, 0.37], 0.72), 0.36);
  const opaqueGlass = setLuminance(mix(glass, stone, 0.38), 0.50);
  const recess = setLuminance(glass, 0.235);
  const roofEquipment = setLuminance(mix(stone, [0.43, 0.45, 0.44], 0.60), 0.47);
  return {
    sourceAvailable: true,
    sourcePath: path,
    sampleCounts: { stone: stoneSamples.length, glass: glassSamples.length },
    sourceMedians: { stone: stoneMedian, glass: glassMedian },
    stone,
    glass,
    metal,
    opaqueGlass,
    recess,
    roofEquipment,
  };
}

function facadeDirection(normal) {
  if (Math.abs(normal[0]) > Math.abs(normal[2])) return normal[0] >= 0 ? 'x+' : 'x-';
  return normal[2] >= 0 ? 'z+' : 'z-';
}

async function derivePlateauFacadeEvidence(path, buildingId) {
  const recipe = JSON.parse(await readFile(path, 'utf8'));
  const polygons = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value.buildingId === buildingId && Array.isArray(value.polygons)) {
      for (const polygon of value.polygons) {
        if (polygon?.id && polygon?.image && Array.isArray(polygon.sourceUV) && polygon.sourceUV.length >= 6) {
          polygons.set(polygon.id, polygon);
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(recipe);

  const imageCache = new Map();
  const directionSamples = new Map(['x+', 'x-', 'z+', 'z-'].map((key) => [key, []]));
  const imageRefs = new Set();
  const perPolygon = new Map();

  const loadTexture = async (webPath) => {
    if (!imageCache.has(webPath)) {
      const localPath = webPath.startsWith('/') ? `public${webPath}` : webPath;
      imageCache.set(webPath, await sharp(localPath).raw().toBuffer({ resolveWithObject: true }));
    }
    return imageCache.get(webPath);
  };

  const sampleTexture = (texture, u, v) => {
    const x = Math.max(0, Math.min(texture.info.width - 1, Math.round(clamp(u) * (texture.info.width - 1))));
    // sourceUV is already converted from CityGML V to top-down image-space
    // when plateau-build.mjs writes the recipe. Do not flip V a second time.
    const y = Math.max(0, Math.min(texture.info.height - 1, Math.round(clamp(v) * (texture.info.height - 1))));
    const index = (y * texture.info.width + x) * texture.info.channels;
    return [texture.data[index], texture.data[index + 1], texture.data[index + 2]];
  };

  for (const polygon of polygons.values()) {
    const direction = facadeDirection(polygon.normal || [0, 0, 1]);
    const bucket = directionSamples.get(direction);
    const texture = await loadTexture(polygon.image);
    imageRefs.add(polygon.image);
    const uv = polygon.sourceUV;
    const alignedTriangles = [];
    const pointIndices = Array.isArray(polygon.indices) && polygon.indices.length >= 3
      ? polygon.indices
      : Array.from({ length: polygon.points?.length || 0 }, (_, index) => index);
    for (let i = 0; i + 2 < pointIndices.length; i += 3) {
      const ia = pointIndices[i];
      const ib = pointIndices[i + 1];
      const ic = pointIndices[i + 2];
      const a = polygon.points?.[ia];
      const b = polygon.points?.[ib];
      const c = polygon.points?.[ic];
      if (!a || !b || !c || uv.length < (Math.max(ia, ib, ic) + 1) * 2) continue;
      alignedTriangles.push({
        points: [a, b, c],
        uv: [
          [uv[ia * 2], uv[ia * 2 + 1]],
          [uv[ib * 2], uv[ib * 2 + 1]],
          [uv[ic * 2], uv[ic * 2 + 1]],
        ],
      });
    }
    const polygonSamples = [];
    for (const triangle of alignedTriangles) {
      const [a, b, c] = triangle.uv;
      for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        const u = a[0] * wa + b[0] * wb + c[0] * wc;
        const v = a[1] * wa + b[1] * wb + c[1] * wc;
        const rgb = sampleTexture(texture, u, v);
        const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
        if (lum >= 28 && lum <= 235) {
          polygonSamples.push(rgb);
          bucket.push(rgb);
        }
      }
    }
    const median = medianRgb(polygonSamples, [0.58, 0.59, 0.60], 3);
    const gray = luminance(median);
    const normalizedAlbedo = setLuminance(mix(median, [gray, gray, gray], 0.22), clamp(gray, 0.30, 0.68));
    perPolygon.set(polygon.id, {
      sampleCount: polygonSamples.length,
      median,
      normalizedAlbedo,
      luminance: luminance(median),
      saturation: saturation(median),
      coolness: median[2] - median[0],
      confidence: clamp(0.32 + Math.min(polygonSamples.length, 36) / 72, 0, 0.82),
      image: polygon.image,
      texture,
      alignedTriangles,
    });
  }

  const directions = {};
  for (const [direction, bucket] of directionSamples) {
    const median = medianRgb(bucket, [0.58, 0.59, 0.60], 8);
    const gray = luminance(median);
    const albedo = setLuminance(mix(median, [gray, gray, gray], 0.30), 0.58);
    directions[direction] = {
      sampleCount: bucket.length,
      median,
      normalizedAlbedo: albedo,
    };
  }
  return {
    polygonCount: polygons.size,
    usablePolygonCount: [...perPolygon.values()].filter((evidence) => evidence.sampleCount >= 3).length,
    zeroSamplePolygonCount: [...perPolygon.values()].filter((evidence) => evidence.sampleCount === 0).length,
    imageRefs: [...imageRefs],
    directions,
    perPolygon,
  };
}

function barycentric3d(point, triangle) {
  const [a, b, c] = triangle;
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2 = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denominator = d00 * d11 - d01 * d01;
  if (Math.abs(denominator) < 1e-10) return null;
  const wb = (d11 * d20 - d01 * d21) / denominator;
  const wc = (d00 * d21 - d01 * d20) / denominator;
  const wa = 1 - wb - wc;
  return [wa, wb, wc];
}

function localAlignedEvidence(evidence, point) {
  if (!evidence?.texture || !evidence.alignedTriangles?.length) return null;
  let best = null;
  for (const triangle of evidence.alignedTriangles) {
    const weights = barycentric3d(point, triangle.points);
    if (!weights) continue;
    const penalty = weights.reduce((sum, weight) => sum + Math.max(0, -weight) + Math.max(0, weight - 1), 0);
    if (!best || penalty < best.penalty) best = { triangle, weights, penalty };
    if (penalty <= 1e-5) break;
  }
  if (!best || best.penalty > 0.035) return null;

  const u = best.triangle.uv.reduce((sum, uv, index) => sum + uv[0] * best.weights[index], 0);
  const v = best.triangle.uv.reduce((sum, uv, index) => sum + uv[1] * best.weights[index], 0);
  const { data, info } = evidence.texture;
  const cx = Math.max(0, Math.min(info.width - 1, Math.round(clamp(u) * (info.width - 1))));
  const cy = Math.max(0, Math.min(info.height - 1, Math.round(clamp(v) * (info.height - 1))));
  const samples = [];
  const luminances = [];
  const grid = new Map();
  const radius = 3;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.max(0, Math.min(info.width - 1, cx + dx));
      const y = Math.max(0, Math.min(info.height - 1, cy + dy));
      const index = (y * info.width + x) * info.channels;
      const rgb255 = [data[index], data[index + 1], data[index + 2]];
      const lum255 = (rgb255[0] + rgb255[1] + rgb255[2]) / 3;
      if (lum255 < 18 || lum255 > 245) continue;
      const rgb = rgb255.map((value) => value / 255);
      samples.push(rgb);
      const sampleLum = luminance(rgb);
      luminances.push(sampleLum);
      grid.set(`${dx}|${dy}`, { rgb, lum: sampleLum });
    }
  }
  if (samples.length < 12) return null;
  const mean = [0, 1, 2].map((channel) => samples.reduce((sum, rgb) => sum + rgb[channel], 0) / samples.length);
  const lum = luminance(mean);
  const variance = luminances.reduce((sum, value) => sum + (value - lum) ** 2, 0) / luminances.length;
  let horizontalGradient = 0;
  let verticalGradient = 0;
  let horizontalPairs = 0;
  let verticalPairs = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const current = grid.get(`${dx}|${dy}`);
      if (!current) continue;
      const right = grid.get(`${dx + 1}|${dy}`);
      const down = grid.get(`${dx}|${dy + 1}`);
      if (right) {
        horizontalGradient += Math.abs(current.lum - right.lum);
        horizontalPairs += 1;
      }
      if (down) {
        verticalGradient += Math.abs(current.lum - down.lum);
        verticalPairs += 1;
      }
    }
  }
  horizontalGradient /= Math.max(1, horizontalPairs);
  verticalGradient /= Math.max(1, verticalPairs);
  const edgeStrength = (horizontalGradient + verticalGradient) / 2;
  const gray = luminance(mean);
  const normalizedAlbedo = setLuminance(mix(mean, [gray, gray, gray], 0.18), clamp(gray, 0.22, 0.72));
  const confidence = clamp(
    0.34
      + Math.min(samples.length, 49) / 115
      + (best.penalty <= 1e-5 ? 0.16 : Math.max(0, 0.12 - best.penalty * 2.4))
      - Math.min(Math.sqrt(variance), 0.24) * 0.22,
    0,
    0.92,
  );
  return {
    sampleCount: samples.length,
    mean,
    normalizedAlbedo,
    luminance: lum,
    saturation: saturation(mean),
    coolness: mean[2] - mean[0],
    luminanceStdDev: Math.sqrt(variance),
    horizontalGradient,
    verticalGradient,
    edgeStrength,
    confidence,
    uv: [u, v],
    mappingPenalty: best.penalty,
  };
}

function cleanPolygon(points) {
  const out = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(point[0] - prev[0], point[1] - prev[1], point[2] - prev[2]) > 1e-6) out.push(point);
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) <= 1e-6) out.pop();
  }
  return out;
}

function splitPolygon(points, scalar, threshold) {
  const low = [];
  const high = [];
  const eps = 1e-7;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const sa = scalar(a) - threshold;
    const sb = scalar(b) - threshold;
    if (sa <= eps) low.push(a);
    if (sa >= -eps) high.push(a);
    if ((sa < -eps && sb > eps) || (sa > eps && sb < -eps)) {
      const t = -sa / (sb - sa);
      const intersection = lerpPoint(a, b, t);
      low.push(intersection);
      high.push(intersection);
    }
  }
  return [cleanPolygon(low), cleanPolygon(high)].filter((polygon) => polygon.length >= 3);
}

function periodicBoundaries(minValue, maxValue, origin, period, phases) {
  const boundaries = [];
  const start = Math.floor((minValue - origin) / period) - 1;
  const end = Math.ceil((maxValue - origin) / period) + 1;
  for (let k = start; k <= end; k += 1) {
    for (const phase of phases) {
      const value = origin + (k + phase) * period;
      if (value > minValue + 1e-7 && value < maxValue - 1e-7) boundaries.push(value);
    }
  }
  return boundaries.sort((a, b) => a - b);
}

function splitByBoundaries(polygons, scalar, boundaries) {
  let result = polygons;
  for (const boundary of boundaries) {
    const next = [];
    for (const polygon of result) {
      const values = polygon.map(scalar);
      if (Math.min(...values) >= boundary - 1e-7 || Math.max(...values) <= boundary + 1e-7) {
        next.push(polygon);
      } else {
        next.push(...splitPolygon(polygon, scalar, boundary));
      }
    }
    result = next;
  }
  return result;
}

function triangleArea(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return Math.hypot(...cross) * 0.5;
}

function descriptorForPolygon(polygon, triangulated, wallIds) {
  const points = triangulated.points;
  const normal = triangulated.normal;
  const ys = points.map((point) => point[1]);
  const tangent = normalize([normal[2], 0, -normal[0]]);
  const us = points.map((point) => dot(point, tangent));
  let area = 0;
  for (let i = 0; i < triangulated.indices.length; i += 3) {
    area += triangleArea(
      points[triangulated.indices[i]],
      points[triangulated.indices[i + 1]],
      points[triangulated.indices[i + 2]],
    );
  }
  const centroid = points.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]],
    [0, 0, 0],
  ).map((value) => value / points.length);
  return {
    polygonId: polygon.id,
    points,
    indices: triangulated.indices,
    normal,
    direction: facadeDirection(normal),
    tangent,
    width: Math.max(...us) - Math.min(...us),
    height: Math.max(...ys) - Math.min(...ys),
    area,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    centroid,
    isWallSurface: wallIds.has(polygon.id),
    // Evidence is deliberately absent while the shared 1-3/6 pipeline runs.
    // It is attached only after the Phase model has been generated.
    evidence: null,
    componentId: null,
    componentStats: null,
    part: 'unknown',
    repeatEvidence: false,
    windowEligible: false,
  };
}

function connectWallComponents(descriptors) {
  const parent = descriptors.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const vertexBuckets = new Map();
  descriptors.forEach((descriptor, index) => {
    if (!descriptor.isWallSurface || Math.abs(descriptor.normal[1]) >= 0.45) return;
    const keys = new Set(descriptor.points.map((point) => point.map((value) => value.toFixed(3)).join('|')));
    for (const key of keys) {
      if (!vertexBuckets.has(key)) vertexBuckets.set(key, []);
      vertexBuckets.get(key).push(index);
    }
  });
  for (const bucket of vertexBuckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = descriptors[bucket[i]];
        const b = descriptors[bucket[j]];
        if (a.direction === b.direction && Math.abs(dot(a.normal, b.normal)) > 0.93) union(bucket[i], bucket[j]);
      }
    }
  }
  const components = new Map();
  descriptors.forEach((descriptor, index) => {
    if (!descriptor.isWallSurface || Math.abs(descriptor.normal[1]) >= 0.45) return;
    const root = find(index);
    descriptor.componentId = root;
    if (!components.has(root)) components.set(root, {
      memberCount: 0,
      area: 0,
      minY: Infinity,
      maxY: -Infinity,
      maxWidth: 0,
    });
    const component = components.get(root);
    component.memberCount += 1;
    component.area += descriptor.area;
    component.minY = Math.min(component.minY, descriptor.minY);
    component.maxY = Math.max(component.maxY, descriptor.maxY);
    component.maxWidth = Math.max(component.maxWidth, descriptor.width);
  });
  for (const descriptor of descriptors) {
    if (descriptor.componentId !== null) descriptor.componentStats = components.get(descriptor.componentId);
  }
  return components;
}

function classifyPart(descriptor, building) {
  const absNy = Math.abs(descriptor.normal[1]);
  const localCenterY = descriptor.centroid[1] - building.min[1];
  const nearRoof = descriptor.centroid[1] > building.max[1] - 32;
  if (absNy >= 0.72) {
    if (nearRoof && descriptor.area < 180) return 'roofEquipment';
    if (descriptor.area >= 55) return 'concrete';
    return descriptor.area < 7 ? 'roofEquipment' : 'metalPanel';
  }
  if (!descriptor.isWallSurface) {
    if (nearRoof) {
      if (descriptor.width < 1.25 && descriptor.height > 2.5) return 'pipeDuct';
      if (descriptor.height < 1.2 && descriptor.width > 2.0) return 'railing';
      return 'roofEquipment';
    }
    if (descriptor.width < 0.85 && descriptor.height > 3.0) return 'pipeDuct';
    if (descriptor.width < 1.9 && descriptor.height > 5.5) return 'column';
    if (descriptor.height < 0.9 && descriptor.width > 2.5) return 'railing';
    if (descriptor.height < 2.0 && descriptor.width > 5.0) return 'louver';
    if (descriptor.height < 2.6 && descriptor.width > 3.0) return 'beam';
    if (descriptor.area < 4.0) return 'railing';
    if (descriptor.area < 18.0) return 'metalPanel';
    return 'unknown';
  }
  if (descriptor.height < 1.35 && descriptor.width > 2.5) return nearRoof ? 'parapet' : 'beam';
  if (descriptor.width < 1.45 && descriptor.height > 5.5) return 'column';
  if (descriptor.area < 5.0) return 'metalPanel';
  if (localCenterY < 8 && descriptor.height < 9) return 'concrete';
  return 'facade';
}

function markWindowEligibility(descriptor, building) {
  descriptor.part = classifyPart(descriptor, building);
  const component = descriptor.componentStats;
  const vertical = Math.abs(descriptor.normal[1]) < 0.28;
  const geometricRepeat = descriptor.height >= floorHeight * 2.2
    && descriptor.width >= bayWidth * 0.85
    && descriptor.area >= 24;
  const componentRepeat = component
    && (component.maxY - component.minY) >= floorHeight * 2.5
    && component.area >= 50;
  const roofCutoff = descriptor.minY > building.max[1] - 24;
  descriptor.repeatEvidence = Boolean(geometricRepeat && componentRepeat);
  descriptor.windowEligible = Boolean(
    descriptor.isWallSurface
      && descriptor.part === 'facade'
      && vertical
      && descriptor.repeatEvidence
      && !roofCutoff,
  );
}

function buildDescriptors(building) {
  const wallIds = new Set(building.walls.map((wall) => wall.id));
  const descriptors = [];
  let originalTriangles = 0;
  for (const polygon of building.polygons) {
    const triangulated = triangulate(polygon.rings.map((ring) => ring.points));
    if (!triangulated.indices.length) continue;
    originalTriangles += triangulated.indices.length / 3;
    descriptors.push(descriptorForPolygon(polygon, triangulated, wallIds));
  }
  const components = connectWallComponents(descriptors);
  for (const descriptor of descriptors) markWindowEligibility(descriptor, building);
  return { descriptors, components, originalTriangles };
}

function attachRecommendedEvidence(descriptors, plateauEvidence) {
  for (const descriptor of descriptors) {
    descriptor.evidence = plateauEvidence.perPolygon.get(descriptor.polygonId) || null;
  }
}

function semanticFragments(descriptor, buildingMinY) {
  const triangles = [];
  for (let i = 0; i < descriptor.indices.length; i += 3) {
    const source = [
      descriptor.points[descriptor.indices[i]],
      descriptor.points[descriptor.indices[i + 1]],
      descriptor.points[descriptor.indices[i + 2]],
    ];
    let polygons = [source];
    if (descriptor.windowEligible) {
      const y = (point) => point[1];
      const u = (point) => dot(point, descriptor.tangent);
      const yValues = source.map(y);
      const uValues = source.map(u);
      const yCuts = periodicBoundaries(
        Math.min(...yValues),
        Math.max(...yValues),
        buildingMinY + floorOrigin,
        floorHeight,
        [spandrelBand[0], windowBand[0], windowBand[1], spandrelBand[1]],
      );
      const uCuts = periodicBoundaries(Math.min(...uValues), Math.max(...uValues), bayOrigin, bayWidth, mullionBand);
      polygons = splitByBoundaries(polygons, y, yCuts);
      polygons = splitByBoundaries(polygons, u, uCuts);
    }
    for (const polygon of polygons) {
      for (let j = 1; j < polygon.length - 1; j += 1) {
        triangles.push({ vertices: [polygon[0], polygon[j], polygon[j + 1]], normal: descriptor.normal, descriptor });
      }
    }
  }
  return triangles;
}

function phaseSemantic(triangle, buildingMinY) {
  const center = [
    (triangle.vertices[0][0] + triangle.vertices[1][0] + triangle.vertices[2][0]) / 3,
    (triangle.vertices[0][1] + triangle.vertices[1][1] + triangle.vertices[2][1]) / 3,
    (triangle.vertices[0][2] + triangle.vertices[1][2] + triangle.vertices[2][2]) / 3,
  ];
  const descriptor = triangle.descriptor;
  if (!descriptor.windowEligible) {
    const material = descriptor.part === 'facade' ? 'stone' : descriptor.part;
    return { material: semanticMaterials.includes(material) ? material : 'unknown', center, descriptor };
  }
  const facadeU = dot(center, descriptor.tangent);
  const floorPhase = mod(center[1] - buildingMinY - floorOrigin, floorHeight) / floorHeight;
  const bayPhase = mod(facadeU - bayOrigin, bayWidth) / bayWidth;
  const betweenMullions = bayPhase > mullionBand[0] && bayPhase < mullionBand[1];
  const isWindowBand = floorPhase > windowBand[0] && floorPhase < windowBand[1];
  const isSpandrel = floorPhase > spandrelBand[0] && floorPhase < spandrelBand[1] && !isWindowBand;
  if (isWindowBand && !betweenMullions) return { material: 'mullion', center, descriptor };
  if (isWindowBand && betweenMullions) {
    const floor = Math.floor((center[1] - buildingMinY) / floorHeight);
    const bay = Math.floor((facadeU - bayOrigin) / bayWidth);
    if ((floor * 17 + bay * 13) % 23 === 0) return { material: 'recess', center, descriptor };
    if ((floor * 11 + bay * 7) % 17 === 0) return { material: 'opaqueGlass', center, descriptor };
    if ((floor * 5 + bay * 3) % 19 === 0) return { material: 'darkGlass', center, descriptor };
    return { material: 'clearGlass', center, descriptor };
  }
  if (isSpandrel) return { material: 'spandrel', center, descriptor };
  const localHeight = center[1] - buildingMinY;
  if (localHeight < 7 && betweenMullions && bayPhase > 0.34 && bayPhase < 0.66) return { material: 'door', center, descriptor };
  return { material: 'stone', center, descriptor };
}

function recommendedCellKey(phase, buildingMinY) {
  const descriptor = phase.descriptor;
  if (!descriptor.windowEligible) return `${descriptor.polygonId}|${phase.material}`;
  const facadeU = dot(phase.center, descriptor.tangent);
  const floor = Math.floor((phase.center[1] - buildingMinY - floorOrigin) / floorHeight);
  const bay = Math.floor((facadeU - bayOrigin) / bayWidth);
  return `${descriptor.polygonId}|${floor}|${bay}|${phase.material}`;
}

function buildRecommendedCells(prepared, buildingMinY) {
  const cells = new Map();
  for (const item of prepared) {
    const key = recommendedCellKey(item.phase, buildingMinY);
    item.recommendedCellKey = key;
    if (!cells.has(key)) cells.set(key, { descriptor: item.phase.descriptor, centers: [] });
    cells.get(key).centers.push(item.phase.center);
  }
  for (const cell of cells.values()) {
    const mean = cell.centers.reduce(
      (sum, center) => [sum[0] + center[0], sum[1] + center[1], sum[2] + center[2]],
      [0, 0, 0],
    ).map((value) => value / cell.centers.length);
    // Use an actual fragment center nearest to the cell mean. This keeps the
    // sourceUV lookup on the source polygon while making all triangles in the
    // same semantic facade cell share one image-evidence sample.
    cell.center = cell.centers.reduce((best, center) => {
      const distance = (center[0] - mean[0]) ** 2 + (center[1] - mean[1]) ** 2 + (center[2] - mean[2]) ** 2;
      return !best || distance < best.distance ? { center, distance } : best;
    }, null).center;
    cell.localEvidence = localAlignedEvidence(cell.descriptor.evidence, cell.center);
  }
  return cells;
}

function recommendedSemantic(phase, localEvidence, evidenceStats) {
  const polygonEvidence = phase.descriptor.evidence;
  const evidence = localEvidence || polygonEvidence;
  if (!evidence || evidence.sampleCount < 3 || evidence.confidence < 0.42) return phase;
  const lum = evidence.luminance;
  const sat = evidence.saturation;
  const cool = evidence.coolness;
  const relativeLum = localEvidence && polygonEvidence
    ? lum - polygonEvidence.luminance
    : 0;
  const edge = localEvidence?.edgeStrength || 0;
  const texture = localEvidence?.luminanceStdDev || 0;
  let material = phase.material;
  let suppressedWindow = false;

  // Only local, geometrically aligned evidence may veto a periodic window.
  // This prevents a polygon-wide average from turning an entire facade into glass.
  if (windowClasses.has(material) && localEvidence?.confidence >= 0.52) {
    const neutral = sat < 0.085;
    const warm = evidence.mean[0] - evidence.mean[2] > 0.035;
    const brightOpaque = neutral && lum > 0.60 && (relativeLum > 0.025 || edge < 0.060);
    const midOpaque = neutral && lum > 0.47 && relativeLum > 0.075 && edge < 0.075;
    if (brightOpaque || midOpaque) {
      material = lum > 0.66 ? 'concrete' : 'stone';
      suppressedWindow = true;
    } else if (warm && lum > 0.43 && relativeLum > 0.02 && edge < 0.085) {
      material = 'tile';
      suppressedWindow = true;
    } else if (lum < 0.315) {
      material = edge > 0.075 || texture > 0.095 ? 'recess' : 'darkGlass';
    } else if (cool > 0.032 && lum < 0.64) {
      material = 'clearGlass';
    } else if (neutral && lum > 0.54 && relativeLum > -0.015) {
      material = 'opaqueGlass';
    }
  } else if (windowClasses.has(material)) {
    if (lum < 0.36) material = 'darkGlass';
    else if (cool > 0.045) material = 'clearGlass';
    else if (sat < 0.07 && lum > 0.57) material = 'opaqueGlass';
  } else if (material === 'stone' || material === 'spandrel') {
    if (lum < 0.36 && sat < 0.08) material = material === 'spandrel' ? 'metalPanel' : 'concrete';
    else if ((evidence.mean?.[0] ?? evidence.median?.[0] ?? 0) - (evidence.mean?.[2] ?? evidence.median?.[2] ?? 0) > 0.045 && sat > 0.065) material = 'tile';
    else if (lum > 0.66 && sat < 0.06) material = 'concrete';
  } else if (material === 'unknown' && sat < 0.055 && lum >= 0.42 && lum <= 0.68) {
    material = 'metalPanel';
  }
  if (material !== phase.material) evidenceStats.semanticOverrides += 1;
  if (localEvidence) {
    evidenceStats.localEvidenceTriangles += 1;
    if (material !== phase.material) evidenceStats.localSemanticOverrides += 1;
    if (suppressedWindow) evidenceStats.suppressedWindowTriangles += 1;
  } else {
    evidenceStats.polygonFallbackTriangles += 1;
  }
  evidenceStats.alignedTriangles += 1;
  return {
    ...phase,
    material,
    recommendedConfidence: evidence.confidence,
    localEvidence,
  };
}

function variation(material, center, palette, amount = null) {
  const base = palette[material];
  if (!base) return palette.unknown;
  if (material === 'roofEquipment' || material === 'pipeDuct' || material === 'railing') return base;
  const seed = Math.sin(center[0] * 0.73 + center[1] * 0.17 + center[2] * 0.41) * 43758.5453;
  const defaultAmount = windowClasses.has(material) ? 0.042 : metalClasses.has(material) ? 0.016 : 0.024;
  const signed = (seed - Math.floor(seed) - 0.5) * (amount ?? defaultAmount);
  return setLuminance(base, clamp(luminance(base) + signed, 0.16, 0.72));
}

function sharedSemanticColor(classification, normal, palette, buildingMinY) {
  const { material, center } = classification;
  let result = variation(material, center, palette);
  if (material === 'roofEquipment' || material === 'pipeDuct' || material === 'railing') return result;

  // Shared low-frequency facade cue: this is part of the semantic appearance
  // baseline (1-3/6), not image evidence. Both Phase and Recommended receive it.
  const localHeight = Math.max(0, center[1] - buildingMinY);
  const direction = facadeDirection(normal);
  const facadePhase = direction === 'x+' ? 0.4 : direction === 'x-' ? 1.6 : direction === 'z+' ? 2.8 : 4.0;
  const lowFrequency = Math.sin(localHeight * 0.055 + center[0] * 0.035 + center[2] * 0.028 + facadePhase);
  const cue = lowFrequency * (windowClasses.has(material) ? 0.018 : 0.007);
  result = setLuminance(result, clamp(luminance(result) + cue, 0.15, 0.72));

  if (material === 'clearGlass' || material === 'darkGlass') {
    const coolReflectionCue = [0.30, 0.39, 0.49];
    const mixWeight = clamp(0.07 + 0.04 * (0.5 + 0.5 * lowFrequency), 0.05, 0.12);
    result = setLuminance(mix(result, coolReflectionCue, mixWeight), luminance(result));
  }
  return result;
}

function recommendedColor(classification, normal, palette, buildingMinY, evidenceStats) {
  const { material, center, descriptor } = classification;
  const base = sharedSemanticColor(classification, normal, palette, buildingMinY);
  if (material === 'roofEquipment' || material === 'pipeDuct' || material === 'railing') return base;

  const localEvidence = classification.localEvidence;
  const polygonEvidence = descriptor?.evidence;
  let result = base;
  if (localEvidence?.sampleCount >= 12 && localEvidence.confidence >= 0.50) {
    const baseLum = luminance(base);
    const localLum = clamp(luminance(localEvidence.normalizedAlbedo), baseLum - 0.16, baseLum + 0.16);
    const targetLum = baseLum * 0.38 + localLum * 0.62;
    const evidenceTint = setLuminance(localEvidence.normalizedAlbedo, targetLum);
    const confidence = localEvidence.confidence || 0;
    const evidenceWeight = windowClasses.has(material) ? 0.42 + confidence * 0.18
      : ['stone', 'concrete', 'tile', 'spandrel'].includes(material) ? 0.36 + confidence * 0.16
        : metalClasses.has(material) ? 0.24 + confidence * 0.12
          : 0.18;
    result = mix(result, evidenceTint, evidenceWeight);
    evidenceStats.localColorTriangles += 1;
  } else if (polygonEvidence?.sampleCount >= 3) {
    const targetLum = luminance(base);
    const evidenceTint = setLuminance(polygonEvidence.normalizedAlbedo, targetLum);
    const confidence = polygonEvidence.confidence || 0;
    const evidenceWeight = windowClasses.has(material) ? 0.28 + confidence * 0.18
      : ['stone', 'concrete', 'tile', 'spandrel'].includes(material) ? 0.22 + confidence * 0.16
        : metalClasses.has(material) ? 0.14 + confidence * 0.12
          : 0.10;
    result = mix(result, evidenceTint, evidenceWeight);
  }
  return result;
}

function makeAccessor(doc, buffer, name, type, values) {
  return doc.createAccessor(name).setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
}

async function createNeutralModel(descriptors, building, outputPath) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Tokyo Metropolitan Government Building No.1 - geometry only');
  const positions = [];
  const normals = [];
  for (const descriptor of descriptors) {
    for (let i = 0; i < descriptor.indices.length; i += 3) {
      const a = descriptor.points[descriptor.indices[i]];
      const b = descriptor.points[descriptor.indices[i + 1]];
      const c = descriptor.points[descriptor.indices[i + 2]];
      positions.push(...a, ...b, ...c);
      normals.push(...descriptor.normal, ...descriptor.normal, ...descriptor.normal);
    }
  }
  const material = doc.createMaterial('neutral-geometry')
    .setBaseColorFactor(toLinear4([0.72, 0.73, 0.74]))
    .setMetallicFactor(0)
    .setRoughnessFactor(0.86)
    .setDoubleSided(true);
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', makeAccessor(doc, buffer, 'neutral-position', 'VEC3', positions))
    .setAttribute('NORMAL', makeAccessor(doc, buffer, 'neutral-normal', 'VEC3', normals))
    .setMaterial(material);
  const mesh = doc.createMesh(building.id).addPrimitive(primitive);
  const node = doc.createNode(building.name || building.id).setMesh(mesh).setExtras({
    plateau: { buildingId: building.id, lod: building.lod },
    comparisonRole: 'geometry-only',
  });
  scene.addChild(node);
  await new NodeIO().write(outputPath, doc);
}

async function createAppearanceModel(triangles, building, palette, outputPath, options) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(`Tokyo Metropolitan Government Building No.1 - ${options.role}`);
  const groups = new Map(semanticMaterials.map((name) => [name, { positions: [], normals: [], colors: [], count: 0 }]));
  const evidenceStats = {
    alignedTriangles: 0,
    semanticOverrides: 0,
    localEvidenceTriangles: 0,
    localSemanticOverrides: 0,
    suppressedWindowTriangles: 0,
    polygonFallbackTriangles: 0,
    localColorTriangles: 0,
  };
  const prepared = triangles.map((triangle) => ({ triangle, phase: phaseSemantic(triangle, building.min[1]) }));
  const recommendedCells = options.recommended ? buildRecommendedCells(prepared, building.min[1]) : null;
  for (const item of prepared) {
    const { triangle } = item;
    let phase = item.phase;
    const cell = options.recommended ? recommendedCells.get(item.recommendedCellKey) : null;
    const localEvidence = cell?.localEvidence || null;
    if (cell) phase = { ...phase, center: cell.center };
    const classification = options.recommended
      ? recommendedSemantic(phase, localEvidence, evidenceStats)
      : phase;
    const group = groups.get(classification.material);
    if (!group) throw new Error(`Unknown semantic material: ${classification.material}`);
    const srgb = options.recommended
      ? recommendedColor(classification, triangle.normal, palette, building.min[1], evidenceStats)
      : sharedSemanticColor(classification, triangle.normal, palette, building.min[1]);
    const color = toLinear4(srgb);
    const normal = triangle.normal;
    for (const vertex of triangle.vertices) {
      group.positions.push(...vertex);
      group.normals.push(...normal);
      group.colors.push(...color);
    }
    group.count += 1;
  }

  const mesh = doc.createMesh(building.id);
  for (const [name, group] of groups) {
    if (!group.count) continue;
    const material = doc.createMaterial(name)
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(attributePbrSettings[name].metallic)
      .setRoughnessFactor(attributePbrSettings[name].roughness)
      .setDoubleSided(true);
    const primitive = doc.createPrimitive()
      .setAttribute('POSITION', makeAccessor(doc, buffer, `${name}-position`, 'VEC3', group.positions))
      .setAttribute('NORMAL', makeAccessor(doc, buffer, `${name}-normal`, 'VEC3', group.normals))
      .setAttribute('COLOR_0', makeAccessor(doc, buffer, `${name}-color`, 'VEC4', group.colors))
      .setMaterial(material);
    mesh.addPrimitive(primitive);
  }
  const node = doc.createNode(building.name || building.id).setMesh(mesh).setExtras({
    plateau: { buildingId: building.id, lod: building.lod },
    comparisonRole: options.role,
    classTriangles: Object.fromEntries([...groups].map(([name, group]) => [name, group.count])),
    plateauFacadeEvidence: options.recommended ? {
      polygonCount: options.plateauEvidence.polygonCount,
      imageCount: options.plateauEvidence.imageRefs.length,
      alignedTriangles: evidenceStats.alignedTriangles,
      semanticOverrides: evidenceStats.semanticOverrides,
      localEvidenceTriangles: evidenceStats.localEvidenceTriangles,
      localSemanticOverrides: evidenceStats.localSemanticOverrides,
      suppressedWindowTriangles: evidenceStats.suppressedWindowTriangles,
      localColorTriangles: evidenceStats.localColorTriangles,
    } : undefined,
  });
  scene.addChild(node);
  await new NodeIO().write(outputPath, doc);
  return {
    classTriangles: Object.fromEntries([...groups].map(([name, group]) => [name, group.count])),
    evidenceStats,
  };
}

const source = JSON.parse(await readFile(geometryPath, 'utf8'));
const building = source.buildings.find((candidate) => candidate.id === targetBuildingId);
if (!building) throw new Error(`Target building not found: ${targetBuildingId}`);

const palette = await deriveMapillaryPalette(sourceImagePath);
const semanticPalette = expandSemanticPalette(palette);
const plateauEvidence = await derivePlateauFacadeEvidence(plateauRecipePath, targetBuildingId);
const { descriptors, components, originalTriangles } = buildDescriptors(building);
const triangles = descriptors.flatMap((descriptor) => semanticFragments(descriptor, building.min[1]));

await mkdir(outDir, { recursive: true });
const neutralPath = `${outDir}/tocho-one-building-neutral.glb`;
const phase123Path = `${outDir}/tocho-one-building-phase123.glb`;
const recommendedPath = `${outDir}/tocho-one-building-recommended-1to6.glb`;
await createNeutralModel(descriptors, building, neutralPath);
const phase123Result = await createAppearanceModel(triangles, building, semanticPalette, phase123Path, {
  role: 'phase1236-semantic-pbr',
  recommended: false,
});
attachRecommendedEvidence(descriptors, plateauEvidence);
const recommendedResult = await createAppearanceModel(triangles, building, semanticPalette, recommendedPath, {
  role: 'recommended-evidence-aware-semantic-albedo',
  recommended: true,
  plateauEvidence,
});

const paletteSummary = Object.fromEntries(semanticMaterials.map((name) => [name, {
  srgb: semanticPalette[name].map((v) => +v.toFixed(4)),
  hex: rgbHex(semanticPalette[name]),
}]));
const descriptorStats = {
  polygonCount: descriptors.length,
  wallSurfacePolygons: descriptors.filter((descriptor) => descriptor.isWallSurface).length,
  componentCount: components.size,
  windowEligiblePolygons: descriptors.filter((descriptor) => descriptor.windowEligible).length,
  windowExcludedPolygons: descriptors.filter((descriptor) => descriptor.isWallSurface && !descriptor.windowEligible).length,
  nonWallPolygons: descriptors.filter((descriptor) => !descriptor.isWallSurface).length,
  evidenceMatchedPolygons: descriptors.filter((descriptor) => descriptor.evidence?.sampleCount >= 3).length,
  evidenceMatchedWallPolygons: descriptors.filter((descriptor) => descriptor.isWallSurface && descriptor.evidence?.sampleCount >= 3).length,
  partCounts: Object.fromEntries([...new Set(descriptors.map((descriptor) => descriptor.part))].sort().map((part) => [
    part,
    descriptors.filter((descriptor) => descriptor.part === part).length,
  ])),
};
descriptorStats.evidenceWallCoverage = descriptorStats.wallSurfacePolygons > 0
  ? descriptorStats.evidenceMatchedWallPolygons / descriptorStats.wallSurfacePolygons
  : 0;
const plateauEvidenceSummary = {
  recipe: plateauRecipePath,
  nominalAlignedRecipePolygons: plateauEvidence.polygonCount,
  populatedUsableRecipePolygons: plateauEvidence.usablePolygonCount,
  zeroSampleRecipePolygons: plateauEvidence.zeroSamplePolygonCount,
  sourceUvConvention: 'recipe sourceUV already has CityGML V converted to top-down source-image coordinates; bitmap sampling uses v directly',
  imageRefs: plateauEvidence.imageRefs,
  directions: Object.fromEntries(Object.entries(plateauEvidence.directions).map(([direction, evidence]) => [direction, {
    sampleCount: evidence.sampleCount,
    median: evidence.median.map((v) => +v.toFixed(4)),
    normalizedAlbedo: evidence.normalizedAlbedo.map((v) => +v.toFixed(4)),
    normalizedHex: rgbHex(evidence.normalizedAlbedo),
  }])),
};
const metadata = {
  building: { id: building.id, name: building.name, lod: building.lod, min: building.min, max: building.max },
  sourceGeometry: geometryPath,
  mapillary: {
    sourceAvailable: palette.sourceAvailable,
    sourcePath: palette.sourcePath,
    sampleCounts: palette.sampleCounts,
    sourceMedians: Object.fromEntries(Object.entries(palette.sourceMedians).map(([name, rgb]) => [name, rgb.map((v) => +v.toFixed(4))])),
  },
  plateauFacadeEvidence: plateauEvidenceSummary,
  palette: paletteSummary,
  attributePbrSettings,
  originalTriangles,
  renderedTriangles: triangles.length,
  descriptorStats,
  phase123ClassTriangles: phase123Result.classTriangles,
  recommendedClassTriangles: recommendedResult.classTriangles,
  recommendedEvidenceStats: recommendedResult.evidenceStats,
  semanticGrid: {
    floorHeight,
    floorOrigin,
    windowBand,
    bayWidth,
    bayOrigin,
    mullionBand,
  },
  sPriorityRealism: {
    profileVersion: 6,
    runtimeAugmentation: true,
    sourceModel: 'recommended',
    profiles: sPriorityProfiles,
    features: {
      proceduralMicroNormal: 'semantic-specific object-space procedural perturbation; no UV/normal-map dependency',
      spatialRoughness: 'semantic-specific deterministic spatial modulation around the baseline roughness, with low-frequency value-noise mixed in to reduce periodic banding',
      physicalGlass: 'MeshPhysicalMaterial IOR/transmission/clearcoat plus environment reflection and recessed dark backing layer',
      glassCellVariation: 'very weak deterministic floor/bay-scale roughness variation applied only to clearGlass/darkGlass/opaqueGlass to break perfectly uniform reflections without changing facade semantics',
      contactJointShadow: 'procedural facade floor/bay joint darkening; disabled on equipment/rail/duct/signage/unknown classes',
      macroWeathering: 'subtle height/orientation/runoff-biased low-frequency weathering, enabled only for compatible facade materials and disabled on glass/equipment/rail/duct/signage/unknown classes',
      structuredEnvironmentReflection: 'procedural low-frequency sky/cloud/horizon/skyline structure used only as an unmeasured outdoor reflection prior; not site-image reconstruction',
      glassInteriorVariation: 'recessed interior backing with deterministic floor/bay room brightness, weak warm/cool tint, slab shadow, and sparse blind variation visible through glass',
      glassOpticalWaviness: 'glass-only low-frequency normal deflection that approximates subtle curtain-wall pane waviness and breaks perfectly planar environment reflections; procedural prior, not measured surface reconstruction',
      facadeProfileBevel: 'semantic-gated procedural normal rolloff near floor/bay module edges for mullion/spandrel/panel/frame-like materials; visual profile prior, not measured LOD3 edge geometry',
    },
    dataAssessment: {
      verdict: 'sufficient-for-procedural-demo-not-for-physical-reconstruction',
      alignedPlateauSourceImages: plateauEvidence.imageRefs.length,
      nominalAlignedRecipePolygons: plateauEvidence.polygonCount,
      populatedUsableRecipePolygons: plateauEvidence.usablePolygonCount,
      plateauAlignedPolygons: plateauEvidence.polygonCount,
      evidenceMatchedPolygons: descriptorStats.evidenceMatchedPolygons,
      evidenceMatchedWallPolygons: descriptorStats.evidenceMatchedWallPolygons,
      evidenceWallCoverage: descriptorStats.evidenceWallCoverage,
      wallSurfacePolygons: descriptorStats.wallSurfacePolygons,
      mapillaryReferenceImages: palette.sourceAvailable ? 1 : 0,
      mapillaryUsage: 'global-color-prior-only-not-geometrically-aligned',
      limitation: 'RGB evidence does not uniquely determine micro-normal, spatial roughness, glass IOR/transmission, or occluded facade appearance; these remain material priors.',
      nextDataNeeded: 'multiple geometrically aligned ground-level views per facade from different azimuths/distances/heights and preferably different lighting conditions',
    },
  },
  models: {
    neutral: '/assets/level3-demo/tocho-one-building-neutral.glb',
    phase123: '/assets/level3-demo/tocho-one-building-phase123.glb',
    recommended: '/assets/level3-demo/tocho-one-building-recommended-1to6.glb',
    recommendedPlus: '/assets/level3-demo/tocho-one-building-recommended-1to6.glb',
  },
  methodStatus: {
    '1-window-eligible-mask': 'shared-phase-and-recommended-wall-surface-and-geometry-gated',
    '2-fine-semantic-taxonomy': `shared-phase-and-recommended-${semanticMaterials.length}-classes`,
    '3-geometry-part-separation': 'shared-phase-and-recommended-connectivity-and-dimension-based',
    '4-aligned-surface-evidence': 'recommended-only-per-cell-barycentric-sourceuv-local-patch',
    '5-evidence-confidence-consensus': 'recommended-only-single-aligned-source-plus-confidence-and-cell-consensus; no-multi-mapillary-fusion',
    '6-attribute-specific-pbr': 'shared-phase-and-recommended-identical-per-semantic-class',
    '7-procedural-micro-normal': 'recommended-plus-runtime-semantic-specific',
    '8-spatial-roughness': 'recommended-plus-runtime-semantic-specific',
    '9-physical-glass': 'recommended-plus-runtime-physical-material-environment-and-recessed-backing',
    '10-contact-joint-shadow': 'recommended-plus-runtime-facade-grid-only',
    '11-macro-weathering-aperiodic-roughness': 'recommended-plus-runtime-semantically-gated-height-orientation-runoff-noise',
    '12-glass-floor-bay-reflection-variation': 'recommended-plus-runtime-glass-only-deterministic-cell-roughness-variation',
    '13-structured-environment-reflection': 'recommended-plus-runtime-low-frequency-procedural-outdoor-ibl-structure',
    '14-glass-interior-depth-variation': 'recommended-plus-runtime-recessed-interior-floor-bay-variation',
    '15-glass-optical-waviness': 'recommended-plus-runtime-glass-only-low-frequency-normal-deflection',
    '16-facade-profile-bevel': 'recommended-plus-runtime-frame-trim-only-procedural-normal-rolloff-profile-prior',
  },
  methodProfiles: {
    phase: ['1-window-eligible-mask', '2-fine-semantic-taxonomy', '3-geometry-part-separation', '6-attribute-specific-pbr'],
    recommended: ['1-window-eligible-mask', '2-fine-semantic-taxonomy', '3-geometry-part-separation', '4-aligned-surface-evidence', '5-evidence-confidence-consensus', '6-attribute-specific-pbr'],
    recommendedPlus: ['1-window-eligible-mask', '2-fine-semantic-taxonomy', '3-geometry-part-separation', '4-aligned-surface-evidence', '5-evidence-confidence-consensus', '6-attribute-specific-pbr', '7-procedural-micro-normal', '8-spatial-roughness', '9-physical-glass', '10-contact-joint-shadow', '11-macro-weathering-aperiodic-roughness', '12-glass-floor-bay-reflection-variation', '13-structured-environment-reflection', '14-glass-interior-depth-variation', '15-glass-optical-waviness', '16-facade-profile-bevel'],
  },
};
await writeFile(`${outDir}/comparison.json`, JSON.stringify(metadata, null, 2));
await writeFile(`${outDir}/method.md`, `# 都庁1棟 外観比較（PLATEAU LOD${building.lod}）\n\n- 対象: ${building.name}（${building.id}）。Neutral / Phase / Recommended / Recommended+ は同一のPLATEAU LOD${building.lod}外形を基礎にする。真のLOD3形状ではない。Recommended+のみガラス面の内側に薄い暗色backing layerを追加する。\n- Neutral: 元形状 ${originalTriangles.toLocaleString()} triangles。テクスチャ/COLOR_0なし、単色PBR。\n- 比較条件: Phase = 手法1・2・3・6、Recommended = Phase + 手法4・5、Recommended+ = Recommended + 優先度Sの手法7〜16。Recommended+はRecommendedのGLBを再利用し、WebGL実行時だけ材質/ガラス内層を追加するため、既存Recommendedを保持したまま差分比較できる。\n- Phase / Recommended 共通: WallSurface判定、面寸法、法線、連結成分、屋上距離から「窓パターンを置いてよい面」を先に限定し、その面だけを階高${floorHeight}m・ベイ幅${bayWidth}mで細分化する。屋根・設備・手すり・柱/梁・小面・屋上付近面は窓分割しない。\n- 共通属性: ${semanticMaterials.join(', ')} の${semanticMaterials.length}分類。属性ごとにroughness/metallicを分離し、設備や壁を一律の窓/壁模様へ押し込まない。\n- Recommendedのみ: Phase生成完了後にPLATEAU保持済みレシピの画像根拠をdescriptorへ付与する。描画時の可視判定とは分離し、対象建物の全レシピポリゴンから image + sourceUV が有効なものをポリゴンIDで重複除去して採用する。窓/壁セル単位で代表点を共有し、同一セル内の細分化triangleが同じ画像根拠を使うことで三角形単位の色斑を抑える。サンプル数/信頼度を満たす場合のみ材質分類の上書きを許可する。方向だけが一致する未整合面への色転写は行わない。\n- 優先度S / Recommended+: (7) UV不要の属性別procedural micro-normal、(8) 属性別の空間roughness変動に低周波value-noiseを混ぜて周期縞を低減、(9) glassをMeshPhysicalMaterialへ置換してIOR/transmission/clearcoat/環境反射を与え、面内側へ暗色backing layerを追加、(10) ファサードの階/ベイ境界へ接合部contact shadow、(11) 高さ・方角・雨だれ傾向を使った低周波macro weatheringを互換性のある外装材だけへ弱く加える、(12) glassだけに階・ベイ単位の弱いroughness差を与え、完全に一様な反射を崩す、(13) 実測復元とは区別した低周波の空・雲・地平線・スカイライン構造を屋外IBLへ加えてガラス反射の平坦さを抑える、(14) ガラス内側の後退面に階・ベイ単位の明暗、弱い暖色/寒色、床スラブ影、疎なブラインド差を与えて奥行きと室内変化を加える、(15) glassだけに低周波の微小な法線うねりを与え、カーテンウォールの完全平面反射を崩す、(16) mullion/spandrel/metal panel等のframe系属性だけに階・ベイ境界付近の弱い法線ロールオフを加え、LOD2平面のままでも見切り・面取りのハイライトを作る。glass・設備・duct・railing・signage・unknownにはweatheringを適用せず、手法12・14・15はglass系だけ、手法16はframe/trim系だけへ適用する。\n- 局所位置合わせ: セル代表点を元PLATEAU三角形へ3D barycentric座標で写像し、同じ重みで sourceUV を補間する。得られた画像座標の7x7局所パッチから平均色、輝度、彩度、寒色度、輝度分散、エッジ強度、信頼度を計算し、窓候補の抑制・glass/stone/concrete/tile等の保守的な再分類とalbedo補正に使う。\n- PLATEAUファサード根拠: image + sourceUV が有効な整合済みポリゴン ${plateauEvidence.polygonCount}面 / source image ${plateauEvidence.imageRefs.length}枚。source imageが1枚でも、各WallSurfaceは固有のsourceUV領域へ幾何対応しているため、根拠の被覆率は画像枚数ではなくポリゴン単位で評価する。各sourceUV三角形内部をサンプリングし、黒領域・極端な暗部/白飛びを除外してalbedo寄りの色へ正規化する。\n- Mapillary根拠: ${palette.sourceAvailable ? 'repo-local reference imageを1枚使用' : '参照画像なし（fallback）'}。石材候補 ${palette.sampleCounts.stone} px、ガラス候補 ${palette.sampleCounts.glass} px。これはPhase / Recommended共通の全体色priorであり、手法4の対象面への幾何位置合わせ済み投影ではない。複数Mapillary画像の融合も行っていない。\n- 抑制結果: WallSurface ${descriptorStats.wallSurfacePolygons}面中、窓分割対象 ${descriptorStats.windowEligiblePolygons}面、除外 ${descriptorStats.windowExcludedPolygons}面。非WallSurface ${descriptorStats.nonWallPolygons}面は窓分割対象外。\n- Recommendedの画像根拠: 対応ポリゴン ${descriptorStats.evidenceMatchedPolygons}面（WallSurface ${descriptorStats.evidenceMatchedWallPolygons}/${descriptorStats.wallSurfacePolygons}面、被覆率 ${(descriptorStats.evidenceWallCoverage * 100).toFixed(2)}%）、画像根拠が対応した細分化triangle ${recommendedResult.evidenceStats.alignedTriangles}、局所パッチ利用 ${recommendedResult.evidenceStats.localEvidenceTriangles}、polygon fallback ${recommendedResult.evidenceStats.polygonFallbackTriangles}、材質override ${recommendedResult.evidenceStats.semanticOverrides}、局所窓抑制 ${recommendedResult.evidenceStats.suppressedWindowTriangles}。\n- データ量評価: 現状は優先度Sのprocedural材質検証には十分。ただし物理的に忠実な材質復元には不十分。位置合わせ済みPLATEAU画像は${plateauEvidence.imageRefs.length}枚、Mapillaryは1枚の全体色priorのみで、RGBだけからmicro-normal/roughness/ガラスIOR・透過率を一意に復元できない。次段階では各ファサードを複数方位・距離・高さから撮った幾何位置合わせ済み地上画像を追加する。手法13・14・15・16も実測復元ではなく意味制約付きの視覚priorである。\n- 未実装/非主張: NeRF/Gaussian Splatting、複数Mapillary視点の位置合わせ済み融合、対象壁に対応したSNAP地上写真融合、計測ベースのroughness/normal/IOR推定。\n- 基本色（sRGB）: ${semanticMaterials.map((name) => `${name} ${paletteSummary[name].hex}`).join(', ')}。\n`);

console.log(JSON.stringify(metadata, null, 2));
