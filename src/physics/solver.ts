import type { World } from '../world/world';
import { BodyFrame } from './body';
import { DT, Ev, clampLaunchDir, launch, makeProbe, step, attachLanded, type SimParams } from './sim';

export interface SolveOptions {
  minSpeed: number;
  maxSpeed: number;
  /** Launch times to try (moving bodies change alignment over time). */
  times: number[];
  seconds: number;
  angleSteps: number;
  speedSteps: number;
  /** Half-width of the aim fan around the bearing to the target, radians. */
  fan: number;
  /** Surface positions to try, as angle offsets from the point facing the target. */
  surfaceOffsets: number[];
  /** Forbid contact with any other body before arriving. */
  strict: boolean;
}

export interface SolveResult {
  ok: boolean;
  t0: number;
  landAngle: number;
  dirX: number;
  dirY: number;
  speed: number;
  flightTime: number;
  bodiesTouched: number;
}

const DEFAULTS: SolveOptions = {
  minSpeed: 90,
  maxSpeed: 420,
  times: [0],
  seconds: 7,
  angleSteps: 29,
  speedSteps: 10,
  fan: 1.35,
  surfaceOffsets: [0],
  strict: false,
};

/**
 * Brute-force route finder over (surface point × launch angle × power) using the real simulation.
 * Used to validate procedural sectors ("every generated route is actually flyable") and to show
 * the tutorial's demonstration path.
 */
export class RouteSolver {
  private frame: BodyFrame;
  private probe = makeProbe();

  constructor(private world: World) {
    this.frame = world.newFrame();
  }

  solve(from: number, to: number, params: SimParams, options: Partial<SolveOptions> = {}): SolveResult {
    const o = { ...DEFAULTS, ...options };
    const bodies = this.world.bodies;
    const f = this.frame;
    const s = this.probe;
    const out = { x: 0, y: 0 };
    const fail: SolveResult = { ok: false, t0: 0, landAngle: 0, dirX: 0, dirY: 0, speed: 0, flightTime: 0, bodiesTouched: 0 };

    // Angle order: closest to the bearing first, alternating sides.
    const angleOrder: number[] = [0];
    for (let k = 1; k <= (o.angleSteps - 1) / 2; k++) {
      const a = (k / ((o.angleSteps - 1) / 2)) * o.fan;
      angleOrder.push(a, -a);
    }

    for (const t0 of o.times) {
      f.eval(bodies, t0);
      const fb = bodies[from]!;
      const bearing = Math.atan2(f.y[to]! - f.y[from]!, f.x[to]! - f.x[from]!);
      for (const off of o.surfaceOffsets) {
        const surf = bearing + off;
        const landAngle = surf - fb.rotationAt(t0);
        for (const da of angleOrder) {
          for (let si = 0; si < o.speedSteps; si++) {
            const speed = o.minSpeed + ((o.maxSpeed - o.minSpeed) * si) / Math.max(1, o.speedSteps - 1);
            // Reset probe on the surface.
            Object.assign(s, makeProbe());
            s.t = t0;
            s.landed = from;
            s.landAngle = landAngle;
            f.t = NaN;
            f.eval(bodies, t0);
            attachLanded(bodies, f, s, params);
            const nx = Math.cos(surf);
            const ny = Math.sin(surf);
            const aim = bearing + da;
            clampLaunchDir(nx, ny, Math.cos(aim), Math.sin(aim), out);
            launch(bodies, f, s, out.x, out.y, speed, params);
            let bad = false;
            let touched = 0;
            let landedOn = -1;
            const sink = (ev: Ev, body: number) => {
              if (ev === Ev.HardImpact || ev === Ev.AsteroidHit || ev === Ev.Crash || ev === Ev.Eject || ev === Ev.Collapse) bad = true;
              if ((ev === Ev.Bounce || ev === Ev.Touch) && body !== to) {
                touched++;
                if (o.strict || body === from) bad = true;
              }
              if (ev === Ev.Land) landedOn = body;
            };
            const steps = Math.floor(o.seconds / DT);
            let i = 0;
            for (; i < steps; i++) {
              const ev = step(bodies, f, s, params, DT, sink);
              if (bad || ev === Ev.Land) break;
              if (this.world.isLost(s.x, s.y, 150)) {
                bad = true;
                break;
              }
            }
            if (!bad && landedOn === to) {
              return { ok: true, t0, landAngle, dirX: out.x, dirY: out.y, speed, flightTime: i * DT, bodiesTouched: touched };
            }
          }
        }
      }
    }
    return fail;
  }
}
