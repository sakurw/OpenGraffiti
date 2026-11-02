import sharp from 'sharp';
import { createHash } from 'node:crypto';
export function imageHash(raw, width, height) {
  const dims = Buffer.alloc(8); dims.writeUInt32BE(width); dims.writeUInt32BE(height, 4);
  return createHash('sha256').update(dims).update(raw).digest('hex');
}
const round = (n, d) => Math.sign(n) * Math.floor((Math.abs(n) + Math.floor(d / 2)) / d);
export function fadePixels(a, b, width, height, p) {
  if (p <= 0) return Buffer.from(a); if (p >= 1000) return Buffer.from(b);
  const out = Buffer.alloc(a.length), y = new Uint8Array(width * height);
  for (let i = 0; i < y.length; i++) { const j = i * 4; y[i] = round(77 * Math.abs(a[j] - b[j]) + 150 * Math.abs(a[j+1] - b[j+1]) + 29 * Math.abs(a[j+2] - b[j+2]), 256); }
  const get = (x, yy) => y[Math.max(0, Math.min(height - 1, yy)) * width + Math.max(0, Math.min(width - 1, x))];
  const color = Math.max(0, round((667 - p) * 1000, 667));
  const edge = p <= 333 ? 0 : p <= 667 ? round((p - 333) * 1000, 334) : round((1000 - p) * 1000, 333);
  for (let yy = 0; yy < height; yy++) for (let x = 0; x < width; x++) {
    const gx = -get(x-1, yy-1)+get(x+1, yy-1)-2*get(x-1, yy)+2*get(x+1, yy)-get(x-1, yy+1)+get(x+1, yy+1);
    const gy = -get(x-1, yy-1)-2*get(x, yy-1)-get(x+1, yy-1)+get(x-1, yy+1)+2*get(x, yy+1)+get(x+1, yy+1);
    const weight = Math.max(color, Math.min(255, Math.abs(gx)+Math.abs(gy)) >= 48 ? edge : 0);
    const i = (yy * width + x) * 4;
    for (let c = 0; c < 3; c++) out[i+c] = b[i+c] + round((a[i+c] - b[i+c]) * weight, 1000);
    out[i+3] = b[i+3]; if (!out[i+3]) out.fill(0, i, i+4);
  }
  return out;
}
export async function decode(input) { return sharp(input).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true }); }
export async function encode(raw, width, height) { return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer(); }
