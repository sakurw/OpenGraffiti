import sharp from 'sharp';

const base = 'data/texture-city/tocho-quality-east';
const files = {
  gray: `${base}/sw-gray-ownership-review/p221-m16-gray-mask.png`,
  photo: `${base}/sw-gray-ownership-review/p221-m16-photo-preserve-mask.png`,
  foot: `${base}/sw-gray-ownership-review/p221-m16-footprint-mask.png`,
  interior: `${base}/sw-gray-ownership-review/p221-m16-gray-interior-1texel-mask.png`,
  direct: `${base}/sw-gray-visibility-review/p221-145064071-direct-visible-mask.png`,
  safe: `${base}/sw-gray-visibility-review/p221-145064071-safe-mask.png`,
  combined: `${base}/sw-gray-visibility-review/p221-combined-safe-mask.png`,
};

async function loadMask(path) {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function count(mask) {
  let total = 0;
  for (const value of mask.data) total += value !== 0 ? 1 : 0;
  return total;
}

function assertSameShape(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`shape mismatch: ${left.width}x${left.height} vs ${right.width}x${right.height}`);
  }
}

function countPredicate(left, right, predicate) {
  assertSameShape(left, right);
  let total = 0;
  for (let i = 0; i < left.data.length; i += 1) {
    if (predicate(left.data[i] !== 0, right.data[i] !== 0)) total += 1;
  }
  return total;
}

function equalPredicate(target, left, right, predicate) {
  assertSameShape(target, left);
  assertSameShape(left, right);
  for (let i = 0; i < target.data.length; i += 1) {
    const expected = predicate(left.data[i] !== 0, right.data[i] !== 0);
    if ((target.data[i] !== 0) !== expected) return false;
  }
  return true;
}

function equal(left, right) {
  assertSameShape(left, right);
  for (let i = 0; i < left.data.length; i += 1) {
    if ((left.data[i] !== 0) !== (right.data[i] !== 0)) return false;
  }
  return true;
}

const masks = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await loadMask(path)])),
);

for (const [name, mask] of Object.entries(masks)) {
  console.log(`${name}: shape=${mask.width}x${mask.height} count=${count(mask)}`);
}

const checks = {
  safeOutsideGray: countPredicate(masks.safe, masks.gray, (safe, gray) => safe && !gray),
  safeOutsideInterior: countPredicate(masks.safe, masks.interior, (safe, interior) => safe && !interior),
  safeOutsideFoot: countPredicate(masks.safe, masks.foot, (safe, foot) => safe && !foot),
  safeIntersectsExistingPhoto: countPredicate(masks.safe, masks.photo, (safe, photo) => safe && photo),
  safeOutsideDirect: countPredicate(masks.safe, masks.direct, (safe, direct) => safe && !direct),
  grayIntersectsExistingPhoto: countPredicate(masks.gray, masks.photo, (gray, photo) => gray && photo),
  footNotClassifiedGrayOrPhoto: countPredicate(
    masks.foot,
    masks.gray,
    (foot, gray) => foot && !gray,
  ) - countPredicate(masks.foot, masks.photo, (foot, photo) => foot && !photo && false),
  grayOrPhotoOutsideFoot: (() => {
    assertSameShape(masks.gray, masks.photo);
    assertSameShape(masks.gray, masks.foot);
    let total = 0;
    for (let i = 0; i < masks.gray.data.length; i += 1) {
      const classified = masks.gray.data[i] !== 0 || masks.photo.data[i] !== 0;
      if (classified && masks.foot.data[i] === 0) total += 1;
    }
    return total;
  })(),
};

// Compute the one three-mask count separately to avoid hiding any classification gaps.
let footNotClassifiedGrayOrPhoto = 0;
for (let i = 0; i < masks.foot.data.length; i += 1) {
  if (masks.foot.data[i] !== 0 && masks.gray.data[i] === 0 && masks.photo.data[i] === 0) {
    footNotClassifiedGrayOrPhoto += 1;
  }
}
checks.footNotClassifiedGrayOrPhoto = footNotClassifiedGrayOrPhoto;

for (const [name, value] of Object.entries(checks)) console.log(`${name}: ${value}`);

const safeEqualsInteriorAndDirect = equalPredicate(
  masks.safe,
  masks.interior,
  masks.direct,
  (interior, direct) => interior && direct,
);
const combinedEqualsSafe = equal(masks.combined, masks.safe);
console.log(`safeEqualsInteriorAndDirect: ${safeEqualsInteriorAndDirect}`);
console.log(`combinedEqualsSafe: ${combinedEqualsSafe}`);

const requiredZero = [
  'safeOutsideGray',
  'safeOutsideInterior',
  'safeOutsideFoot',
  'safeIntersectsExistingPhoto',
  'safeOutsideDirect',
  'grayIntersectsExistingPhoto',
  'grayOrPhotoOutsideFoot',
];
if (requiredZero.some((name) => checks[name] !== 0)) {
  throw new Error('one or more p221 ownership/safety invariants are violated');
}
if (!safeEqualsInteriorAndDirect) throw new Error('safe mask is not exactly interior AND direct-visible');
if (!combinedEqualsSafe) throw new Error('combined safe mask differs from accepted source safe mask');
console.log('PASS: p221 safe-mask ownership and visibility invariants hold');
