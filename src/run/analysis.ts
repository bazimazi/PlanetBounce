import { fmtInt } from '../core/math';
import type { World } from '../world/world';
import type { FlightTracker } from './flight';

/**
 * Turns a failure into a lesson: what happened, where, how fast, and which gravity was
 * responsible. The player should never think "the game randomly killed me."
 */

export type FailureCause = 'lost' | 'crash' | 'destroyed' | 'collapse' | 'asteroid';

export interface FailureReport {
  cause: FailureCause;
  title: string;
  lines: string[];
  tip: string;
  x: number;
  y: number;
  body: number;
  /** Closest approach to the most likely intended target. */
  nearMiss?: { body: number; distance: number };
}

export function analyzeFailure(
  world: World,
  tracker: FlightTracker | null,
  cause: FailureCause,
  ctx: { x: number; y: number; body: number; speed: number; t: number; hardImpact?: number },
): FailureReport {
  const bodies = world.bodies;
  const b = ctx.body >= 0 ? bodies[ctx.body] : undefined;
  const lines: string[] = [];
  let title = '';
  let tip = '';
  const speed = fmtInt(ctx.speed);

  // Most likely intended target: the landable world we came closest to (excluding origin).
  let nearMiss: FailureReport['nearMiss'];
  if (tracker) {
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < bodies.length; i++) {
      const bb = bodies[i]!;
      if (i === tracker.from || !bb.type.landable || bb.mu <= 0) continue;
      const d = tracker.closest[i]!;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (bi >= 0 && Number.isFinite(best)) nearMiss = { body: bi, distance: Math.max(0, best) };
  }

  switch (cause) {
    case 'lost': {
      title = 'Lost in the void';
      lines.push(`You drifted out of the sector at ${speed} u/s.`);
      if (nearMiss) {
        const nb = bodies[nearMiss.body]!;
        if (nearMiss.distance < 5) lines.push(`You touched ${nb.name} but were moving too fast to stay.`);
        else lines.push(`Closest approach: ${nb.name}, ${fmtInt(nearMiss.distance)} u from its surface.`);
      }
      const strongest = tracker ? tracker.assists[tracker.assists.length - 1] : undefined;
      if (strongest !== undefined) lines.push(`${bodies[strongest]!.name} bent your path — but not into a capture.`);
      tip = ctx.speed > 320 ? 'Launch softer: slower probes get captured by gravity.' : 'Aim a little ahead of your target — its pull will curve you in.';
      break;
    }
    case 'crash': {
      const name = b?.name ?? 'the body';
      const entered = tracker && ctx.body >= 0 ? tracker.enteredAt[ctx.body]! : -1;
      if (b?.type.lethal) {
        title = `Consumed by ${name}`;
        if (entered >= 0) lines.push(`You entered its gravity well ${(ctx.t - entered).toFixed(1)} s before impact, at ${speed} u/s.`);
        lines.push('Stars cannot be landed on — only passed.');
        tip = 'Stay outside the bright corona. A wider pass still gives a strong slingshot.';
      } else {
        title = `Crushed in ${name}’s core`;
        if (entered >= 0) lines.push(`${(ctx.t - entered).toFixed(1)} s after entering its well, the atmosphere slowed you below escape speed.`);
        lines.push('Gas giants have no surface. The outer haze brakes you; the core does not let go.');
        tip = 'Skim the outer atmosphere at a shallow angle to aerobrake safely.';
      }
      break;
    }
    case 'destroyed': {
      title = 'Hull breached';
      lines.push(`Impact at ${speed} u/s — the hull gives out above ${fmtInt(ctx.hardImpact ?? 540)} u/s.`);
      if (b) lines.push(`Surface: ${b.name}.`);
      tip = 'Arrive along the surface rather than straight into it, or brake before touchdown.';
      break;
    }
    case 'asteroid': {
      title = 'Shattered by debris';
      lines.push(`An asteroid hit you at ${speed} u/s relative speed.`);
      lines.push('Streams move on a steady rhythm — the gaps repeat.');
      tip = 'Wait on the surface for a gap, then launch through it.';
      break;
    }
    case 'collapse': {
      title = `${b?.name ?? 'The world'} collapsed`;
      lines.push('Unstable worlds break apart a few seconds after you land.');
      tip = 'Grab the ore and launch before the cracks glow white.';
      break;
    }
  }
  return { cause, title, lines, tip, x: ctx.x, y: ctx.y, body: ctx.body, nearMiss };
}
