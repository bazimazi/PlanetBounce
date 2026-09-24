import { wrapAngle } from '../core/math';
import type { BodyFrame } from '../physics/body';
import type { ProbeState } from '../physics/sim';
import type { World } from '../world/world';

/**
 * Observes one flight (launch → landing/incident) and recognizes maneuvers: gravity assists,
 * orbits, close passes, aerobraking, near misses. Also records the path for failure replays.
 */

export type FlightEvent =
  | { type: 'assist'; body: number; deflection: number; gain: number }
  | { type: 'orbit'; body: number; count: number }
  | { type: 'closePass'; body: number; distance: number }
  | { type: 'aerobrake'; body: number }
  | { type: 'enterWell'; body: number };

export interface Maneuver {
  id: string;
  name: string;
  weight: number;
}

const MAX_PATH = 4000;

export class FlightTracker {
  readonly from: number;
  readonly startT: number;
  fuelUsed = 0;
  abilityUsed = false;
  bounces = 0;
  readonly bouncedOn = new Set<number>();
  readonly assists: number[] = [];
  orbits = 0;
  maxSpeed = 0;
  arrivalSpeed = 0;
  readonly aeroBodies = new Set<number>();
  /** Smallest (distance − radius) / radius reached around any star. */
  starGraze = Infinity;
  ejected = false;

  readonly path = new Float32Array(MAX_PATH * 2);
  pathCount = 0;
  private stepCount = 0;

  private inside: Uint8Array;
  private minD: Float64Array;
  private lastD: Float64Array;
  private entryVx: Float64Array;
  private entryVy: Float64Array;
  private entrySpeed: Float64Array;
  private sweep: Float64Array;
  private lastAng: Float64Array;
  private orbitCount: Uint16Array;
  private inAtmo: Uint8Array;
  readonly enteredAt: Float64Array;
  /** Closest surface distance reached per body over the whole flight. */
  readonly closest: Float64Array;

  constructor(world: World, from: number, t: number) {
    const n = world.bodies.length;
    this.from = from;
    this.startT = t;
    this.inside = new Uint8Array(n);
    this.minD = new Float64Array(n).fill(Infinity);
    this.lastD = new Float64Array(n).fill(Infinity);
    this.entryVx = new Float64Array(n);
    this.entryVy = new Float64Array(n);
    this.entrySpeed = new Float64Array(n);
    this.sweep = new Float64Array(n);
    this.lastAng = new Float64Array(n);
    this.orbitCount = new Uint16Array(n);
    this.inAtmo = new Uint8Array(n);
    this.enteredAt = new Float64Array(n).fill(-1);
    this.closest = new Float64Array(n).fill(Infinity);
    // We start inside the origin's well; it is not an "entry".
    this.inside[from] = 1;
    this.minD[from] = 0;
  }

  get duration(): number {
    return this.lastT - this.startT;
  }

  private lastT = 0;

  update(world: World, f: BodyFrame, s: ProbeState, out: FlightEvent[]): void {
    this.lastT = s.t;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed > this.maxSpeed) this.maxSpeed = speed;
    if (this.stepCount++ % 2 === 0) this.record(s.x, s.y);

    const bodies = world.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.mu <= 0 || !f.active[i]) continue;
      const dx = s.x - f.x[i]!;
      const dy = s.y - f.y[i]!;
      const r = Math.hypot(dx, dy);
      const surfD = r - b.radius;
      if (surfD < this.closest[i]!) this.closest[i] = surfD;
      if (b.type.lethal) this.starGraze = Math.min(this.starGraze, surfD / b.radius);

      const isIn = r < b.soi;
      if (isIn && !this.inside[i]) {
        this.inside[i] = 1;
        this.minD[i] = r;
        this.lastD[i] = r;
        this.entryVx[i] = s.vx - f.vx[i]!;
        this.entryVy[i] = s.vy - f.vy[i]!;
        this.entrySpeed[i] = speed;
        this.sweep[i] = 0;
        this.lastAng[i] = Math.atan2(dy, dx);
        this.enteredAt[i] = s.t;
        out.push({ type: 'enterWell', body: i });
      } else if (!isIn && this.inside[i]) {
        this.inside[i] = 0;
        if (i !== this.from && this.minD[i]! < b.radius * 2.8) {
          const evx = s.vx - f.vx[i]!;
          const evy = s.vy - f.vy[i]!;
          const a0 = Math.atan2(this.entryVy[i]!, this.entryVx[i]!);
          const a1 = Math.atan2(evy, evx);
          const deflection = Math.abs(wrapAngle(a1 - a0));
          if (deflection > 0.4) {
            const gain = this.entrySpeed[i]! > 0 ? speed / this.entrySpeed[i]! - 1 : 0;
            if (!this.assists.includes(i)) this.assists.push(i);
            out.push({ type: 'assist', body: i, deflection, gain });
          }
        }
        this.orbitCount[i] = 0;
      }

      if (this.inside[i]) {
        // Orbit detection: accumulate swept angle around the body.
        const ang = Math.atan2(dy, dx);
        this.sweep[i] += wrapAngle(ang - this.lastAng[i]!);
        this.lastAng[i] = ang;
        if (Math.abs(this.sweep[i]!) >= Math.PI * 2) {
          this.sweep[i] -= Math.sign(this.sweep[i]!) * Math.PI * 2;
          this.orbitCount[i]++;
          this.orbits++;
          out.push({ type: 'orbit', body: i, count: this.orbitCount[i]! });
        }
        // Periapsis detection → close pass.
        if (r > this.lastD[i]! && this.lastD[i]! <= this.minD[i]! && this.lastD[i]! < b.radius * 2 && i !== this.from) {
          out.push({ type: 'closePass', body: i, distance: this.lastD[i]! - b.radius });
        }
        if (r < this.minD[i]!) this.minD[i] = r;
        this.lastD[i] = r;
      }

      // Aerobraking: entered a gas giant atmosphere and came back out alive.
      if (b.type.atmosphereDrag) {
        const atmo = r < b.radius;
        if (atmo && !this.inAtmo[i]) this.inAtmo[i] = 1;
        else if (!atmo && this.inAtmo[i]) {
          this.inAtmo[i] = 0;
          if (!this.aeroBodies.has(i)) {
            this.aeroBodies.add(i);
            out.push({ type: 'aerobrake', body: i });
          }
        }
      }
    }
  }

  private record(x: number, y: number): void {
    if (this.pathCount >= MAX_PATH) {
      // Keep the most recent half — the part that explains the outcome.
      this.path.copyWithin(0, MAX_PATH, MAX_PATH * 2);
      this.pathCount = MAX_PATH / 2;
    }
    this.path[this.pathCount * 2] = x;
    this.path[this.pathCount * 2 + 1] = y;
    this.pathCount++;
  }

  /** Maneuvers for the landing summary; weight feeds the reward multiplier. */
  maneuvers(landedOn: number, touchSpeed: number): Maneuver[] {
    const m: Maneuver[] = [];
    const clean = this.fuelUsed <= 0.01 && !this.abilityUsed;
    const assists = this.assists.filter((a) => a !== landedOn);
    if (assists.length >= 3) m.push({ id: 'tripleAssist', name: 'Triple Assist', weight: 1.5 });
    else if (assists.length === 2) m.push({ id: 'doubleAssist', name: 'Double Assist', weight: 0.8 });
    else if (assists.length === 1) m.push({ id: 'assist', name: 'Gravity Assist', weight: 0.4 });
    if (assists.length && clean) m.push({ id: 'perfectSlingshot', name: 'Perfect Slingshot', weight: 0.6 });
    if (this.orbits >= 3) m.push({ id: 'deepOrbit', name: `Deep Orbit ×${this.orbits}`, weight: 0.8 });
    else if (this.orbits > 0) m.push({ id: 'orbit', name: this.orbits > 1 ? `Orbit ×${this.orbits}` : 'Orbit', weight: 0.3 * this.orbits });
    if (this.bounces === 0 && touchSpeed < 25) m.push({ id: 'featherTouch', name: 'Feather Touch', weight: 0.5 });
    else if (this.bounces === 0 && touchSpeed < 55) m.push({ id: 'precision', name: 'Precision Landing', weight: 0.25 });
    if ([...this.bouncedOn].some((b) => b !== landedOn)) m.push({ id: 'ricochet', name: 'Ricochet', weight: 0.5 });
    if (this.aeroBodies.size) m.push({ id: 'skimmer', name: 'Aerobrake Landing', weight: 0.5 });
    if (this.starGraze < 0.5) m.push({ id: 'sunDiver', name: 'Sun Dive', weight: 0.7 });
    if (this.ejected) m.push({ id: 'eruptionRider', name: 'Eruption Rider', weight: 0.5 });
    if (clean && !m.length && landedOn !== this.from) m.push({ id: 'gravityOnly', name: 'Gravity Only', weight: 0.1 });
    return m;
  }
}
