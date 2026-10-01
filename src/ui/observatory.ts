import { PLANET_TYPES } from '../data/planetTypes';
import { Body } from '../physics/body';
import { drawRings } from '../presentation/celestial';
import { spritesFor } from '../presentation/sprites';
import { h } from './dom';

/** The hub uses the same planet artwork as the game, rendered once at display resolution. */
export function observatory(): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1000;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  const planet = new Body(47, { type: PLANET_TYPES.giant, x: 23, y: 91, radius: 115, rotSpeed: 0 });
  const sprite = spritesFor(planet, 2);
  const glow = ctx.createRadialGradient(250, 250, 80, 250, 250, 245);
  glow.addColorStop(0, 'rgba(49,173,197,0.2)');
  glow.addColorStop(1, 'rgba(49,173,197,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 500, 500);
  drawRings(ctx, 250, 250, 115, '#96d9cd', false);
  ctx.drawImage(sprite.surface, 250 - sprite.half, 250 - sprite.half, sprite.half * 2, sprite.half * 2);
  if (sprite.shade) ctx.drawImage(sprite.shade, 250 - sprite.half, 250 - sprite.half, sprite.half * 2, sprite.half * 2);
  drawRings(ctx, 250, 250, 115, '#96d9cd', true);
  const moon = new Body(5, { type: PLANET_TYPES.moon, x: 0, y: 0, radius: 19, rotSpeed: 0 });
  const ms = spritesFor(moon, 2);
  ctx.drawImage(ms.surface, 382 - ms.half, 106 - ms.half, ms.half * 2, ms.half * 2);
  if (ms.shade) ctx.drawImage(ms.shade, 382 - ms.half, 106 - ms.half, ms.half * 2, ms.half * 2);
  return h('div', { class: 'observatory', 'aria-label': 'A ringed ocean world and its orbiting survey probe' },
    h('div', { class: 'orbit-guide orbit-guide-outer' }),
    h('div', { class: 'orbit-guide orbit-guide-inner' }),
    canvas,
    h('div', { class: 'orbit-probe', 'aria-hidden': 'true' }),
    h('div', { class: 'planet-callout' }, h('span', null, '01 / THE INNER BELT'), h('strong', null, 'A universe in motion.'), h('small', null, 'Every world is a way forward.')),
    h('div', { class: 'coordinates', 'aria-hidden': 'true' }, 'RA 23h 18m  /  DEC +61° 32′'),
  );
}
