import type { World } from '../world/world';
import { BodyFrame } from './body';
import { DT, Ev, copyProbe, makeProbe, step, type ProbeState, type SimParams } from './sim';

export interface Prediction {
  /** Flat [x0, y0, x1, y1, ...] sampled every `sampleEvery` steps. */
  points: Float32Array;
  count: number;
  endEvent: Ev;
  endBody: number;
  endSpeed: number;
  endX: number;
  endY: number;
  /** True when the path was cut short by the prediction horizon rather than an event. */
  truncated: boolean;
  /** First bounce / impact position, if any. */
  firstImpactX: number;
  firstImpactY: number;
  firstImpactBody: number;
  firstImpactEvent: Ev;
  lost: boolean;
}

/**
 * Runs the exact game simulation forward on a scratch probe. Allocation-free after construction,
 * so it can run every frame while aiming.
 */
export class Predictor {
  private frame: BodyFrame;
  private probe = makeProbe();
  readonly result: Prediction;
  private sampleEvery: number;

  constructor(private world: World, maxSeconds = 12, sampleEvery = 3) {
    this.frame = world.newFrame();
    this.sampleEvery = sampleEvery;
    const maxSamples = Math.ceil(maxSeconds / DT / sampleEvery) + 4;
    this.result = {
      points: new Float32Array(maxSamples * 2),
      count: 0,
      endEvent: Ev.None,
      endBody: -1,
      endSpeed: 0,
      endX: 0,
      endY: 0,
      truncated: true,
      firstImpactX: 0,
      firstImpactY: 0,
      firstImpactBody: -1,
      firstImpactEvent: Ev.None,
      lost: false,
    };
  }

  run(start: ProbeState, params: SimParams, seconds: number, stopOnBounce = false): Prediction {
    const s = copyProbe(this.probe, start);
    s.thrustX = 0;
    s.thrustY = 0;
    const r = this.result;
    const maxSteps = Math.floor(seconds / DT);
    const cap = r.points.length / 2;
    r.count = 0;
    r.endEvent = Ev.None;
    r.endBody = -1;
    r.endSpeed = 0;
    r.truncated = true;
    r.firstImpactBody = -1;
    r.firstImpactEvent = Ev.None;
    r.lost = false;
    let evBody = -1;
    let evSpeed = 0;
    const sink = (ev: Ev, body: number, speed: number) => {
      if (ev === Ev.Touch) return;
      evBody = body;
      evSpeed = speed;
      if ((ev === Ev.Bounce || ev === Ev.HardImpact || ev === Ev.AsteroidHit) && r.firstImpactBody < 0) {
        r.firstImpactBody = body;
        r.firstImpactEvent = ev;
        r.firstImpactX = s.x;
        r.firstImpactY = s.y;
      }
    };
    const bodies = this.world.bodies;
    r.points[0] = s.x;
    r.points[1] = s.y;
    r.count = 1;
    for (let i = 1; i <= maxSteps; i++) {
      const ev = step(bodies, this.frame, s, params, DT, sink);
      if (i % this.sampleEvery === 0 && r.count < cap) {
        r.points[r.count * 2] = s.x;
        r.points[r.count * 2 + 1] = s.y;
        r.count++;
      }
      if (ev === Ev.Land || ev === Ev.Crash || ev === Ev.Collapse || (stopOnBounce && ev !== Ev.None)) {
        r.endEvent = ev;
        r.endBody = evBody;
        r.endSpeed = evSpeed;
        r.truncated = false;
        break;
      }
      if (this.world.isLost(s.x, s.y, 200)) {
        r.lost = true;
        r.truncated = false;
        break;
      }
    }
    if (r.count < cap) {
      r.points[r.count * 2] = s.x;
      r.points[r.count * 2 + 1] = s.y;
      r.count++;
    }
    r.endX = s.x;
    r.endY = s.y;
    return r;
  }
}
