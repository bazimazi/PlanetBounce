import { TAU } from '../core/math';
import type { PlanetDefinition } from '../data/planetTypes';

/** Circular orbit around a parent body or a fixed point. Fully analytical → deterministic prediction. */
export interface OrbitSpec {
  parent: number | null; // body index, or null → around (cx, cy)
  cx: number;
  cy: number;
  radius: number;
  period: number; // seconds per revolution, negative = clockwise
  phase: number;
}

/** Straight-line drift that wraps horizontally (asteroid streams, rogue bodies). */
export interface DriftSpec {
  vx: number;
  vy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type BodyTag = 'start' | 'gate' | 'fuel' | 'rich' | 'unknown' | 'secret' | 'unstable' | 'boss' | 'shortcut';

export interface BodyInit {
  type: PlanetDefinition;
  x: number;
  y: number;
  radius: number;
  rotSpeed: number;
  rot0?: number;
  orbit?: OrbitSpec;
  drift?: DriftSpec;
  tags?: BodyTag[];
  matter?: number;
  /** Unstable bodies collapse this many seconds after the probe lands on them. */
  unstableFuse?: number;
  /** Visible only when the probe is within this range (or a scanner reveals it). */
  hiddenRange?: number;
  name?: string;
  behaviorPhase?: number;
}

export class Body {
  readonly index: number;
  readonly type: PlanetDefinition;
  readonly x0: number;
  readonly y0: number;
  readonly radius: number;
  readonly mu: number;
  readonly soi: number;
  readonly coreRadius: number;
  readonly rotSpeed: number;
  readonly rot0: number;
  readonly orbit?: OrbitSpec;
  readonly drift?: DriftSpec;
  readonly tags: Set<BodyTag>;
  readonly unstableFuse: number;
  readonly hiddenRange: number;
  readonly behaviorPhase: number;
  name: string;

  // Mutable gameplay state (not physics-affecting except collapseAt).
  matter: number;
  collected = false;
  visited = false;
  revealed: boolean;
  /** Rewards/hazards known (within scanner range at some point). */
  scanned = false;
  /** For unknown (?) bodies: true once visited or deep-scanned. */
  identified: boolean;
  collapseAt = Infinity;

  constructor(index: number, init: BodyInit) {
    this.index = index;
    this.type = init.type;
    this.x0 = init.x;
    this.y0 = init.y;
    this.radius = init.radius;
    this.mu = init.type.surfaceGravity * init.radius * init.radius;
    this.soi = init.radius * init.type.soiFactor;
    this.coreRadius = init.type.coreFactor ? init.radius * init.type.coreFactor : init.radius;
    this.rotSpeed = init.rotSpeed;
    this.rot0 = init.rot0 ?? 0;
    this.orbit = init.orbit;
    this.drift = init.drift;
    this.tags = new Set(init.tags ?? []);
    this.matter = init.matter ?? 0;
    this.unstableFuse = init.unstableFuse ?? 0;
    this.hiddenRange = init.hiddenRange ?? 0;
    this.revealed = this.hiddenRange <= 0;
    this.identified = !this.tags.has('unknown');
    this.behaviorPhase = init.behaviorPhase ?? 0;
    this.name = init.name ?? init.type.name;
  }

  get moving(): boolean {
    return !!this.orbit || !!this.drift;
  }

  /** Collision radius: gas giants collide only at their core. */
  get solidRadius(): number {
    return this.type.landable || this.type.lethal || this.type.damageSpeed ? this.radius : this.coreRadius;
  }

  rotationAt(t: number): number {
    return this.rot0 + this.rotSpeed * t;
  }

  isActive(t: number): boolean {
    return t < this.collapseAt;
  }

  /** Gravitational parameter at time t (pulsars breathe). */
  muAt(t: number): number {
    const b = this.type.behavior;
    if (b && b.kind === 'pulse') {
      return this.mu * (1 + b.amplitude * Math.sin((TAU * (t + this.behaviorPhase)) / b.period));
    }
    return this.mu;
  }

  /** 0..1 progress inside an eruption, or -1 when dormant. */
  eruptionAt(t: number): number {
    const b = this.type.behavior;
    if (!b || b.kind !== 'erupt') return -1;
    const local = (((t + this.behaviorPhase) % b.period) + b.period) % b.period;
    const start = b.period - b.duration;
    return local >= start ? (local - start) / b.duration : -1;
  }

  /** Seconds until the next eruption begins (0 while erupting). */
  timeToEruption(t: number): number {
    const b = this.type.behavior;
    if (!b || b.kind !== 'erupt') return Infinity;
    const local = (((t + this.behaviorPhase) % b.period) + b.period) % b.period;
    const start = b.period - b.duration;
    return local >= start ? 0 : start - local;
  }
}

/**
 * Evaluates every body's position/velocity at time t into flat arrays. Parents always
 * precede children (enforced by World), so a single forward pass resolves hierarchies.
 */
export class BodyFrame {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  mu: Float64Array;
  active: Uint8Array;
  t = NaN;

  constructor(n: number) {
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.mu = new Float64Array(n);
    this.active = new Uint8Array(n);
  }

  eval(bodies: readonly Body[], t: number): void {
    if (this.t === t) return;
    this.t = t;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.orbit) {
        const o = b.orbit;
        const px = o.parent === null ? o.cx : this.x[o.parent]!;
        const py = o.parent === null ? o.cy : this.y[o.parent]!;
        const pvx = o.parent === null ? 0 : this.vx[o.parent]!;
        const pvy = o.parent === null ? 0 : this.vy[o.parent]!;
        const w = TAU / o.period;
        const a = o.phase + w * t;
        const c = Math.cos(a);
        const s = Math.sin(a);
        this.x[i] = px + o.radius * c;
        this.y[i] = py + o.radius * s;
        this.vx[i] = pvx - o.radius * w * s;
        this.vy[i] = pvy + o.radius * w * c;
      } else if (b.drift) {
        const d = b.drift;
        const w = d.maxX - d.minX;
        const h = d.maxY - d.minY;
        let x = b.x0 + d.vx * t - d.minX;
        let y = b.y0 + d.vy * t - d.minY;
        x = ((x % w) + w) % w;
        y = h > 0 ? ((y % h) + h) % h : y;
        this.x[i] = d.minX + x;
        this.y[i] = d.minY + y;
        this.vx[i] = d.vx;
        this.vy[i] = d.vy;
      } else {
        this.x[i] = b.x0;
        this.y[i] = b.y0;
        this.vx[i] = 0;
        this.vy[i] = 0;
      }
      this.mu[i] = b.muAt(t);
      this.active[i] = b.isActive(t) ? 1 : 0;
    }
  }
}
