import type { Body } from '../physics/body';

// Continuous, seeded value noise: evaluated only when a planet's sprite is built.
function noise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz);
  const hash = (a: number, b: number, c: number) => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
    mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u), mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v), w);
}

export function fractal(x: number, y: number, z: number, seed: number): number {
  return noise(x, y, z, seed) * 0.55 + noise(x * 2.1, y * 2.1, z * 2.1, seed) * 0.27 + noise(x * 4.3, y * 4.3, z * 4.3, seed) * 0.13 + noise(x * 9, y * 9, z * 9, seed) * 0.05;
}

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Spherical terrain with multi-scale relief; no downloaded assets or runtime dependencies. */
export function drawTerrain(ctx: CanvasRenderingContext2D, body: Body, c: number, r: number): void {
  const style = body.type.style;
  if (!['rocky', 'moon', 'ocean', 'banded', 'ice', 'lava', 'rogue'].includes(style)) return;
  const size = Math.ceil(r * 2);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const tc = cv.getContext('2d')!;
  const im = tc.createImageData(size, size);
  const seed = (body.index * 7919 + Math.round(body.x0 * 13 + body.y0 * 7)) | 0;
  const dark = rgb(body.type.palette.dark), light = rgb(body.type.palette.light);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px + 0.5) / size * 2 - 1, y = (py + 0.5) / size * 2 - 1;
    const rr = x * x + y * y;
    if (rr > 1) continue;
    const z = Math.sqrt(1 - rr);
    const n = fractal(x * 4 + 13, y * 4 + 8, z * 4, seed);
    const fine = noise(x * 85, y * 85, z * 85, seed);
    let tint = Math.min(1, Math.max(0, n * 1.5 - 0.2));
    let col = dark.map((d, i) => d + (light[i]! - d) * tint);
    if (style === 'ocean') {
      col = n > 0.53 ? (n > 0.59 ? [72, 133, 105] : [142, 170, 116]) : [15 + n * 20, 63 + n * 80, 111 + n * 110];
      const cloud = fractal(x * 5 + n, y * 9, z * 5 + 20, seed + 71);
      const a = Math.max(0, (cloud - 0.54) * 5);
      col = col.map((q) => q * (1 - a) + 240 * a);
    } else if (style === 'banded') {
      tint = (Math.sin(y * 45 + n * 9) + 1) * 0.5;
      col = dark.map((d, i) => d + (light[i]! - d) * (0.28 + tint * 0.6));
    } else if (style === 'lava' || style === 'rogue') {
      const vein = Math.max(0, 1 - Math.abs(n - 0.5) * 65);
      col = style === 'lava' ? [42 + vein * 213, 28 + vein * 132, 37 + vein * 28] : [40 + vein * 215, 23 + vein * 50, 48 + vein * 104];
    }
    const relief = 0.8 + n * 0.36 + (fine - 0.5) * (style === 'ice' ? 0.12 : 0.22);
    // Subtle limb darkening supplies depth while the fixed shade supplies the sun direction.
    const limb = 0.6 + Math.pow(z, 0.35) * 0.4;
    const i = (py * size + px) * 4;
    for (let k = 0; k < 3; k++) im.data[i + k] = col[k]! * relief * limb;
    im.data[i + 3] = Math.min(1, (1 - Math.sqrt(rr)) * size) * 255;
  }
  tc.putImageData(im, 0, 0);
  ctx.drawImage(cv, c - r, c - r, r * 2, r * 2);
}
