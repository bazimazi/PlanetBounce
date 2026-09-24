import { TAU } from '../core/math';
import { Rng, hash2 } from '../core/rng';
import type { Body } from '../physics/body';

/**
 * Pre-rendered celestial sprites. Each body gets a rotating "surface" sprite and a static
 * "shade" sprite (terminator shadow + rim light + atmosphere), so the lighting stays fixed
 * while the world turns underneath it.
 */

export interface BodySprites {
  surface: HTMLCanvasElement;
  shade: HTMLCanvasElement | null;
  /** Sprite pixels per world unit. */
  res: number;
  /** Sprite half-size in world units (may exceed radius for glow). */
  half: number;
}

export const LIGHT_X = -0.62;
export const LIGHT_Y = -0.78;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(4, Math.ceil(size));
  return [c, c.getContext('2d')!];
}

function blob(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, r: number, points = 12, jag = 0.35): void {
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    const rr = r * (1 - jag / 2 + rng.next() * jag);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function crater(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dark: string, light: string): void {
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = light;
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function speckle(ctx: CanvasRenderingContext2D, rng: Rng, c: number, r: number, color: string, n: number, size: number, alpha: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * r;
    ctx.globalAlpha = alpha * rng.range(0.4, 1);
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, size * rng.range(0.4, 1.4), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function crackLines(ctx: CanvasRenderingContext2D, rng: Rng, c: number, r: number, color: string, width: number, n: number, glow = 0): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const d = rng.range(0, r * 0.8);
    let x = c + Math.cos(a) * d;
    let y = c + Math.sin(a) * d;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = rng.int(3, 7);
    let dir = rng.range(0, TAU);
    for (let k = 0; k < segs; k++) {
      dir += rng.range(-0.8, 0.8);
      const step = r * rng.range(0.08, 0.2);
      x += Math.cos(dir) * step;
      y += Math.sin(dir) * step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawSurface(ctx: CanvasRenderingContext2D, body: Body, c: number, r: number, rng: Rng): void {
  const p = body.type.palette;
  const style = body.type.style;
  const base = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.1, c, c, r);
  base.addColorStop(0, p.light);
  base.addColorStop(0.35, p.base);
  base.addColorStop(1, p.dark);

  if (style === 'asteroid') {
    ctx.fillStyle = base;
    blob(ctx, rng, c, c, r, 9, 0.55);
    ctx.fill();
    speckle(ctx, rng, c, r * 0.7, p.dark, 6, r * 0.18, 0.6);
    return;
  }
  if (style === 'gate' || style === 'beacon' || style === 'derelict') {
    drawStructure(ctx, body, c, r, rng);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(c - r, c - r, r * 2, r * 2);

  switch (style) {
    case 'rocky': {
      speckle(ctx, rng, c, r, p.dark, 50, r * 0.12, 0.25);
      speckle(ctx, rng, c, r, p.light, 30, r * 0.08, 0.2);
      const n = rng.int(7, 12);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * r * 0.85;
        crater(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, r * rng.range(0.06, 0.2), p.dark, p.light);
      }
      break;
    }
    case 'moon': {
      speckle(ctx, rng, c, r, p.dark, 30, r * 0.14, 0.2);
      const n = rng.int(6, 10);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * r * 0.85;
        crater(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, r * rng.range(0.08, 0.25), p.dark, p.light);
      }
      break;
    }
    case 'ocean': {
      const land = ['#c8b67a', '#6a9c5a', '#4f7f48'];
      for (let i = 0; i < rng.int(5, 8); i++) {
        ctx.fillStyle = rng.pick(land);
        ctx.globalAlpha = 0.85;
        const a = rng.range(0, TAU);
        const d = rng.range(0, r * 0.8);
        blob(ctx, rng, c + Math.cos(a) * d, c + Math.sin(a) * d, r * rng.range(0.12, 0.3), 14, 0.6);
        ctx.fill();
      }
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        ctx.lineWidth = r * rng.range(0.03, 0.08);
        const y = c + rng.range(-r, r);
        const x = c + rng.range(-r, r * 0.3);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + r * 0.3, y - r * 0.1, x + r * 0.5, y + r * 0.1, x + r * rng.range(0.6, 1.1), y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'banded': {
      const colors = [p.base, p.light, p.dark, '#e8b27a', '#b8693a', '#f4d9a8'];
      let y = c - r;
      while (y < c + r) {
        const h = r * rng.range(0.06, 0.2);
        ctx.fillStyle = rng.pick(colors);
        ctx.globalAlpha = rng.range(0.5, 0.9);
        ctx.beginPath();
        ctx.moveTo(c - r, y);
        const amp = h * 0.25;
        for (let x = -r; x <= r; x += r / 8) ctx.lineTo(c + x, y + Math.sin(x / r * 5 + y) * amp);
        ctx.lineTo(c + r, y + h);
        for (let x = r; x >= -r; x -= r / 8) ctx.lineTo(c + x, y + h + Math.sin(x / r * 4 + y * 2) * amp);
        ctx.closePath();
        ctx.fill();
        y += h;
      }
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#c0502a';
      ctx.beginPath();
      ctx.ellipse(c + r * 0.25, c + r * 0.3, r * 0.2, r * 0.1, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'ice': {
      speckle(ctx, rng, c, r, '#ffffff', 60, r * 0.05, 0.5);
      crackLines(ctx, rng, c, r, '#7fc8ff', Math.max(1, r * 0.03), 10);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(c, c - r * 0.85, r * 0.6, r * 0.25, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'lava':
    case 'rogue': {
      speckle(ctx, rng, c, r, '#000000', 40, r * 0.12, 0.3);
      crackLines(ctx, rng, c, r, style === 'lava' ? '#ff7a2a' : '#ff5c7a', Math.max(1.2, r * 0.04), style === 'lava' ? 14 : 18, r * 0.12);
      crackLines(ctx, rng, c, r, '#ffe0a0', Math.max(0.8, r * 0.015), 6, r * 0.05);
      if (style === 'lava') {
        ctx.fillStyle = '#ff5a1f';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(c, c - r * 0.92, r * 0.16, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'crystal': {
      const shades = ['#b594ff', '#7a55e0', '#e6dcff', '#5a3bbf', '#c9b3ff'];
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = rng.pick(shades);
        ctx.globalAlpha = rng.range(0.5, 0.95);
        const a = rng.range(0, TAU);
        const d = rng.range(0, r);
        const x = c + Math.cos(a) * d;
        const y = c + Math.sin(a) * d;
        const s = r * rng.range(0.15, 0.4);
        ctx.beginPath();
        ctx.moveTo(x + rng.range(-s, s), y + rng.range(-s, s));
        ctx.lineTo(x + rng.range(-s, s), y + rng.range(-s, s));
        ctx.lineTo(x + rng.range(-s, s), y + rng.range(-s, s));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, r * 0.02);
      for (let i = 0; i < 8; i++) {
        const a = rng.range(0, TAU);
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'pulsar': {
      for (let i = 6; i >= 1; i--) {
        ctx.strokeStyle = i % 2 ? p.light : p.glow;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = r * 0.05;
        ctx.beginPath();
        ctx.arc(c, c, (r * i) / 6.5, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      speckle(ctx, rng, c, r, '#ffffff', 30, r * 0.04, 0.6);
      break;
    }
    case 'star': {
      const g = ctx.createRadialGradient(c, c, 0, c, c, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, p.light);
      g.addColorStop(0.85, p.base);
      g.addColorStop(1, p.dark);
      ctx.fillStyle = g;
      ctx.fillRect(c - r, c - r, 2 * r, 2 * r);
      speckle(ctx, rng, c, r, '#ffb347', 60, r * 0.08, 0.25);
      break;
    }
  }
  ctx.restore();
}

function drawStructure(ctx: CanvasRenderingContext2D, body: Body, c: number, r: number, rng: Rng): void {
  const p = body.type.palette;
  if (body.type.style === 'gate') {
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = p.light;
    ctx.lineWidth = r * 0.14;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = r * 0.35;
    ctx.beginPath();
    ctx.arc(c, c, r * 0.82, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = p.base;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.save();
      ctx.translate(c + Math.cos(a) * r * 0.82, c + Math.sin(a) * r * 0.82);
      ctx.rotate(a);
      ctx.fillRect(-r * 0.16, -r * 0.1, r * 0.32, r * 0.2);
      ctx.restore();
    }
    const g = ctx.createRadialGradient(c, c, 0, c, c, r * 0.7);
    g.addColorStop(0, 'rgba(180,255,255,0.9)');
    g.addColorStop(1, 'rgba(40,120,160,0.1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r * 0.68, 0, TAU);
    ctx.fill();
    return;
  }
  if (body.type.style === 'beacon') {
    const g = ctx.createRadialGradient(c, c, 0, c, c, r);
    g.addColorStop(0, '#fffbe6');
    g.addColorStop(0.5, '#ffd76b');
    g.addColorStop(1, '#8a6a1a');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const rr = i % 2 ? r * 0.8 : r;
      ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c, c, r * 0.25, 0, TAU);
    ctx.fill();
    return;
  }
  // Derelict: angular hull with glowing glyphs.
  ctx.fillStyle = p.base;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.dark;
  ctx.lineWidth = r * 0.05;
  for (let i = 0; i < 6; i++) {
    const y = c - r + ((i + 1) * 2 * r) / 7;
    ctx.beginPath();
    ctx.moveTo(c - r * 0.8, y);
    ctx.lineTo(c + r * 0.8, y);
    ctx.stroke();
  }
  ctx.fillStyle = p.light;
  ctx.shadowColor = p.glow;
  ctx.shadowBlur = r * 0.3;
  for (let i = 0; i < 10; i++) {
    ctx.globalAlpha = rng.range(0.5, 1);
    ctx.fillRect(c + rng.range(-r * 0.6, r * 0.5), c + rng.range(-r * 0.6, r * 0.5), r * 0.1, r * 0.06);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawShade(body: Body, res: number, half: number): HTMLCanvasElement | null {
  const style = body.type.style;
  if (style === 'star' || style === 'asteroid') return null;
  const size = half * 2 * res;
  const [cv, ctx] = canvas(size);
  const c = size / 2;
  const r = body.radius * res;
  const p = body.type.palette;
  // Atmosphere glow.
  const atmo = style === 'banded' ? 1.18 : style === 'gate' || style === 'beacon' || style === 'derelict' ? 1.5 : 1.28;
  const g = ctx.createRadialGradient(c, c, r * 0.9, c, c, r * atmo);
  g.addColorStop(0, hexA(p.glow, style === 'banded' ? 0.55 : 0.38));
  g.addColorStop(1, hexA(p.glow, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r * atmo, 0, TAU);
  ctx.fill();
  if (style === 'gate' || style === 'beacon' || style === 'derelict') return cv;
  // Terminator shadow, light from upper-left.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.clip();
  const sh = ctx.createRadialGradient(c + LIGHT_X * r * 0.55, c + LIGHT_Y * r * 0.55, r * 0.2, c + LIGHT_X * r * 0.3, c + LIGHT_Y * r * 0.3, r * 1.9);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(0.45, 'rgba(0,0,8,0.05)');
  sh.addColorStop(0.75, 'rgba(0,0,12,0.6)');
  sh.addColorStop(1, 'rgba(0,0,16,0.88)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  // Rim light on the lit edge.
  ctx.strokeStyle = hexA(p.light, 0.55);
  ctx.lineWidth = Math.max(1, r * 0.035);
  const la = Math.atan2(LIGHT_Y, LIGHT_X);
  ctx.beginPath();
  ctx.arc(c, c, r - ctx.lineWidth / 2, la - 1.1, la + 1.1);
  ctx.stroke();
  return cv;
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cache = new WeakMap<Body, BodySprites>();

export function spritesFor(body: Body, pixelRatio: number): BodySprites {
  let s = cache.get(body);
  if (s) return s;
  const maxPx = 440;
  const res = Math.min(pixelRatio * 1.6, maxPx / (body.radius * 2.4));
  const half = body.radius * 1.55;
  const size = half * 2 * res;
  const [surface, ctx] = canvas(size);
  const rng = new Rng(hash2(Math.round(body.x0 * 7 + body.radius), Math.round(body.y0 * 13 + body.index)));
  drawSurface(ctx, body, size / 2, body.radius * res, rng);
  s = { surface, shade: drawShade(body, res, half), res, half };
  cache.set(body, s);
  return s;
}
