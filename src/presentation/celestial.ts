import { TAU } from '../core/math';
import type { Body } from '../physics/body';
import { hexA } from './sprites';

/** Split ring passes let the planet correctly occlude its own rings. */
export function drawRings(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, front: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.36);
  ctx.scale(1, 0.32);
  const from = front ? 0 : Math.PI;
  for (let i = 0; i < 24; i++) {
    const radius = r * (1.42 + i * 0.024);
    ctx.strokeStyle = hexA(color, (i % 5 === 0 ? 0.08 : 0.22) * (1 - i / 36));
    ctx.lineWidth = r * 0.018;
    ctx.beginPath();
    ctx.arc(0, 0, radius, from, from + Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** Visual motion is independent of the collision surface. */
export function drawCelestialMotion(ctx: CanvasRenderingContext2D, body: Body, x: number, y: number, t: number, z: number, reduced: boolean): void {
  const r = body.radius, style = body.type.style, color = body.type.palette.glow;
  ctx.save();
  ctx.translate(x, y);
  if (style === 'gate' || style === 'beacon') {
    ctx.rotate(t * 0.22);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = hexA(color, 0.65 - i * 0.16);
      ctx.lineWidth = (i === 0 ? 2 : 1) / z;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.15 + i * 0.19), t * (i % 2 ? -0.4 : 0.3) + i * 2, t * (i % 2 ? -0.4 : 0.3) + i * 2 + Math.PI * 1.2);
      ctx.stroke();
    }
    if (!reduced) for (let i = 0; i < 16; i++) {
      const q = ((t * 0.17 + i / 16) % 1);
      const a = i * 2.4 + q * 3;
      const d = r * (1.9 - q * 1.6);
      ctx.globalAlpha = Math.sin(q * Math.PI) * 0.8;
      ctx.fillStyle = '#d5ffef';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1.5 / z, 0, TAU);
      ctx.fill();
    }
  } else if (!reduced && ['ocean', 'ice', 'crystal', 'pulsar'].includes(style)) {
    // Thin auroral ribbons hug the atmosphere instead of obscuring the terrain.
    ctx.rotate(-0.8);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = hexA(color, 0.13 + 0.08 * Math.sin(t * 0.7 + i));
      ctx.lineWidth = r * 0.025;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.045 + i * 0.035), -2.5 + Math.sin(t * 0.15 + i) * 0.3, -0.15);
      ctx.stroke();
    }
  }
  ctx.restore();
}
