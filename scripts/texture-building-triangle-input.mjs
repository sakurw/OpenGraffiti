// Convert a PLATEAU GLB mesh into triangle projection input for
// texture-building-triangle-visible-mask.py.
//
// The camera transform is kept external so the same geometry can be evaluated
// against different landmark photo registrations.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [model, cameraFile, output = 'data/texture-city/triangle-input.json'] = process.argv.slice(2);
if (!model || !cameraFile) {
  console.error('Usage: node texture-building-triangle-input.mjs <model.glb> <camera.json> [output]');
  process.exit(1);
}

const camera = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(cameraFile), 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(resolve(model));

const result = { triangles: [], vertices: [], status: 'triangle-input-generated', source: resolve(model) };
const vertexIds = new Map();
const meshIndexMap = new Map(document.getRoot().listMeshes().map((mesh, index) => [mesh, index]));

function registerVertex(meshName, geometryKey, index, worldPoint, viewPoint, normal) {
  const key = `${geometryKey}:${index}`;
  if (!vertexIds.has(key)) {
    vertexIds.set(key, result.vertices.length);
    result.vertices.push({
      id: result.vertices.length,
      mesh: meshName,
      geometryKey,
      sourceIndex: index,
      world: worldPoint,
      view: viewPoint,
      normal
    });
  }
  return vertexIds.get(key);
}

function project(point) {
  const v = [point[0], point[1], point[2], 1];
  const view = camera.view;
  const proj = camera.projection;
  const mv = [
    view[0]*v[0]+view[4]*v[1]+view[8]*v[2]+view[12],
    view[1]*v[0]+view[5]*v[1]+view[9]*v[2]+view[13],
    view[2]*v[0]+view[6]*v[1]+view[10]*v[2]+view[14],
    view[3]*v[0]+view[7]*v[1]+view[11]*v[2]+view[15]
  ];
  const clip = [
    proj[0]*mv[0]+proj[4]*mv[1]+proj[8]*mv[2]+proj[12]*mv[3],
    proj[1]*mv[0]+proj[5]*mv[1]+proj[9]*mv[2]+proj[13]*mv[3],
    proj[2]*mv[0]+proj[6]*mv[1]+proj[10]*mv[2]+proj[14]*mv[3],
    proj[3]*mv[0]+proj[7]*mv[1]+proj[11]*mv[2]+proj[15]*mv[3]
  ];
  return {
    screen: [
    (clip[0] / clip[3] * 0.5 + 0.5) * camera.resolution[0],
    (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * camera.resolution[1],
    ],
    depth: -mv[2],
    gpuDepth: clip[3] !== 0 ? (clip[2] / clip[3] * 0.5 + 0.5) : Infinity,
    clip,
  };
}

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function transformView(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function transformNormal(matrix, normal) {
  const x = matrix[0] * normal[0] + matrix[4] * normal[1] + matrix[8] * normal[2];
  const y = matrix[1] * normal[0] + matrix[5] * normal[1] + matrix[9] * normal[2];
  const z = matrix[2] * normal[0] + matrix[6] * normal[1] + matrix[10] * normal[2];
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function resolveSemanticExtras(nodeExtras, primitiveIndex, indexOffset) {
  const ranges = nodeExtras?.wallFaces ?? [];
  const face = ranges.find((range) => {
    const start = Number(range.start ?? 0);
    const count = Number(range.count ?? 0);
    return indexOffset / 3 >= start && indexOffset / 3 < start + count;
  });
  return face ? {
    wallId: face.wallId ?? null,
    polygonId: face.polygonId ?? null,
    semanticSource: 'PLATEAU-wallFaces'
  } : null;
}

function clipViewTriangle(vertices) {
  const plane = (v) => -v[2] - camera.near;
  const out = [];
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    const currentInside = plane(current) > 0;
    const nextInside = plane(next) > 0;
    if (currentInside && nextInside) out.push(next);
    else if (currentInside !== nextInside) {
      const dc = plane(current);
      const dn = plane(next);
      const t = dc / (dc - dn);
      out.push(current.map((v, j) => v + (next[j] - v) * t));
      if (nextInside) out.push(next);
    }
  }
  return out;
}

function projectViewPoint(viewPoint) {
  const clip = [
    camera.projection[0] * viewPoint[0] + camera.projection[4] * viewPoint[1] + camera.projection[8] * viewPoint[2] + camera.projection[12],
    camera.projection[1] * viewPoint[0] + camera.projection[5] * viewPoint[1] + camera.projection[9] * viewPoint[2] + camera.projection[13],
    camera.projection[2] * viewPoint[0] + camera.projection[6] * viewPoint[1] + camera.projection[10] * viewPoint[2] + camera.projection[14],
    camera.projection[3] * viewPoint[0] + camera.projection[7] * viewPoint[1] + camera.projection[11] * viewPoint[2] + camera.projection[15],
  ];
  return {
    screen: [
      (clip[0] / clip[3] * 0.5 + 0.5) * camera.resolution[0],
      (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * camera.resolution[1],
    ],
    depth: -viewPoint[2],
    gpuDepth: clip[3] !== 0 ? (clip[2] / clip[3] * 0.5 + 0.5) : Infinity,
  };
}

for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const worldMatrix = node.getWorldMatrix();
  const meshName = node.getName() || '';
  const meshIndex = meshIndexMap.get(mesh) ?? -1;
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
    const position = primitive.getAttribute('POSITION');
    const normalAttribute = primitive.getAttribute('NORMAL');
    const indices = primitive.getIndices();
    if (!position || !indices) continue;
    for (let i = 0; i < indices.getCount(); i += 3) {
      const viewPoints = [];
      const points = [];
      const triangleVertexIds = [];
      const normals = [];
      for (const offset of [0, 1, 2]) {
        const index = indices.getElement(i + offset, [0])[0];
        const worldPoint = transformPoint(worldMatrix, position.getElement(index, []));
        const normal = normalAttribute
          ? transformNormal(worldMatrix, normalAttribute.getElement(index, []))
          : null;
        const viewPoint = transformView(camera.view, worldPoint);
        viewPoints.push(viewPoint);
        triangleVertexIds.push(registerVertex(`${meshName}:${primitiveIndex}`, primitive.getName?.() || '', index, worldPoint, viewPoint, normal));
        normals.push(normal);
        points.push(project(worldPoint));
      }
      const clippedView = clipViewTriangle(viewPoints);
      if (clippedView.length !== 3) continue;
      const clippedPoints = clippedView.map(projectViewPoint);
      const depths = clippedPoints.map(p => p.depth);
      const gpuDepths = clippedPoints.map(p => p.gpuDepth);
      const center = clippedPoints.reduce((sum, p) => [sum[0] + p.screen[0], sum[1] + p.screen[1]], [0, 0]).map(v => v / 3);
      const averagedNormal = normals.filter(Boolean).reduce((sum, n) => [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]], [0, 0, 0]);
      const normalLength = Math.hypot(...averagedNormal) || 1;
      result.triangles.push({
        id: result.triangles.length,
        primitiveId: primitiveIndex,
        meshIndex,
        meshName,
        semantic: resolveSemanticExtras(node.getExtras?.(), primitiveIndex, i),
        indexOffset: i,
        vertexIds: triangleVertexIds,
        screen: clippedPoints.map(p => p.screen),
        depths,
        gpuDepths,
        normals,
        center,
        normal: normals.every(Boolean) ? averagedNormal.map(v => v / normalLength) : null,
        depth: depths.reduce((a, p) => a + p, 0) / 3
      });
    }
  }
}

result.triangleAreas = Object.fromEntries(result.triangles.map((triangle, index) => {
  const vertices = triangle.vertexIds.map(id => result.vertices[id].world);
  const ab = [vertices[1][0] - vertices[0][0], vertices[1][1] - vertices[0][1], vertices[1][2] - vertices[0][2]];
  const ac = [vertices[2][0] - vertices[0][0], vertices[2][1] - vertices[0][1], vertices[2][2] - vertices[0][2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const area = Math.hypot(...cross) * 0.5;
  return [String(index), area];
}));

await writeFile(resolve(output), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, triangles: result.triangles.length, output }));
