import { Body, BodyFrame } from './body';

/**
 * The single source of truth for probe motion. The live game, the trajectory predictor and the
 * route solver all call `step` with the same fixed timestep, so what the player sees predicted is
 * exactly what happens (absent new input).
 */

export const DT = 1 / 120;

export interface SimParams {
  gravityScale: number;
  dragScale: number;
  probeRadius: number;
  /** Normal impact speed below which contact is absorbed (no bounce). */
  landSpeed: number;
  /** Relative tangential speed below which a sliding probe comes to rest. */
  settleSpeed: number;
  /** Normal impact speed that damages the hull. */
  hardImpact: number;
  restitutionBonus: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  gravityScale: 1,
  dragScale: 1,
  probeRadius: 7,
  landSpeed: 170,
  settleSpeed: 42,
  hardImpact: 540,
  restitutionBonus: 0,
};

export const enum Ev {
  None = 0,
  Bounce = 1,
  Land = 2,
  Crash = 3,
  HardImpact = 4,
  AsteroidHit = 5,
  Eject = 6,
  Collapse = 7,
  Touch = 8,
}

export interface SimSink {
  (ev: Ev, body: number, speed: number): void;
}

export interface ProbeState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  t: number;
  landed: number;
  landAngle: number;
  contact: number;
  touchSpeed: number;
  /** Extra acceleration (thrust) applied this step by the controller. */
  thrustX: number;
  thrustY: number;
  hookBody: number;
  hookUntil: number;
  hookStrength: number;
  lockBody: number;
  lockUntil: number;
  lockDir: number;
  lockRadius: number;
  /** Dominant gravity source at last evaluation (for camera/audio/UI/brake frame). */
  domBody: number;
  domAccel: number;
}

export function makeProbe(): ProbeState {
  return {
    x: 0, y: 0, vx: 0, vy: 0, ax: NaN, ay: NaN, t: 0,
    landed: -1, landAngle: 0, contact: -1, touchSpeed: 0,
    thrustX: 0, thrustY: 0,
    hookBody: -1, hookUntil: 0, hookStrength: 0,
    lockBody: -1, lockUntil: 0, lockDir: 1, lockRadius: 0,
    domBody: -1, domAccel: 0,
  };
}

export function copyProbe(dst: ProbeState, src: ProbeState): ProbeState {
  Object.assign(dst, src);
  return dst;
}

const g = { ax: 0, ay: 0, dom: -1, domA: 0 };

/** Sums gravity (and eruption blasts) at a point. Uses a smooth cutoff at each body's sphere of influence. */
export function gravityAt(bodies: readonly Body[], f: BodyFrame, x: number, y: number, t: number, p: SimParams): typeof g {
  let ax = 0;
  let ay = 0;
  let dom = -1;
  let domA = 0;
  for (let i = 0; i < bodies.length; i++) {
    if (!f.active[i]) continue;
    const b = bodies[i]!;
    const dx = f.x[i]! - x;
    const dy = f.y[i]! - y;
    const r2 = dx * dx + dy * dy;
    const soi = b.soi;
    if (r2 > soi * soi) continue;
    const r = Math.sqrt(r2);
    if (r < 1e-6) continue;
    const mu = f.mu[i]!;
    if (mu > 0) {
      const rr = Math.max(r, b.coreRadius * 0.8);
      let a = (mu / (rr * rr)) * p.gravityScale;
      const fadeStart = soi * 0.72;
      if (r > fadeStart) {
        const u = (r - fadeStart) / (soi - fadeStart);
        a *= 1 - u * u * (3 - 2 * u);
      }
      ax += (a * dx) / r;
      ay += (a * dy) / r;
      if (a > domA) {
        domA = a;
        dom = i;
      }
    }
    const beh = b.type.behavior;
    if (beh && beh.kind === 'erupt') {
      const e = b.eruptionAt(t);
      const reach = b.radius * beh.reach;
      if (e >= 0 && r < reach) {
        const falloff = 1 - Math.max(0, r - b.radius) / (reach - b.radius);
        const push = beh.strength * falloff * Math.sin(Math.PI * e);
        ax -= (push * dx) / r;
        ay -= (push * dy) / r;
      }
    }
  }
  g.ax = ax;
  g.ay = ay;
  g.dom = dom;
  g.domA = domA;
  return g;
}

/** Velocity of a body's surface at world point (px, py) — orbit/drift plus rotation. */
export function surfaceVelocity(b: Body, f: BodyFrame, px: number, py: number, out: { x: number; y: number }): void {
  const i = b.index;
  const rx = px - f.x[i]!;
  const ry = py - f.y[i]!;
  out.x = f.vx[i]! - b.rotSpeed * ry;
  out.y = f.vy[i]! + b.rotSpeed * rx;
}

const sv = { x: 0, y: 0 };

/** Places a landed probe on its body's rotating surface. */
export function attachLanded(bodies: readonly Body[], f: BodyFrame, s: ProbeState, p: SimParams): void {
  const b = bodies[s.landed]!;
  const ang = s.landAngle + b.rotationAt(s.t);
  const r = b.radius + p.probeRadius;
  s.x = f.x[b.index]! + Math.cos(ang) * r;
  s.y = f.y[b.index]! + Math.sin(ang) * r;
  surfaceVelocity(b, f, s.x, s.y, sv);
  s.vx = sv.x;
  s.vy = sv.y;
}

/** Launches a landed probe. Inherits the surface velocity of the body it stands on. */
export function launch(bodies: readonly Body[], f: BodyFrame, s: ProbeState, dirX: number, dirY: number, speed: number, p: SimParams): void {
  f.eval(bodies, s.t);
  if (s.landed >= 0) {
    attachLanded(bodies, f, s, p);
    const b = bodies[s.landed]!;
    const nx = s.x - f.x[b.index]!;
    const ny = s.y - f.y[b.index]!;
    const nl = Math.hypot(nx, ny);
    s.x += (nx / nl) * 0.5;
    s.y += (ny / nl) * 0.5;
  }
  s.vx += dirX * speed;
  s.vy += dirY * speed;
  s.landed = -1;
  s.contact = -1;
  s.ax = NaN;
}

/**
 * Clamps an aim direction so it never points into the ground: anything more than ~84° from the
 * surface normal is rotated back to that limit. Returns the adjusted unit vector.
 */
export function clampLaunchDir(nx: number, ny: number, dx: number, dy: number, out: { x: number; y: number }): void {
  const minCos = 0.1;
  const c = nx * dx + ny * dy;
  if (c >= minCos) {
    out.x = dx;
    out.y = dy;
    return;
  }
  // Tangent in the direction the aim leans.
  let tx = -ny;
  let ty = nx;
  if (tx * dx + ty * dy < 0) {
    tx = -tx;
    ty = -ty;
  }
  const s = Math.sqrt(1 - minCos * minCos);
  out.x = nx * minCos + tx * s;
  out.y = ny * minCos + ty * s;
}

/** Advances the probe by dt. Returns the most significant event this step. */
export function step(bodies: readonly Body[], f: BodyFrame, s: ProbeState, p: SimParams, dt: number, sink?: SimSink): Ev {
  if (s.landed >= 0) {
    s.t += dt;
    f.eval(bodies, s.t);
    const b = bodies[s.landed]!;
    if (!b.isActive(s.t)) {
      const idx = s.landed;
      s.landed = -1;
      sink?.(Ev.Collapse, idx, 0);
      return Ev.Collapse;
    }
    attachLanded(bodies, f, s, p);
    s.domBody = b.index;
    s.domAccel = f.mu[b.index]! / (b.radius * b.radius);
    if (b.eruptionAt(s.t) >= 0) {
      const beh = b.type.behavior!;
      const nx = (s.x - f.x[b.index]!) / (b.radius + p.probeRadius);
      const ny = (s.y - f.y[b.index]!) / (b.radius + p.probeRadius);
      const idx = s.landed;
      s.landed = -1;
      const kick = beh.kind === 'erupt' ? beh.strength * 0.42 : 300;
      s.vx += nx * kick - ny * kick * 0.35;
      s.vy += ny * kick + nx * kick * 0.35;
      s.x += nx;
      s.y += ny;
      s.ax = NaN;
      sink?.(Ev.Eject, idx, kick);
      return Ev.Eject;
    }
    return Ev.None;
  }

  f.eval(bodies, s.t);
  if (Number.isNaN(s.ax)) {
    const a0 = gravityAt(bodies, f, s.x, s.y, s.t, p);
    s.ax = a0.ax;
    s.ay = a0.ay;
  }

  // Extra accelerations held constant over the step.
  let ex = s.thrustX;
  let ey = s.thrustY;
  if (s.hookBody >= 0 && s.t < s.hookUntil) {
    const hx = f.x[s.hookBody]! - s.x;
    const hy = f.y[s.hookBody]! - s.y;
    const hl = Math.hypot(hx, hy) || 1;
    ex += (hx / hl) * s.hookStrength;
    ey += (hy / hl) * s.hookStrength;
  }

  // Velocity Verlet (symplectic → orbits stay stable over long captures).
  s.x += s.vx * dt + 0.5 * (s.ax + ex) * dt * dt;
  s.y += s.vy * dt + 0.5 * (s.ay + ey) * dt * dt;
  s.t += dt;
  f.eval(bodies, s.t);
  const a1 = gravityAt(bodies, f, s.x, s.y, s.t, p);
  s.vx += 0.5 * (s.ax + a1.ax) * dt + ex * dt;
  s.vy += 0.5 * (s.ay + a1.ay) * dt + ey * dt;
  s.ax = a1.ax;
  s.ay = a1.ay;
  s.domBody = a1.dom;
  s.domAccel = a1.domA;

  // Orbit Lock: constrain to a circular orbit around the locked body.
  if (s.lockBody >= 0) {
    if (s.t < s.lockUntil && f.active[s.lockBody]) {
      const lb = bodies[s.lockBody]!;
      const cx = f.x[s.lockBody]!;
      const cy = f.y[s.lockBody]!;
      let rx = s.x - cx;
      let ry = s.y - cy;
      const rl = Math.hypot(rx, ry) || 1;
      rx /= rl;
      ry /= rl;
      const r = Math.max(s.lockRadius, lb.radius + p.probeRadius + 4);
      s.x = cx + rx * r;
      s.y = cy + ry * r;
      const vc = Math.sqrt((f.mu[s.lockBody]! * p.gravityScale) / r);
      s.vx = f.vx[s.lockBody]! - ry * vc * s.lockDir;
      s.vy = f.vy[s.lockBody]! + rx * vc * s.lockDir;
      s.ax = NaN;
    } else {
      s.lockBody = -1;
    }
  }

  // Atmospheric drag (gas giants) — quadratic, relative to the body.
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    const k = b.type.atmosphereDrag;
    if (!k || !f.active[i]) continue;
    const dx = s.x - f.x[i]!;
    const dy = s.y - f.y[i]!;
    const r = Math.hypot(dx, dy);
    if (r >= b.radius || r <= b.coreRadius) continue;
    const density = 1 - (r - b.coreRadius) / (b.radius - b.coreRadius);
    const rvx = s.vx - f.vx[i]!;
    const rvy = s.vy - f.vy[i]!;
    const sp = Math.hypot(rvx, rvy);
    const fr = Math.min(0.9, k * p.dragScale * density * density * sp * dt);
    s.vx -= rvx * fr;
    s.vy -= rvy * fr;
  }

  // Collisions.
  let result = Ev.None;
  const pr = p.probeRadius;
  const prevContact = s.contact;
  s.contact = -1;
  for (let i = 0; i < bodies.length; i++) {
    if (!f.active[i]) continue;
    const b = bodies[i]!;
    const bx = f.x[i]!;
    const by = f.y[i]!;
    const solid = b.solidRadius;
    const dx = s.x - bx;
    const dy = s.y - by;
    const minD = solid + pr;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) continue;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d;
    const ny = dy / d;
    const t = b.type;

    if (t.lethal || !t.landable && !t.damageSpeed) {
      sink?.(Ev.Crash, i, Math.hypot(s.vx - f.vx[i]!, s.vy - f.vy[i]!));
      return Ev.Crash;
    }

    s.x = bx + nx * minD;
    s.y = by + ny * minD;
    surfaceVelocity(b, f, s.x, s.y, sv);
    let rvx = s.vx - sv.x;
    let rvy = s.vy - sv.y;
    const vn = rvx * nx + rvy * ny;
    let tvx = rvx - vn * nx;
    let tvy = rvy - vn * ny;
    let nOut = vn;

    if (t.damageSpeed) {
      // Asteroids: always bounce, sometimes hurt.
      const e = Math.min(0.95, t.restitution + p.restitutionBonus);
      if (vn < 0) {
        nOut = -vn * e;
        const rel = Math.hypot(rvx, rvy);
        if (rel > t.damageSpeed) {
          sink?.(Ev.AsteroidHit, i, rel);
          result = Ev.AsteroidHit;
        } else {
          sink?.(Ev.Bounce, i, -vn);
        }
        nOut = Math.max(nOut, 40);
      }
      s.vx = sv.x + tvx + nx * nOut;
      s.vy = sv.y + tvy + ny * nOut;
      s.ax = NaN;
      continue;
    }

    let absorbed = false;
    if (vn < 0) {
      if (-vn > p.landSpeed) {
        const e = Math.min(0.95, t.restitution + p.restitutionBonus);
        nOut = -vn * e;
        const keep = 1 - 0.5 * t.friction;
        tvx *= keep;
        tvy *= keep;
        if (-vn > p.hardImpact) {
          sink?.(Ev.HardImpact, i, -vn);
          result = Ev.HardImpact;
        } else {
          sink?.(Ev.Bounce, i, -vn);
          if (result === Ev.None) result = Ev.Bounce;
        }
      } else {
        nOut = 0;
        absorbed = true;
      }
    } else if (vn < 25) {
      absorbed = true; // resting contact
    }

    if (absorbed) {
      if (prevContact !== i) {
        s.touchSpeed = Math.max(0, -vn);
        sink?.(Ev.Touch, i, s.touchSpeed);
      }
      s.contact = i;
      // Sliding friction proportional to local surface gravity.
      const gs = (f.mu[i]! / (b.radius * b.radius)) * p.gravityScale;
      const tl = Math.hypot(tvx, tvy);
      const dec = t.friction * gs * dt;
      if (tl <= dec) {
        tvx = 0;
        tvy = 0;
      } else {
        tvx -= (tvx / tl) * dec;
        tvy -= (tvy / tl) * dec;
      }
      if (Math.hypot(tvx, tvy) < p.settleSpeed) {
        s.landed = i;
        s.landAngle = Math.atan2(ny, nx) - b.rotationAt(s.t);
        s.contact = -1;
        attachLanded(bodies, f, s, p);
        s.ax = NaN;
        sink?.(Ev.Land, i, s.touchSpeed);
        s.touchSpeed = 0;
        return Ev.Land;
      }
    }
    rvx = tvx + nx * nOut;
    rvy = tvy + ny * nOut;
    s.vx = sv.x + rvx;
    s.vy = sv.y + rvy;
    s.ax = NaN;
  }
  return result;
}
