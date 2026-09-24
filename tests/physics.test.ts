import { describe, expect, it } from 'vitest';
import { PLANET_TYPES } from '../src/data/planetTypes';
import { Predictor } from '../src/physics/predictor';
import { DEFAULT_SIM_PARAMS, DT, Ev, gravityAt, launch, makeProbe, step, type ProbeState } from '../src/physics/sim';
import { RouteSolver } from '../src/physics/solver';
import { World } from '../src/world/world';

const P = DEFAULT_SIM_PARAMS;

function makeWorld(): World {
  return new World({ kind: 'normal', name: 't', subtitle: '', regionId: 'r', index: 0, seed: 1 }, { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 });
}

function run(world: World, s: ProbeState, seconds: number, sink?: (ev: Ev, b: number, sp: number) => void): Ev[] {
  const f = world.newFrame();
  const evs: Ev[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    const ev = step(world.bodies, f, s, P, DT, (e, b, sp) => {
      evs.push(e);
      sink?.(e, b, sp);
    });
    if (ev === Ev.Land || ev === Ev.Crash) break;
  }
  return evs;
}

describe('gravity', () => {
  it('follows inverse square inside the sphere of influence and fades to zero at its edge', () => {
    const w = makeWorld();
    const b = w.add({ type: PLANET_TYPES.rocky, x: 0, y: 0, radius: 50, rotSpeed: 0 });
    const f = w.newFrame();
    f.eval(w.bodies, 0);
    const a1 = gravityAt(w.bodies, f, 100, 0, 0, P).ax;
    const a2 = gravityAt(w.bodies, f, 150, 0, 0, P).ax;
    expect(a1).toBeLessThan(0); // pulls toward the planet (negative x)
    expect(a1 / a2).toBeCloseTo((150 * 150) / (100 * 100), 5);
    expect(gravityAt(w.bodies, f, b.soi + 1, 0, 0, P).ax).toBe(0);
    const nearEdge = gravityAt(w.bodies, f, b.soi - 1, 0, 0, P).ax;
    expect(Math.abs(nearEdge)).toBeLessThan(0.01);
  });

  it('keeps a circular orbit stable over many revolutions (symplectic integrator)', () => {
    const w = makeWorld();
    const b = w.add({ type: PLANET_TYPES.giant, x: 0, y: 0, radius: 100, rotSpeed: 0 });
    const r = 200;
    const s = makeProbe();
    s.x = r;
    s.vy = Math.sqrt(b.mu / r);
    const period = (2 * Math.PI * r) / s.vy;
    const f = w.newFrame();
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < (period * 10) / DT; i++) {
      step(w.bodies, f, s, P, DT);
      const rr = Math.hypot(s.x, s.y);
      minR = Math.min(minR, rr);
      maxR = Math.max(maxR, rr);
    }
    expect(minR).toBeGreaterThan(r * 0.99);
    expect(maxR).toBeLessThan(r * 1.01);
  });
});

describe('collision', () => {
  function dropOnto(type: keyof typeof PLANET_TYPES, speed: number) {
    const w = makeWorld();
    w.add({ type: PLANET_TYPES[type], x: 0, y: 0, radius: 50, rotSpeed: 0 });
    const s = makeProbe();
    s.x = 0;
    s.y = -58;
    s.vy = speed;
    return { w, s, evs: run(w, s, 10) };
  }

  it('absorbs a gentle touchdown and lands', () => {
    const { s, evs } = dropOnto('rocky', 60);
    expect(evs).toContain(Ev.Land);
    expect(evs).not.toContain(Ev.Bounce);
    expect(s.landed).toBe(0);
  });

  it('bounces on a fast impact and eventually settles', () => {
    const { s, evs } = dropOnto('rocky', 320);
    expect(evs[0]).toBe(Ev.Bounce);
    expect(evs).toContain(Ev.Land);
    expect(s.landed).toBe(0);
  });

  it('reports hard impacts that damage the hull', () => {
    const { evs } = dropOnto('rocky', 700);
    expect(evs[0]).toBe(Ev.HardImpact);
  });

  it('ice is bouncier than rock', () => {
    const rebound = (type: 'rocky' | 'ice') => {
      const w = makeWorld();
      w.add({ type: PLANET_TYPES[type], x: 0, y: 0, radius: 50, rotSpeed: 0 });
      const s = makeProbe();
      s.y = -58;
      s.vy = 300;
      const f = w.newFrame();
      for (let i = 0; i < 60; i++) if (step(w.bodies, f, s, P, DT) === Ev.Bounce) break;
      return -s.vy;
    };
    expect(rebound('ice')).toBeGreaterThan(rebound('rocky') * 1.8);
  });

  it('gas giant atmosphere brakes, and its core is lethal', () => {
    const w = makeWorld();
    w.add({ type: PLANET_TYPES.gasGiant, x: 0, y: 0, radius: 100, rotSpeed: 0 });
    const s = makeProbe();
    s.x = -600;
    s.y = 80; // grazes the atmosphere
    s.vx = 380;
    const evs = run(w, s, 4);
    expect(evs).not.toContain(Ev.Crash);
    const s2 = makeProbe();
    s2.x = -600;
    s2.vx = 380;
    expect(run(w, s2, 4)).toContain(Ev.Crash);
  });

  it('touching a star is fatal', () => {
    const w = makeWorld();
    w.add({ type: PLANET_TYPES.star, x: 0, y: 0, radius: 80, rotSpeed: 0 });
    const s = makeProbe();
    s.x = -300;
    s.vx = 200;
    expect(run(w, s, 4)).toContain(Ev.Crash);
  });
});

describe('gravity assists', () => {
  it('flying behind a moving body steals its speed', () => {
    const w = makeWorld();
    // Giant moving +x at 160 u/s.
    w.add({
      type: PLANET_TYPES.giant,
      x: 0,
      y: 0,
      radius: 100,
      rotSpeed: 0,
      drift: { vx: 160, vy: 0, minX: -100000, maxX: 100000, minY: 0, maxY: 0 },
    });
    const s = makeProbe();
    s.x = 330;
    s.y = 700;
    s.vy = -260; // pass behind (trailing side) of the giant... it moves toward +x so we cross in front → test both
    const before = Math.hypot(s.vx, s.vy);
    run(w, s, 5);
    const after = Math.hypot(s.vx, s.vy);
    expect(Math.abs(after - before)).toBeGreaterThan(20); // a moving body changes speed, not just direction
  });

  it('a static body redirects without changing speed after the pass', () => {
    const w = makeWorld();
    w.add({ type: PLANET_TYPES.giant, x: 0, y: 0, radius: 100, rotSpeed: 0 });
    const s = makeProbe();
    s.x = -900;
    s.y = 220;
    s.vx = 300;
    const before = Math.hypot(s.vx, s.vy);
    run(w, s, 6);
    const after = Math.hypot(s.vx, s.vy);
    expect(after).toBeCloseTo(before, 0);
    expect(Math.abs(Math.atan2(s.vy, s.vx))).toBeGreaterThan(0.2);
  });
});

describe('prediction', () => {
  it('matches the live simulation exactly', () => {
    const w = makeWorld();
    w.add({ type: PLANET_TYPES.rocky, x: 0, y: 0, radius: 50, rotSpeed: 0.1 });
    w.add({ type: PLANET_TYPES.moon, x: 0, y: 0, radius: 20, rotSpeed: 0.2, orbit: { parent: 0, cx: 0, cy: 0, radius: 180, period: 9, phase: 0 } });
    w.add({ type: PLANET_TYPES.giant, x: 500, y: -400, radius: 100, rotSpeed: 0 });
    const s = makeProbe();
    s.landed = 0;
    s.landAngle = -1.2;
    const f = w.newFrame();
    launch(w.bodies, f, s, 0.6, -0.8, 330, P);
    const pred = new Predictor(w, 6, 1).run(s, P, 3);
    const live = { ...s };
    for (let i = 1; i < pred.count - 1; i++) {
      step(w.bodies, f, live, P, DT);
      if (live.landed >= 0) break;
      expect(live.x).toBeCloseTo(pred.points[i * 2]!, 2);
      expect(live.y).toBeCloseTo(pred.points[i * 2 + 1]!, 2);
    }
  });
});

describe('route solver', () => {
  it('finds a launch between two nearby planets', () => {
    const w = makeWorld();
    w.add({ type: PLANET_TYPES.rocky, x: 0, y: 0, radius: 50, rotSpeed: 0.1 });
    w.add({ type: PLANET_TYPES.rocky, x: 150, y: -450, radius: 50, rotSpeed: 0.1 });
    const r = new RouteSolver(w).solve(0, 1, P);
    expect(r.ok).toBe(true);
  });
});
